import { Composition, Layer, Text, registerRoot, resolveLocale, zColor, zImage } from '@game-artisan/core';
import { z } from 'zod';

const Schema = z.object({
  title: z.string().default('NEON HORIZON'),
  callout: z.string().default('PLAY NOW'),
  accent: zColor('#00ffaa'),
  hero: zImage('hero.svg'),
  heroX: z.number().min(0).max(460).default(300),
  localeMap: z.record(z.string(), z.object({ title: z.string().optional() })).default({ ja: { title: 'ネオン・ホライズン' } }),
});

function Header(p: z.infer<typeof Schema>) {
  const loc = resolveLocale(p.localeMap) ?? {};
  return (
    <div style={{ width: 460, height: 215, backgroundColor: '#101020', fontFamily: 'Inter' }}>
      <Layer.Image id="bg" src="assets/bg.svg" width={460} height={215} />
      <Layer.Image id="hero" src={p.hero} x={p.heroX} y={10} height={200} bind={{ x: 'heroX' }} />
      <div style={{ position: 'absolute', left: 16, bottom: 16, maxWidth: 280 }}>
        <Text id="callout" content={p.callout} style={{ fontSize: 10, fontWeight: 700, color: p.accent, letterSpacing: 2 }} />
        <Text id="title" content={loc.title ?? p.title} fit="shrink" style={{ fontSize: 30, fontWeight: 900, color: '#fff' }} />
      </div>
    </div>
  );
}

registerRoot(() => (
  <>
    <Composition id="header" name="Header" width={460} height={215} component={Header} schema={Schema} defaultProps={{}} />
    <Composition id="small" name="Small" width={231} height={87} component={() => <div style={{ width: 231, height: 87, backgroundColor: '#222' }}><Text content="SMALL" style={{ fontSize: 20, color: '#fff' }} /></div>} />
  </>
));
