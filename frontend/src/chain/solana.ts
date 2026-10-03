import { Buffer } from 'buffer'
import {
  Connection,
  Ed25519Program,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type TransactionSignature,
} from '@solana/web3.js'
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddress,
} from '@solana/spl-token'
import type { SolanaClosePlan, SolanaDepositPlan } from '../types/mission'

export const SOLANA_USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
export const SOLANA_EXPLORER = 'https://explorer.solana.com'

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

export function solanaTxUrl(signature: string): string {
  return `${SOLANA_EXPLORER}/tx/${signature}?cluster=devnet`
}

export function walletError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function provider(): SolanaProvider {
  const phantom = window.phantom?.solana
  if (phantom?.isPhantom) return phantom
  const solflare = window.solflare
  if (solflare?.isSolflare) return solflare
  throw new Error('No hay una wallet Solana. Instalá Phantom o Solflare y elegí Devnet.')
}

export async function connectSolanaWallet(): Promise<string> {
  const wallet = provider()
  const connected = wallet.publicKey ?? (await wallet.connect()).publicKey
  return connected.toBase58()
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

async function sendTransaction(rpcUrl: string, tx: Transaction): Promise<{ signature: TransactionSignature; traveler: string }> {
  const wallet = provider()
  if (!wallet.publicKey) await wallet.connect()
  const traveler = wallet.publicKey
  if (!traveler) throw new Error('La wallet no devolvió una cuenta.')
  const connection = connectionFor(rpcUrl)
  tx.feePayer = traveler
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
  tx.recentBlockhash = blockhash
  const signed = await wallet.signTransaction(tx)
  const signature = await connection.sendRawTransaction(signed.serialize())
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')
  return { signature, traveler: traveler.toBase58() }
}

function requireDeployed(plan: SolanaDepositPlan): { programId: PublicKey; payee: PublicKey } {
  if (!plan.programId || !plan.payee || !plan.deployed) {
    throw new Error('El escrow no está desplegado. Corré npm run solana:deploy y configurá SOLANA_PROGRAM_ID y SOLANA_PAYEE_ADDRESS.')
  }
  return { programId: new PublicKey(plan.programId), payee: new PublicKey(plan.payee) }
}

export async function depositUsdc(plan: SolanaDepositPlan): Promise<{ signature: string; traveler: string }> {
  const { programId } = requireDeployed(plan)
  const wallet = provider()
  if (!wallet.publicKey) await wallet.connect()
  const traveler = wallet.publicKey!
  const mint = new PublicKey(plan.usdcMint)
  const travelerAta = await getAssociatedTokenAddress(mint, traveler)
  const { config, escrow, vault } = pdas(programId, plan.escrowId)
  const data = Buffer.concat([Buffer.from([TAG_DEPOSIT]), escrowSeeds(plan.escrowId), u64(BigInt(plan.amount))])
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(traveler, travelerAta, traveler, mint),
    new TransactionInstruction({
      programId,
      keys: [
        { pubkey: traveler, isSigner: true, isWritable: true },
        { pubkey: config, isSigner: false, isWritable: false },
        { pubkey: escrow, isSigner: false, isWritable: true },
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: travelerAta, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    }),
  )
  return sendTransaction(plan.rpcUrl, tx)
}

export async function topUpUsdc(plan: SolanaDepositPlan): Promise<{ signature: string; traveler: string }> {
  const { programId } = requireDeployed(plan)
  const wallet = provider()
  if (!wallet.publicKey) await wallet.connect()
  const traveler = wallet.publicKey!
  const mint = new PublicKey(plan.usdcMint)
  const travelerAta = await getAssociatedTokenAddress(mint, traveler)
  const { config, escrow, vault } = pdas(programId, plan.escrowId)
  const data = Buffer.concat([Buffer.from([TAG_TOP_UP]), u64(BigInt(plan.amount))])
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(traveler, travelerAta, traveler, mint),
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
      data,
    }),
  )
  return sendTransaction(plan.rpcUrl, tx)
}

function signatureBytes(signed: { signature: Uint8Array } | Uint8Array): Uint8Array {
  const raw = signed instanceof Uint8Array ? signed : signed.signature
  if (raw.length !== 64) throw new Error('La wallet no devolvió una firma ed25519 de 64 bytes.')
  return raw
}

export async function closeEscrow(plan: SolanaClosePlan): Promise<string> {
  const { programId, payee } = requireDeployed(plan)
  if (!plan.messageBase64) {
    throw new Error('El escrow no está desplegado. Corré npm run solana:deploy y configurá SOLANA_PROGRAM_ID.')
  }
  const wallet = provider()
  if (!wallet.publicKey) await wallet.connect()
  const traveler = wallet.publicKey!
  const message = Uint8Array.from(Buffer.from(plan.messageBase64, 'base64'))
  const signature = signatureBytes(await wallet.signMessage(message, 'utf8'))
  const mint = new PublicKey(plan.usdcMint)
  const travelerAta = await getAssociatedTokenAddress(mint, traveler)
  const payeeAta = await getAssociatedTokenAddress(mint, payee)
  const { config, escrow, vault } = pdas(programId, plan.escrowId)
  const data = Buffer.concat([Buffer.from([TAG_CLOSE]), u64(BigInt(plan.cumulativeAmount))])
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
      data,
    }),
  )
  const sent = await sendTransaction(plan.rpcUrl, tx)
  return sent.signature
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
  const traveler = wallet.publicKey!
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
  const sent = await sendTransaction(plan.rpcUrl, tx)
  return sent.signature
}
