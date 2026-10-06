//! Deposit, session key, partial claims, close-with-refund and timeout refund
//! against a 6-decimal mint.

use astroam_escrow::{
    close_voucher_message, process_instruction, ERR_ALREADY_SETTLED, ERR_AMOUNT_EXCEEDS, ERR_BAD_ACCOUNT,
    ERR_BAD_VOUCHER, ERR_BELOW_ATTESTED, ERR_BELOW_CLAIMED, ERR_NOTHING_TO_CLAIM, ERR_TIMEOUT, ERR_UNEXPECTED_DECIMALS,
    ESCROW_LEN, LEGACY_ESCROW_LEN, TAG_CHECKPOINT, TAG_CLAIM, TAG_CLOSE, TAG_DEPOSIT, TAG_INITIALIZE, TAG_REFUND,
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
    /// Signs usage vouchers. Not the traveler and not the payee.
    meter: Keypair,
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
    let meter = Keypair::new();
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
        let mut data = Vec::with_capacity(1 + 8 + 32 + 32);
        data.push(TAG_INITIALIZE);
        data.extend_from_slice(&TIMEOUT.to_le_bytes());
        data.extend_from_slice(payee.pubkey().as_ref());
        data.extend_from_slice(meter.pubkey().as_ref());
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
        meter,
    }
}

fn init_data(payee: &Pubkey, meter: &Pubkey) -> Vec<u8> {
    let mut data = Vec::with_capacity(1 + 8 + 32 + 32);
    data.push(TAG_INITIALIZE);
    data.extend_from_slice(&TIMEOUT.to_le_bytes());
    data.extend_from_slice(payee.as_ref());
    data.extend_from_slice(meter.as_ref());
    data
}

fn sign_tx(tx: &mut Transaction, all: &[Keypair], blockhash: solana_sdk::hash::Hash) {
    let refs: Vec<&dyn Signer> = all.iter().map(|k| k as &dyn Signer).collect();
    tx.sign(&refs, blockhash);
}

async fn send(context: &mut ProgramTestContext, ixs: &[Instruction], signers: &[Keypair]) {
    try_send(context, ixs, signers).await.unwrap();
}

async fn try_send(context: &mut ProgramTestContext, ixs: &[Instruction], signers: &[Keypair]) -> Result<(), BanksClientError> {
    // A new blockhash per transaction: the bank answers a byte-identical
    // transaction from its status cache, so a repeated close or refund would
    // report the first result instead of running again.
    let blockhash = context.get_new_latest_blockhash().await.unwrap();
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
    deposit_with_session_ix(world, escrow_id, amount, None)
}

fn deposit_with_session_ix(world: &World, escrow_id: &[u8; 32], amount: u64, session: Option<&Pubkey>) -> Instruction {
    let (config, _) = Pubkey::find_program_address(&[b"config"], &world.program_id);
    let (escrow, _) = Pubkey::find_program_address(&[b"escrow", escrow_id], &world.program_id);
    let (vault, _) = Pubkey::find_program_address(&[b"vault", escrow_id], &world.program_id);
    let mut data = Vec::with_capacity(73);
    data.push(TAG_DEPOSIT);
    data.extend_from_slice(escrow_id);
    data.extend_from_slice(&amount.to_le_bytes());
    if let Some(session) = session {
        data.extend_from_slice(session.as_ref());
    }
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
    let meter = cloned(&world.meter);
    close_signed_ixs(world, escrow_id, amount, &meter)
}

fn close_signed_ixs(world: &World, escrow_id: &[u8; 32], amount: u64, signer: &Keypair) -> Vec<Instruction> {
    let (config, _) = Pubkey::find_program_address(&[b"config"], &world.program_id);
    let (escrow, _) = Pubkey::find_program_address(&[b"escrow", escrow_id], &world.program_id);
    let (vault, _) = Pubkey::find_program_address(&[b"vault", escrow_id], &world.program_id);
    let message = close_voucher_message(&world.program_id, escrow_id, amount);
    let ed25519 = ed25519_verify_ix(signer, &message);
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

fn claim_ixs(world: &World, escrow_id: &[u8; 32], amount: u64, signer: &Keypair) -> Vec<Instruction> {
    let (config, _) = Pubkey::find_program_address(&[b"config"], &world.program_id);
    let (escrow, _) = Pubkey::find_program_address(&[b"escrow", escrow_id], &world.program_id);
    let (vault, _) = Pubkey::find_program_address(&[b"vault", escrow_id], &world.program_id);
    let message = close_voucher_message(&world.program_id, escrow_id, amount);
    let ed25519 = ed25519_verify_ix(signer, &message);
    let mut data = Vec::with_capacity(9);
    data.push(TAG_CLAIM);
    data.extend_from_slice(&amount.to_le_bytes());
    let claim = Instruction {
        program_id: world.program_id,
        accounts: vec![
            AccountMeta::new(world.payee.pubkey(), true),
            AccountMeta::new_readonly(config, false),
            AccountMeta::new(escrow, false),
            AccountMeta::new(vault, false),
            AccountMeta::new(world.payee_token, false),
            AccountMeta::new_readonly(spl_token::id(), false),
            AccountMeta::new_readonly(solana_sdk::sysvar::instructions::id(), false),
        ],
        data,
    };
    vec![ed25519, claim]
}

fn checkpoint_ixs(world: &World, escrow_id: &[u8; 32], amount: u64, signer: &Keypair) -> Vec<Instruction> {
    let (config, _) = Pubkey::find_program_address(&[b"config"], &world.program_id);
    let (escrow, _) = Pubkey::find_program_address(&[b"escrow", escrow_id], &world.program_id);
    let message = close_voucher_message(&world.program_id, escrow_id, amount);
    let ed25519 = ed25519_verify_ix(signer, &message);
    let mut data = Vec::with_capacity(9);
    data.push(TAG_CHECKPOINT);
    data.extend_from_slice(&amount.to_le_bytes());
    let checkpoint = Instruction {
        program_id: world.program_id,
        accounts: vec![
            AccountMeta::new(world.payee.pubkey(), true),
            AccountMeta::new_readonly(config, false),
            AccountMeta::new(escrow, false),
            AccountMeta::new_readonly(solana_sdk::sysvar::instructions::id(), false),
        ],
        data,
    };
    vec![ed25519, checkpoint]
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
            AccountMeta::new(world.payee_token, false),
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

async fn do_session_deposit(world: &mut World, escrow_id: &[u8; 32], amount: u64, session: &Keypair) {
    let ix = deposit_with_session_ix(world, escrow_id, amount, Some(&session.pubkey()));
    let traveler = cloned(&world.traveler);
    send(&mut world.context, &[ix], &[traveler]).await;
}

async fn do_close_signed(world: &mut World, escrow_id: &[u8; 32], amount: u64, signer: &Keypair) -> Result<(), BanksClientError> {
    let ixs = close_signed_ixs(world, escrow_id, amount, signer);
    let payee = cloned(&world.payee);
    try_send(&mut world.context, &ixs, &[payee]).await
}

async fn do_checkpoint(world: &mut World, escrow_id: &[u8; 32], amount: u64, signer: &Keypair) -> Result<(), BanksClientError> {
    let ixs = checkpoint_ixs(world, escrow_id, amount, signer);
    let payee = cloned(&world.payee);
    try_send(&mut world.context, &ixs, &[payee]).await
}

async fn do_claim(world: &mut World, escrow_id: &[u8; 32], amount: u64, signer: &Keypair) -> Result<(), BanksClientError> {
    let ixs = claim_ixs(world, escrow_id, amount, signer);
    let payee = cloned(&world.payee);
    try_send(&mut world.context, &ixs, &[payee]).await
}

async fn advance_clock(world: &mut World, seconds: i64) {
    let mut clock = world.context.banks_client.get_sysvar::<Clock>().await.unwrap();
    clock.unix_timestamp += seconds;
    world.context.set_sysvar(&clock);
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
    data.extend_from_slice(world.meter.pubkey().as_ref());
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

#[tokio::test]
async fn deposit_registers_the_session_key() {
    let mut world = world(6).await;
    let escrow_id = [10u8; 32];
    let session = Keypair::new();
    do_session_deposit(&mut world, &escrow_id, 5_000_000, &session).await;

    let (escrow, _) = Pubkey::find_program_address(&[b"escrow", &escrow_id], &world.program_id);
    let raw = world.context.banks_client.get_account(escrow).await.unwrap().unwrap();
    assert_eq!(raw.data.len(), ESCROW_LEN);
    assert_eq!(&raw.data[83..115], session.pubkey().as_ref());
    assert_eq!(u64::from_le_bytes(raw.data[115..123].try_into().unwrap()), 0);
}

#[tokio::test]
async fn session_key_cannot_authorize_settlement() {
    let mut world = world(6).await;
    let escrow_id = [11u8; 32];
    let session = Keypair::new();
    do_session_deposit(&mut world, &escrow_id, 5_000_000, &session).await;
    // The session key is still stored at deposit. It no longer moves USDC:
    // it lives in the traveler's browser, so accepting it would let them block
    // or understate the charge.
    let err = do_close_signed(&mut world, &escrow_id, 625_000, &session).await.unwrap_err();
    assert_eq!(custom_of(&err), Some(ERR_BAD_VOUCHER));
    let err = do_claim(&mut world, &escrow_id, 625_000, &session).await.unwrap_err();
    assert_eq!(custom_of(&err), Some(ERR_BAD_VOUCHER));
    let (vault, _) = Pubkey::find_program_address(&[b"vault", &escrow_id], &world.program_id);
    assert_eq!(token_amount(&mut world.context, &vault).await, 5_000_000);
}

#[tokio::test]
async fn voucher_from_an_unregistered_key_is_rejected() {
    let mut world = world(6).await;
    let escrow_id = [12u8; 32];
    let session = Keypair::new();
    let stranger = Keypair::new();
    do_session_deposit(&mut world, &escrow_id, 5_000_000, &session).await;

    let err = do_close_signed(&mut world, &escrow_id, 5_000_000, &stranger).await.unwrap_err();
    assert_eq!(custom_of(&err), Some(ERR_BAD_VOUCHER));
    let err = do_claim(&mut world, &escrow_id, 5_000_000, &stranger).await.unwrap_err();
    assert_eq!(custom_of(&err), Some(ERR_BAD_VOUCHER));
    // The payee key is not the meter. Holding the treasury does not authorize a charge.
    let payee = cloned(&world.payee);
    let err = do_claim(&mut world, &escrow_id, 5_000_000, &payee).await.unwrap_err();
    assert_eq!(custom_of(&err), Some(ERR_BAD_VOUCHER));
    let traveler = cloned(&world.traveler);
    let err = do_close_signed(&mut world, &escrow_id, 5_000_000, &traveler).await.unwrap_err();
    assert_eq!(custom_of(&err), Some(ERR_BAD_VOUCHER));
}

#[tokio::test]
async fn deposit_without_a_session_key_accepts_no_session_voucher() {
    let mut world = world(6).await;
    let escrow_id = [13u8; 32];
    do_deposit(&mut world, &escrow_id, 1_000_000).await;
    // The stored session key is all zeros; a keypair cannot be that pubkey.
    let stranger = Keypair::new();
    let err = do_close_signed(&mut world, &escrow_id, 100_000, &stranger).await.unwrap_err();
    assert_eq!(custom_of(&err), Some(ERR_BAD_VOUCHER));
}

#[tokio::test]
async fn claims_pay_in_tranches_and_close_pays_only_the_rest() {
    let mut world = world(6).await;
    let escrow_id = [14u8; 32];
    let session = Keypair::new();
    do_session_deposit(&mut world, &escrow_id, 10_000_000, &session).await;
    let (vault, _) = Pubkey::find_program_address(&[b"vault", &escrow_id], &world.program_id);
    let meter = cloned(&world.meter);

    do_claim(&mut world, &escrow_id, 2_000_000, &meter).await.unwrap();
    assert_eq!(token_amount(&mut world.context, &world.payee_token).await, 2_000_000);
    assert_eq!(token_amount(&mut world.context, &vault).await, 8_000_000);

    do_claim(&mut world, &escrow_id, 4_500_000, &meter).await.unwrap();
    assert_eq!(token_amount(&mut world.context, &world.payee_token).await, 4_500_000);

    // The same voucher again, or an older one, moves nothing.
    let err = do_claim(&mut world, &escrow_id, 4_500_000, &meter).await.unwrap_err();
    assert_eq!(custom_of(&err), Some(ERR_NOTHING_TO_CLAIM));
    let err = do_claim(&mut world, &escrow_id, 2_000_000, &meter).await.unwrap_err();
    assert_eq!(custom_of(&err), Some(ERR_NOTHING_TO_CLAIM));
    let err = do_claim(&mut world, &escrow_id, 10_000_001, &meter).await.unwrap_err();
    assert_eq!(custom_of(&err), Some(ERR_AMOUNT_EXCEEDS));

    do_close_signed(&mut world, &escrow_id, 6_000_000, &meter).await.unwrap();
    assert_eq!(token_amount(&mut world.context, &world.payee_token).await, 6_000_000);
    assert_eq!(token_amount(&mut world.context, &world.traveler_token).await, SUPPLY - 6_000_000);
    assert_eq!(token_amount(&mut world.context, &vault).await, 0);
}

#[tokio::test]
async fn close_cannot_take_back_what_was_claimed() {
    let mut world = world(6).await;
    let escrow_id = [15u8; 32];
    let session = Keypair::new();
    do_session_deposit(&mut world, &escrow_id, 5_000_000, &session).await;
    let meter = cloned(&world.meter);
    do_claim(&mut world, &escrow_id, 3_000_000, &meter).await.unwrap();

    // A voucher under what was already paid is rejected before the signature is read.
    let err = do_close_signed(&mut world, &escrow_id, 0, &meter).await.unwrap_err();
    assert_eq!(custom_of(&err), Some(ERR_BELOW_CLAIMED));
    // The traveler cannot sign the same amount and take the claim back either.
    let traveler = cloned(&world.traveler);
    let err = do_close_signed(&mut world, &escrow_id, 3_000_000, &traveler).await.unwrap_err();
    assert_eq!(custom_of(&err), Some(ERR_BAD_VOUCHER));

    do_close_signed(&mut world, &escrow_id, 3_000_000, &meter).await.unwrap();
    assert_eq!(token_amount(&mut world.context, &world.payee_token).await, 3_000_000);
    assert_eq!(token_amount(&mut world.context, &world.traveler_token).await, SUPPLY - 3_000_000);
}

#[tokio::test]
async fn a_claim_restarts_the_timeout_and_the_refund_keeps_it_paid() {
    let mut world = world(6).await;
    let escrow_id = [16u8; 32];
    let session = Keypair::new();
    do_session_deposit(&mut world, &escrow_id, 5_000_000, &session).await;
    let meter = cloned(&world.meter);

    advance_clock(&mut world, TIMEOUT - 60).await;
    do_claim(&mut world, &escrow_id, 2_000_000, &meter).await.unwrap();

    // Seven days after the deposit, but one minute after the claim.
    advance_clock(&mut world, 120).await;
    let err = do_refund(&mut world, &escrow_id).await.unwrap_err();
    assert_eq!(custom_of(&err), Some(ERR_TIMEOUT));

    advance_clock(&mut world, TIMEOUT).await;
    do_refund(&mut world, &escrow_id).await.unwrap();
    assert_eq!(token_amount(&mut world.context, &world.payee_token).await, 2_000_000);
    assert_eq!(token_amount(&mut world.context, &world.traveler_token).await, SUPPLY - 2_000_000);
    let (vault, _) = Pubkey::find_program_address(&[b"vault", &escrow_id], &world.program_id);
    assert_eq!(token_amount(&mut world.context, &vault).await, 0);
}

/// The traveler never signs. The payee submits a close whose voucher is the
/// meter's, and the used amount is paid.
#[tokio::test]
async fn traveler_does_not_sign() {
    let mut world = world(6).await;
    let escrow_id = [17u8; 32];
    let deposit_amount = 10_000_000u64;
    let used = 9_000_000u64;
    do_deposit(&mut world, &escrow_id, deposit_amount).await;

    let traveler = cloned(&world.traveler);
    let err = do_close_signed(&mut world, &escrow_id, used, &traveler).await.unwrap_err();
    assert_eq!(custom_of(&err), Some(ERR_BAD_VOUCHER));

    // The transaction signer is the payee. The traveler is not a signer.
    do_close(&mut world, &escrow_id, used).await.unwrap();
    assert_eq!(token_amount(&mut world.context, &world.payee_token).await, used);
    assert_eq!(token_amount(&mut world.context, &world.traveler_token).await, SUPPLY - used);
    let (vault, _) = Pubkey::find_program_address(&[b"vault", &escrow_id], &world.program_id);
    assert_eq!(token_amount(&mut world.context, &vault).await, 0);
}

/// A checkpoint stores the meter's voucher. After the timeout the payee is
/// paid that amount and the traveler receives only the rest. Checkpointing
/// does not restart the deadline.
#[tokio::test]
async fn timeout_pays_the_attested_amount_and_refunds_the_rest() {
    let mut world = world(6).await;
    let escrow_id = [18u8; 32];
    let deposit_amount = 10_000_000u64;
    let used = 9_000_000u64;
    do_deposit(&mut world, &escrow_id, deposit_amount).await;
    advance_clock(&mut world, TIMEOUT - 30).await;

    let meter = cloned(&world.meter);
    do_checkpoint(&mut world, &escrow_id, used, &meter).await.unwrap();
    let (escrow, _) = Pubkey::find_program_address(&[b"escrow", &escrow_id], &world.program_id);
    let raw = world.context.banks_client.get_account(escrow).await.unwrap().unwrap();
    assert_eq!(u64::from_le_bytes(raw.data[123..131].try_into().unwrap()), used);

    // A lower close cannot undercut the checkpoint, and the deadline did not move.
    let err = do_close(&mut world, &escrow_id, used - 1).await.unwrap_err();
    assert_eq!(custom_of(&err), Some(ERR_BELOW_ATTESTED));
    let err = do_refund(&mut world, &escrow_id).await.unwrap_err();
    assert_eq!(custom_of(&err), Some(ERR_TIMEOUT));

    advance_clock(&mut world, 30).await;
    do_refund(&mut world, &escrow_id).await.unwrap();
    assert_eq!(token_amount(&mut world.context, &world.payee_token).await, used);
    assert_eq!(token_amount(&mut world.context, &world.traveler_token).await, SUPPLY - used);
    let (vault, _) = Pubkey::find_program_address(&[b"vault", &escrow_id], &world.program_id);
    assert_eq!(token_amount(&mut world.context, &vault).await, 0);
}

#[tokio::test]
async fn voucher_capped_at_the_deposit() {
    let mut world = world(6).await;
    let escrow_id = [19u8; 32];
    let deposit_amount = 10_000_000u64;
    do_deposit(&mut world, &escrow_id, deposit_amount).await;
    let meter = cloned(&world.meter);

    let err = do_checkpoint(&mut world, &escrow_id, deposit_amount + 1, &meter).await.unwrap_err();
    assert_eq!(custom_of(&err), Some(ERR_AMOUNT_EXCEEDS));
    let err = do_claim(&mut world, &escrow_id, deposit_amount + 1, &meter).await.unwrap_err();
    assert_eq!(custom_of(&err), Some(ERR_AMOUNT_EXCEEDS));
    let err = do_close(&mut world, &escrow_id, deposit_amount + 1).await.unwrap_err();
    assert_eq!(custom_of(&err), Some(ERR_AMOUNT_EXCEEDS));

    let (vault, _) = Pubkey::find_program_address(&[b"vault", &escrow_id], &world.program_id);
    assert_eq!(token_amount(&mut world.context, &vault).await, deposit_amount);
    assert_eq!(token_amount(&mut world.context, &world.payee_token).await, 0);

    // The deposit itself is payable. Nothing is left to refund.
    do_close(&mut world, &escrow_id, deposit_amount).await.unwrap();
    assert_eq!(token_amount(&mut world.context, &world.payee_token).await, deposit_amount);
    assert_eq!(token_amount(&mut world.context, &world.traveler_token).await, SUPPLY - deposit_amount);
}

#[tokio::test]
async fn wrong_meter_key_rejected() {
    let mut world = world(6).await;
    let escrow_id = [20u8; 32];
    do_deposit(&mut world, &escrow_id, 5_000_000).await;
    let wrong = Keypair::new();

    let err = do_checkpoint(&mut world, &escrow_id, 1_000_000, &wrong).await.unwrap_err();
    assert_eq!(custom_of(&err), Some(ERR_BAD_VOUCHER));
    let err = do_claim(&mut world, &escrow_id, 1_000_000, &wrong).await.unwrap_err();
    assert_eq!(custom_of(&err), Some(ERR_BAD_VOUCHER));
    let err = do_close_signed(&mut world, &escrow_id, 1_000_000, &wrong).await.unwrap_err();
    assert_eq!(custom_of(&err), Some(ERR_BAD_VOUCHER));
    let (vault, _) = Pubkey::find_program_address(&[b"vault", &escrow_id], &world.program_id);
    assert_eq!(token_amount(&mut world.context, &vault).await, 5_000_000);
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// The same bytes as `src/shared/solana/escrow.test.ts`. Change both or neither.
#[tokio::test]
async fn instruction_data_matches_the_shared_fixture() {
    let world = world(6).await;
    let escrow_id = [0x22u8; 32];
    let session = Pubkey::new_from_array([0x55; 32]);
    let deposit = format!("01{}404b4c0000000000", "22".repeat(32));
    assert_eq!(hex(&deposit_ix(&world, &escrow_id, 5_000_000).data), deposit);
    assert_eq!(
        hex(&deposit_with_session_ix(&world, &escrow_id, 5_000_000, Some(&session)).data),
        format!("{deposit}{}", "55".repeat(32))
    );
    let signer = Keypair::new();
    assert_eq!(hex(&claim_ixs(&world, &escrow_id, 500_000, &signer)[1].data), "0520a1070000000000");
    assert_eq!(hex(&close_signed_ixs(&world, &escrow_id, 500_000, &signer)[1].data), "0320a1070000000000");
    assert_eq!(hex(&checkpoint_ixs(&world, &escrow_id, 500_000, &signer)[1].data), "0620a1070000000000");
}

// ---------------------------------------------------------------------------
// The backend's own transactions (src/solana/EscrowChain.ts), from the fixture
// that src/solana/EscrowChain.test.ts pins. Running them here is what says the
// program accepts the bytes the backend really sends.
// ---------------------------------------------------------------------------

const BACKEND_FIXTURE: &str = include_str!("fixtures/backend-transactions.json");
const ASSOCIATED_TOKEN_PROGRAM: &str = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

fn seeded(seed: u64) -> Keypair {
    solana_sdk::signer::keypair::keypair_from_seed(&[seed as u8; 32]).unwrap()
}

fn pubkey_of(value: &serde_json::Value) -> Pubkey {
    value.as_str().unwrap().parse().unwrap()
}

fn associated_token(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    let program: Pubkey = ASSOCIATED_TOKEN_PROGRAM.parse().unwrap();
    Pubkey::find_program_address(&[owner.as_ref(), spl_token::id().as_ref(), mint.as_ref()], &program).0
}

fn token_account_with(mint: &Pubkey, owner: &Pubkey, amount: u64) -> solana_sdk::account::Account {
    let mut data = vec![0u8; TokenAccount::LEN];
    let account = TokenAccount {
        mint: *mint,
        owner: *owner,
        amount,
        state: spl_token::state::AccountState::Initialized,
        ..TokenAccount::default()
    };
    TokenAccount::pack(account, &mut data).unwrap();
    solana_sdk::account::Account { lamports: 10_000_000, data, owner: spl_token::id(), ..Default::default() }
}

/// The fixture's instructions, minus the associated-token ones: the token
/// accounts already exist here and this bank does not load that program.
fn backend_ixs(tx: &serde_json::Value) -> Vec<Instruction> {
    let associated: Pubkey = ASSOCIATED_TOKEN_PROGRAM.parse().unwrap();
    tx["instructions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|ix| Instruction {
            program_id: pubkey_of(&ix["programId"]),
            accounts: ix["keys"]
                .as_array()
                .unwrap()
                .iter()
                .map(|k| AccountMeta {
                    pubkey: pubkey_of(&k["pubkey"]),
                    is_signer: k["isSigner"].as_bool().unwrap(),
                    is_writable: k["isWritable"].as_bool().unwrap(),
                })
                .collect(),
            data: {
                let hex = ix["data"].as_str().unwrap();
                (0..hex.len()).step_by(2).map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap()).collect()
            },
        })
        .filter(|ix| ix.program_id != associated)
        .collect()
}

async fn send_as(context: &mut ProgramTestContext, ixs: &[Instruction], payer: &Keypair) -> Result<(), BanksClientError> {
    let blockhash = context.get_new_latest_blockhash().await.unwrap();
    let mut tx = Transaction::new_with_payer(ixs, Some(&payer.pubkey()));
    tx.sign(&[payer], blockhash);
    context.banks_client.process_transaction(tx).await
}

#[tokio::test]
async fn backend_transactions_run_against_the_program() {
    let fixture: serde_json::Value = serde_json::from_str(BACKEND_FIXTURE).unwrap();
    let seeds = &fixture["seeds"];
    let program_id = pubkey_of(&fixture["programId"]);
    assert_eq!(program_id, seeded(seeds["program"].as_u64().unwrap()).pubkey());
    let mint = pubkey_of(&fixture["mint"]);
    let payee = seeded(seeds["payee"].as_u64().unwrap()).pubkey();
    let traveler = seeded(seeds["traveler"].as_u64().unwrap());
    let session = seeded(seeds["session"].as_u64().unwrap()).pubkey();
    let operator = seeded(seeds["operator"].as_u64().unwrap());
    let escrow_id: [u8; 32] = pubkey_of(&fixture["escrowId"]).to_bytes();
    let deposit_amount: u64 = fixture["depositAtomic"].as_str().unwrap().parse().unwrap();
    let traveler_token = associated_token(&traveler.pubkey(), &mint);
    let payee_token = associated_token(&payee, &mint);

    let mut test = ProgramTest::new("astroam_escrow", program_id, processor!(process_instruction));
    test.add_program("spl_token", spl_token::id(), processor!(spl_token::processor::Processor::process));
    // Circle's mint address, with 6 decimals, and the wallets' USDC accounts where the backend looks for them.
    let mut mint_data = vec![0u8; Mint::LEN];
    Mint::pack(Mint { decimals: 6, is_initialized: true, supply: SUPPLY, ..Mint::default() }, &mut mint_data).unwrap();
    test.add_account(
        mint,
        solana_sdk::account::Account { lamports: 10_000_000, data: mint_data, owner: spl_token::id(), ..Default::default() },
    );
    test.add_account(traveler_token, token_account_with(&mint, &traveler.pubkey(), SUPPLY));
    test.add_account(payee_token, token_account_with(&mint, &payee, 0));
    for wallet in [traveler.pubkey(), operator.pubkey()] {
        test.add_account(wallet, solana_sdk::account::Account { lamports: 2_000_000_000, ..Default::default() });
    }
    let mut context = test.start_with_context().await;

    let (config, _) = Pubkey::find_program_address(&[b"config"], &program_id);
    let (escrow, _) = Pubkey::find_program_address(&[b"escrow", &escrow_id], &program_id);
    let (vault, _) = Pubkey::find_program_address(&[b"vault", &escrow_id], &program_id);
    let meter = seeded(seeds["meter"].as_u64().unwrap()).pubkey();
    let mut init = vec![TAG_INITIALIZE];
    init.extend_from_slice(&TIMEOUT.to_le_bytes());
    init.extend_from_slice(payee.as_ref());
    init.extend_from_slice(meter.as_ref());
    let payer = context.payer.pubkey();
    send(
        &mut context,
        &[Instruction {
            program_id,
            accounts: vec![
                AccountMeta::new(payer, true),
                AccountMeta::new(config, false),
                AccountMeta::new_readonly(mint, false),
                AccountMeta::new_readonly(system_program::id(), false),
            ],
            data: init,
        }],
        &[],
    )
    .await;

    // The traveler's one transaction: the deposit, registering the session key.
    let mut deposit = vec![TAG_DEPOSIT];
    deposit.extend_from_slice(&escrow_id);
    deposit.extend_from_slice(&deposit_amount.to_le_bytes());
    deposit.extend_from_slice(session.as_ref());
    send_as(
        &mut context,
        &[Instruction {
            program_id,
            accounts: vec![
                AccountMeta::new(traveler.pubkey(), true),
                AccountMeta::new_readonly(config, false),
                AccountMeta::new(escrow, false),
                AccountMeta::new(vault, false),
                AccountMeta::new(traveler_token, false),
                AccountMeta::new_readonly(mint, false),
                AccountMeta::new_readonly(spl_token::id(), false),
                AccountMeta::new_readonly(system_program::id(), false),
            ],
            data: deposit,
        }],
        &traveler,
    )
    .await
    .unwrap();

    // From here on only the operator signs: checkpoint, then claim, then close.
    // The vouchers are the meter's. The traveler does not sign them.
    let attested: u64 = fixture["checkpoint"]["cumulativeAtomic"].as_str().unwrap().parse().unwrap();
    send_as(&mut context, &backend_ixs(&fixture["checkpoint"]), &operator).await.unwrap();
    assert_eq!(token_amount(&mut context, &payee_token).await, 0);
    assert_eq!(token_amount(&mut context, &vault).await, deposit_amount);
    let _ = attested;

    let claimed: u64 = fixture["claim"]["cumulativeAtomic"].as_str().unwrap().parse().unwrap();
    send_as(&mut context, &backend_ixs(&fixture["claim"]), &operator).await.unwrap();
    assert_eq!(token_amount(&mut context, &payee_token).await, claimed);
    assert_eq!(token_amount(&mut context, &vault).await, deposit_amount - claimed);

    let closed: u64 = fixture["close"]["cumulativeAtomic"].as_str().unwrap().parse().unwrap();
    send_as(&mut context, &backend_ixs(&fixture["close"]), &operator).await.unwrap();
    assert_eq!(token_amount(&mut context, &payee_token).await, closed);
    assert_eq!(token_amount(&mut context, &traveler_token).await, SUPPLY - closed);
    assert_eq!(token_amount(&mut context, &vault).await, 0);
}

/// An escrow opened by the first deployed program (83 bytes, no session key,
/// no claims) must still pay and refund after the program is upgraded.
#[tokio::test]
async fn an_escrow_from_the_first_layout_still_closes() {
    let program_id = Pubkey::new_unique();
    let mint = Pubkey::new_unique();
    let traveler = Keypair::new();
    let payee = Keypair::new();
    let meter = Keypair::new();
    let escrow_id = [0x77u8; 32];
    let deposit_amount = 5_000_000u64;
    let traveler_token = Pubkey::new_unique();
    let payee_token = Pubkey::new_unique();
    let (escrow, bump) = Pubkey::find_program_address(&[b"escrow", &escrow_id], &program_id);
    let (vault, _) = Pubkey::find_program_address(&[b"vault", &escrow_id], &program_id);

    let mut test = ProgramTest::new("astroam_escrow", program_id, processor!(process_instruction));
    test.add_program("spl_token", spl_token::id(), processor!(spl_token::processor::Processor::process));
    let mut mint_data = vec![0u8; Mint::LEN];
    Mint::pack(Mint { decimals: 6, is_initialized: true, supply: SUPPLY, ..Mint::default() }, &mut mint_data).unwrap();
    test.add_account(
        mint,
        solana_sdk::account::Account { lamports: 10_000_000, data: mint_data, owner: spl_token::id(), ..Default::default() },
    );
    test.add_account(traveler_token, token_account_with(&mint, &traveler.pubkey(), SUPPLY - deposit_amount));
    test.add_account(payee_token, token_account_with(&mint, &payee.pubkey(), 0));
    test.add_account(vault, token_account_with(&mint, &escrow, deposit_amount));
    let mut legacy = vec![0u8; LEGACY_ESCROW_LEN];
    legacy[0] = 1;
    legacy[1..33].copy_from_slice(traveler.pubkey().as_ref());
    legacy[41..49].copy_from_slice(&deposit_amount.to_le_bytes());
    legacy[50] = bump;
    legacy[51..83].copy_from_slice(&escrow_id);
    test.add_account(
        escrow,
        solana_sdk::account::Account { lamports: 10_000_000, data: legacy, owner: program_id, ..Default::default() },
    );
    test.add_account(payee.pubkey(), solana_sdk::account::Account { lamports: 2_000_000_000, ..Default::default() });
    let mut context = test.start_with_context().await;

    let (config, _) = Pubkey::find_program_address(&[b"config"], &program_id);
    let mut init = init_data(&payee.pubkey(), &meter.pubkey());
    let payer = context.payer.pubkey();
    send(
        &mut context,
        &[Instruction {
            program_id,
            accounts: vec![
                AccountMeta::new(payer, true),
                AccountMeta::new(config, false),
                AccountMeta::new_readonly(mint, false),
                AccountMeta::new_readonly(system_program::id(), false),
            ],
            data: init,
        }],
        &[],
    )
    .await;

    let world = World {
        context,
        program_id,
        mint,
        traveler: cloned(&traveler),
        traveler_token,
        payee,
        payee_token,
        meter,
    };
    let mut world = world;

    // No room to record a claim in the old layout.
    let err = do_claim(&mut world, &escrow_id, 1_000_000, &traveler).await.unwrap_err();
    assert_eq!(custom_of(&err), Some(ERR_BAD_ACCOUNT));

    do_close(&mut world, &escrow_id, 625_000).await.unwrap();
    assert_eq!(token_amount(&mut world.context, &world.payee_token).await, 625_000);
    assert_eq!(token_amount(&mut world.context, &world.traveler_token).await, SUPPLY - 625_000);
    assert_eq!(token_amount(&mut world.context, &vault).await, 0);
}
