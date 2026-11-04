import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FontRegistry } from '@game-artisan/core';

const fontsDir = fileURLToPath(new URL('../../fonts/files/', import.meta.url));

export function testFonts(): FontRegistry {
  const reg = new FontRegistry();
  for (const f of ['Inter_400Regular', 'Inter_700Bold', 'Inter_900Black', 'Cinzel_700Bold']) reg.register(readFileSync(fontsDir + f + '.ttf'));
  return reg;
}

export const PNG_1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
export const SVG_IMG = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#3a6"/></svg>').toString('base64');
