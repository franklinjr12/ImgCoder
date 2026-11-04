/**
 * Batch & matrix localisation rendering (US-2.5): compositions × variants (× scales × formats)
 * across a worker_threads pool with progress events, per-item timing, retries and a JSON report.
 */
import { Worker } from 'node:worker_threads';
import os from 'node:os';
import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import type { OutputFormat } from '@game-artisan/renderer-svg/node';
import { ArtisanProject, type LoadProjectOptions } from './project.js';
import { renderToFile, expandPattern, closeChromiumRenderer } from './render.js';

export interface BatchVariant {
  id: string;
  locale?: string;
  props?: Record<string, unknown>;
  /** Per-composition prop overrides: { "steam-header-capsule": { … } } */
  compositions?: Record<string, Record<string, unknown>>;
}

export interface BatchJob {
  index: number;
  compositionId: string;
  variant: BatchVariant;
  format: OutputFormat;
  scale: number;
  outputPath: string;
}

export interface BatchItemResult {
  index: number;
  compositionId: string;
  variant: string;
  locale?: string;
  outputPath: string;
  status: 'success' | 'error';
  error?: string;
  attempts: number;
  renderDurationMs: number;
  fileSizeBytes?: number;
  dimensions?: { width: number; height: number };
}

export interface BatchProgress {
  done: number;
  total: number;
  failed: number;
  item: BatchItemResult;
  elapsedMs: number;
  etaMs: number;
}

export interface BatchOptions extends LoadProjectOptions {
  /** Variant data: a parsed object or a JSON file path. */
  data?: string | unknown;
  /** Composition ids, 'all', or glob-ish prefixes (e.g. "steam-*"). */
  compositions?: string[] | 'all';
  outDir?: string;
  formats?: OutputFormat[];
  scales?: number[];
  pattern?: string;
  /** Worker threads (1 = in-process). */
  concurrency?: number;
  retries?: number;
  renderer?: 'svg' | 'chromium' | 'auto';
  onProgress?: (p: BatchProgress) => void;
  /** Write batch-report.json to outDir. Default true. */
  report?: boolean;
}

export interface BatchSummary {
  total: number;
  succeeded: number;
  failed: number;
  durationMs: number;
  avgRenderMs: number;
  outDir: string;
  items: BatchItemResult[];
  reportPath?: string;
}

/** Normalise the many accepted data-file shapes into a variant list. */
export function normalizeVariants(data: unknown): BatchVariant[] {
  if (data == null) return [{ id: 'default' }];
  if (Array.isArray(data)) return data.map((v, i) => normalizeOne(v, String(i)));
  if (typeof data === 'object') {
    const obj = data as Record<string, any>;
    if (Array.isArray(obj.variants)) return obj.variants.map((v: any, i: number) => normalizeOne(v, String(i)));
    if (obj.locales && typeof obj.locales === 'object' && !Array.isArray(obj.locales)) {
      return Object.entries(obj.locales).map(([locale, props]) => ({ id: locale, locale, props: props as Record<string, unknown> }));
    }
    if (Array.isArray(obj.locales) && obj.localizationData) {
      return (obj.locales as string[]).map((locale) => ({ id: locale, locale, props: obj.localizationData[locale] ?? {} }));
    }
    // { en: {...}, ja: {...} } locale map
    return Object.entries(obj).map(([locale, props]) => ({ id: locale, locale, props: (props ?? {}) as Record<string, unknown> }));
  }
  throw new Error('Unsupported batch data format');
}

function normalizeOne(v: any, fallbackId: string): BatchVariant {
  if (typeof v === 'string') return { id: v, locale: v };
  const id = String(v.id ?? v.name ?? v.locale ?? fallbackId);
  return { id, locale: v.locale, props: v.props ?? {}, compositions: v.compositions };
}

export function selectCompositions(all: string[], wanted: string[] | 'all' | undefined): string[] {
  if (!wanted || wanted === 'all' || (wanted.length === 1 && wanted[0] === 'all')) return all;
  const out: string[] = [];
  for (const w of wanted) {
    if (w.includes('*')) {
      const re = new RegExp(`^${w.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
      out.push(...all.filter((id) => re.test(id)));
    } else {
      if (!all.includes(w)) throw new Error(`Unknown composition "${w}". Available: ${all.join(', ')}`);
      out.push(w);
    }
  }
  return [...new Set(out)];
}

export async function planBatch(project: ArtisanProject, opts: BatchOptions): Promise<BatchJob[]> {
  let data = opts.data;
  if (typeof data === 'string') data = JSON.parse(await readFile(path.resolve(project.root, data), 'utf8'));
  const variants = normalizeVariants(data);
  const ids = selectCompositions(project.compositions.map((c) => c.id), opts.compositions);
  const outDir = path.resolve(project.root, opts.outDir ?? project.config.outDir);
  const formats = opts.formats?.length ? opts.formats : [undefined];
  const scales = opts.scales?.length ? opts.scales : [project.config.scale ?? 1];
  const pattern = opts.pattern ?? project.config.outputPattern ?? (variants.length > 1 ? '{variant}/{composition}{scaleSuffix}.{ext}' : '{composition}{scaleSuffix}.{ext}');
  const jobs: BatchJob[] = [];
  for (const variant of variants)
    for (const id of ids) {
      const def = project.get(id);
      for (const f of formats)
        for (const scale of scales) {
          const format = (f ?? project.config.defaultFormat ?? def.defaultFormat ?? 'png') as OutputFormat;
          const ext = format === 'jpeg' ? 'jpg' : format;
          const rel = expandPattern(pattern, {
            variant: variant.id,
            locale: variant.locale ?? variant.id,
            composition: id,
            scale,
            scaleSuffix: scale === 1 ? '' : `@${scale}x`,
            format,
            ext,
            width: def.width * scale,
            height: def.height * scale,
          });
          jobs.push({ index: jobs.length, compositionId: id, variant, format, scale, outputPath: path.join(outDir, rel) });
        }
    }
  return jobs;
}

export async function runJob(project: ArtisanProject, job: BatchJob, renderer?: BatchOptions['renderer']) {
  const props = { ...(job.variant.props ?? {}), ...(job.variant.compositions?.[job.compositionId] ?? {}) };
  const def = project.get(job.compositionId);
  // Only pass props the composition knows about when it has a strict schema → drop unknown keys silently.
  return renderToFile(project, { compositionId: def.id, props, locale: job.variant.locale, format: job.format, scale: job.scale, outputPath: job.outputPath, renderer });
}

const workerUrl = (): URL => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const js = path.join(here, 'worker.js');
  if (existsSync(js)) return new URL(`file://${js}`);
  // Running from TypeScript sources (tests): use the dist build if present, else the TS file via tsx loader.
  const dist = path.resolve(here, '../dist/worker.js');
  if (existsSync(dist)) return new URL(`file://${dist}`);
  return new URL(`file://${path.join(here, 'worker.ts')}`);
};

export async function runBatch(opts: BatchOptions): Promise<BatchSummary> {
  const t0 = performance.now();
  const project = await ArtisanProject.load(opts);
  const jobs = await planBatch(project, opts);
  const outDir = path.resolve(project.root, opts.outDir ?? project.config.outDir);
  await mkdir(outDir, { recursive: true });
  const total = jobs.length;
  const results: BatchItemResult[] = [];
  let failed = 0;
  const retries = opts.retries ?? 1;
  const emit = (item: BatchItemResult) => {
    results.push(item);
    if (item.status === 'error') failed++;
    const elapsed = performance.now() - t0;
    const done = results.length;
    opts.onProgress?.({ done, total, failed, item, elapsedMs: elapsed, etaMs: done ? (elapsed / done) * (total - done) : 0 });
  };
  const toItem = (job: BatchJob, r: any, attempts: number, err?: unknown): BatchItemResult => ({
    index: job.index,
    compositionId: job.compositionId,
    variant: job.variant.id,
    locale: job.variant.locale,
    outputPath: job.outputPath,
    status: err ? 'error' : 'success',
    error: err ? (err as Error).message ?? String(err) : undefined,
    attempts,
    renderDurationMs: r?.renderDurationMs ?? 0,
    fileSizeBytes: r?.fileSizeBytes,
    dimensions: r?.dimensions,
  });

  const concurrency = Math.max(1, Math.min(opts.concurrency ?? project.config.concurrency ?? Math.max(1, os.cpus().length - 1), total || 1));
  const useWorkers = concurrency > 1 && total > 1 && opts.renderer !== 'chromium';
  if (!useWorkers) {
    for (const job of jobs) {
      let attempts = 0;
      for (;;) {
        attempts++;
        try {
          const r = await runJob(project, job, opts.renderer);
          emit(toItem(job, r, attempts));
          break;
        } catch (e) {
          if (attempts > retries) {
            emit(toItem(job, null, attempts, e));
            break;
          }
        }
      }
    }
    await closeChromiumRenderer();
  } else {
    await new Promise<void>((resolve, reject) => {
      const queue = [...jobs];
      const attemptsMap = new Map<number, number>();
      let active = 0;
      const workers: Worker[] = [];
      const workerData = { cwd: opts.cwd, configFile: opts.configFile, entry: opts.entry, builtinTemplates: opts.builtinTemplates, documents: opts.documents, renderer: opts.renderer };
      const url = workerUrl();
      const isTs = url.pathname.endsWith('.ts');
      const finishIfDone = () => {
        if (results.length === total) {
          workers.forEach((w) => w.terminate());
          resolve();
        }
      };
      const feed = (w: Worker) => {
        const job = queue.shift();
        if (!job) return;
        active++;
        attemptsMap.set(job.index, (attemptsMap.get(job.index) ?? 0) + 1);
        w.postMessage({ type: 'job', job });
      };
      for (let i = 0; i < concurrency; i++) {
        const w = new Worker(url, { workerData, execArgv: isTs ? ['--import', 'tsx'] : undefined });
        workers.push(w);
        w.on('message', (msg: any) => {
          if (msg.type === 'ready') {
            feed(w);
            return;
          }
          if (msg.type === 'result' || msg.type === 'error') {
            active--;
            const job: BatchJob = msg.job;
            const attempts = attemptsMap.get(job.index) ?? 1;
            if (msg.type === 'error' && attempts <= retries) queue.unshift(job);
            else emit(toItem(job, msg.result, attempts, msg.type === 'error' ? new Error(msg.error) : undefined));
            feed(w);
            finishIfDone();
          }
          if (msg.type === 'fatal') reject(new Error(`Batch worker failed to start: ${msg.error}`));
        });
        w.on('error', (e) => reject(e));
      }
      void active;
    });
  }

  results.sort((a, b) => a.index - b.index);
  const durationMs = Math.round(performance.now() - t0);
  const ok = results.filter((r) => r.status === 'success');
  const summary: BatchSummary = {
    total,
    succeeded: ok.length,
    failed,
    durationMs,
    avgRenderMs: ok.length ? Math.round(ok.reduce((a, r) => a + r.renderDurationMs, 0) / ok.length) : 0,
    outDir,
    items: results,
  };
  if (opts.report !== false) {
    summary.reportPath = path.join(outDir, 'batch-report.json');
    await writeFile(summary.reportPath, JSON.stringify(summary, null, 2));
  }
  return summary;
}
