/**
 * Composition sources: the user's project (virtual:artisan-project → entry → registerRoot),
 * built-in game templates (virtual:artisan-builtins → @game-artisan/templates-game, guarded) and
 * the Studio samples. HMR re-registers compositions without touching the app store (which
 * keeps props/overrides per composition id).
 */
import { onRegistryChange, type CompositionDefinition, type SafeZone } from '@game-artisan/core';
import { studioSamples } from '../builtin/samples';
import { FALLBACK_STORE_PRESETS, fallbackPresetSafeZones } from '../builtin/presets';
import type { StorePresetLike } from '../editor/documents';
import { setBuiltinArtResolver } from './assets';

export interface ProjectInfo {
  hasProject: boolean;
  root: string;
  entry: string | null;
  entryMissing?: string | null;
  assetsDir: string | null;
  documentsDir: string | null;
  includeBuiltinTemplates: boolean;
  fontFiles: string[];
}

export interface CompositionEntry {
  def: CompositionDefinition;
  source: 'project' | 'builtin' | 'sample';
  folder: string;
}

export interface Sources {
  info: ProjectInfo;
  compositions: CompositionEntry[];
  presets: Record<string, StorePresetLike>;
  presetSafeZones: (spec: StorePresetLike) => SafeZone[];
  templatesGameAvailable: boolean;
  error?: string;
}

const DEFAULT_INFO: ProjectInfo = { hasProject: false, root: '', entry: null, assetsDir: null, documentsDir: null, includeBuiltinTemplates: true, fontFiles: [] };

let projectMod: any = null;
let builtinsMod: any = null;
let loadError: string | undefined;

export async function loadSources(): Promise<Sources> {
  try {
    projectMod = await import('virtual:artisan-project');
  } catch (e) {
    loadError = `Project entry failed to load: ${(e as Error).message}`;
    console.error('[studio]', e);
  }
  try {
    builtinsMod = await import('virtual:artisan-builtins');
    setBuiltinArtResolver(builtinsMod?.resolveArt ?? null);
  } catch (e) {
    console.warn('[studio] built-in templates unavailable:', (e as Error).message);
    builtinsMod = null;
  }
  return currentSources();
}

export function currentSources(): Sources {
  const info: ProjectInfo = { ...DEFAULT_INFO, ...(projectMod?.projectInfo ?? {}) };
  const out: CompositionEntry[] = [];
  const seen = new Set<string>();
  let error = loadError;
  if (projectMod?.getProjectCompositions) {
    try {
      for (const def of projectMod.getProjectCompositions() as CompositionDefinition[]) {
        if (seen.has(def.id)) continue;
        seen.add(def.id);
        out.push({ def, source: 'project', folder: def.folder ?? 'Project' });
      }
    } catch (e) {
      error = `registerRoot() threw: ${(e as Error).message}`;
    }
  }
  if (info.includeBuiltinTemplates) {
    for (const def of (builtinsMod?.gameCompositions ?? []) as CompositionDefinition[]) {
      if (!def?.id || seen.has(def.id)) continue;
      seen.add(def.id);
      out.push({ def, source: 'builtin', folder: `Built-in/${def.folder ?? def.platform ?? 'Templates'}` });
    }
    for (const def of studioSamples) {
      if (seen.has(def.id)) continue;
      seen.add(def.id);
      out.push({ def, source: 'sample', folder: def.folder ?? 'Studio Samples' });
    }
  }
  const presets = (builtinsMod?.STORE_PRESETS as Record<string, StorePresetLike> | null) ?? FALLBACK_STORE_PRESETS;
  const pz = builtinsMod?.presetSafeZones as ((s: StorePresetLike) => SafeZone[]) | null;
  return {
    info,
    compositions: out,
    presets,
    presetSafeZones: (spec) => {
      try {
        return pz ? pz(spec as any) : fallbackPresetSafeZones(spec);
      } catch {
        return fallbackPresetSafeZones(spec);
      }
    },
    templatesGameAvailable: !!builtinsMod?.available,
    error,
  };
}

/** Subscribe to project changes (HMR re-registration). */
export function onSourcesChanged(fn: (s: Sources) => void): () => void {
  let t: ReturnType<typeof setTimeout> | null = null;
  const fire = () => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(currentSources()), 30);
  };
  const offRegistry = onRegistryChange(fire);
  const onUpdated = (e: Event) => {
    const mod = (e as CustomEvent).detail;
    if (mod) {
      projectMod = mod;
      loadError = undefined;
    }
    fire();
  };
  window.addEventListener('artisan:project-updated', onUpdated);
  return () => {
    offRegistry();
    window.removeEventListener('artisan:project-updated', onUpdated);
  };
}
