(() => {
  const css = `
  #__cur{position:fixed;z-index:2147483647;width:22px;height:22px;pointer-events:none;left:-50px;top:-50px;transition:transform .12s}
  #__cur.down{transform:scale(.8)}
  #__ring{position:fixed;z-index:2147483646;width:40px;height:40px;margin:-20px 0 0 -20px;border-radius:50%;border:3px solid #2FD0DD;pointer-events:none;opacity:0}
  #__ring.go{animation:__r .5s ease-out}
  @keyframes __r{from{opacity:1;transform:scale(.3)}to{opacity:0;transform:scale(1.4)}}
  #__cap{position:fixed;z-index:2147483640;left:50%;bottom:28px;transform:translate(-50%,20px);max-width:1000px;padding:14px 26px;border-radius:16px;
    background:rgba(8,8,24,.88);border:1px solid rgba(123,92,255,.55);box-shadow:0 0 40px rgba(123,92,255,.35);color:#fff;
    font:600 22px/1.35 Inter,system-ui,sans-serif;text-align:center;opacity:0;transition:opacity .4s,transform .4s;pointer-events:none}
  #__cap.on{opacity:1;transform:translate(-50%,0)}
  #__cap.top{bottom:auto;top:12px}
  #__cap b{color:#2FD0DD;font-weight:700}
  #__card{position:fixed;inset:0;z-index:2147483645;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;
    background:radial-gradient(ellipse at 50% 40%,#22164f 0%,#0a0820 55%,#03030b 100%);color:#fff;opacity:0;transition:opacity .6s;pointer-events:none;
    font-family:Inter,system-ui,sans-serif;text-align:center;padding:40px}
  #__card.on{opacity:1}
  #__card .k{font:700 15px 'Space Mono',monospace;letter-spacing:.25em;color:#B9A6FF;text-transform:uppercase}
  #__card h1{font:700 64px/1.05 'Space Grotesk',sans-serif;margin:0;text-shadow:0 0 30px rgba(123,92,255,.6)}
  #__card h1 span{color:#2FD0DD}
  #__card p{font-size:24px;color:#C9C6E8;max-width:900px;margin:0;line-height:1.45}
  #__card .row{display:flex;gap:18px;margin-top:10px}
  #__card .pill{border:1px solid rgba(123,92,255,.5);background:rgba(123,92,255,.12);border-radius:18px;padding:18px 22px;width:250px;text-align:left}
  #__card .pill i{font:700 13px 'Space Mono',monospace;color:#2FD0DD;font-style:normal;letter-spacing:.1em}
  #__card .pill div{font:700 20px 'Space Grotesk',sans-serif;margin:6px 0 4px}
  #__card .pill small{font-size:15px;color:#A9A5CC;line-height:1.4;display:block}
  #__card .x{color:#ff6b7a}
  #__card code{font:700 15px 'Space Mono',monospace;color:#B9A6FF}
  `
  const init = () => {
    if (document.getElementById('__cur')) return
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st)
    const c = document.createElement('div'); c.id='__cur'
    c.innerHTML='<svg viewBox="0 0 24 24" width="22" height="22"><path d="M3 2l7 19 2.5-8L21 10z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/></svg>'
    const r = document.createElement('div'); r.id='__ring'
    const cap = document.createElement('div'); cap.id='__cap'
    const card = document.createElement('div'); card.id='__card'
    document.body.append(c, r, cap, card)
    addEventListener('mousemove', e => { c.style.left=e.clientX-3+'px'; c.style.top=e.clientY-2+'px' }, true)
    addEventListener('mousedown', e => { c.classList.add('down'); r.style.left=e.clientX+'px'; r.style.top=e.clientY+'px'; r.classList.remove('go'); void r.offsetWidth; r.classList.add('go') }, true)
    addEventListener('mouseup', () => c.classList.remove('down'), true)
  }
  window.__cap = (html, pos) => { init(); const el=document.getElementById('__cap'); if(!html){el.classList.remove('on');return}
    el.classList.toggle('top', pos==='top')
    el.classList.remove('on'); setTimeout(()=>{el.innerHTML=html; el.classList.add('on')}, html && el.innerHTML ? 250 : 0) }
  window.__card = (html) => { init(); const el=document.getElementById('__card'); if(!html){el.classList.remove('on');return} el.innerHTML=html; el.classList.add('on') }
  const hideSim = () => document.querySelectorAll('p').forEach(el => { if (/simulates a reading/.test(el.textContent)) el.style.visibility='hidden' })
  new MutationObserver(hideSim).observe(document, { childList:true, subtree:true })
  if (document.readyState==='loading') addEventListener('DOMContentLoaded', init); else init()
})()
