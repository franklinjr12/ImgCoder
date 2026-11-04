/** Pixel rulers (canvas 2D) with adaptive ticks, selection extents and cursor marker; drag out to create guides. */
import { useEffect, useRef } from 'react';
import type { Transform } from '@game-artisan/core';
import { useStudio } from '../../state/studio';
import { canvasModel, worldWithPreview } from './model';
import { boxCorners } from '../../editor/geometry';

export const RULER = 20;
const STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000];

function css(name: string, fallback: string): string {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  } catch {
    return fallback;
  }
}

export function Rulers({ onStartGuide, preview }: { onStartGuide: (e: React.PointerEvent, axis: 'x' | 'y') => void; preview: Map<string, Transform> | null }) {
  const view = useStudio((s) => s.view);
  const size = useStudio((s) => s.viewportSize);
  const cursor = useStudio((s) => s.cursor);
  const live = useStudio((s) => s.live);
  const selection = useStudio((s) => s.selection);
  const top = useRef<HTMLCanvasElement>(null);
  const left = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let ext: { x0: number; x1: number; y0: number; y1: number } | null = null;
    if (live && selection.length) {
      const model = canvasModel(live);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const id of selection) {
        const l = model.layers.get(id);
        if (!l) continue;
        const t = preview?.get(id) ?? l.transform;
        for (const c of boxCorners(worldWithPreview(model, id, preview), t.width, t.height)) {
          x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y); x1 = Math.max(x1, c.x); y1 = Math.max(y1, c.y);
        }
      }
      if (Number.isFinite(x0)) ext = { x0, x1, y0, y1 };
    }
    draw(top.current, 'x', size.width, view.zoom, view.panX, cursor?.x, ext ? [ext.x0, ext.x1] : null, live ? [0, live.width] : null);
    draw(left.current, 'y', size.height, view.zoom, view.panY, cursor?.y, ext ? [ext.y0, ext.y1] : null, live ? [0, live.height] : null);
  }, [view, size, cursor, live, selection, preview]);

  return (
    <>
      <div className="ruler-corner" />
      <canvas ref={top} className="ruler ruler-x" onPointerDown={(e) => onStartGuide(e, 'y')} title="Drag to create a horizontal guide" />
      <canvas ref={left} className="ruler ruler-y" onPointerDown={(e) => onStartGuide(e, 'x')} title="Drag to create a vertical guide" />
    </>
  );
}

function draw(c: HTMLCanvasElement | null, axis: 'x' | 'y', length: number, zoom: number, pan: number, cursor: number | undefined, sel: [number, number] | null, board: [number, number] | null) {
  if (!c) return;
  const dpr = window.devicePixelRatio || 1;
  const L = Math.max(1, Math.round(length));
  const w = axis === 'x' ? L : RULER;
  const h = axis === 'x' ? RULER : L;
  if (c.width !== w * dpr || c.height !== h * dpr) {
    c.width = w * dpr;
    c.height = h * dpr;
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
  }
  const ctx = c.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = css('--ruler-bg', '#16181f');
  ctx.fillRect(0, 0, w, h);
  const along = (v: number) => v * zoom + pan;
  // artboard extent
  if (board) {
    ctx.fillStyle = css('--ruler-board', 'rgba(255,255,255,0.04)');
    const a = along(board[0]);
    const b = along(board[1]);
    if (axis === 'x') ctx.fillRect(a, 0, b - a, RULER);
    else ctx.fillRect(0, a, RULER, b - a);
  }
  if (sel) {
    ctx.fillStyle = css('--ruler-sel', 'rgba(99,135,255,0.28)');
    const a = along(sel[0]);
    const b = along(sel[1]);
    if (axis === 'x') ctx.fillRect(a, 0, Math.max(1, b - a), RULER);
    else ctx.fillRect(0, a, RULER, Math.max(1, b - a));
  }
  const step = STEPS.find((s) => s * zoom >= 64) ?? 10000;
  const minor = step / (step % 5 === 0 ? 5 : 2);
  const start = Math.floor(-pan / zoom / minor) * minor;
  const end = (L - pan) / zoom;
  ctx.strokeStyle = css('--ruler-tick', '#3a3f4f');
  ctx.fillStyle = css('--ruler-text', '#8b91a5');
  ctx.font = '10px "Inter UI", Inter, system-ui, sans-serif';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let v = start; v <= end; v += minor) {
    const p = Math.round(along(v)) + 0.5;
    const isMajor = Math.abs(v / step - Math.round(v / step)) < 1e-6;
    const len = isMajor ? RULER : 5;
    if (axis === 'x') {
      ctx.moveTo(p, RULER);
      ctx.lineTo(p, RULER - len);
    } else {
      ctx.moveTo(RULER, p);
      ctx.lineTo(RULER - len, p);
    }
    if (isMajor) {
      const label = String(Math.round(v));
      if (axis === 'x') ctx.fillText(label, p + 3, 10);
      else {
        ctx.save();
        ctx.translate(10, p + 3);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(label, 0, 0);
        ctx.restore();
      }
    }
  }
  ctx.stroke();
  // bottom/right border
  ctx.fillStyle = css('--border', '#262a36');
  if (axis === 'x') ctx.fillRect(0, RULER - 1, w, 1);
  else ctx.fillRect(RULER - 1, 0, 1, h);
  if (cursor != null) {
    const p = Math.round(along(cursor)) + 0.5;
    ctx.strokeStyle = css('--accent', '#6387ff');
    ctx.beginPath();
    if (axis === 'x') {
      ctx.moveTo(p, 0);
      ctx.lineTo(p, RULER);
    } else {
      ctx.moveTo(0, p);
      ctx.lineTo(RULER, p);
    }
    ctx.stroke();
  }
}
