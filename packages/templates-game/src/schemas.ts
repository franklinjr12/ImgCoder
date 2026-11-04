/**
 * Zod schema building blocks shared by the game templates. Every prop carries Studio widget
 * hints (zColor / zImage / zSlider …) and descriptive, agent-friendly validation messages.
 */
import { isColor, z, zColor, zFont, zImage, zLocaleMap, zSlider } from '@game-artisan/core';
import { BUILTIN_ART } from './art.js';
import { GRADING_NAMES } from './utils.js';

/** CSS colour prop with a helpful validation message. */
export const colorProp = (defaultValue: string, description?: string) =>
  zColor()
    .refine((v) => isColor(v), { message: 'Expected a CSS colour such as "#ff6a3d", "rgb(255,106,61)", "hsl(20 100% 60%)" or "orange"' })
    .describe(description ?? 'CSS colour')
    .default(defaultValue);

/** Image prop: path (relative to the project), URL, data URI or `builtin:<name>`. Empty string = none. */
export const imageProp = (defaultValue: string, description?: string) =>
  zImage()
    .describe(`${description ?? 'Image'} — file path, URL, data URI or built-in art (builtin:sky-mountains, builtin:hero, builtin:emblem, builtin:nebula). Empty string hides it.`)
    .default(defaultValue);

/** One locale entry of a title localeMap (US-5.4). */
export const TitleLocaleEntrySchema = z
  .object({
    logo: zImage().optional().describe('Localized logo image (preferred over text when present)'),
    text: z.string().optional().describe('Localized title text'),
    tagline: z.string().optional().describe('Localized tagline'),
    kicker: z.string().optional().describe('Localized genre / kicker line'),
  })
  .strict();

export const TitleLocaleMapSchema = zLocaleMap(TitleLocaleEntrySchema).describe(
  'Per-locale title overrides resolved against --locale with BCP-47 fallback (zh-Hant-TW → zh-Hant → zh). Entries with `logo` swap the title for a localized logo image.',
);

export type TitleLocaleMapInput = z.input<typeof TitleLocaleMapSchema>;

export const DEFAULT_TITLE = 'Skybound Relic';

/** Demo localizations of the placeholder title so `--locale ja|ko|zh-CN` works out of the box. */
export const DEFAULT_LOCALE_MAP: Record<string, { text?: string; logo?: string; tagline?: string; kicker?: string }> = {
  ja: { text: 'スカイバウンド\nレリック', kicker: 'アクションアドベンチャー', tagline: '空に浮かぶ遺跡へ、最後の旅が始まる。' },
  ko: { text: '스카이바운드 렐릭', kicker: '액션 어드벤처', tagline: '하늘에 떠 있는 유적으로, 마지막 여정이 시작된다.' },
  'zh-CN': { text: '天穹遗物', kicker: '动作冒险', tagline: '前往漂浮于天际的遗迹，最后的旅程即将开始。' },
  'zh-TW': { text: '天穹遺物', kicker: '動作冒險', tagline: '前往漂浮於天際的遺跡，最後的旅程即將開始。' },
  de: { kicker: 'Action-Adventure', tagline: 'Die letzte Reise zu den schwebenden Ruinen beginnt.' },
  fr: { kicker: 'Action-aventure', tagline: 'Le dernier voyage vers les ruines flottantes commence.' },
  es: { kicker: 'Acción y aventura', tagline: 'Comienza el último viaje hacia las ruinas flotantes.' },
  'pt-BR': { kicker: 'Ação e aventura', tagline: 'A última jornada às ruínas flutuantes começa.' },
};

export const gradingProp = () =>
  z
    .enum(GRADING_NAMES)
    .default('none')
    .describe('Colour-grading preset applied to the artwork (not the title): none, cinematic-dark, vibrant-arcade, grimdark-retro, anime-cel, crt-arcade, gameboy');

export const layoutProp = () => z.enum(['auto', 'wide', 'tall', 'square', 'tiny']).default('auto').describe('Layout variant; auto picks one from the canvas aspect ratio');

/** Title / branding props shared by every template that shows the game name. */
export const brandingShape = {
  title: z.string().min(1, 'Title must not be empty').max(80, 'Keep titles under 80 characters').default(DEFAULT_TITLE).describe('Game title (default-locale text)'),
  logoUrl: zImage().default('').describe('Optional logo image used instead of the title text (path, URL, data URI). Empty = render the title as text.'),
  localeMap: TitleLocaleMapSchema.default(DEFAULT_LOCALE_MAP),
  kicker: z.string().max(48, 'Keep the kicker under 48 characters').default('Action Adventure').describe('Small genre / announcement line above the title (empty = none)'),
  tagline: z.string().max(140, 'Keep the tagline under 140 characters').default('').describe('Line under the title (empty = none)'),
  titleFont: zFont('Cinzel'),
  bodyFont: zFont('Inter'),
  titleColor: colorProp('#ffffff', 'Title colour (top of the gradient)'),
  titleStyle: z.enum(['gradient', 'solid', 'outline']).default('gradient').describe('gradient: titleColor → accent tint; outline: solid + dark outline for busy art'),
  accentColor: colorProp('#ffb36b', 'Accent colour (kicker, badges, glow tint)'),
};

/** Artwork props (background, character cutout, grading, glow). */
export const artShape = {
  backgroundUrl: imageProp(BUILTIN_ART.background, 'Background / key art'),
  characterUrl: imageProp(BUILTIN_ART.character, 'Transparent character cutout'),
  characterScale: zSlider(0.4, 1.6, 1, 0.05).describe('Character size multiplier'),
  characterOffsetX: zSlider(-0.5, 0.5, 0, 0.01).describe('Horizontal character offset (fraction of the canvas width)'),
  grading: gradingProp(),
  characterGlow: z.boolean().default(true).describe('Alpha-dilated outer glow around the character (US-7.3)'),
  glowColor: colorProp('#ffb36b', 'Character glow colour'),
  glowIntensity: zSlider(0, 100, 45).describe('Glow strength'),
  rimLight: z.boolean().default(false).describe('Directional rim light on the character'),
};

/** Optional marketing badges (off by default: Steam capsules should only carry art + logo). */
export const badgeShape = {
  discount: z.number().int('Discount must be a whole number').min(0, 'Discount must be 0 (hidden) or a percentage').max(100, 'Discount must be a percentage between 0 and 100').default(0).describe('Sale percentage; 0 hides the sale badge'),
  saleLabel: z.string().max(24).default('Sale').describe('Caption on the sale badge'),
  saleShape: z.enum(['burst', 'tag', 'ribbon', 'circle', 'pill']).default('burst'),
  saleColor: colorProp('#ff2e63', 'Sale badge colour'),
  eventBanner: z.string().max(60).default('').describe('Event strip text, e.g. "Spring Sale · Ends Mar 27" (empty = none)'),
  laurelText: z.string().max(40).default('').describe('Laurel top line, e.g. "Official Selection" (empty title + text = no laurel)'),
  laurelTitle: z.string().max(40).default('').describe('Laurel festival / award name'),
  laurelYear: z.string().max(8).default(''),
  laurelStyle: z.enum(['classic', 'modern', 'pixel']).default('classic'),
  callout: z.enum(['none', 'wishlist', 'demo']).default('none').describe('Call-to-action badge under the title'),
  calloutText: z.string().max(32).default('').describe('Override the call-to-action text (empty = default)'),
  showSafeZones: z.boolean().default(false).describe('Draw the preset safe / danger zones (preview only)'),
};

export { z };
