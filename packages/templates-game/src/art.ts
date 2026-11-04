/**
 * Built-in placeholder artwork (original, procedurally generated SVG) so every template renders
 * out of the box with zero user assets. Templates accept `builtin:<name>` in any image prop; it
 * is swapped for a self-contained `data:image/svg+xml;base64,…` URI at render time.
 *
 * The art deliberately contains no <text> (resvg renders nested SVGs without system fonts).
 */
import { toDataUri } from '@game-artisan/core';

/** Deterministic PRNG so the generated art is identical on every machine/run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Midpoint-displacement ridge line (heights per x sample) with optional gaussian peaks. */
function ridgeHeights(seed: number, width: number, samples: number, baseY: number, amplitude: number, roughness: number, peaks: { x: number; height: number; spread: number }[] = []): number[] {
  const rnd = mulberry32(seed);
  const n = samples;
  const h = new Array<number>(n + 1).fill(0);
  h[0] = (rnd() - 0.5) * amplitude;
  h[n] = (rnd() - 0.5) * amplitude;
  let step = n;
  let amp = amplitude;
  while (step > 1) {
    const half = step / 2;
    for (let i = half; i < n; i += step) h[i] = (h[i - half] + h[i + half]) / 2 + (rnd() - 0.5) * amp;
    amp *= roughness;
    step = half;
  }
  return h.map((v, i) => {
    const x = (i / n) * width;
    let y = baseY + v;
    for (const p of peaks) y -= p.height * Math.exp(-((x - p.x) ** 2) / (2 * p.spread ** 2));
    return y;
  });
}

function ridgePath(heights: number[], width: number, bottom: number): string {
  const n = heights.length - 1;
  const pts = heights.map((y, i) => `${r1((i / n) * width)} ${r1(y)}`);
  return `M0 ${bottom}L${pts.join('L')}L${width} ${bottom}Z`;
}

function heightAt(heights: number[], width: number, x: number): number {
  const n = heights.length - 1;
  const f = (x / width) * n;
  const i = Math.max(0, Math.min(n - 1, Math.floor(f)));
  const t = f - i;
  return heights[i] * (1 - t) + heights[i + 1] * t;
}

/** Sky, sun, floating islands, a hill-top citadel and layered mountain ranges (16:9, 1920×1080). */
function skyMountainsSvg(): string {
  const W = 1920;
  const H = 1080;
  const rnd = mulberry32(2026);
  const sunX = 1180;
  const sunY = 560;

  const stars: string[] = [];
  for (let i = 0; i < 170; i++) {
    const x = rnd() * W;
    const y = Math.pow(rnd(), 1.6) * 520;
    const r = 0.6 + rnd() * 1.9;
    const o = 0.25 + rnd() * 0.75;
    stars.push(`<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(r)}" fill="#fff6e6" opacity="${r1(o * (1 - y / 620))}"/>`);
  }

  const far = ridgeHeights(11, W, 64, 610, 150, 0.55, [{ x: 360, height: 120, spread: 120 }, { x: 1640, height: 90, spread: 160 }]);
  const mid = ridgeHeights(23, W, 64, 770, 170, 0.52, [{ x: sunX, height: 210, spread: 110 }, { x: 260, height: 60, spread: 140 }]);
  const near = ridgeHeights(37, W, 48, 905, 110, 0.5, [{ x: 120, height: 90, spread: 160 }, { x: 1840, height: 120, spread: 140 }]);

  // Citadel on the mid peak, silhouetted against the sun.
  const peakY = heightAt(mid, W, sunX) + 14;
  const towers: [number, number, number][] = [
    [-70, 26, 120],
    [-34, 22, 175],
    [-6, 30, 250],
    [30, 22, 160],
    [62, 24, 110],
  ];
  const citadel = towers
    .map(([dx, w, h]) => {
      const x = sunX + dx;
      const top = peakY - h;
      return `M${r1(x)} ${r1(peakY)}V${r1(top + w * 0.6)}L${r1(x + w / 2)} ${r1(top - w * 0.9)}L${r1(x + w)} ${r1(top + w * 0.6)}V${r1(peakY)}Z`;
    })
    .join('') + `M${sunX - 82} ${r1(peakY)}h${178}v${-46}h-${178}Z`;
  const windows = towers
    .filter((_, i) => i % 2 === 0)
    .map(([dx, w, h]) => `<rect x="${r1(sunX + dx + w / 2 - 3)}" y="${r1(peakY - h * 0.55)}" width="6" height="11" rx="3" fill="#ffd27a" opacity="0.9"/>`)
    .join('');

  const island = (cx: number, cy: number, s: number) => {
    const top = `M${cx - 120 * s} ${cy}Q${cx - 60 * s} ${cy - 18 * s} ${cx} ${cy - 14 * s}Q${cx + 70 * s} ${cy - 20 * s} ${cx + 125 * s} ${cy}`;
    const under = `L${cx + 90 * s} ${cy + 40 * s}L${cx + 40 * s} ${cy + 70 * s}L${cx + 10 * s} ${cy + 150 * s}L${cx - 30 * s} ${cy + 80 * s}L${cx - 80 * s} ${cy + 45 * s}Z`;
    const trees = [-70, -40, 30, 75]
      .map((dx, i) => {
        const th = (34 + (i % 2) * 18) * s;
        const x = cx + dx * s;
        const y = cy - 14 * s;
        return `M${r1(x - 11 * s)} ${r1(y + 4 * s)}L${r1(x)} ${r1(y - th)}L${r1(x + 11 * s)} ${r1(y + 4 * s)}Z`;
      })
      .join('');
    return `<path d="${top}${under}" fill="url(#island)"/><path d="${top}" fill="none" stroke="#ffb98f" stroke-width="${r1(4 * s)}" stroke-linecap="round" opacity="0.8"/><path d="${trees}" fill="#3a1f4f"/>`;
  };

  const embers: string[] = [];
  for (let i = 0; i < 60; i++) {
    const x = rnd() * W;
    const y = 600 + rnd() * 460;
    const r = 1 + rnd() * 3.2;
    embers.push(`<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(r)}" fill="#ffc27a" opacity="${r1(0.3 + rnd() * 0.6)}"/>`);
  }

  const cloud = (x: number, y: number, w: number, h: number, color: string, o: number) => `<ellipse cx="${x}" cy="${y}" rx="${w}" ry="${h}" fill="${color}" opacity="${o}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#070b2a"/><stop offset="0.3" stop-color="#1d1957"/><stop offset="0.5" stop-color="#5a2a78"/><stop offset="0.66" stop-color="#c2507a"/><stop offset="0.78" stop-color="#f4905a"/><stop offset="0.9" stop-color="#ffd08a"/></linearGradient>
<radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ffe2a8" stop-opacity="0.95"/><stop offset="0.35" stop-color="#ff9e6a" stop-opacity="0.45"/><stop offset="1" stop-color="#ff6a6a" stop-opacity="0"/></radialGradient>
<radialGradient id="sun" cx="0.5" cy="0.45" r="0.55"><stop offset="0" stop-color="#fffbe9"/><stop offset="0.55" stop-color="#ffe3a0"/><stop offset="1" stop-color="#ffab62"/></radialGradient>
<linearGradient id="far" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9788a"/><stop offset="1" stop-color="#8d3f7e"/></linearGradient>
<linearGradient id="mid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a2f74"/><stop offset="1" stop-color="#2a1848"/></linearGradient>
<linearGradient id="near" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#22163f"/><stop offset="1" stop-color="#0b0820"/></linearGradient>
<linearGradient id="island" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6c3576"/><stop offset="1" stop-color="#2a1745"/></linearGradient>
<linearGradient id="mist" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffc2c8" stop-opacity="0"/><stop offset="0.5" stop-color="#ffc2c8" stop-opacity="0.32"/><stop offset="1" stop-color="#ffc2c8" stop-opacity="0"/></linearGradient>
</defs>
<rect width="${W}" height="${H}" fill="url(#sky)"/>
${stars.join('')}
<circle cx="${sunX}" cy="${sunY}" r="560" fill="url(#glow)"/>
<circle cx="${sunX}" cy="${sunY}" r="150" fill="url(#sun)"/>
${cloud(sunX - 40, sunY + 40, 420, 16, '#ff9d7e', 0.55)}${cloud(sunX + 210, sunY - 70, 260, 10, '#ffc7a0', 0.5)}${cloud(520, 470, 380, 18, '#b9579a', 0.45)}${cloud(1650, 420, 300, 14, '#c0609a', 0.4)}
${island(470, 330, 1)}${island(1600, 250, 0.72)}
<path d="${ridgePath(far, W, H)}" fill="url(#far)"/>
<rect y="600" width="${W}" height="200" fill="url(#mist)"/>
<path d="${citadel}" fill="#2f1a4c"/>${windows}
<path d="${ridgePath(mid, W, H)}" fill="url(#mid)"/>
<rect y="760" width="${W}" height="150" fill="url(#mist)" opacity="0.7"/>
<path d="${ridgePath(near, W, H)}" fill="url(#near)"/>
${embers.join('')}
</svg>`;
}

/** Cloaked hero with a raised blade, rim-lit by the sunset (transparent cutout, 600×1000). */
function heroSvg(): string {
  // Silhouette parts (no fill → painted via <use>): base rim colour, then a shifted, masked shade
  // copy on top leaves a warm rim light along the upper-right edges.
  const parts = [
    // cape (behind the body)
    'M236 292C180 400 120 600 46 870Q84 852 116 890Q150 858 186 902Q214 876 240 908L250 640L232 330Z',
    // legs + boots
    'M246 600L306 610L288 790L276 900L270 962L282 990L214 994L216 978L240 958L242 880L238 780Z',
    'M300 610L368 598L380 780L392 880L404 956L440 976L442 994L374 992L370 960L352 880L330 780Z',
    // tunic flare
    'M240 512L372 512L394 652Q306 676 220 652Z',
    // torso + pauldrons
    'M238 290Q300 262 368 290Q394 300 398 330L384 360L370 500Q368 560 376 600L236 604Q244 560 240 500L226 360L214 330Q218 300 238 290Z',
    // hood
    'M306 108C336 116 356 150 356 196C356 228 346 252 334 268L280 270C266 252 256 228 258 196C260 150 278 118 306 108Z',
    // left arm (hanging)
    'M222 312Q204 330 200 380L192 520Q192 548 206 552Q222 548 222 520L232 390Z',
    // right arm (raised)
    'M372 300Q400 296 416 316L466 372Q476 386 462 396Q448 402 438 390L380 336Z',
    'M438 392Q450 400 464 392L494 330Q498 316 486 310Q474 306 468 318L440 380Z',
  ];
  const shapes = parts.map((d) => `<path d="${d}"/>`).join('');
  const blade = 'M480.6 293.8L572.8 53.2L589.2 35.5L589.6 59.6L497.4 300.2Z';
  const guard = 'M458.8 280.6L522.4 305L519.2 313.4L455.6 289Z';
  const grip = 'M484.3 295.2L493.7 298.8L477.2 341.8L467.8 338.2Z';
  const scarf = 'M318 262Q268 270 244 284Q176 280 108 244Q66 226 22 236Q74 258 132 298Q184 324 240 310Q286 302 320 286Z';
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="600" height="1000" viewBox="0 0 600 1000">
<defs>
<g id="s">${shapes}</g>
<linearGradient id="shade" x1="0" y1="0" x2="1" y2="0.35"><stop offset="0" stop-color="#0c0a1d"/><stop offset="0.7" stop-color="#211a42"/><stop offset="1" stop-color="#3a2c66"/></linearGradient>
<linearGradient id="steel" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#8fb8ff"/><stop offset="1" stop-color="#ffffff"/></linearGradient>
<linearGradient id="scarf" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stop-color="#ff8a3d"/><stop offset="1" stop-color="#c81f4f"/></linearGradient>
<mask id="sil" maskUnits="userSpaceOnUse" x="0" y="0" width="600" height="1000"><use href="#s" xlink:href="#s" fill="#ffffff"/></mask>
<filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="10"/></filter>
</defs>
<path d="${blade}" fill="#bfe0ff" filter="url(#blur)"/>
<use href="#s" xlink:href="#s" fill="#ffc98a"/>
<g mask="url(#sil)"><use href="#s" xlink:href="#s" fill="url(#shade)" transform="translate(-7 6)"/></g>
<path d="M240 500H372V520H240Z" fill="#3b2412"/><path d="M296 498H316V522H296Z" fill="#f2c25a"/>
<path d="M232 300Q300 276 362 300" fill="none" stroke="#f2c25a" stroke-width="5" stroke-linecap="round" opacity="0.85"/>
<path d="M286 206Q306 198 328 206L326 236Q306 246 288 236Z" fill="#06050f"/>
<path d="M292 214L304 217L303 221L291 219Z" fill="#ffd36b"/><path d="M312 217L324 214L325 219L313 221Z" fill="#ffd36b"/>
<path d="${scarf}" fill="url(#scarf)"/>
<path d="M318 262Q268 270 244 284Q176 280 108 244Q66 226 22 236" fill="none" stroke="#ffd0a0" stroke-width="3" opacity="0.8"/>
<path d="${blade}" fill="url(#steel)"/>
<path d="M489 297L584 46" stroke="#ffffff" stroke-width="2" opacity="0.9"/>
<path d="${guard}" fill="#f2c25a"/><path d="${grip}" fill="#5b3a1e"/><circle cx="470" cy="346" r="8" fill="#f2c25a"/>
</svg>`;
}

/** Heraldic emblem (winged blade on a shield) usable as a logo mark / community icon. */
function emblemSvg(): string {
  const wing = (dir: 1 | -1) => {
    const feathers: string[] = [];
    for (let i = 0; i < 5; i++) {
      const y = 190 + i * 34;
      const len = 150 - i * 22;
      const x0 = 256 + dir * 40;
      feathers.push(`M${x0} ${y}Q${x0 + dir * len * 0.6} ${y - 40} ${x0 + dir * len} ${y - 18 + i * 4}Q${x0 + dir * len * 0.55} ${y + 6} ${x0} ${y + 26}Z`);
    }
    return feathers.join('');
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<defs>
<linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff0b8"/><stop offset="0.45" stop-color="#f4c14f"/><stop offset="1" stop-color="#a8681b"/></linearGradient>
<linearGradient id="field" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b3f9a"/><stop offset="1" stop-color="#14123a"/></linearGradient>
<linearGradient id="blade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#cfe6ff"/><stop offset="0.5" stop-color="#ffffff"/><stop offset="0.5" stop-color="#a9c8f0"/><stop offset="1" stop-color="#7fa6dc"/></linearGradient>
</defs>
<path d="M256 24L452 92Q452 330 256 488Q60 330 60 92Z" fill="url(#gold)"/>
<path d="M256 52L426 110Q422 318 256 456Q90 318 86 110Z" fill="url(#field)"/>
<path d="${wing(1)}${wing(-1)}" fill="url(#gold)" opacity="0.95"/>
<path d="M256 84L274 120L272 360L256 400L240 360L238 120Z" fill="url(#blade)"/>
<path d="M196 352H316L306 372H206Z" fill="url(#gold)"/>
<path d="M248 372H264V430H248Z" fill="#7a4a1e"/><circle cx="256" cy="440" r="14" fill="url(#gold)"/>
<path d="M256 60L263 76L280 78L267 89L271 106L256 97L241 106L245 89L232 78L249 76Z" fill="#fff6d0"/>
</svg>`;
}

/** Dark nebula/space backdrop (sci-fi flavoured alternative background). */
function nebulaSvg(): string {
  const W = 1920;
  const H = 1080;
  const rnd = mulberry32(99);
  const stars: string[] = [];
  for (let i = 0; i < 260; i++) {
    const r = 0.5 + Math.pow(rnd(), 3) * 2.6;
    stars.push(`<circle cx="${r1(rnd() * W)}" cy="${r1(rnd() * H)}" r="${r1(r)}" fill="#e8f4ff" opacity="${r1(0.3 + rnd() * 0.7)}"/>`);
  }
  const blobs = [
    [560, 420, 620, '#3a1c8c', 0.75],
    [1300, 520, 680, '#0f6f9c', 0.6],
    [980, 300, 420, '#c2367a', 0.45],
    [1580, 860, 520, '#1b2f8f', 0.6],
  ]
    .map(([x, y, r, c, o], i) => `<radialGradient id="n${i}" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${c}" stop-opacity="${o}"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient><circle cx="${x}" cy="${y}" r="${r}" fill="url(#n${i})"/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#05061a"/><stop offset="1" stop-color="#0a0f2e"/></linearGradient>
<radialGradient id="planet" cx="0.35" cy="0.3" r="0.75"><stop offset="0" stop-color="#7fe3ff"/><stop offset="0.5" stop-color="#2a66c9"/><stop offset="1" stop-color="#0a1238"/></radialGradient></defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>${blobs}${stars.join('')}
<circle cx="1420" cy="1240" r="560" fill="url(#planet)"/>
<path d="M860 1080Q1420 560 1980 1080" fill="none" stroke="#9ff0ff" stroke-width="4" opacity="0.55"/>
</svg>`;
}

const GENERATORS = {
  'sky-mountains': skyMountainsSvg,
  hero: heroSvg,
  emblem: emblemSvg,
  nebula: nebulaSvg,
} as const;

export type BuiltinArtName = keyof typeof GENERATORS;

const svgCache = new Map<string, string>();
const uriCache = new Map<string, string>();

/** Raw SVG markup of a built-in artwork. */
export function builtinArtSvg(name: BuiltinArtName): string {
  let s = svgCache.get(name);
  if (!s) {
    const gen = GENERATORS[name];
    if (!gen) throw new Error(`Unknown built-in art "${name}". Available: ${Object.keys(GENERATORS).join(', ')}`);
    s = gen();
    svgCache.set(name, s);
  }
  return s;
}

/** data: URI of a built-in artwork. */
export function builtinArtUri(name: BuiltinArtName): string {
  let u = uriCache.get(name);
  if (!u) {
    u = toDataUri(new TextEncoder().encode(builtinArtSvg(name)), 'image/svg+xml');
    uriCache.set(name, u);
  }
  return u;
}

/** Names usable as `builtin:<name>` in image props. */
export const BUILTIN_ART_NAMES = Object.keys(GENERATORS) as BuiltinArtName[];

/** Built-in art references (use these as prop values; they resolve to data URIs at render time). */
export const BUILTIN_ART = {
  background: 'builtin:sky-mountains',
  character: 'builtin:hero',
  logo: 'builtin:emblem',
  space: 'builtin:nebula',
} as const;

/**
 * Resolve an image prop: `builtin:<name>` → data URI; anything else (path, URL, data URI) is
 * returned unchanged for the AssetResolver.
 */
export function resolveArt(src: string | undefined | null): string | undefined {
  if (!src) return undefined;
  const m = /^builtin:([a-z0-9-]+)$/i.exec(src.trim());
  if (!m) return src;
  return builtinArtUri(m[1] as BuiltinArtName);
}
