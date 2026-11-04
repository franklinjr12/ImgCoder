/**
 * Asset resolution abstraction. Renderers never touch the filesystem/network directly: they ask
 * an AssetResolver, so the same emitter runs in Node (fs + fetch + cache), the browser Studio
 * (object URLs / IndexedDB) and tests (in-memory).
 */
import { imageSize } from 'image-size';

export interface ResolvedAsset {
  /** Value used for `href` in the emitted SVG (data URI or URL). */
  href: string;
  mime: string;
  width?: number;
  height?: number;
  /** Raw bytes, when available (needed for embedding + SVG inlining). */
  data?: Uint8Array;
  /** Decoded text for SVG assets. */
  text?: string;
}

export interface AssetResolver {
  resolve(src: string): Promise<ResolvedAsset>;
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp',
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
};

export function mimeFromPath(path: string): string {
  const ext = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(path)?.[1]?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

export function sniffMime(data: Uint8Array): string | null {
  if (data[0] === 0x89 && data[1] === 0x50) return 'image/png';
  if (data[0] === 0xff && data[1] === 0xd8) return 'image/jpeg';
  if (data[0] === 0x47 && data[1] === 0x49) return 'image/gif';
  if (data[0] === 0x52 && data[1] === 0x49 && data[8] === 0x57) return 'image/webp';
  const head = new TextDecoder().decode(data.slice(0, 256)).trimStart();
  if (head.startsWith('<svg') || head.startsWith('<?xml')) return 'image/svg+xml';
  return null;
}

export function bytesToBase64(bytes: Uint8Array): string {
  const B: any = (globalThis as any).Buffer;
  if (B) return B.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const B: any = (globalThis as any).Buffer;
  if (B) return new Uint8Array(B.from(b64, 'base64'));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toDataUri(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

export function parseDataUri(uri: string): { mime: string; data: Uint8Array } | null {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(uri);
  if (!m) return null;
  const mime = m[1] || 'application/octet-stream';
  const data = m[2] ? base64ToBytes(m[3]) : new TextEncoder().encode(decodeURIComponent(m[3]));
  return { mime, data };
}

/** Read width/height of PNG/JPEG/GIF/WebP/SVG bytes. */
export function probeImageSize(data: Uint8Array, mime?: string): { width: number; height: number } | null {
  if ((mime ?? sniffMime(data)) === 'image/svg+xml') return probeSvgSize(new TextDecoder().decode(data));
  try {
    const r = imageSize(data);
    if (r.width && r.height) {
      // EXIF orientation 5-8 swaps dimensions
      if (r.orientation && r.orientation >= 5) return { width: r.height, height: r.width };
      return { width: r.width, height: r.height };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function probeSvgSize(svg: string): { width: number; height: number } | null {
  const tag = /<svg\b[^>]*>/i.exec(svg)?.[0];
  if (!tag) return null;
  const attr = (n: string) => new RegExp(`\\s${n}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tag)?.[1];
  const vb = attr('viewBox')?.trim().split(/[\s,]+/).map(Number);
  const w = parseFloat(attr('width') ?? '');
  const h = parseFloat(attr('height') ?? '');
  if (w && h && !/%/.test(attr('width')!)) return { width: w, height: h };
  if (vb && vb.length === 4) return { width: vb[2], height: vb[3] };
  return null;
}

/** Build a ResolvedAsset from bytes. */
export function assetFromBytes(data: Uint8Array, mimeHint?: string): ResolvedAsset {
  const mime = sniffMime(data) ?? mimeHint ?? 'application/octet-stream';
  const size = probeImageSize(data, mime);
  return {
    href: toDataUri(data, mime),
    mime,
    data,
    width: size?.width,
    height: size?.height,
    text: mime === 'image/svg+xml' ? new TextDecoder().decode(data) : undefined,
  };
}

/** Resolver that handles data URIs and delegates everything else to a loader function. Caches results. */
export class CachingAssetResolver implements AssetResolver {
  private cache = new Map<string, Promise<ResolvedAsset>>();
  constructor(private loader: (src: string) => Promise<ResolvedAsset> = async (src) => {
    throw new Error(`No asset loader configured; cannot load "${src.slice(0, 80)}"`);
  }) {}

  resolve(src: string): Promise<ResolvedAsset> {
    let p = this.cache.get(src);
    if (!p) {
      p = (async () => {
        const data = parseDataUri(src);
        if (data) return { ...assetFromBytes(data.data, data.mime), href: src };
        return this.loader(src);
      })();
      p.catch(() => this.cache.delete(src));
      this.cache.set(src, p);
    }
    return p;
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

/** Generic fetch-based loader (browser and Node 18+). */
export function fetchLoader(base?: string): (src: string) => Promise<ResolvedAsset> {
  return async (src: string) => {
    const url = base ? new URL(src, base).toString() : src;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch asset ${url}: HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    return assetFromBytes(bytes, res.headers.get('content-type') ?? mimeFromPath(url));
  };
}

/** A tiny placeholder image used when an asset cannot be loaded and `onMissing: 'placeholder'`. */
export function placeholderAsset(label = 'missing'): ResolvedAsset {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><defs><pattern id="p" width="32" height="32" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#ff00ff"/><rect x="16" y="16" width="16" height="16" fill="#ff00ff"/><rect x="16" width="16" height="16" fill="#202020"/><rect y="16" width="16" height="16" fill="#202020"/></pattern></defs><rect width="256" height="256" fill="url(#p)"/><title>${label.replace(/[<>&]/g, '')}</title></svg>`;
  const data = new TextEncoder().encode(svg);
  return { href: toDataUri(data, 'image/svg+xml'), mime: 'image/svg+xml', data, width: 256, height: 256, text: svg };
}
