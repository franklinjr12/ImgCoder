import { existsSync, statSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  clearRegistry,
  compositionFromDocument,
  deserializeDocument,
  describeComposition,
  getCompositions,
  getComposition,
  type CompositionDefinition,
  type CompositionInfo,
  type FontRegistry,
} from '@game-artisan/core';
import { createNodeFontRegistry, NodeAssetResolver } from '@game-artisan/renderer-svg/node';
import { importProjectModule, loadConfig, type ResolvedConfig } from './config.js';

export interface LoadProjectOptions {
  cwd?: string;
  configFile?: string;
  /** Override the entry from config. */
  entry?: string;
  /** Force-include/exclude built-in game templates. */
  builtinTemplates?: boolean;
  /** Extra document files to include. */
  documents?: string[];
}

async function collectDocumentFiles(root: string, entries: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const e of entries) {
    const abs = path.resolve(root, e);
    if (!existsSync(abs)) continue;
    if (statSync(abs).isDirectory()) {
      for (const f of await readdir(abs, { recursive: true } as any) as unknown as string[]) {
        if (String(f).endsWith('.artisan.json')) out.push(path.join(abs, String(f)));
      }
    } else out.push(abs);
  }
  return out;
}

/** A loaded GameArtisan project: config + compositions + font/asset services. */
export class ArtisanProject {
  compositions: CompositionDefinition[] = [];
  private fontsPromise: Promise<FontRegistry> | null = null;
  readonly assets: NodeAssetResolver;
  readonly warnings: string[] = [];

  private constructor(readonly config: ResolvedConfig, private opts: LoadProjectOptions) {
    this.assets = new NodeAssetResolver({ baseDir: config.root, searchDirs: [config.assetsDir, path.join(config.root, 'public')] });
  }

  static async load(opts: LoadProjectOptions = {}): Promise<ArtisanProject> {
    const config = await loadConfig({ cwd: opts.cwd, configFile: opts.configFile });
    const project = new ArtisanProject(config, opts);
    await project.reload();
    return project;
  }

  get root(): string {
    return this.config.root;
  }

  get entryFile(): string | undefined {
    const e = this.opts.entry ?? this.config.entry;
    return e ? path.resolve(this.config.root, e) : undefined;
  }

  /** (Re)load compositions from the entry, documents and built-ins. */
  async reload(): Promise<void> {
    clearRegistry();
    const defs = new Map<string, CompositionDefinition>();
    const entry = this.entryFile;
    if (entry) {
      if (!existsSync(entry)) throw new Error(`Entry file not found: ${entry}`);
      await importProjectModule(entry, this.config.root);
      for (const d of getCompositions()) defs.set(d.id, d);
    }
    const includeBuiltins = this.opts.builtinTemplates ?? this.config.includeBuiltinTemplates ?? !entry;
    if (includeBuiltins) {
      try {
        const spec = '@game-artisan/templates-game';
        const tg: any = await import(/* @vite-ignore */ spec);
        for (const d of (tg.gameCompositions ?? []) as CompositionDefinition[]) if (!defs.has(d.id)) defs.set(d.id, d);
      } catch (e) {
        this.warnings.push(`Built-in templates unavailable: ${(e as Error).message}`);
      }
    }
    const docFiles = await collectDocumentFiles(this.config.root, [...(this.config.documents ?? []), ...(this.opts.documents ?? [])]);
    for (const f of docFiles) {
      const doc = deserializeDocument(await readFile(f, 'utf8'));
      for (const ab of doc.artboards) {
        const def = compositionFromDocument(doc, { artboardId: ab.id });
        defs.set(def.id, def);
      }
    }
    this.compositions = [...defs.values()];
  }

  /** Font registry (bundled + configured project fonts + system CJK fallback), created once. */
  fonts(): Promise<FontRegistry> {
    if (!this.fontsPromise) {
      const f = this.config.fonts ?? {};
      this.fontsPromise = createNodeFontRegistry({
        ...f,
        files: (f.files ?? []).map((x) => (typeof x === 'string' ? path.resolve(this.root, x) : { ...x, path: path.resolve(this.root, x.path) })),
        dirs: (f.dirs ?? []).map((d) => path.resolve(this.root, d)),
      });
    }
    return this.fontsPromise;
  }

  list(): CompositionInfo[] {
    return this.compositions.map(describeComposition);
  }

  get(id: string): CompositionDefinition {
    return getComposition(id, this.compositions);
  }

  describe(id: string): CompositionInfo {
    return describeComposition(this.get(id));
  }

  /** Register an ad-hoc document (e.g. passed to `artisan render file.artisan.json`). */
  async addDocumentFile(file: string): Promise<CompositionDefinition[]> {
    const doc = deserializeDocument(await readFile(path.resolve(this.root, file), 'utf8'));
    const added = doc.artboards.map((ab) => compositionFromDocument(doc, { artboardId: ab.id }));
    for (const d of added) {
      this.compositions = this.compositions.filter((c) => c.id !== d.id);
      this.compositions.push(d);
    }
    return added;
  }
}
