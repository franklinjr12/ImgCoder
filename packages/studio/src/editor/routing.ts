/**
 * Canvas/inspector edit routing (US-4.2 two-way sync).
 *
 * Edits are flat field patches on a layer (`{ 'transform.x': 120, 'style.fontSize': 48 }`).
 * When a field is bound to a prop (layer.bindings, recorded by the JSX compiler from
 * `bind={{ x: 'heroX' }}` or by `$prop` resolution), the edit updates the bound **prop**;
 * everything else becomes a layer **override** (code templates) or a direct document edit
 * (designs).
 */
import { getPath, mergeOverrides, setPath, type Layer, type LayerOverride, type LayerOverrides } from '@game-artisan/core';

export type FlatPatch = Record<string, unknown>;

/** The binding governing `path` (exact match or an ancestor path, e.g. `style.fill` for `style.fill.color`). */
export function bindingFor(layer: Pick<Layer, 'bindings'>, path: string): { bindingPath: string; prop: string; rest: string } | null {
  const b = layer.bindings;
  if (!b) return null;
  const parts = path.split('.');
  for (let i = parts.length; i > 0; i--) {
    const p = parts.slice(0, i).join('.');
    if (b[p]) return { bindingPath: p, prop: b[p], rest: parts.slice(i).join('.') };
  }
  return null;
}

export interface RoutedPatch {
  /** New props object (only when some bound field changed). */
  props: Record<string, unknown> | null;
  /** Names of props that changed. */
  changedProps: string[];
  /** Patch for unbound fields. */
  layerPatch: FlatPatch;
}

/**
 * Split a patch into prop updates (bound fields) and a layer patch (unbound fields).
 * Numeric bound fields are updated by delta (prop += new − old) so a binding like
 * `x={base + heroX}` keeps working; other values are assigned.
 */
export function routePatch(resolvedLayer: Layer, patch: FlatPatch, props: Record<string, unknown>): RoutedPatch {
  let nextProps: Record<string, unknown> | null = null;
  const changed: string[] = [];
  const layerPatch: FlatPatch = {};
  for (const [path, value] of Object.entries(patch)) {
    const bind = bindingFor(resolvedLayer, path);
    if (!bind) {
      layerPatch[path] = value;
      continue;
    }
    const cur: Record<string, unknown> = nextProps ?? props;
    const propVal = getPath(cur, bind.prop);
    let newPropVal: unknown;
    if (bind.rest) {
      newPropVal = setPath((propVal ?? {}) as object, bind.rest, value);
    } else {
      const oldVal = getPath(resolvedLayer, path);
      if (typeof value === 'number' && typeof oldVal === 'number' && typeof propVal === 'number') newPropVal = round(propVal + (value - oldVal));
      else if (typeof value === 'number' && typeof propVal === 'string' && /^-?\d+(\.\d+)?$/.test(propVal)) newPropVal = String(round(value));
      else newPropVal = value;
    }
    nextProps = setPath(cur, bind.prop, newPropVal);
    changed.push(bind.prop);
  }
  return { props: nextProps, changedProps: [...new Set(changed)], layerPatch };
}

const round = (v: number) => Math.round(v * 1e4) / 1e4;

/**
 * Convert a flat patch into a core `LayerOverride` (applyOverrides semantics: `transform` and
 * text `style` are merged per key; any other top-level field is replaced wholesale, so nested
 * paths are expanded against the current layer value).
 */
export function patchToOverride(layer: Layer, patch: FlatPatch): LayerOverride {
  const o: Record<string, any> = {};
  for (const [path, value] of Object.entries(patch)) {
    const [top, ...rest] = path.split('.');
    if ((top === 'transform' || (top === 'style' && layer.type === 'text')) && rest.length) {
      const [k2, ...rest2] = rest;
      const base = o[top]?.[k2] !== undefined ? o[top][k2] : (layer as any)[top]?.[k2];
      o[top] = { ...(o[top] ?? {}), [k2]: rest2.length ? setPath(base ?? {}, rest2.join('.'), value) : value };
      continue;
    }
    if (!rest.length) {
      o[top] = value;
      continue;
    }
    const base = o[top] !== undefined ? o[top] : (layer as any)[top];
    o[top] = setPath(base ?? {}, rest.join('.'), value);
  }
  return o as LayerOverride;
}

/** Add a patch to the overrides map (removes override fields for bound paths). */
export function addOverride(overrides: LayerOverrides, layer: Layer, patch: FlatPatch): LayerOverrides {
  if (!Object.keys(patch).length) return overrides;
  return mergeOverrides(overrides, { [layer.id]: patchToOverride(layer, patch) });
}

/** Remove an override field (or the whole layer entry) — "reset this layer". */
export function clearOverride(overrides: LayerOverrides, layerId: string, field?: string): LayerOverrides {
  const cur = overrides[layerId];
  if (!cur) return overrides;
  const next = { ...overrides };
  if (!field) delete next[layerId];
  else {
    const o: any = { ...cur };
    delete o[field];
    if (Object.keys(o).length) next[layerId] = o;
    else delete next[layerId];
  }
  return next;
}

/** Full routing for code templates: returns new props + overrides. */
export function applyCompositionEdit(
  resolvedLayer: Layer,
  patch: FlatPatch,
  state: { props: Record<string, unknown>; overrides: LayerOverrides },
): { props: Record<string, unknown>; overrides: LayerOverrides; changedProps: string[] } {
  const routed = routePatch(resolvedLayer, patch, state.props);
  return {
    props: routed.props ?? state.props,
    overrides: addOverride(state.overrides, resolvedLayer, routed.layerPatch),
    changedProps: routed.changedProps,
  };
}

/** Human summary of what deviates from defaults (warning indicator). */
export function deviationSummary(changedProps: string[], overrides: LayerOverrides): string {
  const parts: string[] = [];
  if (changedProps.length) parts.push(`${changedProps.length} prop${changedProps.length > 1 ? 's' : ''} changed (${changedProps.slice(0, 4).join(', ')}${changedProps.length > 4 ? '…' : ''})`);
  const n = Object.keys(overrides).length;
  if (n) parts.push(`${n} layer override${n > 1 ? 's' : ''}`);
  return parts.join(' · ');
}
