/**
 * `artisan serve` — lightweight HTTP microservice (US-6.2):
 *   GET  /health                      liveness + queue stats
 *   GET  /compositions[/:id]          metadata + props JSON Schema
 *   POST /render                      { compositionId, props, format, scale, locale, overrides, response: 'binary'|'json'|'file' }
 *   POST /batch-localize              MCP artisan_batch_localize equivalent
 *   POST /rpc                         JSON-RPC 2.0 (methods: list_templates, get_template_props, update_template_props, render_asset, batch_localize)
 *   /mcp                              MCP Streamable HTTP transport
 *   GET /sse + POST /messages         MCP legacy SSE transport
 * Includes per-client token-bucket rate limiting, a bounded worker queue and optional bearer auth.
 */
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './mcp.js';
import { listTemplates, getTemplateProps, updateTemplateProps, renderAsset, batchLocalizeTool, ToolError, type AgentContext } from './tools.js';
import { renderToFile } from '@game-artisan/runtime';
import { PropsValidationError } from '@game-artisan/core';

export interface ServeOptions {
  port?: number;
  host?: string;
  /** Requests per minute per client IP (token bucket). Default 120. 0 disables. */
  rateLimitPerMinute?: number;
  /** Concurrent renders. Default 2. */
  concurrency?: number;
  /** Max queued renders before 503. Default 64. */
  maxQueue?: number;
  /** Require `Authorization: Bearer <apiKey>` (or x-api-key). */
  apiKey?: string;
  /** Max JSON body size in bytes. Default 25 MB. */
  maxBodyBytes?: number;
  log?: (msg: string) => void;
}

export class RateLimiter {
  private buckets = new Map<string, { tokens: number; last: number }>();
  constructor(private perMinute: number, private burst = Math.max(1, Math.ceil(perMinute / 4))) {}
  take(key: string, now = Date.now()): { ok: boolean; retryAfterSec: number } {
    if (this.perMinute <= 0) return { ok: true, retryAfterSec: 0 };
    const rate = this.perMinute / 60000;
    const b = this.buckets.get(key) ?? { tokens: this.burst, last: now };
    b.tokens = Math.min(this.burst, b.tokens + (now - b.last) * rate);
    b.last = now;
    this.buckets.set(key, b);
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return { ok: true, retryAfterSec: 0 };
    }
    return { ok: false, retryAfterSec: Math.ceil((1 - b.tokens) / rate / 1000) };
  }
}

/** Bounded FIFO work queue with fixed concurrency. */
export class WorkQueue {
  active = 0;
  private waiting: (() => void)[] = [];
  completed = 0;
  failed = 0;
  constructor(readonly concurrency: number, readonly maxQueue: number) {}
  get queued(): number {
    return this.waiting.length;
  }
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.concurrency) {
      if (this.waiting.length >= this.maxQueue) throw Object.assign(new Error('Render queue is full, retry later'), { status: 503 });
      await new Promise<void>((r) => this.waiting.push(r));
    }
    this.active++;
    try {
      const r = await fn();
      this.completed++;
      return r;
    } catch (e) {
      this.failed++;
      throw e;
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}

function readBody(req: IncomingMessage, limit: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('Request body too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('Invalid JSON body'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body, null, 2));
  res.writeHead(status, { 'content-type': Buffer.isBuffer(body) ? headers['content-type'] ?? 'application/octet-stream' : 'application/json', 'content-length': String(data.length), ...headers });
  res.end(data);
}

function errorBody(e: unknown): { status: number; body: any } {
  const err = e as any;
  if (e instanceof ToolError) return { status: 400, body: { error: err.message, details: err.details } };
  if (e instanceof PropsValidationError) return { status: 400, body: err.toJSON() };
  if (/not found/i.test(err?.message ?? '')) return { status: 404, body: { error: err.message } };
  return { status: err?.status ?? 500, body: { error: err?.message ?? String(e) } };
}

export interface RunningServer {
  url: string;
  port: number;
  server: http.Server;
  queue: WorkQueue;
  close(): Promise<void>;
}

export async function startHttpServer(ctx: AgentContext, opts: ServeOptions = {}): Promise<RunningServer> {
  const log = opts.log ?? (() => {});
  const limiter = new RateLimiter(opts.rateLimitPerMinute ?? 120);
  const queue = new WorkQueue(opts.concurrency ?? 2, opts.maxQueue ?? 64);
  const limit = opts.maxBodyBytes ?? 25 * 1024 * 1024;
  const started = Date.now();
  const sseTransports = new Map<string, SSEServerTransport>();
  const httpTransports = new Map<string, StreamableHTTPServerTransport>();

  const rpc = async (method: string, params: any) => {
    switch (method) {
      case 'list_templates':
      case 'artisan_list_compositions':
        return listTemplates(ctx);
      case 'get_template_props':
        return getTemplateProps(ctx, params);
      case 'update_template_props':
        return updateTemplateProps(ctx, params);
      case 'render_asset':
      case 'artisan_render':
        return queue.run(() => renderAsset(ctx, params));
      case 'batch_localize':
      case 'artisan_batch_localize':
        return queue.run(() => batchLocalizeTool(ctx, params));
      default:
        throw Object.assign(new Error(`Method not found: ${method}`), { rpcCode: -32601 });
    }
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const t0 = Date.now();
    res.on('finish', () => log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - t0}ms`));
    try {
      res.setHeader('access-control-allow-origin', '*');
      res.setHeader('access-control-allow-headers', 'content-type, authorization, x-api-key, mcp-session-id');
      if (req.method === 'OPTIONS') return send(res, 204, Buffer.alloc(0));
      if (url.pathname === '/health') {
        return send(res, 200, { status: 'ok', uptimeSec: Math.round((Date.now() - started) / 1000), compositions: ctx.project.compositions.length, queue: { active: queue.active, queued: queue.queued, completed: queue.completed, failed: queue.failed, concurrency: queue.concurrency, maxQueue: queue.maxQueue } });
      }
      if (opts.apiKey) {
        const auth = req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? req.headers['x-api-key'];
        if (auth !== opts.apiKey) return send(res, 401, { error: 'Unauthorized' });
      }
      const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
      const rl = limiter.take(ip);
      if (!rl.ok) return send(res, 429, { error: 'Rate limit exceeded', retryAfterSec: rl.retryAfterSec }, { 'retry-after': String(rl.retryAfterSec) });

      // --- MCP over HTTP
      if (url.pathname === '/mcp') {
        const sid = req.headers['mcp-session-id'] as string | undefined;
        let transport = sid ? httpTransports.get(sid) : undefined;
        const body = req.method === 'POST' ? await readBody(req, limit) : undefined;
        if (!transport) {
          transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID(), onsessioninitialized: (id) => void httpTransports.set(id, transport!) });
          transport.onclose = () => transport!.sessionId && httpTransports.delete(transport!.sessionId);
          await createMcpServer(ctx).connect(transport);
        }
        await transport.handleRequest(req as any, res, body);
        return;
      }
      if (url.pathname === '/sse' && req.method === 'GET') {
        const transport = new SSEServerTransport('/messages', res);
        sseTransports.set(transport.sessionId, transport);
        res.on('close', () => sseTransports.delete(transport.sessionId));
        await createMcpServer(ctx).connect(transport);
        return;
      }
      if (url.pathname === '/messages' && req.method === 'POST') {
        const transport = sseTransports.get(url.searchParams.get('sessionId') ?? '');
        if (!transport) return send(res, 404, { error: 'Unknown SSE session' });
        const body = await readBody(req, limit);
        await transport.handlePostMessage(req as any, res, body);
        return;
      }

      // --- REST
      if (url.pathname === '/compositions' && req.method === 'GET') return send(res, 200, listTemplates(ctx));
      const m = /^\/compositions\/([^/]+)$/.exec(url.pathname);
      if (m && req.method === 'GET') return send(res, 200, ctx.project.describe(decodeURIComponent(m[1])));
      if (url.pathname === '/render' && req.method === 'POST') {
        const body = await readBody(req, limit);
        if (!body.compositionId && !body.templateId) return send(res, 400, { error: 'compositionId is required' });
        const id = body.compositionId ?? body.templateId;
        const mode = body.response ?? (req.headers.accept?.includes('application/json') ? 'json' : 'binary');
        if (mode === 'file') {
          const r = await queue.run(() => renderAsset(ctx, { ...body, compositionId: id }));
          return send(res, 200, r);
        }
        const r = await queue.run(() => renderToFile(ctx.project, { compositionId: id, props: body.props, overrides: body.overrides, format: body.format, scale: body.scale, locale: body.locale, quality: body.quality, renderer: body.renderer }));
        if (mode === 'json') {
          const { buffer, ...rest } = r;
          return send(res, 200, { ...rest, base64: buffer.toString('base64') });
        }
        return send(res, 200, r.buffer, {
          'content-type': r.mime,
          'x-render-duration-ms': String(r.renderDurationMs),
          'x-dimensions': `${r.dimensions.width}x${r.dimensions.height}`,
          'content-disposition': `inline; filename="${id}.${r.format === 'jpeg' ? 'jpg' : r.format}"`,
        });
      }
      if (url.pathname === '/batch-localize' && req.method === 'POST') {
        const body = await readBody(req, limit);
        return send(res, 200, await queue.run(() => batchLocalizeTool(ctx, body)));
      }
      if (url.pathname === '/rpc' && req.method === 'POST') {
        const body = await readBody(req, limit);
        const calls = Array.isArray(body) ? body : [body];
        const results = await Promise.all(
          calls.map(async (c: any) => {
            try {
              if (c.jsonrpc !== '2.0' || typeof c.method !== 'string') return { jsonrpc: '2.0', id: c.id ?? null, error: { code: -32600, message: 'Invalid Request' } };
              const result = await rpc(c.method, c.params ?? {});
              return { jsonrpc: '2.0', id: c.id ?? null, result };
            } catch (e) {
              const eb = errorBody(e);
              return { jsonrpc: '2.0', id: c.id ?? null, error: { code: (e as any).rpcCode ?? (eb.status === 400 ? -32602 : -32000), message: eb.body.error ?? (e as Error).message, data: eb.body } };
            }
          }),
        );
        return send(res, 200, Array.isArray(body) ? results : results[0]);
      }
      return send(res, 404, { error: `No route for ${req.method} ${url.pathname}` });
    } catch (e) {
      const eb = errorBody(e);
      if (!res.headersSent) send(res, eb.status, eb.body);
      else res.end();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 4000, opts.host ?? '127.0.0.1', () => resolve());
  });
  const addr = server.address() as { port: number };
  const host = opts.host && opts.host !== '0.0.0.0' ? opts.host : '127.0.0.1';
  return {
    url: `http://${host}:${addr.port}`,
    port: addr.port,
    server,
    queue,
    close: () =>
      new Promise<void>((resolve) => {
        for (const t of sseTransports.values()) void t.close();
        for (const t of httpTransports.values()) void t.close();
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
