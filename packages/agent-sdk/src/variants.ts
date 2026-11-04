/**
 * A/B variant generator (US-6.3): turn high-level marketing goals into prop variations,
 * render them and assemble a side-by-side contact sheet.
 *
 * Providers:
 *   anthropic — Claude (structured output) proposes props that satisfy the template's JSON Schema.
 *   command   — any external agent: JSON request on stdin, JSON `{ variants: [...] }` on stdout.
 *   heuristic — offline, deterministic schema-driven mutations (no network; used in tests).
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { resolveProps, GRADING_PRESETS } from '@game-artisan/core';
import { renderToFile } from '@game-artisan/runtime';
import { contactSheet } from '@game-artisan/runtime';
import type { AgentContext } from './tools.js';

export interface VariantGoal {
  label?: string;
  prompt: string;
}

export interface GeneratedVariant {
  label: string;
  rationale?: string;
  props: Record<string, unknown>;
  goal: string;
}

export interface VariantRequest {
  compositionId: string;
  goals: VariantGoal[];
  /** Variants per goal (default 1; when a single goal is given, default 4). */
  perGoal?: number;
  baseProps?: Record<string, unknown>;
}

export interface VariantProvider {
  name: string;
  generate(req: VariantRequest & { schema: Record<string, unknown>; defaults: Record<string, unknown>; preview?: Buffer; compositionName: string; width: number; height: number }): Promise<GeneratedVariant[]>;
}

// ---------------------------------------------------------------------------------------
// Claude provider

const VariantsOutput = z.object({
  variants: z.array(
    z.object({
      label: z.string().describe('Short name shown under the thumbnail (max 40 chars)'),
      goal: z.string().describe('Which goal this variant answers'),
      rationale: z.string().describe('One sentence on the design intent'),
      propsJson: z.string().describe('JSON object of props to override, valid against the props JSON Schema'),
    }),
  ),
});

export function anthropicProvider(opts: { model?: string; effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'; client?: Anthropic } = {}): VariantProvider {
  const model = opts.model ?? 'claude-opus-5-5';
  return {
    name: `anthropic:${model}`,
    async generate(req) {
      const client = opts.client ?? new Anthropic();
      const perGoal = req.perGoal ?? (req.goals.length === 1 ? 4 : 1);
      const goals = req.goals.map((g, i) => `${i + 1}. ${g.label ? `[${g.label}] ` : ''}${g.prompt}`).join('\n');
      const content: Anthropic.Beta.BetaContentBlockParam[] = [];
      if (req.preview) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: req.preview.toString('base64') } });
      content.push({
        type: 'text',
        text: [
          `You are an art director creating A/B test variants of a video-game store asset: "${req.compositionName}" (${req.width}×${req.height}px).`,
          req.preview ? 'The attached image is the current render with the default props.' : '',
          `Props JSON Schema:\n${JSON.stringify(req.schema)}`,
          `Current props:\n${JSON.stringify({ ...req.defaults, ...(req.baseProps ?? {}) })}`,
          `Marketing goals:\n${goals}`,
          `Produce ${perGoal} distinct variant(s) per goal (${perGoal * req.goals.length} total). Each variant's propsJson must be a JSON object containing only props from the schema that you change; keep image/asset paths that exist in the current props unless swapping between assets already referenced there. Prefer bold, clearly different choices (layout props, colours, grading presets, copy) so the A/B test is informative. Keep copy short and store-appropriate.`,
        ]
          .filter(Boolean)
          .join('\n\n'),
      });
      const response = await client.beta.messages.parse({
        model,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: opts.effort ?? 'medium', format: betaZodOutputFormat(VariantsOutput) },
        messages: [{ role: 'user', content }],
      });
      if (response.stop_reason === 'refusal') throw new Error(`Claude declined to generate variants${response.stop_details?.category ? ` (${response.stop_details.category})` : ''}.`);
      const parsed = response.parsed_output;
      if (!parsed) throw new Error(`Could not parse variants from the model response (stop_reason: ${response.stop_reason}).`);
      return parsed.variants.map((v) => {
        let props: Record<string, unknown> = {};
        try {
          props = JSON.parse(v.propsJson);
        } catch {
          /* invalid JSON → empty override; reported by validation */
        }
        return { label: v.label, rationale: v.rationale, props, goal: v.goal };
      });
    },
  };
}

// ---------------------------------------------------------------------------------------
// External command provider

export function commandProvider(command: string): VariantProvider {
  return {
    name: `command:${command}`,
    generate(req) {
      return new Promise((resolve, reject) => {
        const child = spawn(command, { shell: true, stdio: ['pipe', 'pipe', 'inherit'] });
        let out = '';
        child.stdout.on('data', (d) => (out += d));
        child.on('error', reject);
        child.on('close', (code) => {
          if (code !== 0) return reject(new Error(`Variant command exited with ${code}`));
          try {
            const data = JSON.parse(out);
            resolve((data.variants ?? data).map((v: any, i: number) => ({ label: v.label ?? `variant ${i + 1}`, rationale: v.rationale, props: v.props ?? {}, goal: v.goal ?? '' })));
          } catch (e) {
            reject(new Error(`Variant command did not print JSON: ${(e as Error).message}`));
          }
        });
        const { preview, ...payload } = req;
        child.stdin.end(JSON.stringify(payload));
      });
    },
  };
}

// ---------------------------------------------------------------------------------------
// Offline heuristic provider

const ACCENTS = ['#ff3366', '#00e5ff', '#ffd23f', '#7cff6b', '#b46bff', '#ff8a00', '#ffffff', '#ff4d4d'];

function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

export function heuristicProvider(): VariantProvider {
  return {
    name: 'heuristic',
    async generate(req) {
      const props = ((req.schema as any).properties ?? {}) as Record<string, any>;
      const perGoal = req.perGoal ?? (req.goals.length === 1 ? 4 : 1);
      const out: GeneratedVariant[] = [];
      req.goals.forEach((goal, gi) => {
        for (let k = 0; k < perGoal; k++) {
          const seed = hash(`${goal.prompt}|${k}|${gi}`);
          const p: Record<string, unknown> = {};
          const text = goal.prompt.toLowerCase();
          for (const [key, s] of Object.entries(props)) {
            const widget = s['x-artisan-widget'];
            const lk = key.toLowerCase();
            if (widget === 'color' || /color|colour|accent/.test(lk)) p[key] = ACCENTS[(seed + key.length + k) % ACCENTS.length];
            else if (Array.isArray(s.enum)) p[key] = s.enum[(seed + k) % s.enum.length];
            else if (s.type === 'boolean' && /laurel|badge|award|sale|show/.test(lk)) p[key] = (seed + k) % 2 === 0;
            else if ((s.type === 'number' || s.type === 'integer') && s.minimum != null && s.maximum != null) {
              const t = ((seed >> 3) % 100) / 100;
              let v = s.minimum + (s.maximum - s.minimum) * t;
              if (/character|hero/.test(text) && /hero|character|glow|scale/.test(lk)) v = s.maximum * 0.9;
              if (/screenshot|action|gameplay/.test(text) && /hero|character/.test(lk)) v = s.minimum + (s.maximum - s.minimum) * 0.2;
              p[key] = s.type === 'integer' ? Math.round(v) : Math.round(v * 100) / 100;
            } else if (/grading|preset|filter/.test(lk) && s.type === 'string') {
              const presets = Object.keys(GRADING_PRESETS);
              p[key] = presets[(seed + k) % presets.length];
            }
          }
          out.push({ label: `${goal.label ?? `Goal ${gi + 1}`} · v${k + 1}`, rationale: `Heuristic variation for: ${goal.prompt}`, props: p, goal: goal.prompt });
        }
      });
      return out;
    },
  };
}

// ---------------------------------------------------------------------------------------
// Orchestration

export interface MatrixOptions extends VariantRequest {
  provider: VariantProvider;
  outDir: string;
  format?: 'png' | 'jpeg' | 'webp';
  scale?: number;
  columns?: number;
  /** Also render the unmodified template as the first cell. Default true. */
  includeControl?: boolean;
  onProgress?: (msg: string) => void;
}

export interface MatrixResult {
  provider: string;
  contactSheet: string;
  report: string;
  variants: (GeneratedVariant & { outputPath?: string; error?: string })[];
}

export async function runVariantMatrix(ctx: AgentContext, opts: MatrixOptions): Promise<MatrixResult> {
  const info = ctx.project.describe(opts.compositionId);
  const def = ctx.project.get(opts.compositionId);
  const outDir = path.resolve(ctx.project.root, opts.outDir);
  await mkdir(outDir, { recursive: true });
  opts.onProgress?.(`Rendering control for ${info.id}…`);
  const control = await renderToFile(ctx.project, { compositionId: info.id, props: opts.baseProps, format: 'png', scale: Math.min(1, 768 / info.width) });
  opts.onProgress?.(`Asking ${opts.provider.name} for variants…`);
  const generated = await opts.provider.generate({ ...opts, schema: info.propsSchema, defaults: info.defaultProps, preview: control.buffer, compositionName: info.name, width: info.width, height: info.height });
  const results: MatrixResult['variants'] = [];
  const cells: { image: Buffer; label: string }[] = [];
  if (opts.includeControl !== false) cells.push({ image: control.buffer, label: 'Control (current props)' });
  const fmt = opts.format ?? 'png';
  for (let i = 0; i < generated.length; i++) {
    const v = generated[i];
    const props = { ...(opts.baseProps ?? {}), ...v.props };
    try {
      resolveProps(def, props);
      const file = path.join(outDir, `variant-${String(i + 1).padStart(2, '0')}.${fmt === 'jpeg' ? 'jpg' : fmt}`);
      const r = await renderToFile(ctx.project, { compositionId: info.id, props, format: fmt, scale: opts.scale, outputPath: file });
      results.push({ ...v, props, outputPath: r.outputPath });
      cells.push({ image: r.buffer, label: `${i + 1}. ${v.label}` });
      opts.onProgress?.(`Rendered ${i + 1}/${generated.length}: ${v.label}`);
    } catch (e) {
      results.push({ ...v, props, error: (e as Error).message });
      opts.onProgress?.(`Variant ${i + 1} invalid: ${(e as Error).message.split('\n')[0]}`);
    }
  }
  const sheet = await contactSheet(cells, { columns: opts.columns, cellWidth: Math.min(560, info.width), title: `${info.name} — ${generated.length} variants (${opts.provider.name})`, fonts: await ctx.project.fonts() });
  const sheetPath = path.join(outDir, 'contact-sheet.png');
  await writeFile(sheetPath, sheet);
  const reportPath = path.join(outDir, 'variants.json');
  await writeFile(reportPath, JSON.stringify({ compositionId: info.id, provider: opts.provider.name, goals: opts.goals, variants: results }, null, 2));
  return { provider: opts.provider.name, contactSheet: sheetPath, report: reportPath, variants: results };
}

export function providerFromName(name: string | undefined, opts: { model?: string; command?: string } = {}): VariantProvider {
  if (name === 'heuristic' || name === 'offline') return heuristicProvider();
  if (name === 'command') {
    if (!opts.command) throw new Error('--provider=command requires --command "<cmd>"');
    return commandProvider(opts.command);
  }
  if (!name || name === 'anthropic' || name === 'claude') return anthropicProvider({ model: opts.model });
  throw new Error(`Unknown provider "${name}" (anthropic | command | heuristic)`);
}
