// EscrowChain: what the backend does on Solana by itself, with its own key.
//
// The traveler signs one deposit. From then on AstroAm's meter key signs
// cumulative usage vouchers, and this port turns them into transactions:
// `checkpoint` records the latest voucher without moving tokens, `claim`
// collects a tranche and leaves the escrow open, `close` collects the rest
// and refunds the traveler, `sweep` moves collected USDC to the treasury
// address (the Bridge liquidation address).
//
// The operator key only pays fees and submits. It cannot name an amount: the
// program pays what the meter voucher says, and only to the payee in its config.
// A traveler or session-key signature is rejected.

import { existsSync, readFileSync } from "node:fs";
import {
  Connection,
  Ed25519Program,
  Keypair,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { SOLANA_RPC_URL, SOLANA_USDC_MINT, SPL_TOKEN_PROGRAM_ID } from "../shared/solana/constants.ts";
import { checkpointData, claimData, closeData, decodeEscrow, type EscrowState, type SignedVoucher } from "../shared/solana/escrow.ts";
import { isSolanaAddress } from "../shared/solana/base58.ts";
import { closeVoucherMessage } from "../shared/solana/voucher.ts";

export type SweepResult = { txHash: string; amountAtomic: bigint };

export interface EscrowChain {
  /** base58 address of the key that pays fees and submits. */
  readonly operator: string;
  /** The escrow account as it is on-chain, or null when it does not exist. */
  readEscrow(escrowId: string): Promise<EscrowState | null>;
  /** Records the voucher on the escrow. Moves no tokens and does not restart the timeout. */
  checkpoint(input: { escrowId: string; voucher: SignedVoucher }): Promise<string>;
  /** Collects the unpaid part of the voucher. Returns the transaction signature. */
  claim(input: { escrowId: string; voucher: SignedVoucher }): Promise<string>;
  /** Collects the rest of the voucher and refunds the traveler. Returns the transaction signature. */
  close(input: { escrowId: string; voucher: SignedVoucher; traveler: string }): Promise<string>;
  /** Sends the payee's USDC to `to` when it holds at least `minAtomic`. Null when it does not. */
  sweep(input: { to: string; minAtomic: bigint }): Promise<SweepResult | null>;
  /** Reads the payee's current USDC Associated Token Account balance on-chain (atomic units). */
  getPayeeBalanceAtomic(): Promise<bigint>;
}

const TOKEN_PROGRAM = new PublicKey(SPL_TOKEN_PROGRAM_ID);
const ASSOCIATED_TOKEN_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

function associatedTokenAddress(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM,
  )[0];
}

/** Creates the owner's USDC account when it does not exist; a no-op when it does. */
function createTokenAccountIdempotent(payer: PublicKey, owner: PublicKey, mint: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: associatedTokenAddress(owner, mint), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

export type SolanaEscrowChainOptions = {
  rpcUrl: string;
  programId: string;
  payee: string;
  usdcMint: string;
  operator: Keypair;
};

export class SolanaEscrowChain implements EscrowChain {
  readonly operator: string;
  private readonly connection: Connection;
  private readonly programId: PublicKey;
  private readonly payee: PublicKey;
  private readonly mint: PublicKey;
  private readonly signer: Keypair;

  constructor(options: SolanaEscrowChainOptions) {
    this.connection = new Connection(options.rpcUrl, "confirmed");
    this.programId = new PublicKey(options.programId);
    this.payee = new PublicKey(options.payee);
    this.mint = new PublicKey(options.usdcMint);
    this.signer = options.operator;
    this.operator = options.operator.publicKey.toBase58();
  }

  private pdas(escrowId: string) {
    const id = new PublicKey(escrowId).toBuffer();
    const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], this.programId);
    const [escrow] = PublicKey.findProgramAddressSync([Buffer.from("escrow"), id], this.programId);
    const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), id], this.programId);
    return { config, escrow, vault };
  }

  /** The ed25519 check the program reads from the instruction right before its own. */
  private voucherCheck(escrowId: string, voucher: SignedVoucher): TransactionInstruction {
    const message = closeVoucherMessage(
      this.programId.toBytes(),
      new PublicKey(escrowId).toBytes(),
      BigInt(voucher.cumulativeAtomic),
    );
    return Ed25519Program.createInstructionWithPublicKey({
      publicKey: new PublicKey(voucher.signer).toBytes(),
      message,
      signature: Buffer.from(voucher.signature, "base64"),
    });
  }

  private send(instructions: TransactionInstruction[]): Promise<string> {
    return sendAndConfirmTransaction(this.connection, new Transaction().add(...instructions), [this.signer]);
  }

  async readEscrow(escrowId: string): Promise<EscrowState | null> {
    const account = await this.connection.getAccountInfo(this.pdas(escrowId).escrow);
    if (!account || !account.owner.equals(this.programId)) return null;
    return decodeEscrow(account.data);
  }

  async checkpoint(input: { escrowId: string; voucher: SignedVoucher }): Promise<string> {
    return this.send(this.checkpointInstructions(input));
  }

  /** The `checkpoint` transaction. The ed25519 check is the instruction immediately before it. */
  checkpointInstructions(input: { escrowId: string; voucher: SignedVoucher }): TransactionInstruction[] {
    const { config, escrow } = this.pdas(input.escrowId);
    const operator = this.signer.publicKey;
    return [
      this.voucherCheck(input.escrowId, input.voucher),
      new TransactionInstruction({
        programId: this.programId,
        keys: [
          { pubkey: operator, isSigner: true, isWritable: true },
          { pubkey: config, isSigner: false, isWritable: false },
          { pubkey: escrow, isSigner: false, isWritable: true },
          { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
        ],
        data: Buffer.from(checkpointData(BigInt(input.voucher.cumulativeAtomic))),
      }),
    ];
  }

  async claim(input: { escrowId: string; voucher: SignedVoucher }): Promise<string> {
    return this.send(this.claimInstructions(input));
  }

  /** The `claim` transaction. The program tests run these exact instructions (see EscrowChain.test.ts). */
  claimInstructions(input: { escrowId: string; voucher: SignedVoucher }): TransactionInstruction[] {
    const { config, escrow, vault } = this.pdas(input.escrowId);
    const operator = this.signer.publicKey;
    return [
      createTokenAccountIdempotent(operator, this.payee, this.mint),
      this.voucherCheck(input.escrowId, input.voucher),
      new TransactionInstruction({
        programId: this.programId,
        keys: [
          { pubkey: operator, isSigner: true, isWritable: true },
          { pubkey: config, isSigner: false, isWritable: false },
          { pubkey: escrow, isSigner: false, isWritable: true },
          { pubkey: vault, isSigner: false, isWritable: true },
          { pubkey: associatedTokenAddress(this.payee, this.mint), isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
          { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
        ],
        data: Buffer.from(claimData(BigInt(input.voucher.cumulativeAtomic))),
      }),
    ];
  }

  async close(input: { escrowId: string; voucher: SignedVoucher; traveler: string }): Promise<string> {
    return this.send(this.closeInstructions(input));
  }

  /** The `close` transaction. The program tests run these exact instructions (see EscrowChain.test.ts). */
  closeInstructions(input: { escrowId: string; voucher: SignedVoucher; traveler: string }): TransactionInstruction[] {
    const { config, escrow, vault } = this.pdas(input.escrowId);
    const operator = this.signer.publicKey;
    const traveler = new PublicKey(input.traveler);
    return [
      createTokenAccountIdempotent(operator, this.payee, this.mint),
      // The refund needs the traveler's USDC account; they may have closed it since the deposit.
      createTokenAccountIdempotent(operator, traveler, this.mint),
      this.voucherCheck(input.escrowId, input.voucher),
      new TransactionInstruction({
        programId: this.programId,
        keys: [
          { pubkey: operator, isSigner: true, isWritable: true },
          { pubkey: config, isSigner: false, isWritable: false },
          { pubkey: escrow, isSigner: false, isWritable: true },
          { pubkey: vault, isSigner: false, isWritable: true },
          { pubkey: associatedTokenAddress(this.payee, this.mint), isSigner: false, isWritable: true },
          { pubkey: associatedTokenAddress(traveler, this.mint), isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
          { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
        ],
        data: Buffer.from(closeData(BigInt(input.voucher.cumulativeAtomic))),
      }),
    ];
  }

  async sweep(input: { to: string; minAtomic: bigint }): Promise<SweepResult | null> {
    const operator = this.signer.publicKey;
    if (!operator.equals(this.payee)) {
      throw new Error("the operator key is not the payee, so it cannot move the collected USDC");
    }
    const source = associatedTokenAddress(this.payee, this.mint);
    if ((await this.connection.getAccountInfo(source)) === null) return null;
    const balance = BigInt((await this.connection.getTokenAccountBalance(source)).value.amount);
    if (balance === 0n || balance < input.minAtomic) return null;

    const to = new PublicKey(input.to);
    const amount = Buffer.alloc(9);
    amount[0] = 3; // SPL Token `Transfer`
    amount.writeBigUInt64LE(balance, 1);
    const txHash = await this.send([
      createTokenAccountIdempotent(operator, to, this.mint),
      new TransactionInstruction({
        programId: TOKEN_PROGRAM,
        keys: [
          { pubkey: source, isSigner: false, isWritable: true },
          { pubkey: associatedTokenAddress(to, this.mint), isSigner: false, isWritable: true },
          { pubkey: operator, isSigner: true, isWritable: false },
        ],
        data: amount,
      }),
    ]);
    return { txHash, amountAtomic: balance };
  }

  async getPayeeBalanceAtomic(): Promise<bigint> {
    const source = associatedTokenAddress(this.payee, this.mint);
    const info = await this.connection.getAccountInfo(source);
    if (info === null) return 0n;
    const balance = await this.connection.getTokenAccountBalance(source);
    if (!balance || !balance.value || !balance.value.amount) return 0n;
    return BigInt(balance.value.amount);
  }
}

/** A solana-keygen secret: a JSON array of 64 bytes. The value is never logged. */
export function keypairFromBytes(bytes: unknown, label: string): Keypair {
  if (!Array.isArray(bytes) || bytes.length !== 64 || bytes.some((n) => !Number.isInteger(n) || (n as number) < 0 || (n as number) > 255)) {
    throw new Error(`${label}: expected the JSON array of 64 bytes that solana-keygen writes`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(bytes as number[]));
}

/** Reads a keypair file in the `solana-keygen` format. */
export function loadKeypair(path: string, label = "SOLANA_OPERATOR_KEYPAIR"): Keypair {
  if (!existsSync(path)) throw new Error(`${label}: no file at ${path}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`${label}: file is not JSON`);
  }
  return keypairFromBytes(parsed, label);
}

/** Same bytes as a keypair file, passed as an environment variable on a host that has no secret file. */
export function keypairFromJsonEnv(raw: string, label: string): Keypair {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${label}: value is not JSON`);
  }
  return keypairFromBytes(parsed, label);
}

/**
 * The chain the backend acts on, or undefined when it is not configured:
 * it needs the deployed program, its payee and `SOLANA_OPERATOR_KEYPAIR`.
 * Throws when the keypair is set but cannot be read.
 */
export function createEscrowChain(env: Record<string, string | undefined>): EscrowChain | undefined {
  const keypairJson = env.SOLANA_OPERATOR_KEYPAIR_JSON?.trim();
  const keypairPath = env.SOLANA_OPERATOR_KEYPAIR?.trim();
  const programId = env.SOLANA_PROGRAM_ID?.trim();
  const payee = env.SOLANA_PAYEE_ADDRESS?.trim();
  if ((!keypairJson && !keypairPath) || !isSolanaAddress(programId) || !isSolanaAddress(payee)) return undefined;
  const operator = keypairJson
    ? keypairFromJsonEnv(keypairJson, "SOLANA_OPERATOR_KEYPAIR_JSON")
    : loadKeypair(keypairPath!, "SOLANA_OPERATOR_KEYPAIR");
  return new SolanaEscrowChain({
    rpcUrl: env.SOLANA_RPC_URL?.trim() || SOLANA_RPC_URL,
    programId: programId!,
    payee: payee!,
    usdcMint: SOLANA_USDC_MINT,
    operator,
  });
}
