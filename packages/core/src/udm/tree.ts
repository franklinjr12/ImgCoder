import { IDENTITY, multiply, transformToMatrix, transformRect, unionRects, type Matrix, type Rect } from '../math/matrix.js';
import type { Artboard, Layer, GroupLayer, MaskLayer, BooleanLayer } from './schema.js';

export type ContainerLayer = GroupLayer | MaskLayer | BooleanLayer;

export function isContainer(layer: Layer): layer is ContainerLayer {
  return layer.type === 'group' || layer.type === 'mask' || layer.type === 'boolean';
}

export function childrenOf(node: Artboard | Layer): Layer[] {
  if ('children' in node && Array.isArray((node as any).children)) return (node as any).children;
  return [];
}

export interface WalkEntry {
  layer: Layer;
  parent: Layer | null;
  depth: number;
  index: number;
  /** local → artboard matrix of this layer */
  matrix: Matrix;
  path: string[];
}

/** Depth-first walk (bottom → top paint order). Return false from the visitor to skip children. */
export function walkLayers(
  root: Artboard | Layer[],
  visit: (entry: WalkEntry) => void | boolean,
  opts: { includeMasks?: boolean } = {},
): void {
  const rec = (layers: Layer[], parent: Layer | null, depth: number, parentMatrix: Matrix, path: string[]) => {
    layers.forEach((layer, index) => {
      const matrix = multiply(parentMatrix, transformToMatrix(layer.transform));
      const p = [...path, layer.id];
      const res = visit({ layer, parent, depth, index, matrix, path: p });
      if (res === false) return;
      if (layer.type === 'mask' && opts.includeMasks) rec([layer.mask], layer, depth + 1, matrix, p);
      if (isContainer(layer)) rec(layer.children, layer, depth + 1, matrix, p);
    });
  };
  rec(Array.isArray(root) ? root : root.children, null, 0, IDENTITY, []);
}

export function flattenLayers(root: Artboard | Layer[]): Layer[] {
  const out: Layer[] = [];
  walkLayers(root, ({ layer }) => {
    out.push(layer);
  });
  return out;
}

export function findLayer(root: Artboard | Layer[], id: string): WalkEntry | null {
  let found: WalkEntry | null = null;
  walkLayers(
    root,
    (e) => {
      if (found) return false;
      if (e.layer.id === id) found = e;
    },
    { includeMasks: true },
  );
  return found;
}

/** World (artboard-space) matrix for each layer id. */
export function computeWorldMatrices(artboard: Artboard): Map<string, Matrix> {
  const out = new Map<string, Matrix>();
  walkLayers(artboard, (e) => {
    out.set(e.layer.id, e.matrix);
  });
  return out;
}

/** Axis aligned bounds of a layer in artboard space. */
export function layerWorldBounds(artboard: Artboard, id: string): Rect | null {
  const e = findLayer(artboard, id);
  if (!e) return null;
  return transformRect(e.matrix, { x: 0, y: 0, width: e.layer.transform.width, height: e.layer.transform.height });
}

export function selectionBounds(artboard: Artboard, ids: string[]): Rect | null {
  const rects = ids.map((id) => layerWorldBounds(artboard, id)).filter((r): r is Rect => !!r);
  return rects.length ? unionRects(rects) : null;
}

/** Immutable map over the layer tree. Return a new layer (or the same) for each node; null removes it. */
export function mapLayers(layers: Layer[], fn: (layer: Layer, parent: Layer | null) => Layer | null, parent: Layer | null = null): Layer[] {
  const out: Layer[] = [];
  for (const layer of layers) {
    let next = fn(layer, parent);
    if (!next) continue;
    if (isContainer(next)) {
      const kids = mapLayers(next.children, fn, next);
      if (kids !== next.children) next = { ...next, children: kids } as Layer;
      if (next.type === 'mask') {
        const m = mapLayers([next.mask], fn, next)[0];
        if (m && m !== next.mask) next = { ...next, mask: m };
      }
    }
    out.push(next);
  }
  return out;
}

export function updateLayer(artboard: Artboard, id: string, updater: (layer: Layer) => Layer): Artboard {
  return { ...artboard, children: mapLayers(artboard.children, (l) => (l.id === id ? updater(l) : l)) };
}

export function removeLayers(artboard: Artboard, ids: string[]): Artboard {
  const set = new Set(ids);
  return { ...artboard, children: mapLayers(artboard.children, (l) => (set.has(l.id) ? null : l)) };
}

export function cloneDeep<T>(value: T): T {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

let idCounter = 0;
export function generateId(prefix = 'layer'): string {
  idCounter = (idCounter + 1) % 1e9;
  const rand = Math.random().toString(36).slice(2, 7);
  return `${prefix}-${rand}${idCounter.toString(36)}`;
}

export function collectIds(root: Artboard | Layer[]): Set<string> {
  const ids = new Set<string>();
  walkLayers(root, ({ layer }) => {
    ids.add(layer.id);
  }, { includeMasks: true });
  return ids;
}
