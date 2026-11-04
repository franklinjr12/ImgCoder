/** Layer Inspector: transform, appearance, typography (US-3.4), shape/image settings, effects & adjustments. */
import { applyToPoint, getPath, isVariableProp, type Layer, type Transform, type TextLayer } from '@game-artisan/core';
import {
  useStudio,
  editLayer,
  editLayers,
  studio,
  findLayerIn,
  resetLayerOverrides,
  exposeLayerField,
  unexposeLayerField,
  currentArtboardRaw,
  toggleClippingMask,
  toast,
} from '../../state/studio';
import { canvasModel, parentWorld } from '../canvas/model';
import { boxCorners, translateTransform } from '../../editor/geometry';
import { getLayer } from '../../editor/tree-ops';
import { suggestPropName } from '../../editor/documents';
import { layerDisplayName } from '../../editor/primitives';
import { ColorField, IconButton, NumberField, Row, Section, Segmented, Select, Slider, TextField, Toggle } from '../controls';
import { Icon } from '../icons';
import { AdjustmentsEditor, BlendSelect, EffectsEditor, FillEditor, StrokesEditor } from './paint';
import { AssetPicker, FontPicker } from './PropsInspector';
import { fontWeights } from '../../runtime/fonts';

const WEIGHT_NAMES: Record<number, string> = { 100: 'Thin', 200: 'Extra Light', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Extra Bold', 900: 'Black' };

export function LayerInspector() {
  const selection = useStudio((s) => s.selection);
  const live = useStudio((s) => s.live);
  const mode = useStudio((s) => s.mode);
  const doc = useStudio((s) => s.doc);
  const overrides = useStudio((s) => (s.mode === 'composition' && s.compositionId ? s.comp[s.compositionId]?.overrides : undefined));
  useStudio((s) => s.fontsVersion);
  if (!live) return null;
  const layers = selection.map((id) => findLayerIn(id)).filter((l): l is Layer => !!l);
  if (!layers.length) return <div className="empty-hint pad">Select a layer on the canvas or in the layers panel.</div>;
  if (layers.length > 1) return <MultiInspector layers={layers} />;
  const l = layers[0];
  const raw = mode === 'design' ? (getLayer(currentArtboardRaw()!, l.id) as Layer | null) : null;
  const set = (path: string, value: unknown, coalesce?: boolean | string) => editLayer(l.id, { [path]: value }, typeof coalesce === 'string' ? coalesce : coalesce ? `layer:${l.id}:${path}` : `layer:${l.id}:${path}:${Date.now()}`);

  // binding indicator / expose-as-prop button for a field path
  const Bind = ({ path }: { path: string }) => {
    const bound = l.bindings?.[path];
    const rawVal = raw ? getPath(raw, path) : undefined;
    if (mode === 'composition') {
      return bound ? (
        <span className="bind-chip" title={`Two-way bound to prop “${bound}” — editing updates the prop`}>
          <Icon name="link" size={11} />
          {bound}
        </span>
      ) : null;
    }
    if (isVariableProp(rawVal)) {
      return (
        <button type="button" className="bind-chip on" title={`Driven by prop “${rawVal.$prop}” — click to unbind`} onClick={() => unexposeLayerField(l.id, path)}>
          <Icon name="link" size={11} />
          {rawVal.$prop}
        </button>
      );
    }
    return (
      <button
        type="button"
        className="bind-btn"
        title="Expose as prop (agent/CLI renderable)"
        onClick={() => {
          const taken = Object.keys((doc?.props?.schema as any)?.properties ?? {});
          const name = prompt(`Expose “${path}” of “${layerDisplayName(l)}” as prop:`, suggestPropName(l, path, taken));
          if (!name) return;
          if (!/^[a-zA-Z_][\w]*$/.test(name)) return toast('Prop names must be identifiers (letters, digits, _)', 'warning');
          exposeLayerField(l.id, path, name);
        }}
      >
        <Icon name="link" size={11} />
      </button>
    );
  };

  const t = l.transform;
  const lab = (text: string, path: string) => (
    <span className="field-label">
      {text}
      <Bind path={path} />
    </span>
  );
  const overridden = overrides?.[l.id];

  return (
    <div className="inspector-scroll">
      <div className="layer-head">
        <Icon name={l.type === 'vector' ? `shape-${l.shape.kind}` : l.type} size={16} />
        <div className="layer-head-text">
          <TextField value={layerDisplayName(l)} onChange={(v) => v && set('name', v)} live={false} />
          <span className="layer-id">
            {l.type} · <code>{l.id}</code>
          </span>
        </div>
        {mode === 'composition' && overridden ? (
          <button type="button" className="btn small" onClick={() => resetLayerOverrides(l.id)} title="Remove this layer's canvas overrides">
            <Icon name="reset" size={12} /> Reset
          </button>
        ) : null}
      </div>
      {mode === 'composition' ? (
        <div className="info-note">
          {l.bindings && Object.keys(l.bindings).length ? (
            <>
              <Icon name="link" size={12} /> Bound fields update props; other edits are stored as <code>$overrides</code>.
            </>
          ) : (
            <>
              Edits on code templates are stored as <code>$overrides</code> (honoured by the CLI).
            </>
          )}
        </div>
      ) : null}

      <Section title="Transform">
        <div className="grid2">
          <NumberField label="X" value={t.x} onChange={(v, co) => set('transform.x', v, co)} />
          <NumberField label="Y" value={t.y} onChange={(v, co) => set('transform.y', v, co)} />
          <NumberField label="W" value={t.width} min={0} onChange={(v, co) => set('transform.width', v, co)} />
          <NumberField label="H" value={t.height} min={0} onChange={(v, co) => set('transform.height', v, co)} />
          <NumberField label="∠" value={t.rotation} suffix="°" onChange={(v, co) => set('transform.rotation', v, co)} title="Rotation" />
          <NumberField label="Op" value={Math.round(l.opacity * 100)} min={0} max={100} suffix="%" onChange={(v, co) => set('opacity', v / 100, co)} title="Opacity" />
          <NumberField label="Sk X" value={t.skewX} suffix="°" min={-85} max={85} onChange={(v, co) => set('transform.skewX', v, co)} title="Skew X (Ctrl/⌘ + drag top/bottom handle)" />
          <NumberField label="Sk Y" value={t.skewY} suffix="°" min={-85} max={85} onChange={(v, co) => set('transform.skewY', v, co)} title="Skew Y (Ctrl/⌘ + drag left/right handle)" />
          <NumberField label="Sc X" value={t.scaleX} step={0.05} precision={3} onChange={(v, co) => set('transform.scaleX', v, co)} title="Scale X" />
          <NumberField label="Sc Y" value={t.scaleY} step={0.05} precision={3} onChange={(v, co) => set('transform.scaleY', v, co)} title="Scale Y" />
        </div>
        {mode === 'design' || (l.bindings && Object.keys(l.bindings).length) ? <div className="bind-line">
          {['transform.x', 'transform.y', 'transform.width', 'transform.height', 'transform.rotation', 'opacity'].map((p) => (
            <span key={p} className="bind-line-item">
              <span>{p.replace('transform.', '')}</span>
              <Bind path={p} />
            </span>
          ))}
        </div> : null}
        <div className="btn-row tight">
          <IconButton icon="fit" title="Flip horizontally" active={!!t.flipX} onClick={() => set('transform.flipX', !t.flipX)}>
            <span className="btn-text">Flip H</span>
          </IconButton>
          <IconButton icon="fit" title="Flip vertically" active={!!t.flipY} onClick={() => set('transform.flipY', !t.flipY)}>
            <span className="btn-text">Flip V</span>
          </IconButton>
          <AlignButtons ids={[l.id]} />
        </div>
        <Row label="Blend">
          <BlendSelect value={l.blendMode} onChange={(v) => set('blendMode', v)} />
        </Row>
        <Row label="Clip to layer below">
          <Toggle value={!!l.clippingMask} onChange={() => toggleClippingMask([l.id])} />
        </Row>
      </Section>

      {l.type === 'text' ? <TextSection l={l} set={set} lab={lab} /> : null}

      {l.type === 'vector' ? (
        <>
          <Section title="Shape">
            {l.shape.kind === 'rect' ? (
              <Row label="Corner radius">
                <Slider value={typeof l.shape.cornerRadius === 'number' ? l.shape.cornerRadius : l.shape.cornerRadius[0]} min={0} max={Math.round(Math.min(t.width, t.height) / 2)} onChange={(v, co) => set('shape.cornerRadius', v, co)} />
              </Row>
            ) : null}
            {l.shape.kind === 'polygon' ? (
              <Row label="Sides">
                <Slider value={l.shape.sides} min={3} max={24} onChange={(v, co) => set('shape.sides', Math.round(v), co)} />
              </Row>
            ) : null}
            {l.shape.kind === 'star' ? (
              <>
                <Row label="Points">
                  <Slider value={l.shape.points} min={2} max={40} onChange={(v, co) => set('shape.points', Math.round(v), co)} />
                </Row>
                <Row label="Inner ratio">
                  <Slider value={l.shape.innerRatio} min={0.05} max={1} step={0.01} onChange={(v, co) => set('shape.innerRatio', v, co)} />
                </Row>
              </>
            ) : null}
            {l.shape.kind === 'polygon' || l.shape.kind === 'star' ? (
              <Row label="Rotation">
                <Slider value={l.shape.rotation} min={-180} max={180} onChange={(v, co) => set('shape.rotation', v, co)} suffix="°" />
              </Row>
            ) : null}
            {l.shape.kind === 'path' ? (
              <>
                <Row label="Path data" wide>
                  <TextField value={l.shape.d} multiline mono live={false} onChange={(v) => set('shape.d', v)} />
                </Row>
                <Row label="Fill rule">
                  <Select value={l.shape.fillRule} options={['nonzero', 'evenodd']} onChange={(v) => set('shape.fillRule', v)} />
                </Row>
              </>
            ) : null}
            {l.shape.kind === 'line' ? (
              <Row label="Closed">
                <Toggle value={l.shape.closed} onChange={(v) => set('shape.closed', v)} />
              </Row>
            ) : null}
          </Section>
          <Section title="Fill" actions={<Bind path="fill" />}>
            <FillEditor fill={l.fill} onChange={(f, co) => set('fill', f ?? { type: 'none' }, co)} />
          </Section>
          <Section title="Strokes" badge={<span className="count">{l.strokes.length}</span>}>
            <StrokesEditor strokes={l.strokes} onChange={(s, co) => set('strokes', s, co)} />
          </Section>
        </>
      ) : null}

      {l.type === 'raster' ? (
        <Section title="Image">
          <Row label={lab('Source', 'src')} wide>
            <AssetPicker value={l.src} onChange={(v) => set('src', v)} />
          </Row>
          <Row label="Fit">
            <Segmented value={l.fit} onChange={(v) => set('fit', v)} options={[{ value: 'cover', label: 'Cover' }, { value: 'contain', label: 'Contain' }, { value: 'fill', label: 'Fill' }, { value: 'none', label: 'None' }]} />
          </Row>
          <Row label="Focus X">
            <Slider value={l.position?.x ?? 0.5} min={0} max={1} step={0.01} onChange={(v, co) => set('position.x', v, co)} />
          </Row>
          <Row label="Focus Y">
            <Slider value={l.position?.y ?? 0.5} min={0} max={1} step={0.01} onChange={(v, co) => set('position.y', v, co)} />
          </Row>
          <Row label="Rendering">
            <Segmented value={l.rendering} onChange={(v) => set('rendering', v)} options={[{ value: 'auto', label: 'Auto' }, { value: 'smooth', label: 'Smooth' }, { value: 'pixelated', label: 'Pixelated' }]} />
          </Row>
          <Row label="Corner radius">
            <Slider value={l.cornerRadius} min={0} max={Math.round(Math.min(t.width, t.height) / 2)} onChange={(v, co) => set('cornerRadius', v, co)} />
          </Row>
        </Section>
      ) : null}

      {l.type === 'svg' ? (
        <Section title="Vector image">
          {l.src || !l.markup ? (
            <Row label={lab('Source', 'src')} wide>
              <AssetPicker value={l.src ?? ''} svg onChange={(v) => set('src', v)} />
            </Row>
          ) : (
            <Row label="Markup" wide>
              <TextField value={l.markup ?? ''} multiline mono live={false} rows={4} onChange={(v) => set('markup', v)} />
            </Row>
          )}
          <Row label="Fit">
            <Segmented value={l.fit} onChange={(v) => set('fit', v)} options={[{ value: 'contain', label: 'Contain' }, { value: 'cover', label: 'Cover' }, { value: 'fill', label: 'Fill' }]} />
          </Row>
          <Row label={lab('Recolor', 'color')}>
            <div className="inline">
              <Toggle value={!!l.color} onChange={(v) => set('color', v ? '#ffffff' : undefined)} />
              {l.color ? <ColorField value={l.color} onChange={(c, co) => set('color', c, co)} /> : null}
            </div>
          </Row>
        </Section>
      ) : null}

      {l.type === 'halftone' ? (
        <Section title="Halftone">
          <Row label="Dot">
            <Segmented value={l.dot} onChange={(v) => set('dot', v)} options={['circle', 'square', 'diamond', 'line'].map((d) => ({ value: d, label: d[0].toUpperCase() + d.slice(1) }))} />
          </Row>
          <Row label="Spacing">
            <Slider value={l.spacing} min={2} max={80} onChange={(v, co) => set('spacing', v, co)} />
          </Row>
          <Row label="Angle">
            <Slider value={l.angle} min={0} max={180} onChange={(v, co) => set('angle', v, co)} suffix="°" />
          </Row>
          <Row label="Min size">
            <Slider value={l.minSize} min={0} max={1} step={0.01} onChange={(v, co) => set('minSize', v, co)} />
          </Row>
          <Row label="Max size">
            <Slider value={l.maxSize} min={0} max={1.5} step={0.01} onChange={(v, co) => set('maxSize', v, co)} />
          </Row>
          <Row label="Falloff">
            <Segmented value={l.falloff} onChange={(v) => set('falloff', v)} options={[{ value: 'linear', label: 'Linear' }, { value: 'radial', label: 'Radial' }]} />
          </Row>
          {l.falloff === 'linear' ? (
            <Row label="Direction">
              <Slider value={l.gradientAngle} min={0} max={360} onChange={(v, co) => set('gradientAngle', v, co)} suffix="°" />
            </Row>
          ) : null}
          <Row label={lab('Color', 'color')}>
            <ColorField value={l.color} onChange={(c, co) => set('color', c, co)} />
          </Row>
        </Section>
      ) : null}

      {l.type === 'pattern' ? (
        <Section title="Pattern">
          <Row label="Pattern">
            <Select value={l.pattern} options={['scanlines', 'grid', 'dots', 'checker', 'diagonal']} onChange={(v) => set('pattern', v)} />
          </Row>
          <Row label="Spacing">
            <Slider value={l.spacing} min={1} max={80} onChange={(v, co) => set('spacing', v, co)} />
          </Row>
          <Row label="Thickness">
            <Slider value={l.thickness} min={0.1} max={20} step={0.1} onChange={(v, co) => set('thickness', v, co)} />
          </Row>
          <Row label={lab('Color', 'color')}>
            <ColorField value={l.color} onChange={(c, co) => set('color', c, co)} />
          </Row>
          <Row label="Background">
            <div className="inline">
              <Toggle value={!!l.background} onChange={(v) => set('background', v ? '#000000' : undefined)} />
              {l.background ? <ColorField value={l.background} onChange={(c, co) => set('background', c, co)} /> : null}
            </div>
          </Row>
        </Section>
      ) : null}

      {l.type === 'group' ? (
        <Section title="Frame">
          <Row label="Clip content">
            <Toggle value={l.clipContent} onChange={(v) => set('clipContent', v)} />
          </Row>
          <Row label="Corner radius">
            <Slider value={l.cornerRadius} min={0} max={Math.round(Math.min(t.width, t.height) / 2)} onChange={(v, co) => set('cornerRadius', v, co)} />
          </Row>
          <FillEditor fill={l.fill ?? { type: 'none' }} onChange={(f, co) => set('fill', f && f.type !== 'none' ? f : undefined, co)} />
        </Section>
      ) : null}
      {l.type === 'mask' ? (
        <Section title="Mask">
          <Row label="Mode">
            <Segmented value={l.mode} onChange={(v) => set('mode', v)} options={[{ value: 'alpha', label: 'Alpha' }, { value: 'luminance', label: 'Luminance' }]} />
          </Row>
        </Section>
      ) : null}
      {l.type === 'boolean' ? (
        <Section title="Boolean">
          <Row label="Operation">
            <Select value={l.operation} options={['union', 'subtract', 'intersect', 'exclude']} onChange={(v) => set('operation', v)} />
          </Row>
          <FillEditor fill={l.fill} onChange={(f, co) => set('fill', f ?? { type: 'none' }, co)} />
        </Section>
      ) : null}

      <Section title="Effects" badge={<span className="count">{l.effects.length}</span>}>
        <EffectsEditor effects={l.effects} onChange={(e, co) => set('effects', e, co)} />
      </Section>
      <Section title="Adjustments & grading" badge={<span className="count">{l.adjustments.length}</span>}>
        <AdjustmentsEditor adjustments={l.adjustments} onChange={(a, co) => set('adjustments', a, co)} />
      </Section>
    </div>
  );
}

function TextSection({ l, set, lab }: { l: TextLayer; set: (p: string, v: unknown, co?: boolean | string) => void; lab: (t: string, p: string) => React.JSX.Element }) {
  const st = l.style;
  const weights = fontWeights(st.fontFamily);
  const allWeights = [100, 200, 300, 400, 500, 600, 700, 800, 900];
  return (
    <>
      <Section title="Text">
        <Row label={lab('Content', 'content')} wide>
          <TextField value={l.content} multiline rows={3} onChange={(v) => set('content', v, `content:${l.id}`)} />
        </Row>
        <Row label={lab('Font', 'style.fontFamily')}>
          <FontPicker value={st.fontFamily} onChange={(v) => set('style.fontFamily', v)} />
        </Row>
        <div className="grid2">
          <Select
            value={st.fontWeight}
            title="Weight"
            options={allWeights.map((w) => ({ value: w, label: `${w} ${WEIGHT_NAMES[w]}${weights.length && !weights.includes(w) ? ' (synth.)' : ''}` }))}
            onChange={(v) => set('style.fontWeight', v)}
          />
          <NumberField label="Size" value={st.fontSize} min={1} onChange={(v, co) => set('style.fontSize', v, co)} />
          <NumberField label="Track" value={st.letterSpacing} step={0.5} onChange={(v, co) => set('style.letterSpacing', v, co)} title="Letter spacing (tracking, px)" />
          <NumberField label="Line" value={st.lineHeight} step={0.05} precision={3} onChange={(v, co) => set('style.lineHeight', v, co)} title="Line height (× font size)" />
        </div>
        <Row label="Align">
          <Segmented value={st.textAlign} onChange={(v) => set('style.textAlign', v)} options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }, { value: 'justify', label: 'Justify' }]} />
        </Row>
        <Row label="Vertical">
          <Segmented value={st.verticalAlign} onChange={(v) => set('style.verticalAlign', v)} options={[{ value: 'top', label: 'Top' }, { value: 'middle', label: 'Middle' }, { value: 'bottom', label: 'Bottom' }]} />
        </Row>
        <Row label="Case">
          <Segmented value={st.textTransform} onChange={(v) => set('style.textTransform', v)} options={[{ value: 'none', label: 'Aa' }, { value: 'uppercase', label: 'AA' }, { value: 'lowercase', label: 'aa' }, { value: 'capitalize', label: 'Ab' }]} />
        </Row>
        <Row label="Italic">
          <Toggle value={st.fontStyle === 'italic'} onChange={(v) => set('style.fontStyle', v ? 'italic' : 'normal')} />
        </Row>
        <Row label="Sizing">
          <Segmented value={l.sizing} onChange={(v) => set('sizing', v)} options={[{ value: 'fixed', label: 'Fixed' }, { value: 'auto-height', label: 'Auto H' }, { value: 'auto-width', label: 'Auto W' }]} />
        </Row>
        <Row label="Shrink to fit">
          <div className="inline">
            <Toggle value={st.fit === 'shrink'} onChange={(v) => set('style.fit', v ? 'shrink' : 'none')} />
            {st.fit === 'shrink' ? <NumberField label="Min" value={st.minFontSize} min={1} onChange={(v, co) => set('style.minFontSize', v, co)} /> : null}
          </div>
        </Row>
        <Row label="Max lines">
          <div className="inline">
            <Toggle value={st.maxLines != null} onChange={(v) => set('style.maxLines', v ? 2 : undefined)} />
            {st.maxLines != null ? <NumberField value={st.maxLines} min={1} step={1} onChange={(v, co) => set('style.maxLines', Math.max(1, Math.round(v)), co)} /> : null}
          </div>
        </Row>
        <Row label="Wrap">
          <Toggle value={st.wrap} onChange={(v) => set('style.wrap', v)} />
        </Row>
      </Section>
      <Section title="Text fill" actions={<span />}>
        <FillEditor fill={st.fill} allowNone={false} onChange={(f, co) => set('style.fill', f ?? { type: 'solid', color: '#ffffff' }, co)} />
      </Section>
      <Section title="Outlines (multi-stroke)" badge={<span className="count">{st.strokes.length}</span>}>
        <StrokesEditor strokes={st.strokes} onChange={(s, co) => set('style.strokes', s, co)} hint="Listed inner → outer; outside strokes stack like game-logo outlines." />
      </Section>
    </>
  );
}

function MultiInspector({ layers }: { layers: Layer[] }) {
  const op = layers.every((l) => l.opacity === layers[0].opacity) ? layers[0].opacity : undefined;
  return (
    <div className="inspector-scroll">
      <div className="layer-head">
        <Icon name="layers" size={16} />
        <div className="layer-head-text">
          <strong>{layers.length} layers selected</strong>
          <span className="layer-id">Drag handles to scale/rotate collectively</span>
        </div>
      </div>
      <Section title="Align & distribute">
        <div className="btn-row tight">
          <AlignButtons ids={layers.map((l) => l.id)} />
        </div>
      </Section>
      <Section title="Appearance">
        <Row label="Opacity">
          <Slider value={Math.round((op ?? 1) * 100)} min={0} max={100} suffix="%" onChange={(v) => editLayers(Object.fromEntries(layers.map((l) => [l.id, { opacity: v / 100 }])), { coalesce: 'multi-opacity' })} />
        </Row>
        <Row label="Blend">
          <BlendSelect value={layers.every((l) => l.blendMode === layers[0].blendMode) ? layers[0].blendMode : 'normal'} onChange={(v) => editLayers(Object.fromEntries(layers.map((l) => [l.id, { blendMode: v }])))} />
        </Row>
      </Section>
    </div>
  );
}

type AlignKind = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom' | 'hdist' | 'vdist';

/** Align layers to their common bounds (multi) or to the artboard (single); distribute spacing. */
export function alignLayers(ids: string[], kind: AlignKind): void {
  const s = studio.get();
  if (!s.live) return;
  const model = canvasModel(s.live);
  const boxes = ids
    .filter((id) => model.layers.has(id) && !model.locked.has(id))
    .map((id) => {
      const l = model.layers.get(id)!;
      const pts = boxCorners(model.world.get(id)!, l.transform.width, l.transform.height);
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      return { id, t: l.transform as Transform, pw: parentWorld(model, id), x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    });
  if (!boxes.length) return;
  const single = boxes.length === 1;
  const B = single ? { x0: 0, x1: s.live.width, y0: 0, y1: s.live.height } : { x0: Math.min(...boxes.map((b) => b.x0)), x1: Math.max(...boxes.map((b) => b.x1)), y0: Math.min(...boxes.map((b) => b.y0)), y1: Math.max(...boxes.map((b) => b.y1)) };
  const patches: Record<string, Record<string, unknown>> = {};
  const move = (b: (typeof boxes)[number], dx: number, dy: number) => {
    if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return;
    const nt = translateTransform(b.t, b.pw, { x: dx, y: dy });
    patches[b.id] = { 'transform.x': Math.round(nt.x * 100) / 100, 'transform.y': Math.round(nt.y * 100) / 100 };
  };
  if (kind === 'hdist' || kind === 'vdist') {
    if (boxes.length < 3) return toast('Select 3+ layers to distribute', 'info');
    const horiz = kind === 'hdist';
    const sorted = [...boxes].sort((a, b) => (horiz ? a.x0 - b.x0 : a.y0 - b.y0));
    const total = sorted.reduce((acc, b) => acc + (horiz ? b.x1 - b.x0 : b.y1 - b.y0), 0);
    const span = horiz ? B.x1 - B.x0 : B.y1 - B.y0;
    const gap = (span - total) / (sorted.length - 1);
    let cur = horiz ? B.x0 : B.y0;
    for (const b of sorted) {
      if (horiz) move(b, cur - b.x0, 0);
      else move(b, 0, cur - b.y0);
      cur += (horiz ? b.x1 - b.x0 : b.y1 - b.y0) + gap;
    }
  } else {
    for (const b of boxes) {
      if (kind === 'left') move(b, B.x0 - b.x0, 0);
      if (kind === 'right') move(b, B.x1 - b.x1, 0);
      if (kind === 'hcenter') move(b, (B.x0 + B.x1) / 2 - (b.x0 + b.x1) / 2, 0);
      if (kind === 'top') move(b, 0, B.y0 - b.y0);
      if (kind === 'bottom') move(b, 0, B.y1 - b.y1);
      if (kind === 'vcenter') move(b, 0, (B.y0 + B.y1) / 2 - (b.y0 + b.y1) / 2);
    }
  }
  editLayers(patches, { label: 'Align' });
  void applyToPoint;
}

function AlignButtons({ ids }: { ids: string[] }) {
  const items: { k: AlignKind; t: string; d: string }[] = [
    { k: 'left', t: 'Align left', d: 'M4 3v18M8 7h10v4H8zM8 13h6v4H8z' },
    { k: 'hcenter', t: 'Align horizontal centers', d: 'M12 3v18M6 7h12v4H6zM8 13h8v4H8z' },
    { k: 'right', t: 'Align right', d: 'M20 3v18M6 7h10v4H6zM10 13h6v4h-6z' },
    { k: 'top', t: 'Align top', d: 'M3 4h18M7 8h4v10H7zM13 8h4v6h-4z' },
    { k: 'vcenter', t: 'Align vertical centers', d: 'M3 12h18M7 6h4v12H7zM13 8h4v8h-4z' },
    { k: 'bottom', t: 'Align bottom', d: 'M3 20h18M7 6h4v10H7zM13 10h4v6h-4z' },
    { k: 'hdist', t: 'Distribute horizontally', d: 'M4 3v18M20 3v18M10 8h4v8h-4z' },
    { k: 'vdist', t: 'Distribute vertically', d: 'M3 4h18M3 20h18M8 10h8v4H8z' },
  ];
  return (
    <div className="align-buttons" title={ids.length === 1 ? 'Align to artboard' : 'Align to selection'}>
      {items.filter((i) => ids.length >= 3 || !i.k.endsWith('dist')).map((i) => (
        <button key={i.k} type="button" className="icon-btn" title={`${i.t}${ids.length === 1 ? ' (to artboard)' : ''}`} onClick={() => alignLayers(ids, i.k)}>
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
            <path d={i.d} />
          </svg>
        </button>
      ))}
    </div>
  );
}
