/**
 * Browser font registry: bundled OFL fonts (`loadBundledFonts()` — served by Vite from
 * @game-artisan/fonts), project fonts + system CJK fallbacks from the dev server
 * (`/__artisan/fonts`, matching the CLI's `createNodeFontRegistry`) and user uploads
 * (.ttf/.otf/.woff/.woff2, persisted in IndexedDB).
 */
import { FontRegistry, isCJK } from '@game-artisan/core';
import { loadBundledFonts, BUNDLED_FONTS } from '@game-artisan/fonts';
import { idbAll, idbPut, idbDelete } from './idb';

export interface StoredFont {
  id: string;
  name: string;
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  data: ArrayBuffer;
  addedAt: number;
}

interface ServerFont {
  id: number;
  url: string;
  name: string;
  kind: 'project' | 'system-cjk';
  fallback?: boolean;
  locales?: string[];
}

export const fonts = new FontRegistry();
let ready: Promise<void> | null = null;
let cjkPending: ServerFont[] = [];
let cjkLoading: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

export function onFontsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const emit = () => listeners.forEach((l) => l());

/** Load bundled + project + uploaded fonts once. */
export function initFonts(): Promise<void> {
  if (ready) return ready;
  ready = (async () => {
    const bundled = await loadBundledFonts();
    for (const f of bundled) fonts.register(f.data, { family: f.family, weight: f.weight, style: f.style, source: f.file });
    fonts.defaultFamily = 'Inter';
    // UI font for the Studio chrome itself
    registerUiFont();
    try {
      const res = await fetch('/__artisan/fonts');
      if (res.ok) {
        const list = (await res.json()) as ServerFont[];
        await Promise.all(
          list
            .filter((f) => f.kind === 'project')
            .map(async (f) => {
              try {
                const r = await fetch(f.url);
                fonts.register(new Uint8Array(await r.arrayBuffer()), { source: f.name });
              } catch (e) {
                console.warn('[studio] font failed', f.name, e);
              }
            }),
        );
        cjkPending = list.filter((f) => f.kind === 'system-cjk');
      }
    } catch {
      /* standalone without server endpoints */
    }
    for (const f of await idbAll<StoredFont>('fonts')) {
      try {
        fonts.register(new Uint8Array(f.data), { family: f.family, weight: f.weight, style: f.style, source: f.name });
        addCssFace(f.family, f.data, f.weight, f.style);
      } catch (e) {
        console.warn('[studio] stored font failed', f.name, e);
      }
    }
  })();
  return ready;
}

let uiFontRegistered = false;
function registerUiFont() {
  if (uiFontRegistered || typeof document === 'undefined' || typeof FontFace === 'undefined') return;
  uiFontRegistered = true;
  for (const f of BUNDLED_FONTS) {
    // 'Inter UI' for the Studio chrome; real family names so DOM text (inline editor) matches the canvas
    for (const family of f.family === 'Inter' ? ['Inter UI', 'Inter'] : [f.family]) {
      try {
        const face = new FontFace(family, `url(${f.url.href})`, { weight: String(f.weight), style: f.style });
        document.fonts.add(face);
        if (family === 'Inter UI') face.load().catch(() => {});
      } catch {
        /* ignore */
      }
    }
  }
}

function addCssFace(family: string, data: ArrayBuffer, weight: number, style: string): void {
  try {
    if (typeof FontFace === 'undefined') return;
    document.fonts.add(new FontFace(family, data.slice(0), { weight: String(weight), style }));
  } catch {
    /* unsupported format for CSS — canvas rendering still uses fontkit */
  }
}

/** Lazily load system CJK fallbacks (can be tens of MB) the first time CJK text is rendered. */
export function ensureFontsForText(text: string): Promise<boolean> {
  if (!cjkPending.length) return Promise.resolve(false);
  let needs = false;
  for (const ch of text) {
    if (isCJK(ch)) {
      needs = true;
      break;
    }
  }
  if (!needs) return Promise.resolve(false);
  if (cjkLoading) return cjkLoading;
  const pending = cjkPending;
  cjkPending = [];
  cjkLoading = (async () => {
    for (const f of pending.slice(0, 4)) {
      try {
        const r = await fetch(f.url);
        fonts.register(new Uint8Array(await r.arrayBuffer()), { fallback: true, locales: f.locales, source: f.name });
      } catch (e) {
        console.warn('[studio] CJK font failed', f.name, e);
      }
    }
    emit();
    return true;
  })();
  return cjkLoading;
}

/** Upload a font file (US-3.4). Returns the registered family names. */
export async function uploadFont(file: File): Promise<string[]> {
  const data = await file.arrayBuffer();
  const faces = fonts.register(new Uint8Array(data), { source: file.name });
  for (const f of faces) addCssFace(f.family, data, f.weight, f.style);
  const families = [...new Set(faces.map((f) => f.family))];
  for (const f of faces) {
    const rec: StoredFont = { id: `${f.family}-${f.weight}-${f.style}-${file.name}`, name: file.name, family: f.family, weight: f.weight, style: f.style, data, addedAt: Date.now() };
    await idbPut('fonts', rec.id, rec);
  }
  emit();
  return families;
}

export async function listUploadedFonts(): Promise<Omit<StoredFont, 'data'>[]> {
  return (await idbAll<StoredFont>('fonts')).map(({ data, ...rest }) => rest);
}

export async function removeUploadedFont(id: string): Promise<void> {
  await idbDelete('fonts', id);
}

/** Families available for the font picker (registry order, bundled first). */
export function fontFamilies(): string[] {
  return fonts.families();
}

/** Weights available for a family. */
export function fontWeights(family: string): number[] {
  const ws = fonts
    .list()
    .filter((f) => f.family.toLowerCase() === family.split(',')[0].trim().replace(/['"]/g, '').toLowerCase())
    .map((f) => f.weight);
  return [...new Set(ws)].sort((a, b) => a - b);
}
