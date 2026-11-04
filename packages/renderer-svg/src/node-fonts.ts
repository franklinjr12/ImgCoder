import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { FontRegistry } from '@game-artisan/core';
import { BUNDLED_FONTS } from '@game-artisan/fonts';
import { fileURLToPath } from 'node:url';

export interface NodeFontOptions {
  /** Load the bundled OFL fonts (Inter, Cinzel, Bebas Neue, Press Start 2P). Default true. */
  bundled?: boolean;
  /** Extra font files (TTF/OTF/WOFF/WOFF2/TTC), or `{ path, family?, weight?, style?, locales?, fallback? }` objects. */
  files?: (string | { path: string; family?: string; weight?: number; style?: 'normal' | 'italic'; locales?: string[]; fallback?: boolean })[];
  /** Directories scanned recursively for font files. */
  dirs?: string[];
  /**
   * System font fallback: 'cjk' (default) registers system CJK fonts as locale-aware
   * fallbacks, 'all' registers every system font, false disables.
   */
  systemFallback?: 'cjk' | 'all' | false;
  defaultFamily?: string;
}

const FONT_EXT = /\.(ttf|otf|woff2?|ttc)$/i;

export function systemFontDirs(): string[] {
  const home = os.homedir();
  switch (process.platform) {
    case 'darwin':
      return ['/System/Library/Fonts', '/Library/Fonts', path.join(home, 'Library/Fonts')];
    case 'win32':
      return [path.join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts'), path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft/Windows/Fonts')];
    default:
      return ['/usr/share/fonts', '/usr/local/share/fonts', path.join(home, '.fonts'), path.join(home, '.local/share/fonts')];
  }
}

async function scan(dir: string, out: string[], depth = 0): Promise<void> {
  if (depth > 6 || !existsSync(dir)) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await scan(p, out, depth + 1);
    else if (FONT_EXT.test(e.name)) out.push(p);
  }
}

const CJK_NAME = /(cjk|noto\s?sans\s?(sc|tc|jp|kr|hk)|noto\s?serif\s?(sc|tc|jp|kr)|wqy|wenquanyi|source\s?han|droid\s?sans\s?fallback|ms\s?gothic|meiryo|yu\s?gothic|simhei|simsun|msyh|malgun|pingfang|hiragino|apple\s?sd\s?gothic|nanum|ipa|takao|vl\s?gothic|unifont)/i;

function localesForName(name: string): string[] | undefined {
  const n = name.toLowerCase();
  if (/(sc|zh[-_]?cn|simhei|simsun|msyh|wqy|wenquanyi|pingfang sc|hans)/.test(n)) return ['zh-CN', 'zh'];
  if (/(tc|hk|zh[-_]?tw|hant)/.test(n)) return ['zh-TW', 'zh-HK'];
  if (/(jp|ja|gothic|meiryo|hiragino|ipa|takao|mincho)/.test(n)) return ['ja'];
  if (/(kr|ko|malgun|nanum|apple sd)/.test(n)) return ['ko'];
  return undefined;
}

let cachedSystemCjk: string[] | null = null;

export async function findSystemFonts(filter?: RegExp): Promise<string[]> {
  const out: string[] = [];
  for (const d of systemFontDirs()) await scan(d, out);
  return filter ? out.filter((f) => filter.test(path.basename(f))) : out;
}

/** Build a FontRegistry for Node renders (bundled + project + system fallback fonts). */
export async function createNodeFontRegistry(opts: NodeFontOptions = {}): Promise<FontRegistry> {
  const reg = new FontRegistry();
  if (opts.defaultFamily) reg.defaultFamily = opts.defaultFamily;
  if (opts.bundled !== false) {
    await Promise.all(
      BUNDLED_FONTS.map(async (f) => {
        const data = new Uint8Array(await readFile(fileURLToPath(f.url)));
        reg.register(data, { family: f.family, weight: f.weight, style: f.style, source: f.file });
      }),
    );
  }
  const files: Exclude<NodeFontOptions['files'], undefined> = [...(opts.files ?? [])];
  for (const d of opts.dirs ?? []) {
    const found: string[] = [];
    await scan(d, found);
    files.push(...found);
  }
  for (const f of files) {
    const spec = typeof f === 'string' ? { path: f } : f;
    try {
      const data = new Uint8Array(await readFile(spec.path));
      reg.register(data, { family: spec.family, weight: spec.weight, style: spec.style, locales: spec.locales, fallback: spec.fallback, source: spec.path });
    } catch (e) {
      throw new Error(`Failed to load font ${spec.path}: ${(e as Error).message}`);
    }
  }
  const sys = opts.systemFallback ?? 'cjk';
  if (sys) {
    if (sys === 'cjk') {
      cachedSystemCjk ??= await findSystemFonts(CJK_NAME);
    }
    const list = sys === 'cjk' ? cachedSystemCjk! : await findSystemFonts();
    for (const p of list) {
      try {
        const data = new Uint8Array(await readFile(p));
        reg.register(data, { fallback: true, locales: localesForName(path.basename(p)), source: p });
      } catch {
        /* skip unreadable/unsupported system fonts */
      }
    }
  }
  return reg;
}
