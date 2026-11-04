import { z } from 'zod';

export interface PropIssue {
  path: string;
  message: string;
  expected?: string;
  received?: string;
}

/** Props validation error with agent-friendly, actionable messages. */
export class PropsValidationError extends Error {
  constructor(
    readonly compositionId: string,
    readonly issues: PropIssue[],
    readonly jsonSchema?: Record<string, unknown>,
  ) {
    super(
      `Invalid props for composition "${compositionId}":\n` +
        issues.map((i) => `  • ${i.path}: ${i.message}${i.expected ? ` (expected ${i.expected}${i.received ? `, received ${i.received}` : ''})` : ''}`).join('\n') +
        (jsonSchema ? `\nHint: run \`artisan inspect ${compositionId}\` (or MCP tool artisan_list_compositions) to see the props JSON Schema.` : ''),
    );
    this.name = 'PropsValidationError';
  }

  toJSON() {
    return { error: 'PropsValidationError', compositionId: this.compositionId, issues: this.issues, propsSchema: this.jsonSchema };
  }
}

export function zodIssuesToPropIssues(error: z.ZodError, input: unknown): PropIssue[] {
  return error.issues.map((i) => {
    const path = i.path.map(String).join('.') || '(root)';
    let received: string | undefined;
    try {
      const v = i.path.reduce<any>((acc, k) => (acc == null ? undefined : acc[k as any]), input);
      received = v === undefined ? 'undefined' : JSON.stringify(v)?.slice(0, 60);
    } catch {
      /* ignore */
    }
    const expected = (i as any).expected ?? ((i as any).values ? (i as any).values.map((v: unknown) => JSON.stringify(v)).join(' | ') : undefined);
    let message = i.message;
    if (i.code === 'unrecognized_keys') message = `Unknown prop(s): ${(i as any).keys.join(', ')}`;
    return { path, message, expected: expected ? String(expected) : undefined, received };
  });
}

/** Strip reserved meta keys ($overrides, $locale, …) from a props payload. */
export function splitMetaProps(input: Record<string, unknown> = {}): { props: Record<string, unknown>; meta: Record<string, unknown> } {
  const props: Record<string, unknown> = {};
  const meta: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (k.startsWith('$')) meta[k.slice(1)] = v;
    else props[k] = v;
  }
  return { props, meta };
}

export function toJsonSchema(schema: z.ZodType | undefined): Record<string, unknown> {
  if (!schema) return { type: 'object', properties: {}, additionalProperties: true };
  const js = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any', reused: 'inline' }) as Record<string, unknown>;
  return js;
}
