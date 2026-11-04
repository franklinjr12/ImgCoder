import { describe, expect, it, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { existsSync, rmSync, readFileSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ArtisanProject, renderToFile, runBatch, normalizeVariants, selectCompositions, expandPattern, batchLocalize, TemplateStateStore, initProject, loadConfig, planBatch } from '@game-artisan/runtime';

const root = fileURLToPath(new URL('./fixtures/project/', import.meta.url));
let project: ArtisanProject;

beforeAll(async () => {
  rmSync(path.join(root, 'out'), { recursive: true, force: true });
  rmSync(path.join(root, '.artisan'), { recursive: true, force: true });
  project = await ArtisanProject.load({ cwd: root });
});

describe('project loading', () => {
  it('loads TS config, TSX entry and UDM documents', async () => {
    const cfg = await loadConfig({ cwd: path.join(root, 'src') });
    expect(cfg.root).toBe(root.replace(/\/$/, ''));
    expect(project.list().map((c) => c.id).sort()).toEqual(['header', 'promo-banner', 'small']);
    const info = project.describe('header');
    expect((info.propsSchema as any).properties.accent['x-artisan-widget']).toBe('color');
    expect(project.describe('promo-banner').source).toBe('document');
  });
});

describe('render service', () => {
  it('renders to file with props, scale and locale', async () => {
    const r = await renderToFile(project, { compositionId: 'header', props: { title: 'HELLO' }, scale: 2, outputPath: 'out/header@2x.png' });
    expect(r.dimensions).toEqual({ width: 920, height: 430 });
    expect(existsSync(r.outputPath!)).toBe(true);
    expect(r.fileSizeBytes).toBeGreaterThan(1000);
    expect(r.warnings).toEqual([]);
    const ja = await renderToFile(project, { compositionId: 'header', locale: 'ja', format: 'webp' });
    expect(ja.buffer.subarray(8, 12).toString()).toBe('WEBP');
  });
  it('renders document compositions with bindings', async () => {
    const r = await renderToFile(project, { compositionId: 'promo-banner', props: { headline: 'WINTER' }, format: 'svg', svgText: 'embedded' });
    expect(r.buffer.toString()).toContain('WINTER');
  });
  it('writes linked-font SVGs with font files next to them', async () => {
    const r = await renderToFile(project, { compositionId: 'small', format: 'svg', svgText: 'linked', outputPath: 'out/linked/small.svg' });
    expect(r.buffer.toString()).toContain("url('fonts/Inter_400Regular.ttf')");
    expect(existsSync(path.join(root, 'out/linked/fonts/Inter_400Regular.ttf'))).toBe(true);
  });
  it('surfaces prop validation errors', async () => {
    await expect(renderToFile(project, { compositionId: 'header', props: { heroX: 9999 } })).rejects.toThrow(/heroX/);
  });
});

describe('batch & localisation', () => {
  it('normalises data shapes and selects compositions', () => {
    expect(normalizeVariants({ en: { a: 1 }, ja: {} }).map((v) => v.locale)).toEqual(['en', 'ja']);
    expect(normalizeVariants(['de', 'fr'])[1]).toEqual({ id: 'fr', locale: 'fr' });
    expect(normalizeVariants({ locales: ['en'], localizationData: { en: { x: 1 } } })[0].props).toEqual({ x: 1 });
    expect(selectCompositions(['steam-a', 'steam-b', 'itch'], ['steam-*'])).toEqual(['steam-a', 'steam-b']);
    expect(() => selectCompositions(['a'], ['b'])).toThrow(/Unknown composition/);
    expect(expandPattern('{variant}/{composition}{scaleSuffix}.{ext}', { variant: 'en', composition: 'x', scaleSuffix: '', ext: 'png' })).toBe('en/x.png');
  });

  it('plans the composition × variant × scale matrix', async () => {
    const jobs = await planBatch(project, { data: 'variants.json', compositions: ['header', 'small'], scales: [1, 2] });
    expect(jobs).toHaveLength(3 * 2 * 2);
    expect(jobs.map((j) => path.relative(path.join(root, 'out'), j.outputPath))).toContain('ja/header@2x.png');
  });

  it('runs a batch in-process with progress, per-item timing and a report', async () => {
    const events: number[] = [];
    const s = await runBatch({ cwd: root, data: 'variants.json', compositions: ['header', 'small'], outDir: 'out/batch', concurrency: 1, onProgress: (p) => events.push(p.done) });
    expect(s.total).toBe(6);
    expect(s.failed).toBe(0);
    expect(events).toEqual([1, 2, 3, 4, 5, 6]);
    expect(existsSync(path.join(root, 'out/batch/ja/header.png'))).toBe(true);
    const report = JSON.parse(readFileSync(s.reportPath!, 'utf8'));
    expect(report.items[0].renderDurationMs).toBeGreaterThan(0);
  });

  it('recovers from per-item errors and keeps going', async () => {
    const s = await runBatch({ cwd: root, data: { variants: [{ id: 'ok' }, { id: 'bad', props: { heroX: -5 } }] }, compositions: ['header'], outDir: 'out/batch-err', concurrency: 1, retries: 0 });
    expect(s.succeeded).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.items.find((i) => i.variant === 'bad')!.error).toMatch(/heroX/);
  });

  const distWorker = fileURLToPath(new URL('../dist/worker.js', import.meta.url));
  it.skipIf(!existsSync(distWorker))('runs a batch across worker threads', async () => {
    const s = await runBatch({ cwd: root, data: 'variants.json', compositions: 'all', outDir: 'out/batch-mt', concurrency: 3 });
    expect(s.failed).toBe(0);
    expect(s.total).toBe(9);
  });

  it('batch-localizes one composition', async () => {
    const r = await batchLocalize(project, { compositionId: 'header', locales: ['en', 'ja'], localizationData: { ja: { callout: '発売中' } }, outputDir: 'out/loc' });
    expect(r.status).toBe('success');
    expect(existsSync(path.join(root, 'out/loc/header.ja.png'))).toBe(true);
  });
});

describe('state store & init', () => {
  it('persists template props/overrides', async () => {
    const store = TemplateStateStore.forProject(root);
    await store.update('header', { props: { title: 'A' }, overrides: { hero: { transform: { x: 1 } } } });
    await store.update('header', { props: { callout: 'B' }, overrides: { hero: { opacity: 0.5 } } });
    const fresh = TemplateStateStore.forProject(root);
    expect(await fresh.get('header')).toMatchObject({ props: { title: 'A', callout: 'B' }, overrides: { hero: { transform: { x: 1 }, opacity: 0.5 } } });
    await fresh.reset('header');
    expect(await fresh.get('header')).toBeUndefined();
  });
  it('scaffolds a project', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ga-init-'));
    const files = await initProject({ dir, workspace: true });
    expect(files).toEqual(expect.arrayContaining(['package.json', 'artisan.config.ts', 'src/index.tsx', 'assets/hero.svg']));
    expect(await initProject({ dir })).toEqual([]);
  });
});
