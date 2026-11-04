import path from 'node:path';
import type { OutputFormat } from '@game-artisan/renderer-svg/node';
import type { ArtisanProject } from './project.js';
import { renderToFile, type RenderResult } from './render.js';

export interface BatchLocalizeRequest {
  compositionId: string;
  locales: string[];
  /** Per-locale props, e.g. { en: { titleLogo, callout }, ja: {...} } */
  localizationData?: Record<string, Record<string, unknown>>;
  /** Props shared by every locale. */
  baseProps?: Record<string, unknown>;
  outputDir: string;
  format?: OutputFormat;
  scale?: number;
  /** File name pattern; tokens {locale} {composition} {ext}. */
  fileName?: string;
}

export interface BatchLocalizeResult {
  status: 'success' | 'partial' | 'error';
  outputDir: string;
  results: (Omit<RenderResult, 'buffer'> & { locale: string } | { locale: string; status: 'error'; error: string })[];
}

/**
 * Render one composition for many locales (MCP `artisan_batch_localize`). Locales without
 * explicit data fall back to the composition's own `localeMap` handling via `--locale`.
 */
export async function batchLocalize(project: ArtisanProject, req: BatchLocalizeRequest): Promise<BatchLocalizeResult> {
  const outDir = path.resolve(project.root, req.outputDir);
  const results: BatchLocalizeResult['results'] = [];
  for (const locale of req.locales) {
    const fmt = req.format ?? 'png';
    const ext = fmt === 'jpeg' ? 'jpg' : fmt;
    const name = (req.fileName ?? '{composition}.{locale}.{ext}').replace('{locale}', locale).replace('{composition}', req.compositionId).replace('{ext}', ext);
    try {
      const r = await renderToFile(project, {
        compositionId: req.compositionId,
        props: { ...(req.baseProps ?? {}), ...(req.localizationData?.[locale] ?? {}) },
        locale,
        format: fmt,
        scale: req.scale,
        outputPath: path.join(outDir, name),
      });
      const { buffer, ...rest } = r;
      results.push({ ...rest, locale });
    } catch (e) {
      results.push({ locale, status: 'error', error: (e as Error).message });
    }
  }
  const errors = results.filter((r) => r.status === 'error').length;
  return { status: errors === 0 ? 'success' : errors === results.length ? 'error' : 'partial', outputDir: outDir, results };
}
