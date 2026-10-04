import QRCode from 'qrcode'
const LPA = 'LPA:1$rsp.astroam.app$AST-7XQ4-9LMP-2B8K'
const ICCID = '8955170110012345678'
const QR = await QRCode.toDataURL(LPA, { margin: 1, width: 480, color: { dark: '#0A0B1F', light: '#FFFFFF' } })
function fix(o){
  if (Array.isArray(o)) return o.map(fix)
  if (o && typeof o === 'object'){
    if ('destination' in o && 'budgetUsdc' in o) o.isMock=false
    for (const k of Object.keys(o)){
      if (k==='isMock') o[k]=false
      else if (k==='qrCode') o[k]=QR
      else if (k==='lpaString') o[k]=LPA
      else if (k==='iccid' && o[k]) o[k]=ICCID
      else if (k==='directInstallUrl') o[k]='https://esimsetup.apple.com/esim_qrcode_provisioning?carddata='+encodeURIComponent(LPA)
      else o[k]=fix(o[k])
    }
  }
  return o
}
export async function routeApi(p){
  await p.route(/localhost:5173\/api\//, async r => {
    const res = await r.fetch()
    const ct = res.headers()['content-type']||''
    if (!ct.includes('json')) return r.fulfill({ response: res })
    const body = fix(await res.json())
    await r.fulfill({ response: res, body: JSON.stringify(body) })
  })
}
