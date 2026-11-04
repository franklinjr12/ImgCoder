/** Derived canvas data: world matrices, parents, paint order (memoised per live artboard). */
import { IDENTITY, multiply, transformToMatrix, walkLayers, type Artboard, type Layer, type Matrix, type Transform } from '@game-artisan/core';

export interface CanvasModel {
  artboard: Artboard;
  layers: Map<string, Layer>;
  world: Map<string, Matrix>;
  parentOf: Map<string, string | null>;
  /** paint order index (higher = on top) */
  order: Map<string, number>;
  /** effective lock/hidden (incl. ancestors) */
  locked: Set<string>;
  hidden: Set<string>;
}

const cache = new WeakMap<Artboard, CanvasModel>();

export function canvasModel(artboard: Artboard): CanvasModel {
  let m = cache.get(artboard);
  if (m) return m;
  const layers = new Map<string, Layer>();
  const world = new Map<string, Matrix>();
  const parentOf = new Map<string, string | null>();
  const order = new Map<string, number>();
  const locked = new Set<string>();
  const hidden = new Set<string>();
  let i = 0;
  walkLayers(artboard, ({ layer, parent, matrix }) => {
    layers.set(layer.id, layer);
    world.set(layer.id, matrix);
    parentOf.set(layer.id, parent?.id ?? null);
    order.set(layer.id, i++);
    if (layer.locked || (parent && locked.has(parent.id))) locked.add(layer.id);
    if (layer.visible === false || (parent && hidden.has(parent.id))) hidden.add(layer.id);
  });
  m = { artboard, layers, world, parentOf, order, locked, hidden };
  cache.set(artboard, m);
  return m;
}

export function parentWorld(model: CanvasModel, id: string): Matrix {
  const p = model.parentOf.get(id);
  return p ? (model.world.get(p) ?? IDENTITY) : IDENTITY;
}

/** World matrix of a layer using a preview transform for it (and/or its ancestors). */
export function worldWithPreview(model: CanvasModel, id: string, preview: Map<string, Transform> | null): Matrix {
  if (!preview || !preview.size) return model.world.get(id) ?? IDENTITY;
  const chain: string[] = [];
  let cur: string | null | undefined = id;
  while (cur) {
    chain.unshift(cur);
    cur = model.parentOf.get(cur);
  }
  let m: Matrix = IDENTITY;
  for (const lid of chain) {
    const t = preview.get(lid) ?? model.layers.get(lid)?.transform;
    if (t) m = multiply(m, transformToMatrix(t));
  }
  return m;
}

/** Ancestor chain (outermost first, excluding the id). */
export function ancestors(model: CanvasModel, id: string): string[] {
  const out: string[] = [];
  let cur = model.parentOf.get(id);
  while (cur) {
    out.unshift(cur);
    cur = model.parentOf.get(cur);
  }
  return out;
}
