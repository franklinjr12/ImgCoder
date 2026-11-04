/**
 * Remotion-style composition registry. Compositions are declared with `<Composition />`
 * elements inside a root registered via `registerRoot()`, or programmatically with
 * `defineComposition()`. CLI, Studio and the MCP server all read the same registry.
 */
import { z } from 'zod';
import type { ArtisanDocument, Artboard, Fill, SafeZone } from '../udm/schema.js';
import { DocumentSchema } from '../udm/schema.js';
import { resolveDocumentVariables } from '../udm/variables.js';
import { ARTISAN_KIND } from '../jsx/components.js';
import { compileElement, type CompileEnv } from '../jsx/compile.js';
import { PropsValidationError, splitMetaProps, toJsonSchema, zodIssuesToPropIssues } from './props.js';
import { applyOverrides, type LayerOverrides } from './overrides.js';

export type CompositionKind = 'vector' | 'html';

export interface CompositionDefinition<Props extends Record<string, any> = any> {
  id: string;
  name?: string;
  description?: string;
  width: number;
  height: number;
  /** Template component (JSX). Either this or `document` is required. */
  component?: (props: Props) => unknown;
  /** UDM document template (Studio-authored designs with `$prop` bindings). */
  document?: ArtisanDocument;
  artboardId?: string;
  schema?: z.ZodType<Props, any>;
  defaultProps?: Partial<Props>;
  /** vector (default): UDM pipeline (resvg). html: arbitrary DOM/CSS/WebGL rendered in Chromium. */
  kind?: CompositionKind;
  /** Store preset id (see @game-artisan/templates-game STORE_PRESETS). */
  preset?: string;
  platform?: string;
  tags?: string[];
  folder?: string;
  background?: Fill;
  safeZones?: SafeZone[];
  /** Preferred export format for the target store. */
  defaultFormat?: 'png' | 'jpeg' | 'webp' | 'svg' | 'pdf';
  maxFileSizeBytes?: number;
  /** For kind = 'html': extra HTML injected in <head> (fonts, scripts) */
  head?: string;
  /** For kind = 'html': JS executed in page before capture; may return a Promise. */
  script?: string;
}

export interface CompositionInfo {
  id: string;
  name: string;
  description?: string;
  width: number;
  height: number;
  kind: CompositionKind;
  preset?: string;
  platform?: string;
  tags: string[];
  folder?: string;
  defaultFormat?: string;
  propsSchema: Record<string, unknown>;
  defaultProps: Record<string, unknown>;
  safeZones: SafeZone[];
  source: 'component' | 'document';
}

// ---------------------------------------------------------------------------------------
// JSX declarations

export type CompositionElementProps<P extends Record<string, any>> = Omit<CompositionDefinition<P>, 'folder'>;

/** Declarative composition marker: `<Composition id="steam-header" width={460} height={215} component={X} schema={S} defaultProps={...} />` */
export function Composition<P extends Record<string, any>>(_props: CompositionElementProps<P>): null {
  return null;
}
(Composition as any)[ARTISAN_KIND] = 'composition';

/** Groups compositions in the Studio sidebar: `<Folder name="Steam">...</Folder>` */
export function Folder(_props: { name: string; children?: unknown }): null {
  return null;
}
(Folder as any)[ARTISAN_KIND] = 'folder';

export function defineComposition<P extends Record<string, any>>(def: CompositionDefinition<P>): CompositionDefinition<P> {
  if (!def.id || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(def.id)) throw new Error(`Invalid composition id "${def.id}" (use letters, digits, - _ .)`);
  if (!def.component && !def.document) throw new Error(`Composition "${def.id}" needs a component or a document`);
  if (!(def.width > 0 && def.height > 0)) throw new Error(`Composition "${def.id}" needs positive width/height`);
  return def;
}

/** Wrap a UDM document (e.g. exported from the Studio) as a composition. */
export function compositionFromDocument(doc: ArtisanDocument, opts: { id?: string; artboardId?: string } = {}): CompositionDefinition {
  const artboard = opts.artboardId ? doc.artboards.find((a) => a.id === opts.artboardId) : doc.artboards[0];
  if (!artboard) throw new Error(`Artboard ${opts.artboardId} not found`);
  return defineComposition({
    id: opts.id ?? (doc.artboards.length > 1 ? `${doc.id}.${artboard.id}` : doc.id),
    name: doc.artboards.length > 1 ? `${doc.name} / ${artboard.name ?? artboard.id}` : doc.name,
    description: doc.description,
    width: artboard.width,
    height: artboard.height,
    document: doc,
    artboardId: artboard.id,
    defaultProps: (doc.props?.defaults ?? {}) as any,
    preset: artboard.preset,
    safeZones: artboard.safeZones,
  });
}

function isElement(v: any): v is { type: any; props: any } {
  return !!v && typeof v === 'object' && 'type' in v && 'props' in v;
}

/** Walk a root element tree and collect composition declarations. */
export function collectCompositions(node: unknown, folder?: string, out: CompositionDefinition[] = []): CompositionDefinition[] {
  if (node == null || typeof node === 'boolean') return out;
  if (Array.isArray(node)) {
    node.forEach((n) => collectCompositions(n, folder, out));
    return out;
  }
  if (!isElement(node)) {
    if (node && typeof node === 'object' && 'id' in (node as any) && 'width' in (node as any)) out.push({ folder, ...(node as any) });
    return out;
  }
  const kind = typeof node.type === 'function' ? (node.type as any)[ARTISAN_KIND] : undefined;
  if (kind === 'composition') {
    const { children, ...def } = node.props;
    out.push(defineComposition({ ...def, folder }));
    return out;
  }
  if (kind === 'folder') {
    const name = folder ? `${folder}/${node.props.name}` : node.props.name;
    return collectCompositions(node.props.children, name, out);
  }
  if (typeof node.type === 'function') return collectCompositions((node.type as any)(node.props), folder, out);
  return collectCompositions(node.props?.children, folder, out);
}

// ---------------------------------------------------------------------------------------
// Registry

export type RootComponent = () => unknown;

const REG_KEY = Symbol.for('game-artisan.registry');

interface GlobalRegistry {
  roots: RootComponent[];
  definitions: Map<string, CompositionDefinition>;
  listeners: Set<() => void>;
}

function globalRegistry(): GlobalRegistry {
  const g = globalThis as any;
  if (!g[REG_KEY]) g[REG_KEY] = { roots: [], definitions: new Map(), listeners: new Set() };
  return g[REG_KEY];
}

/** Register the project root (Remotion-style). Calling again replaces the root (HMR friendly). */
export function registerRoot(root: RootComponent): void {
  const reg = globalRegistry();
  reg.roots = [root];
  reg.listeners.forEach((l) => l());
}

/** Register additional compositions programmatically. */
export function registerCompositions(...defs: (CompositionDefinition | CompositionDefinition[])[]): void {
  const reg = globalRegistry();
  for (const d of defs.flat()) reg.definitions.set(d.id, defineComposition(d));
  reg.listeners.forEach((l) => l());
}

export function clearRegistry(): void {
  const reg = globalRegistry();
  reg.roots = [];
  reg.definitions.clear();
  reg.listeners.forEach((l) => l());
}

export function onRegistryChange(listener: () => void): () => void {
  const reg = globalRegistry();
  reg.listeners.add(listener);
  return () => reg.listeners.delete(listener);
}

/** All registered compositions (root-declared + programmatic), de-duplicated by id. */
export function getCompositions(): CompositionDefinition[] {
  const reg = globalRegistry();
  const out = new Map<string, CompositionDefinition>();
  for (const root of reg.roots) for (const d of collectCompositions(root())) out.set(d.id, d);
  for (const d of reg.definitions.values()) out.set(d.id, d);
  return [...out.values()];
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

export function getComposition(id: string, list: CompositionDefinition[] = getCompositions()): CompositionDefinition {
  const c = list.find((d) => d.id === id);
  if (!c) {
    const near = list
      .map((d) => ({ id: d.id, d: editDistance(d.id, id) }))
      .filter((x) => x.d <= Math.max(2, Math.floor(id.length / 3)) || x.id.includes(id) || id.includes(x.id))
      .sort((a, b) => a.d - b.d)
      .slice(0, 5)
      .map((x) => x.id);
    throw new Error(`Composition "${id}" not found.${near.length ? ` Did you mean: ${near.join(', ')}?` : ''} Available: ${list.map((d) => d.id).join(', ') || '(none)'}`);
  }
  return c;
}

export function describeComposition(def: CompositionDefinition): CompositionInfo {
  let propsSchema: Record<string, unknown>;
  if (def.schema) propsSchema = toJsonSchema(def.schema);
  else if (def.document?.props?.schema) propsSchema = def.document.props.schema as Record<string, unknown>;
  else propsSchema = { type: 'object', properties: {}, additionalProperties: true };
  return {
    id: def.id,
    name: def.name ?? def.id,
    description: def.description,
    width: def.width,
    height: def.height,
    kind: def.kind ?? 'vector',
    preset: def.preset,
    platform: def.platform,
    tags: def.tags ?? [],
    folder: def.folder,
    defaultFormat: def.defaultFormat,
    propsSchema,
    defaultProps: { ...(def.document?.props?.defaults ?? {}), ...(def.defaultProps ?? {}) },
    safeZones: def.safeZones ?? [],
    source: def.component ? 'component' : 'document',
  };
}

/** Merge defaults + input and validate with the composition's Zod schema. */
export function resolveProps<P extends Record<string, any>>(def: CompositionDefinition<P>, input: Record<string, unknown> = {}): P {
  const { props } = splitMetaProps(input);
  const merged = { ...(def.document?.props?.defaults ?? {}), ...(def.defaultProps ?? {}), ...props };
  if (!def.schema) return merged as P;
  const r = def.schema.safeParse(merged);
  if (!r.success) throw new PropsValidationError(def.id, zodIssuesToPropIssues(r.error, merged), toJsonSchema(def.schema));
  return r.data;
}

export interface CompileCompositionOptions extends Omit<CompileEnv, 'width' | 'height' | 'props'> {
  props?: Record<string, unknown>;
  overrides?: LayerOverrides;
}

/** Compile a composition with props to a concrete, render-ready UDM artboard. */
export async function compileComposition(def: CompositionDefinition, opts: CompileCompositionOptions): Promise<{ artboard: Artboard; props: Record<string, unknown> }> {
  if (def.kind === 'html') throw new Error(`Composition "${def.id}" is kind "html" and must be rendered with the Chromium renderer.`);
  const { meta } = splitMetaProps(opts.props ?? {});
  const props = resolveProps(def, opts.props ?? {});
  const locale = opts.locale ?? (meta.locale as string | undefined);
  let artboard: Artboard;
  if (def.document) {
    const resolved = DocumentSchema.parse(resolveDocumentVariables(def.document, props));
    const ab = def.artboardId ? resolved.artboards.find((a) => a.id === def.artboardId) : resolved.artboards[0];
    if (!ab) throw new Error(`Artboard ${def.artboardId} not found in document ${def.document.id}`);
    artboard = { ...ab, locale: locale ?? ab.locale };
  } else {
    const element = { type: def.component, props, key: null, $$typeof: Symbol.for('react.transitional.element') };
    artboard = await compileElement(element, {
      ...opts,
      width: def.width,
      height: def.height,
      props,
      locale,
      compositionId: def.id,
      artboardId: def.id,
      background: def.background,
    });
  }
  if (def.safeZones?.length && !artboard.safeZones?.length) artboard = { ...artboard, safeZones: def.safeZones };
  if (def.preset && !artboard.preset) artboard = { ...artboard, preset: def.preset };
  const overrides = { ...((meta.overrides as LayerOverrides) ?? {}), ...(opts.overrides ?? {}) };
  return { artboard: applyOverrides(artboard, overrides), props };
}
