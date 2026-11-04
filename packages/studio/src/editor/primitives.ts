/**
 * Layer factories for the insert toolbar (framework-free).
 */
import { createLayer, createTextStyle, type Layer } from '@game-artisan/core';

export type PrimitiveKind =
  | 'text'
  | 'heading'
  | 'rect'
  | 'ellipse'
  | 'polygon'
  | 'star'
  | 'line'
  | 'path'
  | 'gradient'
  | 'halftone'
  | 'scanlines'
  | 'pattern'
  | 'group';

export const PRIMITIVE_LABELS: Record<PrimitiveKind, string> = {
  text: 'Text',
  heading: 'Title',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  polygon: 'Polygon',
  star: 'Star',
  line: 'Line',
  path: 'Path (arrow)',
  gradient: 'Gradient overlay',
  halftone: 'Halftone',
  scanlines: 'Scanlines',
  pattern: 'Pattern',
  group: 'Frame',
};

export interface InsertContext {
  artboardWidth: number;
  artboardHeight: number;
  /** Centre point (artboard space) where the layer should appear. */
  at?: { x: number; y: number };
}

/** Create a new layer of the given kind, sized relative to the artboard. */
export function createPrimitive(kind: PrimitiveKind, ctx: InsertContext): Layer {
  const W = ctx.artboardWidth;
  const H = ctx.artboardHeight;
  const unit = Math.max(16, Math.round(Math.min(W, H) * 0.3));
  const cx = ctx.at?.x ?? W / 2;
  const cy = ctx.at?.y ?? H / 2;
  const box = (w: number, h: number) => ({ x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), width: Math.round(w), height: Math.round(h) });
  switch (kind) {
    case 'text': {
      const size = Math.max(10, Math.round(Math.min(W, H) * 0.08));
      return createLayer('text', {
        name: 'Text',
        content: 'Your text',
        transform: box(Math.max(60, size * 7), size * 1.3),
        style: createTextStyle({ fontSize: size, fontWeight: 700, fill: { type: 'solid', color: '#ffffff' } }),
        sizing: 'auto-height',
      } as any);
    }
    case 'heading': {
      const size = Math.max(14, Math.round(Math.min(W, H) * 0.16));
      return createLayer('text', {
        name: 'Title',
        content: 'GAME TITLE',
        transform: box(Math.min(W * 0.9, size * 8), size * 1.25),
        style: createTextStyle({
          fontFamily: 'Cinzel',
          fontSize: size,
          fontWeight: 900,
          textAlign: 'center',
          verticalAlign: 'middle',
          fit: 'shrink',
          fill: { type: 'linear-gradient', angle: 180, stops: [{ offset: 0, color: '#fff6d5' }, { offset: 1, color: '#f0a020' }] },
          strokes: [
            { color: '#3a1d00', width: Math.max(1, Math.round(size / 18)), cap: 'butt', join: 'round', align: 'outside' },
            { color: '#000000', width: Math.max(1, Math.round(size / 14)), cap: 'butt', join: 'round', align: 'outside' },
          ],
        }),
        effects: [{ type: 'drop-shadow', color: 'rgba(0,0,0,0.7)', x: 0, y: Math.max(2, size / 12), blur: Math.max(2, size / 8), spread: 0, opacity: 1 }],
      } as any);
    }
    case 'rect':
      return createLayer('vector', { name: 'Rectangle', transform: box(unit * 1.4, unit), shape: { kind: 'rect', cornerRadius: Math.round(unit / 12) }, fill: { type: 'solid', color: '#4f7cff' } } as any);
    case 'ellipse':
      return createLayer('vector', { name: 'Ellipse', transform: box(unit, unit), shape: { kind: 'ellipse' }, fill: { type: 'solid', color: '#ff4f8b' } } as any);
    case 'polygon':
      return createLayer('vector', { name: 'Polygon', transform: box(unit, unit), shape: { kind: 'polygon', sides: 6, rotation: 0 }, fill: { type: 'solid', color: '#29c27f' } } as any);
    case 'star':
      return createLayer('vector', { name: 'Star', transform: box(unit, unit), shape: { kind: 'star', points: 5, innerRatio: 0.5, rotation: 0 }, fill: { type: 'solid', color: '#ffc933' } } as any);
    case 'line':
      return createLayer('vector', {
        name: 'Line',
        transform: box(unit * 1.5, 4),
        shape: { kind: 'line', points: [{ x: 0, y: 2 }, { x: Math.round(unit * 1.5), y: 2 }], closed: false },
        fill: { type: 'none' },
        strokes: [{ color: '#ffffff', width: 4, cap: 'round', join: 'round', align: 'center' }],
      } as any);
    case 'path':
      return createLayer('vector', {
        name: 'Arrow',
        transform: box(unit * 1.2, unit * 0.7),
        shape: { kind: 'path', d: 'M0 35 L70 35 L70 10 L120 50 L70 90 L70 65 L0 65 Z', viewBox: [0, 0, 120, 100], fillRule: 'nonzero' },
        fill: { type: 'solid', color: '#ffffff' },
      } as any);
    case 'gradient':
      return createLayer('vector', {
        name: 'Gradient overlay',
        transform: { x: 0, y: 0, width: W, height: H },
        shape: { kind: 'rect', cornerRadius: 0 },
        fill: { type: 'linear-gradient', angle: 180, stops: [{ offset: 0.35, color: 'rgba(0,0,0,0)' }, { offset: 1, color: 'rgba(0,0,0,0.85)' }] },
      } as any);
    case 'halftone':
      return createLayer('halftone', { name: 'Halftone', transform: { x: 0, y: 0, width: W, height: H }, spacing: Math.max(4, Math.round(Math.min(W, H) / 40)), color: 'rgba(0,0,0,0.55)', blendMode: 'multiply' } as any);
    case 'scanlines':
      return createLayer('pattern', { name: 'Scanlines', transform: { x: 0, y: 0, width: W, height: H }, pattern: 'scanlines', spacing: 3, thickness: 1, color: 'rgba(0,0,0,0.35)' } as any);
    case 'pattern':
      return createLayer('pattern', { name: 'Pattern', transform: box(unit * 1.4, unit), pattern: 'checker', spacing: 8, thickness: 1, color: 'rgba(255,255,255,0.25)' } as any);
    case 'group':
      return createLayer('group', { name: 'Frame', transform: box(unit * 1.4, unit), fill: { type: 'solid', color: '#1f2433' }, cornerRadius: 8, clipContent: true, children: [] } as any);
  }
}

/** Raster or SVG layer for an image asset dropped/inserted at a point, fitted inside the artboard. */
export function createImageLayer(opts: { src: string; name?: string; width?: number; height?: number; mime?: string; artboardWidth: number; artboardHeight: number; at?: { x: number; y: number } }): Layer {
  const W = opts.artboardWidth;
  const H = opts.artboardHeight;
  let w = opts.width ?? Math.round(W * 0.5);
  let h = opts.height ?? Math.round(H * 0.5);
  const maxW = W * 0.8;
  const maxH = H * 0.8;
  const s = Math.min(1, maxW / w, maxH / h);
  w = Math.max(1, Math.round(w * s));
  h = Math.max(1, Math.round(h * s));
  const cx = opts.at?.x ?? W / 2;
  const cy = opts.at?.y ?? H / 2;
  const transform = { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), width: w, height: h };
  const name = opts.name?.replace(/\.[a-z0-9]+$/i, '') ?? 'Image';
  if (opts.mime === 'image/svg+xml' || /\.svg($|\?)/i.test(opts.src)) {
    return createLayer('svg', { name, src: opts.src, transform, fit: 'contain' } as any);
  }
  return createLayer('raster', { name, src: opts.src, transform, fit: 'cover' } as any);
}

/** Icon key per layer type for the layers panel. */
export function layerIcon(layer: Layer): string {
  if (layer.type === 'vector') return `shape-${layer.shape.kind}`;
  return layer.type;
}

/** Default display name of a layer. */
export function layerDisplayName(layer: Layer): string {
  if (layer.name) return layer.name;
  if (layer.type === 'text') return (layer.content || 'Text').slice(0, 40);
  if (layer.type === 'vector') return { rect: 'Rectangle', ellipse: 'Ellipse', polygon: 'Polygon', star: 'Star', path: 'Path', line: 'Line' }[layer.shape.kind];
  if (layer.type === 'raster') return (layer.src.startsWith('data:') ? 'Image' : layer.src.split('/').pop()) || 'Image';
  return layer.type.charAt(0).toUpperCase() + layer.type.slice(1);
}
