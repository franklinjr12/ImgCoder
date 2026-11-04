import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import type { NodeFontOptions } from '@game-artisan/renderer-svg/node';

export type RendererChoice = 'svg' | 'chromium' | 'auto';
export type OutputFormatName = 'png' | 'jpeg' | 'webp' | 'avif' | 'svg' | 'pdf';

export interface ArtisanConfig {
  /** TSX/TS entry that calls `registerRoot()` / `registerCompositions()`. */
  entry?: string;
  /** UDM documents (`*.artisan.json`) to expose as compositions (files or directories). */
  documents?: string[];
  /** Include @game-artisan/templates-game compositions. Default: true when no entry is configured. */
  includeBuiltinTemplates?: boolean;
  outDir?: string;
  assetsDir?: string;
  fonts?: Omit<NodeFontOptions, 'bundled'> & { bundled?: boolean };
  renderer?: RendererChoice;
  defaultFormat?: OutputFormatName;
  scale?: number;
  quality?: number;
  locales?: string[];
  defaultLocale?: string;
  /** Batch worker threads (default: CPU count - 1). */
  concurrency?: number;
  /** Output path pattern for batch renders. Tokens: {variant} {locale} {composition} {scale} {format} {width} {height} */
  outputPattern?: string;
  studio?: { port?: number; host?: string };
  server?: { port?: number; host?: string; rateLimitPerMinute?: number; maxQueue?: number; concurrency?: number; apiKey?: string };
  chromium?: { executablePath?: string; poolSize?: number };
}

export interface ResolvedConfig extends ArtisanConfig {
  root: string;
  configFile?: string;
  outDir: string;
  assetsDir: string;
}

/** Identity helper giving type-safety in `artisan.config.ts`. */
export function defineConfig(config: ArtisanConfig): ArtisanConfig {
  return config;
}

let importCounter = 0;

const CONFIG_NAMES = ['artisan.config.ts', 'artisan.config.mts', 'artisan.config.tsx', 'artisan.config.js', 'artisan.config.mjs', 'artisan.config.json'];

export function findConfigFile(cwd: string): string | undefined {
  let dir = path.resolve(cwd);
  for (;;) {
    for (const n of CONFIG_NAMES) {
      const p = path.join(dir, n);
      if (existsSync(p)) return p;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Import a TS/TSX/JS module from a project. TypeScript is bundled with esbuild into
 * `<root>/.artisan/cache` (so bare imports resolve against the project's node_modules).
 */
export async function importProjectModule(file: string, root: string): Promise<any> {
  const abs = path.resolve(root, file);
  if (/\.(json)$/.test(abs)) return { default: JSON.parse(await readFile(abs, 'utf8')) };
  // Unique query → the module re-executes on every load (registerRoot side effects re-run on reload).
  if (/\.(m?js|cjs)$/.test(abs)) return import(`${pathToFileURL(abs).href}?v=${++importCounter}`);
  const cacheDir = path.join(root, '.artisan', 'cache');
  await mkdir(cacheDir, { recursive: true });
  const result = await build({
    entryPoints: [abs],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    jsx: 'automatic',
    jsxImportSource: 'react',
    packages: 'external',
    write: false,
    sourcemap: 'inline',
    logLevel: 'silent',
    loader: { '.svg': 'text', '.png': 'dataurl', '.jpg': 'dataurl', '.jpeg': 'dataurl', '.webp': 'dataurl', '.ttf': 'binary', '.otf': 'binary', '.woff2': 'binary' },
    define: { 'import.meta.dirname': JSON.stringify(path.dirname(abs)), 'import.meta.filename': JSON.stringify(abs) },
  });
  const code = result.outputFiles[0].text;
  const hash = createHash('sha1').update(abs).update(code).digest('hex').slice(0, 12);
  const out = path.join(cacheDir, `${path.basename(abs).replace(/\W+/g, '_')}-${hash}.mjs`);
  if (!existsSync(out)) await writeFile(out, code);
  return import(`${pathToFileURL(out).href}?v=${++importCounter}`);
}

export async function loadConfig(opts: { cwd?: string; configFile?: string } = {}): Promise<ResolvedConfig> {
  const cwd = path.resolve(opts.cwd ?? process.cwd());
  const configFile = opts.configFile ? path.resolve(cwd, opts.configFile) : findConfigFile(cwd);
  let config: ArtisanConfig = {};
  let root = cwd;
  if (configFile) {
    root = path.dirname(configFile);
    const mod = await importProjectModule(configFile, root);
    config = (mod.default ?? mod.config ?? mod) as ArtisanConfig;
    if (typeof config === 'function') config = await (config as any)();
  } else {
    for (const cand of ['src/index.tsx', 'src/index.ts', 'src/root.tsx', 'artisan.root.tsx']) {
      if (existsSync(path.join(cwd, cand))) {
        config.entry = cand;
        break;
      }
    }
  }
  return {
    ...config,
    root,
    configFile,
    outDir: path.resolve(root, config.outDir ?? 'out'),
    assetsDir: path.resolve(root, config.assetsDir ?? 'assets'),
  };
}
