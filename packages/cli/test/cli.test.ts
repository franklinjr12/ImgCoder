import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { run } from '@game-artisan/cli';

const root = fileURLToPath(new URL('../../runtime/test/fixtures/project/', import.meta.url));

async function cli(...args: string[]) {
  let out = '';
  let err = '';
  const prev = process.exitCode;
  const code = await run(['node', 'artisan', '-C', root, ...args], { out: (s) => (out += s + '\n'), err: (s) => (err += s + '\n') });
  process.exitCode = prev;
  return { code, out, err };
}

describe('artisan CLI', () => {
  it('list prints a table and --json', async () => {
    const t = await cli('list');
    expect(t.code).toBe(0);
    expect(t.out).toMatch(/header\s+460×215/);
    const j = await cli('list', '--json');
    expect(JSON.parse(j.out).map((c: any) => c.id)).toContain('promo-banner');
  });

  it('inspect outputs the props JSON Schema', async () => {
    const r = await cli('inspect', 'header');
    const schema = JSON.parse(r.out);
    expect(schema.properties.title.type).toBe('string');
    expect(JSON.parse((await cli('inspect', 'header', '--full')).out).width).toBe(460);
  });

  it("render --props='{...}' --out=… (spec syntax)", async () => {
    const r = await cli('render', 'header', '--props={"title":"FROM CLI"}', '--out=out/cli/header.png', '--scale=2', '--json');
    expect(r.code).toBe(0);
    const res = JSON.parse(r.out);
    expect(res.dimensions).toEqual({ width: 920, height: 430 });
    expect(existsSync(res.outputPath)).toBe(true);
    const jpg = await cli('render', 'small', '-o', 'out/cli/small.jpg');
    expect(jpg.out).toMatch(/small\.jpg\s+231×87 jpeg/);
  });

  it('renders a document file directly and reads props from a file', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ga-cli-'));
    const propsFile = path.join(dir, 'p.json');
    writeFileSync(propsFile, JSON.stringify({ headline: 'FILE PROPS' }));
    const r = await cli('render', 'designs/banner.artisan.json', '--props', `@${propsFile}`, '--format', 'svg', '--svg-text', 'embedded', '--json');
    expect(r.code).toBe(0);
    expect(readFileSync(JSON.parse(r.out).outputPath, 'utf8')).toContain('FILE PROPS');
  });

  it('fails with actionable prop errors and suggestions', async () => {
    const bad = await cli('render', 'header', '--props={"heroX":"left"}');
    expect(bad.code).toBe(1);
    expect(bad.err).toMatch(/heroX/);
    expect(bad.err).toMatch(/artisan inspect header/);
    const missing = await cli('render', 'headr');
    expect(missing.err).toMatch(/Did you mean: header/);
  });

  it('batch renders the variant matrix', async () => {
    const r = await cli('batch', '--data=variants.json', '--compositions=header,small', '--out=out/cli-batch', '-j', '1', '--json');
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out).succeeded).toBe(6);
  });

  it('validate / schema / init', async () => {
    expect((await cli('validate', 'designs/banner.artisan.json')).out).toMatch(/valid: Promo Banner/);
    expect(JSON.parse((await cli('schema', 'layer')).out).$schema).toBeTruthy();
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ga-cli-init-'));
    const r = await run(['node', 'artisan', 'init', dir, '--workspace'], { out: () => {}, err: () => {} });
    expect(r).toBe(0);
    expect(existsSync(path.join(dir, 'src/index.tsx'))).toBe(true);
  });

  it('agent:matrix with the offline heuristic provider renders a contact sheet', async () => {
    const r = await cli('agent:matrix', 'header', '--provider', 'heuristic', '-g', 'emphasize the character', '-g', 'emphasize the action screenshot', '-n', '2', '-o', 'out/matrix');
    expect(r.code).toBe(0);
    expect(existsSync(path.join(root, 'out/matrix/contact-sheet.png'))).toBe(true);
    const report = JSON.parse(readFileSync(path.join(root, 'out/matrix/variants.json'), 'utf8'));
    expect(report.variants).toHaveLength(4);
  });
});
