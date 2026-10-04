import { chromium } from 'playwright'
import fs from 'fs'
import { routeFonts } from './fonts.mjs'
import { routeApi } from './esim.mjs'
const mock = fs.readFileSync('mock-solana.js','utf8')
const overlay = fs.readFileSync('overlay.js','utf8')
const W=1280,H=720
const b = await chromium.launch()
const ctx = await b.newContext({ viewport:{width:W,height:H}, ignoreHTTPSErrors:true, recordVideo:{dir:'rec', size:{width:W,height:H}} })
await ctx.addInitScript(overlay)
const p = await ctx.newPage(); const T0 = Date.now()
await routeFonts(p)
await routeApi(p)
await p.route(/\/src\/chain\/solana\.ts/, r => r.fulfill({contentType:'application/javascript', body:mock}))
const wait = ms => p.waitForTimeout(ms)
let capPos='bottom'
const cap = (h) => p.evaluate(([h,pos]) => window.__cap(h,pos), [h,capPos])
const card = (h) => p.evaluate(h => window.__card(h), h)
let mx=640,my=360
async function moveTo(x,y,steps=30){ await p.mouse.move(x,y,{steps}); mx=x; my=y }
async function click(loc, pause=350){
  await loc.scrollIntoViewIfNeeded(); await wait(250)
  const bb = await loc.boundingBox(); await moveTo(bb.x+bb.width/2, bb.y+bb.height/2, 28); await wait(pause)
  await p.mouse.down(); await wait(90); await p.mouse.up()
}
async function scrollTo(y, ms=1800){
  await p.evaluate(([y,ms]) => new Promise(res => { const s=scrollY, t0=performance.now()
    const f=t=>{ const k=Math.min(1,(t-t0)/ms), e=k<.5?2*k*k:1-Math.pow(-2*k+2,2)/2; scrollTo(0,s+(y-s)*e); k<1?requestAnimationFrame(f):res() }; requestAnimationFrame(f) }), [y,ms])
}
async function scrollToEl(loc, offset=90, ms=1600){ const y = await loc.evaluate((el,o)=>el.getBoundingClientRect().top+scrollY-o, offset); await scrollTo(y, ms) }

// ---------- INTRO ----------
await p.goto('http://localhost:5173/'); await p.waitForLoadState('networkidle')
await card(`<div class="k">Colosseum · Superteam Argentina</div>
  <h1>Astro<span>Am</span></h1>
  <p>Travel roaming you pay for <b style="color:#2FD0DD">by the MB you actually use</b>, in USDC, on <b style="color:#B9A6FF">Solana</b>.</p>`)
const TRIM = (Date.now()-T0)/1000
await moveTo(640,360,1)
await wait(4200)
await card(`<div class="k">The problem</div>
  <h1>Traditional roaming<br>burns your money</h1>
  <div class="row">
   <div class="pill"><i class="x">✕ 01</i><div>Rigid packages</div><small>You pay for 7 or 30 days on a weekend trip.</small></div>
   <div class="pill"><i class="x">✕ 02</i><div>Wasted data</div><small>You buy 10 GB, use 2, and the rest expires.</small></div>
   <div class="pill"><i class="x">✕ 03</i><div>Bill shock</div><small>Charges you only see on next month's bill.</small></div>
  </div>`)
await wait(6000)
await card(`<div class="k">The solution</div>
  <h1>Deposit USDC.<br>Pay only for what you use.<br><span>The rest goes back to your wallet.</span></h1>`)
await wait(4200)
await card(null); await wait(700)

// ---------- LANDING ----------
await cap('AstroAm: your travel connection, run like a <b>mission</b>.')
await wait(1500)
await click(p.locator('button[aria-label*="ext"], button:has(span:text("chevron_right"))').first(), 200); await wait(1500)
await scrollTo(560, 2000)
await cap('Example: 250 MB in Brazil × 0.0025 USDC/MB = <b>0.625 USDC</b>. Nothing else leaves the escrow.')
await wait(3000)
await scrollToEl(p.getByText('Only what gets measured gets paid.').first(), 120, 1800)
await wait(3000)
await scrollToEl(p.getByText('The mission, running').first(), 140, 2200)
await cap('Four steps: <b>destination → deposit → eSIM → pay as you go</b>.')
await wait(3800)
await scrollTo(0, 1800); await cap(null)
await click(p.locator(':is(a,button):has-text("START MISSION")').first(), 500)
await p.waitForURL(/mission\/new/); await wait(700); capPos='top'

// ---------- WIZARD ----------
await cap('1 · Pick a country. Each destination has its own <b>price per MB</b>.')
await wait(1200)
await moveTo(700, 420, 25); await wait(300)
await click(p.getByRole('button',{name:/Brazil/}), 500); await wait(1200)
await click(p.getByRole('button',{name:/CONTINUE/}), 300); await wait(900)
await cap('2 · Set the trip dates.')
await wait(1600)
await click(p.getByRole('button',{name:/CONTINUE/}), 300); await wait(900)
await cap('3 · Set a USDC budget, a daily limit and auto-pause.')
const slider = p.locator('input[type=range]').first()
{ const bb=await slider.boundingBox(); const x=bb.x+12+(bb.width-24)*(4/49); await moveTo(x,bb.y+bb.height/2,28); await wait(250); await p.mouse.down(); await wait(80); await p.mouse.up() }
await slider.focus()
for (let k=0;k<10;k++){ await p.keyboard.press('ArrowRight'); await wait(160) }
await wait(1200)
await scrollTo(380, 1400); await wait(1600)
await click(p.getByRole('button',{name:/CONTINUE/}), 300); await wait(900)
await cap('4 · Confirm the mission.')
await wait(2200)
await click(p.getByRole('button',{name:/CONFIRM AND LAUNCH/}), 400); await wait(1500)

// ---------- DEPOSIT ----------
await cap('Pay with <b>Phantom or Solflare</b>: the USDC goes into a <b>Solana escrow</b>, not to AstroAm.')
await wait(3600)
await click(p.getByRole('button',{name:/with wallet/}), 500)
await wait(2200)
await cap('One deposit transaction. Usage is never charged MB by MB on-chain.')
await p.waitForSelector('text=Preparing your mission', {timeout:20000})
await cap('Deposit confirmed → channel opened → eSIM issued by Citrus Mobile.')
await p.waitForURL(/esim/,{timeout:30000}); await wait(800)

// ---------- ESIM ----------
await cap('Scan the QR or paste the LPA code. The line switches on when you land.')
await moveTo(390, 420, 30); await wait(2500)
await moveTo(820, 300, 30); await wait(1500)
await scrollTo(420, 1500); await wait(1200)
await click(p.getByRole('button',{name:/GO TO DASHBOARD/}), 500)
await p.waitForURL(/active/); await wait(900)

// ---------- DASHBOARD ----------
await cap('The mission dashboard: USDC balance, data used and data left, live.')
await wait(3500)
await cap('Each carrier reading produces a <b>signed voucher</b> for the exact amount.')
const use = p.getByRole('button',{name:/USE 250 MB/})
await click(use, 400); await wait(2200)
await click(use, 300); await wait(2200)
await scrollToEl(p.getByText('AI COPILOT').first(), 90, 1600)
await cap('500 MB = <b>1.25 USDC</b>. Vouchers stay off-chain: zero fees per MB. An AI copilot keeps you on budget.')
await wait(4500)

// ---------- CLOSE ----------
await cap('Trip over: one single close on Solana.')
await click(p.getByRole('button',{name:/END MISSION AND GET/}), 500); await wait(1600)
await cap('It pays AstroAm what you used and <b>refunds the rest</b> to your wallet, in the same transaction.')
await wait(2200)
await click(p.getByRole('button',{name:/^END MISSION$/}), 500)
await p.waitForSelector('text=MISSION SETTLED', {timeout:20000}); await wait(1000)
await cap('Used 1.25 USDC → <b>8.75 USDC back in your wallet</b>.')
await wait(5000)
await cap('And if AstroAm never closes, a <b>timeout refund</b> returns your full deposit.')
await wait(4000)
await cap(null)

// ---------- OUTRO ----------
await card(`<div class="k">Under the hood · Solana devnet</div>
  <div class="row">
   <div class="pill"><i>01 · DEPOSIT</i><div>USDC into escrow</div><small>Vault owned by a program PDA. Circle USDC (SPL).</small></div>
   <div class="pill"><i>02 · VOUCHERS</i><div>Off-chain metering</div><small>Cumulative ed25519-signed vouchers. No tx per MB.</small></div>
   <div class="pill"><i>03 · CLOSE</i><div>One close</div><small>Pays what was used and refunds the rest in one tx.</small></div>
   <div class="pill"><i>04 · REFUND</i><div>Timeout</div><small>If nobody closes in 7 days, the full deposit returns.</small></div>
  </div>
  <p style="font-size:17px">Program deployed on devnet: <code>8QXPo6yVxZuC3goYzHVLsxVkE1J6BaEqZvfW9e3Do2uq</code></p>`)
await wait(7500)
await card(`<h1>Astro<span>Am</span></h1>
  <p>Travel connected. Pay only for what you use.<br>What you don't use comes back.</p>
  <div class="k" style="margin-top:14px">Pay-per-MB roaming · settled on Solana</div>`)
await wait(4000)
const END = (Date.now()-T0)/1000
await p.close(); await ctx.close(); await b.close()
fs.writeFileSync('times.json', JSON.stringify({TRIM, END}))
console.log({TRIM, END})
