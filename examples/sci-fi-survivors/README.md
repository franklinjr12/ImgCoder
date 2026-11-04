# Cinder Orbit: Survivors — multi-language bundle example

A GameArtisan project that renders the same store assets for **8 locales** (en, de, es, fr, pt-BR, ja,
ko, zh-CN). The title is a `LocalizedTitle` driven by a `localeMap`: English/European locales use
`assets/logos/logo-en.svg`, while `ja`, `ko` and `zh-CN` swap to their own vector logos
(`logo-ja.svg`, `logo-ko.svg`, `logo-zh-CN.svg`). Taglines and CTAs come from `languages.json`; CJK
strings fall back to a system CJK font automatically (register a bold CJK face in
`artisan.config.ts` for crisper results).

| composition | size | notes |
| --- | --- | --- |
| `steam-header` | 460×215 | HUD-styled capsule |
| `steam-main` | 616×353 | with wishlist CTA + demo badge |
| `steam-vertical` | 374×448 | tall layout |
| `steam-library-capsule` | 600×900 | the built-in `KeyArtCapsule` template re-skinned with this art |
| `twitter-card` | 1200×675 | social announcement |

```bash
pnpm artisan list
pnpm artisan render steam-main --locale=ja --out=dist/ja/steam-main.png   # Japanese logo swap
pnpm artisan render twitter-card --locale=zh-CN
pnpm batch        # = artisan batch --data=languages.json --compositions=all --out=dist/
                  #   → dist/<locale>/<composition>.png for all 8 locales × 5 compositions
```

`languages.json` format:

```json
{ "variants": [ { "id": "ja", "locale": "ja", "props": { "tagline": "…", "ctaText": "…" } } ] }
```

Assets are original SVG art (the CJK logos contain glyph outlines generated from the bundled
Bebas Neue / Inter fonts and the system WenQuanYi Zen Hei font, so they render without fonts).

Test (from the repo root): `npx vitest run examples/sci-fi-survivors`
