import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createAgentContext, createMcpServer, startHttpServer, RateLimiter, WorkQueue, heuristicProvider, runVariantMatrix, type AgentContext, type RunningServer } from '@game-artisan/agent-sdk';

const root = fileURLToPath(new URL('../../runtime/test/fixtures/project/', import.meta.url));
let ctx: AgentContext;
let client: Client;

beforeAll(async () => {
  rmSync(path.join(root, '.artisan', 'state.json'), { force: true });
  ctx = await createAgentContext({ cwd: root });
  const server = createMcpServer(ctx);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: 'test-agent', version: '1.0.0' });
  await client.connect(b);
});

const text = (r: any) => JSON.parse(r.content[0].text);

describe('MCP server (spec §6)', () => {
  it('exposes the spec tools', async () => {
    const tools = (await client.listTools()).tools.map((t) => t.name);
    expect(tools).toEqual(expect.arrayContaining(['artisan_list_compositions', 'artisan_render', 'artisan_batch_localize', 'list_templates', 'get_template_props', 'update_template_props', 'render_asset']));
  });

  it('artisan_list_compositions returns ids, sizes and props schema', async () => {
    const list = text(await client.callTool({ name: 'artisan_list_compositions', arguments: {} }));
    const header = list.find((c: any) => c.id === 'header');
    expect(header).toMatchObject({ width: 460, height: 215 });
    expect(header.propsSchema.properties.accent).toBeTruthy();
  });

  it('get → update → render workflow with persisted state and thumbnail', async () => {
    const got: any = await client.callTool({ name: 'get_template_props', arguments: { compositionId: 'header', thumbnailWidth: 120 } });
    expect(got.content[1].type).toBe('image');
    const upd = text(await client.callTool({ name: 'update_template_props', arguments: { compositionId: 'header', props: { title: 'AGENT TITLE', accent: '#ff00ff' } } }));
    expect(upd.currentProps.title).toBe('AGENT TITLE');
    const bad: any = await client.callTool({ name: 'update_template_props', arguments: { compositionId: 'header', props: { heroX: 'nope' } } });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toMatch(/heroX/);
    const r: any = await client.callTool({ name: 'artisan_render', arguments: { compositionId: 'header', format: 'png', scale: 2, outputPath: 'out/mcp/header_2x.png', returnBase64: true } });
    const res = JSON.parse(r.content[0].text);
    expect(res.status).toBe('success');
    expect(res.dimensions).toEqual({ width: 920, height: 430 });
    expect(path.isAbsolute(res.outputPath)).toBe(true);
    expect(res.renderDurationMs).toBeGreaterThan(0);
    expect(r.content[1].type).toBe('image');
  });

  it('artisan_batch_localize renders locales', async () => {
    const r = text(await client.callTool({ name: 'artisan_batch_localize', arguments: { compositionId: 'header', locales: ['en', 'ja'], localizationData: { ja: { callout: '今すぐプレイ' } }, outputDir: 'out/mcp-loc/' } }));
    expect(r.status).toBe('success');
    expect(existsSync(path.join(root, 'out/mcp-loc/header.ja.png'))).toBe(true);
  });

  it('refuses to write outside the project root', async () => {
    const r: any = await client.callTool({ name: 'render_asset', arguments: { compositionId: 'small', outputPath: '../../../../escape.png' } });
    expect(r.isError).toBe(true);
  });
});

describe('HTTP server (US-6.2)', () => {
  let srv: RunningServer;
  beforeAll(async () => {
    srv = await startHttpServer(ctx, { port: 0, rateLimitPerMinute: 600 });
  });
  afterAll(() => srv.close());

  it('GET /health and /compositions', async () => {
    const h = await (await fetch(`${srv.url}/health`)).json();
    expect(h.status).toBe('ok');
    const c = await (await fetch(`${srv.url}/compositions/header`)).json();
    expect(c.width).toBe(460);
  });

  it('POST /render returns the image or JSON', async () => {
    const res = await fetch(`${srv.url}/render`, { method: 'POST', body: JSON.stringify({ compositionId: 'small', format: 'webp', scale: 2 }) });
    expect(res.headers.get('content-type')).toBe('image/webp');
    expect(res.headers.get('x-dimensions')).toBe('462x174');
    const j = await (await fetch(`${srv.url}/render`, { method: 'POST', headers: { accept: 'application/json' }, body: JSON.stringify({ compositionId: 'small' }) })).json();
    expect(j.base64.length).toBeGreaterThan(100);
    const bad = await fetch(`${srv.url}/render`, { method: 'POST', body: JSON.stringify({ compositionId: 'header', props: { heroX: -1 } }) });
    expect(bad.status).toBe(400);
    expect((await bad.json()).issues[0].path).toBe('heroX');
  });

  it('JSON-RPC 2.0 (single + batch)', async () => {
    const one = await (await fetch(`${srv.url}/rpc`, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'list_templates' }) })).json();
    expect(one.result.length).toBe(3);
    const many = await (await fetch(`${srv.url}/rpc`, { method: 'POST', body: JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'nope' }, { jsonrpc: '2.0', id: 2, method: 'render_asset', params: { compositionId: 'small', outputPath: 'out/rpc/small.png' } }]) })).json();
    expect(many[0].error.code).toBe(-32601);
    expect(many[1].result.status).toBe('success');
  });

  it('serves MCP over Streamable HTTP', async () => {
    const c = new Client({ name: 'http-agent', version: '1.0.0' });
    await c.connect(new StreamableHTTPClientTransport(new URL(`${srv.url}/mcp`)));
    expect((await c.listTools()).tools.length).toBeGreaterThan(5);
    await c.close();
  });

  it('enforces bearer auth when configured', async () => {
    const s = await startHttpServer(ctx, { port: 0, apiKey: 'secret' });
    try {
      expect((await fetch(`${s.url}/compositions`)).status).toBe(401);
      expect((await fetch(`${s.url}/compositions`, { headers: { authorization: 'Bearer secret' } })).status).toBe(200);
    } finally {
      await s.close();
    }
  });
});

describe('rate limiting & queue', () => {
  it('token bucket limits bursts and refills', () => {
    const rl = new RateLimiter(60, 2);
    expect(rl.take('a', 0).ok).toBe(true);
    expect(rl.take('a', 0).ok).toBe(true);
    const third = rl.take('a', 0);
    expect(third.ok).toBe(false);
    expect(third.retryAfterSec).toBeGreaterThan(0);
    expect(rl.take('a', 1100).ok).toBe(true);
    expect(rl.take('b', 0).ok).toBe(true);
  });
  it('bounded queue rejects overflow with 503 and respects concurrency', async () => {
    const q = new WorkQueue(1, 1);
    let release!: () => void;
    const p1 = q.run(() => new Promise<void>((r) => (release = r)));
    const p2 = q.run(async () => 'second');
    await expect(q.run(async () => 'third')).rejects.toMatchObject({ status: 503 });
    expect(q.active).toBe(1);
    release();
    await p1;
    expect(await p2).toBe('second');
  });
});

describe('variant matrix (US-6.3)', () => {
  it('heuristic provider produces schema-valid variants and a contact sheet', async () => {
    const r = await runVariantMatrix(ctx, { compositionId: 'header', goals: [{ label: 'Character', prompt: 'emphasize the character' }], perGoal: 3, provider: heuristicProvider(), outDir: 'out/variants-test' });
    expect(r.variants).toHaveLength(3);
    expect(r.variants.every((v) => !v.error)).toBe(true);
    expect(existsSync(r.contactSheet)).toBe(true);
  });
});
