/**
 * Design-document helpers (framework-free): create from store presets, detach a compiled code
 * template into an editable design, expose layer fields as props (`{ "$prop": name }` +
 * JSON-schema entry), and resolve a design for rendering.
 */
import {
  cloneDeep,
  createArtboard,
  createDocument,
  generateId,
  getPath,
  isContainer,
  isVariableProp,
  resolveArtboardVariables,
  setPath,
  ArtboardSchema,
  type Artboard,
  type ArtisanDocument,
  type Layer,
  type SafeZone,
} from '@game-artisan/core';
import { inferSchema, type JsonSchema } from './prop-form.js';
import { mapLayer, getLayer } from './tree-ops.js';

export interface StorePresetLike {
  id: string;
  platform: string;
  name: string;
  width: number;
  height: number;
  aspectRatio?: string;
  requiredFormat?: string;
  safeZoneMargins?: { top: number; right: number; bottom: number; left: number };
  notes?: string;
}

/** Fallback safe zones from preset margins (used when templates-game `presetSafeZones` is unavailable). */
export function safeZonesFromMargins(spec: StorePresetLike): SafeZone[] {
  const m = spec.safeZoneMargins;
  if (!m) return [];
  const zones: SafeZone[] = [
    { id: `${spec.id}-safe`, label: 'Title safe area', kind: 'safe', x: m.left, y: m.top, width: spec.width - m.left - m.right, height: spec.height - m.top - m.bottom },
  ];
  if (spec.id.includes('library-hero')) {
    zones.push({ id: `${spec.id}-client-ui`, label: 'Steam client: logo + Play button', kind: 'danger', x: 0, y: spec.height - m.bottom, width: Math.round(spec.width * 0.45), height: m.bottom });
  }
  return zones;
}

export function newDesign(opts: { name?: string; width: number; height: number; preset?: StorePresetLike; safeZones?: SafeZone[]; background?: string }): ArtisanDocument {
  const artboard = createArtboard({
    name: opts.preset?.name ?? `${opts.width}×${opts.height}`,
    width: Math.round(opts.width),
    height: Math.round(opts.height),
    background: { type: 'solid', color: opts.background ?? '#14161f' },
    preset: opts.preset?.id,
    safeZones: opts.safeZones ?? (opts.preset ? safeZonesFromMargins(opts.preset) : []),
    children: [],
  });
  return createDocument({ name: opts.name ?? opts.preset?.name ?? 'Untitled design', artboards: [artboard], meta: { createdWith: 'game-artisan-studio', createdAt: new Date().toISOString() } });
}

/** Add an artboard to a document (multi-artboard designs, artboard switching). */
export function addArtboard(doc: ArtisanDocument, opts: { width: number; height: number; name?: string; preset?: StorePresetLike; safeZones?: SafeZone[] }): { doc: ArtisanDocument; artboardId: string } {
  const ab = createArtboard({
    name: opts.name ?? opts.preset?.name ?? `Artboard ${doc.artboards.length + 1}`,
    width: Math.round(opts.width),
    height: Math.round(opts.height),
    background: { type: 'solid', color: '#14161f' },
    preset: opts.preset?.id,
    safeZones: opts.safeZones ?? (opts.preset ? safeZonesFromMargins(opts.preset) : []),
  });
  return { doc: { ...doc, artboards: [...doc.artboards, ab] }, artboardId: ab.id };
}

export function replaceArtboard(doc: ArtisanDocument, artboard: Artboard): ArtisanDocument {
  return { ...doc, artboards: doc.artboards.map((a) => (a.id === artboard.id ? artboard : a)) };
}

/** Props used to preview a design: its defaults. */
export function designProps(doc: ArtisanDocument): Record<string, unknown> {
  return { ...(doc.props?.defaults ?? {}) };
}

/** Resolve `$prop` bindings for rendering (records layer.bindings for two-way editing). */
export function resolveDesignArtboard(doc: ArtisanDocument, artboardId: string, props = designProps(doc)): Artboard {
  const ab = doc.artboards.find((a) => a.id === artboardId) ?? doc.artboards[0];
  const resolved = resolveArtboardVariables(ab, props);
  // fill schema defaults (documents with bindings may be stored without them)
  const parsed = ArtboardSchema.safeParse(resolved);
  return parsed.success ? parsed.data : resolved;
}

/**
 * "Detach to design": convert a compiled code-template artboard into an editable UDM document.
 * Fields bound to props are turned into `$prop` bindings and the used props become the
 * document's props schema/defaults, so the design stays agent/CLI-renderable.
 */
export function detachToDocument(
  artboard: Artboard,
  opts: { name: string; props?: Record<string, unknown>; propsSchema?: JsonSchema; description?: string },
): ArtisanDocument {
  const used = new Set<string>();
  const rebind = (layer: Layer): Layer => {
    let l: any = cloneDeep(layer);
    for (const [path, prop] of Object.entries(layer.bindings ?? {})) {
      l = setPath(l, path, { $prop: prop });
      used.add(prop.split('.')[0]);
    }
    delete l.bindings;
    if (isContainer(l)) l.children = l.children.map(rebind);
    if (l.type === 'mask' && l.mask) l.mask = rebind(l.mask);
    return l;
  };
  const ab: Artboard = { ...cloneDeep(artboard), children: artboard.children.map(rebind) };
  let props: ArtisanDocument['props'];
  if (used.size) {
    const schemaProps: Record<string, unknown> = {};
    const defaults: Record<string, unknown> = {};
    for (const p of used) {
      schemaProps[p] = opts.propsSchema?.properties?.[p] ?? inferSchema(opts.props?.[p]);
      if (opts.props && p in opts.props) defaults[p] = opts.props[p];
    }
    props = { schema: { type: 'object', properties: schemaProps }, defaults };
  }
  // not validated with DocumentSchema: `$prop` bindings are not valid literal values
  return {
    kind: 'artisan-document',
    version: 1,
    id: generateId('doc'),
    name: opts.name,
    description: opts.description,
    artboards: [ab],
    props,
    fonts: [],
    meta: { detachedFrom: artboard.id, detachedAt: new Date().toISOString() },
  } as ArtisanDocument;
}

/** Widget hint for a layer field path. */
export function widgetForField(layer: Layer, path: string): string | undefined {
  if (/(^|\.)(color|background)$/.test(path) || /fill\.color$/.test(path)) return 'color';
  if (path === 'src') return layer.type === 'svg' ? 'svg' : 'image';
  if (path === 'content') return 'textarea';
  if (/fontFamily$/.test(path)) return 'font';
  return undefined;
}

/** Suggest a prop name for a layer field: "Hero" + "transform.x" → "heroX". */
export function suggestPropName(layer: Layer, path: string, taken: Iterable<string> = []): string {
  const base = (layer.name ?? layer.type).replace(/[^a-zA-Z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')).replace(/^[^a-zA-Z]+/, '');
  const leaf = path.split('.').pop() ?? path;
  let name = (base.charAt(0).toLowerCase() + base.slice(1) || 'layer') + (leaf === 'content' ? 'Text' : leaf.charAt(0).toUpperCase() + leaf.slice(1));
  const set = new Set(taken);
  let i = 2;
  const stem = name;
  while (set.has(name)) name = `${stem}${i++}`;
  return name;
}

/** Expose a raw layer field as a design prop: `{ "$prop": name }` + schema + default. */
export function exposeField(doc: ArtisanDocument, artboardId: string, layerId: string, path: string, propName: string, resolvedValue?: unknown): ArtisanDocument {
  const ab = doc.artboards.find((a) => a.id === artboardId);
  if (!ab) return doc;
  const raw = getLayer(ab, layerId);
  if (!raw) return doc;
  const current = resolvedValue !== undefined ? resolvedValue : getPath(raw, path);
  if (isVariableProp(current)) return doc;
  const nextAb = mapLayer(ab, layerId, (l) => setPath(l, path, { $prop: propName }) as Layer);
  const schema: JsonSchema = { type: 'object', properties: {}, ...(doc.props?.schema ?? {}) };
  schema.properties = { ...(schema.properties ?? {}), [propName]: inferSchema(current, { widget: widgetForField(raw, path), title: undefined }) };
  return {
    ...replaceArtboard(doc, nextAb),
    props: { schema, defaults: { ...(doc.props?.defaults ?? {}), [propName]: current } },
  };
}

/** Remove a prop binding from a field, baking the current value back in. Removes the prop when unused. */
export function unexposeField(doc: ArtisanDocument, artboardId: string, layerId: string, path: string): ArtisanDocument {
  const ab = doc.artboards.find((a) => a.id === artboardId);
  const raw = ab && getLayer(ab, layerId);
  if (!ab || !raw) return doc;
  const binding = getPath(raw, path);
  if (!isVariableProp(binding)) return doc;
  const value = getPath(doc.props?.defaults ?? {}, binding.$prop) ?? binding.fallback;
  let next = replaceArtboard(doc, mapLayer(ab, layerId, (l) => setPath(l, path, value) as Layer));
  if (!collectPropUsage(next).has(binding.$prop) && next.props) {
    const props = { ...(next.props.schema.properties as Record<string, unknown>) };
    delete props[binding.$prop];
    const defaults = { ...next.props.defaults };
    delete defaults[binding.$prop];
    next = { ...next, props: Object.keys(props).length ? { schema: { ...next.props.schema, properties: props }, defaults } : undefined };
  }
  return next;
}

/** Map prop name → list of `{ artboardId, layerId, path }` that reference it. */
export function collectPropUsage(doc: ArtisanDocument): Map<string, { artboardId: string; layerId: string; path: string }[]> {
  const out = new Map<string, { artboardId: string; layerId: string; path: string }[]>();
  const scan = (value: unknown, artboardId: string, layerId: string, path: string) => {
    if (isVariableProp(value)) {
      const name = value.$prop.split('.')[0];
      if (!out.has(name)) out.set(name, []);
      out.get(name)!.push({ artboardId, layerId, path });
      return;
    }
    if (Array.isArray(value)) value.forEach((v, i) => scan(v, artboardId, layerId, path ? `${path}.${i}` : String(i)));
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) scan(v, artboardId, layerId, path ? `${path}.${k}` : k);
  };
  const walk = (layers: Layer[], artboardId: string) => {
    for (const l of layers) {
      for (const [k, v] of Object.entries(l)) if (k !== 'children' && k !== 'mask' && k !== 'id') scan(v, artboardId, l.id, k);
      if (isContainer(l)) walk(l.children, artboardId);
      if (l.type === 'mask') walk([l.mask], artboardId);
    }
  };
  for (const ab of doc.artboards) walk(ab.children, ab.id);
  return out;
}

/** Update a design prop default (two-way: canvas edits on bound fields land here). */
export function setDesignProps(doc: ArtisanDocument, props: Record<string, unknown>): ArtisanDocument {
  return { ...doc, props: { schema: doc.props?.schema ?? { type: 'object', properties: {} }, defaults: props } };
}

/** Rename a document-level prop everywhere. */
export function renameDesignProp(doc: ArtisanDocument, from: string, to: string): ArtisanDocument {
  if (from === to || !to) return doc;
  const rewrite = (v: unknown): unknown => {
    if (isVariableProp(v)) return v.$prop === from || v.$prop.startsWith(`${from}.`) ? { ...v, $prop: to + v.$prop.slice(from.length) } : v;
    if (Array.isArray(v)) return v.map(rewrite);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rewrite(x)]));
    return v;
  };
  const artboards = doc.artboards.map((a) => ({ ...a, children: a.children.map((l) => rewrite(l) as Layer) }));
  const props = doc.props
    ? {
        schema: { ...doc.props.schema, properties: Object.fromEntries(Object.entries((doc.props.schema.properties as Record<string, unknown>) ?? {}).map(([k, v]) => [k === from ? to : k, v])) },
        defaults: Object.fromEntries(Object.entries(doc.props.defaults).map(([k, v]) => [k === from ? to : k, v])),
      }
    : undefined;
  return { ...doc, artboards, props };
}

/** File name for downloads. */
export function documentFileName(doc: ArtisanDocument): string {
  const slug = (doc.name || doc.id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'design';
  return `${slug}.artisan.json`;
}
