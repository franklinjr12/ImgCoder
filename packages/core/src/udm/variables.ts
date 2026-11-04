/**
 * VariableProp resolution: `{ "$prop": "title" }` → props.title. Records each binding on the
 * owning layer (`bindings`) so the Studio can route canvas edits back into props.
 */
import type { Artboard, ArtisanDocument, Layer } from './schema.js';

export function isVariableProp(v: unknown): v is { $prop: string; fallback?: unknown; format?: string } {
  return !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as any).$prop === 'string';
}

export function getPath(obj: any, path: string): unknown {
  return path.split('.').reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);
}

export function setPath<T>(obj: T, path: string, value: unknown): T {
  const keys = path.split('.');
  const clone: any = Array.isArray(obj) ? [...(obj as any)] : { ...(obj as any) };
  let cur = clone;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    const next = cur[k];
    cur[k] = Array.isArray(next) ? [...next] : { ...(next ?? {}) };
    cur = cur[k];
  }
  cur[keys[keys.length - 1]] = value;
  return clone;
}

function resolveValue(value: unknown, props: Record<string, unknown>, onBinding: (path: string, prop: string) => void, path: string): unknown {
  if (isVariableProp(value)) {
    const prop = getPath(props, value.$prop);
    onBinding(path, value.$prop);
    let out = prop === undefined ? value.fallback : prop;
    if (value.format && out !== undefined) out = value.format.replace(/\{value\}/g, String(out));
    return out;
  }
  if (Array.isArray(value)) return value.map((v, i) => resolveValue(v, props, onBinding, `${path}.${i}`));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveValue(v, props, onBinding, path ? `${path}.${k}` : k);
    return out;
  }
  return value;
}

function resolveLayer(layer: any, props: Record<string, unknown>): Layer {
  const bindings: Record<string, string> = { ...(layer.bindings ?? {}) };
  const out: any = {};
  for (const [k, v] of Object.entries(layer)) {
    if (k === 'children' && Array.isArray(v)) out.children = v.map((c) => resolveLayer(c, props));
    else if (k === 'mask' && v && typeof v === 'object' && layer.type === 'mask') out.mask = resolveLayer(v, props);
    else out[k] = resolveValue(v, props, (p, prop) => (bindings[p] = prop), k);
  }
  if (Object.keys(bindings).length) out.bindings = bindings;
  return out as Layer;
}

export function resolveArtboardVariables(artboard: Artboard, props: Record<string, unknown>): Artboard {
  const out: any = {};
  for (const [k, v] of Object.entries(artboard)) {
    if (k === 'children') out.children = (v as any[]).map((c) => resolveLayer(c, props));
    else out[k] = resolveValue(v, props, () => {}, k);
  }
  return out;
}

export function resolveDocumentVariables(doc: ArtisanDocument, props: Record<string, unknown> = {}): ArtisanDocument {
  const merged = { ...(doc.props?.defaults ?? {}), ...props };
  return { ...doc, artboards: doc.artboards.map((a) => resolveArtboardVariables(a, merged)) };
}

/** Lists all prop names referenced by bindings in a raw (unresolved) document. */
export function collectBoundProps(value: unknown, out = new Set<string>()): Set<string> {
  if (isVariableProp(value)) out.add(value.$prop.split('.')[0]);
  else if (Array.isArray(value)) value.forEach((v) => collectBoundProps(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectBoundProps(v, out));
  return out;
}
