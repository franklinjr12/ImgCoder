/**
 * @game-artisan/renderer-svg/node — headless pipeline:
 *   UDM/JSX → SVG (core emitter) → resvg (Rust) PNG → sharp WebP/JPEG/AVIF, plus vector PDF.
 */
import { Resvg, renderAsync } from '@resvg/resvg-js';
import sharp from 'sharp';
import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import {
  compileComposition,
  renderArtboardToSvg,
  isContainer,
  toDataUri,
  type Artboard,
  type AssetResolver,
  type CompositionDefinition,
  type FontRegistry,
  type Layer,
  type LayerOverrides,
} from '@game-artisan/core';

export * from './node-assets.js';
export * from './node-fonts.js';

export type OutputFormat = 'png' | 'jpeg' | 'webp' | 'avif' | 'svg' | 'pdf';

export const FORMAT_MIME: Record<OutputFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
};

export function formatFromPath(file: string): OutputFormat | undefined {
  const ext = /\.([a-z0-9]+)$/i.exec(file)?.[1]?.toLowerCase();
  if (!ext) return undefined;
  if (ext === 'jpg') return 'jpeg';
  return (['png', 'jpeg', 'webp', 'avif', 'svg', 'pdf'] as const).find((f) => f === ext);
}

export interface EncodeOptions {
  /** 1-100 for lossy formats. Default 90 (jpeg/webp), 60 (avif). */
  quality?: number;
  /** WebP/AVIF lossless. */
  lossless?: boolean;
  /** CPU effort (webp 0-6, avif 0-9). */
  effort?: number;
  /** Flatten transparency onto this colour (always applied for JPEG; default #000000). */
  background?: string;
  /** Re-encode with decreasing quality until the file fits (store size limits). */
  maxFileSizeBytes?: number;
  /** PNG palette quantisation (smaller files for flat art). */
  palette?: boolean;
  /** Embed sRGB ICC + metadata. */
  withMetadata?: boolean;
}

export interface RasterOptions {
  /** Font buffers for SVGs containing live <text> (outline-mode SVGs need none). */
  fontBuffers?: Uint8Array[];
  /** Render in the libuv thread pool (non-blocking). Default true. */
  async?: boolean;
  /** Fit output to this width (px), keeping aspect ratio. */
  fitWidth?: number;
}

function resvgOptions(opts: RasterOptions): any {
  return { font: { loadSystemFonts: false, fontBuffers: opts.fontBuffers?.map((b) => Buffer.from(b)) ?? [] }, shapeRendering: 2, textRendering: 1, imageRendering: 0 };
}

/** Rasterise an SVG string to PNG with resvg (no system font/dependency lookups). */
export async function rasterizeSvg(svg: string, opts: RasterOptions = {}): Promise<{ png: Buffer; width: number; height: number }> {
  const options: any = {
    font: { loadSystemFonts: false, fontBuffers: opts.fontBuffers?.map((b) => Buffer.from(b)) ?? [] },
    shapeRendering: 2,
    textRendering: 1,
    imageRendering: 0,
    ...(opts.fitWidth ? { fitTo: { mode: 'width', value: opts.fitWidth } } : {}),
  };
  if (opts.async === false) {
    const r = new Resvg(svg, options).render();
    return { png: r.asPng(), width: r.width, height: r.height };
  }
  const r = await renderAsync(svg, options);
  return { png: r.asPng(), width: r.width, height: r.height };
}

/** Encode a PNG buffer to the requested raster format via sharp. */
export async function encodeRaster(png: Buffer, format: Exclude<OutputFormat, 'svg' | 'pdf'>, opts: EncodeOptions = {}): Promise<Buffer> {
  const run = async (quality?: number) => {
    let img = sharp(png, { limitInputPixels: false });
    if (opts.withMetadata) img = img.withMetadata();
    switch (format) {
      case 'png':
        return opts.background ? img.flatten({ background: opts.background }).png({ compressionLevel: 9, palette: opts.palette }).toBuffer() : opts.palette ? img.png({ compressionLevel: 9, palette: true, quality: quality ?? 90 }).toBuffer() : quality === undefined ? png : img.png({ compressionLevel: 9 }).toBuffer();
      case 'jpeg':
        return img.flatten({ background: opts.background ?? '#000000' }).jpeg({ quality: quality ?? 90, mozjpeg: true, chromaSubsampling: (quality ?? 90) >= 90 ? '4:4:4' : '4:2:0' }).toBuffer();
      case 'webp':
        return (opts.background ? img.flatten({ background: opts.background }) : img).webp({ quality: quality ?? 90, lossless: !!opts.lossless, effort: opts.effort ?? 4, smartSubsample: true }).toBuffer();
      case 'avif':
        return (opts.background ? img.flatten({ background: opts.background }) : img).avif({ quality: quality ?? 60, lossless: !!opts.lossless, effort: opts.effort ?? 4 }).toBuffer();
    }
  };
  let q = opts.quality;
  let out = await run(q);
  if (opts.maxFileSizeBytes && out.length > opts.maxFileSizeBytes) {
    if (format === 'png') {
      out = await sharp(png).png({ compressionLevel: 9, palette: true, quality: 90 }).toBuffer();
    } else {
      q = q ?? 90;
      while (out.length > opts.maxFileSizeBytes && q > 30) {
        q -= 8;
        out = await run(q);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// PDF

function isPdfSafeImage(src: string): boolean {
  return /^data:image\/(png|jpe?g)[;,]/i.test(src) || /\.(png|jpe?g)(\?.*)?$/i.test(src);
}

function containsClipping(children: Layer[]): boolean {
  return children.some((c) => c.clippingMask);
}

/** Layers whose look cannot be expressed in PDF vector primitives get flattened to images. */
export function needsPdfRaster(l: Layer): boolean {
  if (l.adjustments?.length || l.effects?.length) return true;
  if (l.blendMode && l.blendMode !== 'normal') return true;
  if (l.type === 'mask' && l.mode === 'alpha') return true;
  if (l.type === 'raster' && !isPdfSafeImage(l.src)) return true;
  if (l.type === 'svg' && l.color) return true;
  if (isContainer(l) && containsClipping(l.children)) return true;
  return false;
}

/** Wrap clipping-mask runs at artboard root into synthetic groups so they can be flattened together. */
function groupRootClippingRuns(artboard: Artboard): Artboard {
  if (!containsClipping(artboard.children)) return artboard;
  const out: Layer[] = [];
  for (let i = 0; i < artboard.children.length; i++) {
    const l = artboard.children[i];
    const next = artboard.children[i + 1];
    if (!l.clippingMask && next?.clippingMask) {
      const run: Layer[] = [l];
      while (artboard.children[i + 1]?.clippingMask) run.push(artboard.children[++i]);
      out.push({
        id: `${l.id}__clipgroup`,
        type: 'group',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        transform: { x: 0, y: 0, width: artboard.width, height: artboard.height, rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0, originX: 0.5, originY: 0.5 },
        effects: [],
        adjustments: [],
        clippingMask: false,
        strokes: [],
        cornerRadius: 0,
        clipContent: false,
        children: run,
      } as Layer);
    } else out.push(l);
  }
  return { ...artboard, children: out };
}

export interface PdfOptions {
  fonts: FontRegistry;
  assets?: AssetResolver;
  /** Resolution multiplier used for flattened (filtered/blended) layers. Default 3. */
  rasterScale?: number;
  title?: string;
  author?: string;
  /** Page units per px. 1 = 1px→1pt (design-tool convention). */
  unit?: number;
  locale?: string;
}

/** Vector PDF export: shapes/text/gradients stay vector; filter-based layers are flattened at high DPI. */
export async function artboardToPdf(artboardIn: Artboard, opts: PdfOptions): Promise<Buffer> {
  const artboard = groupRootClippingRuns(artboardIn);
  const scale = opts.rasterScale ?? 3;
  const { svg } = await renderArtboardToSvg(artboard, {
    fonts: opts.fonts,
    assets: opts.assets,
    annotate: false,
    locale: opts.locale,
    flatten: {
      predicate: needsPdfRaster,
      rasterize: async (layerSvg, w, h) => {
        const r = await rasterizeSvg(layerSvg, { fitWidth: Math.max(1, Math.round(w * scale)) });
        return toDataUri(r.png, 'image/png');
      },
    },
  });
  const unit = opts.unit ?? 1;
  const W = artboard.width * unit;
  const H = artboard.height * unit;
  const doc = new PDFDocument({ size: [W, H], margin: 0, autoFirstPage: true, info: { Title: opts.title ?? artboard.name ?? artboard.id, Author: opts.author ?? 'GameArtisan', Creator: 'GameArtisan' } as any });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  SVGtoPDF(doc, svg, 0, 0, { width: W, height: H, preserveAspectRatio: 'none', assumePt: true });
  doc.end();
  return done;
}

// ---------------------------------------------------------------------------------------
// High-level render

export interface RenderArtboardOptions {
  fonts: FontRegistry;
  assets?: AssetResolver;
  format?: OutputFormat;
  scale?: number;
  locale?: string;
  encode?: EncodeOptions;
  /** SVG export text handling: outline (paths, default), embedded (@font-face base64), linked (font URLs). */
  svgText?: 'outline' | 'embedded' | 'linked';
  fontUrl?: (font: { family: string; weight: number; style: string; source?: string }) => string | undefined;
  /** Omit the artboard background (transparent PNG/WebP). */
  transparent?: boolean;
  onMissingAsset?: 'error' | 'placeholder';
}

export interface RenderOutput {
  buffer: Buffer;
  format: OutputFormat;
  mime: string;
  width: number;
  height: number;
  svg?: string;
  warnings: string[];
  timings: { emitMs: number; rasterMs: number; encodeMs: number; totalMs: number };
}

export async function renderArtboard(artboard: Artboard, opts: RenderArtboardOptions): Promise<RenderOutput> {
  const t0 = performance.now();
  const format = opts.format ?? 'png';
  const scale = opts.scale ?? 1;
  if (format === 'pdf') {
    const buffer = await artboardToPdf(artboard, { fonts: opts.fonts, assets: opts.assets, locale: opts.locale, rasterScale: Math.max(2, scale * 2) });
    const t = performance.now() - t0;
    return { buffer, format, mime: FORMAT_MIME.pdf, width: artboard.width, height: artboard.height, warnings: [], timings: { emitMs: t, rasterMs: 0, encodeMs: 0, totalMs: t } };
  }
  const textMode = format === 'svg' && opts.svgText && opts.svgText !== 'outline' ? 'text' : 'outline';
  const { svg, warnings, width, height } = await renderArtboardToSvg(artboard, {
    fonts: opts.fonts,
    assets: opts.assets,
    scale,
    locale: opts.locale ?? artboard.locale,
    textMode,
    embedFonts: opts.svgText !== 'linked',
    fontUrl: opts.svgText === 'linked' ? opts.fontUrl : undefined,
    background: !opts.transparent,
    annotate: format !== 'svg',
    onMissingAsset: opts.onMissingAsset,
  });
  const t1 = performance.now();
  if (format === 'svg') {
    return { buffer: Buffer.from(svg, 'utf8'), format, mime: FORMAT_MIME.svg, width, height, svg, warnings, timings: { emitMs: t1 - t0, rasterMs: 0, encodeMs: 0, totalMs: t1 - t0 } };
  }
  const raster = await rasterizeSvg(svg);
  const t2 = performance.now();
  const needsEncode = format !== 'png' || opts.encode?.palette || opts.encode?.background || opts.encode?.maxFileSizeBytes || opts.encode?.withMetadata;
  const buffer = needsEncode ? await encodeRaster(raster.png, format as any, opts.encode) : raster.png;
  const t3 = performance.now();
  return { buffer, format, mime: FORMAT_MIME[format], width: raster.width, height: raster.height, svg, warnings, timings: { emitMs: t1 - t0, rasterMs: t2 - t1, encodeMs: t3 - t2, totalMs: t3 - t0 } };
}

export interface RenderCompositionOptions extends RenderArtboardOptions {
  props?: Record<string, unknown>;
  overrides?: LayerOverrides;
}

/** Compile a composition with props and render it to the requested format. */
export async function renderComposition(def: CompositionDefinition, opts: RenderCompositionOptions): Promise<RenderOutput & { props: Record<string, unknown>; artboard: Artboard }> {
  const t0 = performance.now();
  const { artboard, props } = await compileComposition(def, { fonts: opts.fonts, assets: opts.assets, props: opts.props, overrides: opts.overrides, locale: opts.locale, surface: 'cli' });
  const compileMs = performance.now() - t0;
  const out = await renderArtboard(artboard, { ...opts, transparent: opts.transparent ?? (!artboard.background || artboard.background.type === 'none') });
  return { ...out, props, artboard, timings: { ...out.timings, totalMs: out.timings.totalMs + compileMs, compileMs } as any };
}

// ---------------------------------------------------------------------------------------
// Image comparison (CLI ↔ Studio parity, regression tests)

async function rawRGBA(input: Buffer, w?: number, h?: number) {
  let img = sharp(input).ensureAlpha();
  if (w && h) img = img.resize(w, h, { fit: 'fill' });
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

async function phash(input: Buffer): Promise<bigint> {
  const N = 32;
  const { data } = await sharp(input).flatten({ background: '#808080' }).greyscale().resize(N, N, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  const px = Array.from(data as Uint8Array);
  const dct: number[] = [];
  for (let u = 0; u < 8; u++)
    for (let v = 0; v < 8; v++) {
      let s = 0;
      for (let x = 0; x < N; x++)
        for (let y = 0; y < N; y++) s += px[y * N + x] * Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N)) * Math.cos(((2 * y + 1) * v * Math.PI) / (2 * N));
      dct.push(s);
    }
  const ac = dct.slice(1);
  const median = [...ac].sort((a, b) => a - b)[Math.floor(ac.length / 2)];
  let bits = 0n;
  dct.forEach((d, i) => {
    if (d > median) bits |= 1n << BigInt(i);
  });
  return bits;
}

export interface CompareResult {
  /** 1 - mean absolute channel difference (0..1) */
  pixelSimilarity: number;
  /** Fraction of pixels whose max channel delta exceeds `threshold` */
  mismatchRatio: number;
  /** Perceptual hash similarity (1 - hamming/64) */
  phashSimilarity: number;
  width: number;
  height: number;
}

export async function compareImages(a: Buffer, b: Buffer, threshold = 24): Promise<CompareResult> {
  const A = await rawRGBA(a);
  const B = await rawRGBA(b, A.width, A.height);
  let sum = 0;
  let mismatched = 0;
  const n = A.width * A.height;
  for (let i = 0; i < n; i++) {
    let maxd = 0;
    for (let c = 0; c < 4; c++) {
      const d = Math.abs(A.data[i * 4 + c] - B.data[i * 4 + c]);
      sum += d;
      if (d > maxd) maxd = d;
    }
    if (maxd > threshold) mismatched++;
  }
  const [ha, hb] = await Promise.all([phash(a), phash(b)]);
  let x = ha ^ hb;
  let dist = 0;
  while (x) {
    dist += Number(x & 1n);
    x >>= 1n;
  }
  return { pixelSimilarity: 1 - sum / (n * 4 * 255), mismatchRatio: mismatched / n, phashSimilarity: 1 - dist / 64, width: A.width, height: A.height };
}

/** Build a labelled grid image (contact sheet) from rendered images. */
export async function contactSheet(
  items: { image: Buffer; label?: string }[],
  opts: { columns?: number; cellWidth?: number; gap?: number; background?: string; fonts?: FontRegistry; title?: string } = {},
): Promise<Buffer> {
  const cols = opts.columns ?? Math.ceil(Math.sqrt(items.length));
  const cellW = opts.cellWidth ?? 480;
  const gap = opts.gap ?? 24;
  const metas = await Promise.all(items.map((i) => sharp(i.image).metadata()));
  const cellH = Math.round(Math.max(...metas.map((m) => (cellW * (m.height ?? 1)) / (m.width ?? 1))));
  const labelH = 28;
  const titleH = opts.title ? 56 : 0;
  const rows = Math.ceil(items.length / cols);
  const W = cols * cellW + (cols + 1) * gap;
  const H = titleH + rows * (cellH + labelH) + (rows + 1) * gap;
  const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
  const composites: sharp.OverlayOptions[] = [];
  const labels: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const x = gap + c * (cellW + gap);
    const y = titleH + gap + r * (cellH + labelH + gap);
    const resized = await sharp(items[i].image).resize(cellW, cellH, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    composites.push({ input: resized, left: x, top: y });
    if (items[i].label) labels.push(`<text x="${x}" y="${y + cellH + 20}" font-family="Inter, sans-serif" font-size="15" fill="#e8e8f0">${esc(items[i].label!)}</text>`);
  }
  let overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${opts.title ? `<text x="${gap}" y="38" font-family="Inter, sans-serif" font-size="26" font-weight="700" fill="#ffffff">${esc(opts.title)}</text>` : ''}${labels.join('')}</svg>`;
  // Outline the label text with our own font engine when available so no system fonts are needed.
  if (opts.fonts) {
    const { layoutText, layoutToPath, TextStyleSchema } = await import('@game-artisan/core');
    const parts: string[] = [];
    const draw = (text: string, x: number, y: number, size: number, weight: number) => {
      const style = TextStyleSchema.parse({ fontFamily: 'Inter', fontSize: size, fontWeight: weight, wrap: false });
      const lay = layoutText(text, style, opts.fonts!);
      parts.push(`<path transform="translate(${x} ${y - size})" d="${layoutToPath(lay, lay.width, lay.height, style)}" fill="${weight > 500 ? '#ffffff' : '#e8e8f0'}"/>`);
    };
    if (opts.title) draw(opts.title, gap, 38, 26, 700);
    for (let i = 0; i < items.length; i++) {
      if (!items[i].label) continue;
      const r = Math.floor(i / cols);
      const c = i % cols;
      draw(items[i].label!, gap + c * (cellW + gap), titleH + gap + r * (cellH + labelH + gap) + cellH + 20, 15, 400);
    }
    overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${parts.join('')}</svg>`;
  }
  const textLayer = (await rasterizeSvg(overlay)).png;
  return sharp({ create: { width: W, height: H, channels: 4, background: opts.background ?? '#14141c' } })
    .composite([...composites, { input: textLayer, left: 0, top: 0 }])
    .png()
    .toBuffer();
}
