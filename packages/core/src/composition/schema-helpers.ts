/**
 * Zod helpers carrying Studio widget hints into JSON Schema (`x-artisan-widget`), so the
 * Props Inspector (and agents) know a string is a colour, an image, a font, etc.
 */
import { z } from 'zod';

export type ArtisanWidget = 'color' | 'image' | 'font' | 'textarea' | 'locale-map' | 'slider' | 'svg';

export const zColor = (defaultValue?: string) => {
  const s = z.string().meta({ 'x-artisan-widget': 'color', format: 'color', description: 'CSS colour (#hex, rgb(), hsl(), named)' });
  return defaultValue !== undefined ? s.default(defaultValue) : s;
};

export const zImage = (defaultValue?: string) => {
  const s = z.string().meta({ 'x-artisan-widget': 'image', format: 'uri-reference', description: 'Image path, URL or data URI' });
  return defaultValue !== undefined ? s.default(defaultValue) : s;
};

export const zSvg = (defaultValue?: string) => {
  const s = z.string().meta({ 'x-artisan-widget': 'svg', description: 'SVG file path, URL or data URI' });
  return defaultValue !== undefined ? s.default(defaultValue) : s;
};

export const zFont = (defaultValue?: string) => {
  const s = z.string().meta({ 'x-artisan-widget': 'font', description: 'Font family name' });
  return defaultValue !== undefined ? s.default(defaultValue) : s;
};

export const zLongText = (defaultValue?: string) => {
  const s = z.string().meta({ 'x-artisan-widget': 'textarea' });
  return defaultValue !== undefined ? s.default(defaultValue) : s;
};

/** Number rendered as a slider in the Studio. */
export const zSlider = (min: number, max: number, defaultValue?: number, step = 1) => {
  const s = z.number().min(min).max(max).meta({ 'x-artisan-widget': 'slider', 'x-artisan-step': step });
  return defaultValue !== undefined ? s.default(defaultValue) : s;
};

/** Locale-keyed map, e.g. `{ en: {...}, ja: {...} }`. */
export const zLocaleMap = <T extends z.ZodType>(value: T) => z.record(z.string(), value).meta({ 'x-artisan-widget': 'locale-map' });
