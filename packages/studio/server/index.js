/**
 * Programmatic API of the GameArtisan Studio: `startStudio()` boots the Vite dev server of this
 * package (React app + `/__artisan/*` project endpoints + HMR of the user's compositions).
 * Used by `artisan studio` (CLI) and the desktop shell.
 */
import path from 'node:path';
import net from 'node:net';
import { STUDIO_DIR, resolveArtisanOptions } from './plugin.js';

/** Ask the OS for a free TCP port (used for `port: 0`). */
function freePort(host) {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, host, () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

export { STUDIO_DIR };

/**
 * @param {import('./index').StartStudioOptions} [opts]
 * @returns {Promise<import('./index').StudioServer>}
 */
export async function startStudio(opts = {}) {
  const { createServer } = await import('vite');
  const artisan = {
    root: opts.root,
    entry: opts.entry,
    documentsDir: opts.documentsDir,
    assetsDir: opts.assetsDir,
    fontFiles: opts.fontFiles,
    includeBuiltinTemplates: opts.includeBuiltinTemplates,
  };
  const resolved = resolveArtisanOptions(artisan);
  const host = opts.host ?? 'localhost';
  const wantPort = opts.port === 0 ? await freePort(host === 'localhost' ? undefined : host) : (opts.port ?? 3000);
  const server = await createServer(
    /** @type {any} */ ({
      configFile: path.join(STUDIO_DIR, 'vite.config.ts'),
      root: STUDIO_DIR,
      logLevel: opts.logLevel === 'silent' ? 'silent' : 'info',
      clearScreen: false,
      // separate optimizer cache per project root to avoid clashes between concurrent studios
      cacheDir: path.join(STUDIO_DIR, 'node_modules/.vite'),
      server: {
        port: wantPort,
        strictPort: opts.port === 0 ? false : !!opts.strictPort,
        host,
        open: opts.open ?? false,
      },
      artisan,
    }),
  );
  await server.listen();
  const addr = server.httpServer?.address();
  const port = addr && typeof addr === 'object' ? addr.port : wantPort;
  const displayHost = host === '0.0.0.0' || host === '::' || host === true ? 'localhost' : host;
  const url = `http://${displayHost}:${port}/`;
  if (opts.logLevel !== 'silent') {
    console.log(`\n  GameArtisan Studio  ${url}`);
    if (resolved.entry) console.log(`  entry      ${path.relative(process.cwd(), resolved.entry) || resolved.entry}`);
    if (resolved.assetsDir) console.log(`  assets     ${path.relative(process.cwd(), resolved.assetsDir) || '.'}`);
    if (resolved.documentsDir) console.log(`  documents  ${path.relative(process.cwd(), resolved.documentsDir) || '.'}`);
    console.log('');
  }
  let closed = false;
  return {
    url,
    port,
    server,
    async close() {
      if (closed) return;
      closed = true;
      await server.close();
    },
  };
}

export default startStudio;
