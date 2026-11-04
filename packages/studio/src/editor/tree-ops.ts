/**
 * Structural layer-tree operations for design documents (framework-free, immutable):
 * insert, delete, duplicate, reorder/reparent (drag & drop), group/ungroup preserving world
 * transforms, z-order and flat field patches. Values bound to props (`{ $prop }`) are kept.
 */
import {
  IDENTITY,
  cloneDeep,
  computeWorldMatrices,
  createLayer,
  generateId,
  invert,
  isContainer,
  isVariableProp,
  multiply,
  setPath,
  transformRect,
  transformToMatrix,
  unionRects,
  type Artboard,
  type GroupLayer,
  type Layer,
  type Matrix,
  type Transform,
} from '@game-artisan/core';
import { transformFromMatrix } from './geometry.js';

export interface ParentInfo {
  /** null = artboard root */
  parent: Layer | null;
  siblings: Layer[];
  index: number;
  depth: number;
}

/** Locate a layer's parent list and index. */
export function findParent(root: Artboard | Layer[], id: string): ParentInfo | null {
  const rec = (list: Layer[], parent: Layer | null, depth: number): ParentInfo | null => {
    for (let i = 0; i < list.length; i++) {
      const l = list[i];
      if (l.id === id) return { parent, siblings: list, index: i, depth };
      if (isContainer(l)) {
        const r = rec(l.children, l, depth + 1);
        if (r) return r;
      }
    }
    return null;
  };
  return rec(Array.isArray(root) ? root : root.children, null, 0);
}

export function getLayer(root: Artboard | Layer[], id: string): Layer | null {
  const p = findParent(root, id);
  return p ? p.siblings[p.index] : null;
}

/** Ancestor ids (outermost first). */
export function ancestorsOf(root: Artboard, id: string): string[] {
  const out: string[] = [];
  let cur = findParent(root, id);
  while (cur?.parent) {
    out.unshift(cur.parent.id);
    cur = findParent(root, cur.parent.id);
  }
  return out;
}

/** Replace the children list of a container (or the artboard root when parentId is null). */
export function withChildren(artboard: Artboard, parentId: string | null, fn: (children: Layer[]) => Layer[]): Artboard {
  if (parentId == null) return { ...artboard, children: fn(artboard.children) };
  const rec = (list: Layer[]): Layer[] =>
    list.map((l) => {
      if (l.id === parentId && isContainer(l)) return { ...l, children: fn(l.children) } as Layer;
      if (isContainer(l)) {
        const kids = rec(l.children);
        return kids === l.children ? l : ({ ...l, children: kids } as Layer);
      }
      return l;
    });
  return { ...artboard, children: rec(artboard.children) };
}

export function mapLayer(artboard: Artboard, id: string, fn: (l: Layer) => Layer): Artboard {
  const rec = (list: Layer[]): Layer[] => {
    let changed = false;
    const out = list.map((l) => {
      if (l.id === id) {
        changed = true;
        return fn(l);
      }
      if (isContainer(l)) {
        const kids = rec(l.children);
        if (kids !== l.children) {
          changed = true;
          return { ...l, children: kids } as Layer;
        }
      }
      return l;
    });
    return changed ? out : list;
  };
  return { ...artboard, children: rec(artboard.children) };
}

/** Apply a flat field patch (`{ 'transform.x': 10, 'style.fontSize': 40 }`) to a raw layer. */
export function patchLayer(layer: Layer, patch: Record<string, unknown>): Layer {
  let next: any = layer;
  for (const [path, value] of Object.entries(patch)) next = setPath(next, path, value);
  return next as Layer;
}

export function insertLayers(artboard: Artboard, layers: Layer[], at?: { parentId?: string | null; index?: number }): Artboard {
  return withChildren(artboard, at?.parentId ?? null, (kids) => {
    const idx = at?.index == null ? kids.length : Math.max(0, Math.min(kids.length, at.index));
    return [...kids.slice(0, idx), ...layers, ...kids.slice(idx)];
  });
}

export function deleteLayers(artboard: Artboard, ids: string[]): Artboard {
  const set = new Set(ids);
  const rec = (list: Layer[]): Layer[] => list.filter((l) => !set.has(l.id)).map((l) => (isContainer(l) ? ({ ...l, children: rec(l.children) } as Layer) : l));
  return { ...artboard, children: rec(artboard.children) };
}

/** Deep clone with fresh ids for the layer and all descendants (and the mask of mask layers). */
export function cloneWithNewIds(layer: Layer, idMap = new Map<string, string>()): Layer {
  const copy = cloneDeep(layer) as any;
  const rec = (l: any) => {
    const nid = generateId(l.type);
    idMap.set(l.id, nid);
    l.id = nid;
    if (l.type === 'mask' && l.mask) rec(l.mask);
    if (Array.isArray(l.children)) l.children.forEach(rec);
  };
  rec(copy);
  return copy as Layer;
}

/** Transform of a raw layer: numbers, with bound values taken from the resolved layer. */
export function numericTransform(raw: Layer, resolved?: Layer | null): Transform {
  const t: any = { ...raw.transform };
  for (const [k, v] of Object.entries(t)) if (isVariableProp(v)) t[k] = (resolved?.transform as any)?.[k] ?? (v as any).fallback ?? 0;
  return t as Transform;
}

/** Write a new transform, keeping bound fields bound. */
export function writeTransform(raw: Layer, t: Transform): Layer {
  const cur: any = raw.transform;
  const next: any = { ...cur };
  for (const [k, v] of Object.entries(t)) {
    if (isVariableProp(cur[k])) continue;
    next[k] = v;
  }
  for (const k of ['flipX', 'flipY']) if (!(k in t) && !isVariableProp(cur[k])) delete next[k];
  return { ...raw, transform: next } as Layer;
}

/** Duplicate layers (inserted directly above each original). Returns the new ids. */
export function duplicateLayers(artboard: Artboard, ids: string[], offset = { x: 0, y: 0 }): { artboard: Artboard; ids: string[] } {
  let ab = artboard;
  const newIds: string[] = [];
  for (const id of topLevelSelection(artboard, ids)) {
    const info = findParent(ab, id);
    if (!info) continue;
    const src = info.siblings[info.index];
    const copy = cloneWithNewIds(src);
    const t = copy.transform as any;
    if (!isVariableProp(t.x)) t.x += offset.x;
    if (!isVariableProp(t.y)) t.y += offset.y;
    if (copy.name) copy.name = copy.name.replace(/( copy( \d+)?)?$/, (m) => (m ? (m === ' copy' ? ' copy 2' : ` copy ${Number(m.replace(/\D/g, '')) + 1}`) : ' copy'));
    ab = insertLayers(ab, [copy], { parentId: info.parent?.id ?? null, index: info.index + 1 });
    newIds.push(copy.id);
  }
  return { artboard: ab, ids: newIds };
}

/** Remove ids whose ancestor is also selected (operations act on the outermost). */
export function topLevelSelection(artboard: Artboard, ids: string[]): string[] {
  const set = new Set(ids);
  return ids.filter((id) => !ancestorsOf(artboard, id).some((a) => set.has(a)));
}

/** Order ids by paint order (bottom → top). */
export function sortByPaintOrder(artboard: Artboard, ids: string[]): string[] {
  const order: string[] = [];
  const rec = (list: Layer[]) =>
    list.forEach((l) => {
      order.push(l.id);
      if (isContainer(l)) rec(l.children);
    });
  rec(artboard.children);
  const set = new Set(ids);
  return order.filter((id) => set.has(id));
}

function parentWorldOf(worlds: Map<string, Matrix>, parent: Layer | null): Matrix {
  return parent ? (worlds.get(parent.id) ?? IDENTITY) : IDENTITY;
}

/**
 * Move layers to a new parent/index (layers-panel drag & drop), preserving their world
 * transforms. `index` is the insertion index in the target children list (before removal).
 */
export function moveLayers(artboard: Artboard, ids: string[], target: { parentId: string | null; index: number }, resolved?: Artboard): Artboard {
  const worlds = computeWorldMatrices(resolved ?? artboard);
  const sel = sortByPaintOrder(artboard, topLevelSelection(artboard, ids)).filter((id) => id !== target.parentId);
  // can't drop into own descendant
  if (target.parentId && sel.some((id) => id === target.parentId || ancestorsOf(artboard, target.parentId!).includes(id))) return artboard;
  const targetParent = target.parentId ? getLayer(artboard, target.parentId) : null;
  if (target.parentId && (!targetParent || !isContainer(targetParent))) return artboard;
  const targetWorld = target.parentId ? (worlds.get(target.parentId) ?? IDENTITY) : IDENTITY;
  // compute the insertion index after removing moved items that precede it in the same list
  const targetList = target.parentId ? (targetParent as GroupLayer).children : artboard.children;
  let index = target.index;
  for (const id of sel) {
    const i = targetList.findIndex((l) => l.id === id);
    if (i >= 0 && i < target.index) index--;
  }
  const moved: Layer[] = [];
  for (const id of sel) {
    const info = findParent(artboard, id)!;
    let layer = info.siblings[info.index];
    if ((info.parent?.id ?? null) !== target.parentId) {
      const resolvedLayer = resolved ? getLayer(resolved, id) : null;
      const t = numericTransform(layer, resolvedLayer);
      const world = multiply(parentWorldOf(worlds, info.parent), transformToMatrix(t));
      const local = multiply(invert(targetWorld), world);
      layer = writeTransform(layer, transformFromMatrixOrTranslate(local, t));
    }
    moved.push(layer);
  }
  let ab = deleteLayers(artboard, sel);
  ab = insertLayers(ab, moved, { parentId: target.parentId, index });
  return ab;
}

/** Group layers (Ctrl/⌘+G). Layers keep their world transforms; the group box is their union. */
export function groupLayers(artboard: Artboard, ids: string[], opts: { resolved?: Artboard; name?: string; id?: string } = {}): { artboard: Artboard; groupId: string } | null {
  const sel = sortByPaintOrder(artboard, topLevelSelection(artboard, ids));
  if (!sel.length) return null;
  const resolved = opts.resolved ?? artboard;
  const worlds = computeWorldMatrices(resolved);
  // target parent: parent of the topmost selected layer
  const topInfo = findParent(artboard, sel[sel.length - 1])!;
  const parentId = topInfo.parent?.id ?? null;
  const parentWorld = parentWorldOf(worlds, topInfo.parent);
  const invParent = invert(parentWorld);
  // bounds in target parent space
  const rects = sel.map((id) => {
    const l = getLayer(resolved, id)!;
    const world = worlds.get(id) ?? IDENTITY;
    return transformRect(multiply(invParent, world), { x: 0, y: 0, width: l.transform.width, height: l.transform.height });
  });
  const b = unionRects(rects);
  const groupId = opts.id ?? generateId('group');
  const group = createLayer('group', {
    id: groupId,
    name: opts.name ?? 'Group',
    transform: { x: b.x, y: b.y, width: Math.max(1, b.width), height: Math.max(1, b.height) },
    children: [],
  } as any) as GroupLayer;
  const groupWorld = multiply(parentWorld, transformToMatrix(group.transform));
  const invGroup = invert(groupWorld);
  const children: Layer[] = sel.map((id) => {
    const info = findParent(artboard, id)!;
    const raw = info.siblings[info.index];
    const t = numericTransform(raw, getLayer(resolved, id));
    const world = multiply(parentWorldOf(worlds, info.parent), transformToMatrix(t));
    return writeTransform(raw, transformFromMatrixOrTranslate(multiply(invGroup, world), t));
  });
  // insertion index: where the topmost selected layer was (adjusted for removed siblings before it)
  const removedBefore = topInfo.siblings.slice(0, topInfo.index).filter((l) => sel.includes(l.id)).length;
  let ab = deleteLayers(artboard, sel);
  ab = insertLayers(ab, [{ ...group, children } as Layer], { parentId, index: topInfo.index - removedBefore });
  return { artboard: ab, groupId };
}

/** Prefer a pure translation update when the matrix only differs by translation (keeps values clean). */
function transformFromMatrixOrTranslate(m: Matrix, base: Transform): Transform {
  const cur = transformToMatrix(base);
  if ([0, 1, 2, 3].every((i) => Math.abs(cur[i] - m[i]) < 1e-9)) {
    return { ...base, x: base.x + (m[4] - cur[4]), y: base.y + (m[5] - cur[5]) };
  }
  return transformFromMatrix(m, base, 'scale');
}

/** Ungroup (Ctrl/⌘+Shift+G): children move to the group's parent keeping world transforms. */
export function ungroupLayers(artboard: Artboard, ids: string[], opts: { resolved?: Artboard } = {}): { artboard: Artboard; ids: string[] } {
  let ab = artboard;
  const released: string[] = [];
  for (const id of ids) {
    const info = findParent(ab, id);
    if (!info) continue;
    const group = info.siblings[info.index];
    if (group.type !== 'group') continue;
    const gt = numericTransform(group, opts.resolved ? getLayer(opts.resolved, id) : null);
    const G = transformToMatrix(gt);
    const kids: Layer[] = group.children.map((c) => {
      const ct = numericTransform(c, opts.resolved ? getLayer(opts.resolved, c.id) : null);
      let next = writeTransform(c, transformFromMatrixOrTranslate(multiply(G, transformToMatrix(ct)), ct));
      if (group.opacity < 1 && typeof next.opacity === 'number') next = { ...next, opacity: next.opacity * group.opacity };
      if (!group.visible) next = { ...next, visible: false };
      return next;
    });
    // a framed group (fill/strokes) keeps its frame as a rectangle layer at the bottom
    if (group.fill || group.strokes?.length) {
      kids.unshift(
        createLayer('vector', {
          name: `${group.name ?? 'Group'} frame`,
          transform: { ...gt },
          shape: { kind: 'rect', cornerRadius: group.cornerRadius ?? 0 },
          fill: group.fill ?? { type: 'none' },
          strokes: group.strokes ?? [],
          opacity: group.opacity,
        } as any),
      );
    }
    ab = withChildren(ab, info.parent?.id ?? null, (list) => {
      const i = list.findIndex((l) => l.id === id);
      return [...list.slice(0, i), ...kids, ...list.slice(i + 1)];
    });
    released.push(...kids.map((k) => k.id));
  }
  return { artboard: ab, ids: released };
}

export type ZOrderOp = 'forward' | 'backward' | 'front' | 'back';

/** Change z-order within each layer's own parent. */
export function reorderLayers(artboard: Artboard, ids: string[], op: ZOrderOp): Artboard {
  let ab = artboard;
  const sel = sortByPaintOrder(artboard, topLevelSelection(artboard, ids));
  const ordered = op === 'forward' || op === 'front' ? [...sel].reverse() : sel;
  for (const id of ordered) {
    const info = findParent(ab, id);
    if (!info) continue;
    ab = withChildren(ab, info.parent?.id ?? null, (list) => {
      const i = list.findIndex((l) => l.id === id);
      const item = list[i];
      const rest = [...list.slice(0, i), ...list.slice(i + 1)];
      let j = i;
      if (op === 'forward') j = Math.min(list.length - 1, i + 1);
      if (op === 'backward') j = Math.max(0, i - 1);
      if (op === 'front') j = list.length - 1;
      if (op === 'back') j = 0;
      // don't jump over other selected layers when stepping
      return [...rest.slice(0, j), item, ...rest.slice(j)];
    });
  }
  return ab;
}

/** Toggle Photoshop-style clipping mask on layers. */
export function setClippingMask(artboard: Artboard, ids: string[], value: boolean): Artboard {
  let ab = artboard;
  for (const id of ids) ab = mapLayer(ab, id, (l) => ({ ...l, clippingMask: value }));
  return ab;
}

/** Ids of every layer in paint order (for select-all and hit-testing). */
export function allLayerIds(artboard: Artboard, opts: { topLevelOnly?: boolean } = {}): string[] {
  if (opts.topLevelOnly) return artboard.children.map((l) => l.id);
  const out: string[] = [];
  const rec = (list: Layer[]) =>
    list.forEach((l) => {
      out.push(l.id);
      if (isContainer(l)) rec(l.children);
    });
  rec(artboard.children);
  return out;
}

/** Is the layer or any ancestor locked / hidden? */
export function effectiveState(artboard: Artboard, id: string): { locked: boolean; hidden: boolean } {
  let locked = false;
  let hidden = false;
  for (const aid of [...ancestorsOf(artboard, id), id]) {
    const l = getLayer(artboard, aid);
    if (!l) continue;
    if (l.locked) locked = true;
    if (l.visible === false) hidden = true;
  }
  return { locked, hidden };
}
