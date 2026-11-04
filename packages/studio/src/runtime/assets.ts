/**
 * Browser asset resolution + asset library (US-3.5).
 *
 * Canvas resolver: a core `CachingAssetResolver` whose loader fetches project-relative paths
 * through the dev server (`/__artisan/file?path=`) and absolute URLs directly. Data URIs are
 * decoded by core as-is. For display, resolved bytes are exposed as blob: object URLs so the
 * inline SVG stays small (fast innerHTML at 60fps); exports use a data-URI resolver instead.
 * Changed project files (HMR `artisan:assets-changed`) are invalidated with a cache-busting
 * generation counter.
 */
import { CachingAssetResolver, assetFromBytes, mimeFromPath, parseDataUri, probeImageSize, type AssetResolver, type ResolvedAsset } from '@game-artisan/core';
import { idbAll, idbDelete, idbGet, idbPut } from './idb';

export const ASSET_CATEGORIES = ['Backgrounds', 'Characters', 'Logos', 'Badges', 'Overlays'] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

const isUrl = (s: string) => /^(https?:|blob:)/i.test(s);
const isData = (s: string) => s.startsWith('data:');

let generation = 0;

/** `builtin:<name>` art resolver (registered from @game-artisan/templates-game when available). */
let builtinArt: ((src: string) => string | undefined) | null = null;
export function setBuiltinArtResolver(fn: ((src: string) => string | undefined) | null): void {
  builtinArt = fn;
}
/** Preview URL for an image prop value (thumbnails in pickers). */
export function previewUrl(src: string): string {
  if (!src) return '';
  if (src.startsWith('builtin:')) return builtinArt?.(src) ?? '';
  return fetchUrlFor(src);
}

/** URL used to fetch a src from the browser. */
export function fetchUrlFor(src: string): string {
  if (isUrl(src) || isData(src)) return src;
  if (src.startsWith('/__artisan/') || src.startsWith('/@fs/')) return src;
  return `/__artisan/file?path=${encodeURIComponent(src)}${generation ? `&v=${generation}` : ''}`;
}

async function loadBytes(src: string): Promise<ResolvedAsset> {
  if (src.startsWith('builtin:')) {
    const uri = builtinArt?.(src);
    const d = uri ? parseDataUri(uri) : null;
    if (!d) throw new Error(`Unknown built-in art ${src}`);
    return assetFromBytes(d.data, d.mime);
  }
  const url = fetchUrlFor(src);
  const res = await fetch(url);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      msg = (await res.json()).error ?? msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  return assetFromBytes(bytes, res.headers.get('content-type') ?? mimeFromPath(src));
}

/** Resolver used for exports (data URIs everywhere → standalone SVG/PNG). */
export const exportAssets = new CachingAssetResolver(loadBytes);

const objectUrls = new Map<string, string>();

function toDisplay(src: string, a: ResolvedAsset): ResolvedAsset {
  if (!a.data || a.mime === 'image/svg+xml') return a; // SVG layers inline the markup (text); keep href
  let url = objectUrls.get(src);
  if (!url) {
    url = URL.createObjectURL(new Blob([a.data as BlobPart], { type: a.mime }));
    objectUrls.set(src, url);
  }
  return { ...a, href: url };
}

class DisplayResolver implements AssetResolver {
  private inner = new CachingAssetResolver(loadBytes);
  private cache = new Map<string, Promise<ResolvedAsset>>();
  resolve(src: string): Promise<ResolvedAsset> {
    let p = this.cache.get(src);
    if (!p) {
      p = this.inner.resolve(src).then((a) => toDisplay(src, a));
      p.catch(() => this.cache.delete(src));
      this.cache.set(src, p);
    }
    return p;
  }
  invalidate(pred: (src: string) => boolean): void {
    let any = false;
    for (const k of [...this.cache.keys()]) {
      if (pred(k)) {
        this.cache.delete(k);
        const u = objectUrls.get(k);
        if (u) URL.revokeObjectURL(u);
        objectUrls.delete(k);
        any = true;
      }
    }
    if (any) this.inner.clear();
  }
}

export const displayAssets = new DisplayResolver();

/** Invalidate project files that changed on disk (cache-bust). */
export function invalidateProjectAssets(paths: string[]): void {
  generation++;
  const set = new Set(paths.map((p) => p.replace(/^\.\//, '')));
  displayAssets.invalidate((src) => !isData(src) && !isUrl(src) && (set.size === 0 || set.has(src.replace(/^\.\//, '')) || [...set].some((p) => src.endsWith(p))));
  exportAssets.clear();
}

// ---------------------------------------------------------------------------------------
// Asset library (IndexedDB)

export interface LibraryAsset {
  id: string;
  name: string;
  mime: string;
  size: number;
  width?: number;
  height?: number;
  tags: string[];
  addedAt: number;
  /** Raw bytes */
  data: ArrayBuffer;
}

export interface ProjectAsset {
  path: string;
  name: string;
  size: number;
  mtime: number;
  mime: string;
  category?: string;
}

export interface AssetItem {
  key: string;
  source: 'library' | 'project';
  name: string;
  mime: string;
  size: number;
  width?: number;
  height?: number;
  tags: string[];
  /** Value to put in a layer `src` (data URI for library items so designs stay portable, project path otherwise). */
  src: string;
  /** Thumbnail URL. */
  thumb: string;
  mtime: number;
}

const thumbUrls = new Map<string, string>();

function bytesToDataUri(data: ArrayBuffer, mime: string): string {
  const bytes = new Uint8Array(data);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
}

export function libraryItem(a: LibraryAsset): AssetItem {
  let thumb = thumbUrls.get(a.id);
  if (!thumb) {
    thumb = URL.createObjectURL(new Blob([a.data], { type: a.mime }));
    thumbUrls.set(a.id, thumb);
  }
  return { key: `lib:${a.id}`, source: 'library', name: a.name, mime: a.mime, size: a.size, width: a.width, height: a.height, tags: a.tags, src: '', thumb, mtime: a.addedAt };
}

/** Src for a library asset (data URI, computed on demand — can be large). */
export async function librarySrc(id: string): Promise<string> {
  const a = await idbGet<LibraryAsset>('assets', id);
  if (!a) throw new Error('Asset not found');
  return bytesToDataUri(a.data, a.mime);
}

export async function listLibrary(): Promise<LibraryAsset[]> {
  return (await idbAll<LibraryAsset>('assets')).sort((a, b) => b.addedAt - a.addedAt);
}

export function guessCategory(name: string): string[] {
  const n = name.toLowerCase();
  if (/(bg|background|screenshot|key.?art|scene|environment)/.test(n)) return ['Backgrounds'];
  if (/(hero|char|character|sprite|cutout|player|enemy|boss)/.test(n)) return ['Characters'];
  if (/(logo|title|brand)/.test(n)) return ['Logos'];
  if (/(badge|laurel|award|rating|pegi|esrb)/.test(n)) return ['Badges'];
  if (/(overlay|fx|texture|grain|scanline|frame|vignette)/.test(n)) return ['Overlays'];
  return [];
}

export async function addToLibrary(file: File | Blob, opts: { name?: string; tags?: string[] } = {}): Promise<LibraryAsset> {
  const data = await file.arrayBuffer();
  const name = opts.name ?? (file as File).name ?? 'asset';
  const mime = file.type || mimeFromPath(name);
  const size = probeImageSize(new Uint8Array(data), mime);
  const asset: LibraryAsset = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    mime,
    size: data.byteLength,
    width: size?.width,
    height: size?.height,
    tags: opts.tags ?? guessCategory(name),
    addedAt: Date.now(),
    data,
  };
  await idbPut('assets', asset.id, asset);
  return asset;
}

export async function updateLibraryAsset(id: string, patch: Partial<Pick<LibraryAsset, 'tags' | 'name'>>): Promise<void> {
  const a = await idbGet<LibraryAsset>('assets', id);
  if (a) await idbPut('assets', id, { ...a, ...patch });
}

export async function removeFromLibrary(id: string): Promise<void> {
  await idbDelete('assets', id);
  const u = thumbUrls.get(id);
  if (u) URL.revokeObjectURL(u);
  thumbUrls.delete(id);
}

export async function listProjectAssets(): Promise<ProjectAsset[]> {
  try {
    const res = await fetch('/__artisan/assets', { cache: 'no-store' });
    if (!res.ok) return [];
    const j = await res.json();
    return j.files ?? [];
  } catch {
    return [];
  }
}

export function projectItem(a: ProjectAsset): AssetItem {
  return {
    key: `prj:${a.path}`,
    source: 'project',
    name: a.name,
    mime: a.mime,
    size: a.size,
    tags: a.category ? [a.category] : guessCategory(a.path),
    src: a.path,
    thumb: `/__artisan/file?path=${encodeURIComponent(a.path)}&v=${Math.round(a.mtime)}`,
    mtime: a.mtime,
  };
}

/** Read a dropped/uploaded image file → { src (data URI), width, height, mime }. */
export async function fileToImage(file: File): Promise<{ src: string; width?: number; height?: number; mime: string; name: string }> {
  const data = await file.arrayBuffer();
  const mime = file.type || mimeFromPath(file.name);
  const size = probeImageSize(new Uint8Array(data), mime);
  return { src: bytesToDataUri(data, mime), width: size?.width, height: size?.height, mime, name: file.name };
}

/** Size of any src (for inserting project assets). */
export async function probeSrc(src: string): Promise<{ width?: number; height?: number; mime: string }> {
  const d = parseDataUri(src);
  if (d) {
    const s = probeImageSize(d.data, d.mime);
    return { width: s?.width, height: s?.height, mime: d.mime };
  }
  const a = await displayAssets.resolve(src);
  return { width: a.width, height: a.height, mime: a.mime };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
