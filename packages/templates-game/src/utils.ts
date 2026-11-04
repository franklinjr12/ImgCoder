/**
 * Small helpers shared by components and templates (no rendering logic of their own — all
 * drawing goes through core primitives).
 */
import { GRADING_PRESETS, Shadow, gradingPreset, mixColors, withAlpha, type Adjustment, type Effect, type Stroke } from '@game-artisan/core';

/**
 * Font stack appended to every display font so CJK titles (ja / ko / zh) render with a real CJK
 * face. Unregistered families are skipped; the core registry also falls back to any system CJK
 * font registered with `fallback: true` (createNodeFontRegistry does that automatically).
 */
export const CJK_FONT_STACK =
  "'Noto Sans CJK JP', 'Noto Sans CJK SC', 'Noto Sans CJK KR', 'Noto Sans JP', 'Noto Sans SC', 'Noto Sans TC', 'Noto Sans KR', 'Source Han Sans', 'Source Han Sans SC', 'WenQuanYi Zen Hei', 'Hiragino Sans', 'PingFang SC', 'Microsoft YaHei', 'Yu Gothic', 'Malgun Gothic', sans-serif";

/** `'Cinzel'` → `'Cinzel', <CJK stack>` (keeps an existing comma list intact). */
export function withCjkFallback(fontFamily: string): string {
  const f = fontFamily.trim();
  const quoted = f.includes(',') || /^['"]/.test(f) ? f : `'${f}'`;
  return `${quoted}, ${CJK_FONT_STACK}`;
}

/** Stroke with every field filled in (TextProps / ShapeProps expect the parsed Stroke shape). */
export function stroke(color: string, width: number, align: Stroke['align'] = 'outside', opacity?: number): Stroke {
  return { color, width, cap: 'round', join: 'round', align, ...(opacity != null ? { opacity } : {}) };
}

export type GradingName = keyof typeof GRADING_PRESETS | 'none';

export const GRADING_NAMES = ['none', ...Object.keys(GRADING_PRESETS)] as [GradingName, ...GradingName[]];

/** Grading preset → adjustments (empty for 'none'). Scales pixel sizes for big canvases. */
export function gradingAdjustments(name: GradingName | undefined, canvasMin = 400): Adjustment[] {
  if (!name || name === 'none') return [];
  const k = Math.max(1, canvasMin / 400);
  return gradingPreset(name).map((a) => {
    if (a.type === 'pixelate') return { ...a, size: Math.max(2, Math.round(a.size * k)) };
    if (a.type === 'bloom') return { ...a, radius: a.radius * k };
    if (a.type === 'scanlines') return { ...a, spacing: Math.max(2, Math.round(a.spacing * k)), thickness: Math.max(1, Math.round(a.thickness * k)) };
    if (a.type === 'chromatic-aberration') return { ...a, offset: a.offset * k };
    return a;
  });
}

/** Character outer glow (US-7.3) scaled to the character's on-canvas size. intensity 0..100. */
export function characterGlow(enabled: boolean, color: string, intensity: number, characterHeight: number): Effect[] {
  if (!enabled || intensity <= 0) return [];
  const t = Math.min(1, Math.max(0, intensity / 100));
  const unit = characterHeight / 100;
  return [
    Shadow.glow(color, { radius: Math.max(0.5, unit * 0.8 * t), blur: Math.max(1, unit * 4 * t + unit), opacity: Math.min(1, 0.35 + t * 0.6), blendMode: 'normal' }),
  ];
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const round = (v: number) => Math.round(v * 100) / 100;

export { mixColors, withAlpha };

/** Darker / lighter shade of a colour (t in 0..1). */
export const shade = (color: string, t: number) => mixColors(color, '#000000', t);
export const tintColor = (color: string, t: number) => mixColors(color, '#ffffff', t);

export type AspectClass = 'tiny' | 'wide' | 'tall' | 'square';

/** Classify a canvas for adaptive layouts. */
export function aspectClass(width: number, height: number): AspectClass {
  const r = width / height;
  if (Math.min(width, height) < 120 || width * height < 30000) return 'tiny';
  if (r >= 1.45) return 'wide';
  if (r < 0.9) return 'tall';
  return 'square';
}
