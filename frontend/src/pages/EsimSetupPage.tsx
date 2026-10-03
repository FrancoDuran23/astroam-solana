import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import MobileAppShell from '../components/MobileAppShell'
import { useMission } from '../hooks/useMission'

export default function EsimSetupPage() {
  const navigate = useNavigate()
  const { mission } = useMission()
  const [copiedLpa, setCopiedLpa] = useState(false)
  const [copiedIccid, setCopiedIccid] = useState(false)
  const [activeTab, setActiveTab] = useState<'iphone' | 'android'>('iphone')

  const isIos = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent)
  const isAndroid = typeof navigator !== 'undefined' && /Android/.test(navigator.userAgent)

  if (!mission) {
    return (
      <div className="min-h-screen bg-bglight flex flex-col items-center justify-center p-6 text-center">
        <div className="bg-cardbg glass p-8 rounded-3xl border border-cardborder max-w-md">
          <span className="material-symbols-outlined text-4xl text-alerta mb-3">warning</span>
          <h2 className="font-display text-xl font-bold text-textprimary mb-2">No active mission</h2>
          <p className="font-sans text-sm text-textsecondary mb-6">
            Create a new mission to get your Citrus Mobile eSIM profile.
          </p>
          <button
            type="button"
            onClick={() => navigate('/mission/new')}
            className="w-full py-3.5 rounded-full bg-primaryviolet text-white font-sans font-semibold text-xs uppercase tracking-wider shadow-md hover:bg-primaryviolet-hover transition-all"
          >
            NEW MISSION
          </button>
        </div>
      </div>
    )
  }

  const esim = mission.esim || {
    iccid: mission.iccid || `fake_${mission.id.slice(0, 8)}`,
    lpaString: `LPA:1$rsp.citrusmobile.com$ASTROAM_${mission.id.toUpperCase()}`,
    qrCode: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220" viewBox="0 0 200 200"><rect width="200" height="200" fill="%23FFFFFF" rx="16"/><rect x="20" y="20" width="40" height="40" fill="%236941FF"/><rect x="140" y="20" width="40" height="40" fill="%236941FF"/><rect x="20" y="140" width="40" height="40" fill="%236941FF"/><rect x="80" y="80" width="40" height="40" fill="%2300F0FF"/><text x="100" y="180" fill="%230F172A" font-size="10" font-family="sans-serif" text-anchor="middle">CITRUS eSIM</text></svg>`,
    directInstallUrl: `https://citrusmobile.com/install?iccid=${mission.iccid || mission.id}`,
    status: mission.esimStatus || 'active',
    isMock: mission.isMock ?? true,
  }

  const isDemo = esim.isMock ?? mission.isMock ?? true

  function copyToClipboard(text: string, type: 'lpa' | 'iccid') {
    void navigator.clipboard.writeText(text)
    if (type === 'lpa') {
      setCopiedLpa(true)
      setTimeout(() => setCopiedLpa(false), 2000)
    } else {
      setCopiedIccid(true)
      setTimeout(() => setCopiedIccid(false), 2000)
    }
  }

  const abbrevIccid = esim.iccid.length > 14
    ? `${esim.iccid.slice(0, 7)}...${esim.iccid.slice(-4)}`
    : esim.iccid

  return (
    <MobileAppShell title="eSIM SETUP">
      {/* Title banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-[11px] font-bold text-[#B9A6FF] tracking-widest uppercase">
              [ CITRUS MOBILE // INSTALL ]
            </span>
            {isDemo && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-starlight/10 text-starlight border border-starlight/30">
                SIMULATED
              </span>
            )}
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-textprimary">
            INSTALL YOUR eSIM
          </h1>
          <p className="font-sans text-xs text-textsecondary mt-0.5">
            Your connection is ready to switch on in your phone.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-3 py-1 rounded-full text-xs font-mono font-semibold bg-online/10 text-online border border-online/20 flex items-center gap-1.5 shrink-0">
            <span className="w-2 h-2 rounded-full bg-online animate-pulse" />
            DESTINATION: {mission.destination.name} {mission.destination.flag}
          </span>
        </div>
      </div>

      {/* Layout Grid */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        {/* Left Column: QR Code & Install Buttons */}
        <div className="md:col-span-5 bg-cardbg glass rounded-3xl border border-cardborder p-6 flex flex-col items-center justify-center text-center">
          <span className="font-mono text-xs font-bold text-textsecondary uppercase tracking-wider mb-4">
            ACTIVATION QR CODE
          </span>

          {/* QR container (white background so cameras can read it) */}
          <div className="relative p-4 bg-white rounded-2xl mb-5 shadow-[0_0_36px_rgba(123,92,255,0.35)] flex items-center justify-center">
            <img
              src={esim.qrCode}
              alt="eSIM QR Code"
              className="w-56 h-56 sm:w-60 sm:h-60 object-contain rounded-lg max-w-full"
            />
            {isDemo && (
              <div className="absolute inset-0 bg-[#0A0B1F]/90 backdrop-blur-sm rounded-2xl flex flex-col items-center justify-center p-3 text-center">
                <span className="material-symbols-outlined text-tealbrand text-3xl mb-1">qr_code_2</span>
                <span className="font-mono text-xs font-bold text-white uppercase tracking-wider">
                  SIMULATED QR
                </span>
                <span className="font-sans text-[11px] text-white/70 mt-1">
                  Use the LPA code in the demo
                </span>
              </div>
            )}
          </div>

          {/* Direct install / instructions button */}
          {isDemo ? (
            <button
              type="button"
              onClick={() => {
                const el = document.getElementById('instructions-card')
                if (el) el.scrollIntoView({ behavior: 'smooth' })
              }}
              className="w-full py-3.5 px-4 mb-3 rounded-2xl bg-primaryviolet text-white font-sans font-bold text-xs uppercase tracking-wider hover:bg-primaryviolet-hover transition-all flex items-center justify-center gap-2 shadow-[0_0_22px_rgba(123,92,255,0.5)] min-h-[48px]"
            >
              <span className="material-symbols-outlined text-base">auto_fix_high</span>
              SEE DEMO INSTALL
            </button>
          ) : (
            esim.directInstallUrl && (
              <a
                href={esim.directInstallUrl}
                target="_blank"
                rel="noreferrer"
                className="w-full py-3.5 px-4 mb-3 rounded-2xl bg-primaryviolet text-white font-sans font-bold text-xs uppercase tracking-wider hover:bg-primaryviolet-hover transition-all flex items-center justify-center gap-2 shadow-[0_0_22px_rgba(123,92,255,0.5)] min-h-[48px]"
              >
                <span className="material-symbols-outlined text-base">
                  {isIos ? 'phone_iphone' : isAndroid ? 'phone_android' : 'qr_code'}
                </span>
                {isIos
                  ? 'INSTALL ON THIS IPHONE'
                  : isAndroid
                    ? 'SEE ANDROID INSTRUCTIONS'
                    : 'SEE INSTALL OPTIONS'}
              </a>
            )
          )}

          <p className="font-sans text-xs text-textsecondary">
            Scan it with your phone camera or copy the LPA code by hand.
          </p>
        </div>

        {/* Right Column: LPA, ICCID & Manual Instructions */}
        <div className="md:col-span-7 flex flex-col gap-6">
          {/* Credentials Card */}
          <div className="bg-cardbg glass rounded-3xl border border-cardborder p-6">
            <h3 className="font-mono text-xs font-bold text-textsecondary uppercase tracking-wider mb-4">
              ACTIVATION CREDENTIALS
            </h3>

            {/* LPA String */}
            <div className="mb-4">
              <label className="block font-mono text-[11px] text-textsecondary mb-1">LPA CODE (ACTIVATION STRING)</label>
              <div className="flex items-center gap-2 bg-warmneutral p-3 rounded-2xl border border-cardborder">
                <code className="font-mono text-xs text-textprimary break-all flex-1">
                  {esim.lpaString}
                </code>
                <button
                  type="button"
                  onClick={() => copyToClipboard(esim.lpaString, 'lpa')}
                  className="px-3 py-2 rounded-xl bg-cardbg border border-cardborder text-[#B9A6FF] hover:border-primaryviolet/60 font-mono text-xs font-semibold flex items-center gap-1 transition-all shrink-0 min-h-[44px]"
                >
                  <span className="material-symbols-outlined text-sm">
                    {copiedLpa ? 'check' : 'content_copy'}
                  </span>
                  {copiedLpa ? 'COPIED' : 'COPY'}
                </button>
              </div>
            </div>

            {/* ICCID */}
            <div>
              <label className="block font-mono text-[11px] text-textsecondary mb-1">eSIM ICCID</label>
              <div className="flex items-center justify-between bg-warmneutral p-3 rounded-2xl border border-cardborder">
                <code className="font-mono text-xs text-textprimary font-semibold">
                  {abbrevIccid}
                </code>
                <button
                  type="button"
                  onClick={() => copyToClipboard(esim.iccid, 'iccid')}
                  className="px-3 py-2 rounded-xl bg-cardbg border border-cardborder text-[#B9A6FF] hover:border-primaryviolet/60 font-mono text-xs font-semibold flex items-center gap-1 transition-all shrink-0 min-h-[44px]"
                >
                  <span className="material-symbols-outlined text-sm">
                    {copiedIccid ? 'check' : 'content_copy'}
                  </span>
                  {copiedIccid ? 'COPIED' : 'COPY'}
                </button>
              </div>
            </div>
          </div>

          {/* Instruction Steps */}
          <div id="instructions-card" className="bg-cardbg glass rounded-3xl border border-cardborder p-6 flex-1">
            <div className="flex items-center justify-between mb-4 border-b border-cardborder pb-3">
              <h3 className="font-mono text-xs font-bold text-textsecondary uppercase tracking-wider">
                STEP-BY-STEP INSTRUCTIONS
              </h3>
              <div className="flex bg-warmneutral p-1 rounded-full border border-cardborder">
                <button
                  type="button"
                  onClick={() => setActiveTab('iphone')}
                  className={`px-3 py-1.5 rounded-full font-mono text-xs font-bold transition-all ${
                    activeTab === 'iphone'
                      ? 'bg-primaryviolet text-white shadow-xs'
                      : 'text-textsecondary hover:text-textprimary'
                  }`}
                >
                  iOS (iPhone)
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('android')}
                  className={`px-3 py-1.5 rounded-full font-mono text-xs font-bold transition-all ${
                    activeTab === 'android'
                      ? 'bg-primaryviolet text-white shadow-xs'
                      : 'text-textsecondary hover:text-textprimary'
                  }`}
                >
                  Android
                </button>
              </div>
            </div>

            {activeTab === 'iphone' ? (
              <ol className="space-y-3 font-sans text-xs text-textsecondary">
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-primaryviolet/20 text-[#B9A6FF] font-mono text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">1</span>
                  <span>Go to <strong className="text-textprimary">Settings &gt; Cellular &gt; Add eSIM</strong>.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-primaryviolet/20 text-[#B9A6FF] font-mono text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">2</span>
                  <span>Choose <strong className="text-textprimary">Use QR Code</strong> and scan the image above.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-primaryviolet/20 text-[#B9A6FF] font-mono text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">3</span>
                  <span>Or choose <strong className="text-textprimary">Enter Details Manually</strong> and paste the <strong className="text-textprimary">LPA code</strong>.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-primaryviolet/20 text-[#B9A6FF] font-mono text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">4</span>
                  <span>Turn the line on and enable <strong className="text-textprimary">Data Roaming</strong> when you travel.</span>
                </li>
              </ol>
            ) : (
              <ol className="space-y-3 font-sans text-xs text-textsecondary">
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-primaryviolet/20 text-[#B9A6FF] font-mono text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">1</span>
                  <span>Open <strong className="text-textprimary">Settings &gt; Network &amp; internet &gt; SIMs</strong>.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-primaryviolet/20 text-[#B9A6FF] font-mono text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">2</span>
                  <span>Tap <strong className="text-textprimary">Download a SIM instead? / Add eSIM</strong>.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-primaryviolet/20 text-[#B9A6FF] font-mono text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">3</span>
                  <span>Scan the QR code, or tap <strong className="text-textprimary">Need help? / Enter it manually</strong> and paste the LPA.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-primaryviolet/20 text-[#B9A6FF] font-mono text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">4</span>
                  <span>Confirm the download and turn on data roaming.</span>
                </li>
              </ol>
            )}
          </div>
        </div>
      </div>

      {/* Action bar */}
      <div className="mt-8 flex flex-col sm:flex-row items-center justify-between gap-4 bg-cardbg glass p-4 sm:p-6 rounded-3xl border border-cardborder">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-online text-2xl">verified</span>
          <div>
            <p className="font-sans font-bold text-sm text-textprimary">
              Profile provided by Citrus Mobile
            </p>
            <p className="font-sans text-xs text-textsecondary">
              Your data is backed by the USDC in your trip escrow; AstroAm tops up the eSIM as you use it.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate('/mission/active')}
          className="w-full sm:w-auto px-8 py-3.5 rounded-full bg-primaryviolet text-white font-sans font-semibold text-xs uppercase tracking-wider hover:bg-primaryviolet-hover transition-all shadow-[0_0_22px_rgba(123,92,255,0.5)] hover:-translate-y-0.5 flex items-center justify-center gap-2 min-h-[48px]"
        >
          I INSTALLED IT // GO TO DASHBOARD
          <span className="material-symbols-outlined text-base">arrow_forward</span>
        </button>
      </div>
    </MobileAppShell>
  )
}
