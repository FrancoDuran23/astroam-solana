// Solana wallet flow for the devnet escrow.
//
// A real wallet only: Wallet Standard first (Phantom and other extensions
// register this way), then the injected Phantom or Solflare provider. There
// is no mock wallet on this path. The dev-only mock used by the headless
// recorder lives in docs/demo/recording and is not imported here.
//
// The traveler deposits Circle devnet USDC once. Usage stays off-chain. One
// close pays AstroAm the attested amount and refunds the rest. The voucher
// is signed by AstroAm's meter key; this wallet only submits the transaction.
// A timeout refund pays that attested amount to the payee and returns the rest.

import { Buffer } from 'buffer'
import { getWallets } from '@wallet-standard/app'
import type { Wallet, WalletAccount } from '@wallet-standard/base'
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

/** Same bytes as `VOUCHER_PREFIX` in programs/astroam-escrow/src/lib.rs. */
const VOUCHER_PREFIX = 'AstroAmEscrow:v1:close'

/** The bytes a voucher signs: prefix, program id, escrow id and the cumulative amount. */
export function voucherMessage(programId: string, escrowId: string, cumulativeAtomic: bigint): Uint8Array {
  return Uint8Array.from(
    Buffer.concat([
      Buffer.from(VOUCHER_PREFIX, 'utf8'),
      new PublicKey(programId).toBuffer(),
      new PublicKey(escrowId).toBuffer(),
      u64(cumulativeAtomic),
    ]),
  )
}

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

const NO_WALLET = 'No Solana wallet found. Install Phantom, or another Wallet Standard wallet, and switch it to Devnet.'
const DEVNET_CHAIN = 'solana:devnet'

type SignTransactionFeature = {
  signTransaction: (
    ...inputs: { account: WalletAccount; transaction: Uint8Array; chain?: string }[]
  ) => Promise<{ signedTransaction: Uint8Array }[]>
}

type ConnectedWallet = {
  publicKey: PublicKey
  signTransaction: (tx: Transaction) => Promise<Transaction>
}

let connected: ConnectedWallet | null = null

if (typeof window !== 'undefined') {
  // Tells installed wallets the app is ready to register them.
  getWallets()
}

function signFeature(wallet: Wallet): SignTransactionFeature | null {
  const feature = (wallet.features as Record<string, { signTransaction?: unknown }>)['solana:signTransaction']
  if (!feature || typeof feature.signTransaction !== 'function') return null
  return feature as SignTransactionFeature
}

function solanaAccount(accounts: readonly WalletAccount[]): WalletAccount | undefined {
  return (
    accounts.find((account) => account.chains.includes(DEVNET_CHAIN)) ??
    accounts.find((account) => account.chains.some((chain) => chain.startsWith('solana:')))
  )
}

function walletRank(wallet: Wallet): number {
  const name = wallet.name.toLowerCase()
  if (name.includes('phantom')) return 3
  if (name.includes('solflare')) return 2
  if (wallet.chains.some((chain) => chain.startsWith('solana:'))) return 1
  return 0
}

async function connectStandard(): Promise<ConnectedWallet | null> {
  if (typeof window === 'undefined') return null
  const wallets = getWallets()
    .get()
    .filter((wallet) => signFeature(wallet) !== null)
    .sort((a, b) => walletRank(b) - walletRank(a))
  for (const wallet of wallets) {
    const connect = (
      wallet.features as Record<string, { connect?: () => Promise<{ accounts: readonly WalletAccount[] }> }>
    )['standard:connect']?.connect
    let accounts = wallet.accounts
    if (solanaAccount(accounts) === undefined && connect) {
      try {
        accounts = (await connect()).accounts
      } catch {
        continue
      }
    }
    const account = solanaAccount(accounts)
    const feature = signFeature(wallet)
    if (!account || !feature) continue
    const publicKey = new PublicKey(account.publicKey)
    return {
      publicKey,
      async signTransaction(tx) {
        const wire = tx.serialize({ requireAllSignatures: false, verifySignatures: false })
        const [signed] = await feature.signTransaction({ account, transaction: wire, chain: DEVNET_CHAIN })
        if (!signed?.signedTransaction) throw new Error('The wallet did not return a signed transaction.')
        return Transaction.from(signed.signedTransaction)
      },
    }
  }
  return null
}

function injectedProvider(): SolanaProvider | null {
  const phantom = window.phantom?.solana
  if (phantom?.isPhantom) return phantom
  const solflare = window.solflare
  if (solflare?.isSolflare) return solflare
  return null
}

/** Connects a real wallet. Never falls back to a mock. */
async function connectWallet(): Promise<ConnectedWallet> {
  if (connected) return connected
  const standard = await connectStandard()
  if (standard) {
    connected = standard
    return standard
  }
  const injected = injectedProvider()
  if (!injected) throw new Error(NO_WALLET)
  if (!injected.publicKey) await injected.connect()
  const publicKey = injected.publicKey
  if (!publicKey) throw new Error('The wallet did not return an account.')
  connected = {
    publicKey,
    signTransaction: (tx) => injected.signTransaction(tx),
  }
  return connected
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
  const wallet = await connectWallet()
  const traveler = wallet.publicKey
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
  const wallet = await connectWallet()
  const traveler = wallet.publicKey
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
  // The deposit may register a session key. It does not sign vouchers.
  let sessionKey: Buffer = Buffer.alloc(0)
  if (method === 'deposit' && plan.sessionKeys) {
    try {
      const { createSessionKey } = await import('./session')
      sessionKey = new PublicKey(await createSessionKey(missionId)).toBuffer()
    } catch {
      // No Ed25519 in this browser's WebCrypto: deposit without a session key.
    }
  }
  const data =
    method === 'deposit'
      ? Buffer.concat([Buffer.from([TAG_DEPOSIT]), escrowSeeds(plan.escrowId), u64(needed), sessionKey])
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

/**
 * Sends the close from the wallet. `voucher` must already be signed by
 * AstroAm's meter key. The wallet approves the transaction and does not sign
 * the amount.
 */
export async function closeEscrow(plan: SolanaClosePlan, voucher: { signature: Uint8Array; signer: string }): Promise<string> {
  const { programId, payee } = requireDeployed(plan)
  if (!voucher?.signature || !voucher.signer) {
    throw new Error("This close needs a voucher signed by AstroAm's meter key.")
  }
  if (!plan.messageBase64) {
    throw new Error('The escrow is not deployed, so there is no voucher to sign.')
  }
  const wallet = await connectWallet()
  const traveler = wallet.publicKey
  const message = Uint8Array.from(Buffer.from(plan.messageBase64, 'base64'))
  const signature = voucher.signature
  const voucherSigner = new PublicKey(voucher.signer)
  const mint = new PublicKey(plan.usdcMint)
  const travelerAta = await getAssociatedTokenAddress(mint, traveler)
  const payeeAta = await getAssociatedTokenAddress(mint, payee)
  const { config, escrow, vault } = pdas(programId, plan.escrowId)
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(traveler, payeeAta, payee, mint),
    Ed25519Program.createInstructionWithPublicKey({
      publicKey: voucherSigner.toBytes(),
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
  payee: string
}): Promise<string> {
  const programId = new PublicKey(plan.programId)
  const wallet = await connectWallet()
  const traveler = wallet.publicKey
  const mint = new PublicKey(plan.usdcMint)
  const payee = new PublicKey(plan.payee)
  const travelerAta = await getAssociatedTokenAddress(mint, traveler)
  const payeeAta = await getAssociatedTokenAddress(mint, payee)
  const { config, escrow, vault } = pdas(programId, plan.escrowId)
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(traveler, payeeAta, payee, mint),
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
      ],
      data: Buffer.from([TAG_REFUND]),
    }),
  )
  return sendTransaction(plan.rpcUrl, tx)
}
