/**
 * Chromium discovery. Order: explicit `executablePath` → `ARTISAN_CHROMIUM_PATH` → playwright-core's
 * own registry (PLAYWRIGHT_BROWSERS_PATH / ~/.cache/ms-playwright) → globbing well-known browser
 * folders (`/opt/pw-browsers/chromium*`, …).
 */
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type LaunchOptions } from 'playwright-core';

export interface BrowserLaunchOptions {
  executablePath?: string;
  headless?: boolean;
  /** Extra Chromium flags (appended to the defaults). */
  launchArgs?: string[];
  /** Launch timeout (ms). Default 30000. */
  timeoutMs?: number;
  /** Network proxy for the browser (and for remote-asset fetches made on its behalf). */
  proxy?: LaunchOptions['proxy'];
}

/** Flags tuned for deterministic, sandbox-free headless rendering. */
export const DEFAULT_CHROMIUM_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--hide-scrollbars',
  '--mute-audio',
  '--force-color-profile=srgb',
  '--font-render-hinting=none',
  '--disable-lcd-text',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  // WebGL in headless without a GPU (SwiftShader)
  '--ignore-gpu-blocklist',
  '--enable-unsafe-swiftshader',
  '--use-angle=swiftshader',
];

const EXECUTABLE_CANDIDATES = [
  'chrome-linux64/chrome',
  'chrome-linux/chrome',
  'chrome-headless-shell-linux64/chrome-headless-shell',
  'chrome-linux/headless_shell',
  'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
  'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  'chrome-headless-shell-mac-arm64/chrome-headless-shell',
  'chrome-headless-shell-mac-x64/chrome-headless-shell',
  'chrome-win/chrome.exe',
  'chrome-win64/chrome.exe',
  'chrome-headless-shell-win64/chrome-headless-shell.exe',
];

function browserRoots(): string[] {
  const roots = new Set<string>();
  if (process.env.PLAYWRIGHT_BROWSERS_PATH && process.env.PLAYWRIGHT_BROWSERS_PATH !== '0') roots.add(process.env.PLAYWRIGHT_BROWSERS_PATH);
  roots.add('/opt/pw-browsers');
  roots.add(path.join(os.homedir(), '.cache', 'ms-playwright'));
  roots.add(path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'));
  if (process.env.LOCALAPPDATA) roots.add(path.join(process.env.LOCALAPPDATA, 'ms-playwright'));
  return [...roots];
}

/** Glob `<root>/chromium*` folders for a Chromium/headless-shell executable (newest revision first). */
export function globChromiumExecutables(roots: string[] = browserRoots()): string[] {
  const out: string[] = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    let dirs: string[];
    try {
      dirs = readdirSync(root).filter((d) => /^chromium/i.test(d));
    } catch {
      continue;
    }
    const rev = (d: string) => Number(/(\d+)$/.exec(d)?.[1] ?? 0);
    // full chromium before headless shell at the same revision, newest first
    dirs.sort((a, b) => rev(b) - rev(a) || Number(a.includes('headless')) - Number(b.includes('headless')));
    for (const d of dirs) {
      for (const c of EXECUTABLE_CANDIDATES) {
        const p = path.join(root, d, c);
        if (existsSync(p)) out.push(p);
      }
    }
  }
  // System installs as a last resort
  for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable']) if (existsSync(p)) out.push(p);
  return out;
}

/**
 * Candidate executables in discovery order. `undefined` means "let playwright-core pick its
 * registry default".
 */
export function chromiumCandidates(executablePath?: string): (string | undefined)[] {
  if (executablePath) return [executablePath];
  const env = process.env.ARTISAN_CHROMIUM_PATH;
  if (env) return [env];
  return [undefined, ...globChromiumExecutables()];
}

/** Launch Chromium trying each discovered candidate. */
export async function launchChromium(opts: BrowserLaunchOptions = {}): Promise<{ browser: Browser; executablePath: string }> {
  const errors: string[] = [];
  const args = [...DEFAULT_CHROMIUM_ARGS, ...(opts.launchArgs ?? [])];
  for (const candidate of chromiumCandidates(opts.executablePath)) {
    if (candidate && !existsSync(candidate)) {
      errors.push(`${candidate}: not found`);
      continue;
    }
    const launch: LaunchOptions = {
      headless: opts.headless ?? true,
      args,
      chromiumSandbox: false,
      timeout: opts.timeoutMs ?? 30_000,
      ...(opts.proxy ? { proxy: opts.proxy } : {}),
      ...(candidate ? { executablePath: candidate } : {}),
    };
    try {
      const browser = await chromium.launch(launch);
      let exe = candidate;
      if (!exe) {
        try {
          exe = chromium.executablePath();
        } catch {
          exe = 'playwright-default';
        }
      }
      return { browser, executablePath: exe };
    } catch (e) {
      errors.push(`${candidate ?? 'playwright-core default'}: ${(e as Error).message.split('\n')[0]}`);
    }
  }
  throw new Error(
    `Could not launch Chromium. Set ARTISAN_CHROMIUM_PATH or pass executablePath, or install a browser with \`npx playwright-core install chromium\`.\n  ${errors.join('\n  ')}`,
  );
}

let availability: Promise<boolean> | null = null;

/** True when a Chromium binary can be found and launched (result cached per process). */
export function isChromiumAvailable(opts: Pick<BrowserLaunchOptions, 'executablePath'> = {}): Promise<boolean> {
  const run = async () => {
    try {
      const { browser } = await launchChromium({ ...opts, timeoutMs: 20_000 });
      await browser.close();
      return true;
    } catch {
      return false;
    }
  };
  if (opts.executablePath) return run();
  return (availability ??= run());
}
