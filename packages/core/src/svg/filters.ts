/**
 * Adjustments (colour grading, retro FX) and effects (shadows, glows, rim-light, outline,
 * silhouette) compiled to SVG filter primitives. SVG filters are rendered by resvg, Chromium
 * and the Studio's browser canvas alike, which is what gives CLI ↔ Studio parity.
 */
import { parseColor, svgColor, luminance, toHex } from '../color.js';
import type { Adjustment, Effect } from '../udm/schema.js';
import { toDataUri } from '../assets/resolver.js';
import { el, num } from './xml.js';
import type { PaintContext } from './paint.js';

export const PALETTES: Record<string, string[]> = {
  gameboy: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
  'gameboy-pocket': ['#000000', '#555555', '#aaaaaa', '#ffffff'],
  mono: ['#000000', '#ffffff'],
  'sepia-4': ['#2b1d0e', '#6b4a2b', '#b08b5a', '#f2e3c6'],
  cga: ['#000000', '#555555', '#55ffff', '#ff55ff', '#ffffff'],
};

const LUMA = [0.2126, 0.7152, 0.0722];

function grayscaleMatrix(amount: number): number[] {
  const a = 1 - amount;
  return [
    0.2126 + 0.7874 * a, 0.7152 - 0.7152 * a, 0.0722 - 0.0722 * a, 0, 0,
    0.2126 - 0.2126 * a, 0.7152 + 0.2848 * a, 0.0722 - 0.0722 * a, 0, 0,
    0.2126 - 0.2126 * a, 0.7152 - 0.7152 * a, 0.0722 + 0.9278 * a, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

function sepiaMatrix(amount: number): number[] {
  const a = 1 - amount;
  return [
    0.393 + 0.607 * a, 0.769 - 0.769 * a, 0.189 - 0.189 * a, 0, 0,
    0.349 - 0.349 * a, 0.686 + 0.314 * a, 0.168 - 0.168 * a, 0, 0,
    0.272 - 0.272 * a, 0.534 - 0.534 * a, 0.131 + 0.869 * a, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

const m = (vals: number[]) => vals.map(num).join(' ');

function channelTables(colors: string[]): { r: string; g: string; b: string } {
  const parsed = colors.map((c) => parseColor(c) ?? { r: 0, g: 0, b: 0, a: 1 });
  return {
    r: parsed.map((c) => num(c.r / 255)).join(' '),
    g: parsed.map((c) => num(c.g / 255)).join(' '),
    b: parsed.map((c) => num(c.b / 255)).join(' '),
  };
}

function transfer(input: string, result: string, funcs: { r?: string; g?: string; b?: string; a?: string }): string {
  const f = (tag: string, spec?: string) => (spec ? `<${tag} ${spec}/>` : '');
  return `<feComponentTransfer in="${input}" result="${result}">${f('feFuncR', funcs.r)}${f('feFuncG', funcs.g)}${f('feFuncB', funcs.b)}${f('feFuncA', funcs.a)}</feComponentTransfer>`;
}

function svgImageUri(w: number, h: number, body: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${num(w)}" height="${num(h)}" viewBox="0 0 ${num(w)} ${num(h)}">${body}</svg>`;
  return toDataUri(new TextEncoder().encode(svg), 'image/svg+xml');
}

export interface FilterBuildResult {
  id: string;
  margin: number;
}

/** Extra space a filter needs around the layer box. */
export function filterMargin(adjustments: Adjustment[], effects: Effect[]): number {
  let mg = 0;
  for (const a of adjustments) {
    if (a.type === 'blur') mg = Math.max(mg, a.radius * 3);
    if (a.type === 'bloom') mg = Math.max(mg, a.radius * 3);
    if (a.type === 'chromatic-aberration') mg = Math.max(mg, Math.abs(a.offset) + 1);
  }
  for (const e of effects) {
    if (e.type === 'drop-shadow') mg = Math.max(mg, Math.abs(e.x) + Math.abs(e.y) + e.blur * 1.5 + Math.max(0, e.spread) + 2);
    if (e.type === 'outer-glow') mg = Math.max(mg, e.radius + e.blur * 1.5 + 2);
    if (e.type === 'outline') mg = Math.max(mg, e.width + 2);
  }
  return Math.ceil(mg);
}

/**
 * Build a <filter> for a layer (w×h local box). Returns null when nothing to do.
 * `recolor` tints every painted pixel (used for single-colour SVG icons).
 */
export function buildFilter(
  ctx: PaintContext,
  w: number,
  h: number,
  adjustments: Adjustment[],
  effects: Effect[],
  recolor?: string,
): FilterBuildResult | null {
  if (!adjustments.length && !effects.length && !recolor) return null;
  const id = ctx.nextId('f');
  const parts: string[] = [];
  let n = 0;
  const r = () => `r${n++}`;
  let cur = 'SourceGraphic';

  if (recolor) {
    const c = svgColor(recolor);
    const fl = r();
    parts.push(`<feFlood flood-color="${c.hex}" flood-opacity="${num(c.opacity)}" result="${fl}"/>`);
    const out = r();
    parts.push(`<feComposite in="${fl}" in2="SourceAlpha" operator="in" result="${out}"/>`);
    cur = out;
  }

  for (const a of adjustments) {
    const out = r();
    switch (a.type) {
      case 'brightness': {
        const s = `type="linear" slope="${num(a.value)}"`;
        parts.push(transfer(cur, out, { r: s, g: s, b: s }));
        break;
      }
      case 'exposure': {
        const s = `type="linear" slope="${num(Math.pow(2, a.value))}"`;
        parts.push(transfer(cur, out, { r: s, g: s, b: s }));
        break;
      }
      case 'contrast': {
        const s = `type="linear" slope="${num(a.value)}" intercept="${num(0.5 - 0.5 * a.value)}"`;
        parts.push(transfer(cur, out, { r: s, g: s, b: s }));
        break;
      }
      case 'gamma': {
        const s = `type="gamma" amplitude="1" exponent="${num(1 / Math.max(0.01, a.value))}" offset="0"`;
        parts.push(transfer(cur, out, { r: s, g: s, b: s }));
        break;
      }
      case 'saturate':
        parts.push(`<feColorMatrix in="${cur}" type="saturate" values="${num(a.value)}" result="${out}"/>`);
        break;
      case 'hue-rotate':
        parts.push(`<feColorMatrix in="${cur}" type="hueRotate" values="${num(a.value)}" result="${out}"/>`);
        break;
      case 'grayscale':
        parts.push(`<feColorMatrix in="${cur}" type="matrix" values="${m(grayscaleMatrix(a.value))}" result="${out}"/>`);
        break;
      case 'sepia':
        parts.push(`<feColorMatrix in="${cur}" type="matrix" values="${m(sepiaMatrix(a.value))}" result="${out}"/>`);
        break;
      case 'invert': {
        const s = `type="table" tableValues="${num(a.value)} ${num(1 - a.value)}"`;
        parts.push(transfer(cur, out, { r: s, g: s, b: s }));
        break;
      }
      case 'temperature': {
        const t = a.value;
        parts.push(transfer(cur, out, { r: `type="linear" slope="${num(1 + 0.18 * t)}"`, g: `type="linear" slope="${num(1 + 0.04 * t)}"`, b: `type="linear" slope="${num(1 - 0.18 * t)}"` }));
        break;
      }
      case 'tint': {
        const c = svgColor(a.color);
        const fl = r();
        const inn = r();
        parts.push(`<feFlood flood-color="${c.hex}" result="${fl}"/>`);
        parts.push(`<feComposite in="${fl}" in2="${cur}" operator="in" result="${inn}"/>`);
        parts.push(`<feComposite in="${cur}" in2="${inn}" operator="arithmetic" k1="0" k2="${num(1 - a.amount)}" k3="${num(a.amount)}" k4="0" result="${out}"/>`);
        break;
      }
      case 'blur':
        parts.push(`<feGaussianBlur in="${cur}" stdDeviation="${num(a.radius)}" result="${out}"/>`);
        break;
      case 'sharpen': {
        const k = a.amount;
        parts.push(`<feConvolveMatrix in="${cur}" order="3" preserveAlpha="true" kernelMatrix="${m([0, -k, 0, -k, 1 + 4 * k, -k, 0, -k, 0])}" result="${out}"/>`);
        break;
      }
      case 'vignette': {
        const c = svgColor(a.color);
        const inner = Math.max(0, Math.min(0.99, a.size));
        const img = svgImageUri(
          w,
          h,
          `<defs><radialGradient id="v" cx="50%" cy="50%" r="71%"><stop offset="${num(inner)}" stop-color="${c.hex}" stop-opacity="0"/><stop offset="1" stop-color="${c.hex}" stop-opacity="${num(a.amount * c.opacity)}"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#v)"/>`,
        );
        const vi = r();
        parts.push(`<feImage href="${img}" xlink:href="${img}" x="0" y="0" width="${num(w)}" height="${num(h)}" preserveAspectRatio="none" result="${vi}"/>`);
        parts.push(`<feComposite in="${vi}" in2="${cur}" operator="atop" result="${out}"/>`);
        break;
      }
      case 'scanlines': {
        const c = svgColor(a.color);
        const img = svgImageUri(
          w,
          h,
          `<defs><pattern id="s" width="${num(w)}" height="${num(a.spacing)}" patternUnits="userSpaceOnUse"><rect width="${num(w)}" height="${num(a.thickness)}" fill="${c.hex}" fill-opacity="${num(a.opacity * c.opacity)}"/></pattern></defs><rect width="100%" height="100%" fill="url(#s)"/>`,
        );
        const si = r();
        parts.push(`<feImage href="${img}" xlink:href="${img}" x="0" y="0" width="${num(w)}" height="${num(h)}" preserveAspectRatio="none" result="${si}"/>`);
        parts.push(`<feComposite in="${si}" in2="${cur}" operator="atop" result="${out}"/>`);
        break;
      }
      case 'bloom': {
        const th = Math.min(0.99, a.threshold);
        const bp = r();
        const bl = r();
        const s = `type="linear" slope="${num(1 / (1 - th))}" intercept="${num(-th / (1 - th))}"`;
        parts.push(transfer(cur, bp, { r: s, g: s, b: s }));
        parts.push(`<feGaussianBlur in="${bp}" stdDeviation="${num(a.radius)}" result="${bl}"/>`);
        parts.push(`<feComposite in="${cur}" in2="${bl}" operator="arithmetic" k1="0" k2="1" k3="${num(a.intensity)}" k4="0" result="${out}"/>`);
        break;
      }
      case 'pixelate': {
        const s = Math.max(1, Math.round(a.size));
        if (s < 2) {
          parts.push(`<feOffset in="${cur}" dx="0" dy="0" result="${out}"/>`);
          break;
        }
        const half = Math.floor(s / 2);
        const fl = r();
        const tile = r();
        const tiled = r();
        const sampled = r();
        parts.push(`<feFlood x="${half - 1}" y="${half - 1}" width="1" height="1" flood-color="#000" result="${fl}"/>`);
        parts.push(`<feComposite in="${fl}" x="0" y="0" width="${s}" height="${s}" result="${tile}"/>`);
        parts.push(`<feTile in="${tile}" result="${tiled}"/>`);
        parts.push(`<feComposite in="${cur}" in2="${tiled}" operator="in" result="${sampled}"/>`);
        parts.push(`<feMorphology in="${sampled}" operator="dilate" radius="${num(Math.ceil(s / 2))}" result="${out}"/>`);
        break;
      }
      case 'posterize': {
        const vals = Array.from({ length: a.levels }, (_, i) => num(i / (a.levels - 1))).join(' ');
        const s = `type="discrete" tableValues="${vals}"`;
        parts.push(transfer(cur, out, { r: s, g: s, b: s }));
        break;
      }
      case 'palette': {
        const colors = a.preset === 'custom' ? a.colors ?? PALETTES.gameboy : PALETTES[a.preset];
        const sorted = [...colors].sort((x, y) => luminance(parseColor(x)!) - luminance(parseColor(y)!));
        const t = channelTables(sorted);
        const g = r();
        parts.push(`<feColorMatrix in="${cur}" type="matrix" values="${m([...LUMA, 0, 0, ...LUMA, 0, 0, ...LUMA, 0, 0, 0, 0, 0, 1, 0])}" result="${g}"/>`);
        parts.push(transfer(g, out, { r: `type="discrete" tableValues="${t.r}"`, g: `type="discrete" tableValues="${t.g}"`, b: `type="discrete" tableValues="${t.b}"` }));
        break;
      }
      case 'duotone': {
        const t = channelTables([a.shadows, a.highlights]);
        const g = r();
        parts.push(`<feColorMatrix in="${cur}" type="matrix" values="${m([...LUMA, 0, 0, ...LUMA, 0, 0, ...LUMA, 0, 0, 0, 0, 0, 1, 0])}" result="${g}"/>`);
        parts.push(transfer(g, out, { r: `type="table" tableValues="${t.r}"`, g: `type="table" tableValues="${t.g}"`, b: `type="table" tableValues="${t.b}"` }));
        break;
      }
      case 'chromatic-aberration': {
        const R = r(), G = r(), B = r(), Ro = r(), Bo = r(), RG = r();
        parts.push(`<feColorMatrix in="${cur}" type="matrix" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="${R}"/>`);
        parts.push(`<feColorMatrix in="${cur}" type="matrix" values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0" result="${G}"/>`);
        parts.push(`<feColorMatrix in="${cur}" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0" result="${B}"/>`);
        parts.push(`<feOffset in="${R}" dx="${num(-a.offset)}" dy="0" result="${Ro}"/>`);
        parts.push(`<feOffset in="${B}" dx="${num(a.offset)}" dy="0" result="${Bo}"/>`);
        parts.push(`<feBlend in="${Ro}" in2="${G}" mode="screen" result="${RG}"/>`);
        parts.push(`<feBlend in="${Bo}" in2="${RG}" mode="screen" result="${out}"/>`);
        break;
      }
      case 'noise': {
        const nz = r(), ng = r(), mix = r();
        parts.push(`<feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="${a.seed}" stitchTiles="stitch" result="${nz}"/>`);
        parts.push(`<feColorMatrix in="${nz}" type="matrix" values="${m([...LUMA, 0, 0, ...LUMA, 0, 0, ...LUMA, 0, 0, 0, 0, 0, 0, 1])}" result="${ng}"/>`);
        parts.push(`<feComposite in="${cur}" in2="${ng}" operator="arithmetic" k1="0" k2="1" k3="${num(a.amount)}" k4="${num(-a.amount / 2)}" result="${mix}"/>`);
        parts.push(`<feComposite in="${mix}" in2="SourceAlpha" operator="in" result="${out}"/>`);
        break;
      }
    }
    cur = out;
  }

  const under: string[] = [];
  for (const e of effects) {
    switch (e.type) {
      case 'drop-shadow': {
        let src = 'SourceAlpha';
        if (e.spread) {
          const sp = r();
          parts.push(`<feMorphology in="SourceAlpha" operator="${e.spread > 0 ? 'dilate' : 'erode'}" radius="${num(Math.abs(e.spread))}" result="${sp}"/>`);
          src = sp;
        }
        const bl = r(), of = r(), fl = r(), out = r();
        parts.push(`<feGaussianBlur in="${src}" stdDeviation="${num(e.blur / 2)}" result="${bl}"/>`);
        parts.push(`<feOffset in="${bl}" dx="${num(e.x)}" dy="${num(e.y)}" result="${of}"/>`);
        const c = svgColor(e.color);
        parts.push(`<feFlood flood-color="${c.hex}" flood-opacity="${num(c.opacity * e.opacity)}" result="${fl}"/>`);
        parts.push(`<feComposite in="${fl}" in2="${of}" operator="in" result="${out}"/>`);
        under.push(out);
        break;
      }
      case 'outer-glow': {
        const di = r(), bl = r(), fl = r(), out = r();
        parts.push(`<feMorphology in="SourceAlpha" operator="dilate" radius="${num(e.radius)}" result="${di}"/>`);
        parts.push(`<feGaussianBlur in="${di}" stdDeviation="${num(e.blur / 2)}" result="${bl}"/>`);
        const c = svgColor(e.color);
        parts.push(`<feFlood flood-color="${c.hex}" flood-opacity="${num(c.opacity * e.opacity)}" result="${fl}"/>`);
        parts.push(`<feComposite in="${fl}" in2="${bl}" operator="in" result="${out}"/>`);
        under.push(out);
        break;
      }
      case 'outline': {
        const di = r(), fl = r(), out = r();
        parts.push(`<feMorphology in="SourceAlpha" operator="dilate" radius="${num(e.width)}" result="${di}"/>`);
        const c = svgColor(e.color);
        parts.push(`<feFlood flood-color="${c.hex}" flood-opacity="${num(c.opacity * e.opacity)}" result="${fl}"/>`);
        parts.push(`<feComposite in="${fl}" in2="${di}" operator="in" result="${out}"/>`);
        under.push(out);
        break;
      }
      case 'silhouette': {
        const fl = r(), sil = r(), out = r();
        const c = svgColor(e.color);
        parts.push(`<feFlood flood-color="${c.hex}" flood-opacity="${num(c.opacity * e.opacity)}" result="${fl}"/>`);
        parts.push(`<feComposite in="${fl}" in2="SourceAlpha" operator="in" result="${sil}"/>`);
        parts.push(`<feComposite in="${sil}" in2="${cur}" operator="over" result="${out}"/>`);
        cur = out;
        break;
      }
      case 'inner-shadow': {
        const inv = r(), of = r(), bl = r(), fl = r(), sh = r(), clip = r(), out = r();
        parts.push(transfer('SourceAlpha', inv, { a: 'type="table" tableValues="1 0"' }));
        parts.push(`<feOffset in="${inv}" dx="${num(e.x)}" dy="${num(e.y)}" result="${of}"/>`);
        parts.push(`<feGaussianBlur in="${of}" stdDeviation="${num(e.blur / 2)}" result="${bl}"/>`);
        const c = svgColor(e.color);
        parts.push(`<feFlood flood-color="${c.hex}" flood-opacity="${num(c.opacity * e.opacity)}" result="${fl}"/>`);
        parts.push(`<feComposite in="${fl}" in2="${bl}" operator="in" result="${sh}"/>`);
        parts.push(`<feComposite in="${sh}" in2="SourceAlpha" operator="in" result="${clip}"/>`);
        parts.push(`<feComposite in="${clip}" in2="${cur}" operator="over" result="${out}"/>`);
        cur = out;
        break;
      }
      case 'rim-light': {
        const rad = (e.angle * Math.PI) / 180;
        const dx = -Math.cos(rad) * e.width;
        const dy = Math.sin(rad) * e.width;
        const of = r(), inv = r(), band = r(), bl = r(), fl = r(), rim = r(), out = r();
        parts.push(`<feOffset in="SourceAlpha" dx="${num(dx)}" dy="${num(dy)}" result="${of}"/>`);
        parts.push(transfer(of, inv, { a: 'type="table" tableValues="1 0"' }));
        parts.push(`<feComposite in="${inv}" in2="SourceAlpha" operator="in" result="${band}"/>`);
        parts.push(`<feGaussianBlur in="${band}" stdDeviation="${num(e.blur / 2)}" result="${bl}"/>`);
        const c = svgColor(e.color);
        parts.push(`<feFlood flood-color="${c.hex}" flood-opacity="${num(c.opacity * e.opacity)}" result="${fl}"/>`);
        parts.push(`<feComposite in="${fl}" in2="${bl}" operator="in" result="${rim}"/>`);
        const rimClip = r();
        parts.push(`<feComposite in="${rim}" in2="SourceAlpha" operator="in" result="${rimClip}"/>`);
        const mode = ['screen', 'multiply', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion'].includes(e.blendMode) ? e.blendMode : 'normal';
        parts.push(`<feBlend in="${rimClip}" in2="${cur}" mode="${mode}" result="${out}"/>`);
        cur = out;
        break;
      }
    }
  }

  if (under.length) {
    parts.push(`<feMerge>${[...under].reverse().map((u) => `<feMergeNode in="${u}"/>`).join('')}<feMergeNode in="${cur}"/></feMerge>`);
  } else if (cur === 'SourceGraphic') {
    return null;
  } else {
    // Ensure the final primitive outputs cur
    parts.push(`<feMerge><feMergeNode in="${cur}"/></feMerge>`);
  }
  const mg = filterMargin(adjustments, effects) + 2;
  ctx.addDef(
    el(
      'filter',
      {
        id,
        filterUnits: 'userSpaceOnUse',
        primitiveUnits: 'userSpaceOnUse',
        x: num(-mg),
        y: num(-mg),
        width: num(w + mg * 2),
        height: num(h + mg * 2),
        'color-interpolation-filters': 'sRGB',
      },
      parts.join(''),
    ),
  );
  return { id, margin: mg };
}

export { toHex };
