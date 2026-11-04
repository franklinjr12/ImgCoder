import { describe, expect, it } from 'vitest';
import {
  createArtboard, createDocument, createLayer, deserializeDocument, serializeDocument, validateDocument, getUdmJsonSchema,
  resolveDocumentVariables, collectBoundProps, walkLayers, findLayer, computeWorldMatrices, layerWorldBounds, mapLayers, updateLayer,
  removeLayers, migrateDocument, UdmValidationError, LayerSchema,
} from '@game-artisan/core';

const doc = () =>
  createDocument({
    id: 'doc-1',
    name: 'Test',
    artboards: [
      createArtboard({
        id: 'main',
        width: 460,
        height: 215,
        background: { type: 'solid', color: '#000' },
        children: [
          createLayer('group', {
            id: 'g',
            transform: { x: 100, y: 50, width: 200, height: 100, rotation: 90 },
            children: [createLayer('vector', { id: 'r', shape: { kind: 'rect', cornerRadius: 4 } as any, transform: { x: 0, y: 0, width: 50, height: 20 } })],
          } as any),
          createLayer('text', { id: 't', content: 'Hello', style: { fontSize: 20 } as any, transform: { width: 100, height: 30 } }),
        ],
      }),
    ],
  });

describe('UDM schema', () => {
  it('fills defaults for every layer type', () => {
    for (const type of ['vector', 'raster', 'text', 'svg', 'halftone', 'pattern'] as const) {
      const extra: any = { vector: { shape: { kind: 'ellipse' } }, raster: { src: 'x.png' }, text: { content: 'x', style: {} }, svg: { markup: '<svg/>' }, halftone: {}, pattern: {} }[type];
      const l = createLayer(type, extra);
      expect(l.visible).toBe(true);
      expect(l.opacity).toBe(1);
      expect(l.transform.scaleX).toBe(1);
      expect(LayerSchema.safeParse(l).success).toBe(true);
    }
  });

  it('serialises deterministically and round-trips', () => {
    const d = doc();
    const a = serializeDocument(d);
    const b = serializeDocument(deserializeDocument(a));
    expect(a).toBe(b);
    expect(JSON.parse(a).artboards[0].children[0].children[0].id).toBe('r');
  });

  it('reports precise validation issues', () => {
    const bad = { id: 'x', artboards: [{ id: 'a', width: 10, height: 10, children: [{ id: 'l', type: 'vector', transform: {}, shape: { kind: 'nope' } }] }] };
    const r = validateDocument(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0].path).toContain('artboards.0.children.0.shape');
    expect(() => deserializeDocument(bad)).toThrow(UdmValidationError);
  });

  it('migrates v0 single-artboard documents', () => {
    const m = migrateDocument({ id: 'old', width: 100, height: 50, layers: [] });
    expect(m.artboards[0].width).toBe(100);
    expect(m.version).toBe(1);
  });

  it('exports a JSON schema with $defs for recursive layers', () => {
    const s = getUdmJsonSchema() as any;
    expect(s.$schema).toContain('json-schema.org');
    expect(JSON.stringify(s)).toContain('"Layer"');
  });
});

describe('VariableProp bindings', () => {
  const raw = {
    id: 'tpl',
    props: { schema: { type: 'object' }, defaults: { title: 'DEFAULT', x: 12 } },
    artboards: [{ id: 'a', width: 100, height: 100, children: [{ id: 'title', type: 'text', content: { $prop: 'title' }, style: { fontSize: { $prop: 'size', fallback: 33 } }, transform: { x: { $prop: 'x' }, width: 50, height: 20 } }] }],
  };
  it('resolves props, defaults and fallbacks and records bindings', () => {
    const d = deserializeDocument(raw);
    const r = resolveDocumentVariables(d, { title: 'NEON' });
    const t: any = r.artboards[0].children[0];
    expect(t.content).toBe('NEON');
    expect(t.transform.x).toBe(12);
    expect(t.style.fontSize).toBe(33);
    expect(t.bindings).toMatchObject({ content: 'title', 'transform.x': 'x', 'style.fontSize': 'size' });
    expect([...collectBoundProps(raw)].sort()).toEqual(['size', 'title', 'x']);
  });
  it('supports format strings', () => {
    const d = deserializeDocument({ ...raw, props: { schema: {}, defaults: { pct: 10 } }, artboards: [{ id: 'a', width: 10, height: 10, children: [{ id: 't', type: 'text', content: { $prop: 'pct', format: '-{value}%' }, style: {}, transform: {} }] }] });
    expect((resolveDocumentVariables(d, { pct: 50 }).artboards[0].children[0] as any).content).toBe('-50%');
  });
});

describe('tree utilities', () => {
  it('walks, finds and computes world transforms with inherited coordinates', () => {
    const ab = doc().artboards[0];
    const ids: string[] = [];
    walkLayers(ab, ({ layer }) => void ids.push(layer.id));
    expect(ids).toEqual(['g', 'r', 't']);
    expect(findLayer(ab, 'r')?.parent?.id).toBe('g');
    const world = computeWorldMatrices(ab).get('r')!;
    // group rotated 90° about its centre (200,100): child origin (0,0) local → group space (0,0) → world
    expect(world[4]).toBeCloseTo(250, 5);
    expect(world[5]).toBeCloseTo(0, 5);
    const b = layerWorldBounds(ab, 'r')!;
    expect(b.width).toBeCloseTo(20, 5);
    expect(b.height).toBeCloseTo(50, 5);
  });
  it('maps/updates/removes immutably', () => {
    const ab = doc().artboards[0];
    const up = updateLayer(ab, 'r', (l) => ({ ...l, name: 'renamed' }));
    expect(findLayer(up, 'r')?.layer.name).toBe('renamed');
    expect(findLayer(ab, 'r')?.layer.name).toBeUndefined();
    expect(findLayer(removeLayers(ab, ['r']), 'r')).toBeNull();
    expect(mapLayers(ab.children, (l) => l)).toEqual(ab.children);
  });
});
