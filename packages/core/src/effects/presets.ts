/**
 * Colour-grading presets (US-7.1), retro FX (US-7.2) and silhouette/glow helpers (US-7.3).
 * They are plain data (adjustments/effects arrays), so they behave identically in every
 * renderer and serialise into documents.
 */
import type { Adjustment, BlendMode, Effect } from '../udm/schema.js';

export const GRADING_PRESETS = {
  'cinematic-dark': [
    { type: 'contrast', value: 1.18 },
    { type: 'brightness', value: 0.86 },
    { type: 'saturate', value: 0.85 },
    { type: 'temperature', value: -0.25 },
    { type: 'vignette', amount: 0.65, size: 0.45, color: '#000000' },
  ],
  'vibrant-arcade': [
    { type: 'saturate', value: 1.55 },
    { type: 'contrast', value: 1.12 },
    { type: 'brightness', value: 1.05 },
    { type: 'bloom', threshold: 0.72, radius: 8, intensity: 0.6 },
  ],
  'grimdark-retro': [
    { type: 'saturate', value: 0.55 },
    { type: 'contrast', value: 1.3 },
    { type: 'sepia', value: 0.25 },
    { type: 'brightness', value: 0.8 },
    { type: 'noise', amount: 0.12, seed: 7 },
    { type: 'vignette', amount: 0.8, size: 0.35, color: '#0a0503' },
  ],
  'anime-cel': [
    { type: 'saturate', value: 1.35 },
    { type: 'posterize', levels: 6 },
    { type: 'sharpen', amount: 0.4 },
    { type: 'brightness', value: 1.06 },
  ],
  'crt-arcade': [
    { type: 'chromatic-aberration', offset: 1.5 },
    { type: 'scanlines', spacing: 3, thickness: 1, opacity: 0.35, color: '#000000' },
    { type: 'bloom', threshold: 0.65, radius: 6, intensity: 0.5 },
    { type: 'vignette', amount: 0.7, size: 0.5, color: '#000000' },
  ],
  'gameboy': [
    { type: 'pixelate', size: 4 },
    { type: 'palette', preset: 'gameboy' },
  ],
} satisfies Record<string, Adjustment[]>;

export type GradingPreset = keyof typeof GRADING_PRESETS;

export const GRADING_PRESET_LABELS: Record<GradingPreset, string> = {
  'cinematic-dark': 'Cinematic Dark',
  'vibrant-arcade': 'Vibrant Arcade',
  'grimdark-retro': 'Grimdark Retro',
  'anime-cel': 'Anime Cel',
  'crt-arcade': 'CRT Arcade',
  gameboy: 'GameBoy 4-Color',
};

export function gradingPreset(name: GradingPreset | string): Adjustment[] {
  const p = (GRADING_PRESETS as Record<string, Adjustment[]>)[name];
  if (!p) throw new Error(`Unknown grading preset "${name}". Available: ${Object.keys(GRADING_PRESETS).join(', ')}`);
  return structuredClone(p);
}

/** Fluent adjustment builders: `Filters.contrast(1.2)`, `Filters.preset('cinematic-dark')`. */
export const Filters = {
  brightness: (value: number): Adjustment => ({ type: 'brightness', value }),
  contrast: (value: number): Adjustment => ({ type: 'contrast', value }),
  saturate: (value: number): Adjustment => ({ type: 'saturate', value }),
  exposure: (value: number): Adjustment => ({ type: 'exposure', value }),
  gamma: (value: number): Adjustment => ({ type: 'gamma', value }),
  hueRotate: (value: number): Adjustment => ({ type: 'hue-rotate', value }),
  grayscale: (value = 1): Adjustment => ({ type: 'grayscale', value }),
  sepia: (value = 1): Adjustment => ({ type: 'sepia', value }),
  invert: (value = 1): Adjustment => ({ type: 'invert', value }),
  temperature: (value: number): Adjustment => ({ type: 'temperature', value }),
  tint: (color: string, amount = 0.2): Adjustment => ({ type: 'tint', color, amount }),
  blur: (radius: number): Adjustment => ({ type: 'blur', radius }),
  sharpen: (amount = 0.5): Adjustment => ({ type: 'sharpen', amount }),
  vignette: (amount = 0.5, size = 0.6, color = '#000000'): Adjustment => ({ type: 'vignette', amount, size, color }),
  bloom: (threshold = 0.7, radius = 10, intensity = 0.8): Adjustment => ({ type: 'bloom', threshold, radius, intensity }),
  pixelate: (size = 8): Adjustment => ({ type: 'pixelate', size }),
  posterize: (levels = 4): Adjustment => ({ type: 'posterize', levels }),
  palette: (preset: 'gameboy' | 'gameboy-pocket' | 'mono' | 'sepia-4' | 'cga' | 'custom' = 'gameboy', colors?: string[]): Adjustment => ({ type: 'palette', preset, colors }),
  duotone: (shadows: string, highlights: string): Adjustment => ({ type: 'duotone', shadows, highlights }),
  chromaticAberration: (offset = 2): Adjustment => ({ type: 'chromatic-aberration', offset }),
  scanlines: (spacing = 3, opacity = 0.35, thickness = 1, color = '#000000'): Adjustment => ({ type: 'scanlines', spacing, thickness, opacity, color }),
  noise: (amount = 0.15, seed = 1): Adjustment => ({ type: 'noise', amount, seed }),
  preset: gradingPreset,
  /** CRT look: scanlines + RGB split + glow + vignette. */
  crt: (intensity = 1): Adjustment[] => [
    { type: 'chromatic-aberration', offset: 1.5 * intensity },
    { type: 'scanlines', spacing: 3, thickness: 1, opacity: 0.35 * intensity, color: '#000000' },
    { type: 'bloom', threshold: 0.65, radius: 6, intensity: 0.5 * intensity },
    { type: 'vignette', amount: 0.7 * intensity, size: 0.5, color: '#000000' },
  ],
  /** Retro pixel-art: pixelate + palette reduction. */
  retroPixel: (size = 6, palette: 'gameboy' | 'gameboy-pocket' | 'mono' | 'sepia-4' | 'cga' | number = 16): Adjustment[] =>
    typeof palette === 'number'
      ? [{ type: 'pixelate', size }, { type: 'posterize', levels: Math.max(2, Math.round(Math.cbrt(palette))) }]
      : [{ type: 'pixelate', size }, { type: 'palette', preset: palette }],
};

/** Effect builders (layer styles). */
export const Shadow = {
  drop: (o: Partial<{ x: number; y: number; blur: number; spread: number; color: string; opacity: number }> = {}): Effect => ({
    type: 'drop-shadow', x: o.x ?? 0, y: o.y ?? 4, blur: o.blur ?? 8, spread: o.spread ?? 0, color: o.color ?? 'rgba(0,0,0,0.6)', opacity: o.opacity ?? 1,
  }),
  inner: (o: Partial<{ x: number; y: number; blur: number; spread: number; color: string; opacity: number }> = {}): Effect => ({
    type: 'inner-shadow', x: o.x ?? 0, y: o.y ?? 2, blur: o.blur ?? 6, spread: o.spread ?? 0, color: o.color ?? 'rgba(0,0,0,0.6)', opacity: o.opacity ?? 1,
  }),
  /** Alpha-dilated outer glow (US-7.3). */
  glow: (color = '#ffffff', o: Partial<{ radius: number; blur: number; opacity: number; blendMode: BlendMode }> = {}): Effect => ({
    type: 'outer-glow', color, radius: o.radius ?? 4, blur: o.blur ?? 12, opacity: o.opacity ?? 0.9, blendMode: o.blendMode ?? 'normal',
  }),
  rimLight: (color = '#ffffff', o: Partial<{ width: number; blur: number; angle: number; opacity: number; blendMode: BlendMode }> = {}): Effect => ({
    type: 'rim-light', color, width: o.width ?? 3, blur: o.blur ?? 2, angle: o.angle ?? 315, opacity: o.opacity ?? 1, blendMode: o.blendMode ?? 'screen',
  }),
  outline: (color = '#000000', width = 2, opacity = 1): Effect => ({ type: 'outline', color, width, opacity }),
  silhouette: (color = '#000000', opacity = 1): Effect => ({ type: 'silhouette', color, opacity }),
};
