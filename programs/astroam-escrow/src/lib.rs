#![allow(unexpected_cfgs)]
//! Prepaid mobile-data escrow for Solana devnet.
//!
//! The traveler deposits USDC once (6 decimals) and may register a session
//! key in that same transaction. Usage is metered off-chain. A cumulative
//! ed25519 voucher, signed by the meter key stored in the program config,
//! authorizes what AstroAm has earned so far. The traveler and the session
//! key cannot sign it: a traveler who used 9 of 10 USDC must not be able to
//! block settlement or take the 10 back.
//!
//! - `checkpoint` records the latest voucher on the escrow and moves nothing,
//!   so a later timeout still knows what was used;
//! - `claim` pays AstroAm the part of the voucher not paid yet and leaves the
//!   escrow open, so a long trip is collected in tranches;
//! - `close` pays the rest of the voucher and refunds what is left of the
//!   deposit in the same transaction.
//!
//! If nobody closes, `refund` pays the payee the attested amount that was not
//! claimed yet and returns only the rest to the traveler, `timeout_seconds`
//! after the last top-up or claim. A checkpoint does not move that deadline.
//! The charged amount never exceeds the deposit. This program does not debit
//! per megabyte.

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    msg,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    program_pack::Pack,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    sysvar::{
        clock::Clock,
        instructions::{load_current_index_checked, load_instruction_at_checked},
        Sysvar,
    },
};
use spl_token::state::{Account as TokenAccount, Mint};

#[cfg(not(feature = "no-entrypoint"))]
solana_program::entrypoint!(process_instruction);

/// `b"AstroAmEscrow:v1:close"` — 22 bytes. The TypeScript client signs the same prefix.
pub const VOUCHER_PREFIX: &[u8] = b"AstroAmEscrow:v1:close";

pub const TAG_INITIALIZE: u8 = 0;
pub const TAG_DEPOSIT: u8 = 1;
pub const TAG_TOP_UP: u8 = 2;
pub const TAG_CLOSE: u8 = 3;
pub const TAG_REFUND: u8 = 4;
pub const TAG_CLAIM: u8 = 5;
pub const TAG_CHECKPOINT: u8 = 6;

pub const ERR_UNEXPECTED_DECIMALS: u32 = 1;
pub const ERR_ZERO_AMOUNT: u32 = 2;
pub const ERR_ESCROW_EXISTS: u32 = 3;
pub const ERR_ESCROW_MISSING: u32 = 4;
pub const ERR_ALREADY_SETTLED: u32 = 5;
pub const ERR_NOT_TRAVELER: u32 = 6;
pub const ERR_AMOUNT_EXCEEDS: u32 = 7;
pub const ERR_BAD_VOUCHER: u32 = 8;
pub const ERR_TIMEOUT: u32 = 9;
pub const ERR_ALREADY_INIT: u32 = 10;
pub const ERR_MINT_MISMATCH: u32 = 11;
pub const ERR_BAD_ACCOUNT: u32 = 12;
pub const ERR_NOTHING_TO_CLAIM: u32 = 13;
pub const ERR_BELOW_CLAIMED: u32 = 14;
pub const ERR_BELOW_ATTESTED: u32 = 15;

/// Payee, mint, timeout, bump, then the meter pubkey.
const CONFIG_LEN: usize = 106;
/// Session key, `claimed`, then `attested` (the latest meter voucher).
pub const ESCROW_LEN: usize = 131;
/// Session key and `claimed`, before `attested` was stored. They still close
/// and refund: the attested amount is whatever was already claimed.
pub const CLAIM_ESCROW_LEN: usize = 123;
/// Escrows opened before session keys and claims. They still close and refund.
pub const LEGACY_ESCROW_LEN: usize = 83;
const USDC_DECIMALS: u8 = 6;

pub fn close_voucher_message(program_id: &Pubkey, escrow_id: &[u8; 32], amount: u64) -> Vec<u8> {
    let mut message = Vec::with_capacity(VOUCHER_PREFIX.len() + 32 + 32 + 8);
    message.extend_from_slice(VOUCHER_PREFIX);
    message.extend_from_slice(program_id.as_ref());
    message.extend_from_slice(escrow_id);
    message.extend_from_slice(&amount.to_le_bytes());
    message
}

fn custom(code: u32) -> ProgramError {
    ProgramError::Custom(code)
}

pub fn process_instruction(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let tag = *data.first().ok_or(ProgramError::InvalidInstructionData)?;
    match tag {
        TAG_INITIALIZE => initialize(program_id, accounts, data),
        TAG_DEPOSIT => deposit(program_id, accounts, data),
        TAG_TOP_UP => top_up(program_id, accounts, data),
        TAG_CLOSE => close(program_id, accounts, data),
        TAG_REFUND => refund(program_id, accounts),
        TAG_CLAIM => claim(program_id, accounts, data),
        TAG_CHECKPOINT => checkpoint(program_id, accounts, data),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

fn initialize(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let accounts = &mut accounts.iter();
    let payer = next_account_info(accounts)?;
    let config = next_account_info(accounts)?;
    let mint_info = next_account_info(accounts)?;
    let system_program = next_account_info(accounts)?;

    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let (payee, meter) = read_initialize(data)?;
    let timeout = i64::from_le_bytes(data[1..9].try_into().unwrap());
    if timeout <= 0 {
        return Err(custom(ERR_ZERO_AMOUNT));
    }
    if *system_program.key != solana_program::system_program::id() {
        return Err(ProgramError::IncorrectProgramId);
    }

    let (config_pda, bump) = Pubkey::find_program_address(&[b"config"], program_id);
    if *config.key != config_pda {
        return Err(ProgramError::InvalidSeeds);
    }
    if config.data_len() > 0 && config.owner == program_id {
        return Err(custom(ERR_ALREADY_INIT));
    }
    if *mint_info.owner != spl_token::id() {
        return Err(custom(ERR_MINT_MISMATCH));
    }
    let mint = Mint::unpack(&mint_info.data.borrow())?;
    if mint.decimals != USDC_DECIMALS {
        msg!("mint decimals {}, USDC on this rail is 6", mint.decimals);
        return Err(custom(ERR_UNEXPECTED_DECIMALS));
    }

    let rent = Rent::get()?;
    invoke_signed(
        &system_instruction::create_account(
            payer.key,
            config.key,
            rent.minimum_balance(CONFIG_LEN),
            CONFIG_LEN as u64,
            program_id,
        ),
        &[payer.clone(), config.clone(), system_program.clone()],
        &[&[b"config", &[bump]]],
    )?;
    write_config(config, &payee, mint_info.key, timeout, bump, &meter);
    Ok(())
}

/// 73 bytes: timeout, the payee that receives used USDC, and the meter key
/// that signs vouchers. Both pubkeys are required; the payer is not a default.
fn read_initialize(data: &[u8]) -> Result<(Pubkey, Pubkey), ProgramError> {
    if data.len() != 1 + 8 + 32 + 32 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let payee = read_pubkey(data, 9)?;
    let meter = read_pubkey(data, 41)?;
    if payee == Pubkey::default() || meter == Pubkey::default() {
        return Err(custom(ERR_BAD_ACCOUNT));
    }
    Ok((payee, meter))
}

fn read_pubkey(data: &[u8], at: usize) -> Result<Pubkey, ProgramError> {
    let mut bytes = [0u8; 32];
    bytes.copy_from_slice(data.get(at..at + 32).ok_or(ProgramError::InvalidInstructionData)?);
    Ok(Pubkey::new_from_array(bytes))
}

/// 41-byte form stores no session key. 73-byte form stores one in the last
/// 32 bytes. The stored key does not authorize settlement: only the meter
/// key in the config can sign a voucher.
fn deposit(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() != 1 + 32 + 8 && data.len() != 1 + 32 + 8 + 32 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let mut escrow_id = [0u8; 32];
    escrow_id.copy_from_slice(&data[1..33]);
    let amount = u64::from_le_bytes(data[33..41].try_into().unwrap());
    let mut session_key = [0u8; 32];
    if data.len() == 73 {
        session_key.copy_from_slice(&data[41..73]);
    }
    if amount == 0 {
        return Err(custom(ERR_ZERO_AMOUNT));
    }

    let accounts = &mut accounts.iter();
    let traveler = next_account_info(accounts)?;
    let config = next_account_info(accounts)?;
    let escrow = next_account_info(accounts)?;
    let vault = next_account_info(accounts)?;
    let traveler_token = next_account_info(accounts)?;
    let mint_info = next_account_info(accounts)?;
    let token_program = next_account_info(accounts)?;
    let system_program = next_account_info(accounts)?;

    if !traveler.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let cfg = load_config(program_id, config)?;
    if *mint_info.key != cfg.mint {
        return Err(custom(ERR_MINT_MISMATCH));
    }
    if *token_program.key != spl_token::id() || *system_program.key != solana_program::system_program::id() {
        return Err(ProgramError::IncorrectProgramId);
    }

    let (escrow_pda, escrow_bump) = Pubkey::find_program_address(&[b"escrow", &escrow_id], program_id);
    let (vault_pda, vault_bump) = Pubkey::find_program_address(&[b"vault", &escrow_id], program_id);
    if *escrow.key != escrow_pda || *vault.key != vault_pda {
        return Err(ProgramError::InvalidSeeds);
    }
    if escrow.data_len() > 0 {
        return Err(custom(ERR_ESCROW_EXISTS));
    }

    let source = TokenAccount::unpack(&traveler_token.data.borrow())?;
    if source.mint != cfg.mint || source.owner != *traveler.key {
        return Err(custom(ERR_BAD_ACCOUNT));
    }

    let rent = Rent::get()?;
    invoke_signed(
        &system_instruction::create_account(
            traveler.key,
            escrow.key,
            rent.minimum_balance(ESCROW_LEN),
            ESCROW_LEN as u64,
            program_id,
        ),
        &[traveler.clone(), escrow.clone(), system_program.clone()],
        &[&[b"escrow", escrow_id.as_ref(), &[escrow_bump]]],
    )?;
    invoke_signed(
        &system_instruction::create_account(
            traveler.key,
            vault.key,
            rent.minimum_balance(TokenAccount::LEN),
            TokenAccount::LEN as u64,
            &spl_token::id(),
        ),
        &[traveler.clone(), vault.clone(), system_program.clone()],
        &[&[b"vault", escrow_id.as_ref(), &[vault_bump]]],
    )?;
    invoke(
        &spl_token::instruction::initialize_account3(&spl_token::id(), vault.key, mint_info.key, escrow.key)?,
        &[vault.clone(), mint_info.clone()],
    )?;
    invoke(
        &spl_token::instruction::transfer(&spl_token::id(), traveler_token.key, vault.key, traveler.key, &[], amount)?,
        &[traveler_token.clone(), vault.clone(), traveler.clone(), token_program.clone()],
    )?;

    let clock = Clock::get()?;
    let mut raw = escrow.data.borrow_mut();
    raw[0] = 1;
    raw[1..33].copy_from_slice(traveler.key.as_ref());
    raw[33..41].copy_from_slice(&clock.unix_timestamp.to_le_bytes());
    raw[41..49].copy_from_slice(&amount.to_le_bytes());
    raw[49] = 0;
    raw[50] = escrow_bump;
    raw[51..83].copy_from_slice(&escrow_id);
    raw[83..115].copy_from_slice(&session_key);
    raw[115..123].copy_from_slice(&0u64.to_le_bytes());
    Ok(())
}

fn top_up(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() != 1 + 8 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let amount = u64::from_le_bytes(data[1..9].try_into().unwrap());
    if amount == 0 {
        return Err(custom(ERR_ZERO_AMOUNT));
    }

    let accounts = &mut accounts.iter();
    let traveler = next_account_info(accounts)?;
    let config = next_account_info(accounts)?;
    let escrow = next_account_info(accounts)?;
    let vault = next_account_info(accounts)?;
    let traveler_token = next_account_info(accounts)?;
    let token_program = next_account_info(accounts)?;

    if !traveler.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let cfg = load_config(program_id, config)?;
    let mut state = load_escrow(program_id, escrow)?;
    if state.settled {
        return Err(custom(ERR_ALREADY_SETTLED));
    }
    if state.traveler != *traveler.key {
        return Err(custom(ERR_NOT_TRAVELER));
    }
    if *token_program.key != spl_token::id() {
        return Err(ProgramError::IncorrectProgramId);
    }
    let (vault_pda, _) = Pubkey::find_program_address(&[b"vault", &state.escrow_id], program_id);
    if *vault.key != vault_pda {
        return Err(ProgramError::InvalidSeeds);
    }
    let source = TokenAccount::unpack(&traveler_token.data.borrow())?;
    if source.mint != cfg.mint || source.owner != state.traveler {
        return Err(custom(ERR_BAD_ACCOUNT));
    }

    invoke(
        &spl_token::instruction::transfer(&spl_token::id(), traveler_token.key, vault.key, traveler.key, &[], amount)?,
        &[traveler_token.clone(), vault.clone(), traveler.clone(), token_program.clone()],
    )?;
    state.deposit = state.deposit.checked_add(amount).ok_or(ProgramError::InvalidArgument)?;
    write_deposit(escrow, state.deposit);
    write_active_at(escrow, Clock::get()?.unix_timestamp);
    Ok(())
}

/// Pays AstroAm the part of a cumulative voucher that was not paid yet. The
/// escrow stays open and the refund timeout restarts.
fn claim(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() != 1 + 8 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let cumulative = u64::from_le_bytes(data[1..9].try_into().unwrap());

    let accounts = &mut accounts.iter();
    let payer = next_account_info(accounts)?;
    let config = next_account_info(accounts)?;
    let escrow = next_account_info(accounts)?;
    let vault = next_account_info(accounts)?;
    let payee_token = next_account_info(accounts)?;
    let token_program = next_account_info(accounts)?;
    let instructions = next_account_info(accounts)?;

    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let cfg = load_config(program_id, config)?;
    let state = load_escrow(program_id, escrow)?;
    // Older layouts have no `attested` field. They can close and refund; they
    // cannot record a claim, because a claim is also an attestation.
    if escrow.data_len() < ESCROW_LEN {
        return Err(custom(ERR_BAD_ACCOUNT));
    }
    if state.settled {
        return Err(custom(ERR_ALREADY_SETTLED));
    }
    if cumulative > state.deposit {
        return Err(custom(ERR_AMOUNT_EXCEEDS));
    }
    if cumulative <= state.claimed {
        return Err(custom(ERR_NOTHING_TO_CLAIM));
    }
    if *token_program.key != spl_token::id() {
        return Err(ProgramError::IncorrectProgramId);
    }
    require_meter(&cfg, instructions, &close_voucher_message(program_id, &state.escrow_id, cumulative))?;
    let (vault_pda, _) = Pubkey::find_program_address(&[b"vault", &state.escrow_id], program_id);
    if *vault.key != vault_pda {
        return Err(ProgramError::InvalidSeeds);
    }
    assert_token(payee_token, cfg.mint, cfg.payee)?;

    let escrow_id = state.escrow_id;
    let bump_seed = [state.bump];
    let signer_seeds: [&[u8]; 3] = [b"escrow", escrow_id.as_ref(), &bump_seed];
    invoke_signed(
        &spl_token::instruction::transfer(
            &spl_token::id(),
            vault.key,
            payee_token.key,
            escrow.key,
            &[],
            cumulative - state.claimed,
        )?,
        &[vault.clone(), payee_token.clone(), escrow.clone(), token_program.clone()],
        &[&signer_seeds],
    )?;
    write_claimed(escrow, cumulative);
    // A claim is also an attestation: the timeout must not refund this part.
    if cumulative > state.attested {
        write_attested(escrow, cumulative);
    }
    write_active_at(escrow, Clock::get()?.unix_timestamp);
    Ok(())
}

/// Records the latest meter voucher and moves no tokens. It does not restart
/// the refund timeout: re-attesting cannot freeze the traveler's remainder.
fn checkpoint(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() != 1 + 8 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let cumulative = u64::from_le_bytes(data[1..9].try_into().unwrap());

    let accounts = &mut accounts.iter();
    let payer = next_account_info(accounts)?;
    let config = next_account_info(accounts)?;
    let escrow = next_account_info(accounts)?;
    let instructions = next_account_info(accounts)?;

    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let cfg = load_config(program_id, config)?;
    let state = load_escrow(program_id, escrow)?;
    if escrow.data_len() < ESCROW_LEN {
        return Err(custom(ERR_BAD_ACCOUNT));
    }
    if state.settled {
        return Err(custom(ERR_ALREADY_SETTLED));
    }
    if cumulative > state.deposit {
        return Err(custom(ERR_AMOUNT_EXCEEDS));
    }
    if cumulative < state.claimed {
        return Err(custom(ERR_BELOW_CLAIMED));
    }
    if cumulative <= state.attested {
        return Err(custom(ERR_NOTHING_TO_CLAIM));
    }
    require_meter(&cfg, instructions, &close_voucher_message(program_id, &state.escrow_id, cumulative))?;
    write_attested(escrow, cumulative);
    Ok(())
}

fn close(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() != 1 + 8 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let cumulative = u64::from_le_bytes(data[1..9].try_into().unwrap());

    let accounts = &mut accounts.iter();
    let payer = next_account_info(accounts)?;
    let config = next_account_info(accounts)?;
    let escrow = next_account_info(accounts)?;
    let vault = next_account_info(accounts)?;
    let payee_token = next_account_info(accounts)?;
    let traveler_token = next_account_info(accounts)?;
    let token_program = next_account_info(accounts)?;
    let instructions = next_account_info(accounts)?;

    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let cfg = load_config(program_id, config)?;
    let state = load_escrow(program_id, escrow)?;
    if state.settled {
        return Err(custom(ERR_ALREADY_SETTLED));
    }
    if cumulative > state.deposit {
        return Err(custom(ERR_AMOUNT_EXCEEDS));
    }
    if cumulative < state.claimed {
        return Err(custom(ERR_BELOW_CLAIMED));
    }
    // A stale lower voucher must not undercut a checkpoint already on the escrow.
    if cumulative < state.attested {
        return Err(custom(ERR_BELOW_ATTESTED));
    }
    if *token_program.key != spl_token::id() {
        return Err(ProgramError::IncorrectProgramId);
    }
    require_meter(&cfg, instructions, &close_voucher_message(program_id, &state.escrow_id, cumulative))?;

    let (vault_pda, _) = Pubkey::find_program_address(&[b"vault", &state.escrow_id], program_id);
    if *vault.key != vault_pda {
        return Err(ProgramError::InvalidSeeds);
    }
    assert_token(payee_token, cfg.mint, cfg.payee)?;
    assert_token(traveler_token, cfg.mint, state.traveler)?;

    let refund_amount = state.deposit - cumulative;
    let unpaid = cumulative - state.claimed;
    let escrow_id = state.escrow_id;
    let bump_seed = [state.bump];
    let signer_seeds: [&[u8]; 3] = [b"escrow", escrow_id.as_ref(), &bump_seed];
    if unpaid > 0 {
        invoke_signed(
            &spl_token::instruction::transfer(
                &spl_token::id(),
                vault.key,
                payee_token.key,
                escrow.key,
                &[],
                unpaid,
            )?,
            &[vault.clone(), payee_token.clone(), escrow.clone(), token_program.clone()],
            &[&signer_seeds],
        )?;
    }
    if refund_amount > 0 {
        invoke_signed(
            &spl_token::instruction::transfer(
                &spl_token::id(),
                vault.key,
                traveler_token.key,
                escrow.key,
                &[],
                refund_amount,
            )?,
            &[vault.clone(), traveler_token.clone(), escrow.clone(), token_program.clone()],
            &[&signer_seeds],
        )?;
    }
    mark_settled(escrow);
    Ok(())
}

fn refund(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let accounts = &mut accounts.iter();
    let payer = next_account_info(accounts)?;
    let config = next_account_info(accounts)?;
    let escrow = next_account_info(accounts)?;
    let vault = next_account_info(accounts)?;
    let payee_token = next_account_info(accounts)?;
    let traveler_token = next_account_info(accounts)?;
    let token_program = next_account_info(accounts)?;

    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let cfg = load_config(program_id, config)?;
    let state = load_escrow(program_id, escrow)?;
    if state.settled {
        return Err(custom(ERR_ALREADY_SETTLED));
    }
    let clock = Clock::get()?;
    let opens_at = state.active_at.checked_add(cfg.timeout).ok_or(ProgramError::InvalidArgument)?;
    if clock.unix_timestamp < opens_at {
        return Err(custom(ERR_TIMEOUT));
    }
    if *token_program.key != spl_token::id() {
        return Err(ProgramError::IncorrectProgramId);
    }
    let (vault_pda, _) = Pubkey::find_program_address(&[b"vault", &state.escrow_id], program_id);
    if *vault.key != vault_pda {
        return Err(ProgramError::InvalidSeeds);
    }
    assert_token(payee_token, cfg.mint, cfg.payee)?;
    assert_token(traveler_token, cfg.mint, state.traveler)?;

    // `attested` is at least `claimed`. The payee receives the part that was
    // recorded but not collected yet; the traveler receives only the rest.
    let pay = state.attested - state.claimed;
    let give_back = state.deposit - state.attested;
    let escrow_id = state.escrow_id;
    let bump_seed = [state.bump];
    let signer_seeds: [&[u8]; 3] = [b"escrow", escrow_id.as_ref(), &bump_seed];
    if pay > 0 {
        invoke_signed(
            &spl_token::instruction::transfer(
                &spl_token::id(),
                vault.key,
                payee_token.key,
                escrow.key,
                &[],
                pay,
            )?,
            &[vault.clone(), payee_token.clone(), escrow.clone(), token_program.clone()],
            &[&signer_seeds],
        )?;
    }
    if give_back > 0 {
        invoke_signed(
            &spl_token::instruction::transfer(
                &spl_token::id(),
                vault.key,
                traveler_token.key,
                escrow.key,
                &[],
                give_back,
            )?,
            &[vault.clone(), traveler_token.clone(), escrow.clone(), token_program.clone()],
            &[&signer_seeds],
        )?;
    }
    mark_settled(escrow);
    Ok(())
}

struct Config {
    payee: Pubkey,
    mint: Pubkey,
    timeout: i64,
    /// Signs cumulative usage vouchers. Not the traveler and not a session key.
    meter: Pubkey,
}

struct Escrow {
    traveler: Pubkey,
    /// Deposit, last top-up or last claim. The refund timeout runs from here.
    active_at: i64,
    deposit: u64,
    settled: bool,
    bump: u8,
    escrow_id: [u8; 32],
    /// All zeros when the deposit registered none.
    session_key: Pubkey,
    /// Already paid to AstroAm by `claim`. Never above `deposit`.
    claimed: u64,
    /// Latest cumulative voucher recorded by `checkpoint` or `claim`.
    /// Never above `deposit`, never below `claimed`.
    attested: u64,
}

fn load_config(program_id: &Pubkey, account: &AccountInfo) -> Result<Config, ProgramError> {
    if account.owner != program_id || account.data_len() < CONFIG_LEN || account.data.borrow()[0] != 2 {
        return Err(custom(ERR_ESCROW_MISSING));
    }
    let raw = account.data.borrow();
    Ok(Config {
        payee: Pubkey::new_from_array(raw[1..33].try_into().unwrap()),
        mint: Pubkey::new_from_array(raw[33..65].try_into().unwrap()),
        timeout: i64::from_le_bytes(raw[65..73].try_into().unwrap()),
        meter: Pubkey::new_from_array(raw[74..106].try_into().unwrap()),
    })
}

fn load_escrow(program_id: &Pubkey, account: &AccountInfo) -> Result<Escrow, ProgramError> {
    if account.owner != program_id || account.data_len() < LEGACY_ESCROW_LEN || account.data.borrow()[0] != 1 {
        return Err(custom(ERR_ESCROW_MISSING));
    }
    let raw = account.data.borrow();
    // A first-layout escrow has no session key and nothing claimed. One that
    // predates `attested` treats the amount already claimed as attested, so a
    // timeout cannot refund USDC the payee has already received.
    let with_claims = raw.len() >= CLAIM_ESCROW_LEN;
    let with_attested = raw.len() >= ESCROW_LEN;
    let mut escrow_id = [0u8; 32];
    escrow_id.copy_from_slice(&raw[51..83]);
    let (expected, bump) = Pubkey::find_program_address(&[b"escrow", &escrow_id], program_id);
    if *account.key != expected || raw[50] != bump {
        return Err(ProgramError::InvalidSeeds);
    }
    let claimed = if with_claims { u64::from_le_bytes(raw[115..123].try_into().unwrap()) } else { 0 };
    let mut attested = if with_attested { u64::from_le_bytes(raw[123..131].try_into().unwrap()) } else { claimed };
    if attested < claimed {
        attested = claimed;
    }
    Ok(Escrow {
        traveler: Pubkey::new_from_array(raw[1..33].try_into().unwrap()),
        active_at: i64::from_le_bytes(raw[33..41].try_into().unwrap()),
        deposit: u64::from_le_bytes(raw[41..49].try_into().unwrap()),
        settled: raw[49] == 1,
        bump,
        escrow_id,
        session_key: if with_claims { Pubkey::new_from_array(raw[83..115].try_into().unwrap()) } else { Pubkey::default() },
        claimed,
        attested,
    })
}

fn write_deposit(account: &AccountInfo, deposit: u64) {
    account.data.borrow_mut()[41..49].copy_from_slice(&deposit.to_le_bytes());
}

fn write_active_at(account: &AccountInfo, at: i64) {
    account.data.borrow_mut()[33..41].copy_from_slice(&at.to_le_bytes());
}

fn write_claimed(account: &AccountInfo, claimed: u64) {
    account.data.borrow_mut()[115..123].copy_from_slice(&claimed.to_le_bytes());
}

fn write_attested(account: &AccountInfo, attested: u64) {
    account.data.borrow_mut()[123..131].copy_from_slice(&attested.to_le_bytes());
}

fn mark_settled(account: &AccountInfo) {
    account.data.borrow_mut()[49] = 1;
}

fn assert_token(account: &AccountInfo, mint: Pubkey, owner: Pubkey) -> ProgramResult {
    if *account.owner != spl_token::id() {
        return Err(custom(ERR_BAD_ACCOUNT));
    }
    let token = TokenAccount::unpack(&account.data.borrow())?;
    if token.mint != mint || token.owner != owner {
        return Err(custom(ERR_BAD_ACCOUNT));
    }
    Ok(())
}

/// The voucher's ed25519 signer must be the meter key in the program config.
fn require_meter(cfg: &Config, instructions: &AccountInfo, expected: &[u8]) -> ProgramResult {
    if *instructions.key != solana_program::sysvar::instructions::ID {
        return Err(ProgramError::InvalidArgument);
    }
    if voucher_signer(instructions, expected)? != cfg.meter {
        return Err(custom(ERR_BAD_VOUCHER));
    }
    Ok(())
}

/// The instruction immediately before `close`, `claim` or `checkpoint` must be
/// an ed25519 verify of the voucher. The precompile already checked the
/// signature; this checks the signed message and returns who signed it.
fn voucher_signer(instructions: &AccountInfo, expected: &[u8]) -> Result<Pubkey, ProgramError> {
    let index = load_current_index_checked(instructions)?;
    if index == 0 {
        return Err(custom(ERR_BAD_VOUCHER));
    }
    let previous = load_instruction_at_checked((index - 1) as usize, instructions)?;
    if previous.program_id != solana_program::ed25519_program::id() {
        return Err(custom(ERR_BAD_VOUCHER));
    }
    let data = previous.data;
    if data.len() < 16 || data[0] != 1 {
        return Err(custom(ERR_BAD_VOUCHER));
    }
    let pubkey_offset = u16::from_le_bytes([data[6], data[7]]) as usize;
    let pubkey_ix = u16::from_le_bytes([data[8], data[9]]);
    let message_offset = u16::from_le_bytes([data[10], data[11]]) as usize;
    let message_size = u16::from_le_bytes([data[12], data[13]]) as usize;
    let message_ix = u16::from_le_bytes([data[14], data[15]]);
    if pubkey_ix != u16::MAX || message_ix != u16::MAX {
        return Err(custom(ERR_BAD_VOUCHER));
    }
    let pubkey_bytes = data.get(pubkey_offset..pubkey_offset + 32).ok_or(custom(ERR_BAD_VOUCHER))?;
    let message = data.get(message_offset..message_offset + message_size).ok_or(custom(ERR_BAD_VOUCHER))?;
    if message != expected {
        return Err(custom(ERR_BAD_VOUCHER));
    }
    let mut raw = [0u8; 32];
    raw.copy_from_slice(pubkey_bytes);
    Ok(Pubkey::new_from_array(raw))
}

fn write_config(config: &AccountInfo, payee: &Pubkey, mint: &Pubkey, timeout: i64, bump: u8, meter: &Pubkey) {
    let mut raw = config.data.borrow_mut();
    raw[0] = 2;
    raw[1..33].copy_from_slice(payee.as_ref());
    raw[33..65].copy_from_slice(mint.as_ref());
    raw[65..73].copy_from_slice(&timeout.to_le_bytes());
    raw[73] = bump;
    raw[74..106].copy_from_slice(meter.as_ref());
}

#[cfg(test)]
mod layout_tests {
    use super::*;

    #[test]
    fn voucher_message_matches_the_shared_fixture() {
        let program = Pubkey::new_from_array([0x11; 32]);
        let escrow_id = [0x22; 32];
        let message = close_voucher_message(&program, &escrow_id, 500_000);
        assert_eq!(VOUCHER_PREFIX.len(), 22);
        assert_eq!(&message[..22], b"AstroAmEscrow:v1:close");
        assert_eq!(&message[22..54], &[0x11; 32]);
        assert_eq!(&message[54..86], &[0x22; 32]);
        assert_eq!(&message[86..94], &500_000u64.to_le_bytes());
        assert_eq!(message.len(), 94);
    }
}
