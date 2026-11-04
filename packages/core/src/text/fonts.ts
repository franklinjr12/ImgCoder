/**
 * Font registry backed by fontkit (TTF/OTF/WOFF/WOFF2/TTC). Browser + Node safe: fonts are
 * registered from raw bytes. Handles weight/style matching and per-glyph fallback, including
 * locale-aware CJK fallback.
 */
import * as fontkit from 'fontkit';

export type FkFont = fontkit.Font;

export interface RegisteredFont {
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  font: FkFont;
  /** Locales this font is preferred for during fallback (e.g. ['ja'], ['zh-CN']). */
  locales?: string[];
  /** Original bytes (needed to embed @font-face in standalone SVG exports). */
  data?: Uint8Array;
  format?: string;
  source?: string;
}

export interface RegisterFontOptions {
  family?: string;
  weight?: number;
  style?: 'normal' | 'italic';
  locales?: string[];
  /** Add to the global fallback chain (searched when a glyph is missing). */
  fallback?: boolean;
  source?: string;
  /** For collections (.ttc): postscript name or index of the face to use. Default: all faces. */
  face?: string | number;
}

const CJK_RE = /[⺀-⿿　-〿぀-ヿ㄀-ㄯ㄰-㆏ㇰ-ㇿ㐀-䶿一-鿿가-힯豈-﫿＀-￯]/;
const HANGUL_RE = /[ᄀ-ᇿ㄰-㆏가-힯]/;
const KANA_RE = /[぀-ヿㇰ-ㇿ]/;

export function isCJK(ch: string): boolean {
  return CJK_RE.test(ch);
}

export function detectScript(text: string): 'latin' | 'han' | 'kana' | 'hangul' | 'mixed-cjk' {
  const hasHangul = HANGUL_RE.test(text);
  const hasKana = KANA_RE.test(text);
  const hasCjk = CJK_RE.test(text);
  if (hasHangul && !hasKana) return 'hangul';
  if (hasKana) return 'kana';
  if (hasCjk) return 'han';
  return 'latin';
}

function sniffFormat(data: Uint8Array): string {
  const sig = String.fromCharCode(data[0], data[1], data[2], data[3]);
  if (sig === 'wOFF') return 'woff';
  if (sig === 'wOF2') return 'woff2';
  if (sig === 'ttcf') return 'ttc';
  if (sig === 'OTTO') return 'otf';
  return 'ttf';
}

function weightFromSubfamily(sub: string): number {
  const s = sub.toLowerCase();
  if (/thin|hairline/.test(s)) return 100;
  if (/extra ?light|ultra ?light/.test(s)) return 200;
  if (/light/.test(s)) return 300;
  if (/medium/.test(s)) return 500;
  if (/semi ?bold|demi ?bold/.test(s)) return 600;
  if (/extra ?bold|ultra ?bold/.test(s)) return 800;
  if (/black|heavy/.test(s)) return 900;
  if (/bold/.test(s)) return 700;
  return 400;
}

/** Typographic family (name ID 16) when present, so "Inter Black" registers as family "Inter" @ 900. */
function preferredFamily(font: FkFont): string {
  const anyFont = font as any;
  const pref = anyFont.getName?.('preferredFamily');
  return (typeof pref === 'string' && pref) || font.familyName;
}

const norm = (f: string) => f.trim().replace(/^['"]|['"]$/g, '').toLowerCase();

const toBytes = (data: Uint8Array | ArrayBuffer): Uint8Array => (data instanceof Uint8Array ? data : new Uint8Array(data));

function createFont(bytes: Uint8Array): FkFont | fontkit.FontCollection {
  // fontkit expects a Buffer-like; Uint8Array works in v2 (Buffer in Node is a Uint8Array subclass).
  const B: any = (globalThis as any).Buffer;
  const input = B && !(bytes instanceof B) ? B.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) : bytes;
  return fontkit.create(input as any) as any;
}

export class FontRegistry {
  private fonts: RegisteredFont[] = [];
  private fallbacks: RegisteredFont[] = [];
  /** Family used when nothing in a font-family list is registered. */
  defaultFamily = 'Inter';
  private version = 0;

  get size(): number {
    return this.fonts.length;
  }

  /** Monotonic counter bumped on every registration (for layout caches). */
  get revision(): number {
    return this.version;
  }

  list(): Omit<RegisteredFont, 'font' | 'data'>[] {
    return this.fonts.map(({ font, data, ...rest }) => rest);
  }

  families(): string[] {
    return [...new Set(this.fonts.map((f) => f.family))];
  }

  /** Register a font file's bytes. Returns the registered faces (collections can yield several). */
  register(data: Uint8Array | ArrayBuffer, opts: RegisterFontOptions = {}): RegisteredFont[] {
    const bytes = toBytes(data);
    const created = createFont(bytes);
    const faces: FkFont[] = (created as any).type === 'TTC' || (created as any).fonts ? (created as any).fonts : [created as FkFont];
    const selected = opts.face == null ? faces : faces.filter((f, i) => (typeof opts.face === 'number' ? i === opts.face : f.postscriptName === opts.face));
    const out: RegisteredFont[] = [];
    for (const font of selected) {
      const sub = (font as any).subfamilyName ?? '';
      const reg: RegisteredFont = {
        family: opts.family ?? preferredFamily(font),
        weight: opts.weight ?? (font as any)['OS/2']?.usWeightClass ?? weightFromSubfamily(sub),
        style: opts.style ?? (/italic|oblique/i.test(sub) ? 'italic' : 'normal'),
        font,
        locales: opts.locales,
        data: selected.length === 1 ? bytes : undefined,
        format: sniffFormat(bytes),
        source: opts.source,
      };
      this.fonts.push(reg);
      if (opts.fallback) this.fallbacks.push(reg);
      out.push(reg);
    }
    this.version++;
    return out;
  }

  addFallback(family: string): void {
    for (const f of this.fonts) if (norm(f.family) === norm(family) && !this.fallbacks.includes(f)) this.fallbacks.push(f);
    this.version++;
  }

  has(family: string): boolean {
    const n = norm(family);
    return this.fonts.some((f) => norm(f.family) === n);
  }

  /** Best face for a family by CSS weight/style matching rules. */
  match(family: string, weight = 400, style: 'normal' | 'italic' = 'normal'): RegisteredFont | null {
    const n = norm(family);
    const cands = this.fonts.filter((f) => norm(f.family) === n);
    if (!cands.length) return null;
    const styled = cands.filter((f) => f.style === style);
    const pool = styled.length ? styled : cands;
    return pool.reduce((best, f) => {
      const d = Math.abs(f.weight - weight) + (weight >= 500 && f.weight < weight ? 50 : 0);
      const bd = Math.abs(best.weight - weight) + (weight >= 500 && best.weight < weight ? 50 : 0);
      return d < bd ? f : best;
    });
  }

  /** Resolve a CSS font-family list to an ordered list of faces. */
  resolveStack(fontFamily: string, weight = 400, style: 'normal' | 'italic' = 'normal'): RegisteredFont[] {
    const out: RegisteredFont[] = [];
    for (const fam of fontFamily.split(',')) {
      const name = norm(fam);
      if (!name || ['sans-serif', 'serif', 'monospace', 'system-ui', 'cursive', 'fantasy'].includes(name)) continue;
      const m = this.match(name, weight, style);
      if (m && !out.includes(m)) out.push(m);
    }
    if (!out.length) {
      const d = this.match(this.defaultFamily, weight, style) ?? this.fonts[0];
      if (d) out.push(d);
    }
    return out;
  }

  /** Pick the face that renders `ch`: stack first, then locale-preferred fallbacks, then any font. */
  fontForChar(ch: string, stack: RegisteredFont[], locale?: string, weight = 400): RegisteredFont | null {
    const cp = ch.codePointAt(0)!;
    for (const f of stack) if (f.font.hasGlyphForCodePoint(cp)) return f;
    const loc = locale?.toLowerCase();
    const fallbackPool = [...this.fallbacks, ...this.fonts.filter((f) => !this.fallbacks.includes(f))];
    const scored = fallbackPool
      .filter((f) => f.font.hasGlyphForCodePoint(cp))
      .map((f) => {
        let score = 0;
        if (loc && f.locales?.some((l) => loc.startsWith(l.toLowerCase()) || l.toLowerCase().startsWith(loc.split('-')[0]))) score -= 1000;
        if (this.fallbacks.includes(f)) score -= 100;
        score += Math.abs(f.weight - weight) / 10;
        return { f, score };
      })
      .sort((a, b) => a.score - b.score);
    return scored[0]?.f ?? stack[0] ?? null;
  }

  clone(): FontRegistry {
    const r = new FontRegistry();
    r.fonts = [...this.fonts];
    r.fallbacks = [...this.fallbacks];
    r.defaultFamily = this.defaultFamily;
    return r;
  }
}
