import { describe, expect, it } from 'vitest';
import {
  applyToPoint,
  computeWorldMatrices,
  createArtboard,
  createDocument,
  createLayer,
  describeComposition,
  transformToMatrix,
  z,
  zColor,
  zImage,
  zSlider,
  zLocaleMap,
  zLongText,
  zFont,
  defineComposition,
  type Artboard,
  type Layer,
  type Matrix,
  type Transform,
} from '@game-artisan/core';
import { resizeTransform, rotateTransform, skewTransform, transformFromMatrix, scaleSelection, rotateSelection, translateSelection, pivotOf, rectScaleFactors } from '../src/editor/geometry';
import { collectSnapTargets, snapRect, snapPoint } from '../src/editor/snapping';
import { groupLayers, ungroupLayers, moveLayers, duplicateLayers, reorderLayers, deleteLayers, findParent, getLayer } from '../src/editor/tree-ops';
import { History } from '../src/editor/history';
import { applyCompositionEdit, patchToOverride, routePatch, bindingFor } from '../src/editor/routing';
import { buildPropFields, humanize, defaultValueFor } from '../src/editor/prop-form';
import { detachToDocument, exposeField, unexposeField, resolveDesignArtboard, collectPropUsage, newDesign, safeZonesFromMargins } from '../src/editor/documents';
import { createPrimitive } from '../src/editor/primitives';

const T = (t: Partial<Transform>): Transform => ({ x: 0, y: 0, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0, originX: 0.5, originY: 0.5, ...t });
const pt = (m: Matrix, x: number, y: number) => applyToPoint(m, { x, y });
const close = (a: { x: number; y: number }, b: { x: number; y: number }, d = 6) => {
  expect(a.x).toBeCloseTo(b.x, d);
  expect(a.y).toBeCloseTo(b.y, d);
};
const matClose = (a: Matrix, b: Matrix, d = 6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], d));

describe('gizmo math', () => {
  it('resizes an axis-aligned layer from the SE handle keeping NW fixed', () => {
    const t = T({ x: 10, y: 20 });
    const r = resizeTransform(t, 'se', { x: 110, y: 120 }, { x: 160, y: 140 });
    expect(r.width).toBeCloseTo(150);
    expect(r.height).toBeCloseTo(120);
    close(pt(transformToMatrix(r), 0, 0), { x: 10, y: 20 });
  });

  it('keeps the opposite corner fixed when resizing a rotated layer', () => {
    const t = T({ x: 50, y: 50, width: 200, height: 100, rotation: 30 });
    const M = transformToMatrix(t);
    const nwBefore = pt(M, 0, 0);
    const seBefore = pt(M, 200, 100);
    const r = resizeTransform(t, 'se', seBefore, { x: seBefore.x + 40, y: seBefore.y + 10 });
    expect(r.rotation).toBe(30);
    close(pt(transformToMatrix(r), 0, 0), nwBefore);
    // pointer projected on the rotated axes
    const local = applyToPoint(transformToMatrix({ ...t }), { x: 0, y: 0 });
    expect(local).toBeTruthy();
    expect(r.width).toBeGreaterThan(200);
  });

  it('keeps aspect ratio with Shift and resizes from the centre with Alt', () => {
    const t = T({ x: 0, y: 0, width: 200, height: 100 });
    const r = resizeTransform(t, 'se', { x: 200, y: 100 }, { x: 300, y: 110 }, { keepAspect: true });
    expect(r.width / r.height).toBeCloseTo(2);
    expect(r.width).toBeCloseTo(300);
    const c = resizeTransform(t, 'e', { x: 200, y: 50 }, { x: 250, y: 50 }, { fromCenter: true });
    expect(c.width).toBeCloseTo(300);
    close(pivotOf(c), pivotOf(t));
  });

  it('resizes nested/scaled layers in local units', () => {
    const t = T({ x: 0, y: 0, width: 100, height: 100, scaleX: 2, originX: 0, originY: 0 });
    const r = resizeTransform(t, 'e', { x: 200, y: 50 }, { x: 300, y: 50 });
    expect(r.width).toBeCloseTo(150); // 100 visual px = 50 local units at scaleX 2
  });

  it('clamps to a minimum size', () => {
    const r = resizeTransform(T({}), 'se', { x: 100, y: 100 }, { x: -50, y: -50 });
    expect(r.width).toBe(1);
    expect(r.height).toBe(1);
  });

  it('rotates about the pivot with 15° snapping', () => {
    const t = T({ x: 0, y: 0, width: 100, height: 100 });
    const p0 = { x: 100, y: 50 };
    const r = rotateTransform(t, p0, { x: 50 + 50 * Math.cos(0.4), y: 50 + 50 * Math.sin(0.4) });
    expect(r.rotation).toBeCloseTo((0.4 * 180) / Math.PI);
    const s = rotateTransform(t, p0, { x: 50 + 50 * Math.cos(0.4), y: 50 + 50 * Math.sin(0.4) }, 15);
    expect(s.rotation).toBe(30); // 22.9° → 30°
    expect(rotateTransform(t, p0, { x: 50 + 50 * Math.cos(0.2), y: 50 + 50 * Math.sin(0.2) }, 15).rotation).toBe(15);
    close(pivotOf(s), pivotOf(t));
  });

  it('skews with a side handle keeping the opposite edge fixed', () => {
    const t = T({ x: 0, y: 0, width: 100, height: 100 });
    const r = skewTransform(t, 's', { x: 50, y: 100 }, { x: 100, y: 100 });
    expect(r.skewX).toBeCloseTo(26.565, 2); // atan(50/100)
    const M = transformToMatrix(r);
    close(pt(M, 50, 0), { x: 50, y: 0 }); // top edge midpoint fixed
    close(pt(M, 50, 100), { x: 100, y: 100 }); // bottom edge followed the pointer
    const v = skewTransform(t, 'e', { x: 100, y: 50 }, { x: 100, y: 75 });
    expect(v.skewY).toBeCloseTo(14.036, 2);
    close(pt(transformToMatrix(v), 0, 50), { x: 0, y: 50 });
  });

  it('skews rotated layers in their rotated frame', () => {
    const t = T({ x: 0, y: 0, width: 100, height: 100, rotation: 90 });
    const M0 = transformToMatrix(t);
    const bottomMid = pt(M0, 50, 100);
    const topMid = pt(M0, 50, 0);
    const r = skewTransform(t, 's', bottomMid, { x: bottomMid.x, y: bottomMid.y + 30 });
    close(pt(transformToMatrix(r), 50, 0), topMid);
    expect(Math.abs(r.skewX)).toBeGreaterThan(5);
  });

  it('decomposes arbitrary matrices back into UDM transforms', () => {
    const base = T({ x: 12, y: -7, width: 80, height: 40, rotation: 33, skewX: 12, skewY: 5, originX: 0.2, originY: 0.7 });
    const m = transformToMatrix(base);
    // size mode: the new box is a rescaled copy of the old → compare mapped corners
    const corners = (mm: Matrix, w: number, h: number) => [pt(mm, 0, 0), pt(mm, w, 0), pt(mm, w, h), pt(mm, 0, h)];
    const t = transformFromMatrix(m, base);
    corners(transformToMatrix(t), t.width, t.height).forEach((p, i) => close(p, corners(m, base.width, base.height)[i]));
    // scale mode keeps the box and matches the matrix exactly
    matClose(transformToMatrix(transformFromMatrix(m, base, 'scale')), m);
    const flipped: Matrix = [m[0], m[1], -m[2], -m[3], m[4], m[5]];
    matClose(transformToMatrix(transformFromMatrix(flipped, base, 'scale')), flipped);
  });

  it('applies collective translate/scale/rotate to multi-selections', () => {
    const parent: Matrix = [1, 0, 0, 1, 100, 0];
    const items = [
      { id: 'a', transform: T({ x: 0, y: 0, width: 50, height: 50 }), parentWorld: [1, 0, 0, 1, 0, 0] as Matrix },
      { id: 'b', transform: T({ x: 0, y: 0, width: 50, height: 50, rotation: 45 }), parentWorld: parent },
    ];
    const moved = translateSelection(items, { x: 10, y: 5 });
    expect(moved.get('a')!.x).toBe(10);
    expect(moved.get('b')!.y).toBe(5);
    const scaled = scaleSelection(items, { x: 0, y: 0 }, 2, 2);
    const sa = scaled.get('a')!;
    expect(sa.width).toBeCloseTo(100);
    close(pt(transformToMatrix(sa), sa.width, sa.height), { x: 100, y: 100 });
    const wb = transformToMatrix(scaled.get('b')!);
    const expected = pt(transformToMatrix(items[1].transform), 25, 25); // centre in parent space
    const centreWorld = { x: (expected.x + 100) * 2, y: expected.y * 2 };
    const got = pt(wb, scaled.get('b')!.width / 2, scaled.get('b')!.height / 2);
    close({ x: got.x + 100, y: got.y }, centreWorld);
    const rotated = rotateSelection(items, { x: 0, y: 0 }, 90);
    expect(rotated.get('a')!.rotation).toBe(90);
    close(pivotOf(rotated.get('a')!), { x: -25, y: 25 });
  });

  it('computes rect scale factors with aspect lock', () => {
    const r = { x: 0, y: 0, width: 100, height: 50 };
    const f = rectScaleFactors(r, 'se', { x: 100, y: 50 }, { x: 200, y: 60 }, { keepAspect: true });
    expect(f.sx).toBeCloseTo(2);
    expect(f.sy).toBeCloseTo(2);
    expect(f.anchor).toEqual({ x: 0, y: 0 });
  });
});

function sampleArtboard(): Artboard {
  return createArtboard({
    id: 'ab',
    width: 400,
    height: 300,
    children: [
      createLayer('vector', { id: 'bg', shape: { kind: 'rect' }, transform: { x: 0, y: 0, width: 400, height: 300 } } as any),
      createLayer('vector', { id: 'a', shape: { kind: 'rect' }, transform: { x: 50, y: 40, width: 100, height: 60 } } as any),
      createLayer('vector', { id: 'b', shape: { kind: 'ellipse' }, transform: { x: 200, y: 120, width: 80, height: 80, rotation: 30 } } as any),
      createLayer('text', { id: 't', content: 'Hi', style: {}, transform: { x: 10, y: 10, width: 100, height: 30 } } as any),
    ],
  });
}

function worldOf(ab: Artboard, id: string): Matrix {
  return computeWorldMatrices(ab).get(id)!;
}

describe('snapping', () => {
  it('snaps to artboard centre and other layer edges with smart guides', () => {
    const ab = sampleArtboard();
    const targets = collectSnapTargets(ab, ['a']);
    const r = snapRect({ x: 167, y: 0, width: 60, height: 50 }, targets, { threshold: 5 });
    // centre 197 → artboard centre 200
    expect(r.dx).toBeCloseTo(3);
    expect(r.guides.some((g) => g.axis === 'x' && g.value === 200)).toBe(true);
    // middle 107 → top of the rotated ellipse's bounds (160 − 40·(cos30°+sin30°))
    const r2 = snapRect({ x: 152, y: 97, width: 20, height: 20 }, targets, { threshold: 4 });
    expect(107 + r2.dy).toBeCloseTo(160 - 40 * (Math.cos(Math.PI / 6) + 0.5), 5);
    expect(r2.guides[0].source).toBe('layer');
  });

  it('snaps to guides and falls back to the pixel grid', () => {
    const ab = { ...sampleArtboard(), guides: [{ axis: 'x' as const, position: 333 }] };
    const targets = collectSnapTargets(ab, []);
    const r = snapRect({ x: 330.6, y: 10.4, width: 1, height: 1 }, targets, { threshold: 4, pixelGrid: true, objects: false });
    expect(330.6 + r.dx).toBeCloseTo(332, 5); // right edge (closest) snaps to the guide
    expect(10.4 + r.dy).toBe(10);
    const p = snapPoint({ x: 398, y: 151.2 }, targets, { threshold: 3 });
    expect(p.x).toBe(400);
    expect(p.y).toBe(150);
  });
});

describe('layer tree operations', () => {
  it('groups and ungroups preserving world transforms', () => {
    const ab = sampleArtboard();
    const before = { a: worldOf(ab, 'a'), b: worldOf(ab, 'b') };
    const g = groupLayers(ab, ['a', 'b'])!;
    expect(g).toBeTruthy();
    const group = getLayer(g.artboard, g.groupId)!;
    expect(group.type).toBe('group');
    expect(findParent(g.artboard, 'a')!.parent!.id).toBe(g.groupId);
    matClose(worldOf(g.artboard, 'a'), before.a);
    matClose(worldOf(g.artboard, 'b'), before.b);
    // group sits where the topmost selected layer was (below the text)
    expect(g.artboard.children.map((l) => l.id)).toEqual(['bg', g.groupId, 't']);
    // transform the group, then ungroup → children keep their (now rotated) world transforms
    const rotated: Artboard = { ...g.artboard, children: g.artboard.children.map((l) => (l.id === g.groupId ? { ...l, transform: { ...l.transform, rotation: 25, x: l.transform.x + 7 } } : l)) };
    const wa = worldOf(rotated, 'a');
    const wb = worldOf(rotated, 'b');
    const u = ungroupLayers(rotated, [g.groupId]);
    expect(u.ids).toEqual(['a', 'b']);
    matClose(worldOf(u.artboard, 'a'), wa);
    matClose(worldOf(u.artboard, 'b'), wb);
    expect(u.artboard.children.map((l) => l.id)).toEqual(['bg', 'a', 'b', 't']);
  });

  it('reparents via drag & drop keeping world transforms', () => {
    const ab = sampleArtboard();
    const g = groupLayers(ab, ['a'])!;
    const shifted: Artboard = { ...g.artboard, children: g.artboard.children.map((l) => (l.id === g.groupId ? { ...l, transform: { ...l.transform, rotation: 40, scaleX: 1.5 } } : l)) };
    const wt = worldOf(shifted, 't');
    const moved = moveLayers(shifted, ['t'], { parentId: g.groupId, index: 0 });
    expect(findParent(moved, 't')!.parent!.id).toBe(g.groupId);
    matClose(worldOf(moved, 't'), wt, 5);
    // reorder at root
    const r = moveLayers(ab, ['t'], { parentId: null, index: 0 });
    expect(r.children.map((l) => l.id)).toEqual(['t', 'bg', 'a', 'b']);
  });

  it('duplicates, reorders and deletes', () => {
    const ab = sampleArtboard();
    const d = duplicateLayers(ab, ['a'], { x: 10, y: 10 });
    expect(d.ids).toHaveLength(1);
    expect(d.artboard.children[2].id).toBe(d.ids[0]);
    expect(d.artboard.children[2].transform.x).toBe(60);
    expect(reorderLayers(ab, ['a'], 'front').children.map((l) => l.id)).toEqual(['bg', 'b', 't', 'a']);
    expect(reorderLayers(ab, ['a'], 'backward').children.map((l) => l.id)).toEqual(['a', 'bg', 'b', 't']);
    expect(deleteLayers(ab, ['a', 'b']).children.map((l) => l.id)).toEqual(['bg', 't']);
  });
});

describe('undo / redo', () => {
  it('records, coalesces and replays states', () => {
    let now = 0;
    const h = new History<number>(0, 100, 500, () => now);
    h.push(1);
    now += 100;
    h.push(2, { coalesce: 'x' });
    now += 100;
    h.push(3, { coalesce: 'x' }); // merged with 2
    expect(h.size.past).toBe(2);
    expect(h.undo()).toBe(1);
    expect(h.undo()).toBe(0);
    expect(h.undo()).toBeNull();
    expect(h.redo()).toBe(1);
    h.push(9);
    expect(h.canRedo).toBe(false);
    now += 1000;
    h.push(10, { coalesce: 'x' });
    h.push(11, { coalesce: 'y' });
    expect(h.undo()).toBe(10);
  });
});

describe('overrides vs bindings routing (US-4.2)', () => {
  const hero = createLayer('vector', { id: 'hero', shape: { kind: 'rect' }, transform: { x: 300, y: 50, width: 100, height: 100 }, bindings: { 'transform.x': 'heroX' } } as any);

  it('routes bound fields to props (by delta) and the rest to overrides', () => {
    const r = applyCompositionEdit(hero, { 'transform.x': 340, 'transform.y': 80 }, { props: { heroX: 280, title: 'X' }, overrides: {} });
    expect(r.props.heroX).toBe(320);
    expect(r.changedProps).toEqual(['heroX']);
    expect(r.overrides).toEqual({ hero: { transform: { y: 80 } } });
  });

  it('assigns non-numeric bound values and nested binding paths', () => {
    const text = createLayer('text', { id: 't', content: 'A', style: {}, bindings: { content: 'title', 'style.fill': 'titleFill' }, transform: {} } as any);
    const r = routePatch(text, { content: 'B', 'style.fill.color': '#ff0000' }, { title: 'A', titleFill: { type: 'solid', color: '#fff' } });
    expect(r.props).toEqual({ title: 'B', titleFill: { type: 'solid', color: '#ff0000' } });
    expect(bindingFor(text, 'style.fill.color')?.prop).toBe('titleFill');
  });

  it('expands nested override paths against the current layer', () => {
    const text = createLayer('text', { id: 't', content: 'A', style: {}, transform: {} } as any);
    const o = patchToOverride(text, { 'style.fill.color': '#123456', 'style.fontSize': 40, 'effects': [] });
    expect(o.style).toEqual({ fill: { type: 'solid', color: '#123456' }, fontSize: 40 });
    expect(o.effects).toEqual([]);
    const v = createLayer('vector', { id: 'v', shape: { kind: 'rect' }, fill: { type: 'solid', color: '#000' }, transform: {} } as any);
    expect(patchToOverride(v, { 'fill.color': '#fff' })).toEqual({ fill: { type: 'solid', color: '#fff' } });
  });
});

describe('props inspector form generation (US-4.1)', () => {
  it('maps JSON schema to widgets', () => {
    const schema = z.object({
      title: z.string().default('CHRONO'),
      body: zLongText('...'),
      accent: zColor('#ff3366'),
      hero: zImage('assets/hero.png'),
      font: zFont('Inter'),
      glow: z.number().min(0).max(100).default(40),
      size: zSlider(8, 200, 32),
      count: z.number().int().default(3),
      showLaurel: z.boolean().default(true),
      mode: z.enum(['dark', 'light']).default('dark'),
      sale: z.object({ percent: z.number().default(50), label: z.string().optional() }).default({ percent: 50 }),
      tags: z.array(z.string()).default([]),
      titles: zLocaleMap(z.string()).default({ en: 'Hello' }),
      optionalTagline: z.string().nullable().optional(),
    });
    const def = defineComposition({ id: 'x', width: 10, height: 10, component: () => null, schema, defaultProps: {} });
    const fields = buildPropFields(describeComposition(def).propsSchema as any);
    const kinds = Object.fromEntries(fields.map((f) => [f.key, f.kind]));
    expect(kinds).toMatchObject({
      title: 'text', body: 'textarea', accent: 'color', hero: 'image', font: 'font', glow: 'slider', size: 'slider', count: 'number',
      showLaurel: 'boolean', mode: 'enum', sale: 'object', tags: 'array', titles: 'locale-map', optionalTagline: 'text',
    });
    const glow = fields.find((f) => f.key === 'glow')!;
    expect([glow.min, glow.max]).toEqual([0, 100]);
    expect(fields.find((f) => f.key === 'mode')!.options!.map((o) => o.value)).toEqual(['dark', 'light']);
    expect(fields.find((f) => f.key === 'sale')!.fields!.map((f) => f.key)).toEqual(['percent', 'label']);
    expect(fields.find((f) => f.key === 'optionalTagline')!.nullable).toBe(true);
    expect(fields.find((f) => f.key === 'titles')!.item!.kind).toBe('text');
    expect(humanize('heroX')).toBe('Hero X');
    expect(defaultValueFor(fields.find((f) => f.key === 'tags')!.item!)).toBe('');
  });
});

describe('design documents', () => {
  it('exposes a layer field as a prop and routes canvas edits back to it', () => {
    const doc = createDocument({ name: 'D', artboards: [sampleArtboard()] });
    const exposed = exposeField(doc, 'ab', 'a', 'transform.x', 'cardX');
    expect((getLayer(exposed.artboards[0], 'a')!.transform as any).x).toEqual({ $prop: 'cardX' });
    expect(exposed.props!.defaults.cardX).toBe(50);
    expect((exposed.props!.schema.properties as any).cardX.type).toBe('number');
    const resolved = resolveDesignArtboard(exposed, 'ab');
    const layer = getLayer(resolved, 'a')!;
    expect(layer.transform.x).toBe(50);
    expect(layer.bindings).toEqual({ 'transform.x': 'cardX' });
    const r = routePatch(layer, { 'transform.x': 75 }, exposed.props!.defaults);
    expect(r.props).toEqual({ cardX: 75 });
    expect(collectPropUsage(exposed).get('cardX')).toHaveLength(1);
    const back = unexposeField(exposed, 'ab', 'a', 'transform.x');
    expect(getLayer(back.artboards[0], 'a')!.transform.x).toBe(50);
    expect(back.props).toBeUndefined();
  });

  it('detaches a compiled artboard into a design with $prop bindings', () => {
    const ab = createArtboard({ id: 'c', width: 100, height: 100, children: [createLayer('vector', { id: 'hero', shape: { kind: 'rect' }, transform: { x: 30 }, bindings: { 'transform.x': 'heroX' } } as any)] });
    const doc = detachToDocument(ab, { name: 'Detached', props: { heroX: 30, other: 1 }, propsSchema: { properties: { heroX: { type: 'number', default: 10 } } } });
    expect((doc.artboards[0].children[0].transform as any).x).toEqual({ $prop: 'heroX' });
    expect(doc.props!.defaults).toEqual({ heroX: 30 });
    expect(doc.artboards[0].children[0].bindings).toBeUndefined();
  });

  it('creates designs from store presets with safe zones', () => {
    const preset = { id: 'steam-library-hero', platform: 'steam', name: 'Steam Library Hero', width: 3840, height: 1240, safeZoneMargins: { top: 100, right: 200, bottom: 400, left: 200 } };
    const doc = newDesign({ width: preset.width, height: preset.height, preset });
    expect(doc.artboards[0].safeZones.length).toBeGreaterThan(0);
    expect(safeZonesFromMargins(preset)[0]).toMatchObject({ x: 200, y: 100, width: 3440, height: 740 });
    const text = createPrimitive('text', { artboardWidth: 3840, artboardHeight: 1240 });
    expect(text.type).toBe('text');
  });
});
