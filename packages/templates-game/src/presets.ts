/**
 * Game marketing preset matrix (spec §5): official store / social asset sizes, formats and
 * safe-zone guidance. Composition ids in this package equal the preset ids.
 */
import type { SafeZone } from '@game-artisan/core';

export type StorePlatform = 'steam' | 'itch' | 'epic' | 'gog' | 'playstation' | 'switch' | 'social';

export interface StoreAssetSpec {
  id: string;
  platform: StorePlatform;
  name: string;
  width: number;
  height: number;
  aspectRatio: string;
  requiredFormat: 'png' | 'jpeg' | 'webp' | 'svg';
  maxFileSizeBytes?: number;
  safeZoneMargins?: { top: number; right: number; bottom: number; left: number };
  notes: string;
}

const MB = 1024 * 1024;

const CONSOLE_NOTE = 'Console platform asset specs are distributed to licensed developers via the platform developer portal; this is a common delivery size — verify against the current guidelines before submission.';

export const STORE_PRESETS: Record<string, StoreAssetSpec> = {
  // ---------------------------------------------------------------- Steam core capsules
  STEAM_HEADER_CAPSULE: {
    id: 'steam-header-capsule',
    platform: 'steam',
    name: 'Steam Header Capsule',
    width: 460,
    height: 215,
    aspectRatio: '92:43',
    requiredFormat: 'png',
    notes: 'Displayed on search, daily deals, genre lists. Needs game logo + prominent key art.',
  },
  STEAM_MAIN_CAPSULE: {
    id: 'steam-main-capsule',
    platform: 'steam',
    name: 'Steam Main Capsule',
    width: 616,
    height: 353,
    aspectRatio: '616:353',
    requiredFormat: 'png',
    notes: 'Feature carousel placement.',
  },
  STEAM_VERTICAL_CAPSULE: {
    id: 'steam-vertical-capsule',
    platform: 'steam',
    name: 'Steam Vertical Capsule',
    width: 374,
    height: 448,
    aspectRatio: '187:224',
    requiredFormat: 'png',
    notes: 'Featured sales, event promotions, deep discounts.',
  },
  STEAM_SMALL_CAPSULE: {
    id: 'steam-small-capsule',
    platform: 'steam',
    name: 'Steam Small Capsule',
    width: 231,
    height: 87,
    aspectRatio: '77:29',
    requiredFormat: 'png',
    notes: 'Small lists, sidebars. Requires high-contrast title typography readable at micro-sizes.',
  },
  STEAM_PAGE_BACKGROUND: {
    id: 'steam-page-background',
    platform: 'steam',
    name: 'Steam Page Background',
    width: 1438,
    height: 810,
    aspectRatio: '16:9',
    requiredFormat: 'jpeg',
    notes: 'Sides fade softly to black #000000 to match Steam store page framing.',
  },
  STEAM_LIBRARY_HERO: {
    id: 'steam-library-hero',
    platform: 'steam',
    name: 'Steam Library Hero Banner',
    width: 3840,
    height: 1240,
    aspectRatio: '96:31',
    requiredFormat: 'png',
    safeZoneMargins: { top: 100, right: 200, bottom: 400, left: 200 },
    notes: 'Bottom-left has critical safe zone where Steam client overlays logo and play button.',
  },
  STEAM_LIBRARY_CAPSULE: {
    id: 'steam-library-capsule',
    platform: 'steam',
    name: 'Steam Library Vertical Capsule',
    width: 600,
    height: 900,
    aspectRatio: '2:3',
    requiredFormat: 'png',
    notes: 'Player game library grid view.',
  },
  STEAM_LIBRARY_LOGO: {
    id: 'steam-library-logo',
    platform: 'steam',
    name: 'Steam Library Logo Overlay',
    width: 1280,
    height: 720,
    aspectRatio: '16:9',
    requiredFormat: 'png',
    notes: 'Transparent PNG placed over the Library Hero.',
  },
  STEAM_COMMUNITY_ICON: {
    id: 'steam-community-icon-184',
    platform: 'steam',
    name: 'Steam Community Icon (Large)',
    width: 184,
    height: 184,
    aspectRatio: '1:1',
    requiredFormat: 'png',
    notes: 'Community hub / app icon. Use a bold logo mark, no small text.',
  },
  STEAM_COMMUNITY_ICON_SMALL: {
    id: 'steam-community-icon-32',
    platform: 'steam',
    name: 'Steam Community Icon (Small)',
    width: 32,
    height: 32,
    aspectRatio: '1:1',
    requiredFormat: 'png',
    notes: 'Shown in friends list / overlays at 32px. Single bold glyph or mark only.',
  },
  STEAM_EVENT_COVER: {
    id: 'steam-event-cover',
    platform: 'steam',
    name: 'Steam Event Cover',
    width: 800,
    height: 450,
    aspectRatio: '16:9',
    requiredFormat: 'png',
    notes: 'Events & announcements cover image (sale events, updates, launches). Text and badges are allowed here.',
  },
  STEAM_EVENT_HEADER: {
    id: 'steam-event-header',
    platform: 'steam',
    name: 'Steam Event Header',
    width: 1920,
    height: 622,
    aspectRatio: '960:311',
    requiredFormat: 'png',
    safeZoneMargins: { top: 40, right: 160, bottom: 40, left: 160 },
    notes: 'Banner at the top of an event / announcement page.',
  },

  // ---------------------------------------------------------------- Itch.io
  ITCH_COVER: {
    id: 'itch-cover',
    platform: 'itch',
    name: 'Itch.io Game Cover',
    width: 630,
    height: 500,
    aspectRatio: '63:50',
    requiredFormat: 'png',
    notes: 'Main storefront grid card.',
  },
  ITCH_BANNER: {
    id: 'itch-banner',
    platform: 'itch',
    name: 'Itch.io Header Banner',
    width: 960,
    height: 400,
    aspectRatio: '12:5',
    requiredFormat: 'png',
    notes: 'Top of game detail page.',
  },

  // ---------------------------------------------------------------- Epic Games Store
  EPIC_LANDSCAPE: {
    id: 'epic-landscape',
    platform: 'epic',
    name: 'Epic Store Landscape',
    width: 2560,
    height: 1440,
    aspectRatio: '16:9',
    requiredFormat: 'jpeg',
    notes: 'Main promotional carousels.',
  },
  EPIC_PORTRAIT: {
    id: 'epic-portrait',
    platform: 'epic',
    name: 'Epic Store Portrait',
    width: 1200,
    height: 1600,
    aspectRatio: '3:4',
    requiredFormat: 'png',
    notes: 'Store catalog tile.',
  },

  // ---------------------------------------------------------------- GOG
  GOG_VERTICAL_COVER: {
    id: 'gog-vertical-cover',
    platform: 'gog',
    name: 'GOG Galaxy Vertical Cover',
    width: 342,
    height: 482,
    aspectRatio: '171:241',
    requiredFormat: 'png',
    notes: 'GOG Galaxy library grid cover (deliver at 2x — 684×964 — via --scale 2 for HiDPI).',
  },
  GOG_BACKGROUND: {
    id: 'gog-background',
    platform: 'gog',
    name: 'GOG Store / Galaxy Background',
    width: 1920,
    height: 1080,
    aspectRatio: '16:9',
    requiredFormat: 'jpeg',
    safeZoneMargins: { top: 0, right: 240, bottom: 0, left: 240 },
    notes: 'Product page and Galaxy game view background. Keep the subject inside the central area; page UI covers the sides and bottom.',
  },

  // ---------------------------------------------------------------- Nintendo Switch eShop
  SWITCH_HERO_BANNER: {
    id: 'switch-hero-banner',
    platform: 'switch',
    name: 'Nintendo Switch eShop Hero Banner',
    width: 1920,
    height: 1080,
    aspectRatio: '16:9',
    requiredFormat: 'jpeg',
    safeZoneMargins: { top: 54, right: 96, bottom: 54, left: 96 },
    notes: `eShop product page key art. ${CONSOLE_NOTE}`,
  },
  SWITCH_SQUARE_ICON: {
    id: 'switch-square-icon',
    platform: 'switch',
    name: 'Nintendo Switch eShop Square Icon',
    width: 1024,
    height: 1024,
    aspectRatio: '1:1',
    requiredFormat: 'jpeg',
    notes: `Square title icon / eShop tile. ${CONSOLE_NOTE}`,
  },

  // ---------------------------------------------------------------- PlayStation Store
  PLAYSTATION_KEY_ART: {
    id: 'playstation-key-art',
    platform: 'playstation',
    name: 'PlayStation Store Key Art',
    width: 3840,
    height: 2160,
    aspectRatio: '16:9',
    requiredFormat: 'png',
    safeZoneMargins: { top: 108, right: 192, bottom: 108, left: 192 },
    notes: `Game hub / store background key art (4K). ${CONSOLE_NOTE}`,
  },
  PLAYSTATION_SQUARE_COVER: {
    id: 'playstation-square-cover',
    platform: 'playstation',
    name: 'PlayStation Store Square Cover',
    width: 1024,
    height: 1024,
    aspectRatio: '1:1',
    requiredFormat: 'png',
    notes: `Store tile / product cover. ${CONSOLE_NOTE}`,
  },

  // ---------------------------------------------------------------- Social & marketing
  SOCIAL_TWITTER_CARD: {
    id: 'social-twitter-card',
    platform: 'social',
    name: 'Twitter/X Promo Card',
    width: 1200,
    height: 675,
    aspectRatio: '16:9',
    requiredFormat: 'png',
    maxFileSizeBytes: 5 * MB,
    safeZoneMargins: { top: 34, right: 60, bottom: 34, left: 60 },
    notes: 'Optimal preview card for game announcements.',
  },
  SOCIAL_DISCORD_BANNER: {
    id: 'social-discord-banner',
    platform: 'social',
    name: 'Discord Event / Server Banner',
    width: 1920,
    height: 1080,
    aspectRatio: '16:9',
    requiredFormat: 'png',
    maxFileSizeBytes: 10 * MB,
    notes: 'Community announcements.',
  },
  SOCIAL_YOUTUBE_THUMBNAIL: {
    id: 'social-youtube-thumbnail',
    platform: 'social',
    name: 'YouTube Thumbnail',
    width: 1280,
    height: 720,
    aspectRatio: '16:9',
    requiredFormat: 'jpeg',
    maxFileSizeBytes: 2 * MB,
    safeZoneMargins: { top: 0, right: 0, bottom: 0, left: 0 },
    notes: 'Trailer / devlog thumbnail. The bottom-right corner is covered by the video duration stamp.',
  },
  TWITCH_STREAM_OVERLAY: {
    id: 'twitch-stream-overlay',
    platform: 'social',
    name: 'Twitch Stream Overlay',
    width: 1920,
    height: 1080,
    aspectRatio: '16:9',
    requiredFormat: 'png',
    notes: 'Transparent full-screen overlay (OBS browser/image source): frame, webcam slot, now-playing bar. Centre stays transparent for gameplay.',
  },
};

/** Normalise "steam_header-capsule" / "STEAM_HEADER_CAPSULE" / "steam-header-capsule" → "steam-header-capsule". */
const normKey = (s: string) => s.trim().toLowerCase().replace(/[_\s]+/g, '-');

/** Look up a preset by id (`steam-header-capsule`) or key (`STEAM_HEADER_CAPSULE`), case-insensitive. */
export function getPreset(idOrKey: string): StoreAssetSpec | undefined {
  if (!idOrKey) return undefined;
  if (STORE_PRESETS[idOrKey]) return STORE_PRESETS[idOrKey];
  const n = normKey(idOrKey);
  return Object.entries(STORE_PRESETS).find(([key, spec]) => spec.id === n || normKey(key) === n)?.[1];
}

/** Like getPreset but throws a helpful error listing close matches. */
export function requirePreset(idOrKey: string): StoreAssetSpec {
  const spec = getPreset(idOrKey);
  if (spec) return spec;
  const n = normKey(idOrKey);
  const ids = Object.values(STORE_PRESETS).map((p) => p.id);
  const near = ids.filter((id) => id.includes(n) || n.split('-').some((part) => part.length > 2 && id.includes(part))).slice(0, 6);
  throw new Error(`Unknown store preset "${idOrKey}".${near.length ? ` Did you mean: ${near.join(', ')}?` : ''} Available: ${ids.join(', ')}`);
}

/** All presets, optionally filtered by platform (in declaration order). */
export function listPresets(platform?: StorePlatform | string): StoreAssetSpec[] {
  const all = Object.values(STORE_PRESETS);
  return platform ? all.filter((p) => p.platform === platform.toLowerCase()) : all;
}

/** Find the preset with exactly these pixel dimensions (first match). */
export function presetForSize(width: number, height: number): StoreAssetSpec | undefined {
  return Object.values(STORE_PRESETS).find((p) => p.width === width && p.height === height);
}

/**
 * Safe zones (core `SafeZone` shape) for a preset: a title-safe area derived from
 * `safeZoneMargins`, plus platform UI zones where the client covers the artwork.
 */
export function presetSafeZones(spec: StoreAssetSpec): SafeZone[] {
  const { width: W, height: H } = spec;
  const zones: SafeZone[] = [];
  const m = spec.safeZoneMargins;
  if (m && (m.top || m.right || m.bottom || m.left)) {
    zones.push({ id: 'title-safe', label: 'Title / subject safe area', kind: 'safe', x: m.left, y: m.top, width: W - m.left - m.right, height: H - m.top - m.bottom });
  }
  switch (spec.id) {
    case 'steam-library-hero': {
      // Steam client draws the library logo (bottom-left by default) and a dark gradient + play bar.
      zones.push({ id: 'library-logo-area', label: 'Steam library logo overlay (keep clear)', kind: 'danger', x: 0, y: Math.round(H * 0.42), width: Math.round(W * 0.42), height: H - Math.round(H * 0.42) });
      zones.push({ id: 'play-bar', label: 'Play button / game info bar', kind: 'danger', x: 0, y: H - 160, width: W, height: 160 });
      zones.push({ id: 'ui-gradient', label: 'Steam UI dark gradient', kind: 'overlay', x: 0, y: Math.round(H * 0.62), width: W, height: H - Math.round(H * 0.62) });
      break;
    }
    case 'steam-page-background': {
      const col = 940;
      const side = Math.round((W - col) / 2);
      zones.push({ id: 'content-column', label: 'Store page content column (low-contrast area)', kind: 'overlay', x: side, y: 0, width: col, height: H });
      zones.push({ id: 'fade-left', label: 'Fade to #000000', kind: 'overlay', x: 0, y: 0, width: Math.round(side * 0.6), height: H });
      zones.push({ id: 'fade-right', label: 'Fade to #000000', kind: 'overlay', x: W - Math.round(side * 0.6), y: 0, width: Math.round(side * 0.6), height: H });
      break;
    }
    case 'steam-library-logo': {
      zones.push({ id: 'logo-bounds', label: 'Logo bounds (trim transparent padding)', kind: 'safe', x: Math.round(W * 0.05), y: Math.round(H * 0.08), width: Math.round(W * 0.9), height: Math.round(H * 0.84) });
      break;
    }
    case 'social-youtube-thumbnail': {
      zones.push({ id: 'duration-stamp', label: 'Video duration stamp', kind: 'danger', x: W - 150, y: H - 70, width: 150, height: 70 });
      break;
    }
    case 'twitch-stream-overlay': {
      zones.push({ id: 'webcam', label: 'Webcam slot', kind: 'overlay', x: W - 520, y: H - 380, width: 480, height: 300 });
      zones.push({ id: 'gameplay', label: 'Gameplay (keep transparent)', kind: 'safe', x: 40, y: 40, width: W - 600, height: H - 200 });
      break;
    }
    default:
      if (!m && spec.width >= 200 && spec.height >= 80 && spec.platform !== 'social') {
        const inset = Math.round(Math.min(W, H) * 0.05);
        zones.push({ id: 'title-safe', label: 'Title safe area', kind: 'safe', x: inset, y: inset, width: W - inset * 2, height: H - inset * 2 });
      }
  }
  return zones;
}

/** Default export format for a preset (store-required format). */
export function presetFormat(spec: StoreAssetSpec): 'png' | 'jpeg' | 'webp' | 'svg' {
  return spec.requiredFormat;
}
