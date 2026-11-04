/**
 * Vite plugin powering the GameArtisan Studio dev server:
 *   • `virtual:artisan-project`  — imports the user's entry (which calls core `registerRoot`) + project info, HMR-aware
 *   • `virtual:artisan-builtins` — built-in game templates / store presets (guarded: works without templates-game)
 *   • `/__artisan/*` middleware  — project files, asset listing, documents, fonts
 *   • assets watcher             — pushes `artisan:assets-changed` HMR events so the canvas reloads changed files
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const STUDIO_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const MONOREPO_ROOT = path.resolve(STUDIO_DIR, '../..');

const PROJECT_ID = 'virtual:artisan-project';
const BUILTINS_ID = 'virtual:artisan-builtins';
const RESOLVED_PROJECT_ID = '\0' + PROJECT_ID;
const RESOLVED_BUILTINS_ID = '\0' + BUILTINS_ID;

const toPosix = (p) => p.split(path.sep).join('/');

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp',
  svg: 'image/svg+xml', json: 'application/json', ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2', ttc: 'font/collection',
  txt: 'text/plain', md: 'text/markdown',
};
const mimeOf = (file) => MIME[path.extname(file).slice(1).toLowerCase()] ?? 'application/octet-stream';
const ASSET_EXT = /\.(png|jpe?g|webp|gif|avif|bmp|svg)$/i;
const FONT_EXT = /\.(ttf|otf|woff2?|ttc)$/i;

/** `@game-artisan/*` → workspace sources (no build needed in the monorepo). Only for files that exist. */
export function workspaceAliases() {
  const p = (rel) => path.join(MONOREPO_ROOT, 'packages', rel);
  const candidates = [
    [/^@game-artisan\/core$/, [p('core/src/index.ts')]],
    [/^@game-artisan\/renderer-svg$/, [p('renderer-svg/src/index.ts')]],
    [/^@game-artisan\/templates-game$/, [p('templates-game/src/index.tsx'), p('templates-game/src/index.ts')]],
  ];
  const out = [];
  for (const [find, files] of candidates) {
    const hit = files.find((f) => fs.existsSync(f));
    if (hit) out.push({ find, replacement: hit });
  }
  return out;
}

/** Is @game-artisan/templates-game importable (workspace source or built package)? */
function templatesGameAvailable() {
  if (workspaceAliases().some((a) => String(a.find).includes('templates-game'))) return true;
  try {
    const url = import.meta.resolve('@game-artisan/templates-game');
    return fs.existsSync(fileURLToPath(url));
  } catch {
    return false;
  }
}

/**
 * @typedef {{ root?: string; entry?: string; documentsDir?: string; assetsDir?: string; fontFiles?: string[]; includeBuiltinTemplates?: boolean }} ArtisanPluginOptions
 */

/** Normalise user options into absolute paths. */
export function resolveArtisanOptions(opts = {}) {
  const hasProject = !!(opts.root || opts.entry || opts.assetsDir || opts.documentsDir);
  const root = path.resolve(opts.root ?? process.cwd());
  const abs = (p) => (p ? path.resolve(root, p) : undefined);
  let assetsDir = abs(opts.assetsDir);
  if (!assetsDir && hasProject && fs.existsSync(path.join(root, 'assets'))) assetsDir = path.join(root, 'assets');
  let documentsDir = abs(opts.documentsDir);
  if (!documentsDir && hasProject) documentsDir = path.join(root, 'designs');
  return {
    hasProject,
    root,
    entry: abs(opts.entry),
    assetsDir,
    documentsDir,
    fontFiles: (opts.fontFiles ?? []).map((f) => path.resolve(root, f)),
    includeBuiltinTemplates: opts.includeBuiltinTemplates !== false,
  };
}

async function listFilesRecursive(dir, filter, depth = 0, out = []) {
  if (depth > 12) return out;
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await listFilesRecursive(p, filter, depth + 1, out);
    else if (!filter || filter.test(e.name)) out.push(p);
  }
  return out;
}

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readBody(req, limit = 64 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const CATEGORY_HINTS = [
  ['Backgrounds', /(^|\/)(backgrounds?|bg|screenshots?|key-?art|environments?)(\/|$)/i],
  ['Characters', /(^|\/)(characters?|heroes|sprites?|cutouts?)(\/|$)/i],
  ['Logos', /(^|\/)(logos?|titles?|branding)(\/|$)/i],
  ['Badges', /(^|\/)(badges?|laurels?|awards?|ratings?)(\/|$)/i],
  ['Overlays', /(^|\/)(overlays?|fx|textures?|patterns?)(\/|$)/i],
];
function guessCategory(rel) {
  for (const [cat, re] of CATEGORY_HINTS) if (re.test(rel)) return cat;
  return undefined;
}

/** Minimal CJK system-font discovery (fallback when renderer-svg/node cannot be loaded). */
async function scanSystemCjkFonts() {
  const os = await import('node:os');
  const home = os.homedir();
  const dirs =
    process.platform === 'darwin'
      ? ['/System/Library/Fonts', '/Library/Fonts', path.join(home, 'Library/Fonts')]
      : process.platform === 'win32'
        ? [path.join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts')]
        : ['/usr/share/fonts', '/usr/local/share/fonts', path.join(home, '.fonts'), path.join(home, '.local/share/fonts')];
  const re = /(cjk|noto\s?sans\s?(sc|tc|jp|kr|hk)|wqy|wenquanyi|source\s?han|droid\s?sans\s?fallback|ms\s?gothic|meiryo|yu\s?gothic|simhei|simsun|msyh|malgun|pingfang|hiragino|nanum|ipa|takao|vl\s?gothic)/i;
  const out = [];
  for (const d of dirs) for (const f of await listFilesRecursive(d, FONT_EXT)) if (re.test(path.basename(f))) out.push(f);
  return out;
}

function localesForFont(name) {
  const n = name.toLowerCase();
  if (/(sc|zh[-_]?cn|simhei|simsun|msyh|wqy|wenquanyi|hans)/.test(n)) return ['zh-CN', 'zh'];
  if (/(tc|hk|zh[-_]?tw|hant)/.test(n)) return ['zh-TW', 'zh-HK'];
  if (/(jp|ja|gothic|meiryo|hiragino|ipa|takao|mincho)/.test(n)) return ['ja'];
  if (/(kr|ko|malgun|nanum)/.test(n)) return ['ko'];
  return undefined;
}

/**
 * @param {ArtisanPluginOptions} [initial]
 * @returns {import('vite').Plugin}
 */
export function artisanStudioPlugin(initial) {
  /** @type {ReturnType<typeof resolveArtisanOptions>} */
  let opts = resolveArtisanOptions(initial ?? {});
  /** @type {{ path: string; kind: 'project' | 'system-cjk' }[] | null} */
  let fontList = null;
  /** @type {import('vite').ViteDevServer | null} */
  let devServer = null;

  async function getFonts() {
    if (fontList) return fontList;
    const list = opts.fontFiles.filter((f) => fs.existsSync(f)).map((p) => ({ path: p, kind: /** @type {const} */ ('project') }));
    let sys = [];
    try {
      let mod;
      try {
        mod = await import('@game-artisan/renderer-svg/node');
      } catch {
        const src = path.join(MONOREPO_ROOT, 'packages/renderer-svg/src/node-fonts.ts');
        if (devServer && fs.existsSync(src)) mod = await devServer.ssrLoadModule(src);
      }
      if (mod?.findSystemFonts) {
        const CJK = /(cjk|noto\s?sans\s?(sc|tc|jp|kr|hk)|noto\s?serif\s?(sc|tc|jp|kr)|wqy|wenquanyi|source\s?han|droid\s?sans\s?fallback|ms\s?gothic|meiryo|yu\s?gothic|simhei|simsun|msyh|malgun|pingfang|hiragino|apple\s?sd\s?gothic|nanum|ipa|takao|vl\s?gothic)/i;
        sys = await mod.findSystemFonts(CJK);
      } else sys = await scanSystemCjkFonts();
    } catch {
      sys = await scanSystemCjkFonts().catch(() => []);
    }
    for (const p of sys) list.push({ path: p, kind: 'system-cjk' });
    fontList = list;
    return list;
  }

  function projectInfo() {
    return {
      hasProject: opts.hasProject,
      root: opts.root,
      entry: opts.entry ? toPosix(path.relative(opts.root, opts.entry)) : null,
      assetsDir: opts.assetsDir ? toPosix(path.relative(opts.root, opts.assetsDir)) || '.' : null,
      documentsDir: opts.documentsDir ? toPosix(path.relative(opts.root, opts.documentsDir)) || '.' : null,
      includeBuiltinTemplates: opts.includeBuiltinTemplates,
      fontFiles: opts.fontFiles.map((f) => path.basename(f)),
    };
  }

  /** @type {import('connect').NextHandleFunction} */
  async function middleware(req, res, next) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = url.pathname.replace(/^\/+/, '');
    try {
      if (route === 'info' && req.method === 'GET') return sendJson(res, 200, projectInfo());

      if (route === 'file' && (req.method === 'GET' || req.method === 'HEAD')) {
        const rel = url.searchParams.get('path') ?? '';
        if (!rel || rel.includes('\0')) return sendJson(res, 400, { error: 'path required' });
        const abs = path.resolve(opts.root, rel);
        const allowed = isInside(opts.root, abs) || (opts.assetsDir && isInside(opts.assetsDir, abs)) || (opts.documentsDir && isInside(opts.documentsDir, abs));
        if (!allowed) return sendJson(res, 403, { error: 'Path outside project root' });
        let st;
        try {
          st = await fsp.stat(abs);
        } catch {
          return sendJson(res, 404, { error: `Not found: ${rel}` });
        }
        if (!st.isFile()) return sendJson(res, 404, { error: `Not a file: ${rel}` });
        res.statusCode = 200;
        res.setHeader('Content-Type', mimeOf(abs));
        res.setHeader('Content-Length', String(st.size));
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Last-Modified', st.mtime.toUTCString());
        if (req.method === 'HEAD') return res.end();
        fs.createReadStream(abs).pipe(res);
        return;
      }

      if (route === 'assets' && req.method === 'GET') {
        if (!opts.assetsDir) return sendJson(res, 200, { dir: null, files: [] });
        const files = await listFilesRecursive(opts.assetsDir, ASSET_EXT);
        const out = await Promise.all(
          files.map(async (f) => {
            const st = await fsp.stat(f);
            const rel = toPosix(path.relative(opts.root, f));
            return { path: rel, name: path.basename(f), size: st.size, mtime: st.mtimeMs, mime: mimeOf(f), category: guessCategory(toPosix(path.relative(opts.assetsDir, f))) };
          }),
        );
        out.sort((a, b) => a.path.localeCompare(b.path));
        return sendJson(res, 200, { dir: toPosix(path.relative(opts.root, opts.assetsDir)) || '.', files: out });
      }

      if (route === 'documents' && req.method === 'GET') {
        if (!opts.documentsDir) return sendJson(res, 200, { dir: null, documents: [] });
        const files = (await listFilesRecursive(opts.documentsDir, /\.artisan\.json$/i)).filter((f) => path.dirname(f) === opts.documentsDir);
        const docs = await Promise.all(
          files.map(async (f) => {
            const st = await fsp.stat(f);
            let name = path.basename(f).replace(/\.artisan\.json$/i, '');
            let id;
            try {
              const j = JSON.parse(await fsp.readFile(f, 'utf8'));
              name = j.name ?? name;
              id = j.id;
            } catch {
              /* ignore */
            }
            return { file: path.basename(f), name, id, size: st.size, mtime: st.mtimeMs };
          }),
        );
        return sendJson(res, 200, { dir: toPosix(path.relative(opts.root, opts.documentsDir)) || '.', documents: docs });
      }

      const docMatch = /^documents\/([^/]+)$/.exec(route);
      if (docMatch) {
        if (!opts.documentsDir) return sendJson(res, 404, { error: 'No documentsDir configured' });
        let name = path.basename(decodeURIComponent(docMatch[1]));
        if (!/^[\w .()-]+$/.test(name)) return sendJson(res, 400, { error: 'Invalid document name' });
        if (!name.endsWith('.artisan.json')) name += '.artisan.json';
        const file = path.join(opts.documentsDir, name);
        if (req.method === 'GET') {
          if (!fs.existsSync(file)) return sendJson(res, 404, { error: `Document not found: ${name}` });
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          return res.end(await fsp.readFile(file));
        }
        if (req.method === 'PUT' || req.method === 'POST') {
          const body = (await readBody(req)).toString('utf8');
          try {
            const parsed = JSON.parse(body);
            if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.artboards)) throw new Error('Not an artisan document (missing artboards)');
          } catch (e) {
            return sendJson(res, 400, { error: `Invalid document: ${/** @type {Error} */ (e).message}` });
          }
          await fsp.mkdir(opts.documentsDir, { recursive: true });
          await fsp.writeFile(file, body.endsWith('\n') ? body : body + '\n');
          return sendJson(res, 200, { ok: true, file: name, path: toPosix(path.relative(opts.root, file)) });
        }
      }

      if (route === 'fonts' && req.method === 'GET') {
        const list = await getFonts();
        return sendJson(
          res,
          200,
          list.map((f, i) => ({ id: i, url: `/__artisan/font/${i}/${encodeURIComponent(path.basename(f.path))}`, name: path.basename(f.path), kind: f.kind, fallback: f.kind === 'system-cjk', locales: f.kind === 'system-cjk' ? localesForFont(path.basename(f.path)) : undefined })),
        );
      }

      const fontMatch = /^font\/(\d+)(?:\/.*)?$/.exec(route);
      if (fontMatch && req.method === 'GET') {
        const list = await getFonts();
        const f = list[Number(fontMatch[1])];
        if (!f) return sendJson(res, 404, { error: 'Unknown font' });
        res.setHeader('Content-Type', mimeOf(f.path));
        res.setHeader('Cache-Control', 'max-age=3600');
        fs.createReadStream(f.path).pipe(res);
        return;
      }
    } catch (e) {
      return sendJson(res, 500, { error: /** @type {Error} */ (e).message });
    }
    next();
  }

  return {
    name: 'game-artisan-studio',
    enforce: 'pre',
    config(userConfig) {
      const fromInline = /** @type {any} */ (userConfig).artisan;
      if (fromInline) opts = resolveArtisanOptions(fromInline);
      const allow = [STUDIO_DIR, MONOREPO_ROOT, opts.root];
      if (opts.assetsDir) allow.push(opts.assetsDir);
      if (opts.entry) allow.push(path.dirname(opts.entry));
      return { server: { fs: { allow } } };
    },
    resolveId(id) {
      if (id === PROJECT_ID) return RESOLVED_PROJECT_ID;
      if (id === BUILTINS_ID) return RESOLVED_BUILTINS_ID;
      return null;
    },
    load(id) {
      if (id === RESOLVED_PROJECT_ID) {
        const entryImport = opts.entry && fs.existsSync(opts.entry) ? `import ${JSON.stringify(toPosix(opts.entry))};\n` : '';
        const missing = opts.entry && !fs.existsSync(opts.entry) ? opts.entry : null;
        return [
          `import { getCompositions } from '@game-artisan/core';`,
          entryImport,
          `export const projectInfo = ${JSON.stringify({ ...projectInfo(), entryMissing: missing })};`,
          `export const version = ${Date.now()};`,
          `export function getProjectCompositions() { return getCompositions(); }`,
          // Self-accepting boundary: when the entry (or anything it imports) changes, this module
          // re-executes, the entry calls registerRoot() again and the Studio re-reads the registry
          // while keeping its per-composition props/overrides state.
          `if (import.meta.hot) {`,
          `  import.meta.hot.accept((mod) => { if (mod) window.dispatchEvent(new CustomEvent('artisan:project-updated', { detail: mod })); });`,
          `}`,
        ].join('\n');
      }
      if (id === RESOLVED_BUILTINS_ID) {
        if (opts.includeBuiltinTemplates && templatesGameAvailable()) {
          return [
            `import * as tg from '@game-artisan/templates-game';`,
            `export const available = true;`,
            `const list = Array.isArray(tg.gameCompositions) ? tg.gameCompositions : (typeof tg.gameCompositions === 'function' ? tg.gameCompositions() : []);`,
            `export const gameCompositions = list;`,
            `export const STORE_PRESETS = tg.STORE_PRESETS ?? null;`,
            `export const presetSafeZones = typeof tg.presetSafeZones === 'function' ? tg.presetSafeZones : null;`,
            `export const resolveArt = typeof tg.resolveArt === 'function' ? tg.resolveArt : null;`,
          ].join('\n');
        }
        if (templatesGameAvailable()) {
          // Built-in templates disabled, but presets are still useful for "new design".
          return [
            `import * as tg from '@game-artisan/templates-game';`,
            `export const available = true;`,
            `export const gameCompositions = [];`,
            `export const STORE_PRESETS = tg.STORE_PRESETS ?? null;`,
            `export const presetSafeZones = typeof tg.presetSafeZones === 'function' ? tg.presetSafeZones : null;`,
            `export const resolveArt = typeof tg.resolveArt === 'function' ? tg.resolveArt : null;`,
          ].join('\n');
        }
        return `export const available = false; export const gameCompositions = []; export const STORE_PRESETS = null; export const presetSafeZones = null; export const resolveArt = null;`;
      }
      return null;
    },
    configureServer(server) {
      devServer = server;
      server.middlewares.use('/__artisan', middleware);
      const send = (event, data) => {
        try {
          server.ws.send({ type: 'custom', event, data });
        } catch {
          /* ignore */
        }
      };
      const watchDirs = [];
      if (opts.assetsDir) watchDirs.push(opts.assetsDir);
      if (opts.documentsDir) watchDirs.push(opts.documentsDir);
      if (opts.entry) watchDirs.push(path.dirname(opts.entry));
      if (watchDirs.length) server.watcher.add(watchDirs);
      let pending = new Set();
      let timer = null;
      const onFs = (kind) => (file) => {
        if (opts.assetsDir && isInside(opts.assetsDir, file) && ASSET_EXT.test(file)) {
          pending.add(`${kind}:${toPosix(path.relative(opts.root, file))}`);
          clearTimeout(timer);
          timer = setTimeout(() => {
            const changes = [...pending].map((s) => ({ kind: s.slice(0, s.indexOf(':')), path: s.slice(s.indexOf(':') + 1) }));
            pending = new Set();
            send('artisan:assets-changed', { changes, paths: changes.map((c) => c.path), at: Date.now() });
          }, 60);
        }
        if (opts.documentsDir && isInside(opts.documentsDir, file) && /\.artisan\.json$/i.test(file)) {
          send('artisan:documents-changed', { kind, file: path.basename(file) });
        }
      };
      server.watcher.on('add', onFs('add'));
      server.watcher.on('change', onFs('change'));
      server.watcher.on('unlink', onFs('unlink'));
    },
  };
}

export { pathToFileURL };
