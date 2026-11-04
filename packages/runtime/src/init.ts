/** `artisan init` project scaffolding. */
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface InitOptions {
  dir: string;
  name?: string;
  force?: boolean;
  /** Use workspace:* deps (inside this monorepo) instead of npm versions. */
  workspace?: boolean;
}

const BG_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#101a3a"/><stop offset="1" stop-color="#5b2a6e"/></linearGradient></defs>
  <rect width="1280" height="720" fill="url(#sky)"/>
  <circle cx="930" cy="230" r="120" fill="#ffb86b" opacity="0.9"/>
  <path d="M0 540 L180 420 L340 500 L520 360 L720 520 L940 400 L1280 560 L1280 720 L0 720Z" fill="#1c1030"/>
</svg>
`;

const HERO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="600" viewBox="0 0 300 600">
  <circle cx="150" cy="90" r="60" fill="#f2d2b0"/>
  <path d="M60 180 Q150 140 240 180 L270 440 L180 440 L170 600 L130 600 L120 440 L30 440Z" fill="#2d6cdf"/>
  <rect x="235" y="40" width="14" height="330" rx="4" fill="#e6f0ff" transform="rotate(18 242 205)"/>
</svg>
`;

export function templateFiles(name: string, workspace = false): Record<string, string> {
  const v = (pkg: string) => (workspace ? 'workspace:*' : pkg.startsWith('@game-artisan') ? '^1.0.0' : 'latest');
  return {
    'package.json': JSON.stringify(
      {
        name,
        private: true,
        type: 'module',
        scripts: { list: 'artisan list', render: 'artisan render key-art --out=out/key-art.png', studio: 'artisan studio', batch: 'artisan batch --data=variants.json --compositions=all --out=dist/' },
        dependencies: { '@game-artisan/cli': v('@game-artisan/cli'), '@game-artisan/core': v('@game-artisan/core'), '@game-artisan/runtime': v('@game-artisan/runtime'), '@game-artisan/templates-game': v('@game-artisan/templates-game'), react: '^19.0.0', zod: '^4.1.0' },
        devDependencies: { '@types/react': '^19.0.0', typescript: '^5.9.0' },
      },
      null,
      2,
    ) + '\n',
    'artisan.config.ts': `import { defineConfig } from '@game-artisan/runtime';

export default defineConfig({
  entry: 'src/index.tsx',
  assetsDir: 'assets',
  outDir: 'out',
  includeBuiltinTemplates: true,
  defaultFormat: 'png',
  locales: ['en', 'ja', 'de'],
});
`,
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', strict: true, skipLibCheck: true } }, null, 2) + '\n',
    'src/index.tsx': `import { Composition, Layer, Text, Shadow, registerRoot, resolveLocale, zColor, zImage, z } from '@game-artisan/core';

export const KeyArtSchema = z.object({
  title: z.string().default('${name.toUpperCase().replace(/[-_]/g, ' ')}'),
  tagline: z.string().default('A hand-crafted adventure'),
  background: zImage('assets/background.svg'),
  hero: zImage('assets/hero.svg'),
  accent: zColor('#ff3366'),
  heroX: z.number().default(820),
  localeMap: z.record(z.string(), z.object({ title: z.string().optional(), tagline: z.string().optional() })).default({ ja: { tagline: '手作りの冒険' } }),
});

export function KeyArt(p: z.infer<typeof KeyArtSchema>) {
  const loc = resolveLocale(p.localeMap) ?? {};
  return (
    <div style={{ width: 1232, height: 706, backgroundColor: '#05050a', fontFamily: 'Inter' }}>
      <Layer.Image src={p.background} width={1232} height={706} style={{ filter: 'contrast(1.1) saturate(1.2)' }} />
      <Layer.Gradient type="linear" angle={90} colors={['rgba(5,5,10,0.9)', 'transparent']} stops={[0.1, 0.6]} />
      <Layer.Image id="hero" src={p.hero} x={p.heroX} y={60} height={640} bind={{ x: 'heroX' }} effects={[Shadow.glow(p.accent, { radius: 4, blur: 30 })]} />
      <div style={{ position: 'absolute', left: 64, bottom: 72, maxWidth: 640 }}>
        <Text content={loc.tagline ?? p.tagline} style={{ fontSize: 26, fontWeight: 700, color: p.accent, textTransform: 'uppercase', letterSpacing: 4 }} />
        <Text content={loc.title ?? p.title} fit="shrink" style={{ fontSize: 96, fontWeight: 900, color: '#fff', lineHeight: 1, textShadow: '0 6px 24px rgba(0,0,0,0.8)' }} />
      </div>
    </div>
  );
}

registerRoot(() => (
  <>
    <Composition id="key-art" name="Key Art (2x Steam main capsule)" width={1232} height={706} component={KeyArt} schema={KeyArtSchema} defaultProps={{}} />
  </>
));
`,
    'variants.json': JSON.stringify({ variants: [{ id: 'en', locale: 'en' }, { id: 'ja', locale: 'ja' }, { id: 'sale', locale: 'en', props: { tagline: 'Now 40% off' } }] }, null, 2) + '\n',
    'assets/background.svg': BG_SVG,
    'assets/hero.svg': HERO_SVG,
    '.gitignore': 'node_modules/\nout/\ndist/\n.artisan/\n',
    'README.md': `# ${name}\n\nGameArtisan marketing-asset project.\n\n\`\`\`bash\nnpx artisan list\nnpx artisan render key-art --out=out/key-art.png --scale=2\nnpx artisan studio\n\`\`\`\n`,
  };
}

export async function initProject(opts: InitOptions): Promise<string[]> {
  const dir = path.resolve(opts.dir);
  const name = opts.name ?? path.basename(dir).toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const files = templateFiles(name, opts.workspace);
  const written: string[] = [];
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    if (existsSync(p) && !opts.force) continue;
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, content);
    written.push(rel);
  }
  return written;
}
