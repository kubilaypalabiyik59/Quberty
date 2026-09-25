/** Tuning for the landing mosaic field. */
export const MOSAIC = {
  cellSize: 16,      // CSS px per cell
  gap: 1,            // CSS px left dark between cells, so the grid reads
  contrast: 1.15,
  brightness: 0.12,
  vignette: 0.38,
  bloom: 0.25,
  waveAmplitude: 0.6,
  waveSpeed: 1,
} as const;

/** Colour stops from the page background to the cube's brightest teal. */
export const PALETTE = [
  [11, 18, 29],
  [12, 38, 48],
  [18, 88, 96],
  [64, 186, 180],
] as const;

/** Standard smoothstep easing: maps x across [edge0, edge1] to [0, 1]. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const k = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return k * k * (3 - 2 * k);
}

/** Animated cell luminance in the range 0..1 for the mosaic grid. */
export function cellLuminance(nx: number, ny: number, t: number): number {
  const w1 = Math.sin(nx * 6 + ny * 4 + t * 0.8);
  const w2 = Math.cos(ny * 5 - nx * 2 - t * 0.6);
  const wave = 0.5 + 0.5 * w1 * w2;
  let l = 0.28 + MOSAIC.waveAmplitude * (wave - 0.5);
  l = (l - 0.5) * MOSAIC.contrast + 0.5 + MOSAIC.brightness * 0.25;
  const d = Math.hypot(nx - 0.5, ny - 0.5) / Math.SQRT1_2;
  l = l * (1 - MOSAIC.vignette * smoothstep(0.35, 1, d));
  l = l + MOSAIC.bloom * Math.max(0, 1 - d / 0.45) ** 2;
  return Math.min(Math.max(l, 0), 1);
}

/** Linear interpolation through the evenly spaced PALETTE stops. */
export function paletteColor(l: number): readonly [number, number, number] {
  const s = l * 3;
  const i = Math.min(Math.floor(s), 2);
  const f = s - i;
  const a = PALETTE[i];
  const b = PALETTE[i + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

/** Draws the animated mosaic field onto the already-scaled canvas context. */
export function drawMosaic(ctx: CanvasRenderingContext2D, width: number, height: number, t: number): void {
  ctx.fillStyle = `rgb(${PALETTE[0][0]} ${PALETTE[0][1]} ${PALETTE[0][2]})`;
  ctx.fillRect(0, 0, width, height);
  const size = MOSAIC.cellSize;
  const cols = Math.ceil(width / size);
  const rows = Math.ceil(height / size);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const l = cellLuminance((c + 0.5) / cols, (r + 0.5) / rows, t);
      const [r0, g0, b0] = paletteColor(l);
      ctx.fillStyle = `rgb(${r0} ${g0} ${b0})`;
      ctx.fillRect(c * size, r * size, size - MOSAIC.gap, size - MOSAIC.gap);
    }
  }
}
