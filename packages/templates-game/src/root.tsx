import { Composition, Folder, collectCompositions, registerCompositions, type CompositionDefinition } from '@game-artisan/core';
import type { z } from 'zod';
import { BUILTIN_ART } from './art.js';
import { requirePreset, presetSafeZones } from './presets.js';
import { KeyArtCapsule, KeyArtCapsuleSchema } from './templates/KeyArtCapsule.js';
import { SocialCard, SocialCardSchema, StreamOverlay, StreamOverlaySchema } from './templates/social.js';
import { CommunityIcon, CommunityIconSchema, LibraryHero, LibraryHeroSchema, LibraryLogo, LibraryLogoSchema, PageBackground, PageBackgroundSchema } from './templates/steam.js';

/** Common <Composition> props derived from a store preset (id, size, preset, platform, safe zones, format). */
export function presetCompositionProps(presetKeyOrId: string) {
  const spec = requirePreset(presetKeyOrId);
  return {
    id: spec.id,
    name: spec.name,
    description: spec.notes,
    width: spec.width,
    height: spec.height,
    preset: spec.id,
    platform: spec.platform,
    safeZones: presetSafeZones(spec),
    defaultFormat: spec.requiredFormat,
    maxFileSizeBytes: spec.maxFileSizeBytes,
  };
}

type KeyArtInput = Partial<z.input<typeof KeyArtCapsuleSchema>>;

function capsule(key: string, tags: string[], defaultProps: KeyArtInput = {}, variant?: { suffix: string; name: string; description: string }) {
  const base = presetCompositionProps(key);
  const id = variant ? `${base.id}-${variant.suffix}` : base.id;
  return (
    <Composition
      key={id}
      {...base}
      id={id}
      name={variant ? `${base.name} — ${variant.name}` : base.name}
      description={variant ? variant.description : base.description}
      component={KeyArtCapsule}
      schema={KeyArtCapsuleSchema}
      defaultProps={defaultProps}
      tags={['key-art', base.platform, ...tags, ...(variant ? [variant.suffix] : [])]}
    />
  );
}

const SALE_DEFAULTS: KeyArtInput = { discount: 50, saleLabel: 'Sale', eventBanner: 'Weeklong deal · Ends Monday', callout: 'none' };

/** Root declaring every built-in game marketing composition (ids = preset ids, plus `-sale` / `-review` variants). */
export function GameTemplatesRoot() {
  return (
    <>
      <Folder name="Steam">
        {capsule('STEAM_HEADER_CAPSULE', ['capsule'])}
        {capsule('STEAM_SMALL_CAPSULE', ['capsule', 'micro'])}
        {capsule('STEAM_MAIN_CAPSULE', ['capsule'])}
        {capsule('STEAM_VERTICAL_CAPSULE', ['capsule'])}
        <Composition {...presetCompositionProps('STEAM_PAGE_BACKGROUND')} component={PageBackground} schema={PageBackgroundSchema} defaultProps={{}} tags={['steam', 'background']} />
        <Composition {...presetCompositionProps('STEAM_COMMUNITY_ICON')} component={CommunityIcon} schema={CommunityIconSchema} defaultProps={{}} tags={['steam', 'icon']} />
        <Composition {...presetCompositionProps('STEAM_COMMUNITY_ICON_SMALL')} component={CommunityIcon} schema={CommunityIconSchema} defaultProps={{ padding: 0.03 }} tags={['steam', 'icon', 'micro']} />
        <Folder name="Library">
          {capsule('STEAM_LIBRARY_CAPSULE', ['capsule', 'library'])}
          <Composition {...presetCompositionProps('STEAM_LIBRARY_HERO')} component={LibraryHero} schema={LibraryHeroSchema} defaultProps={{}} tags={['steam', 'library', 'hero', 'no-text']} />
          <Composition {...presetCompositionProps('STEAM_LIBRARY_LOGO')} component={LibraryLogo} schema={LibraryLogoSchema} defaultProps={{}} tags={['steam', 'library', 'logo', 'transparent']} />
        </Folder>
        <Folder name="Sale & Events">
          {capsule('STEAM_EVENT_COVER', ['event'], { kicker: 'Major update', tagline: 'A new sky region, three bosses and co-op — free for every player.', callout: 'none' })}
          {capsule('STEAM_EVENT_HEADER', ['event'], { kicker: 'Live now', tagline: 'The Shattered Skies update', characterScale: 1.05 })}
          {capsule('STEAM_MAIN_CAPSULE', ['sale'], SALE_DEFAULTS, { suffix: 'sale', name: 'Sale', description: 'Main capsule variant for sale events: discount burst + event strip.' })}
          {capsule('STEAM_HEADER_CAPSULE', ['sale'], { ...SALE_DEFAULTS, discount: 35, saleShape: 'tag', eventBanner: '' }, { suffix: 'sale', name: 'Sale', description: 'Header capsule variant with a price-tag discount badge.' })}
          {capsule(
            'STEAM_VERTICAL_CAPSULE',
            ['sale'],
            { ...SALE_DEFAULTS, discount: 60, eventBanner: 'Seasonal sale', laurelText: 'Official selection', laurelTitle: 'Pixel Harbor Fest', laurelYear: '2026', callout: 'wishlist' },
            { suffix: 'sale', name: 'Sale', description: 'Vertical capsule variant for seasonal sales: discount, event strip, laurel and wishlist CTA.' },
          )}
        </Folder>
      </Folder>
      <Folder name="Itch.io">
        {capsule('ITCH_COVER', ['cover'])}
        {capsule('ITCH_BANNER', ['banner'], { tagline: 'Climb the floating ruins before the sky falls.' })}
      </Folder>
      <Folder name="Epic Games Store">
        {capsule('EPIC_LANDSCAPE', ['landscape'])}
        {capsule('EPIC_PORTRAIT', ['portrait'])}
      </Folder>
      <Folder name="GOG">
        {capsule('GOG_VERTICAL_COVER', ['cover'])}
        <Composition {...presetCompositionProps('GOG_BACKGROUND')} component={LibraryHero} schema={LibraryHeroSchema} defaultProps={{ characterPosition: 0.66 }} tags={['gog', 'background', 'no-text']} />
      </Folder>
      <Folder name="Nintendo Switch">
        {capsule('SWITCH_HERO_BANNER', ['hero'])}
        {capsule('SWITCH_SQUARE_ICON', ['icon'])}
      </Folder>
      <Folder name="PlayStation">
        {capsule('PLAYSTATION_KEY_ART', ['key-art'])}
        {capsule('PLAYSTATION_SQUARE_COVER', ['cover'])}
      </Folder>
      <Folder name="Social">
        <Composition {...presetCompositionProps('SOCIAL_TWITTER_CARD')} component={SocialCard} schema={SocialCardSchema} defaultProps={{}} tags={['social', 'twitter', 'announcement']} />
        <Composition
          {...presetCompositionProps('SOCIAL_TWITTER_CARD')}
          id="social-twitter-card-review"
          name="Twitter/X Promo Card — Review"
          description="Launch card with a press quote (plain text, no outlet logos)."
          component={SocialCard}
          schema={SocialCardSchema}
          defaultProps={{ headline: 'Out now', kicker: 'Available today', quote: 'A breathtaking climb through a sky full of secrets.', quoteOutlet: 'Indie Gazette', quoteScore: '9/10' }}
          tags={['social', 'twitter', 'launch', 'review']}
        />
        <Composition {...presetCompositionProps('SOCIAL_DISCORD_BANNER')} component={SocialCard} schema={SocialCardSchema} defaultProps={{ headline: 'Community event', kicker: 'Playtest weekend', callout: 'none' }} tags={['social', 'discord', 'announcement']} />
        <Composition {...presetCompositionProps('SOCIAL_YOUTUBE_THUMBNAIL')} component={SocialCard} schema={SocialCardSchema} defaultProps={{ headline: 'New trailer', kicker: '', tagline: '', platformsText: '', callout: 'none', characterScale: 1.1 }} tags={['social', 'youtube', 'thumbnail']} />
        <Composition {...presetCompositionProps('TWITCH_STREAM_OVERLAY')} component={StreamOverlay} schema={StreamOverlaySchema} defaultProps={{}} tags={['social', 'twitch', 'overlay', 'transparent']} />
      </Folder>
    </>
  );
}

/** Every built-in composition definition (collected from GameTemplatesRoot). */
export const gameCompositions: CompositionDefinition[] = collectCompositions(GameTemplatesRoot());

/** Register the built-in game templates in the global composition registry. */
export function registerGameTemplates(): CompositionDefinition[] {
  registerCompositions(gameCompositions);
  return gameCompositions;
}

/** Built-in art references, re-exported for convenience in project defaults. */
export const DEFAULT_ART = BUILTIN_ART;
