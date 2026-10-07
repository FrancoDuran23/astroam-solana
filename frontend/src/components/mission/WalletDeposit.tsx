import { useState } from 'react'
import type { DepositProgress } from '../../chain/solana'
import type { SolanaDepositPlan } from '../../types/mission'

const STEP_LABEL: Record<DepositProgress, string> = {
  connecting: 'Connecting wallet…',
  depositing: 'Confirm the transfer in your wallet…',
  confirming: 'Waiting for Solana devnet…',
}

type Props = {
  missionId: string
  plan: SolanaDepositPlan
  method?: 'deposit' | 'topUp'
  onDeposited: (txHash: string) => Promise<void>
  label: string
}

/**
 * Pays a deposit or top-up from Phantom or another Wallet Standard wallet on Solana devnet.
 * One USDC transfer into the trip escrow. Usage is not debited per MB.
 */
export default function WalletDeposit({ missionId, plan, method = 'deposit', onDeposited, label }: Props) {
  const [step, setStep] = useState<DepositProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function pay() {
    setError(null)
    const { sendDeposit, walletError } = await import('../../chain/solana')
    try {
      const hash = await sendDeposit(missionId, plan, method, setStep)
      setStep('confirming')
      await onDeposited(hash)
    } catch (e) {
      setError(walletError(e))
    } finally {
      setStep(null)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col gap-2 rounded-2xl border border-cardborder bg-warmneutral p-4 text-sm text-textsecondary">
        <li className="flex gap-2">
          <span className="font-mono font-bold text-tealbrand">1</span>
          Connect Phantom (or another Wallet Standard wallet) on Solana Devnet
        </li>
        <li className="flex gap-2">
          <span className="font-mono font-bold text-tealbrand">2</span>
          {method === 'deposit'
            ? `Deposit ${plan.amountUsdc} USDC into your trip escrow`
            : `Add ${plan.amountUsdc} USDC to the same escrow`}
        </li>
        <li className="flex gap-2">
          <span className="font-mono font-bold text-tealbrand">3</span>
          Usage stays off-chain. One close pays what you used and sends the rest back
        </li>
      </ol>

      <p className="rounded-xl border border-starlight/40 bg-starlight/10 p-3 text-sm text-starlight">
        Pay with Phantom or another Wallet Standard wallet on Devnet. Test USDC is Circle&apos;s mint ({plan.usdcMint.slice(0, 6)}…), from faucet.circle.com. SOL for fees comes from faucet.solana.com.
      </p>

      <button type="button" onClick={() => void pay()} disabled={step !== null} className="w-full py-3.5 rounded-full bg-primaryviolet text-white font-sans font-bold text-sm uppercase tracking-wider shadow-[0_0_24px_rgba(123,92,255,0.55)] hover:bg-primaryviolet-hover disabled:opacity-50 transition-all flex items-center justify-center gap-2 min-h-[48px]">
        <span className="material-symbols-outlined text-[20px]">account_balance_wallet</span>
        {step ? STEP_LABEL[step] : label}
      </button>

      {plan.programId && (
        <a
          href={`${plan.explorer}/address/${plan.programId}?cluster=devnet`}
          target="_blank"
          rel="noreferrer"
          className="text-center font-mono text-[11px] text-textsecondary hover:text-[#B9A6FF]"
        >
          Escrow program {plan.programId.slice(0, 6)}…{plan.programId.slice(-4)} ↗
        </a>
      )}

      {error && (
        <p role="alert" className="rounded-xl border border-alerta/30 bg-alerta/10 p-3 font-mono text-xs text-alerta">
          {error}
        </p>
      )}
    </div>
  )
}
