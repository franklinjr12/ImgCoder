/**
 * Local fallback for `@game-artisan/templates-game` STORE_PRESETS / presetSafeZones, used until
 * (or when) that package is unavailable. Mirrors the preset matrix of the product spec.
 */
import type { SafeZone } from '@game-artisan/core';
import { safeZonesFromMargins, type StorePresetLike } from '../editor/documents';

export const FALLBACK_STORE_PRESETS: Record<string, StorePresetLike> = {
  STEAM_HEADER_CAPSULE: { id: 'steam-header-capsule', platform: 'steam', name: 'Steam Header Capsule', width: 460, height: 215, aspectRatio: '92:43', requiredFormat: 'png', notes: 'Search, daily deals, genre lists. Logo + prominent key art.' },
  STEAM_SMALL_CAPSULE: { id: 'steam-small-capsule', platform: 'steam', name: 'Steam Small Capsule', width: 231, height: 87, aspectRatio: '77:29', requiredFormat: 'png', notes: 'Small lists. High-contrast title readable at micro sizes.' },
  STEAM_MAIN_CAPSULE: { id: 'steam-main-capsule', platform: 'steam', name: 'Steam Main Capsule', width: 616, height: 353, aspectRatio: '616:353', requiredFormat: 'png', notes: 'Feature carousel placement.' },
  STEAM_VERTICAL_CAPSULE: { id: 'steam-vertical-capsule', platform: 'steam', name: 'Steam Vertical Capsule', width: 374, height: 448, aspectRatio: '187:224', requiredFormat: 'png', notes: 'Featured sales and events.' },
  STEAM_PAGE_BACKGROUND: { id: 'steam-page-background', platform: 'steam', name: 'Steam Page Background', width: 1438, height: 810, aspectRatio: '16:9', requiredFormat: 'jpeg', notes: 'Sides fade to black to match the store page.' },
  STEAM_LIBRARY_HERO: { id: 'steam-library-hero', platform: 'steam', name: 'Steam Library Hero', width: 3840, height: 1240, aspectRatio: '96:31', requiredFormat: 'png', safeZoneMargins: { top: 100, right: 200, bottom: 400, left: 200 }, notes: 'Bottom-left: Steam client overlays logo and Play button.' },
  STEAM_LIBRARY_CAPSULE: { id: 'steam-library-capsule', platform: 'steam', name: 'Steam Library Capsule', width: 600, height: 900, aspectRatio: '2:3', requiredFormat: 'png', notes: 'Library grid view.' },
  STEAM_LIBRARY_LOGO: { id: 'steam-library-logo', platform: 'steam', name: 'Steam Library Logo', width: 1280, height: 720, aspectRatio: '16:9', requiredFormat: 'png', notes: 'Transparent PNG placed over the Library Hero.' },
  STEAM_COMMUNITY_ICON: { id: 'steam-community-icon', platform: 'steam', name: 'Steam Community Icon', width: 184, height: 184, aspectRatio: '1:1', requiredFormat: 'png', notes: 'Also exported at 32×32.' },
  ITCH_COVER: { id: 'itch-cover', platform: 'itch', name: 'Itch.io Cover', width: 630, height: 500, aspectRatio: '63:50', requiredFormat: 'png', notes: 'Storefront grid card.' },
  ITCH_BANNER: { id: 'itch-banner', platform: 'itch', name: 'Itch.io Banner', width: 960, height: 400, aspectRatio: '12:5', requiredFormat: 'png', notes: 'Top of the game page.' },
  EPIC_LANDSCAPE: { id: 'epic-landscape', platform: 'epic', name: 'Epic Landscape', width: 2560, height: 1440, aspectRatio: '16:9', requiredFormat: 'jpeg', notes: 'Promotional carousels.' },
  EPIC_PORTRAIT: { id: 'epic-portrait', platform: 'epic', name: 'Epic Portrait', width: 1200, height: 1600, aspectRatio: '3:4', requiredFormat: 'png', notes: 'Store catalog tile.' },
  SOCIAL_TWITTER_CARD: { id: 'social-twitter-card', platform: 'social', name: 'Twitter/X Card', width: 1200, height: 675, aspectRatio: '16:9', requiredFormat: 'png', notes: 'Announcement preview card.' },
  SOCIAL_DISCORD_BANNER: { id: 'social-discord-banner', platform: 'social', name: 'Discord Banner', width: 1920, height: 1080, aspectRatio: '16:9', requiredFormat: 'png', notes: 'Community announcements.' },
  SOCIAL_TWITCH_OVERLAY: { id: 'social-twitch-overlay', platform: 'social', name: 'Twitch Overlay', width: 1920, height: 1080, aspectRatio: '16:9', requiredFormat: 'png', notes: 'Stream overlay.' },
};

export function fallbackPresetSafeZones(spec: StorePresetLike): SafeZone[] {
  return safeZonesFromMargins(spec);
}
