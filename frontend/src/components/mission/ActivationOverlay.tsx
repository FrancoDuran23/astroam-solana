import { useEffect, useState } from 'react'
import shipSrc from '../../assets/ship-night.png'
import StarfieldBackground from '../StarfieldBackground'
import type { ActivationStep } from '../../types/mission'

function stepsFor(simulated: boolean): ActivationStep[] {
  const tag = simulated ? ' (simulated)' : ''
  return [
    { label: `Deposit confirmed${tag}`, status: 'pending' },
    { label: `Payment channel opened${tag}`, status: 'pending' },
    { label: 'Provisioning the eSIM profile', status: 'pending' },
    { label: 'Mission ready', status: 'pending' },
  ]
}

type Props = {
  onComplete: () => void
  /** Payments are simulated (no real chain behind them). */
  simulated?: boolean
}

export default function ActivationOverlay({ onComplete, simulated = true }: Props) {
  const [steps, setSteps] = useState<ActivationStep[]>(() => stepsFor(simulated))
  const [currentStep, setCurrentStep] = useState(0)
  const [done, setDone] = useState(false)
  const total = steps.length

  useEffect(() => {
    let idx = 0
    const timers: ReturnType<typeof setTimeout>[] = []

    function advance() {
      if (idx >= total) {
        setDone(true)
        timers.push(setTimeout(onComplete, 700))
        return
      }

      setCurrentStep(idx)
      setSteps((prev) => prev.map((s, i) => ({ ...s, status: i < idx ? 'done' : i === idx ? 'running' : 'pending' })))

      timers.push(
        setTimeout(() => {
          setSteps((prev) => prev.map((s, i) => ({ ...s, status: i <= idx ? 'done' : s.status })))
          idx++
          timers.push(setTimeout(advance, 300))
        }, 900),
      )
    }

    timers.push(setTimeout(advance, 400))
    return () => timers.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="fixed inset-0 z-[100] bg-bglight/90 backdrop-blur-md flex items-center justify-center">
      <StarfieldBackground className="z-0" />

      {/* Orbital glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full bg-gradient-to-tr from-primaryviolet/25 via-tealbrand/10 to-transparent blur-3xl pointer-events-none" />

      <div className="relative z-10 flex flex-col items-center gap-8 px-6 text-center max-w-sm w-full">
        {/* Floating ship */}
        <div className={`w-28 h-28 animate-float-ship transition-all duration-700 ${done ? 'scale-110' : ''}`}>
          <img src={shipSrc} alt="AstroAm ship" className="w-full h-full object-contain drop-shadow-[0_0_30px_rgba(123,92,255,0.75)]" />
        </div>

        {/* Title */}
        <div className="flex flex-col items-center gap-1">
          {simulated && (
            <span className="inline-block px-2.5 py-0.5 rounded-full bg-starlight/15 border border-starlight/40 font-mono text-[10px] font-bold text-starlight tracking-wider uppercase mb-1">
              SIMULATED PAYMENTS
            </span>
          )}
          <span className="font-mono text-[11px] font-bold text-[#B9A6FF] tracking-widest uppercase">
            {done ? '[ MISSION ACTIVATED ]' : '[ ACTIVATION SEQUENCE ]'}
          </span>
          <h2 className="font-display text-2xl font-bold text-textprimary text-glow">
            {done ? 'Ready for liftoff' : 'Preparing your mission…'}
          </h2>
        </div>

        {/* Steps */}
        <div className="w-full flex flex-col gap-3">
          {steps.map((step, i) => (
            <div
              key={i}
              className={`flex items-center gap-3 p-3.5 rounded-xl border transition-all duration-300 ${
                step.status === 'done'
                  ? 'bg-primaryviolet-light border-primaryviolet/40'
                  : step.status === 'running'
                    ? 'bg-cardbg border-primaryviolet/60 shadow-[0_0_20px_rgba(123,92,255,0.3)]'
                    : 'bg-cardbg border-cardborder opacity-50'
              }`}
            >
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-all duration-300 ${
                  step.status === 'done'
                    ? 'bg-primaryviolet'
                    : step.status === 'running'
                      ? 'bg-transparent border-2 border-primaryviolet'
                      : 'bg-cardborder'
                }`}
              >
                {step.status === 'done' ? (
                  <span className="material-symbols-outlined text-white text-sm">check</span>
                ) : step.status === 'running' ? (
                  <span className="w-2.5 h-2.5 rounded-full bg-primaryviolet animate-pulse" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-textsecondary/30" />
                )}
              </div>

              <span
                className={`font-sans text-sm font-medium text-left ${
                  step.status === 'done' ? 'text-[#B9A6FF] font-semibold' : step.status === 'running' ? 'text-textprimary font-semibold' : 'text-textsecondary'
                }`}
              >
                {step.label}
              </span>

              {step.status === 'running' && <span className="ml-auto font-mono text-[10px] text-[#B9A6FF] animate-pulse">···</span>}
            </div>
          ))}
        </div>

        {/* Progress bar */}
        <div className="w-full h-1 bg-cardborder rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-primaryviolet to-tealbrand shadow-[0_0_10px_rgba(47,208,221,0.7)] transition-all duration-500"
            style={{ width: `${((currentStep + (done ? 1 : 0)) / total) * 100}%` }}
          />
        </div>
      </div>
    </div>
  )
}
