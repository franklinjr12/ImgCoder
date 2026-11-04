/**
 * Model Context Protocol server exposing GameArtisan to AI agents (US-6.1, spec §6).
 * Transports: stdio, legacy SSE and Streamable HTTP (see http.ts for mounting).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { listTemplates, getTemplateProps, updateTemplateProps, renderAsset, batchLocalizeTool, ToolError, type AgentContext } from './tools.js';

const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }], structuredContent: value as Record<string, unknown> });

function wrap<A>(fn: (args: A) => Promise<any>) {
  return async (args: A) => {
    try {
      return await fn(args);
    } catch (e) {
      const details = e instanceof ToolError ? e.details : undefined;
      return { isError: true, content: [{ type: 'text' as const, text: `${(e as Error).message}${details ? `\n${JSON.stringify(details, null, 2)}` : ''}` }] };
    }
  };
}

const FormatEnum = z.enum(['png', 'jpeg', 'webp', 'avif', 'svg', 'pdf']);
const RecordAny = z.record(z.string(), z.any());

export function createMcpServer(ctx: AgentContext): McpServer {
  const server = new McpServer({ name: 'game-artisan', version: '1.0.0' }, { capabilities: { tools: {}, logging: {} } });

  const listHandler = wrap(async () => {
    const list = listTemplates(ctx);
    return { ...json({ compositions: list }), content: [{ type: 'text' as const, text: JSON.stringify(list, null, 2) }] };
  });
  const listMeta = {
    description: 'Enumerate all GameArtisan compositions (templates) in the project with id, name, size, platform and the JSON Schema of their props.',
    inputSchema: {},
  };
  server.registerTool('artisan_list_compositions', { title: 'List compositions', ...listMeta }, listHandler as any);
  server.registerTool('list_templates', { title: 'List templates', ...listMeta }, listHandler as any);

  const getMeta = {
    description: 'Get the current props (defaults merged with saved working state), layer overrides, props JSON Schema and a PNG preview thumbnail of a template.',
    inputSchema: {
      compositionId: z.string().describe('Composition id from artisan_list_compositions'),
      thumbnail: z.boolean().optional().describe('Include a PNG thumbnail (default true)'),
      thumbnailWidth: z.number().int().min(32).max(2048).optional(),
    },
  };
  const getHandler = wrap(async (args: any) => {
    const r = await getTemplateProps(ctx, args);
    const { thumbnail, ...rest } = r;
    const content: any[] = [{ type: 'text', text: JSON.stringify(rest, null, 2) }];
    if (thumbnail) content.push({ type: 'image', data: thumbnail.base64, mimeType: thumbnail.mime });
    return { content, structuredContent: rest };
  });
  server.registerTool('get_template_props', { title: 'Get template props', ...getMeta }, getHandler as any);
  server.registerTool('artisan_get_template_props', { title: 'Get template props', ...getMeta }, getHandler as any);

  const updMeta = {
    description: 'Modify the working props of a template (copy, colours, character assets, …) and/or per-layer overrides. Props are validated against the template schema; errors explain what is expected. State persists in .artisan/state.json and is used by render_asset.',
    inputSchema: {
      compositionId: z.string(),
      props: RecordAny.optional().describe('Partial props to merge'),
      overrides: z.record(z.string(), RecordAny).optional().describe('Layer overrides keyed by layer id, e.g. { "hero": { "transform": { "x": 120 } } }'),
      replace: z.boolean().optional().describe('Replace instead of merge'),
      reset: z.boolean().optional().describe('Reset to defaults'),
    },
  };
  const updHandler = wrap(async (args: any) => json(await updateTemplateProps(ctx, args)));
  server.registerTool('update_template_props', { title: 'Update template props', ...updMeta }, updHandler as any);
  server.registerTool('artisan_update_template_props', { title: 'Update template props', ...updMeta }, updHandler as any);

  const renderMeta = {
    description: 'Render a composition headlessly to PNG/JPEG/WebP/AVIF/SVG/PDF. Returns the absolute output path, dimensions, file size and render duration (optionally base64).',
    inputSchema: {
      compositionId: z.string(),
      props: RecordAny.optional(),
      overrides: z.record(z.string(), RecordAny).optional(),
      format: FormatEnum.optional(),
      scale: z.number().min(0.1).max(8).optional().describe('Pixel density multiplier (2 = @2x)'),
      locale: z.string().optional(),
      outputPath: z.string().optional().describe('Relative to the project root; defaults to <outDir>/<id>.<ext>'),
      returnBase64: z.boolean().optional(),
      useSavedState: z.boolean().optional(),
      quality: z.number().min(1).max(100).optional(),
      renderer: z.enum(['svg', 'chromium', 'auto']).optional(),
    },
  };
  const renderHandler = wrap(async (args: any) => {
    const r = await renderAsset(ctx, args);
    const { base64, ...rest } = r as any;
    const content: any[] = [{ type: 'text', text: JSON.stringify(rest, null, 2) }];
    if (base64 && ['png', 'jpeg', 'webp'].includes(rest.format)) content.push({ type: 'image', data: base64, mimeType: rest.mime });
    return { content, structuredContent: rest };
  });
  server.registerTool('artisan_render', { title: 'Render asset', ...renderMeta }, renderHandler as any);
  server.registerTool('render_asset', { title: 'Render asset', ...renderMeta }, renderHandler as any);

  server.registerTool(
    'artisan_batch_localize',
    {
      title: 'Batch localize',
      description: 'Render one composition for several locales (logo swap + localized copy). localizationData maps locale → props.',
      inputSchema: {
        compositionId: z.string(),
        locales: z.array(z.string()).min(1),
        localizationData: z.record(z.string(), RecordAny).optional(),
        baseProps: RecordAny.optional(),
        outputDir: z.string(),
        format: FormatEnum.optional(),
        scale: z.number().optional(),
        fileName: z.string().optional().describe('Pattern with {composition} {locale} {ext}'),
      },
    },
    wrap(async (args: any) => json(await batchLocalizeTool(ctx, args))) as any,
  );

  return server;
}

/** Run the MCP server over stdio (for Claude Desktop/Code, Cursor, …). */
export async function runStdioServer(ctx: AgentContext): Promise<McpServer> {
  const server = createMcpServer(ctx);
  await server.connect(new StdioServerTransport());
  return server;
}
