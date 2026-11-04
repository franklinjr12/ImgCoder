/// <reference types="vite/client" />

declare module 'virtual:artisan-project' {
  import type { CompositionDefinition } from '@game-artisan/core';
  export const projectInfo: import('./runtime/project').ProjectInfo;
  export const version: number;
  export function getProjectCompositions(): CompositionDefinition[];
}

declare module 'virtual:artisan-builtins' {
  import type { CompositionDefinition, SafeZone } from '@game-artisan/core';
  export const available: boolean;
  export const gameCompositions: CompositionDefinition[];
  export const STORE_PRESETS: Record<string, import('./editor/documents').StorePresetLike> | null;
  export const presetSafeZones: ((spec: any) => SafeZone[]) | null;
  export const resolveArt: ((src: string) => string | undefined) | null;
}
