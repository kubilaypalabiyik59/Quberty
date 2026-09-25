# Task T8 — correction 1

Review of commits 1851e61 and b532b54: `mosaic.ts` is accepted as it is. The gate passes, but
`MosaicField.tsx` has three runtime defects that the type-checker cannot see.

1. **The animation stops after the first frame.** In `tick`, `if (now - last < 33) return;`
   returns *before* `requestAnimationFrame(tick)` is called again. The next frame arrives about
   16 ms later, is skipped, and nothing schedules another, so the loop dies. The
   `document.hidden` check kills it the same way.
2. **The canvas is never sized.** `resize()` runs only on the window `resize` event, so the canvas
   keeps its default 300×150 bitmap and is stretched blurry. `resize()` must also run once when
   the effect starts.
3. **The cleanup cancels the wrong frame.** Only the first `requestAnimationFrame` id is stored in
   `raf`, so every later frame escapes `cancelAnimationFrame`.

Also, under reduced motion a resize must redraw at `t = 0`, not at the current time.

Rewrite the body of the `useEffect` to this structure. Keep the component signature, the
imports and the JSX exactly as they are:

```ts
const canvas = canvasRef.current;
if (!canvas) return;
const ctx = canvas.getContext('2d');
if (!ctx) return;

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const timeAt = (now: number) => (reduce ? 0 : (now / 1000) * MOSAIC.waveSpeed);

const resize = () => {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawMosaic(ctx, canvas.clientWidth, canvas.clientHeight, timeAt(performance.now()));
};

let raf = 0;
let last = 0;
const tick = (now: number) => {
  raf = requestAnimationFrame(tick);
  if (now - last < 33 || document.hidden) return;
  last = now;
  drawMosaic(ctx, canvas.clientWidth, canvas.clientHeight, timeAt(now));
};

resize();
window.addEventListener('resize', resize);
if (!reduce) raf = requestAnimationFrame(tick);

return () => {
  window.removeEventListener('resize', resize);
  cancelAnimationFrame(raf);
};
```

Output `MosaicField.tsx` in full.
