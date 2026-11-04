/**
 * Dev helper: renders every built-in composition to PNG for visual review.
 * Runs only when ARTISAN_PREVIEW_DIR is set:
 *   ARTISAN_PREVIEW_DIR=/tmp/previews npx vitest run packages/templates-game/test/preview.test.tsx
 * Optional: ARTISAN_PREVIEW_ONLY=steam-main,itch  ARTISAN_PREVIEW_LOCALE=ja  ARTISAN_PREVIEW_PROPS='{"discount":50}'
 */
import { describe, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CachingAssetResolver } from '@game-artisan/core';
import { contactSheet, createNodeFontRegistry, renderComposition } from '@game-artisan/renderer-svg/node';
import { gameCompositions } from '@game-artisan/templates-game';

const dir = process.env.ARTISAN_PREVIEW_DIR;

describe.skipIf(!dir)('preview renders', () => {
  it('writes PNGs', async () => {
    const fonts = await createNodeFontRegistry();
    const assets = new CachingAssetResolver();
    await mkdir(dir!, { recursive: true });
    const only = process.env.ARTISAN_PREVIEW_ONLY?.split(',').filter(Boolean);
    const locale = process.env.ARTISAN_PREVIEW_LOCALE;
    const extra = process.env.ARTISAN_PREVIEW_PROPS ? JSON.parse(process.env.ARTISAN_PREVIEW_PROPS) : {};
    const sheet: { image: Buffer; label: string }[] = [];
    for (const def of gameCompositions) {
      if (only && !only.some((o) => def.id.includes(o))) continue;
      const big = def.width * def.height > 2_500_000;
      const out = await renderComposition(def, { fonts, assets, locale, props: extra, scale: big ? 0.5 : def.width < 300 ? 2 : 1 });
      const file = path.join(dir!, `${def.id}${locale ? `.${locale}` : ''}.png`);
      await writeFile(file, out.buffer);
      sheet.push({ image: out.buffer, label: def.id });
      console.log(def.id, `${out.width}x${out.height}`, `${Math.round(out.timings.totalMs)}ms`, out.warnings.join('; '));
    }
    if (sheet.length > 1) await writeFile(path.join(dir!, `_sheet${locale ? `.${locale}` : ''}.png`), await contactSheet(sheet, { columns: 4, cellWidth: 420, fonts, title: 'templates-game' }));
  });
});
