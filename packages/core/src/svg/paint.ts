import { svgColor } from '../color.js';
import type { Fill, GradientStop } from '../udm/schema.js';
import { el, num } from './xml.js';

export interface PaintContext {
  addDef(markup: string): void;
  nextId(kind: string): string;
}

function stops(list: GradientStop[]): string {
  const sorted = [...list].sort((a, b) => a.offset - b.offset);
  return sorted
    .map((s) => {
      const c = svgColor(s.color);
      return el('stop', { offset: num(s.offset), 'stop-color': c.hex, 'stop-opacity': c.opacity < 1 ? c.opacity : undefined });
    })
    .join('');
}

/** CSS-compatible linear gradient endpoints for an angle inside a w×h box. */
export function linearGradientPoints(angleDeg: number, w: number, h: number) {
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  const len = Math.abs(w * dx) + Math.abs(h * dy);
  const cx = w / 2;
  const cy = h / 2;
  return { x1: cx - (dx * len) / 2, y1: cy - (dy * len) / 2, x2: cx + (dx * len) / 2, y2: cy + (dy * len) / 2 };
}

/** Returns SVG paint attributes ({fill, fill-opacity}) for a Fill in a w×h local box. */
export function paint(fill: Fill | undefined, w: number, h: number, ctx: PaintContext, prop: 'fill' | 'stroke' = 'fill'): Record<string, string | number | undefined> {
  if (!fill || fill.type === 'none') return { [prop]: 'none' };
  if (fill.type === 'solid') {
    const c = svgColor(fill.color);
    if (c.opacity === 0) return { [prop]: 'none' };
    return { [prop]: c.hex, [`${prop}-opacity`]: c.opacity < 1 ? c.opacity : undefined };
  }
  const id = ctx.nextId('g');
  if (fill.type === 'linear-gradient') {
    const p = linearGradientPoints(fill.angle ?? 180, w, h);
    ctx.addDef(el('linearGradient', { id, gradientUnits: 'userSpaceOnUse', x1: num(p.x1), y1: num(p.y1), x2: num(p.x2), y2: num(p.y2) }, stops(fill.stops)));
  } else {
    const cx = (fill.cx ?? 0.5) * w;
    const cy = (fill.cy ?? 0.5) * h;
    const r = (fill.r ?? 0.5) * w;
    const sy = w ? h / w : 1;
    ctx.addDef(
      el(
        'radialGradient',
        {
          id,
          gradientUnits: 'userSpaceOnUse',
          cx: num(cx),
          cy: num(cy),
          r: num(Math.max(r, 0.001)),
          fx: fill.fx != null ? num(fill.fx * w) : undefined,
          fy: fill.fy != null ? num(fill.fy * h) : undefined,
          gradientTransform: Math.abs(sy - 1) > 1e-6 ? `translate(${num(cx)} ${num(cy)}) scale(1 ${num(sy)}) translate(${num(-cx)} ${num(-cy)})` : undefined,
        },
        stops(fill.stops),
      ),
    );
  }
  return { [prop]: `url(#${id})` };
}

export function solid(color: string): Fill {
  return { type: 'solid', color };
}
