/**
 * End-to-end smoke test: boots the Studio with `startStudio()`, drives it with playwright-core
 * Chromium (skipped when no browser is available), edits a prop in the inspector, drags a layer
 * on the canvas, and checks project HMR + asset hot-reload.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-ignore — plain ESM JS server module
import { startStudio } from '../server/index.js';

let chromium: any = null;
try {
  chromium = (await import('playwright-core')).chromium;
} catch {
  chromium = null;
}

async function launch(): Promise<any | null> {
  if (!chromium) return null;
  try {
    return await chromium.launch();
  } catch {
    return null;
  }
}

const browser = await launch();
const SHOTS = process.env.STUDIO_SCREENSHOTS ?? path.join(os.tmpdir(), 'artisan-studio-e2e');
fs.mkdirSync(SHOTS, { recursive: true });

const state = (page: any) =>
  page.evaluate(() => {
    const s = (window as any).__artisanStudio.get();
    const st = s.comp[s.compositionId] ?? { props: {}, overrides: {} };
    return { id: s.compositionId, props: st.props, overrides: st.overrides, selection: s.selection, nonce: s.render.nonce, error: s.render.error, background: s.live?.background };
  });

async function waitFor(fn: () => Promise<boolean>, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

describe.skipIf(!browser)('studio e2e (chromium)', () => {
  afterAll(async () => {
    await browser?.close();
  });

  describe('standalone', () => {
    let studio: { url: string; close(): Promise<void> };
    beforeAll(async () => {
      studio = await startStudio({ port: 0, logLevel: 'silent' });
    });
    afterAll(async () => {
      await studio?.close();
    });

    it('renders a built-in composition, edits a prop and drags a layer', async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const errors: string[] = [];
      page.on('pageerror', (e: Error) => errors.push(e.message));
      await page.goto(`${studio.url}?composition=studio-demo-capsule`);
      await page.waitForSelector('[data-testid=artboard] svg [data-layer-id="title"]', { timeout: 60000 });
      await page.screenshot({ path: path.join(SHOTS, 'e2e-initial.png') });

      // --- Props Inspector → canvas
      const before = await state(page);
      const title = page.locator('.inspector .row:has(.prop-label:text-is("Title")) input').first();
      await title.fill('E2E TITLE');
      await title.press('Enter');
      expect(await waitFor(async () => (await page.evaluate(() => (window as any).__artisanStudio.get().live?.children.find((c: any) => c.id === 'title')?.content)) === 'E2E TITLE')).toBe(true);
      expect(await waitFor(async () => (await state(page)).nonce > before.nonce)).toBe(true);
      expect((await state(page)).props.title).toBe('E2E TITLE');
      // deviation indicator appears
      await page.waitForSelector('[data-testid=deviation]');

      // --- drag the (bound) hero layer on the canvas
      const hero = page.locator('[data-testid=artboard] [data-layer-id="hero"]');
      const transformBefore = await hero.getAttribute('transform');
      const box = await hero.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 - 70, box.y + box.height / 2 + 12, { steps: 10 });
      await page.mouse.up();
      expect(await waitFor(async () => (await page.locator('[data-testid=artboard] [data-layer-id="hero"]').getAttribute('transform')) !== transformBefore)).toBe(true);
      const after = await state(page);
      expect(after.selection).toEqual(['hero']);
      // bound fields (bind={{ x: 'heroX', y: 'heroY' }}) update props, not overrides
      expect(after.props.heroX).toBeLessThan(372);
      expect(after.props.heroY).toBeGreaterThan(40);
      expect(after.overrides.hero).toBeUndefined();
      await page.screenshot({ path: path.join(SHOTS, 'e2e-after-drag.png') });

      // --- unbound layer → stored as an override
      await page.locator('.layer-row:has-text("Tagline")').click();
      await page.keyboard.press('Shift+ArrowRight');
      expect(await waitFor(async () => !!(await state(page)).overrides.tagline)).toBe(true);
      expect((await state(page)).overrides.tagline.transform.x).toBeCloseTo(40, 3);

      // --- undo / redo
      await page.locator('[data-testid=viewport]').focus();
      await page.keyboard.press('Control+z');
      expect(await waitFor(async () => !(await state(page)).overrides.tagline)).toBe(true);
      await page.keyboard.press('Control+Shift+z');
      expect(await waitFor(async () => !!(await state(page)).overrides.tagline)).toBe(true);

      expect((await state(page)).error).toBeFalsy();
      expect(errors).toEqual([]);
      await page.close();
    });
  });

  describe('project mode', () => {
    let studio: { url: string; close(): Promise<void> };
    let dir: string;
    const entrySrc = (bg: string) => `import { Composition, Layer, Text, registerRoot, z, zImage } from '@game-artisan/core';
const Schema = z.object({ title: z.string().default('PROJECT'), hero: zImage('assets/hero.svg') });
function Card(p: z.infer<typeof Schema>) {
  return (
    <div style={{ width: 320, height: 180, backgroundColor: '${bg}' }}>
      <Layer.Image id="hero" src={p.hero} x={10} y={10} width={100} height={100} />
      <Text id="title" content={p.title} x={120} y={20} style={{ width: 180, fontSize: 24, color: '#fff' }} />
    </div>
  );
}
registerRoot(() => <Composition id="e2e-card" width={320} height={180} component={Card} schema={Schema} defaultProps={{}} />);
`;
    beforeAll(async () => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artisan-studio-proj-'));
      fs.mkdirSync(path.join(dir, 'assets'));
      fs.writeFileSync(path.join(dir, 'index.tsx'), entrySrc('#102030'));
      fs.writeFileSync(path.join(dir, 'assets/hero.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#00ff00"/></svg>');
      studio = await startStudio({ root: dir, entry: 'index.tsx', port: 0, logLevel: 'silent', includeBuiltinTemplates: false });
    });
    afterAll(async () => {
      await studio?.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('serves project files safely, hot-reloads compositions keeping props, reloads assets', async () => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await page.goto(studio.url);
      await page.waitForSelector('[data-testid=artboard] svg [data-layer-id="title"]', { timeout: 60000 });
      expect((await state(page)).id).toBe('e2e-card');
      const status = (u: string) => page.evaluate(async (url: string) => (await fetch(url)).status, u);
      expect(await status('/__artisan/file?path=assets/hero.svg')).toBe(200);
      expect(await status('/__artisan/file?path=../../../etc/passwd')).toBe(403);
      const assets = await page.evaluate(async () => (await fetch('/__artisan/assets')).json());
      expect(assets.files.map((f: any) => f.path)).toEqual(['assets/hero.svg']);
      const put = await page.evaluate(async () => (await fetch('/__artisan/documents/test-doc', { method: 'PUT', body: JSON.stringify({ id: 'd', name: 'D', artboards: [{ id: 'a', width: 10, height: 10, children: [] }] }) })).status);
      expect(put).toBe(200);
      expect(fs.existsSync(path.join(dir, 'designs/test-doc.artisan.json'))).toBe(true);

      // edit a prop, then change the entry on disk → HMR keeps the prop
      await page.evaluate(() => {
        const s = (window as any).__artisanStudio;
        s.set({ comp: { ...s.get().comp, 'e2e-card': { props: { title: 'KEEP ME' }, overrides: {}, guides: [] } } });
      });
      fs.writeFileSync(path.join(dir, 'index.tsx'), entrySrc('#aa0000'));
      expect(await waitFor(async () => (await state(page)).background?.color === '#aa0000', 20000)).toBe(true);
      expect((await state(page)).props.title).toBe('KEEP ME');

      // change an asset on disk → artisan:assets-changed → canvas reloads it
      const v0 = await page.evaluate(() => (window as any).__artisanStudio.get().assetsVersion);
      fs.writeFileSync(path.join(dir, 'assets/hero.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#0000ff"/></svg>');
      expect(await waitFor(async () => (await page.evaluate(() => (window as any).__artisanStudio.get().assetsVersion)) > v0, 20000)).toBe(true);
      await page.screenshot({ path: path.join(SHOTS, 'e2e-project.png') });
      await page.close();
    });
  });
});
