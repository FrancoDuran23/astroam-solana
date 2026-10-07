// DEV/TEST ONLY. Not imported by the app.
//
// The recorder may inject this file in place of frontend/src/chain/solana.ts
// when ASTROAM_DEV_ONLY_MOCK_WALLET=1. Headless Chromium has no Phantom.
// The signatures it returns are random and are not Solana transactions.
// Do not use it for a demo that claims a real devnet payment.
const B58='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const rnd=()=>{const bytes=crypto.getRandomValues(new Uint8Array(64)); bytes[0]=bytes[0]||1; let n=0n; for(const x of bytes)n=n*256n+BigInt(x); let s=''; while(n>0n){s=B58[Number(n%58n)]+s; n/=58n} return s}
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const WALLET='DevOnlyMockWalletNotARealPubkey'
const payerKey=id=>`astroam_solana_payer_${id}`
const bal=()=>Number(localStorage.getItem('mock_usdc')??'25')
const setBal=v=>localStorage.setItem('mock_usdc',String(v))
export function walletError(e){return e instanceof Error?e.message:String(e)}
export function rememberedPayer(id){try{return JSON.parse(localStorage.getItem(payerKey(id))).address}catch{return undefined}}
export async function sendDeposit(id,plan,method,onProgress){
  onProgress?.('connecting'); await sleep(1200)
  localStorage.setItem(payerKey(id),JSON.stringify({address:WALLET,rpcUrl:plan.rpcUrl,mint:plan.usdcMint}))
  onProgress?.('depositing'); await sleep(1600)
  onProgress?.('confirming'); await sleep(1400)
  setBal(+(bal()-Number(plan.amountUsdc)).toFixed(6))
  return rnd()
}
export async function readTravelerUsdc(id){const r=localStorage.getItem(payerKey(id)); if(!r)return null; return {address:WALLET,usdc:bal()}}
export async function closeEscrow(plan){await sleep(1800); setBal(+(bal()+Number(plan.refundUsdc??0)).toFixed(6)); return rnd()}
export async function refundEscrow(){await sleep(1500); return rnd()}
