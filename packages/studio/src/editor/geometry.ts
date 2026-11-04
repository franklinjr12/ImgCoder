/**
 * Gizmo math (framework-free, unit tested): resize/rotate/skew of single layers that may be
 * rotated, skewed, scaled or nested, collective transforms of multi-selections, and matrix →
 * UDM transform decomposition used by group/ungroup/reparenting.
 *
 * Conventions: a layer's local matrix is core `transformToMatrix(t)` (T·R·K·S about origin),
 * mapping local box coordinates (0..width, 0..height) into its parent's space. "Parent space"
 * is the coordinate system of the layer's parent (artboard space for top-level layers).
 */
import { applyToPoint, compose, invert, multiply, rotate as rotateM, transformToMatrix, translate, type Matrix, type Point, type Rect, type Transform } from '@game-artisan/core';

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Handle position as fractions of the box. */
export const HANDLE_POS: Record<Handle, [number, number]> = {
  nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5],
};

const RAD = Math.PI / 180;
export const deg = (rad: number) => rad / RAD;
export const rad = (d: number) => d * RAD;

/** Normalise an angle to (-180, 180]. */
export function normAngle(a: number): number {
  let r = a % 360;
  if (r <= -180) r += 360;
  if (r > 180) r -= 360;
  return Math.abs(r) < 1e-9 ? 0 : r;
}

const round = (v: number, p = 1e6) => Math.round(v * p) / p;

/** Round transform numbers to avoid float noise in documents. */
export function tidyTransform(t: Transform): Transform {
  return {
    ...t,
    x: round(t.x, 1e4),
    y: round(t.y, 1e4),
    width: round(t.width, 1e4),
    height: round(t.height, 1e4),
    rotation: round(normAngle(t.rotation), 1e4),
    skewX: round(t.skewX, 1e4),
    skewY: round(t.skewY, 1e4),
    scaleX: round(t.scaleX, 1e6),
    scaleY: round(t.scaleY, 1e6),
  };
}

/** Vector (not point) transform: linear part only. */
export function applyToVector(m: Matrix, v: Point): Point {
  return { x: m[0] * v.x + m[2] * v.y, y: m[1] * v.x + m[3] * v.y };
}

/** The 4 corners of a layer box in the space `m` maps to (clockwise from top-left). */
export function boxCorners(m: Matrix, width: number, height: number): Point[] {
  return [
    applyToPoint(m, { x: 0, y: 0 }),
    applyToPoint(m, { x: width, y: 0 }),
    applyToPoint(m, { x: width, y: height }),
    applyToPoint(m, { x: 0, y: height }),
  ];
}

/** Same transform with a new box size such that local anchor (fractions) keeps its parent-space position. */
export function resizeKeepingAnchor(t: Transform, width: number, height: number, anchor: [number, number]): Transform {
  const before = applyToPoint(transformToMatrix(t), { x: anchor[0] * t.width, y: anchor[1] * t.height });
  const next: Transform = { ...t, width, height, x: 0, y: 0 };
  const p0 = applyToPoint(transformToMatrix(next), { x: anchor[0] * width, y: anchor[1] * height });
  next.x = before.x - p0.x;
  next.y = before.y - p0.y;
  return next;
}

export interface ResizeOptions {
  /** Shift: keep the aspect ratio. */
  keepAspect?: boolean;
  /** Alt: resize symmetrically around the centre. */
  fromCenter?: boolean;
  minSize?: number;
}

/**
 * Resize a (possibly rotated/skewed/scaled) layer by dragging one of its 8 handles.
 * Pointer positions are in the layer's parent space. The opposite handle (or the centre with
 * `fromCenter`) stays fixed.
 */
export function resizeTransform(start: Transform, handle: Handle, startPointer: Point, pointer: Point, opts: ResizeOptions = {}): Transform {
  const min = opts.minSize ?? 1;
  const inv = invert(transformToMatrix(start));
  const l0 = applyToPoint(inv, startPointer);
  const l1 = applyToPoint(inv, pointer);
  const [hx, hy] = HANDLE_POS[handle];
  // handle position in local units, moved by the pointer delta (keeps the grab offset)
  const hp = { x: hx * start.width + (l1.x - l0.x), y: hy * start.height + (l1.y - l0.y) };
  const anchor: [number, number] = opts.fromCenter ? [0.5, 0.5] : [1 - hx, 1 - hy];
  const affectsX = hx !== 0.5;
  const affectsY = hy !== 0.5;
  let w = start.width;
  let h = start.height;
  if (affectsX) {
    const dir = hx > anchor[0] ? 1 : -1;
    const span = (hp.x - anchor[0] * start.width) * dir;
    w = opts.fromCenter ? span * 2 : span;
  }
  if (affectsY) {
    const dir = hy > anchor[1] ? 1 : -1;
    const span = (hp.y - anchor[1] * start.height) * dir;
    h = opts.fromCenter ? span * 2 : span;
  }
  if (opts.keepAspect && start.width > 0 && start.height > 0) {
    const ratio = start.width / start.height;
    if (affectsX && affectsY) {
      const sx = w / start.width;
      const sy = h / start.height;
      const s = Math.max(sx, sy);
      w = start.width * s;
      h = start.height * s;
    } else if (affectsX) h = w / ratio;
    else w = h * ratio;
  }
  if (opts.keepAspect && start.width > 0 && start.height > 0 && (w < min || h < min)) {
    const ratio = start.width / start.height;
    if (w < min) {
      w = min;
      h = Math.max(min, w / ratio);
    }
    if (h < min) {
      h = min;
      w = Math.max(min, h * ratio);
    }
  }
  w = Math.max(min, w);
  h = Math.max(min, h);
  const fixed: [number, number] = [affectsX ? anchor[0] : 0.5, affectsY ? anchor[1] : 0.5];
  if (!affectsX && !opts.keepAspect) fixed[0] = 0.5;
  return resizeKeepingAnchor(start, w, h, fixed);
}

/** Parent-space position of the transform pivot (rotation origin). */
export function pivotOf(t: Transform): Point {
  return applyToPoint(transformToMatrix(t), { x: t.originX * t.width, y: t.originY * t.height });
}

/** Rotate about the pivot by the angle swept by the pointer. `snap` (e.g. 15) rounds the result. */
export function rotateTransform(start: Transform, startPointer: Point, pointer: Point, snap?: number): Transform {
  const c = pivotOf(start);
  const a0 = Math.atan2(startPointer.y - c.y, startPointer.x - c.x);
  const a1 = Math.atan2(pointer.y - c.y, pointer.x - c.x);
  let r = start.rotation + deg(a1 - a0);
  if (snap) r = Math.round(r / snap) * snap;
  return { ...start, rotation: normAngle(r) };
}

/**
 * Skew by dragging a side handle (Ctrl/⌘ + drag): top/bottom edges shear horizontally
 * (skewX), left/right edges shear vertically (skewY). The opposite edge stays fixed.
 */
export function skewTransform(start: Transform, handle: 'n' | 's' | 'e' | 'w', startPointer: Point, pointer: Point, maxDeg = 85): Transform {
  const ox = start.originX * start.width;
  const oy = start.originY * start.height;
  // frame after rotation, before skew/scale (centred on the pivot)
  const F = compose(translate(start.x + ox, start.y + oy), rotateM(start.rotation));
  const Finv = invert(F);
  const q0 = applyToPoint(Finv, startPointer);
  const q1 = applyToPoint(Finv, pointer);
  const sx = start.scaleX * (start.flipX ? -1 : 1);
  const sy = start.scaleY * (start.flipY ? -1 : 1);
  const clamp = (d: number) => Math.max(-maxDeg, Math.min(maxDeg, d));
  let next: Transform;
  let anchor: [number, number];
  if (handle === 'n' || handle === 's') {
    const span = sy * start.height;
    if (Math.abs(span) < 1e-9) return start;
    const dir = handle === 's' ? 1 : -1;
    const tan0 = Math.tan(rad(start.skewX));
    const tan = tan0 + (dir * (q1.x - q0.x)) / span;
    next = { ...start, skewX: clamp(deg(Math.atan(tan))) };
    anchor = [0.5, handle === 's' ? 0 : 1];
  } else {
    const span = sx * start.width;
    if (Math.abs(span) < 1e-9) return start;
    const dir = handle === 'e' ? 1 : -1;
    const tan0 = Math.tan(rad(start.skewY));
    const tan = tan0 + (dir * (q1.y - q0.y)) / span;
    next = { ...start, skewY: clamp(deg(Math.atan(tan))) };
    anchor = [handle === 'e' ? 0 : 1, 0.5];
  }
  // keep the opposite edge's midpoint fixed
  const before = applyToPoint(transformToMatrix(start), { x: anchor[0] * start.width, y: anchor[1] * start.height });
  const after = applyToPoint(transformToMatrix(next), { x: anchor[0] * next.width, y: anchor[1] * next.height });
  return { ...next, x: next.x + before.x - after.x, y: next.y + before.y - after.y };
}

/** Translate by a world-space delta, converting it into the layer's parent space. */
export function translateTransform(start: Transform, parentWorld: Matrix, dWorld: Point): Transform {
  const d = applyToVector(invert(parentWorld), dWorld);
  return { ...start, x: start.x + d.x, y: start.y + d.y };
}

/**
 * Find the UDM transform whose matrix maps the base layer's local box like `m` does (the box is
 * mapped into the parent). Keeps the base origin. Rotation + skewX (+flip) are extracted exactly;
 * the remaining scale is absorbed either into the box size (`mode: 'size'`, default — boxes are
 * resized, text re-wraps) or into scaleX/scaleY (`mode: 'scale'` — exact visual preservation,
 * used for group/ungroup/reparenting).
 */
export function transformFromMatrix(m: Matrix, base: Transform, mode: 'size' | 'scale' = 'size'): Transform {
  const [a, b, c, d] = m;
  const px = Math.hypot(a, b);
  if (px < 1e-12) return base;
  const theta = Math.atan2(b, a);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  let py = -sin * c + cos * d;
  const t = (cos * c + sin * d) / (Math.abs(py) < 1e-12 ? 1e-12 : py);
  const flipY = py < 0;
  py = Math.abs(py);
  const next: Transform = { ...base, x: 0, y: 0, rotation: normAngle(deg(theta)), skewX: deg(Math.atan(t)), skewY: 0 };
  delete next.flipX;
  delete next.flipY;
  if (flipY) next.flipY = true;
  if (mode === 'size') {
    const s0x = Math.abs(base.scaleX) || 1;
    const s0y = Math.abs(base.scaleY) || 1;
    next.scaleX = s0x;
    next.scaleY = s0y;
    // the new box is the old one scaled by (px/s0x, py/s0y): local point (u,v) → (u·kx, v·ky)
    next.width = (px * base.width) / s0x;
    next.height = (py * base.height) / s0y;
  } else {
    next.scaleX = px;
    next.scaleY = py;
  }
  // solve the translation so the box's top-left corner lands where m puts it
  const m0 = transformToMatrix(next);
  next.x = m[4] - m0[4];
  next.y = m[5] - m0[5];
  return next;
}

/** Rescale a matrix's local units: returns m·diag(sx, sy). */
export function scaleLocal(m: Matrix, sx: number, sy: number): Matrix {
  return multiply(m, [sx, 0, 0, sy, 0, 0]);
}

export interface SelectionItem {
  id: string;
  transform: Transform;
  /** world matrix of the layer's parent (identity for top-level layers) */
  parentWorld: Matrix;
}

/** Collective translation of a multi-selection by a world-space delta. */
export function translateSelection(items: SelectionItem[], d: Point): Map<string, Transform> {
  const out = new Map<string, Transform>();
  for (const it of items) out.set(it.id, translateTransform(it.transform, it.parentWorld, d));
  return out;
}

/**
 * Collective scale of a multi-selection about a world-space anchor. Each layer's world matrix is
 * pre-multiplied by the scale, and converted back to a UDM transform in its parent space.
 */
export function scaleSelection(items: SelectionItem[], anchor: Point, sx: number, sy: number): Map<string, Transform> {
  const S: Matrix = compose(translate(anchor.x, anchor.y), [sx, 0, 0, sy, 0, 0], translate(-anchor.x, -anchor.y));
  const out = new Map<string, Transform>();
  for (const it of items) {
    const L = transformToMatrix(it.transform);
    const P = it.parentWorld;
    const Lp = multiply(invert(P), multiply(S, multiply(P, L)));
    out.set(it.id, transformFromMatrix(Lp, it.transform));
  }
  return out;
}

/** Collective rotation about a world-space centre (keeps each layer's skew/size). */
export function rotateSelection(items: SelectionItem[], center: Point, deltaDeg: number): Map<string, Transform> {
  const R: Matrix = compose(translate(center.x, center.y), rotateM(deltaDeg), translate(-center.x, -center.y));
  const out = new Map<string, Transform>();
  for (const it of items) {
    const t = it.transform;
    const pivotWorld = applyToPoint(it.parentWorld, pivotOf(t));
    const newPivotWorld = applyToPoint(R, pivotWorld);
    const newPivotParent = applyToPoint(invert(it.parentWorld), newPivotWorld);
    const det = it.parentWorld[0] * it.parentWorld[3] - it.parentWorld[1] * it.parentWorld[2];
    const rot = t.rotation + (det < 0 ? -deltaDeg : deltaDeg);
    const next = { ...t, rotation: normAngle(rot) };
    const p = pivotOf({ ...next, x: 0, y: 0 });
    out.set(it.id, { ...next, x: newPivotParent.x - p.x, y: newPivotParent.y - p.y });
  }
  return out;
}

/** World-space anchor point of a handle on an axis-aligned rect (opposite handle, or centre). */
export function rectAnchor(r: Rect, handle: Handle, fromCenter = false): Point {
  if (fromCenter) return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  const [hx, hy] = HANDLE_POS[handle];
  return { x: r.x + (1 - hx) * r.width, y: r.y + (1 - hy) * r.height };
}

/** Scale factors for dragging a handle of an axis-aligned selection rect. */
export function rectScaleFactors(r: Rect, handle: Handle, startPointer: Point, pointer: Point, opts: ResizeOptions = {}): { sx: number; sy: number; anchor: Point } {
  const [hx, hy] = HANDLE_POS[handle];
  const anchor = rectAnchor(r, handle, opts.fromCenter);
  const hp = { x: r.x + hx * r.width + (pointer.x - startPointer.x), y: r.y + hy * r.height + (pointer.y - startPointer.y) };
  const handleStart = { x: r.x + hx * r.width, y: r.y + hy * r.height };
  let sx = 1;
  let sy = 1;
  if (hx !== 0.5 && Math.abs(handleStart.x - anchor.x) > 1e-9) sx = (hp.x - anchor.x) / (handleStart.x - anchor.x);
  if (hy !== 0.5 && Math.abs(handleStart.y - anchor.y) > 1e-9) sy = (hp.y - anchor.y) / (handleStart.y - anchor.y);
  if (opts.keepAspect) {
    if (hx !== 0.5 && hy !== 0.5) sx = sy = Math.max(sx, sy);
    else if (hx !== 0.5) sy = sx;
    else sx = sy;
  }
  const minS = 1e-3;
  sx = Math.max(minS, sx);
  sy = Math.max(minS, sy);
  return { sx, sy, anchor };
}

/** Screen cursor for a handle given the box's on-screen rotation. */
export function handleCursor(handle: Handle, rotationDeg: number): string {
  const base: Record<Handle, number> = { e: 0, se: 45, s: 90, sw: 135, w: 180, nw: 225, n: 270, ne: 315 };
  const a = (((base[handle] + rotationDeg) % 180) + 180) % 180;
  const idx = Math.round(a / 45) % 4;
  return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][idx];
}
