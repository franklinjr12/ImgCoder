/**
 * Layer overrides: per-layer patches applied after a template is compiled. They let the
 * Studio (and agents) move/hide/restyle any layer of a code template without editing code;
 * they serialise into props JSON under `$overrides` and are honoured by every renderer.
 */
import type { Artboard, Layer, Transform } from '../udm/schema.js';
import { mapLayers } from '../udm/tree.js';

export interface LayerOverride {
  transform?: Partial<Transform>;
  visible?: boolean;
  locked?: boolean;
  opacity?: number;
  name?: string;
  blendMode?: Layer['blendMode'];
  /** Any other top-level layer field (content, src, fill, style, effects, …) — shallow-merged; `style` deep-merged. */
  [field: string]: unknown;
}

export type LayerOverrides = Record<string, LayerOverride>;

export function applyOverrides(artboard: Artboard, overrides: LayerOverrides | undefined | null): Artboard {
  if (!overrides || !Object.keys(overrides).length) return artboard;
  return {
    ...artboard,
    children: mapLayers(artboard.children, (layer) => {
      const o = overrides[layer.id];
      if (!o) return layer;
      const { transform, style, ...rest } = o as any;
      const next: any = { ...layer, ...rest };
      if (transform) next.transform = { ...layer.transform, ...transform };
      if (style && layer.type === 'text') next.style = { ...layer.style, ...style };
      return next as Layer;
    }),
  };
}

/** Merge override patches (later wins, transform/style merged per key). */
export function mergeOverrides(a: LayerOverrides = {}, b: LayerOverrides = {}): LayerOverrides {
  const out: LayerOverrides = { ...a };
  for (const [id, o] of Object.entries(b)) {
    const prev = out[id] ?? {};
    out[id] = {
      ...prev,
      ...o,
      transform: o.transform || prev.transform ? { ...(prev.transform ?? {}), ...(o.transform ?? {}) } : undefined,
      style: (o as any).style || (prev as any).style ? { ...((prev as any).style ?? {}), ...((o as any).style ?? {}) } : undefined,
    };
    if (!out[id].transform) delete out[id].transform;
    if (!(out[id] as any).style) delete (out[id] as any).style;
  }
  return out;
}
