/**
 * Isomorphic UDM → SVG emitter. Same code runs in the CLI (then rasterised by resvg), in
 * Chromium and in the Studio canvas — this is the backbone of the "zero-flicker parity" goal.
 */
import { svgColor } from '../color.js';
import { multiply, toSvgMatrix, transformToMatrix, isIdentity, type Matrix } from '../math/matrix.js';
import { ellipsePath, fitPathToBox, linePath, parsePath, polygonPath, rectPath, segmentsToD, starPath, transformSegments } from '../vector/path.js';
import type { Artboard, ArtisanDocument, Layer, Shape, Stroke, TextLayer, VectorLayer, Fill, HalftoneLayer, PatternLayer, RasterLayer, SvgLayer, GroupLayer, MaskLayer, BooleanLayer } from '../udm/schema.js';
import { ArtboardSchema, DocumentSchema } from '../udm/schema.js';
import { resolveDocumentVariables } from '../udm/variables.js';
import { FontRegistry } from '../text/fonts.js';
import { layoutText, layoutToPath, alignOffset, verticalOffset, applyTextTransform, type TextLayout } from '../text/layout.js';
import { placeholderAsset, bytesToBase64, type AssetResolver, type ResolvedAsset } from '../assets/resolver.js';
import { buildFilter } from './filters.js';
import { paint, type PaintContext } from './paint.js';
import { el, escapeXml, num, sanitizeSvg } from './xml.js';
import { isContainer } from '../udm/tree.js';

export interface SvgRenderOptions {
  fonts: FontRegistry;
  assets?: AssetResolver;
  /** Output pixel density multiplier (width/height attributes); geometry is unchanged. */
  scale?: number;
  /** outline: text → glyph paths (exact parity, default). text: live <text> + embedded fonts. */
  textMode?: 'outline' | 'text';
  /** Embed @font-face (base64) when textMode = 'text'. Default true. */
  embedFonts?: boolean;
  /** Link fonts instead of embedding: return the URL for a registered face (textMode = 'text'). */
  fontUrl?: (font: { family: string; weight: number; style: string; source?: string; format?: string }) => string | undefined;
  locale?: string;
  /** Render artboard background. Default true. */
  background?: boolean;
  onMissingAsset?: 'error' | 'placeholder';
  /** Prefix for generated ids (use a unique one when several SVGs share a DOM). */
  idPrefix?: string;
  /** Emit data-layer-id attributes (Studio hit-testing). Default true. */
  annotate?: boolean;
  /** Render only these layer ids (and their ancestors/descendants). */
  only?: string[];
  /**
   * Called for layers that should be flattened to a raster image (e.g. filters for PDF export).
   * Receives a standalone SVG of the layer in its local box (+margin) and returns an image href.
   */
  flatten?: { predicate: (layer: Layer) => boolean; rasterize: (svg: string, width: number, height: number) => Promise<string> };
}

export interface SvgRenderResult {
  svg: string;
  width: number;
  height: number;
  warnings: string[];
}

interface Ctx extends PaintContext {
  opts: SvgRenderOptions;
  assets: Map<string, ResolvedAsset>;
  warnings: string[];
  defs: string[];
  fontsUsed: Set<string>;
  prefix: string;
  counter: { n: number };
  flattened: Map<string, string>;
}

function makeCtx(opts: SvgRenderOptions, assets: Map<string, ResolvedAsset>): Ctx {
  const defs: string[] = [];
  const counter = { n: 0 };
  const prefix = opts.idPrefix ?? 'ga';
  return {
    opts,
    assets,
    warnings: [],
    defs,
    fontsUsed: new Set(),
    prefix,
    counter,
    flattened: new Map(),
    addDef: (m) => defs.push(m),
    nextId: (kind) => `${prefix}-${kind}${counter.n++}`,
  };
}

// ---------------------------------------------------------------------------------------
// Asset prefetch

function collectSrcs(layers: Layer[], out: Set<string>): void {
  for (const l of layers) {
    if (l.visible === false) continue;
    if (l.type === 'raster' && l.src) out.add(l.src);
    if (l.type === 'svg' && l.src && !l.markup) out.add(l.src);
    if (l.type === 'mask') collectSrcs([l.mask], out);
    if (isContainer(l)) collectSrcs(l.children, out);
  }
}

async function prefetch(artboard: Artboard, opts: SvgRenderOptions): Promise<{ map: Map<string, ResolvedAsset>; warnings: string[] }> {
  const srcs = new Set<string>();
  collectSrcs(artboard.children, srcs);
  const map = new Map<string, ResolvedAsset>();
  const warnings: string[] = [];
  await Promise.all(
    [...srcs].map(async (src) => {
      try {
        if (!opts.assets) throw new Error('no AssetResolver configured');
        map.set(src, await opts.assets.resolve(src));
      } catch (e) {
        if (opts.onMissingAsset === 'error') throw e;
        warnings.push(`Asset not found: ${src.slice(0, 120)} (${(e as Error).message})`);
        map.set(src, placeholderAsset(src));
      }
    }),
  );
  return { map, warnings };
}

// ---------------------------------------------------------------------------------------
// Geometry helpers

export function shapeToPath(shape: Shape, w: number, h: number): string {
  switch (shape.kind) {
    case 'rect':
      return rectPath(w, h, shape.cornerRadius as any);
    case 'ellipse':
      return ellipsePath(w, h);
    case 'polygon':
      return polygonPath(w, h, shape.sides, shape.rotation);
    case 'star':
      return starPath(w, h, shape.points, shape.innerRatio, shape.rotation);
    case 'path':
      return shape.viewBox ? fitPathToBox(shape.d, w, h, shape.viewBox) : shape.d;
    case 'line':
      return linePath(shape.points, shape.closed);
  }
}

function strokeAttrs(s: Stroke, w: number, h: number, ctx: Ctx, widthOverride?: number): Record<string, string | number | undefined> {
  const fill: Fill = s.fill ?? { type: 'solid', color: s.color ?? '#000000' };
  return {
    ...paint(fill, w, h, ctx, 'stroke'),
    'stroke-width': num(widthOverride ?? s.width),
    'stroke-linecap': s.cap !== 'butt' ? s.cap : undefined,
    'stroke-linejoin': s.join !== 'miter' ? s.join : undefined,
    'stroke-miterlimit': s.miterLimit,
    'stroke-dasharray': s.dash?.length ? s.dash.map(num).join(' ') : undefined,
    'stroke-dashoffset': s.dashOffset,
    'stroke-opacity': s.opacity != null && s.opacity < 1 ? s.opacity : undefined,
  };
}

/** Paint a path with fill + strokes. Outside strokes are drawn behind the fill with doubled width (stacked). */
function paintPath(d: string, fill: Fill | undefined, strokes: Stroke[], w: number, h: number, ctx: Ctx, extra: Record<string, string | undefined> = {}, forceOutside = false): string {
  const out: string[] = [];
  const outside = strokes.filter((s) => forceOutside || s.align === 'outside');
  const center = strokes.filter((s) => !forceOutside && s.align !== 'outside');
  // cumulative widths, inner → outer; draw outermost first
  let acc = 0;
  const stacked = outside.map((s) => {
    acc += s.width;
    return { s, total: acc };
  });
  for (let i = stacked.length - 1; i >= 0; i--) {
    const { s, total } = stacked[i];
    out.push(el('path', { d, ...extra, fill: 'none', ...strokeAttrs({ ...s, join: s.join === 'miter' ? 'round' : s.join }, w, h, ctx, total * 2) }));
  }
  out.push(el('path', { d, ...extra, ...paint(fill, w, h, ctx, 'fill') }));
  for (const s of center) out.push(el('path', { d, ...extra, fill: 'none', ...strokeAttrs(s, w, h, ctx) }));
  return out.join('');
}

// ---------------------------------------------------------------------------------------
// Layer content emitters (local box coordinates)

function emitVector(l: VectorLayer, ctx: Ctx): string {
  const { width: w, height: h } = l.transform;
  const d = shapeToPath(l.shape, w, h);
  const fillRule = l.shape.kind === 'path' && l.shape.fillRule === 'evenodd' ? 'evenodd' : undefined;
  return paintPath(d, l.fill, l.strokes, w, h, ctx, { 'fill-rule': fillRule });
}

function imageRect(fit: RasterLayer['fit'], pos: { x: number; y: number }, w: number, h: number, iw?: number, ih?: number) {
  if (!iw || !ih || fit === 'fill') return { x: 0, y: 0, width: w, height: h, par: fit === 'fill' ? 'none' : fit === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice' };
  let s = 1;
  if (fit === 'cover') s = Math.max(w / iw, h / ih);
  else if (fit === 'contain') s = Math.min(w / iw, h / ih);
  const dw = iw * s;
  const dh = ih * s;
  return { x: (w - dw) * pos.x, y: (h - dh) * pos.y, width: dw, height: dh, par: 'none' };
}

function emitRaster(l: RasterLayer, ctx: Ctx): string {
  const { width: w, height: h } = l.transform;
  const asset = ctx.assets.get(l.src) ?? placeholderAsset(l.src);
  const r = imageRect(l.fit, l.position ?? { x: 0.5, y: 0.5 }, w, h, asset.width, asset.height);
  const needsClip = l.cornerRadius > 0 || r.x < -0.01 || r.y < -0.01 || r.width > w + 0.01 || r.height > h + 0.01;
  let clip: string | undefined;
  if (needsClip) {
    const id = ctx.nextId('c');
    ctx.addDef(el('clipPath', { id }, el('path', { d: rectPath(w, h, l.cornerRadius) })));
    clip = `url(#${id})`;
  }
  const img = el('image', {
    href: asset.href,
    'xlink:href': asset.href,
    x: num(r.x),
    y: num(r.y),
    width: num(r.width),
    height: num(r.height),
    preserveAspectRatio: r.par,
    'image-rendering': l.rendering === 'pixelated' ? 'optimizeSpeed' : l.rendering === 'smooth' ? 'optimizeQuality' : undefined,
    style: l.rendering === 'pixelated' ? 'image-rendering:pixelated' : undefined,
  });
  return clip ? el('g', { 'clip-path': clip }, img) : img;
}

const layoutCache = new Map<string, TextLayout>();

export function layoutTextLayer(l: TextLayer, fonts: FontRegistry, locale?: string): TextLayout {
  const { width: w, height: h } = l.transform;
  const maxWidth = l.sizing === 'auto-width' ? Infinity : w;
  const maxHeight = l.style.fit === 'shrink' && l.sizing === 'fixed' ? h : undefined;
  const key = JSON.stringify([fonts.revision, l.content, l.style.fontFamily, l.style.fontSize, l.style.fontWeight, l.style.fontStyle, l.style.letterSpacing, l.style.lineHeight, l.style.textTransform, l.style.fit, l.style.minFontSize, l.style.maxLines, l.style.wrap, maxWidth, maxHeight, locale]);
  let layout = layoutCache.get(key);
  if (!layout) {
    layout = layoutText(l.content, l.style, fonts, { maxWidth, maxHeight, locale });
    if (layoutCache.size > 2000) layoutCache.clear();
    layoutCache.set(key, layout);
  }
  return layout;
}

function emitText(l: TextLayer, ctx: Ctx): string {
  const { width: w, height: h } = l.transform;
  if (!l.content) return '';
  const layout = layoutTextLayer(l, ctx.opts.fonts, ctx.opts.locale);
  const boxW = l.sizing === 'auto-width' ? layout.width : w;
  if (ctx.opts.textMode === 'text') return emitLiveText(l, layout, boxW, h, ctx);
  const d = layoutToPath(layout, boxW, h, l.style);
  if (!d) return '';
  return paintPath(d, l.style.fill, l.style.strokes, w, h, ctx, {}, true);
}

function emitLiveText(l: TextLayer, layout: TextLayout, w: number, h: number, ctx: Ctx): string {
  const yOff = verticalOffset(layout.height, h, l.style.verticalAlign);
  const runsSvg = (extra: Record<string, string | number | undefined>) =>
    layout.lines
      .map((line) => {
        const xOff = alignOffset(line.width, w, l.style.textAlign);
        return line.runs
          .map((run) => {
            ctx.fontsUsed.add(`${run.font.family}|${run.font.weight}|${run.font.style}`);
            return el(
              'text',
              {
                x: num(xOff + run.x),
                y: num(yOff + run.baseline),
                'font-family': `'${run.font.family}'`,
                'font-size': num(run.fontSize),
                'font-weight': run.font.weight !== 400 ? run.font.weight : undefined,
                'font-style': l.style.fontStyle === 'italic' ? 'italic' : undefined,
                'letter-spacing': l.style.letterSpacing ? num(l.style.letterSpacing) : undefined,
                'xml:space': 'preserve',
                ...extra,
              },
              escapeXml(run.text),
            );
          })
          .join('');
      })
      .join('');
  const parts: string[] = [];
  let acc = 0;
  const stacked = l.style.strokes.map((s) => ({ s, total: (acc += s.width) }));
  for (let i = stacked.length - 1; i >= 0; i--) {
    const { s, total } = stacked[i];
    parts.push(runsSvg({ fill: 'none', ...strokeAttrs({ ...s, join: 'round' }, w, h, ctx, total * 2) }));
  }
  parts.push(runsSvg(paint(l.style.fill, w, h, ctx, 'fill')));
  return parts.join('');
}

function emitSvgLayer(l: SvgLayer, ctx: Ctx): string {
  const { width: w, height: h } = l.transform;
  const markup = l.markup ?? ctx.assets.get(l.src ?? '')?.text;
  if (!markup) {
    ctx.warnings.push(`SVG layer ${l.id} has no markup`);
    return '';
  }
  const sanitized = sanitizeSvg(markup, `${ctx.prefix}-${l.id.replace(/[^a-zA-Z0-9_-]/g, '')}-`);
  const vb = sanitized.viewBox ?? [0, 0, w, h];
  const par = l.fit === 'fill' ? 'none' : l.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet';
  return el('svg', { x: 0, y: 0, width: num(w), height: num(h), viewBox: vb.map(num).join(' '), preserveAspectRatio: par, overflow: l.fit === 'cover' ? 'hidden' : 'visible' }, sanitized.inner);
}

function emitHalftone(l: HalftoneLayer, ctx: Ctx): string {
  const { width: w, height: h } = l.transform;
  const sp = Math.max(1, l.spacing);
  const a = (l.angle * Math.PI) / 180;
  const ga = (l.gradientAngle * Math.PI) / 180;
  const gdx = Math.sin(ga), gdy = -Math.cos(ga);
  const glen = Math.abs(w * gdx) + Math.abs(h * gdy) || 1;
  const diag = Math.hypot(w, h);
  const cos = Math.cos(a), sin = Math.sin(a);
  const cx = w / 2, cy = h / 2;
  const parts: string[] = [];
  const n = Math.ceil(diag / sp / 2) + 1;
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const lx = i * sp, ly = j * sp;
      const x = cx + lx * cos - ly * sin;
      const y = cy + lx * sin + ly * cos;
      if (x < -sp || y < -sp || x > w + sp || y > h + sp) continue;
      let t: number;
      if (l.falloff === 'radial') t = Math.min(1, Math.hypot(x - cx, y - cy) / (diag / 2));
      else t = Math.min(1, Math.max(0, ((x - cx) * gdx + (y - cy) * gdy) / glen + 0.5));
      const size = (l.minSize + (l.maxSize - l.minSize) * t) * sp;
      if (size <= 0.05) continue;
      const r = size / 2;
      switch (l.dot) {
        case 'circle':
          parts.push(`M${num(x - r)} ${num(y)}a${num(r)} ${num(r)} 0 1 0 ${num(2 * r)} 0a${num(r)} ${num(r)} 0 1 0 ${num(-2 * r)} 0Z`);
          break;
        case 'square':
          parts.push(`M${num(x - r)} ${num(y - r)}h${num(size)}v${num(size)}h${num(-size)}Z`);
          break;
        case 'diamond':
          parts.push(`M${num(x)} ${num(y - r)}L${num(x + r)} ${num(y)}L${num(x)} ${num(y + r)}L${num(x - r)} ${num(y)}Z`);
          break;
        case 'line': {
          const lw = r;
          parts.push(`M${num(x - sp / 2 * cos + lw * sin)} ${num(y - sp / 2 * sin - lw * cos)}l${num(sp * cos)} ${num(sp * sin)}l${num(-2 * lw * sin)} ${num(2 * lw * cos)}l${num(-sp * cos)} ${num(-sp * sin)}Z`);
          break;
        }
      }
    }
  }
  const id = ctx.nextId('c');
  ctx.addDef(el('clipPath', { id }, el('rect', { width: num(w), height: num(h) })));
  const c = svgColor(l.color);
  return el('g', { 'clip-path': `url(#${id})` }, el('path', { d: parts.join(''), fill: c.hex, 'fill-opacity': c.opacity < 1 ? c.opacity : undefined }));
}

function emitPattern(l: PatternLayer, ctx: Ctx): string {
  const { width: w, height: h } = l.transform;
  const id = ctx.nextId('p');
  const s = l.spacing;
  const t = l.thickness;
  const c = svgColor(l.color);
  const fill = { fill: c.hex, 'fill-opacity': c.opacity < 1 ? c.opacity : undefined };
  let body = '';
  let pw = s, ph = s;
  switch (l.pattern) {
    case 'scanlines':
      pw = w || 1;
      body = el('rect', { width: num(pw), height: num(t), ...fill });
      break;
    case 'grid':
      body = el('rect', { width: num(s), height: num(t), ...fill }) + el('rect', { width: num(t), height: num(s), ...fill });
      break;
    case 'dots':
      body = el('circle', { cx: num(s / 2), cy: num(s / 2), r: num(t / 2), ...fill });
      break;
    case 'checker':
      pw = ph = s * 2;
      body = el('rect', { width: num(s), height: num(s), ...fill }) + el('rect', { x: num(s), y: num(s), width: num(s), height: num(s), ...fill });
      break;
    case 'diagonal':
      body = el('path', { d: `M0 ${num(s)}L${num(s)} 0`, stroke: c.hex, 'stroke-opacity': c.opacity < 1 ? c.opacity : undefined, 'stroke-width': num(t) });
      break;
  }
  ctx.addDef(el('pattern', { id, width: num(pw), height: num(ph), patternUnits: 'userSpaceOnUse' }, body));
  const bg = l.background ? el('rect', { width: num(w), height: num(h), ...paint({ type: 'solid', color: l.background }, w, h, ctx) }) : '';
  return bg + el('rect', { width: num(w), height: num(h), fill: `url(#${id})` });
}

function emitGroup(l: GroupLayer, ctx: Ctx): string {
  const { width: w, height: h } = l.transform;
  let bg = '';
  if (l.fill || l.strokes.length) {
    const d = rectPath(w, h, l.cornerRadius);
    bg = paintPath(d, l.fill ?? { type: 'none' }, l.strokes, w, h, ctx);
  }
  const kids = emitChildren(l.children, ctx);
  if (l.clipContent) {
    const id = ctx.nextId('c');
    ctx.addDef(el('clipPath', { id }, el('path', { d: rectPath(w, h, l.cornerRadius) })));
    return bg + el('g', { 'clip-path': `url(#${id})` }, kids);
  }
  return bg + kids;
}

function emitMaskLayer(l: MaskLayer, ctx: Ctx): string {
  const id = ctx.nextId('m');
  const maskContent = emitLayer({ ...l.mask, visible: true } as Layer, ctx, true);
  ctx.addDef(`<mask id="${id}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="-100000" y="-100000" width="200000" height="200000" mask-type="${l.mode}" style="mask-type:${l.mode}">${maskContent}</mask>`);
  return el('g', { mask: `url(#${id})` }, emitChildren(l.children, ctx));
}

/** Path of a layer in its parent's coordinate space (vector + text only), for booleans. */
function layerOutline(layer: Layer, ctx: Ctx): string {
  const m = transformToMatrix(layer.transform);
  let d = '';
  if (layer.type === 'vector') d = shapeToPath(layer.shape, layer.transform.width, layer.transform.height);
  else if (layer.type === 'text') {
    const lay = layoutTextLayer(layer, ctx.opts.fonts, ctx.opts.locale);
    d = layoutToPath(lay, layer.sizing === 'auto-width' ? lay.width : layer.transform.width, layer.transform.height, layer.style);
  } else if (layer.type === 'group' || layer.type === 'boolean') {
    d = layer.children.map((c) => layerOutline(c, ctx)).join('');
  }
  if (!d) return '';
  return isIdentity(m) ? d : segmentsToD(transformSegments(parsePath(d), m));
}

function emitBoolean(l: BooleanLayer, ctx: Ctx): string {
  const { width: w, height: h } = l.transform;
  const kids = l.children.filter((c) => c.visible !== false);
  if (!kids.length) return '';
  const paths = kids.map((k) => layerOutline(k, ctx));
  switch (l.operation) {
    case 'union':
      return paintPath(paths.join(''), l.fill, l.strokes, w, h, ctx);
    case 'exclude':
      return paintPath(paths.join(''), l.fill, l.strokes, w, h, ctx, { 'fill-rule': 'evenodd' });
    case 'intersect': {
      let inner = paintPath(paths[0], l.fill, l.strokes, w, h, ctx);
      for (const p of paths.slice(1)) {
        const id = ctx.nextId('c');
        ctx.addDef(el('clipPath', { id }, el('path', { d: p })));
        inner = el('g', { 'clip-path': `url(#${id})` }, inner);
      }
      return inner;
    }
    case 'subtract': {
      const id = ctx.nextId('m');
      const holes = paths.slice(1).map((p) => el('path', { d: p, fill: '#000000' })).join('');
      ctx.addDef(`<mask id="${id}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="-100000" y="-100000" width="200000" height="200000"><rect x="-100000" y="-100000" width="200000" height="200000" fill="#ffffff"/>${holes}</mask>`);
      return el('g', { mask: `url(#${id})` }, paintPath(paths[0], l.fill, l.strokes, w, h, ctx));
    }
  }
}

function emitContent(layer: Layer, ctx: Ctx): string {
  switch (layer.type) {
    case 'vector':
      return emitVector(layer, ctx);
    case 'raster':
      return emitRaster(layer, ctx);
    case 'text':
      return emitText(layer, ctx);
    case 'svg':
      return emitSvgLayer(layer, ctx);
    case 'halftone':
      return emitHalftone(layer, ctx);
    case 'pattern':
      return emitPattern(layer, ctx);
    case 'group':
      return emitGroup(layer, ctx);
    case 'mask':
      return emitMaskLayer(layer, ctx);
    case 'boolean':
      return emitBoolean(layer, ctx);
  }
}

export function layerDomId(ctx: { prefix: string }, id: string): string {
  return `${ctx.prefix}-L-${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

function emitLayer(layer: Layer, ctx: Ctx, inMask = false): string {
  if (layer.visible === false) return '';
  const t = layer.transform;
  const matrix = transformToMatrix(t);
  const flatHref = ctx.flattened.get(layer.id);
  let content: string;
  let filterAttr: string | undefined;
  if (flatHref) {
    const fm = Number(/#m=(\d+(?:\.\d+)?)/.exec(flatHref)?.[1] ?? 0);
    const href = flatHref.replace(/#m=.*$/, '');
    content = el('image', { href, 'xlink:href': href, x: num(-fm), y: num(-fm), width: num(t.width + fm * 2), height: num(t.height + fm * 2), preserveAspectRatio: 'none' });
  } else {
    content = emitContent(layer, ctx);
    const recolor = layer.type === 'svg' ? layer.color : undefined;
    const f = buildFilter(ctx, t.width, t.height, layer.adjustments ?? [], layer.effects ?? [], recolor);
    if (f) filterAttr = `url(#${f.id})`;
  }
  const blend = layer.blendMode && layer.blendMode !== 'normal' ? `mix-blend-mode:${layer.blendMode}` : undefined;
  const annotate = ctx.opts.annotate !== false && !inMask;
  const a: Record<string, string | number | undefined> = {
    id: inMask ? undefined : layerDomId(ctx, layer.id),
    'data-layer-id': annotate ? layer.id : undefined,
    'data-layer-type': annotate ? layer.type : undefined,
    transform: isIdentity(matrix) ? undefined : toSvgMatrix(matrix),
    opacity: layer.opacity < 1 ? num(layer.opacity) : undefined,
    style: blend,
  };
  if (filterAttr) {
    // Filter on an inner group so the transform/opacity/blend apply to the filtered result.
    return el('g', a, el('g', { filter: filterAttr }, content));
  }
  return el('g', a, content);
}

function emitChildren(children: Layer[], ctx: Ctx): string {
  const out: string[] = [];
  let base: Layer | null = null;
  let baseIndex = -1;
  children.forEach((child, i) => {
    if (!child.clippingMask) {
      base = child;
      baseIndex = i;
      out.push(emitLayer(child, ctx));
      return;
    }
    if (!base || baseIndex < 0 || base.visible === false) {
      // Nothing to clip against → hidden (Photoshop behaviour when base is hidden).
      return;
    }
    const id = ctx.nextId('cm');
    ctx.addDef(
      `<mask id="${id}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="-100000" y="-100000" width="200000" height="200000" mask-type="alpha" style="mask-type:alpha">${emitLayer({ ...(base as Layer), opacity: 1, blendMode: 'normal', clippingMask: false } as Layer, ctx, true)}</mask>`,
    );
    out.push(el('g', { mask: `url(#${id})` }, emitLayer(child, ctx)));
  });
  return out.join('');
}

// ---------------------------------------------------------------------------------------
// Flattening (PDF/vector export of non-vector-representable effects)

async function flattenLayers(artboard: Artboard, ctx: Ctx): Promise<void> {
  const f = ctx.opts.flatten;
  if (!f) return;
  const visit = async (layers: Layer[]) => {
    for (const l of layers) {
      if (l.visible === false) continue;
      if (f.predicate(l)) {
        const sub = makeCtx({ ...ctx.opts, flatten: undefined, annotate: false, idPrefix: `${ctx.prefix}x${ctx.counter.n++}` }, ctx.assets);
        const local = { ...l, transform: { ...l.transform, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0, flipX: false, flipY: false }, opacity: 1, blendMode: 'normal' } as Layer;
        const body = emitLayer(local, sub);
        const mg = Math.ceil(Math.max(0, ...sub.defs.map((d) => Number(/<filter[^>]*\sx="-(\d+(?:\.\d+)?)"/.exec(d)?.[1] ?? 0))));
        const W = l.transform.width + mg * 2;
        const H = l.transform.height + mg * 2;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${num(W)}" height="${num(H)}" viewBox="${num(-mg)} ${num(-mg)} ${num(W)} ${num(H)}"><defs>${sub.defs.join('')}</defs>${body}</svg>`;
        const href = await f.rasterize(svg, W, H);
        ctx.flattened.set(l.id, `${href}#m=${mg}`);
        continue;
      }
      if (isContainer(l)) await visit(l.children);
    }
  };
  await visit(artboard.children);
}

// ---------------------------------------------------------------------------------------
// Public API

function fontFaceCss(ctx: Ctx): string {
  if ((ctx.opts.embedFonts === false && !ctx.opts.fontUrl) || !ctx.fontsUsed.size) return '';
  const rules: string[] = [];
  for (const f of ctx.opts.fonts.list()) {
    const key = `${f.family}|${f.weight}|${f.style}`;
    if (!ctx.fontsUsed.has(key)) continue;
    const full = (ctx.opts.fonts as any).fonts?.find((x: any) => x.family === f.family && x.weight === f.weight && x.style === f.style);
    const fmt = full?.format === 'otf' ? 'opentype' : full?.format === 'woff2' ? 'woff2' : full?.format === 'woff' ? 'woff' : 'truetype';
    const linked = ctx.opts.fontUrl?.(f);
    if (linked) {
      rules.push(`@font-face{font-family:'${f.family}';font-weight:${f.weight};font-style:${f.style};src:url('${linked}') format('${fmt}');}`);
      continue;
    }
    if (!full?.data) continue;
    rules.push(`@font-face{font-family:'${f.family}';font-weight:${f.weight};font-style:${f.style};src:url(data:font/${full.format};base64,${bytesToBase64(full.data)}) format('${fmt}');}`);
  }
  return rules.length ? `<style>${rules.join('')}</style>` : '';
}

/** Render a concrete (variable-resolved) artboard to an SVG string. */
export async function renderArtboardToSvg(artboardInput: Artboard, opts: SvgRenderOptions): Promise<SvgRenderResult> {
  const artboard = ArtboardSchema.parse(artboardInput);
  const { map, warnings } = await prefetch(artboard, opts);
  const ctx = makeCtx(opts, map);
  ctx.warnings.push(...warnings);
  await flattenLayers(artboard, ctx);
  const W = artboard.width;
  const H = artboard.height;
  const scale = opts.scale ?? 1;
  let bg = '';
  if (opts.background !== false && artboard.background && artboard.background.type !== 'none') {
    bg = el('rect', { 'data-artboard-bg': 'true', width: W, height: H, ...paint(artboard.background, W, H, ctx) });
  }
  const body = emitChildren(artboard.children, ctx);
  const style = fontFaceCss(ctx);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${num(W * scale)}" height="${num(H * scale)}" viewBox="0 0 ${W} ${H}" data-artboard-id="${escapeXml(artboard.id)}">` +
    (ctx.defs.length || style ? `<defs>${style}${ctx.defs.join('')}</defs>` : '') +
    bg +
    body +
    `</svg>`;
  return { svg, width: W * scale, height: H * scale, warnings: ctx.warnings };
}

/** Resolve a document's variables with props and render one artboard (default: first). */
export async function renderDocumentToSvg(
  doc: ArtisanDocument,
  opts: SvgRenderOptions & { props?: Record<string, unknown>; artboardId?: string },
): Promise<SvgRenderResult> {
  const resolved = DocumentSchema.parse(resolveDocumentVariables(doc, opts.props ?? {}));
  const artboard = opts.artboardId ? resolved.artboards.find((a) => a.id === opts.artboardId) : resolved.artboards[0];
  if (!artboard) throw new Error(`Artboard "${opts.artboardId}" not found in document ${doc.id}`);
  return renderArtboardToSvg(artboard, opts);
}

export { applyTextTransform };
export type { Matrix };
export const _internal = { multiply };
