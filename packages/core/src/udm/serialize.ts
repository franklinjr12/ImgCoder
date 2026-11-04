/**
 * Deterministic, zero-dependency (de)serialisation of UDM documents plus JSON Schema export.
 */
import { z } from 'zod';
import { ArtboardSchema, DocumentSchema, LayerSchema, UDM_VERSION, type ArtisanDocument, type Artboard, type Layer } from './schema.js';
import { resolveDocumentVariables } from './variables.js';

export class UdmValidationError extends Error {
  constructor(message: string, readonly issues: { path: string; message: string }[]) {
    super(message);
    this.name = 'UdmValidationError';
  }
}

export function formatZodIssues(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((i) => ({ path: i.path.map(String).join('.') || '(root)', message: i.message }));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort()) {
      const v = (value as any)[k];
      if (v !== undefined) out[k] = sortKeys(v);
    }
    return out;
  }
  return value;
}

/** Stable JSON: sorted keys, no undefined, fixed indentation. Byte-identical for equal documents. */
export function serializeDocument(doc: ArtisanDocument, indent = 2): string {
  const { $schema, ...rest } = doc as any;
  const body = sortKeys(rest) as Record<string, unknown>;
  return JSON.stringify($schema ? { $schema, ...body } : body, null, indent) + '\n';
}

/**
 * Parse and validate a document. Documents may contain `$prop` bindings, so validation runs
 * against a copy resolved with the document's default props, while the returned document
 * keeps the bindings intact.
 */
export function deserializeDocument(input: string | unknown): ArtisanDocument {
  const raw = typeof input === 'string' ? JSON.parse(input) : input;
  const migrated = migrateDocument(raw);
  const preview = resolveDocumentVariables(migrated as ArtisanDocument);
  const check = DocumentSchema.safeParse(preview);
  if (!check.success) {
    const issues = formatZodIssues(check.error);
    throw new UdmValidationError(`Invalid GameArtisan document:\n${issues.map((i) => `  • ${i.path}: ${i.message}`).join('\n')}`, issues);
  }
  // Fill defaults on the raw doc while preserving bindings: parse with bindings, fall back to raw.
  const withDefaults = DocumentSchema.safeParse(migrated);
  return (withDefaults.success ? withDefaults.data : migrated) as ArtisanDocument;
}

export function validateDocument(input: unknown): { ok: true; document: ArtisanDocument } | { ok: false; issues: { path: string; message: string }[] } {
  try {
    return { ok: true, document: deserializeDocument(input) };
  } catch (e) {
    if (e instanceof UdmValidationError) return { ok: false, issues: e.issues };
    return { ok: false, issues: [{ path: '(root)', message: (e as Error).message }] };
  }
}

export function parseArtboard(input: unknown): Artboard {
  const r = ArtboardSchema.safeParse(input);
  if (!r.success) throw new UdmValidationError('Invalid artboard', formatZodIssues(r.error));
  return r.data;
}

export function parseLayer(input: unknown): Layer {
  const r = LayerSchema.safeParse(input);
  if (!r.success) throw new UdmValidationError('Invalid layer', formatZodIssues(r.error));
  return r.data;
}

/** Upgrade older document shapes to the current version. */
export function migrateDocument(raw: any): any {
  if (!raw || typeof raw !== 'object') throw new UdmValidationError('Document must be an object', [{ path: '(root)', message: 'expected object' }]);
  const doc = { ...raw };
  if (doc.version == null) doc.version = UDM_VERSION;
  if (doc.kind == null) doc.kind = 'artisan-document';
  // v0 shape: single artboard at root
  if (!doc.artboards && doc.width && doc.height) {
    doc.artboards = [{ id: doc.id ?? 'main', width: doc.width, height: doc.height, children: doc.children ?? doc.layers ?? [], background: doc.background }];
    delete doc.width;
    delete doc.height;
    delete doc.children;
    delete doc.layers;
    delete doc.background;
  }
  return doc;
}

/** JSON Schema (draft 2020-12) for documents, artboards or layers. */
export function getUdmJsonSchema(target: 'document' | 'artboard' | 'layer' = 'document'): Record<string, unknown> {
  const schema = target === 'document' ? DocumentSchema : target === 'artboard' ? ArtboardSchema : LayerSchema;
  return z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any', cycles: 'ref', reused: 'inline' }) as Record<string, unknown>;
}
