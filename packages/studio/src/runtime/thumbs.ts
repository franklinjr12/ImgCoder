/**
 * Lazy template thumbnails for the composition browser: compiled with default props and
 * rasterised in the background (one at a time, when the main thread is idle).
 */
import { compileComposition, type CompositionDefinition } from '@game-artisan/core';
import { fonts } from './fonts';
import { exportAssets } from './assets';

const thumbs = new WeakMap<CompositionDefinition, string | null>();
const queue: CompositionDefinition[] = [];
const queued = new WeakSet<CompositionDefinition>();
let running = false;
const listeners = new Set<() => void>();
let rasterize: ((ab: any, scale: number, type: 'image/png' | 'image/jpeg') => Promise<string>) | null = null;

export function setThumbRasterizer(fn: typeof rasterize): void {
  rasterize = fn;
}

export function onThumb(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getThumb(def: CompositionDefinition): string | null | undefined {
  return thumbs.get(def);
}

export function requestThumb(def: CompositionDefinition): void {
  if (thumbs.has(def) || queued.has(def) || def.kind === 'html') return;
  queued.add(def);
  queue.push(def);
  void pump();
}

const idle = () =>
  new Promise<void>((r) => {
    const ric = (window as any).requestIdleCallback as ((cb: () => void, o?: { timeout: number }) => void) | undefined;
    if (ric) ric(() => r(), { timeout: 400 });
    else setTimeout(r, 60);
  });

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await new Promise((r) => setTimeout(r, 800));
    while (queue.length) {
      await idle();
      const def = queue.shift()!;
      try {
        const { artboard } = await compileComposition(def, { fonts, assets: exportAssets, surface: 'studio' });
        const scale = Math.min(112 / artboard.width, 72 / artboard.height);
        thumbs.set(def, rasterize ? await rasterize(artboard, scale, 'image/jpeg') : null);
      } catch {
        thumbs.set(def, null);
      }
      listeners.forEach((l) => l());
    }
  } finally {
    running = false;
  }
}
