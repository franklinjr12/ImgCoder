/**
 * Props Inspector form model (US-4.1): JSON Schema (from `describeComposition(def).propsSchema`
 * or a design's `doc.props.schema`) → field descriptors the React inspector renders.
 */

export type FieldKind =
  | 'text'
  | 'textarea'
  | 'number'
  | 'slider'
  | 'boolean'
  | 'enum'
  | 'color'
  | 'image'
  | 'svg'
  | 'font'
  | 'object'
  | 'array'
  | 'locale-map'
  | 'record'
  | 'json';

export interface PropField {
  key: string;
  label: string;
  kind: FieldKind;
  schema: JsonSchema;
  description?: string;
  default?: unknown;
  required?: boolean;
  nullable?: boolean;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  options?: { value: unknown; label: string }[];
  /** object: nested fields */
  fields?: PropField[];
  /** array / record / locale-map: item field */
  item?: PropField;
}

export type JsonSchema = Record<string, any>;

/** "heroX" → "Hero X", "game_title" → "Game Title". */
export function humanize(key: string): string {
  const s = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const widgetOf = (s: JsonSchema): string | undefined => s?.['x-artisan-widget'];

/** Strip null from anyOf/oneOf/type arrays (optional/nullable), returning the effective schema. */
export function unwrapNullable(schema: JsonSchema): { schema: JsonSchema; nullable: boolean } {
  if (!schema || typeof schema !== 'object') return { schema: {}, nullable: false };
  const union = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(union)) {
    const nonNull = union.filter((s: JsonSchema) => s?.type !== 'null');
    if (nonNull.length === 1 && nonNull.length < union.length) {
      const merged = { ...nonNull[0] };
      for (const k of ['default', 'description', 'title', 'x-artisan-widget']) if (schema[k] !== undefined && merged[k] === undefined) merged[k] = schema[k];
      return { schema: merged, nullable: true };
    }
  }
  if (Array.isArray(schema.type) && schema.type.includes('null')) {
    const t = schema.type.filter((x: string) => x !== 'null');
    return { schema: { ...schema, type: t.length === 1 ? t[0] : t }, nullable: true };
  }
  return { schema, nullable: false };
}

function enumOptions(s: JsonSchema): { value: unknown; label: string }[] | null {
  if (Array.isArray(s.enum)) return s.enum.map((v: unknown) => ({ value: v, label: String(v) }));
  if (s.const !== undefined) return [{ value: s.const, label: String(s.const) }];
  const union = s.anyOf ?? s.oneOf;
  if (Array.isArray(union) && union.length && union.every((u: JsonSchema) => u && (u.const !== undefined || (Array.isArray(u.enum) && u.enum.length === 1)))) {
    return union.map((u: JsonSchema) => {
      const v = u.const !== undefined ? u.const : u.enum[0];
      return { value: v, label: u.title ?? u.description ?? String(v) };
    });
  }
  return null;
}

/** Build the descriptor for one property. */
export function fieldFor(key: string, rawSchema: JsonSchema, required = false): PropField {
  const { schema, nullable } = unwrapNullable(rawSchema ?? {});
  const base = {
    key,
    label: schema.title ?? humanize(key),
    schema,
    description: schema.description,
    default: schema.default ?? rawSchema?.default,
    required,
    nullable,
  };
  const widget = widgetOf(schema);
  const opts = enumOptions(schema);
  if (opts) return { ...base, kind: 'enum', options: opts };
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;

  if (widget === 'locale-map') {
    const item = fieldFor('value', schema.additionalProperties ?? {}, true);
    return { ...base, kind: 'locale-map', item };
  }
  if (type === 'string' || (!type && (widget === 'color' || widget === 'image' || widget === 'font' || widget === 'svg' || widget === 'textarea'))) {
    if (widget === 'color' || schema.format === 'color') return { ...base, kind: 'color' };
    if (widget === 'image') return { ...base, kind: 'image' };
    if (widget === 'svg') return { ...base, kind: 'svg' };
    if (widget === 'font') return { ...base, kind: 'font' };
    if (widget === 'textarea' || (typeof schema.maxLength === 'number' && schema.maxLength > 120)) return { ...base, kind: 'textarea' };
    return { ...base, kind: 'text' };
  }
  if (type === 'number' || type === 'integer') {
    const min = schema.minimum ?? (typeof schema.exclusiveMinimum === 'number' ? schema.exclusiveMinimum : undefined);
    const max = schema.maximum ?? (typeof schema.exclusiveMaximum === 'number' ? schema.exclusiveMaximum : undefined);
    const integer = type === 'integer';
    const step = schema['x-artisan-step'] ?? schema.multipleOf ?? (integer ? 1 : max != null && min != null && max - min <= 2 ? 0.01 : 1);
    const slider = widget === 'slider' || (min != null && max != null && Number.isFinite(min) && Number.isFinite(max) && max - min <= 10000);
    return { ...base, kind: slider ? 'slider' : 'number', min, max, step, integer };
  }
  if (type === 'boolean') return { ...base, kind: 'boolean' };
  if (type === 'array') {
    const items = Array.isArray(schema.items) ? schema.items[0] : schema.items;
    return { ...base, kind: 'array', item: fieldFor('item', items ?? {}, true), min: schema.minItems, max: schema.maxItems };
  }
  if (type === 'object' || schema.properties || schema.additionalProperties) {
    if (schema.properties && Object.keys(schema.properties).length) {
      const req = new Set<string>(schema.required ?? []);
      return { ...base, kind: 'object', fields: Object.entries(schema.properties).map(([k, s]) => fieldFor(k, s as JsonSchema, req.has(k))) };
    }
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      return { ...base, kind: 'record', item: fieldFor('value', schema.additionalProperties, true) };
    }
  }
  return { ...base, kind: 'json' };
}

/** All top-level prop fields of a composition JSON Schema. */
export function buildPropFields(schema: JsonSchema | undefined | null): PropField[] {
  if (!schema || typeof schema !== 'object') return [];
  const props = schema.properties ?? {};
  const req = new Set<string>(schema.required ?? []);
  return Object.entries(props).map(([k, s]) => fieldFor(k, s as JsonSchema, req.has(k)));
}

/** A sensible empty value for a field (new array items, new locale entries). */
export function defaultValueFor(field: PropField): unknown {
  if (field.default !== undefined) return structuredCloneSafe(field.default);
  switch (field.kind) {
    case 'text':
    case 'textarea':
    case 'image':
    case 'svg':
      return '';
    case 'font':
      return 'Inter';
    case 'color':
      return '#ffffff';
    case 'number':
    case 'slider':
      return field.min ?? 0;
    case 'boolean':
      return false;
    case 'enum':
      return field.options?.[0]?.value;
    case 'object': {
      const o: Record<string, unknown> = {};
      for (const f of field.fields ?? []) if (f.required || f.default !== undefined) o[f.key] = defaultValueFor(f);
      return o;
    }
    case 'array':
      return [];
    case 'record':
    case 'locale-map':
      return {};
    default:
      return null;
  }
}

function structuredCloneSafe<T>(v: T): T {
  try {
    return structuredClone(v);
  } catch {
    return JSON.parse(JSON.stringify(v));
  }
}

/** Fields whose current value differs from the schema/default props. */
export function changedKeys(values: Record<string, unknown>, defaults: Record<string, unknown>): Set<string> {
  const out = new Set<string>();
  for (const k of new Set([...Object.keys(values ?? {}), ...Object.keys(defaults ?? {})])) {
    if (JSON.stringify(values?.[k]) !== JSON.stringify(defaults?.[k])) out.add(k);
  }
  return out;
}

/** Infer a JSON Schema for a value (used when exposing a layer field as a design prop). */
export function inferSchema(value: unknown, hint?: { widget?: string; title?: string }): JsonSchema {
  const s: JsonSchema = {};
  if (typeof value === 'number') s.type = 'number';
  else if (typeof value === 'boolean') s.type = 'boolean';
  else if (typeof value === 'string') s.type = 'string';
  else if (Array.isArray(value)) s.type = 'array';
  else if (value && typeof value === 'object') s.type = 'object';
  if (hint?.widget) s['x-artisan-widget'] = hint.widget;
  if (hint?.title) s.title = hint.title;
  if (value !== undefined) s.default = value;
  return s;
}
