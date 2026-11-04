import { Layer, Text, detectScript, getLocale, resolveLocale, type ArtisanStyle, type Effect, type Stroke } from '@game-artisan/core';
import { resolveArt } from '../art.js';
import { withCjkFallback } from '../utils.js';

/** One locale's title: a logo image (preferred when present) and/or a text title. */
export interface TitleLocaleEntry {
  /** Logo image (path, URL, data URI or `builtin:<name>`). Used instead of text when present. */
  logo?: string;
  /** Title text (rendered with a CJK-capable font stack and shrink-to-fit). */
  text?: string;
  /** Optional localized tagline. */
  tagline?: string;
  /** Optional localized kicker / genre line. */
  kicker?: string;
}

export type TitleLocaleMap = Record<string, TitleLocaleEntry>;

export interface ResolvedTitle {
  text: string;
  logo?: string;
  tagline?: string;
  kicker?: string;
  /** True when the text contains CJK characters (tracking/transform are disabled for it). */
  cjk: boolean;
}

/**
 * Resolve the title for the current (or given) locale with BCP-47 fallback. The `fallback`
 * entry (the template's plain `title` / `logo` props) acts as the `en` entry unless the map
 * defines `en` itself.
 */
export function resolveTitle(localeMap: TitleLocaleMap | undefined, fallback: TitleLocaleEntry = {}, locale: string | undefined = getLocale()): ResolvedTitle {
  const map: TitleLocaleMap = { en: fallback, ...(localeMap ?? {}) };
  const entry = resolveLocale(map, locale) ?? fallback;
  const text = entry.text ?? fallback.text ?? '';
  const logo = entry.logo ?? (entry.text ? undefined : fallback.logo);
  return { text, logo, tagline: entry.tagline ?? fallback.tagline, kicker: entry.kicker ?? fallback.kicker, cjk: detectScript(text) !== 'latin' };
}

export interface LocalizedTitleProps {
  /** `{ en: { text }, ja: { logo: 'assets/logo-ja.svg' }, 'zh-CN': { text: '…' } }` */
  localeMap?: TitleLocaleMap;
  /** Default title text (used when no locale entry matches). */
  text?: string;
  /** Default logo image. */
  logo?: string;
  /** Force a locale (defaults to the render locale: `--locale`, batch variant, Studio). */
  locale?: string;
  id?: string;
  name?: string;
  x?: number;
  y?: number;
  width: number;
  height: number;
  /** Extra positioning style (e.g. `{ position: 'relative' }` inside a flex column). */
  style?: ArtisanStyle;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  color?: string;
  /** Text fill override: colour or CSS gradient string. */
  fill?: string;
  letterSpacing?: number;
  lineHeight?: number;
  textAlign?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  textTransform?: 'none' | 'uppercase';
  maxLines?: number;
  minFontSize?: number;
  strokes?: Stroke[];
  effects?: Effect[];
}

/**
 * Localized game title (US-5.4): renders the locale's logo image when one is provided,
 * otherwise the localized text with shrink-to-fit and a CJK-capable font stack.
 */
export function LocalizedTitle(p: LocalizedTitleProps) {
  const t = resolveTitle(p.localeMap, { text: p.text, logo: p.logo }, p.locale ?? getLocale());
  const box: ArtisanStyle = {
    position: 'absolute',
    ...(p.x != null ? { left: p.x } : {}),
    ...(p.y != null ? { top: p.y } : {}),
    width: p.width,
    height: p.height,
    ...(p.style ?? {}),
  };
  const align = p.textAlign ?? 'left';
  const valign = p.verticalAlign ?? 'middle';
  if (t.logo) {
    return (
      <Layer.Image
        id={p.id ?? 'title-logo'}
        name={p.name ?? 'Title logo'}
        src={resolveArt(t.logo)!}
        fit="contain"
        position={{ x: align === 'left' ? 0 : align === 'right' ? 1 : 0.5, y: valign === 'top' ? 0 : valign === 'bottom' ? 1 : 0.5 }}
        style={box}
        effects={p.effects}
      />
    );
  }
  const fontSize = p.fontSize ?? p.height * 0.62;
  return (
    <Text
      id={p.id ?? 'title'}
      name={p.name ?? 'Title'}
      content={t.text}
      fit="shrink"
      maxLines={p.maxLines ?? 2}
      minFontSize={p.minFontSize ?? 6}
      fill={p.fill}
      strokes={p.strokes}
      effects={p.effects}
      style={{
        ...box,
        fontFamily: withCjkFallback(p.fontFamily ?? 'Cinzel'),
        fontSize,
        fontWeight: p.fontWeight ?? 900,
        color: p.color ?? '#ffffff',
        letterSpacing: t.cjk ? 0 : p.letterSpacing ?? 0,
        lineHeight: p.lineHeight ?? (t.cjk ? 1.15 : 1.0),
        textAlign: align,
        verticalAlign: valign,
        textTransform: t.cjk ? 'none' : p.textTransform ?? 'none',
      }}
    />
  );
}
