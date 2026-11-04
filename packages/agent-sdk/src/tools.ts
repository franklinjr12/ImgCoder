/**
 * Transport-agnostic implementations of the agent tools. MCP, JSON-RPC and REST all call these.
 */
import path from 'node:path';
import { PropsValidationError, mergeOverrides, type LayerOverrides } from '@game-artisan/core';
import { ArtisanProject, TemplateStateStore, renderToFile, batchLocalize, type BatchLocalizeRequest } from '@game-artisan/runtime';

export interface AgentContext {
  project: ArtisanProject;
  state: TemplateStateStore;
  /** Base directory for relative output paths (default: project outDir). */
  outDir: string;
  /** Allow writing outside the project root. Default false. */
  allowOutsideRoot?: boolean;
}

export async function createAgentContext(opts: { cwd?: string; configFile?: string; entry?: string; builtinTemplates?: boolean } = {}): Promise<AgentContext> {
  const project = await ArtisanProject.load(opts);
  return { project, state: TemplateStateStore.forProject(project.root), outDir: project.config.outDir };
}

export class ToolError extends Error {
  constructor(message: string, readonly details?: unknown) {
    super(message);
  }
}

function safeOutputPath(ctx: AgentContext, p: string | undefined, fallbackName: string): string {
  const target = path.resolve(ctx.project.root, p ?? path.join(path.relative(ctx.project.root, ctx.outDir), fallbackName));
  if (!ctx.allowOutsideRoot && !target.startsWith(ctx.project.root + path.sep) && target !== ctx.project.root) {
    throw new ToolError(`outputPath must stay inside the project root (${ctx.project.root}); got ${target}`);
  }
  return target;
}

export function listTemplates(ctx: AgentContext) {
  return ctx.project.list().map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    width: c.width,
    height: c.height,
    kind: c.kind,
    platform: c.platform,
    preset: c.preset,
    tags: c.tags,
    defaultFormat: c.defaultFormat,
    propsSchema: c.propsSchema,
  }));
}

export async function getTemplateProps(ctx: AgentContext, args: { compositionId: string; thumbnail?: boolean; thumbnailWidth?: number }) {
  const info = ctx.project.describe(args.compositionId);
  const saved = await ctx.state.get(args.compositionId);
  const currentProps = { ...info.defaultProps, ...(saved?.props ?? {}) };
  let thumbnail: { mime: string; base64: string; width: number; height: number } | undefined;
  if (args.thumbnail !== false) {
    const tw = args.thumbnailWidth ?? 384;
    const r = await renderToFile(ctx.project, { compositionId: args.compositionId, props: currentProps, overrides: saved?.overrides, format: 'png', scale: Math.min(1, tw / info.width) });
    thumbnail = { mime: 'image/png', base64: r.buffer.toString('base64'), width: r.dimensions.width, height: r.dimensions.height };
  }
  return { id: info.id, name: info.name, width: info.width, height: info.height, defaultProps: info.defaultProps, currentProps, overrides: saved?.overrides ?? {}, propsSchema: info.propsSchema, updatedAt: saved?.updatedAt, thumbnail };
}

export async function updateTemplateProps(ctx: AgentContext, args: { compositionId: string; props?: Record<string, unknown>; overrides?: LayerOverrides; replace?: boolean; reset?: boolean }) {
  const def = ctx.project.get(args.compositionId);
  if (args.reset) {
    await ctx.state.reset(def.id);
    return { id: def.id, currentProps: ctx.project.describe(def.id).defaultProps, overrides: {} };
  }
  const saved = await ctx.state.get(def.id);
  const nextProps = args.replace ? { ...(args.props ?? {}) } : { ...(saved?.props ?? {}), ...(args.props ?? {}) };
  // Validate before persisting so agents get immediate, actionable feedback.
  const { resolveProps } = await import('@game-artisan/core');
  try {
    resolveProps(def, nextProps);
  } catch (e) {
    if (e instanceof PropsValidationError) throw new ToolError(e.message, e.toJSON());
    throw e;
  }
  const st = await ctx.state.update(def.id, { props: args.props, overrides: args.overrides, replace: args.replace });
  return { id: def.id, currentProps: { ...ctx.project.describe(def.id).defaultProps, ...st.props }, overrides: st.overrides ?? {}, updatedAt: st.updatedAt };
}

export interface RenderAssetArgs {
  compositionId: string;
  props?: Record<string, unknown>;
  overrides?: LayerOverrides;
  /** Merge with the saved working state from update_template_props (default true). */
  useSavedState?: boolean;
  format?: 'png' | 'jpeg' | 'webp' | 'avif' | 'svg' | 'pdf';
  scale?: number;
  locale?: string;
  outputPath?: string;
  /** Include the file as base64 in the response. */
  returnBase64?: boolean;
  quality?: number;
  renderer?: 'svg' | 'chromium' | 'auto';
}

export async function renderAsset(ctx: AgentContext, args: RenderAssetArgs) {
  const saved = args.useSavedState === false ? undefined : await ctx.state.get(args.compositionId);
  const props = { ...(saved?.props ?? {}), ...(args.props ?? {}) };
  const overrides = mergeOverrides(saved?.overrides, args.overrides);
  const fmt = args.format ?? 'png';
  const ext = fmt === 'jpeg' ? 'jpg' : fmt;
  const outputPath = safeOutputPath(ctx, args.outputPath, `${args.compositionId}${args.scale && args.scale !== 1 ? `@${args.scale}x` : ''}.${ext}`);
  try {
    const r = await renderToFile(ctx.project, { compositionId: args.compositionId, props, overrides, format: fmt, scale: args.scale, locale: args.locale, outputPath, quality: args.quality, renderer: args.renderer });
    const { buffer, ...rest } = r;
    return { ...rest, base64: args.returnBase64 ? buffer.toString('base64') : undefined };
  } catch (e) {
    if (e instanceof PropsValidationError) throw new ToolError(e.message, e.toJSON());
    throw e;
  }
}

export async function batchLocalizeTool(ctx: AgentContext, args: BatchLocalizeRequest) {
  safeOutputPath(ctx, args.outputDir, '');
  return batchLocalize(ctx.project, args);
}
