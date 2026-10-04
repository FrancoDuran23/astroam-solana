// Solana wallet flow for the devnet escrow.
//
// Phantom or Solflare (window.phantom.solana / window.solflare). The traveler
// deposits Circle devnet USDC once. Usage stays off-chain. One close, signed
// by that same wallet, pays AstroAm the used amount and refunds the rest.
// A timeout refund returns the full deposit if AstroAm never closes.

import { Buffer } from 'buffer'
import {
  Connection,
  Ed25519Program,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js'
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddress,
} from '@solana/spl-token'
import type { SolanaClosePlan, SolanaDepositPlan } from '../types/mission'

const TAG_DEPOSIT = 1
const TAG_TOP_UP = 2
const TAG_CLOSE = 3
const TAG_REFUND = 4

type SolanaProvider = {
  isPhantom?: boolean
  isSolflare?: boolean
  publicKey: PublicKey | null
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: PublicKey }>
  signTransaction: (tx: Transaction) => Promise<Transaction>
  signMessage: (message: Uint8Array, display?: string) => Promise<{ signature: Uint8Array } | Uint8Array>
}

declare global {
  interface Window {
    phantom?: { solana?: SolanaProvider }
    solflare?: SolanaProvider
  }
}

type PayerRecord = { address: string; rpcUrl: string; mint: string }

const payerKey = (missionId: string) => `astroam_solana_payer_${missionId}`

export type DepositProgress = 'connecting' | 'depositing' | 'confirming'

export function walletError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function provider(): SolanaProvider {
  const phantom = window.phantom?.solana
  if (phantom?.isPhantom) return phantom
  const solflare = window.solflare
  if (solflare?.isSolflare) return solflare
  throw new Error('No Solana wallet found. Install Phantom or Solflare and switch it to Devnet.')
}

function connectionFor(rpcUrl: string): Connection {
  return new Connection(rpcUrl, 'confirmed')
}

function u64(value: bigint): Buffer {
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64LE(value)
  return buf
}

function escrowSeeds(escrowId: string): Buffer {
  return Buffer.from(new PublicKey(escrowId).toBytes())
}

function pdas(programId: PublicKey, escrowId: string) {
  const id = escrowSeeds(escrowId)
  const [config] = PublicKey.findProgramAddressSync([Buffer.from('config')], programId)
  const [escrow] = PublicKey.findProgramAddressSync([Buffer.from('escrow'), id], programId)
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from('vault'), id], programId)
  return { config, escrow, vault }
}

function requireDeployed(plan: SolanaDepositPlan): { programId: PublicKey; payee: PublicKey } {
  if (!plan.programId || !plan.payee || !plan.deployed) {
    throw new Error('The escrow is not deployed. Run npm run solana:deploy and set SOLANA_PROGRAM_ID and SOLANA_PAYEE_ADDRESS.')
  }
  return { programId: new PublicKey(plan.programId), payee: new PublicKey(plan.payee) }
}

function rememberPayer(missionId: string, record: PayerRecord): void {
  localStorage.setItem(payerKey(missionId), JSON.stringify(record))
}

export function rememberedPayer(missionId: string): string | undefined {
  try {
    const raw = localStorage.getItem(payerKey(missionId))
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as PayerRecord
    return parsed.address
  } catch {
    return undefined
  }
}

async function sendTransaction(rpcUrl: string, tx: Transaction): Promise<string> {
  const wallet = provider()
  if (!wallet.publicKey) await wallet.connect()
  const traveler = wallet.publicKey
  if (!traveler) throw new Error('The wallet did not return an account.')
  const connection = connectionFor(rpcUrl)
  const lamports = await connection.getBalance(traveler)
  if (lamports === 0) {
    throw new Error('This wallet has no SOL for fees on Solana devnet. Get some at faucet.solana.com.')
  }
  tx.feePayer = traveler
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
  tx.recentBlockhash = blockhash
  const signed = await wallet.signTransaction(tx)
  const signature = await connection.sendRawTransaction(signed.serialize())
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')
  return signature
}

export async function sendDeposit(
  missionId: string,
  plan: SolanaDepositPlan,
  method: 'deposit' | 'topUp',
  onProgress?: (step: DepositProgress) => void,
): Promise<string> {
  onProgress?.('connecting')
  const { programId } = requireDeployed(plan)
  const wallet = provider()
  if (!wallet.publicKey) await wallet.connect()
  const traveler = wallet.publicKey
  if (!traveler) throw new Error('The wallet did not return an account.')
  rememberPayer(missionId, { address: traveler.toBase58(), rpcUrl: plan.rpcUrl, mint: plan.usdcMint })

  const connection = connectionFor(plan.rpcUrl)
  const mint = new PublicKey(plan.usdcMint)
  const travelerAta = await getAssociatedTokenAddress(mint, traveler)
  const ata = await connection.getAccountInfo(travelerAta)
  const needed = BigInt(plan.amount)
  if (!ata) {
    throw new Error(`This wallet has no USDC account on Solana devnet. Get test USDC at faucet.circle.com (mint ${plan.usdcMint}).`)
  }
  const balance = await connection.getTokenAccountBalance(travelerAta)
  if (BigInt(balance.value.amount) < needed) {
    throw new Error(
      `This wallet has ${balance.value.uiAmountString ?? '0'} USDC on Solana devnet; the transfer needs ${plan.amountUsdc}. Get test USDC at faucet.circle.com.`,
    )
  }

  onProgress?.('depositing')
  const { config, escrow, vault } = pdas(programId, plan.escrowId)
  const data =
    method === 'deposit'
      ? Buffer.concat([Buffer.from([TAG_DEPOSIT]), escrowSeeds(plan.escrowId), u64(needed)])
      : Buffer.concat([Buffer.from([TAG_TOP_UP]), u64(needed)])
  const keys =
    method === 'deposit'
      ? [
          { pubkey: traveler, isSigner: true, isWritable: true },
          { pubkey: config, isSigner: false, isWritable: false },
          { pubkey: escrow, isSigner: false, isWritable: true },
          { pubkey: vault, isSigner: false, isWritable: true },
          { pubkey: travelerAta, isSigner: false, isWritable: true },
          { pubkey: mint, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ]
      : [
          { pubkey: traveler, isSigner: true, isWritable: true },
          { pubkey: config, isSigner: false, isWritable: false },
          { pubkey: escrow, isSigner: false, isWritable: true },
          { pubkey: vault, isSigner: false, isWritable: true },
          { pubkey: travelerAta, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ]
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(traveler, travelerAta, traveler, mint),
    new TransactionInstruction({ programId, keys, data }),
  )
  onProgress?.('confirming')
  return sendTransaction(plan.rpcUrl, tx)
}

/** USDC in the traveler wallet that paid this trip. Null if this browser never deposited. */
export async function readTravelerUsdc(missionId: string): Promise<{ address: string; usdc: number } | null> {
  const raw = localStorage.getItem(payerKey(missionId))
  if (!raw) return null
  const record = JSON.parse(raw) as PayerRecord
  const owner = new PublicKey(record.address)
  const mint = new PublicKey(record.mint)
  const ata = await getAssociatedTokenAddress(mint, owner)
  const connection = connectionFor(record.rpcUrl)
  const account = await connection.getAccountInfo(ata)
  if (!account) return { address: record.address, usdc: 0 }
  const balance = await connection.getTokenAccountBalance(ata)
  return { address: record.address, usdc: Number(balance.value.uiAmount ?? 0) }
}

function signatureBytes(signed: { signature: Uint8Array } | Uint8Array): Uint8Array {
  const raw = signed instanceof Uint8Array ? signed : signed.signature
  if (raw.length !== 64) throw new Error('The wallet did not return a 64-byte ed25519 signature.')
  return raw
}

export async function closeEscrow(plan: SolanaClosePlan): Promise<string> {
  const { programId, payee } = requireDeployed(plan)
  if (!plan.messageBase64) {
    throw new Error('The escrow is not deployed, so there is no voucher to sign.')
  }
  const wallet = provider()
  if (!wallet.publicKey) await wallet.connect()
  const traveler = wallet.publicKey
  if (!traveler) throw new Error('The wallet did not return an account.')
  const message = Uint8Array.from(Buffer.from(plan.messageBase64, 'base64'))
  const signature = signatureBytes(await wallet.signMessage(message, 'utf8'))
  const mint = new PublicKey(plan.usdcMint)
  const travelerAta = await getAssociatedTokenAddress(mint, traveler)
  const payeeAta = await getAssociatedTokenAddress(mint, payee)
  const { config, escrow, vault } = pdas(programId, plan.escrowId)
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(traveler, payeeAta, payee, mint),
    Ed25519Program.createInstructionWithPublicKey({
      publicKey: traveler.toBytes(),
      message,
      signature,
    }),
    new TransactionInstruction({
      programId,
      keys: [
        { pubkey: traveler, isSigner: true, isWritable: true },
        { pubkey: config, isSigner: false, isWritable: false },
        { pubkey: escrow, isSigner: false, isWritable: true },
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: payeeAta, isSigner: false, isWritable: true },
        { pubkey: travelerAta, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([Buffer.from([TAG_CLOSE]), u64(BigInt(plan.cumulativeAmount))]),
    }),
  )
  return sendTransaction(plan.rpcUrl, tx)
}

export async function refundEscrow(plan: {
  rpcUrl: string
  programId: string
  usdcMint: string
  escrowId: string
}): Promise<string> {
  const programId = new PublicKey(plan.programId)
  const wallet = provider()
  if (!wallet.publicKey) await wallet.connect()
  const traveler = wallet.publicKey
  if (!traveler) throw new Error('The wallet did not return an account.')
  const mint = new PublicKey(plan.usdcMint)
  const travelerAta = await getAssociatedTokenAddress(mint, traveler)
  const { config, escrow, vault } = pdas(programId, plan.escrowId)
  const tx = new Transaction().add(
    new TransactionInstruction({
      programId,
      keys: [
        { pubkey: traveler, isSigner: true, isWritable: true },
        { pubkey: config, isSigner: false, isWritable: false },
        { pubkey: escrow, isSigner: false, isWritable: true },
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: travelerAta, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([TAG_REFUND]),
    }),
  )
  return sendTransaction(plan.rpcUrl, tx)
}
