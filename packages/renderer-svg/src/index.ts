/**
 * @game-artisan/renderer-svg (isomorphic entry). Browser-safe: UDM → SVG emission plus helpers
 * used by the Studio. Node-only rasterisation/encoding lives in `@game-artisan/renderer-svg/node`.
 */
export { renderArtboardToSvg, renderDocumentToSvg, type SvgRenderOptions, type SvgRenderResult } from '@game-artisan/core';
import { compileComposition, renderArtboardToSvg, type CompositionDefinition, type FontRegistry, type AssetResolver, type LayerOverrides, type Artboard } from '@game-artisan/core';

export function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export interface CompositionSvgOptions {
  fonts: FontRegistry;
  assets?: AssetResolver;
  props?: Record<string, unknown>;
  overrides?: LayerOverrides;
  locale?: string;
  scale?: number;
  textMode?: 'outline' | 'text';
  idPrefix?: string;
  annotate?: boolean;
  background?: boolean;
  surface?: string;
}

/** Compile + emit in one call (used by Studio, CLI and agents alike). */
export async function renderCompositionToSvg(def: CompositionDefinition, opts: CompositionSvgOptions): Promise<{ svg: string; artboard: Artboard; props: Record<string, unknown>; warnings: string[]; width: number; height: number }> {
  const { artboard, props } = await compileComposition(def, { fonts: opts.fonts, assets: opts.assets, props: opts.props, overrides: opts.overrides, locale: opts.locale, surface: opts.surface });
  const r = await renderArtboardToSvg(artboard, { fonts: opts.fonts, assets: opts.assets, scale: opts.scale, textMode: opts.textMode, locale: opts.locale ?? artboard.locale, idPrefix: opts.idPrefix, annotate: opts.annotate, background: opts.background });
  return { svg: r.svg, artboard, props, warnings: r.warnings, width: r.width, height: r.height };
}
