import { mkdir, writeFile, stat, copyFile } from 'node:fs/promises';
import path from 'node:path';
import type { CompositionDefinition, LayerOverrides } from '@game-artisan/core';
import { renderComposition as renderSvgComposition, formatFromPath, type EncodeOptions, type OutputFormat } from '@game-artisan/renderer-svg/node';
import type { ArtisanProject } from './project.js';
import type { RendererChoice } from './config.js';

export interface RenderRequest {
  compositionId: string;
  props?: Record<string, unknown>;
  overrides?: LayerOverrides;
  format?: OutputFormat;
  scale?: number;
  locale?: string;
  renderer?: RendererChoice;
  /** Output file. When omitted the buffer is returned without writing. */
  outputPath?: string;
  quality?: number;
  lossless?: boolean;
  transparent?: boolean;
  /** For SVG output: outline | embedded | linked */
  svgText?: 'outline' | 'embedded' | 'linked';
  maxFileSizeBytes?: number;
}

export interface RenderResult {
  status: 'success';
  compositionId: string;
  outputPath?: string;
  format: OutputFormat;
  mime: string;
  dimensions: { width: number; height: number };
  fileSizeBytes: number;
  renderDurationMs: number;
  renderer: 'svg' | 'chromium';
  warnings: string[];
  buffer: Buffer;
  timings?: Record<string, number>;
}

let chromiumPool: Promise<any> | null = null;

/** Shared, lazily-launched Chromium renderer (pre-warmed pool) for html compositions / --renderer=chromium. */
export async function getChromiumRenderer(project?: ArtisanProject): Promise<any> {
  if (!chromiumPool) {
    chromiumPool = (async () => {
      const spec = '@game-artisan/renderer-chromium';
      const mod: any = await import(/* @vite-ignore */ spec);
      const Cls = mod.ChromiumRenderer;
      return Cls.launch({ poolSize: project?.config.chromium?.poolSize, executablePath: project?.config.chromium?.executablePath });
    })();
    chromiumPool.catch(() => (chromiumPool = null));
  }
  return chromiumPool;
}

export async function closeChromiumRenderer(): Promise<void> {
  if (!chromiumPool) return;
  const r = await chromiumPool.catch(() => null);
  chromiumPool = null;
  await r?.close?.();
}

function chooseRenderer(def: CompositionDefinition, choice: RendererChoice | undefined): 'svg' | 'chromium' {
  if (def.kind === 'html') return 'chromium';
  if (choice === 'chromium') return 'chromium';
  return 'svg';
}

/** Render one composition (validated props) and optionally write it to disk. */
export async function renderToFile(project: ArtisanProject, req: RenderRequest): Promise<RenderResult> {
  const t0 = performance.now();
  const def = project.get(req.compositionId);
  const fonts = await project.fonts();
  const format: OutputFormat = req.format ?? (req.outputPath ? formatFromPath(req.outputPath) : undefined) ?? (project.config.defaultFormat as OutputFormat) ?? (def.defaultFormat as OutputFormat) ?? 'png';
  const scale = req.scale ?? project.config.scale ?? 1;
  const encode: EncodeOptions = {
    quality: req.quality ?? project.config.quality,
    lossless: req.lossless,
    maxFileSizeBytes: req.maxFileSizeBytes ?? def.maxFileSizeBytes,
  };
  const renderer = chooseRenderer(def, req.renderer ?? project.config.renderer);
  let out: { buffer: Buffer; format: OutputFormat; mime: string; width: number; height: number; warnings?: string[]; timings?: any };
  if (renderer === 'chromium') {
    const r = await getChromiumRenderer(project);
    out = await r.renderComposition(def, { fonts, assets: project.assets, props: req.props, overrides: req.overrides, locale: req.locale, scale, format, transparent: req.transparent });
  } else {
    out = await renderSvgComposition(def, {
      fonts,
      assets: project.assets,
      props: req.props,
      overrides: req.overrides,
      locale: req.locale ?? project.config.defaultLocale,
      format,
      scale,
      encode,
      transparent: req.transparent,
      svgText: req.svgText,
      fontUrl: req.svgText === 'linked' ? (f) => (f.source ? `fonts/${path.basename(f.source)}` : undefined) : undefined,
    });
  }
  let outputPath: string | undefined;
  if (req.outputPath) {
    outputPath = path.resolve(project.root, req.outputPath);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, out.buffer);
    if (format === 'svg' && req.svgText === 'linked') {
      // Copy referenced font files next to the SVG.
      const fontDir = path.join(path.dirname(outputPath), 'fonts');
      await mkdir(fontDir, { recursive: true });
      for (const f of fonts.list()) if (f.source && path.isAbsolute(f.source) && out.buffer.includes(path.basename(f.source))) await copyFile(f.source, path.join(fontDir, path.basename(f.source)));
      const { BUNDLED_FONTS } = await import('@game-artisan/fonts');
      const { fileURLToPath } = await import('node:url');
      for (const b of BUNDLED_FONTS) if (out.buffer.includes(b.file)) await copyFile(fileURLToPath(b.url), path.join(fontDir, b.file));
    }
  }
  const size = outputPath ? (await stat(outputPath)).size : out.buffer.length;
  return {
    status: 'success',
    compositionId: def.id,
    outputPath,
    format,
    mime: out.mime,
    dimensions: { width: out.width, height: out.height },
    fileSizeBytes: size,
    renderDurationMs: Math.round(performance.now() - t0),
    renderer,
    warnings: out.warnings ?? [],
    buffer: out.buffer,
    timings: out.timings,
  };
}

/** Expand an output pattern: {variant} {locale} {composition} {scale} {format} {ext} {width} {height} */
export function expandPattern(pattern: string, vars: Record<string, string | number | undefined>): string {
  return pattern.replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined || vars[k] === '' ? '' : String(vars[k]))).replace(/\/{2,}/g, '/').replace(/^\//, '');
}
