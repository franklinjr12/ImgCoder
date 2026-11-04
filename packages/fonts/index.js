// Bundled OFL fonts. Each entry exposes a URL resolved relative to this module so it
// works in Node (fileURLToPath) and in Vite/browser bundles (asset URL) alike.
const f = (file) => new URL(`./files/${file}`, import.meta.url);

/** @type {import('./index').BundledFont[]} */
export const BUNDLED_FONTS = [
  { family: 'Inter', weight: 400, style: 'normal', file: 'Inter_400Regular.ttf', url: f('Inter_400Regular.ttf') },
  { family: 'Inter', weight: 400, style: 'italic', file: 'Inter_400Regular_Italic.ttf', url: f('Inter_400Regular_Italic.ttf') },
  { family: 'Inter', weight: 700, style: 'normal', file: 'Inter_700Bold.ttf', url: f('Inter_700Bold.ttf') },
  { family: 'Inter', weight: 900, style: 'normal', file: 'Inter_900Black.ttf', url: f('Inter_900Black.ttf') },
  { family: 'Cinzel', weight: 400, style: 'normal', file: 'Cinzel_400Regular.ttf', url: f('Cinzel_400Regular.ttf') },
  { family: 'Cinzel', weight: 700, style: 'normal', file: 'Cinzel_700Bold.ttf', url: f('Cinzel_700Bold.ttf') },
  { family: 'Cinzel', weight: 900, style: 'normal', file: 'Cinzel_900Black.ttf', url: f('Cinzel_900Black.ttf') },
  { family: 'Bebas Neue', weight: 400, style: 'normal', file: 'BebasNeue_400Regular.ttf', url: f('BebasNeue_400Regular.ttf') },
  { family: 'Press Start 2P', weight: 400, style: 'normal', file: 'PressStart2P_400Regular.ttf', url: f('PressStart2P_400Regular.ttf') },
];

export const DEFAULT_FONT_FAMILY = 'Inter';

/** Load all bundled fonts as Uint8Array buffers (Node: reads files; browser: fetch). */
export async function loadBundledFonts() {
  const isNode = typeof process !== 'undefined' && !!process.versions?.node && BUNDLED_FONTS[0].url.protocol === 'file:';
  if (isNode) {
    const { readFile } = await import('node:fs/promises');
    return Promise.all(
      BUNDLED_FONTS.map(async (font) => ({ ...font, data: new Uint8Array(await readFile(font.url)) })),
    );
  }
  return Promise.all(
    BUNDLED_FONTS.map(async (font) => {
      const res = await fetch(font.url);
      return { ...font, data: new Uint8Array(await res.arrayBuffer()) };
    }),
  );
}
