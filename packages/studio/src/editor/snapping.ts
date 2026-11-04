/**
 * Snapping engine (framework-free): artboard edges/centre, other layers' edges/centres,
 * guides and the pixel grid. Returns the snap offset plus "smart guide" lines to draw.
 */
import { transformRect, type Artboard, type Guide, type Layer, type Matrix, type Rect } from '@game-artisan/core';
import { walkLayers } from '@game-artisan/core';

export type SnapSource = 'artboard' | 'layer' | 'guide';

export interface SnapLine {
  /** Coordinate on the snapped axis (artboard space). */
  value: number;
  source: SnapSource;
  /** 'edge' or 'center' of the source */
  role: 'start' | 'center' | 'end' | 'guide';
  /** Extent of the source along the other axis (for drawing smart guides). */
  from: number;
  to: number;
  layerId?: string;
}

export interface SnapTargets {
  x: SnapLine[];
  y: SnapLine[];
}

export interface SmartGuide {
  axis: 'x' | 'y';
  /** position on the axis */
  value: number;
  from: number;
  to: number;
  source: SnapSource;
}

export interface SnapOptions {
  /** max distance (artboard px) to snap */
  threshold: number;
  /** round to whole pixels when no target snaps */
  pixelGrid?: boolean;
  /** enable snapping to objects/artboard/guides */
  objects?: boolean;
  guides?: boolean;
}

/** Collect snap targets from the artboard, all visible layers except `exclude` (and their descendants), and guides. */
export function collectSnapTargets(artboard: Artboard, exclude: Iterable<string>, guides: Guide[] = artboard.guides ?? []): SnapTargets {
  const ex = new Set(exclude);
  const W = artboard.width;
  const H = artboard.height;
  const x: SnapLine[] = [
    { value: 0, source: 'artboard', role: 'start', from: 0, to: H },
    { value: W / 2, source: 'artboard', role: 'center', from: 0, to: H },
    { value: W, source: 'artboard', role: 'end', from: 0, to: H },
  ];
  const y: SnapLine[] = [
    { value: 0, source: 'artboard', role: 'start', from: 0, to: W },
    { value: H / 2, source: 'artboard', role: 'center', from: 0, to: W },
    { value: H, source: 'artboard', role: 'end', from: 0, to: W },
  ];
  walkLayers(artboard, ({ layer, matrix }) => {
    if (ex.has(layer.id) || layer.visible === false) return false;
    const r = transformRect(matrix, { x: 0, y: 0, width: layer.transform.width, height: layer.transform.height });
    // skip full-bleed backgrounds: they duplicate artboard edges
    const fullBleed = Math.abs(r.x) < 0.5 && Math.abs(r.y) < 0.5 && Math.abs(r.width - W) < 0.5 && Math.abs(r.height - H) < 0.5;
    if (!fullBleed) pushRect(x, y, r, layer.id);
    return layer.type === 'group' ? undefined : false;
  });
  for (const g of guides) {
    if (g.axis === 'x') x.push({ value: g.position, source: 'guide', role: 'guide', from: -1e6, to: 1e6 });
    else y.push({ value: g.position, source: 'guide', role: 'guide', from: -1e6, to: 1e6 });
  }
  return { x, y };
}

function pushRect(x: SnapLine[], y: SnapLine[], r: Rect, layerId: string) {
  x.push({ value: r.x, source: 'layer', role: 'start', from: r.y, to: r.y + r.height, layerId });
  x.push({ value: r.x + r.width / 2, source: 'layer', role: 'center', from: r.y, to: r.y + r.height, layerId });
  x.push({ value: r.x + r.width, source: 'layer', role: 'end', from: r.y, to: r.y + r.height, layerId });
  y.push({ value: r.y, source: 'layer', role: 'start', from: r.x, to: r.x + r.width, layerId });
  y.push({ value: r.y + r.height / 2, source: 'layer', role: 'center', from: r.x, to: r.x + r.width, layerId });
  y.push({ value: r.y + r.height, source: 'layer', role: 'end', from: r.x, to: r.x + r.width, layerId });
}

function filterLines(lines: SnapLine[], opts: SnapOptions): SnapLine[] {
  return lines.filter((l) => (l.source === 'guide' ? opts.guides !== false : opts.objects !== false));
}

/** Best snap of any of `candidates` to `lines`: returns offset to add, or null. */
export function snapValues(candidates: number[], lines: SnapLine[], threshold: number): { offset: number; matches: { candidate: number; line: SnapLine }[] } | null {
  let best: number | null = null;
  for (const c of candidates) {
    for (const l of lines) {
      const d = l.value - c;
      if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best) - 1e-9)) best = d;
    }
  }
  if (best === null) return null;
  const matches: { candidate: number; line: SnapLine }[] = [];
  for (const c of candidates) for (const l of lines) if (Math.abs(l.value - c - best) < 1e-6) matches.push({ candidate: c, line: l });
  return { offset: best, matches };
}

/**
 * Snap a moving rect (artboard space). Returns the delta to add to the rect position and the
 * smart guides to display.
 */
export function snapRect(rect: Rect, targets: SnapTargets, opts: SnapOptions): { dx: number; dy: number; guides: SmartGuide[] } {
  const xs = [rect.x, rect.x + rect.width / 2, rect.x + rect.width];
  const ys = [rect.y, rect.y + rect.height / 2, rect.y + rect.height];
  const sx = snapValues(xs, filterLines(targets.x, opts), opts.threshold);
  const sy = snapValues(ys, filterLines(targets.y, opts), opts.threshold);
  let dx = sx?.offset ?? 0;
  let dy = sy?.offset ?? 0;
  if (!sx && opts.pixelGrid) dx = Math.round(rect.x) - rect.x;
  if (!sy && opts.pixelGrid) dy = Math.round(rect.y) - rect.y;
  const r = { x: rect.x + dx, y: rect.y + dy, width: rect.width, height: rect.height };
  const guides: SmartGuide[] = [];
  if (sx) {
    for (const m of dedupe(sx.matches.map((m) => m.line))) {
      guides.push({ axis: 'x', value: m.value, from: Math.min(r.y, m.from), to: Math.max(r.y + r.height, m.to), source: m.source });
    }
  }
  if (sy) {
    for (const m of dedupe(sy.matches.map((m) => m.line))) {
      guides.push({ axis: 'y', value: m.value, from: Math.min(r.x, m.from), to: Math.max(r.x + r.width, m.to), source: m.source });
    }
  }
  return { dx, dy, guides: clampGuides(guides) };
}

/** Snap a single point (e.g. a resize handle) on the requested axes. */
export function snapPoint(p: { x: number; y: number }, targets: SnapTargets, opts: SnapOptions, axes: { x: boolean; y: boolean } = { x: true, y: true }): { x: number; y: number; guides: SmartGuide[] } {
  const guides: SmartGuide[] = [];
  let { x, y } = p;
  if (axes.x) {
    const s = snapValues([p.x], filterLines(targets.x, opts), opts.threshold);
    if (s) {
      x = p.x + s.offset;
      for (const l of dedupe(s.matches.map((m) => m.line))) guides.push({ axis: 'x', value: l.value, from: Math.min(p.y, l.from), to: Math.max(p.y, l.to), source: l.source });
    } else if (opts.pixelGrid) x = Math.round(p.x);
  }
  if (axes.y) {
    const s = snapValues([p.y], filterLines(targets.y, opts), opts.threshold);
    if (s) {
      y = p.y + s.offset;
      for (const l of dedupe(s.matches.map((m) => m.line))) guides.push({ axis: 'y', value: l.value, from: Math.min(p.x, l.from), to: Math.max(p.x, l.to), source: l.source });
    } else if (opts.pixelGrid) y = Math.round(p.y);
  }
  return { x, y, guides: clampGuides(guides) };
}

function dedupe(lines: SnapLine[]): SnapLine[] {
  const seen = new Map<string, SnapLine>();
  for (const l of lines) {
    const k = `${l.source}:${l.value.toFixed(3)}`;
    const prev = seen.get(k);
    if (!prev) seen.set(k, { ...l });
    else {
      prev.from = Math.min(prev.from, l.from);
      prev.to = Math.max(prev.to, l.to);
    }
  }
  return [...seen.values()];
}

function clampGuides(g: SmartGuide[]): SmartGuide[] {
  return g.map((s) => (s.source === 'guide' ? { ...s, from: -1e5, to: 1e5 } : s));
}

/** Snap an angle to a step when within `tolerance` degrees (used by rotation without Shift). */
export function softSnapAngle(angle: number, step = 45, tolerance = 2): number {
  const r = Math.round(angle / step) * step;
  return Math.abs(r - angle) <= tolerance ? r : angle;
}

/** World-space AABB of a layer box. */
export function worldRect(matrix: Matrix, layer: Pick<Layer, 'transform'>): Rect {
  return transformRect(matrix, { x: 0, y: 0, width: layer.transform.width, height: layer.transform.height });
}
