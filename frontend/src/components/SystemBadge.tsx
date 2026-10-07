import { useMission } from '../hooks/useMission'

const BADGE = 'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-mono font-bold tracking-wider uppercase border'

export default function SystemBadge() {
  const { caps, backendError, isDemoMode } = useMission()

  if (isDemoMode) {
    return (
      <span className={`${BADGE} bg-amber-400/10 border-amber-400/30 text-amber-300`}>
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
        DEMO MODE
      </span>
    )
  }

  if (backendError || !caps || !caps.backendAvailable) {
    return (
      <span className={`${BADGE} bg-alerta/10 border-alerta/30 text-alerta`}>
        <span className="w-1.5 h-1.5 rounded-full bg-alerta" />
        SERVER OFFLINE
      </span>
    )
  }

  if (caps.solanaProgramId) {
    return (
      <span className={`${BADGE} bg-online/10 border-online/30 text-online`}>
        <span className="w-1.5 h-1.5 rounded-full bg-online animate-pulse" />
        SOLANA DEVNET
      </span>
    )
  }

  return (
    <span className={`${BADGE} bg-starlight/10 border-starlight/30 text-starlight`}>
      <span className="w-1.5 h-1.5 rounded-full bg-starlight animate-pulse" />
      PROGRAM NOT SET
    </span>
  )
}
