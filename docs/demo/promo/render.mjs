// node render.mjs stills 5,20,...   -> PNG stills
// node render.mjs video out.mp4      -> 1920x1080 30fps H.264, frame-exact
import { chromium } from 'playwright'
import { spawn } from 'child_process'
import { pathToFileURL } from 'url'
import ffmpeg from 'ffmpeg-static'
import { routeFonts } from './fonts.mjs'
const [mode, arg] = process.argv.slice(2)
const b = await chromium.launch()
const p = await b.newPage({ viewport:{width:1280,height:720}, deviceScaleFactor:1.5 })
await routeFonts(p)
await p.goto(pathToFileURL('promo.html').href); await p.waitForLoadState('networkidle')
await p.evaluate(() => document.fonts.ready)
const shot = async t => { await p.evaluate(t => window.seek(t), t); return p.screenshot({ type:'jpeg', quality:92 }) }
if (mode === 'stills') {
  for (const t of arg.split(',').map(Number)) { await p.evaluate(t => window.seek(t), t); await p.screenshot({ path:`still-${t}.png` }) }
} else {
  const FPS = 30, total = await p.evaluate(() => window.TOTAL)
  const ff = spawn(ffmpeg, ['-y','-f','image2pipe','-framerate',String(FPS),'-c:v','mjpeg','-i','-','-c:v','libx264','-pix_fmt','yuv420p','-preset','slow','-crf','18','-movflags','+faststart', arg], { stdio:['pipe','inherit','inherit'] })
  const N = Math.round(total * FPS)
  for (let i = 0; i < N; i++) {
    const buf = await shot(i / FPS)
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r))
    if (i % 300 === 0) console.log(`frame ${i}/${N}`)
  }
  ff.stdin.end(); await new Promise(r => ff.on('close', r))
}
await b.close()
