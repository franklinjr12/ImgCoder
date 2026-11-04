import type { ViteDevServer } from 'vite';

export interface StartStudioOptions {
  /** Project root (default: cwd). `/__artisan/file` is scoped to it. */
  root?: string;
  /** Entry module (TS/TSX/JS) that calls `registerRoot()` / `registerCompositions()` from @game-artisan/core. */
  entry?: string;
  /** Directory where `.artisan.json` designs are read/written (default: `<root>/designs`). */
  documentsDir?: string;
  /** Directory listed in the asset library and watched for changes (default: `<root>/assets` if present). */
  assetsDir?: string;
  /** Extra project font files (TTF/OTF/WOFF/WOFF2/TTC) registered in the browser font registry. */
  fontFiles?: string[];
  /** Show `@game-artisan/templates-game` compositions + Studio samples. Default true. */
  includeBuiltinTemplates?: boolean;
  /** Port (default 3000; 0 = random free port). */
  port?: number;
  /** Fail instead of picking the next free port. */
  strictPort?: boolean;
  host?: string;
  /** Open the browser. Default false. */
  open?: boolean;
  logLevel?: 'info' | 'silent';
}

export interface StudioServer {
  url: string;
  port: number;
  /** Underlying Vite dev server. */
  server: ViteDevServer;
  close(): Promise<void>;
}

export declare const STUDIO_DIR: string;
export declare function startStudio(opts?: StartStudioOptions): Promise<StudioServer>;
export default startStudio;
