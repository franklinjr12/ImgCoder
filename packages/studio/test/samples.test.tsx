import { describe, expect, it } from 'vitest';
import { FontRegistry, compileComposition, findLayer, renderArtboardToSvg, describeComposition } from '@game-artisan/core';
import { loadBundledFonts } from '@game-artisan/fonts';
import { studioSamples } from '../src/builtin/samples';
import { applyCompositionEdit } from '../src/editor/routing';
import { buildPropFields } from '../src/editor/prop-form';
import { detachToDocument, resolveDesignArtboard } from '../src/editor/documents';

async function fonts() {
  const f = new FontRegistry();
  for (const b of await loadBundledFonts()) f.register(b.data, { family: b.family, weight: b.weight, style: b.style });
  return f;
}

describe('studio sample compositions', () => {
  it('compile, render with annotated layers and round-trip canvas edits through props', async () => {
    const reg = await fonts();
    const def = studioSamples.find((d) => d.id === 'studio-demo-capsule')!;
    const { artboard, props } = await compileComposition(def, { fonts: reg, props: {} });
    const hero = findLayer(artboard, 'hero')!.layer;
    expect(hero.bindings).toEqual({ 'transform.x': 'heroX', 'transform.y': 'heroY' });
    const { svg } = await renderArtboardToSvg(artboard, { fonts: reg, idPrefix: 'ga' });
    expect(svg).toContain('data-layer-id="hero"');
    expect(svg).toContain('id="ga-L-title"');

    // drag hero by +25px → props.heroX += 25 → recompiling moves the layer accordingly
    const edit = applyCompositionEdit(hero, { 'transform.x': hero.transform.x + 25 }, { props, overrides: {} });
    const again = await compileComposition(def, { fonts: reg, props: edit.props });
    expect(findLayer(again.artboard, 'hero')!.layer.transform.x).toBeCloseTo(hero.transform.x + 25);

    // the props schema yields inspector widgets
    const kinds = buildPropFields(describeComposition(def).propsSchema as any).map((f) => f.kind);
    expect(kinds).toEqual(expect.arrayContaining(['text', 'color', 'enum', 'font', 'number', 'slider', 'boolean']));

    // detach → design keeps the bindings as $prop and re-resolves identically
    const doc = detachToDocument(artboard, { name: 'D', props, propsSchema: describeComposition(def).propsSchema });
    const resolved = resolveDesignArtboard(doc, doc.artboards[0].id);
    expect(findLayer(resolved, 'hero')!.layer.transform.x).toBe(hero.transform.x);
  });

  it('all samples render without warnings', async () => {
    const reg = await fonts();
    for (const def of studioSamples) {
      const { artboard } = await compileComposition(def, { fonts: reg, props: {} });
      const r = await renderArtboardToSvg(artboard, { fonts: reg });
      expect(r.warnings).toEqual([]);
      expect(r.width).toBe(def.width);
    }
  });
});
