/**
 * Remote asset cache for the Chromium pipeline (US-2.3): an in-memory LRU (bounded by bytes)
 * backed by an optional on-disk cache. The disk layout is shared with renderer-svg's
 * `NodeAssetResolver` (`<sha256(url)>` + `<sha256(url)>.json`), so a graphic downloaded by either
 * renderer is never fetched again across batch runs.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface CachedResponse {
  body: Buffer;
  contentType: string;
  status: number;
}

export interface AssetCacheOptions {
  /** Max bytes kept in memory. Default 256 MiB. */
  maxMemoryBytes?: number;
  /** Max entries kept in memory. Default 2000. */
  maxEntries?: number;
  /**
   * Persist remote responses here. Default: `~/.cache/game-artisan/assets` (shared with
   * renderer-svg's NodeAssetResolver). `false` disables the disk cache.
   */
  cacheDir?: string | false;
}

export interface AssetCacheStats {
  /** Requests answered from the in-memory LRU. */
  memoryHits: number;
  /** Requests answered from the disk cache. */
  diskHits: number;
  /** Requests that went to the network. */
  networkFetches: number;
  /** Project-relative assets served through the AssetResolver. */
  resolverHits: number;
  /** Failed asset requests (network errors, 4xx/5xx, unresolvable paths). */
  errors: number;
  /** Current in-memory entries / bytes. */
  entries: number;
  bytes: number;
  evictions: number;
}

export function defaultAssetCacheDir(): string {
  return path.join(os.homedir(), '.cache', 'game-artisan', 'assets');
}

export class AssetCache {
  private mem = new Map<string, CachedResponse>();
  private inflight = new Map<string, Promise<CachedResponse>>();
  private bytes = 0;
  private counters = { memoryHits: 0, diskHits: 0, networkFetches: 0, resolverHits: 0, errors: 0, evictions: 0 };
  readonly maxMemoryBytes: number;
  readonly maxEntries: number;
  readonly cacheDir: string | null;

  constructor(opts: AssetCacheOptions = {}) {
    this.maxMemoryBytes = opts.maxMemoryBytes ?? 256 * 1024 * 1024;
    this.maxEntries = opts.maxEntries ?? 2000;
    this.cacheDir = opts.cacheDir === false ? null : opts.cacheDir ?? defaultAssetCacheDir();
  }

  get stats(): AssetCacheStats {
    return { ...this.counters, entries: this.mem.size, bytes: this.bytes };
  }

  /** @internal count a resolver-served / failed request */
  record(kind: 'resolverHits' | 'errors'): void {
    this.counters[kind]++;
  }

  resetStats(): void {
    for (const k of Object.keys(this.counters) as (keyof typeof this.counters)[]) this.counters[k] = 0;
  }

  /** Drop the in-memory cache (disk entries are kept). */
  clearMemory(): void {
    this.mem.clear();
    this.bytes = 0;
  }

  private key(url: string): string {
    return createHash('sha256').update(url).digest('hex');
  }

  private getMem(url: string): CachedResponse | undefined {
    const hit = this.mem.get(url);
    if (hit) {
      // refresh recency
      this.mem.delete(url);
      this.mem.set(url, hit);
    }
    return hit;
  }

  private putMem(url: string, r: CachedResponse): void {
    if (r.body.length > this.maxMemoryBytes) return;
    const prev = this.mem.get(url);
    if (prev) {
      this.bytes -= prev.body.length;
      this.mem.delete(url);
    }
    this.mem.set(url, r);
    this.bytes += r.body.length;
    while ((this.bytes > this.maxMemoryBytes || this.mem.size > this.maxEntries) && this.mem.size) {
      const [oldest, v] = this.mem.entries().next().value as [string, CachedResponse];
      this.mem.delete(oldest);
      this.bytes -= v.body.length;
      this.counters.evictions++;
    }
  }

  private async readDisk(url: string): Promise<CachedResponse | undefined> {
    if (!this.cacheDir) return undefined;
    const file = path.join(this.cacheDir, this.key(url));
    if (!existsSync(file)) return undefined;
    try {
      const meta = JSON.parse(await readFile(`${file}.json`, 'utf8'));
      const body = await readFile(file);
      return { body, contentType: meta.mime ?? 'application/octet-stream', status: 200 };
    } catch {
      return undefined;
    }
  }

  private async writeDisk(url: string, r: CachedResponse): Promise<void> {
    if (!this.cacheDir) return;
    try {
      await mkdir(this.cacheDir, { recursive: true });
      const file = path.join(this.cacheDir, this.key(url));
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmp, r.body);
      await writeFile(`${file}.json`, JSON.stringify({ url, mime: r.contentType, fetchedAt: new Date().toISOString() }));
      await rename(tmp, file);
    } catch {
      /* disk cache is best-effort */
    }
  }

  /**
   * Return the cached response for `url`, or run `fetcher` once (concurrent callers share the
   * same in-flight request). Only 2xx responses are cached.
   */
  async get(url: string, fetcher: () => Promise<CachedResponse>): Promise<CachedResponse> {
    const mem = this.getMem(url);
    if (mem) {
      this.counters.memoryHits++;
      return mem;
    }
    const pending = this.inflight.get(url);
    if (pending) {
      const r = await pending;
      this.counters.memoryHits++;
      return r;
    }
    const p = (async () => {
      const disk = await this.readDisk(url);
      if (disk) {
        this.counters.diskHits++;
        this.putMem(url, disk);
        return disk;
      }
      const r = await fetcher();
      this.counters.networkFetches++;
      if (r.status >= 200 && r.status < 300) {
        this.putMem(url, r);
        await this.writeDisk(url, r);
      }
      return r;
    })();
    this.inflight.set(url, p);
    try {
      return await p;
    } finally {
      this.inflight.delete(url);
    }
  }
}
