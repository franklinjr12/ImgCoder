/**
 * Color parsing/normalisation. Every color that reaches the SVG emitter is normalised to
 * `#rrggbb` + separate opacity so resvg, browsers and PDF converters agree exactly.
 */
export interface RGBA {
  r: number; // 0..255
  g: number;
  b: number;
  a: number; // 0..1
}

const NAMED: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff',
  yellow: '#ffff00', cyan: '#00ffff', aqua: '#00ffff', magenta: '#ff00ff', fuchsia: '#ff00ff',
  gray: '#808080', grey: '#808080', silver: '#c0c0c0', maroon: '#800000', olive: '#808000',
  lime: '#00ff00', teal: '#008080', navy: '#000080', purple: '#800080', orange: '#ffa500',
  gold: '#ffd700', pink: '#ffc0cb', crimson: '#dc143c', coral: '#ff7f50', tomato: '#ff6347',
  orangered: '#ff4500', hotpink: '#ff69b4', deeppink: '#ff1493', indigo: '#4b0082',
  violet: '#ee82ee', turquoise: '#40e0d0', skyblue: '#87ceeb', royalblue: '#4169e1',
  dodgerblue: '#1e90ff', steelblue: '#4682b4', slategray: '#708090', darkgray: '#a9a9a9',
  darkgrey: '#a9a9a9', lightgray: '#d3d3d3', lightgrey: '#d3d3d3', dimgray: '#696969',
  whitesmoke: '#f5f5f5', beige: '#f5f5dc', brown: '#a52a2a', chocolate: '#d2691e',
  firebrick: '#b22222', darkred: '#8b0000', darkblue: '#00008b', darkgreen: '#006400',
  limegreen: '#32cd32', springgreen: '#00ff7f', chartreuse: '#7fff00', khaki: '#f0e68c',
  salmon: '#fa8072', plum: '#dda0dd', orchid: '#da70d6', tan: '#d2b48c', ivory: '#fffff0',
  lavender: '#e6e6fa', midnightblue: '#191970', darkslategray: '#2f4f4f', goldenrod: '#daa520',
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function parseComponent(token: string, max: number): number {
  token = token.trim();
  if (token.endsWith('%')) return (parseFloat(token) / 100) * max;
  return parseFloat(token);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb: [number, number, number];
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return [(rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255];
}

/** Parse any CSS color (hex 3/4/6/8, rgb[a], hsl[a], named, transparent). Returns null if unparseable. */
export function parseColor(input: string | null | undefined): RGBA | null {
  if (input == null) return null;
  let s = String(input).trim().toLowerCase();
  if (!s) return null;
  if (s === 'transparent' || s === 'none') return { r: 0, g: 0, b: 0, a: 0 };
  if (s === 'currentcolor') return null;
  if (NAMED[s]) s = NAMED[s];
  if (s.startsWith('#')) {
    let hex = s.slice(1);
    if (!/^[0-9a-f]+$/.test(hex)) return null;
    if (hex.length === 3 || hex.length === 4) hex = hex.split('').map((c) => c + c).join('');
    if (hex.length !== 6 && hex.length !== 8) return null;
    const n = (i: number) => parseInt(hex.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: hex.length === 8 ? n(6) / 255 : 1 };
  }
  const fn = /^(rgba?|hsla?)\((.*)\)$/.exec(s);
  if (fn) {
    const kind = fn[1];
    const body = fn[2].replace(/\s*\/\s*/, ',').replace(/\s*,\s*/g, ',').trim();
    const parts = body.includes(',') ? body.split(',') : body.split(/\s+/);
    if (parts.length < 3) return null;
    const alpha = parts[3] != null ? clamp(parseComponent(parts[3], 1), 0, 1) : 1;
    if (kind.startsWith('rgb')) {
      return {
        r: clamp(parseComponent(parts[0], 255), 0, 255),
        g: clamp(parseComponent(parts[1], 255), 0, 255),
        b: clamp(parseComponent(parts[2], 255), 0, 255),
        a: alpha,
      };
    }
    const h = parseFloat(parts[0]);
    const sat = clamp(parseFloat(parts[1]) / 100, 0, 1);
    const lig = clamp(parseFloat(parts[2]) / 100, 0, 1);
    const [r, g, b] = hslToRgb(h, sat, lig);
    return { r, g, b, a: alpha };
  }
  return null;
}

const hex2 = (v: number) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');

export function toHex(c: RGBA, withAlpha = false): string {
  return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}${withAlpha && c.a < 1 ? hex2(c.a * 255) : ''}`;
}

/** Normalise to `{ hex: '#rrggbb', opacity }` for SVG attributes. Unparseable → black. */
export function svgColor(input: string | null | undefined): { hex: string; opacity: number } {
  const c = parseColor(input);
  if (!c) return { hex: '#000000', opacity: 1 };
  return { hex: toHex(c), opacity: Math.round(c.a * 1000) / 1000 };
}

export function isColor(input: string): boolean {
  return parseColor(input) !== null;
}

export function withAlpha(input: string, alpha: number): string {
  const c = parseColor(input) ?? { r: 0, g: 0, b: 0, a: 1 };
  return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${clamp(alpha, 0, 1)})`;
}

/** Relative luminance (sRGB, 0..1). */
export function luminance(c: RGBA): number {
  const ch = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

export function contrastRatio(a: string, b: string): number {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return 1;
  const la = luminance(ca);
  const lb = luminance(cb);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function mixColors(a: string, b: string, t: number): string {
  const ca = parseColor(a) ?? { r: 0, g: 0, b: 0, a: 1 };
  const cb = parseColor(b) ?? { r: 0, g: 0, b: 0, a: 1 };
  const l = (x: number, y: number) => x + (y - x) * t;
  return toHex({ r: l(ca.r, cb.r), g: l(ca.g, cb.g), b: l(ca.b, cb.b), a: l(ca.a, cb.a) }, true);
}
