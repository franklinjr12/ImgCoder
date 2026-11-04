import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { layoutText, layoutToPath, TextStyleSchema, applyTextTransform, FontRegistry, detectScript } from '@game-artisan/core';
import { testFonts } from './helpers.js';

const style = (s: any = {}) => TextStyleSchema.parse({ fontFamily: 'Inter', fontSize: 20, ...s });

describe('text layout', () => {
  const fonts = testFonts();
  it('matches family/weight and preferred family names (Inter Black → Inter 900)', () => {
    expect(fonts.match('Inter', 900)?.weight).toBe(900);
    expect(fonts.match('inter', 650)?.weight).toBe(700);
    expect(fonts.resolveStack("'Cinzel', 'Noto Sans SC', sans-serif", 700)[0].family).toBe('Cinzel');
  });
  it('wraps words greedily within maxWidth', () => {
    const one = layoutText('THE LONG NIGHT RETURNS', style(), fonts);
    expect(one.lines).toHaveLength(1);
    const wrapped = layoutText('THE LONG NIGHT RETURNS', style(), fonts, { maxWidth: one.width / 2 });
    expect(wrapped.lines.length).toBeGreaterThan(1);
    for (const l of wrapped.lines) expect(l.width).toBeLessThanOrEqual(one.width / 2 + 0.5);
  });
  it('applies tracking, transforms, maxLines ellipsis and newlines', () => {
    const a = layoutText('ABC', style(), fonts).width;
    const b = layoutText('ABC', style({ letterSpacing: 10 }), fonts).width;
    expect(b - a).toBeCloseTo(20, 0);
    expect(applyTextTransform('hello world', 'capitalize')).toBe('Hello World');
    const t = layoutText('one two three four five six', style({ maxLines: 2 }), fonts, { maxWidth: 80 });
    expect(t.lines).toHaveLength(2);
    expect(t.lines[1].text.endsWith('…')).toBe(true);
    expect(layoutText('a\nb', style(), fonts).lines).toHaveLength(2);
  });
  it('shrinks to fit', () => {
    const t = layoutText('SUPERCALIFRAGILISTIC', style({ fontSize: 80, fit: 'shrink' }), fonts, { maxWidth: 200, maxHeight: 100 });
    expect(t.fontSize).toBeLessThan(80);
    expect(t.width).toBeLessThanOrEqual(200.5);
  });
  it('emits glyph outlines aligned in the box', () => {
    const s = style({ textAlign: 'center' });
    const l = layoutText('Hi', s, fonts);
    expect(layoutToPath(l, 200, 40, s)).toMatch(/^M[\d.]+ [\d.]+/);
  });
  const cjk = ['/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc'].find(existsSync);
  it.skipIf(!cjk)('falls back per glyph to locale-preferred CJK fonts', () => {
    const reg = testFonts();
    reg.register(readFileSync(cjk!), { fallback: true, locales: ['zh-CN'] });
    const l = layoutText('PLAY 现已发售', style(), reg, { locale: 'zh-CN' });
    const fams = new Set(l.lines[0].runs.map((r) => r.font.family));
    expect(fams.has('Inter')).toBe(true);
    expect(fams.size).toBeGreaterThan(1);
    expect(detectScript('今すぐプレイ')).toBe('kana');
    expect(detectScript('지금 플레이')).toBe('hangul');
  });
  it('throws a helpful error with no fonts', () => {
    expect(() => layoutText('x', style(), new FontRegistry())).toThrow(/No fonts registered/);
  });
});
