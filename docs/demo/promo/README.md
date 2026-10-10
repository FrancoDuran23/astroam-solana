# Promo video

`promo.html` is a 2:00 animated promo (no audio, 1920x1080) with the 8-bit AstroAm astronaut mascot. The voice-over, timed to its scenes, is in [pitch-script.md](pitch-script.md). Every animation is driven by `window.seek(t)`, so `render.mjs` captures it frame by frame at 30 fps and pipes the frames into ffmpeg.

```bash
cd docs/demo/promo
npm i playwright@1.56 ffmpeg-static
node render.mjs stills 6,40,93        # PNG stills to check a frame
node render.mjs video promo.mp4      # animation only, no voice; not committed
```

Open `promo.html` in a browser and call `seek(<seconds>)` in the console to preview a moment. Scene timings are the `data-start`/`data-end` on each `<section>`; `data-at` is an element's entrance time inside its scene.
