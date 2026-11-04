/**
 * Minimal CSS value parsing for the JSX authoring surface: lengths, gradients, shadows,
 * filters, transforms and borders → UDM structures.
 */
import { parseColor } from '../color.js';
import type { Adjustment, Effect, Fill, GradientStop, Stroke } from '../udm/schema.js';

/** Split on commas/whitespace that are not inside parentheses. */
export function splitTopLevel(input: string, sep: ',' | ' ' = ','): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = '';
  for (const ch of input) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    const isSep = sep === ' ' ? /\s/.test(ch) : ch === sep;
    if (isSep && depth === 0) {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
    } else buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

export function parseLength(v: unknown, base = 0, fontSize = 16): number | undefined {
  if (v == null || v === '') return undefined;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  const m = /^(-?\d*\.?\d+)(px|%|em|rem|deg|turn|rad)?$/.exec(s);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  switch (m[2]) {
    case '%':
      return (n / 100) * base;
    case 'em':
    case 'rem':
      return n * fontSize;
    case 'turn':
      return n * 360;
    case 'rad':
      return (n * 180) / Math.PI;
    default:
      return n;
  }
}

export function parseAngle(v: string): number {
  const s = v.trim();
  const dirs: Record<string, number> = {
    'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270,
    'to top right': 45, 'to right top': 45, 'to bottom right': 135, 'to right bottom': 135,
    'to bottom left': 225, 'to left bottom': 225, 'to top left': 315, 'to left top': 315,
  };
  if (dirs[s] != null) return dirs[s];
  return parseLength(s) ?? 180;
}

function parseStops(parts: string[]): GradientStop[] {
  const raw = parts.map((p) => {
    const tokens = splitTopLevel(p, ' ');
    const color = tokens[0];
    const pos = tokens[1];
    return { color, offset: pos != null ? (pos.endsWith('%') ? parseFloat(pos) / 100 : parseFloat(pos)) : undefined };
  });
  return raw.map((s, i) => ({
    color: s.color,
    offset: s.offset ?? (raw.length === 1 ? 0 : i / (raw.length - 1)),
  }));
}

/** Parse `linear-gradient(...)`, `radial-gradient(...)` or a colour into a Fill. */
export function parseFill(input: unknown): Fill | undefined {
  if (input == null) return undefined;
  if (typeof input === 'object') return input as Fill;
  const s = String(input).trim();
  const lg = /^(?:repeating-)?linear-gradient\((.*)\)$/s.exec(s);
  if (lg) {
    const parts = splitTopLevel(lg[1]);
    let angle = 180;
    if (parts[0] && (/^-?[\d.]+(deg|turn|rad)$/.test(parts[0]) || parts[0].startsWith('to '))) angle = parseAngle(parts.shift()!);
    return { type: 'linear-gradient', angle, stops: parseStops(parts) };
  }
  const rg = /^(?:repeating-)?radial-gradient\((.*)\)$/s.exec(s);
  if (rg) {
    const parts = splitTopLevel(rg[1]);
    let cx = 0.5, cy = 0.5, r = 0.5;
    if (parts[0] && !parseColor(splitTopLevel(parts[0], ' ')[0])) {
      const head = parts.shift()!;
      const at = /at\s+(\S+)\s+(\S+)/.exec(head);
      if (at) {
        cx = at[1].endsWith('%') ? parseFloat(at[1]) / 100 : at[1] === 'left' ? 0 : at[1] === 'right' ? 1 : 0.5;
        cy = at[2].endsWith('%') ? parseFloat(at[2]) / 100 : at[2] === 'top' ? 0 : at[2] === 'bottom' ? 1 : 0.5;
      }
      const size = /(\d+(?:\.\d+)?)%/.exec(head.split('at')[0]);
      if (size) r = parseFloat(size[1]) / 100;
      else if (/closest-side/.test(head)) r = 0.5;
      else r = 0.71;
    }
    return { type: 'radial-gradient', cx, cy, r, stops: parseStops(parts) };
  }
  if (parseColor(s)) return { type: 'solid', color: s };
  return undefined;
}

/** `0 4px 12px rgba(0,0,0,.8), 0 0 2px #000` → shadows. Works for box-shadow & text-shadow. */
export function parseShadows(input: string | undefined): Effect[] {
  if (!input || input === 'none') return [];
  return splitTopLevel(input).map((part) => {
    const tokens = splitTopLevel(part, ' ');
    const inset = tokens.includes('inset');
    const colorTok = tokens.find((t) => t !== 'inset' && parseLength(t) === undefined) ?? 'rgba(0,0,0,0.5)';
    const lens = tokens.filter((t) => t !== 'inset' && t !== colorTok).map((t) => parseLength(t) ?? 0);
    const [x = 0, y = 0, blur = 0, spread = 0] = lens;
    return { type: inset ? 'inner-shadow' : 'drop-shadow', x, y, blur, spread, color: colorTok, opacity: 1 } as Effect;
  });
}

/** CSS `filter` → adjustments + drop-shadow effects. */
export function parseFilter(input: string | undefined): { adjustments: Adjustment[]; effects: Effect[] } {
  const adjustments: Adjustment[] = [];
  const effects: Effect[] = [];
  if (!input || input === 'none') return { adjustments, effects };
  const re = /([a-z-]+)\(([^()]*(?:\([^()]*\)[^()]*)*)\)/gi;
  let m: RegExpExecArray | null;
  const amount = (v: string, d = 1) => {
    if (!v.trim()) return d;
    return v.trim().endsWith('%') ? parseFloat(v) / 100 : parseFloat(v);
  };
  while ((m = re.exec(input))) {
    const fn = m[1].toLowerCase();
    const arg = m[2];
    switch (fn) {
      case 'brightness':
      case 'contrast':
      case 'saturate':
        adjustments.push({ type: fn, value: amount(arg) } as Adjustment);
        break;
      case 'grayscale':
      case 'sepia':
      case 'invert':
        adjustments.push({ type: fn, value: Math.min(1, amount(arg)) } as Adjustment);
        break;
      case 'hue-rotate':
        adjustments.push({ type: 'hue-rotate', value: parseLength(arg.trim()) ?? 0 });
        break;
      case 'blur':
        adjustments.push({ type: 'blur', radius: parseLength(arg.trim()) ?? 0 });
        break;
      case 'opacity':
        break;
      case 'drop-shadow':
        effects.push(...parseShadows(arg));
        break;
    }
  }
  return { adjustments, effects };
}

export interface ParsedTransform {
  tx: number;
  ty: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  skewX: number;
  skewY: number;
}

/** CSS `transform` → decomposed TRS (translate, rotate, scale, skew). */
export function parseCssTransform(input: string | undefined, w = 0, h = 0): ParsedTransform {
  const t: ParsedTransform = { tx: 0, ty: 0, rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 };
  if (!input || input === 'none') return t;
  const re = /([a-zA-Z0-9]+)\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) {
    const args = m[2].split(/[\s,]+/).filter(Boolean);
    switch (m[1]) {
      case 'translate':
        t.tx += parseLength(args[0], w) ?? 0;
        t.ty += parseLength(args[1] ?? '0', h) ?? 0;
        break;
      case 'translateX':
        t.tx += parseLength(args[0], w) ?? 0;
        break;
      case 'translateY':
        t.ty += parseLength(args[0], h) ?? 0;
        break;
      case 'rotate':
      case 'rotateZ':
        t.rotation += parseLength(args[0]) ?? 0;
        break;
      case 'scale':
        t.scaleX *= parseFloat(args[0]);
        t.scaleY *= parseFloat(args[1] ?? args[0]);
        break;
      case 'scaleX':
        t.scaleX *= parseFloat(args[0]);
        break;
      case 'scaleY':
        t.scaleY *= parseFloat(args[0]);
        break;
      case 'skew':
        t.skewX += parseLength(args[0]) ?? 0;
        t.skewY += parseLength(args[1] ?? '0') ?? 0;
        break;
      case 'skewX':
        t.skewX += parseLength(args[0]) ?? 0;
        break;
      case 'skewY':
        t.skewY += parseLength(args[0]) ?? 0;
        break;
    }
  }
  return t;
}

/** `2px solid #fff` → Stroke */
export function parseBorder(input: string | undefined): Stroke | undefined {
  if (!input || input === 'none') return undefined;
  const tokens = splitTopLevel(input, ' ');
  const width = tokens.map((t) => parseLength(t)).find((n) => n !== undefined) ?? 1;
  const color = tokens.find((t) => parseColor(t)) ?? '#000000';
  const dashed = tokens.includes('dashed') ? [width * 3, width * 2] : tokens.includes('dotted') ? [width, width] : undefined;
  return { color, width, dash: dashed, cap: 'butt', join: 'miter', align: 'center' };
}

/** `-webkit-text-stroke: 3px #000` → Stroke */
export function parseTextStroke(input: string | undefined): Stroke | undefined {
  if (!input) return undefined;
  const tokens = splitTopLevel(input, ' ');
  const width = parseLength(tokens[0]) ?? 1;
  return { color: tokens[1] ?? '#000000', width: width / 2, cap: 'round', join: 'round', align: 'outside' };
}

export function parseObjectPosition(input: string | undefined): { x: number; y: number } {
  if (!input) return { x: 0.5, y: 0.5 };
  const kw: Record<string, number> = { left: 0, top: 0, center: 0.5, right: 1, bottom: 1 };
  const [a = 'center', b = 'center'] = input.trim().split(/\s+/);
  const val = (t: string) => (kw[t] != null ? kw[t] : t.endsWith('%') ? parseFloat(t) / 100 : 0.5);
  let x = val(a), y = val(b);
  if (a === 'top' || a === 'bottom') [x, y] = [val(b), val(a)];
  return { x, y };
}
