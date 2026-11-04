import { describe, expect, it } from 'vitest';
import { transformToMatrix, invert, multiply, applyToPoint, decompose, IDENTITY, PathBuilder, parsePath, pathBounds, rectPath, ellipsePath, starPath, fitPathToBox, parseColor, svgColor, contrastRatio } from '@game-artisan/core';

describe('affine matrices', () => {
  it('composes T·R·S about the origin', () => {
    const m = transformToMatrix({ x: 10, y: 20, width: 100, height: 50, rotation: 90, scaleX: 2, scaleY: 1, originX: 0, originY: 0 });
    const p = applyToPoint(m, { x: 1, y: 0 });
    expect(p.x).toBeCloseTo(10);
    expect(p.y).toBeCloseTo(22);
  });
  it('rotates around the centre by default', () => {
    const m = transformToMatrix({ x: 0, y: 0, width: 100, height: 100, rotation: 180 });
    const p = applyToPoint(m, { x: 0, y: 0 });
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(100);
  });
  it('inverts and decomposes', () => {
    const m = transformToMatrix({ x: 5, y: 7, width: 10, height: 10, rotation: 30, scaleX: 1.5, scaleY: 0.5, skewX: 10 });
    const id = multiply(m, invert(m));
    id.forEach((v, i) => expect(v).toBeCloseTo(IDENTITY[i], 9));
    const d = decompose(transformToMatrix({ x: 0, y: 0, width: 0, height: 0, rotation: 45, scaleX: 2, scaleY: 3 }));
    expect(d.rotation).toBeCloseTo(45);
    expect(d.scaleX).toBeCloseTo(2);
    expect(d.scaleY).toBeCloseTo(3);
  });
});

describe('vector paths', () => {
  it('parses every SVG command (relative, shorthand, arcs)', () => {
    const segs = parsePath('M10 10 h20 v20 H10 Z m5 5 c1 1 2 2 3 3 s4 4 5 5 q1 1 2 2 t3 3 a5 5 0 0 1 10 0 l2-2');
    expect(segs.filter((s) => s.type === 'M')).toHaveLength(2);
    expect(segs.every((s) => ['M', 'L', 'C', 'Q', 'Z'].includes(s.type))).toBe(true);
  });
  it('computes tight bounds including curve extrema', () => {
    const b = pathBounds(ellipsePath(100, 40));
    expect(b.x).toBeCloseTo(0, 3);
    expect(b.width).toBeCloseTo(100, 3);
    expect(b.height).toBeCloseTo(40, 3);
    const arc = pathBounds('M0 0 A50 50 0 0 1 100 0');
    expect(arc.height).toBeCloseTo(50, 1);
  });
  it('builds shapes and fits paths to boxes', () => {
    expect(rectPath(10, 10, 2)).toMatch(/^M/);
    expect(pathBounds(starPath(100, 100, 5)).width).toBeGreaterThan(90);
    const fitted = pathBounds(fitPathToBox('M0 0L10 0L10 10Z', 200, 100));
    expect(fitted.width).toBeCloseTo(200);
    const pb = new PathBuilder().moveTo(0, 0).lineTo(10, 0).transform([2, 0, 0, 2, 5, 5]);
    expect(pb.toString()).toBe('M5 5L25 5');
  });
});

describe('colour', () => {
  it('parses hex/rgb/hsl/named and normalises for SVG', () => {
    expect(parseColor('#FF336644')).toMatchObject({ r: 255, g: 51, b: 102 });
    expect(parseColor('#FF336644')!.a).toBeCloseTo(0x44 / 255);
    expect(parseColor('rgb(10 20 30 / 50%)')).toMatchObject({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseColor('hsl(120, 100%, 50%)')).toMatchObject({ r: 0, g: 255, b: 0 });
    expect(svgColor('rgba(5,5,8,0.95)')).toEqual({ hex: '#050508', opacity: 0.95 });
    expect(svgColor('gold').hex).toBe('#ffd700');
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21);
  });
});
