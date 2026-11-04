import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CachingAssetResolver, assetFromBytes, mimeFromPath, type ResolvedAsset } from '@game-artisan/core';

export interface NodeAssetResolverOptions {
  /** Base directory for relative paths (default: cwd). */
  baseDir?: string;
  /** Extra directories searched for relative paths (e.g. project assets dir). */
  searchDirs?: string[];
  /** Allow http(s) URLs. Default true. */
  allowRemote?: boolean;
  /** Persist remote downloads here so batch runs never re-fetch (default ~/.cache/game-artisan/assets). false disables. */
  cacheDir?: string | false;
  /** Request timeout for remote assets (ms). */
  timeoutMs?: number;
}

/**
 * Filesystem + HTTP asset resolver with in-memory and on-disk caching (US-2.3 asset caching:
 * each external graphic is fetched at most once across batch runs).
 */
export class NodeAssetResolver extends CachingAssetResolver {
  readonly stats = { fsReads: 0, remoteFetches: 0, diskCacheHits: 0 };
  constructor(readonly options: NodeAssetResolverOptions = {}) {
    super((src) => this.load(src));
  }

  private async load(src: string): Promise<ResolvedAsset> {
    if (/^https?:\/\//i.test(src)) return this.loadRemote(src);
    const file = src.startsWith('file://') ? new URL(src).pathname : src;
    const candidates = path.isAbsolute(file)
      ? [file]
      : [path.resolve(this.options.baseDir ?? process.cwd(), file), ...(this.options.searchDirs ?? []).map((d) => path.resolve(d, file))];
    for (const c of candidates) {
      if (existsSync(c)) {
        this.stats.fsReads++;
        const data = new Uint8Array(await readFile(c));
        return assetFromBytes(data, mimeFromPath(c));
      }
    }
    throw new Error(`File not found (looked in: ${candidates.join(', ')})`);
  }

  private async loadRemote(url: string): Promise<ResolvedAsset> {
    if (this.options.allowRemote === false) throw new Error(`Remote assets are disabled: ${url}`);
    const cacheDir = this.options.cacheDir === false ? null : this.options.cacheDir ?? path.join(os.homedir(), '.cache', 'game-artisan', 'assets');
    const key = createHash('sha256').update(url).digest('hex');
    const cachePath = cacheDir ? path.join(cacheDir, key) : null;
    if (cachePath && existsSync(cachePath)) {
      try {
        const meta = JSON.parse(await readFile(`${cachePath}.json`, 'utf8'));
        this.stats.diskCacheHits++;
        return assetFromBytes(new Uint8Array(await readFile(cachePath)), meta.mime);
      } catch {
        /* fall through */
      }
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.options.timeoutMs ?? 20000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'game-artisan/1.0' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = new Uint8Array(await res.arrayBuffer());
      this.stats.remoteFetches++;
      const mime = res.headers.get('content-type')?.split(';')[0] ?? mimeFromPath(url);
      if (cachePath) {
        await mkdir(path.dirname(cachePath), { recursive: true });
        await writeFile(cachePath, data);
        await writeFile(`${cachePath}.json`, JSON.stringify({ url, mime, fetchedAt: new Date().toISOString() }));
      }
      return assetFromBytes(data, mime);
    } finally {
      clearTimeout(timer);
    }
  }
}

export async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
