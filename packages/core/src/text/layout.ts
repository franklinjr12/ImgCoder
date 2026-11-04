/**
 * Text layout: font fallback segmentation, shaping (fontkit: kerning/ligatures), tracking,
 * greedy line breaking (Latin word + CJK per-character breaks), alignment, max lines with
 * ellipsis, and shrink-to-fit. Produces glyph outlines so output is identical across
 * resvg, Chromium and PDF.
 */
import type { TextStyle } from '../udm/schema.js';
import { FontRegistry, isCJK, type RegisteredFont } from './fonts.js';

export interface PositionedRun {
  font: RegisteredFont;
  text: string;
  /** x of the run origin relative to the text box */
  x: number;
  /** baseline y relative to the text box */
  baseline: number;
  fontSize: number;
  glyphs: { id: number; x: number; advance: number }[];
  width: number;
}

export interface LayoutLine {
  runs: PositionedRun[];
  width: number;
  top: number;
  baseline: number;
  height: number;
  text: string;
}

export interface TextLayout {
  lines: LayoutLine[];
  width: number;
  height: number;
  fontSize: number;
  overflow: boolean;
}

interface Unit {
  text: string;
  /** shaped pieces (by font) */
  pieces: { font: RegisteredFont; text: string; glyphs: { id: number; advance: number }[]; width: number }[];
  width: number;
  trailingSpace: boolean;
  forcedBreak: boolean;
  spaceWidth: number;
}

export function applyTextTransform(text: string, t: TextStyle['textTransform']): string {
  switch (t) {
    case 'uppercase':
      return text.toUpperCase();
    case 'lowercase':
      return text.toLowerCase();
    case 'capitalize':
      return text.replace(/(^|\s|[-_/])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
    default:
      return text;
  }
}

const shapeCache = new Map<string, { id: number; advance: number }[]>();

function shape(font: RegisteredFont, text: string, fontSize: number, letterSpacing: number): { id: number; advance: number }[] {
  const key = `${font.family}|${font.weight}|${font.style}|${font.font.postscriptName}|${text}`;
  let base = shapeCache.get(key);
  if (!base) {
    const run = font.font.layout(text);
    base = run.glyphs.map((g, i) => ({ id: g.id, advance: run.positions[i].xAdvance }));
    if (shapeCache.size > 20000) shapeCache.clear();
    shapeCache.set(key, base);
  }
  const s = fontSize / font.font.unitsPerEm;
  return base.map((g) => ({ id: g.id, advance: g.advance * s + letterSpacing }));
}

function segmentByFont(text: string, stack: RegisteredFont[], registry: FontRegistry, locale: string | undefined, weight: number) {
  const out: { font: RegisteredFont; text: string }[] = [];
  for (const ch of text) {
    const f = /\s/.test(ch) ? out[out.length - 1]?.font ?? stack[0] : registry.fontForChar(ch, stack, locale, weight) ?? stack[0];
    if (!f) continue;
    const last = out[out.length - 1];
    if (last && last.font === f) last.text += ch;
    else out.push({ font: f, text: ch });
  }
  return out;
}

/** Split a paragraph into break units: words (with trailing spaces) or single CJK chars. */
function tokenize(paragraph: string): { text: string; space: string }[] {
  const tokens: { text: string; space: string }[] = [];
  let buf = '';
  const flush = (space = '') => {
    if (buf || space) tokens.push({ text: buf, space });
    buf = '';
  };
  const chars = [...paragraph];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === ' ' || ch === '\t') {
      let sp = ch;
      while (chars[i + 1] === ' ' || chars[i + 1] === '\t') sp += chars[++i];
      flush(sp);
    } else if (isCJK(ch)) {
      // Keep closing punctuation attached (kinsoku shori, simplified)
      if (buf && !isCJK(buf[buf.length - 1])) flush();
      buf += ch;
      const next = chars[i + 1];
      if (!next || !/[、。，．！？）」』】〕〉》ー・：；,.!?)]/.test(next)) flush();
    } else {
      if (buf && isCJK([...buf].pop()!)) flush();
      buf += ch;
      if (ch === '-' || ch === '/') flush();
    }
  }
  flush();
  return tokens;
}

export interface LayoutOptions {
  /** Maximum line width in px; Infinity = no wrapping */
  maxWidth?: number;
  maxHeight?: number;
  locale?: string;
}

function layoutAtSize(content: string, style: TextStyle, fontSize: number, registry: FontRegistry, opts: LayoutOptions): TextLayout {
  const stack = registry.resolveStack(style.fontFamily, style.fontWeight, style.fontStyle);
  if (!stack.length) throw new Error('No fonts registered: register at least one font in the FontRegistry before rendering text.');
  const text = applyTextTransform(content, style.textTransform);
  const maxWidth = style.wrap === false ? Infinity : opts.maxWidth ?? Infinity;
  const primary = stack[0].font;
  const scale = fontSize / primary.unitsPerEm;
  const ascent = primary.ascent * scale;
  const descent = -primary.descent * scale;
  const lineHeight = style.lineHeight * fontSize;
  const halfLeading = (lineHeight - (ascent + descent)) / 2;

  const units: Unit[] = [];
  const paragraphs = text.split(/\r?\n/);
  paragraphs.forEach((para, pi) => {
    const toks = tokenize(para);
    if (!toks.length) toks.push({ text: '', space: '' });
    toks.forEach((tok, ti) => {
      const pieces = segmentByFont(tok.text, stack, registry, opts.locale, style.fontWeight).map((seg) => {
        const glyphs = shape(seg.font, seg.text, fontSize, style.letterSpacing);
        return { font: seg.font, text: seg.text, glyphs, width: glyphs.reduce((a, g) => a + g.advance, 0) };
      });
      let spaceWidth = 0;
      if (tok.space) {
        const f = pieces[pieces.length - 1]?.font ?? stack[0];
        spaceWidth = shape(f, tok.space, fontSize, style.letterSpacing).reduce((a, g) => a + g.advance, 0);
      }
      units.push({
        text: tok.text,
        pieces,
        width: pieces.reduce((a, p) => a + p.width, 0),
        trailingSpace: !!tok.space,
        spaceWidth,
        forcedBreak: ti === toks.length - 1 && pi < paragraphs.length - 1,
      });
    });
  });

  // Greedy line breaking
  type DraftLine = { units: Unit[]; width: number };
  const lines: DraftLine[] = [];
  let cur: DraftLine = { units: [], width: 0 };
  let overflow = false;
  for (const u of units) {
    const prevSpace = cur.units.length ? cur.units[cur.units.length - 1].spaceWidth : 0;
    const needed = cur.width + prevSpace + u.width;
    if (cur.units.length && needed > maxWidth + 0.01) {
      lines.push(cur);
      cur = { units: [], width: 0 };
    }
    const sp = cur.units.length ? cur.units[cur.units.length - 1].spaceWidth : 0;
    cur.width += sp + u.width;
    cur.units.push(u);
    if (u.width > maxWidth + 0.01) overflow = true;
    if (u.forcedBreak) {
      lines.push(cur);
      cur = { units: [], width: 0 };
    }
  }
  if (cur.units.length || !lines.length) lines.push(cur);

  // Max lines with ellipsis
  let truncated = lines;
  if (style.maxLines && lines.length > style.maxLines) {
    truncated = lines.slice(0, style.maxLines);
    overflow = true;
    const last = truncated[truncated.length - 1];
    const ell = shape(stack[0], '…', fontSize, style.letterSpacing);
    const ellW = ell.reduce((a, g) => a + g.advance, 0);
    while (last.units.length > 1 && last.width + ellW > maxWidth) {
      const u = last.units.pop()!;
      last.width -= u.width + (last.units[last.units.length - 1]?.spaceWidth ?? 0);
    }
    last.units.push({ text: '…', pieces: [{ font: stack[0], text: '…', glyphs: ell, width: ellW }], width: ellW, trailingSpace: false, spaceWidth: 0, forcedBreak: false });
    last.width += ellW;
  }

  const out: LayoutLine[] = [];
  let y = 0;
  let maxLineW = 0;
  for (const dl of truncated) {
    const baseline = y + halfLeading + ascent;
    const runs: PositionedRun[] = [];
    let x = 0;
    let lineText = '';
    dl.units.forEach((u, ui) => {
      for (const p of u.pieces) {
        let gx = 0;
        const glyphs = p.glyphs.map((g) => {
          const pos = { id: g.id, x: gx, advance: g.advance };
          gx += g.advance;
          return pos;
        });
        runs.push({ font: p.font, text: p.text, x, baseline, fontSize, glyphs, width: p.width });
        x += p.width;
      }
      lineText += u.text;
      if (ui < dl.units.length - 1) {
        x += u.spaceWidth;
        lineText += ' ';
      }
    });
    // trailing letterSpacing should not count towards alignment
    const width = Math.max(0, dl.width - (dl.units.length ? style.letterSpacing : 0));
    maxLineW = Math.max(maxLineW, width);
    out.push({ runs, width, top: y, baseline, height: lineHeight, text: lineText });
    y += lineHeight;
  }
  const height = y;
  if (opts.maxHeight != null && height > opts.maxHeight + 0.5) overflow = true;
  return { lines: out, width: maxLineW, height, fontSize, overflow };
}

export function layoutText(content: string, style: TextStyle, registry: FontRegistry, opts: LayoutOptions = {}): TextLayout {
  let layout = layoutAtSize(content, style, style.fontSize, registry, opts);
  if (style.fit === 'shrink' && layout.overflow) {
    let lo = Math.max(1, style.minFontSize);
    let hi = style.fontSize;
    let best = layoutAtSize(content, style, lo, registry, opts);
    for (let i = 0; i < 12 && hi - lo > 0.25; i++) {
      const mid = (lo + hi) / 2;
      const l = layoutAtSize(content, style, mid, registry, opts);
      if (l.overflow) hi = mid;
      else {
        lo = mid;
        best = l;
      }
    }
    layout = best;
  }
  return layout;
}

/** Horizontal offset of a line inside a box for the given alignment. */
export function alignOffset(lineWidth: number, boxWidth: number, align: TextStyle['textAlign']): number {
  if (!isFinite(boxWidth)) return 0;
  if (align === 'center') return (boxWidth - lineWidth) / 2;
  if (align === 'right') return boxWidth - lineWidth;
  return 0;
}

export function verticalOffset(contentHeight: number, boxHeight: number, align: TextStyle['verticalAlign']): number {
  if (align === 'middle') return (boxHeight - contentHeight) / 2;
  if (align === 'bottom') return boxHeight - contentHeight;
  return 0;
}

const glyphPathCache = new WeakMap<object, Map<number, any[]>>();

function glyphCommands(font: RegisteredFont, id: number): any[] {
  let m = glyphPathCache.get(font.font);
  if (!m) {
    m = new Map();
    glyphPathCache.set(font.font, m);
  }
  let cmds = m.get(id);
  if (!cmds) {
    cmds = font.font.getGlyph(id).path.commands;
    m.set(id, cmds);
  }
  return cmds;
}

const f3 = (n: number) => {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};

/**
 * Convert a layout to an SVG path `d` in box coordinates. `skew` synthesises italics when the
 * family has no italic face.
 */
export function layoutToPath(layout: TextLayout, boxWidth: number, boxHeight: number, style: TextStyle): string {
  const parts: string[] = [];
  const yOff = verticalOffset(layout.height, boxHeight, style.verticalAlign);
  for (const line of layout.lines) {
    let xOff = alignOffset(line.width, boxWidth, style.textAlign);
    let extraPerGap = 0;
    if (style.textAlign === 'justify' && line !== layout.lines[layout.lines.length - 1]) {
      const gaps = Math.max(1, line.text.split(' ').length - 1);
      extraPerGap = (boxWidth - line.width) / gaps;
      xOff = 0;
    }
    let gapIndex = 0;
    let lastRunEnd = 0;
    for (const run of line.runs) {
      if (extraPerGap && run.x > lastRunEnd + 0.01) gapIndex++;
      lastRunEnd = run.x + run.width;
      const s = run.fontSize / run.font.font.unitsPerEm;
      const synthItalic = style.fontStyle === 'italic' && run.font.style !== 'italic';
      for (const g of run.glyphs) {
        const ox = xOff + run.x + g.x + gapIndex * extraPerGap;
        const oy = yOff + run.baseline;
        const cmds = glyphCommands(run.font, g.id);
        if (!cmds.length) continue;
        const tx = (x: number, y: number) => {
          const px = x * s;
          const py = y * s;
          return `${f3(ox + px + (synthItalic ? py * 0.2 : 0))} ${f3(oy - py)}`;
        };
        for (const c of cmds) {
          const a = c.args;
          switch (c.command) {
            case 'moveTo':
              parts.push(`M${tx(a[0], a[1])}`);
              break;
            case 'lineTo':
              parts.push(`L${tx(a[0], a[1])}`);
              break;
            case 'quadraticCurveTo':
              parts.push(`Q${tx(a[0], a[1])} ${tx(a[2], a[3])}`);
              break;
            case 'bezierCurveTo':
              parts.push(`C${tx(a[0], a[1])} ${tx(a[2], a[3])} ${tx(a[4], a[5])}`);
              break;
            case 'closePath':
              parts.push('Z');
              break;
          }
        }
      }
    }
  }
  return parts.join('');
}

/** Measure text without a box (used by the JSX layout engine). */
export function measureText(content: string, style: TextStyle, registry: FontRegistry, maxWidth = Infinity, locale?: string): { width: number; height: number } {
  const l = layoutText(content, style, registry, { maxWidth, locale });
  return { width: l.width, height: l.height };
}
