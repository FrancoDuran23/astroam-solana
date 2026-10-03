//! Deposit, close-with-refund, and timeout refund against a 6-decimal mint.

use astroam_escrow::{
    close_voucher_message, process_instruction, ERR_ALREADY_SETTLED, ERR_AMOUNT_EXCEEDS, ERR_TIMEOUT,
    ERR_UNEXPECTED_DECIMALS, TAG_CLOSE, TAG_DEPOSIT, TAG_INITIALIZE, TAG_REFUND,
};
use solana_program_test::*;
use solana_sdk::{
    clock::Clock,
    instruction::{AccountMeta, Instruction, InstructionError},
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    system_instruction, system_program,
    transaction::{Transaction, TransactionError},
};
use solana_program::program_pack::Pack;
use spl_token::state::{Account as TokenAccount, Mint};

fn cloned(kp: &Keypair) -> Keypair {
    Keypair::from_bytes(&kp.to_bytes()).unwrap()
}

const TIMEOUT: i64 = 7 * 24 * 60 * 60;
const SUPPLY: u64 = 1_000_000_000;

struct World {
    context: ProgramTestContext,
    program_id: Pubkey,
    mint: Pubkey,
    traveler: Keypair,
    traveler_token: Pubkey,
    payee: Keypair,
    payee_token: Pubkey,
}

async fn world(decimals: u8) -> World {
    let program_id = Pubkey::new_unique();
    let mut test = ProgramTest::new("astroam_escrow", program_id, processor!(process_instruction));
    test.add_program(
        "spl_token",
        spl_token::id(),
        processor!(spl_token::processor::Processor::process),
    );
    let mut context = test.start_with_context().await;
    let payer = context.payer.pubkey();
    let mint = Keypair::new();
    let traveler = Keypair::new();
    let payee = Keypair::new();
    let traveler_token = Keypair::new();
    let payee_token = Keypair::new();
    let rent = context.banks_client.get_rent().await.unwrap();

    let mut ixs = vec![
        system_instruction::transfer(&payer, &traveler.pubkey(), 2_000_000_000),
        system_instruction::transfer(&payer, &payee.pubkey(), 500_000_000),
        system_instruction::create_account(
            &payer,
            &mint.pubkey(),
            rent.minimum_balance(Mint::LEN),
            Mint::LEN as u64,
            &spl_token::id(),
        ),
        spl_token::instruction::initialize_mint(&spl_token::id(), &mint.pubkey(), &payer, None, decimals).unwrap(),
        system_instruction::create_account(
            &payer,
            &traveler_token.pubkey(),
            rent.minimum_balance(TokenAccount::LEN),
            TokenAccount::LEN as u64,
            &spl_token::id(),
        ),
        spl_token::instruction::initialize_account(&spl_token::id(), &traveler_token.pubkey(), &mint.pubkey(), &traveler.pubkey()).unwrap(),
        system_instruction::create_account(
            &payer,
            &payee_token.pubkey(),
            rent.minimum_balance(TokenAccount::LEN),
            TokenAccount::LEN as u64,
            &spl_token::id(),
        ),
        spl_token::instruction::initialize_account(&spl_token::id(), &payee_token.pubkey(), &mint.pubkey(), &payee.pubkey()).unwrap(),
    ];
    if decimals == 6 {
        ixs.push(
            spl_token::instruction::mint_to(
                &spl_token::id(),
                &mint.pubkey(),
                &traveler_token.pubkey(),
                &payer,
                &[],
                SUPPLY,
            )
            .unwrap(),
        );
    }
    send(&mut context, &ixs, &[cloned(&mint), cloned(&traveler_token), cloned(&payee_token)]).await;

    if decimals == 6 {
        let mut data = Vec::with_capacity(1 + 8 + 32);
        data.push(TAG_INITIALIZE);
        data.extend_from_slice(&TIMEOUT.to_le_bytes());
        data.extend_from_slice(payee.pubkey().as_ref());
        let (config, _) = Pubkey::find_program_address(&[b"config"], &program_id);
        send(
            &mut context,
            &[Instruction {
                program_id,
                accounts: vec![
                    AccountMeta::new(payer, true),
                    AccountMeta::new(config, false),
                    AccountMeta::new_readonly(mint.pubkey(), false),
                    AccountMeta::new_readonly(system_program::id(), false),
                ],
                data,
            }],
            &[],
        )
        .await;
    }

    World {
        context,
        program_id,
        mint: mint.pubkey(),
        traveler,
        traveler_token: traveler_token.pubkey(),
        payee,
        payee_token: payee_token.pubkey(),
    }
}

fn sign_tx(tx: &mut Transaction, all: &[Keypair], blockhash: solana_sdk::hash::Hash) {
    let refs: Vec<&dyn Signer> = all.iter().map(|k| k as &dyn Signer).collect();
    tx.sign(&refs, blockhash);
}

async fn send(context: &mut ProgramTestContext, ixs: &[Instruction], signers: &[Keypair]) {
    try_send(context, ixs, signers).await.unwrap();
}

async fn try_send(context: &mut ProgramTestContext, ixs: &[Instruction], signers: &[Keypair]) -> Result<(), BanksClientError> {
    let blockhash = context.banks_client.get_latest_blockhash().await.unwrap();
    let payer = cloned(&context.payer);
    let mut tx = Transaction::new_with_payer(ixs, Some(&payer.pubkey()));
    let mut all = vec![payer];
    all.extend(signers.iter().map(cloned));
    sign_tx(&mut tx, &all, blockhash);
    context.banks_client.process_transaction(tx).await
}

fn custom_of(err: &BanksClientError) -> Option<u32> {
    let tx_err = match err {
        BanksClientError::TransactionError(inner) => inner,
        BanksClientError::SimulationError { err, .. } => err,
        _ => return None,
    };
    match tx_err {
        TransactionError::InstructionError(_, InstructionError::Custom(code)) => Some(*code),
        _ => None,
    }
}

/// Same layout as `solana_sdk::ed25519_instruction::new_ed25519_instruction`.
fn ed25519_verify_ix(signer: &Keypair, message: &[u8]) -> Instruction {
    let signature = signer.sign_message(message);
    let pubkey = signer.pubkey().to_bytes();
    let public_key_offset: u16 = 16;
    let signature_offset: u16 = public_key_offset + 32;
    let message_data_offset: u16 = signature_offset + 64;
    let mut data = Vec::with_capacity(message_data_offset as usize + message.len());
    data.push(1);
    data.push(0);
    data.extend_from_slice(&signature_offset.to_le_bytes());
    data.extend_from_slice(&u16::MAX.to_le_bytes());
    data.extend_from_slice(&public_key_offset.to_le_bytes());
    data.extend_from_slice(&u16::MAX.to_le_bytes());
    data.extend_from_slice(&message_data_offset.to_le_bytes());
    data.extend_from_slice(&(message.len() as u16).to_le_bytes());
    data.extend_from_slice(&u16::MAX.to_le_bytes());
    data.extend_from_slice(&pubkey);
    data.extend_from_slice(signature.as_ref());
    data.extend_from_slice(message);
    Instruction {
        program_id: solana_sdk::ed25519_program::id(),
        accounts: vec![],
        data,
    }
}

fn deposit_ix(world: &World, escrow_id: &[u8; 32], amount: u64) -> Instruction {
    let (config, _) = Pubkey::find_program_address(&[b"config"], &world.program_id);
    let (escrow, _) = Pubkey::find_program_address(&[b"escrow", escrow_id], &world.program_id);
    let (vault, _) = Pubkey::find_program_address(&[b"vault", escrow_id], &world.program_id);
    let mut data = Vec::with_capacity(41);
    data.push(TAG_DEPOSIT);
    data.extend_from_slice(escrow_id);
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction {
        program_id: world.program_id,
        accounts: vec![
            AccountMeta::new(world.traveler.pubkey(), true),
            AccountMeta::new_readonly(config, false),
            AccountMeta::new(escrow, false),
            AccountMeta::new(vault, false),
            AccountMeta::new(world.traveler_token, false),
            AccountMeta::new_readonly(world.mint, false),
            AccountMeta::new_readonly(spl_token::id(), false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

fn close_ixs(world: &World, escrow_id: &[u8; 32], amount: u64) -> Vec<Instruction> {
    let (config, _) = Pubkey::find_program_address(&[b"config"], &world.program_id);
    let (escrow, _) = Pubkey::find_program_address(&[b"escrow", escrow_id], &world.program_id);
    let (vault, _) = Pubkey::find_program_address(&[b"vault", escrow_id], &world.program_id);
    let message = close_voucher_message(&world.program_id, escrow_id, amount);
    let ed25519 = ed25519_verify_ix(&world.traveler, &message);
    let mut data = Vec::with_capacity(9);
    data.push(TAG_CLOSE);
    data.extend_from_slice(&amount.to_le_bytes());
    let close = Instruction {
        program_id: world.program_id,
        accounts: vec![
            AccountMeta::new(world.payee.pubkey(), true),
            AccountMeta::new_readonly(config, false),
            AccountMeta::new(escrow, false),
            AccountMeta::new(vault, false),
            AccountMeta::new(world.payee_token, false),
            AccountMeta::new(world.traveler_token, false),
            AccountMeta::new_readonly(spl_token::id(), false),
            AccountMeta::new_readonly(solana_sdk::sysvar::instructions::id(), false),
        ],
        data,
    };
    vec![ed25519, close]
}

fn refund_ix(world: &World, escrow_id: &[u8; 32]) -> Instruction {
    let (config, _) = Pubkey::find_program_address(&[b"config"], &world.program_id);
    let (escrow, _) = Pubkey::find_program_address(&[b"escrow", escrow_id], &world.program_id);
    let (vault, _) = Pubkey::find_program_address(&[b"vault", escrow_id], &world.program_id);
    Instruction {
        program_id: world.program_id,
        accounts: vec![
            AccountMeta::new(world.payee.pubkey(), true),
            AccountMeta::new_readonly(config, false),
            AccountMeta::new(escrow, false),
            AccountMeta::new(vault, false),
            AccountMeta::new(world.traveler_token, false),
            AccountMeta::new_readonly(spl_token::id(), false),
        ],
        data: vec![TAG_REFUND],
    }
}

async fn do_deposit(world: &mut World, escrow_id: &[u8; 32], amount: u64) {
    let ix = deposit_ix(world, escrow_id, amount);
    let traveler = cloned(&world.traveler);
    send(&mut world.context, &[ix], &[traveler]).await;
}

async fn do_close(world: &mut World, escrow_id: &[u8; 32], amount: u64) -> Result<(), BanksClientError> {
    let ixs = close_ixs(world, escrow_id, amount);
    let payee = cloned(&world.payee);
    try_send(&mut world.context, &ixs, &[payee]).await
}

async fn do_refund(world: &mut World, escrow_id: &[u8; 32]) -> Result<(), BanksClientError> {
    let ix = refund_ix(world, escrow_id);
    let payee = cloned(&world.payee);
    try_send(&mut world.context, &[ix], &[payee]).await
}

async fn token_amount(context: &mut ProgramTestContext, account: &Pubkey) -> u64 {
    let raw = context.banks_client.get_account(*account).await.unwrap().unwrap();
    TokenAccount::unpack(&raw.data).unwrap().amount
}

#[tokio::test]
async fn deposit_pulls_six_decimal_usdc() {
    let mut world = world(6).await;
    let escrow_id = [7u8; 32];
    let amount = 5_000_000u64;
    do_deposit(&mut world, &escrow_id, amount).await;

    let (escrow, _) = Pubkey::find_program_address(&[b"escrow", &escrow_id], &world.program_id);
    let (vault, _) = Pubkey::find_program_address(&[b"vault", &escrow_id], &world.program_id);
    let raw = world.context.banks_client.get_account(escrow).await.unwrap().unwrap();
    assert_eq!(raw.data[0], 1);
    assert_eq!(&raw.data[1..33], world.traveler.pubkey().as_ref());
    assert_eq!(u64::from_le_bytes(raw.data[41..49].try_into().unwrap()), amount);
    assert_eq!(raw.data[49], 0);
    assert_eq!(token_amount(&mut world.context, &vault).await, amount);
    assert_eq!(token_amount(&mut world.context, &world.traveler_token).await, SUPPLY - amount);
}

#[tokio::test]
async fn close_pays_used_and_refunds_the_rest() {
    let mut world = world(6).await;
    let escrow_id = [9u8; 32];
    let deposit_amount = 5_000_000u64;
    let used = 500_000u64;
    do_deposit(&mut world, &escrow_id, deposit_amount).await;
    do_close(&mut world, &escrow_id, used).await.unwrap();

    assert_eq!(token_amount(&mut world.context, &world.payee_token).await, used);
    assert_eq!(token_amount(&mut world.context, &world.traveler_token).await, SUPPLY - used);
    let (vault, _) = Pubkey::find_program_address(&[b"vault", &escrow_id], &world.program_id);
    assert_eq!(token_amount(&mut world.context, &vault).await, 0);
}

#[tokio::test]
async fn second_close_is_rejected() {
    let mut world = world(6).await;
    let escrow_id = [3u8; 32];
    do_deposit(&mut world, &escrow_id, 1_000_000).await;
    do_close(&mut world, &escrow_id, 100_000).await.unwrap();
    let err = do_close(&mut world, &escrow_id, 100_000).await.unwrap_err();
    assert_eq!(custom_of(&err), Some(ERR_ALREADY_SETTLED));
}

#[tokio::test]
async fn seven_decimal_amount_overcharges_and_reverts() {
    let mut world = world(6).await;
    let escrow_id = [4u8; 32];
    // 1 USDC at 6 decimals. 0.2 USDC is 200_000. The same 0.2 USDC in the
    // original Stellar raw unit (1e-7) is 2_000_000, which is larger than the
    // deposit and must not be payable.
    do_deposit(&mut world, &escrow_id, 1_000_000).await;
    let err = do_close(&mut world, &escrow_id, 2_000_000).await.unwrap_err();
    assert_eq!(custom_of(&err), Some(ERR_AMOUNT_EXCEEDS));

    do_close(&mut world, &escrow_id, 200_000).await.unwrap();
    assert_eq!(token_amount(&mut world.context, &world.payee_token).await, 200_000);
    assert_eq!(token_amount(&mut world.context, &world.traveler_token).await, SUPPLY - 200_000);
}

#[tokio::test]
async fn refund_before_timeout_reverts() {
    let mut world = world(6).await;
    let escrow_id = [5u8; 32];
    do_deposit(&mut world, &escrow_id, 5_000_000).await;
    let err = do_refund(&mut world, &escrow_id).await.unwrap_err();
    assert_eq!(custom_of(&err), Some(ERR_TIMEOUT));
    let (vault, _) = Pubkey::find_program_address(&[b"vault", &escrow_id], &world.program_id);
    assert_eq!(token_amount(&mut world.context, &vault).await, 5_000_000);
}

#[tokio::test]
async fn timeout_refund_returns_the_full_deposit() {
    let mut world = world(6).await;
    let escrow_id = [6u8; 32];
    let amount = 5_000_000u64;
    do_deposit(&mut world, &escrow_id, amount).await;

    let mut clock = world.context.banks_client.get_sysvar::<Clock>().await.unwrap();
    clock.unix_timestamp += TIMEOUT;
    world.context.set_sysvar(&clock);

    let anyone = Keypair::new();
    let payer = world.context.payer.pubkey();
    send(
        &mut world.context,
        &[system_instruction::transfer(&payer, &anyone.pubkey(), 100_000_000)],
        &[],
    )
    .await;
    // The caller is not the traveler and is not paid. Swap the refund signer
    // by rebuilding the instruction with `anyone` as the fee payer inside the
    // program accounts (any signer may submit).
    let mut ix = refund_ix(&world, &escrow_id);
    ix.accounts[0] = AccountMeta::new(anyone.pubkey(), true);
    let blockhash = world.context.banks_client.get_latest_blockhash().await.unwrap();
    let mut tx = Transaction::new_with_payer(&[ix], Some(&anyone.pubkey()));
    tx.sign(&[&anyone], blockhash);
    world.context.banks_client.process_transaction(tx).await.unwrap();

    assert_eq!(token_amount(&mut world.context, &world.traveler_token).await, SUPPLY);
    assert_eq!(token_amount(&mut world.context, &world.payee_token).await, 0);
    let (vault, _) = Pubkey::find_program_address(&[b"vault", &escrow_id], &world.program_id);
    assert_eq!(token_amount(&mut world.context, &vault).await, 0);
}

#[tokio::test]
async fn timeout_refund_after_close_reverts() {
    let mut world = world(6).await;
    let escrow_id = [8u8; 32];
    do_deposit(&mut world, &escrow_id, 1_000_000).await;
    do_close(&mut world, &escrow_id, 0).await.unwrap();
    let mut clock = world.context.banks_client.get_sysvar::<Clock>().await.unwrap();
    clock.unix_timestamp += TIMEOUT;
    world.context.set_sysvar(&clock);
    let err = do_refund(&mut world, &escrow_id).await.unwrap_err();
    assert_eq!(custom_of(&err), Some(ERR_ALREADY_SETTLED));
}

#[tokio::test]
async fn seven_decimal_mint_cannot_initialize() {
    let mut world = world(7).await;
    let mut data = Vec::new();
    data.push(TAG_INITIALIZE);
    data.extend_from_slice(&TIMEOUT.to_le_bytes());
    data.extend_from_slice(world.payee.pubkey().as_ref());
    let (config, _) = Pubkey::find_program_address(&[b"config"], &world.program_id);
    let payer = world.context.payer.pubkey();
    let program_id = world.program_id;
    let mint = world.mint;
    let err = try_send(
        &mut world.context,
        &[Instruction {
            program_id,
            accounts: vec![
                AccountMeta::new(payer, true),
                AccountMeta::new(config, false),
                AccountMeta::new_readonly(mint, false),
                AccountMeta::new_readonly(system_program::id(), false),
            ],
            data,
        }],
        &[],
    )
    .await
    .unwrap_err();
    assert_eq!(custom_of(&err), Some(ERR_UNEXPECTED_DECIMALS));
}
