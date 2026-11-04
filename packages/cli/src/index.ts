/**
 * `artisan` CLI (US-2.1, 2.5, 6.1–6.3, 8.1). Exported `run()` makes it testable and embeddable.
 */
import { Command, Option } from 'commander';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { getUdmJsonSchema, validateDocument, PropsValidationError } from '@game-artisan/core';
import { ArtisanProject, renderToFile, runBatch, initProject, closeChromiumRenderer, type OutputFormat } from '@game-artisan/runtime';
import { ProgressBar, fmtBytes, fmtMs } from './progress.js';

export interface CliIO {
  out: (s: string) => void;
  err: (s: string) => void;
}

const defaultIO: CliIO = { out: (s) => process.stdout.write(s.endsWith('\n') ? s : `${s}\n`), err: (s) => process.stderr.write(s.endsWith('\n') ? s : `${s}\n`) };

async function parseJsonArg(value: string | undefined, cwd: string): Promise<Record<string, unknown> | undefined> {
  if (!value) return undefined;
  const v = value.trim();
  if (v.startsWith('{') || v.startsWith('[')) return JSON.parse(v);
  const file = v.startsWith('@') ? v.slice(1) : v;
  return JSON.parse(await readFile(path.resolve(cwd, file), 'utf8'));
}

const list = (v: string) => v.split(',').map((s) => s.trim()).filter(Boolean);

function table(rows: string[][]): string {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => (r[i] ?? '').length)));
  return rows.map((r) => r.map((c, i) => (c ?? '').padEnd(widths[i])).join('  ').trimEnd()).join('\n');
}

export function createProgram(io: CliIO = defaultIO): Command {
  const program = new Command();
  program
    .name('artisan')
    .description('GameArtisan — code-as-canvas game marketing asset generator')
    .version('1.0.0')
    .option('-C, --cwd <dir>', 'project directory', process.cwd())
    .option('-c, --config <file>', 'config file (artisan.config.ts)')
    .option('-e, --entry <file>', 'composition entry (overrides config)')
    .option('--builtins', 'include built-in game templates')
    .option('--no-builtins', 'exclude built-in game templates')
    .showHelpAfterError();

  const load = async (extraDocs?: string[]) => {
    const g = program.opts();
    return ArtisanProject.load({ cwd: g.cwd, configFile: g.config, entry: g.entry, builtinTemplates: g.builtins, documents: extraDocs });
  };

  program
    .command('list')
    .description('list registered compositions, dimensions and props')
    .option('--json', 'machine-readable output')
    .option('-p, --platform <name>', 'filter by platform')
    .action(async (o) => {
      const project = await load();
      let items = project.list();
      if (o.platform) items = items.filter((c) => c.platform === o.platform);
      if (o.json) return io.out(JSON.stringify(items, null, 2));
      if (!items.length) return io.out('No compositions found. Create one with `artisan init` or add an entry in artisan.config.ts.');
      const rows = [['ID', 'SIZE', 'PLATFORM', 'PROPS', 'NAME']];
      for (const c of items) rows.push([c.id, `${c.width}×${c.height}`, c.platform ?? c.folder ?? '-', Object.keys((c.propsSchema as any).properties ?? {}).join(',').slice(0, 48) || '-', c.name]);
      io.out(table(rows));
      io.out(`\n${items.length} composition(s)`);
      for (const w of project.warnings) io.err(`warning: ${w}`);
    });

  program
    .command('inspect <compositionId>')
    .description('print the JSON Schema of a composition’s props (and metadata)')
    .option('--full', 'include metadata (size, defaults, safe zones)')
    .action(async (id, o) => {
      const project = await load();
      const info = project.describe(id);
      io.out(JSON.stringify(o.full ? info : info.propsSchema, null, 2));
    });

  program
    .command('render <composition>')
    .description('render a composition (id or .artisan.json document) to PNG/JPEG/WebP/AVIF/SVG/PDF')
    .option('-p, --props <json|file>', "props as JSON ('{...}') or a JSON file path (@file.json)")
    .option('--overrides <json|file>', 'layer overrides JSON')
    .option('-o, --out <file>', 'output file (format inferred from extension)')
    .addOption(new Option('-f, --format <format>', 'output format').choices(['png', 'jpeg', 'jpg', 'webp', 'avif', 'svg', 'pdf']))
    .option('-s, --scale <n>', 'pixel density multiplier (1, 2, 4, …)', parseFloat)
    .option('-l, --locale <locale>', 'target locale (localeMap swap, CJK fallback)')
    .addOption(new Option('-r, --renderer <renderer>', 'renderer').choices(['svg', 'chromium', 'auto']))
    .option('-q, --quality <n>', 'lossy quality 1-100', parseInt)
    .option('--lossless', 'lossless WebP/AVIF')
    .option('--transparent', 'omit the artboard background')
    .addOption(new Option('--svg-text <mode>', 'SVG text: outline | embedded | linked').choices(['outline', 'embedded', 'linked']))
    .option('--max-size <bytes>', 'shrink quality until the file fits', parseInt)
    .option('--json', 'print a JSON result')
    .action(async (composition: string, o) => {
      const isDoc = composition.endsWith('.json');
      const project = await load();
      let id = composition;
      if (isDoc) id = (await project.addDocumentFile(composition))[0].id;
      const props = await parseJsonArg(o.props, project.root);
      const overrides = await parseJsonArg(o.overrides, project.root);
      const format = (o.format === 'jpg' ? 'jpeg' : o.format) as OutputFormat | undefined;
      const ext = format ? (format === 'jpeg' ? 'jpg' : format) : 'png';
      const out = o.out ?? path.join(path.relative(project.root, project.config.outDir), `${id}${o.scale && o.scale !== 1 ? `@${o.scale}x` : ''}.${ext}`);
      try {
        const r = await renderToFile(project, { compositionId: id, props, overrides: overrides as any, format, scale: o.scale, locale: o.locale, renderer: o.renderer, outputPath: out, quality: o.quality, lossless: o.lossless, transparent: o.transparent, svgText: o.svgText, maxFileSizeBytes: o.maxSize });
        const { buffer, ...rest } = r;
        if (o.json) io.out(JSON.stringify(rest, null, 2));
        else io.out(`✔ ${rest.outputPath}  ${rest.dimensions.width}×${rest.dimensions.height} ${rest.format}  ${fmtBytes(rest.fileSizeBytes)}  ${fmtMs(rest.renderDurationMs)} (${rest.renderer})`);
        for (const w of rest.warnings) io.err(`warning: ${w}`);
      } finally {
        await closeChromiumRenderer();
      }
    });

  program
    .command('batch')
    .description('render compositions × variants (e.g. 30 languages × 6 capsules) in parallel')
    .option('-d, --data <file>', 'variants/localization data JSON')
    .option('--compositions <ids>', "comma separated ids, globs (steam-*) or 'all'", 'all')
    .option('-o, --out <dir>', 'output directory')
    .option('--formats <list>', 'formats, e.g. png,webp', list)
    .option('--scales <list>', 'scales, e.g. 1,2', (v) => list(v).map(Number))
    .option('--pattern <pattern>', 'output path pattern: {variant} {locale} {composition} {scale} {scaleSuffix} {format} {ext} {width} {height}')
    .option('-j, --concurrency <n>', 'worker threads', parseInt)
    .option('--retries <n>', 'retries per item', parseInt)
    .addOption(new Option('-r, --renderer <renderer>').choices(['svg', 'chromium', 'auto']))
    .option('--json', 'print the JSON summary')
    .action(async (o) => {
      const g = program.opts();
      const bar = { current: null as ProgressBar | null };
      const summary = await runBatch({
        cwd: g.cwd,
        configFile: g.config,
        entry: g.entry,
        builtinTemplates: g.builtins,
        data: o.data,
        compositions: o.compositions === 'all' ? 'all' : list(o.compositions),
        outDir: o.out,
        formats: o.formats,
        scales: o.scales,
        pattern: o.pattern,
        concurrency: o.concurrency,
        retries: o.retries,
        renderer: o.renderer,
        onProgress: (p) => {
          bar.current ??= new ProgressBar(p.total);
          if (p.item.status === 'error') bar.current.log(`✖ ${p.item.variant}/${p.item.compositionId}: ${p.item.error}`);
          bar.current.update(p.done, p.failed, `${p.item.variant}/${p.item.compositionId} ${p.item.renderDurationMs}ms`, p.elapsedMs, p.etaMs);
        },
      });
      bar.current?.finish();
      if (o.json) io.out(JSON.stringify(summary, null, 2));
      else io.out(`${summary.failed ? '⚠' : '✔'} ${summary.succeeded}/${summary.total} rendered in ${fmtMs(summary.durationMs)} (avg ${summary.avgRenderMs}ms/item) → ${summary.outDir}\n  report: ${summary.reportPath}`);
      if (summary.failed) process.exitCode = 1;
    });

  program
    .command('studio')
    .description('open the visual studio (Canva-like editor) for this project')
    .option('-p, --port <n>', 'port', parseInt)
    .option('--host <host>', 'host')
    .option('--open', 'open a browser')
    .action(async (o) => {
      const g = program.opts();
      const project = await load();
      const spec = '@game-artisan/studio';
      const studio: any = await import(/* @vite-ignore */ spec).catch((e) => {
        throw new Error(`@game-artisan/studio is not installed (${e.message})`);
      });
      const fontFiles = (project.config.fonts?.files ?? []).map((f: any) => path.resolve(project.root, typeof f === 'string' ? f : f.path));
      const s = await studio.startStudio({
        root: project.root,
        entry: project.entryFile,
        assetsDir: project.config.assetsDir,
        documentsDir: path.join(project.root, 'designs'),
        fontFiles,
        includeBuiltinTemplates: g.builtins ?? project.config.includeBuiltinTemplates ?? !project.entryFile,
        port: o.port ?? project.config.studio?.port ?? 3210,
        host: o.host ?? project.config.studio?.host,
        open: o.open,
      });
      io.out(`GameArtisan Studio running at ${s.url}`);
    });

  program
    .command('serve')
    .description('run the HTTP render microservice (POST /render, GET /health, /rpc, /mcp)')
    .option('-p, --port <n>', 'port', parseInt)
    .option('--host <host>', 'host', '127.0.0.1')
    .option('--rate-limit <n>', 'requests per minute per client (0 = off)', parseInt)
    .option('-j, --concurrency <n>', 'concurrent renders', parseInt)
    .option('--max-queue <n>', 'max queued renders', parseInt)
    .option('--api-key <key>', 'require bearer token (or ARTISAN_API_KEY env)')
    .action(async (o) => {
      const project = await load();
      const { startHttpServer } = await import('@game-artisan/agent-sdk');
      const { TemplateStateStore } = await import('@game-artisan/runtime');
      const cfg = project.config.server ?? {};
      const s = await startHttpServer(
        { project, state: TemplateStateStore.forProject(project.root), outDir: project.config.outDir },
        {
          port: o.port ?? cfg.port ?? 4000,
          host: o.host ?? cfg.host,
          rateLimitPerMinute: o.rateLimit ?? cfg.rateLimitPerMinute,
          concurrency: o.concurrency ?? cfg.concurrency,
          maxQueue: o.maxQueue ?? cfg.maxQueue,
          apiKey: o.apiKey ?? cfg.apiKey ?? process.env.ARTISAN_API_KEY,
          log: (m) => io.err(m),
        },
      );
      io.out(`GameArtisan render server listening on ${s.url}  (POST /render, GET /health, POST /rpc, /mcp, /sse)`);
    });

  program
    .command('mcp')
    .description('run the Model Context Protocol server for AI agents')
    .addOption(new Option('-t, --transport <t>', 'transport').choices(['stdio', 'sse', 'http']).default('stdio'))
    .option('-p, --port <n>', 'port for sse/http', parseInt, 4100)
    .action(async (o) => {
      const project = await load();
      const { runStdioServer, startHttpServer } = await import('@game-artisan/agent-sdk');
      const { TemplateStateStore } = await import('@game-artisan/runtime');
      const ctx = { project, state: TemplateStateStore.forProject(project.root), outDir: project.config.outDir };
      if (o.transport === 'stdio') await runStdioServer(ctx);
      else {
        const s = await startHttpServer(ctx, { port: o.port, rateLimitPerMinute: 0 });
        io.err(`MCP server: ${o.transport === 'sse' ? `${s.url}/sse` : `${s.url}/mcp`}`);
      }
    });

  program
    .command('agent:matrix <compositionId>')
    .description('generate A/B prop variations from marketing goals with an AI agent and render a contact sheet')
    .option('-g, --goal <text>', 'marketing goal (repeatable)', (v, prev: string[] = []) => [...prev, v])
    .option('--goals <file>', 'JSON file: ["goal", …] or [{ label, prompt }, …]')
    .option('-n, --count <n>', 'variants per goal', parseInt)
    .option('--props <json|file>', 'base props')
    .addOption(new Option('--provider <name>', 'variant provider').choices(['anthropic', 'heuristic', 'command']).default('anthropic'))
    .option('--model <id>', 'Claude model id', 'claude-opus-5-5')
    .option('--command <cmd>', 'external agent command for --provider=command')
    .option('-o, --out <dir>', 'output directory', 'out/variants')
    .option('--columns <n>', 'contact sheet columns', parseInt)
    .action(async (id, o) => {
      const project = await load();
      const { runVariantMatrix, providerFromName } = await import('@game-artisan/agent-sdk');
      const { TemplateStateStore } = await import('@game-artisan/runtime');
      let goals: { label?: string; prompt: string }[] = (o.goal ?? []).map((g: string) => ({ prompt: g }));
      if (o.goals) {
        const data = JSON.parse(await readFile(path.resolve(project.root, o.goals), 'utf8'));
        goals.push(...(data as any[]).map((g) => (typeof g === 'string' ? { prompt: g } : g)));
      }
      if (!goals.length) goals = [{ prompt: 'Make variations emphasizing the character vs the action screenshot' }];
      const r = await runVariantMatrix(
        { project, state: TemplateStateStore.forProject(project.root), outDir: project.config.outDir },
        { compositionId: id, goals, perGoal: o.count, baseProps: await parseJsonArg(o.props, project.root), provider: providerFromName(o.provider, { model: o.model, command: o.command }), outDir: o.out, columns: o.columns, onProgress: (m) => io.err(m) },
      );
      io.out(`✔ ${r.variants.filter((v) => !v.error).length}/${r.variants.length} variants rendered\n  contact sheet: ${r.contactSheet}\n  report: ${r.report}`);
    });

  program
    .command('init [dir]')
    .description('scaffold a new GameArtisan project')
    .option('-n, --name <name>', 'package name')
    .option('--force', 'overwrite existing files')
    .option('--workspace', 'use workspace:* dependencies (inside the GameArtisan monorepo)')
    .action(async (dir = '.', o) => {
      const g = program.opts();
      const written = await initProject({ dir: path.resolve(g.cwd, dir), name: o.name, force: o.force, workspace: o.workspace });
      io.out(written.length ? `Created ${written.length} files in ${path.resolve(g.cwd, dir)}:\n  ${written.join('\n  ')}\n\nNext: npm install && npx artisan list` : 'Nothing to do (files exist; use --force).');
    });

  program
    .command('presets')
    .description('list store asset presets (Steam, Itch, Epic, consoles, social)')
    .option('-p, --platform <name>')
    .option('--json')
    .action(async (o) => {
      const tgSpec = '@game-artisan/templates-game';
      const tg: any = await import(/* @vite-ignore */ tgSpec);
      let presets = Object.values(tg.STORE_PRESETS) as any[];
      if (o.platform) presets = presets.filter((p) => p.platform === o.platform);
      if (o.json) return io.out(JSON.stringify(presets, null, 2));
      const rows = [['ID', 'PLATFORM', 'SIZE', 'FORMAT', 'NAME']];
      for (const p of presets) rows.push([p.id, p.platform, `${p.width}×${p.height}`, p.requiredFormat, p.name]);
      io.out(table(rows));
    });

  program
    .command('validate <file>')
    .description('validate a UDM document (.artisan.json)')
    .action(async (file) => {
      const g = program.opts();
      const r = validateDocument(JSON.parse(await readFile(path.resolve(g.cwd, file), 'utf8')));
      if (r.ok) io.out(`✔ valid: ${r.document.name} (${r.document.artboards.length} artboard(s))`);
      else {
        io.err(`✖ invalid document:\n${r.issues.map((i) => `  • ${i.path}: ${i.message}`).join('\n')}`);
        process.exitCode = 1;
      }
    });

  program
    .command('schema [target]')
    .description('print the UDM JSON Schema (document | artboard | layer)')
    .action((target = 'document') => io.out(JSON.stringify(getUdmJsonSchema(target), null, 2)));

  program
    .command('bench [compositionId]')
    .description('benchmark render time (default: built-in Steam main capsule @2x)')
    .option('-n, --runs <n>', 'iterations', parseInt, 10)
    .option('-s, --scale <n>', 'scale', parseFloat, 2)
    .action(async (id, o) => {
      const project = await load();
      const target = id ?? (project.compositions.find((c) => c.id === 'steam-main-capsule')?.id ?? project.compositions[0]?.id);
      if (!target) throw new Error('No composition to benchmark');
      await renderToFile(project, { compositionId: target, scale: o.scale }); // warm-up (fonts, yoga, JIT)
      const times: number[] = [];
      for (let i = 0; i < o.runs; i++) times.push((await renderToFile(project, { compositionId: target, scale: o.scale })).renderDurationMs);
      times.sort((a, b) => a - b);
      const def = project.get(target);
      io.out(`${target} @${o.scale}x (${def.width * o.scale}×${def.height * o.scale}): median ${times[Math.floor(times.length / 2)]}ms, p90 ${times[Math.floor(times.length * 0.9)]}ms, min ${times[0]}ms over ${o.runs} runs`);
    });

  return program;
}

/** Run the CLI with argv (`process.argv`-style). Returns the exit code. */
export async function run(argv: string[] = process.argv, io: CliIO = defaultIO): Promise<number> {
  const program = createProgram(io);
  program.exitOverride();
  try {
    await program.parseAsync(argv);
    return typeof process.exitCode === 'number' ? process.exitCode : 0;
  } catch (e: any) {
    if (e?.code === 'commander.helpDisplayed' || e?.code === 'commander.version' || e?.code === 'commander.help') return 0;
    if (e?.code?.startsWith?.('commander.')) return e.exitCode ?? 1;
    if (e instanceof PropsValidationError) io.err(e.message);
    else io.err(`✖ ${e?.message ?? e}`);
    if (process.env.ARTISAN_DEBUG) io.err(e?.stack ?? '');
    return 1;
  }
}

export { ProgressBar };
export const _exists = existsSync;
