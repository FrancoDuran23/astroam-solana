import { execFileSync } from 'child_process'
const cache = new Map()
export async function routeFonts(p){
  await p.route(/fonts\.(googleapis|gstatic)\.com/, async r => {
    const url = r.request().url()
    if(!cache.has(url)) cache.set(url, execFileSync('curl',['-sS','-A','Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',url],{maxBuffer:1e8}))
    const ct = url.includes('googleapis') ? 'text/css' : 'font/woff2'
    await r.fulfill({ body: cache.get(url), contentType: ct, headers:{'access-control-allow-origin':'*'} })
  })
}
