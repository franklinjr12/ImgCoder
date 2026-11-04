/**
 * Persistent per-template working state (props + overrides) shared by the MCP server, REST
 * server and Studio: `.artisan/state.json` in the project root.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { mergeOverrides, type LayerOverrides } from '@game-artisan/core';

export interface TemplateState {
  props: Record<string, unknown>;
  overrides?: LayerOverrides;
  updatedAt: string;
}

export class TemplateStateStore {
  private cache: Record<string, TemplateState> | null = null;
  constructor(readonly file: string) {}

  static forProject(root: string): TemplateStateStore {
    return new TemplateStateStore(path.join(root, '.artisan', 'state.json'));
  }

  private async load(): Promise<Record<string, TemplateState>> {
    if (this.cache) return this.cache;
    this.cache = existsSync(this.file) ? JSON.parse(await readFile(this.file, 'utf8')) : {};
    return this.cache!;
  }

  async get(id: string): Promise<TemplateState | undefined> {
    return (await this.load())[id];
  }

  async update(id: string, patch: { props?: Record<string, unknown>; overrides?: LayerOverrides; replace?: boolean }): Promise<TemplateState> {
    const all = await this.load();
    const prev = all[id];
    const next: TemplateState = {
      props: patch.replace ? { ...(patch.props ?? {}) } : { ...(prev?.props ?? {}), ...(patch.props ?? {}) },
      overrides: patch.replace ? patch.overrides : mergeOverrides(prev?.overrides, patch.overrides),
      updatedAt: new Date().toISOString(),
    };
    all[id] = next;
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(all, null, 2));
    return next;
  }

  async reset(id: string): Promise<void> {
    const all = await this.load();
    delete all[id];
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(all, null, 2));
  }
}
