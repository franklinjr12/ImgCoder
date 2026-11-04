/** Fill (solid / linear / radial with stops), multi-stroke, effects (Epic 7.3) and adjustments (Epic 7.1/7.2) editors. */
import { useState } from 'react';
import { GRADING_PRESETS, GRADING_PRESET_LABELS, type Adjustment, type Effect, type Fill, type Stroke, type GradientStop } from '@game-artisan/core';
import { ColorField, IconButton, NumberField, Row, Select, Segmented, Slider, Toggle } from '../controls';
import { Icon } from '../icons';

// ---------------------------------------------------------------------------------------- fill

const fillCss = (f: Fill | undefined): string => {
  if (!f || f.type === 'none') return 'transparent';
  if (f.type === 'solid') return f.color;
  const stops = [...f.stops].sort((a, b) => a.offset - b.offset).map((s) => `${s.color} ${Math.round(s.offset * 100)}%`).join(', ');
  return f.type === 'linear-gradient' ? `linear-gradient(${f.angle}deg, ${stops})` : `radial-gradient(circle, ${stops})`;
};

function firstColor(f: Fill | undefined): string {
  if (!f) return '#ffffff';
  if (f.type === 'solid') return f.color;
  if (f.type === 'none') return '#ffffff';
  return f.stops[0]?.color ?? '#ffffff';
}

export function FillEditor({ fill, onChange, allowNone = true }: { fill: Fill | undefined; onChange: (f: Fill | undefined, coalesce?: boolean) => void; allowNone?: boolean }) {
  const type = fill?.type ?? 'none';
  const stops: GradientStop[] = fill && (fill.type === 'linear-gradient' || fill.type === 'radial-gradient') ? fill.stops : [];
  const setType = (t: string) => {
    const c = firstColor(fill);
    if (t === 'none') onChange(allowNone ? { type: 'none' } : undefined);
    else if (t === 'solid') onChange({ type: 'solid', color: c });
    else {
      const s = stops.length >= 2 ? stops : [{ offset: 0, color: c }, { offset: 1, color: 'rgba(0,0,0,0)' }];
      onChange(t === 'linear-gradient' ? { type: 'linear-gradient', angle: (fill as any)?.angle ?? 180, stops: s } : { type: 'radial-gradient', cx: 0.5, cy: 0.5, r: 0.5, stops: s });
    }
  };
  const setStops = (next: GradientStop[], coalesce?: boolean) => onChange({ ...(fill as any), stops: next }, coalesce);
  return (
    <div className="fill-editor">
      <Segmented
        value={type}
        onChange={setType}
        options={[
          ...(allowNone ? [{ value: 'none', label: 'None' }] : []),
          { value: 'solid', label: 'Solid' },
          { value: 'linear-gradient', label: 'Linear' },
          { value: 'radial-gradient', label: 'Radial' },
        ]}
      />
      {fill?.type === 'solid' ? <ColorField value={fill.color} onChange={(c, co) => onChange({ type: 'solid', color: c }, co)} /> : null}
      {fill && (fill.type === 'linear-gradient' || fill.type === 'radial-gradient') ? (
        <>
          <div className="gradient-bar" style={{ background: `${fillCss({ ...fill, type: 'linear-gradient', angle: 90 } as Fill)}, var(--checker)` }}>
            {stops.map((s, i) => (
              <span key={i} className="stop-pin" style={{ left: `${s.offset * 100}%`, background: s.color }} />
            ))}
          </div>
          {fill.type === 'linear-gradient' ? (
            <Row label="Angle">
              <Slider value={fill.angle} min={0} max={360} onChange={(v, co) => onChange({ ...fill, angle: v }, co)} suffix="°" />
            </Row>
          ) : (
            <div className="grid3">
              <NumberField label="CX" value={fill.cx} step={0.05} onChange={(v, co) => onChange({ ...fill, cx: v }, co)} />
              <NumberField label="CY" value={fill.cy} step={0.05} onChange={(v, co) => onChange({ ...fill, cy: v }, co)} />
              <NumberField label="R" value={fill.r} step={0.05} min={0} onChange={(v, co) => onChange({ ...fill, r: v }, co)} />
            </div>
          )}
          {stops.map((s, i) => (
            <div key={i} className="stop-row">
              <ColorField value={s.color} onChange={(c, co) => setStops(stops.map((x, j) => (j === i ? { ...x, color: c } : x)), co)} />
              <NumberField value={Math.round(s.offset * 100)} min={0} max={100} suffix="%" onChange={(v, co) => setStops(stops.map((x, j) => (j === i ? { ...x, offset: v / 100 } : x)), co)} />
              <IconButton icon="minus" title="Remove stop" disabled={stops.length <= 1} onClick={() => setStops(stops.filter((_, j) => j !== i))} />
            </div>
          ))}
          <button type="button" className="btn small ghost" onClick={() => setStops([...stops, { offset: 1, color: stops[stops.length - 1]?.color ?? '#ffffff' }].sort((a, b) => a.offset - b.offset))}>
            <Icon name="plus" size={12} /> Add stop
          </button>
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------- strokes

export function StrokesEditor({ strokes, onChange, hint }: { strokes: Stroke[]; onChange: (s: Stroke[], coalesce?: boolean) => void; hint?: string }) {
  const set = (i: number, patch: Partial<Stroke>, co?: boolean) => onChange(strokes.map((s, j) => (j === i ? { ...s, ...patch } : s)), co);
  return (
    <div className="list-editor">
      {strokes.map((s, i) => (
        <div key={i} className="list-item">
          <div className="list-item-head">
            <span className="list-index">{i + 1}</span>
            <ColorField value={s.color ?? (s.fill?.type === 'solid' ? s.fill.color : '#000000')} onChange={(c, co) => set(i, { color: c, fill: undefined }, co)} />
            <IconButton icon="trash" title="Remove stroke" onClick={() => onChange(strokes.filter((_, j) => j !== i))} />
          </div>
          <div className="grid3">
            <NumberField label="W" value={s.width} min={0} step={0.5} onChange={(v, co) => set(i, { width: v }, co)} title="Width" />
            <Select value={s.align} options={[{ value: 'center', label: 'Center' }, { value: 'outside', label: 'Outside' }]} onChange={(v) => set(i, { align: v as Stroke['align'] })} title="Alignment" />
            <Select value={s.join} options={['miter', 'round', 'bevel']} onChange={(v) => set(i, { join: v as Stroke['join'] })} title="Join" />
          </div>
          <div className="grid2">
            <NumberField label="Op" value={Math.round((s.opacity ?? 1) * 100)} min={0} max={100} suffix="%" onChange={(v, co) => set(i, { opacity: v / 100 }, co)} title="Opacity" />
            <Select value={s.dash?.length ? 'dashed' : 'solid'} options={['solid', 'dashed']} onChange={(v) => set(i, { dash: v === 'dashed' ? [Math.max(2, s.width * 3), Math.max(2, s.width * 2)] : undefined })} title="Dash" />
          </div>
        </div>
      ))}
      <button type="button" className="btn small ghost" onClick={() => onChange([...strokes, { color: strokes.length ? '#000000' : '#000000', width: Math.max(1, (strokes[strokes.length - 1]?.width ?? 2) + 2), cap: 'round', join: 'round', align: 'outside' } as Stroke])}>
        <Icon name="plus" size={12} /> Add stroke
      </button>
      {hint ? <div className="row-hint">{hint}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------- effects & adjustments

type FieldSpec =
  | { key: string; label: string; kind: 'number'; min?: number; max?: number; step?: number; slider?: boolean; percent?: boolean; suffix?: string }
  | { key: string; label: string; kind: 'color' }
  | { key: string; label: string; kind: 'enum'; options: string[] }
  | { key: string; label: string; kind: 'colors' };

const BLEND = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];

const shadowFields: FieldSpec[] = [
  { key: 'color', label: 'Color', kind: 'color' },
  { key: 'x', label: 'X', kind: 'number', step: 1 },
  { key: 'y', label: 'Y', kind: 'number', step: 1 },
  { key: 'blur', label: 'Blur', kind: 'number', min: 0, max: 100, slider: true },
  { key: 'spread', label: 'Spread', kind: 'number', min: -50, max: 50, slider: true },
  { key: 'opacity', label: 'Opacity', kind: 'number', min: 0, max: 1, step: 0.01, slider: true },
];

export const EFFECT_SPECS: Record<Effect['type'], { label: string; fields: FieldSpec[]; create: () => Effect }> = {
  'drop-shadow': { label: 'Drop shadow', fields: shadowFields, create: () => ({ type: 'drop-shadow', color: 'rgba(0,0,0,0.6)', x: 0, y: 4, blur: 8, spread: 0, opacity: 1 }) },
  'inner-shadow': { label: 'Inner shadow', fields: shadowFields, create: () => ({ type: 'inner-shadow', color: 'rgba(0,0,0,0.6)', x: 0, y: 2, blur: 6, spread: 0, opacity: 1 }) },
  'outer-glow': {
    label: 'Outer glow',
    fields: [
      { key: 'color', label: 'Color', kind: 'color' },
      { key: 'radius', label: 'Radius', kind: 'number', min: 0, max: 60, slider: true },
      { key: 'blur', label: 'Blur', kind: 'number', min: 0, max: 100, slider: true },
      { key: 'opacity', label: 'Opacity', kind: 'number', min: 0, max: 1, step: 0.01, slider: true },
      { key: 'blendMode', label: 'Blend', kind: 'enum', options: BLEND },
    ],
    create: () => ({ type: 'outer-glow', color: '#ffffff', radius: 4, blur: 12, opacity: 0.9, blendMode: 'normal' }),
  },
  'rim-light': {
    label: 'Rim light',
    fields: [
      { key: 'color', label: 'Color', kind: 'color' },
      { key: 'width', label: 'Width', kind: 'number', min: 0, max: 30, slider: true },
      { key: 'blur', label: 'Blur', kind: 'number', min: 0, max: 30, slider: true },
      { key: 'angle', label: 'Angle', kind: 'number', min: 0, max: 360, slider: true, suffix: '°' },
      { key: 'opacity', label: 'Opacity', kind: 'number', min: 0, max: 1, step: 0.01, slider: true },
      { key: 'blendMode', label: 'Blend', kind: 'enum', options: BLEND },
    ],
    create: () => ({ type: 'rim-light', color: '#ffffff', width: 3, blur: 2, angle: 315, opacity: 1, blendMode: 'screen' }),
  },
  outline: {
    label: 'Outline',
    fields: [
      { key: 'color', label: 'Color', kind: 'color' },
      { key: 'width', label: 'Width', kind: 'number', min: 0, max: 40, slider: true },
      { key: 'opacity', label: 'Opacity', kind: 'number', min: 0, max: 1, step: 0.01, slider: true },
    ],
    create: () => ({ type: 'outline', color: '#000000', width: 2, opacity: 1 }),
  },
  silhouette: {
    label: 'Silhouette',
    fields: [
      { key: 'color', label: 'Color', kind: 'color' },
      { key: 'opacity', label: 'Opacity', kind: 'number', min: 0, max: 1, step: 0.01, slider: true },
    ],
    create: () => ({ type: 'silhouette', color: '#000000', opacity: 1 }),
  },
};

const v = (key: string, label: string, min: number, max: number, step = 0.01): FieldSpec => ({ key, label, kind: 'number', min, max, step, slider: true });

export const ADJUSTMENT_SPECS: Record<Adjustment['type'], { label: string; fields: FieldSpec[]; create: () => Adjustment }> = {
  brightness: { label: 'Brightness', fields: [v('value', 'Amount', 0, 3)], create: () => ({ type: 'brightness', value: 1.1 }) },
  contrast: { label: 'Contrast', fields: [v('value', 'Amount', 0, 3)], create: () => ({ type: 'contrast', value: 1.15 }) },
  saturate: { label: 'Saturation', fields: [v('value', 'Amount', 0, 3)], create: () => ({ type: 'saturate', value: 1.3 }) },
  exposure: { label: 'Exposure', fields: [v('value', 'EV', -3, 3)], create: () => ({ type: 'exposure', value: 0.3 }) },
  gamma: { label: 'Gamma', fields: [v('value', 'Gamma', 0.2, 3)], create: () => ({ type: 'gamma', value: 1.1 }) },
  'hue-rotate': { label: 'Hue', fields: [v('value', 'Degrees', -180, 180, 1)], create: () => ({ type: 'hue-rotate', value: 30 }) },
  grayscale: { label: 'Grayscale', fields: [v('value', 'Amount', 0, 1)], create: () => ({ type: 'grayscale', value: 1 }) },
  sepia: { label: 'Sepia', fields: [v('value', 'Amount', 0, 1)], create: () => ({ type: 'sepia', value: 0.6 }) },
  invert: { label: 'Invert', fields: [v('value', 'Amount', 0, 1)], create: () => ({ type: 'invert', value: 1 }) },
  temperature: { label: 'Temperature', fields: [v('value', 'Warm ↔ cool', -1, 1)], create: () => ({ type: 'temperature', value: 0.2 }) },
  tint: { label: 'Tint', fields: [{ key: 'color', label: 'Color', kind: 'color' }, v('amount', 'Amount', 0, 1)], create: () => ({ type: 'tint', color: '#ff3366', amount: 0.2 }) },
  blur: { label: 'Blur', fields: [v('radius', 'Radius', 0, 60, 0.5)], create: () => ({ type: 'blur', radius: 4 }) },
  sharpen: { label: 'Sharpen', fields: [v('amount', 'Amount', 0, 3)], create: () => ({ type: 'sharpen', amount: 0.5 }) },
  vignette: { label: 'Vignette', fields: [v('amount', 'Amount', 0, 1), v('size', 'Size', 0, 1), { key: 'color', label: 'Color', kind: 'color' }], create: () => ({ type: 'vignette', amount: 0.5, size: 0.6, color: '#000000' }) },
  bloom: { label: 'Bloom', fields: [v('threshold', 'Threshold', 0, 1), v('radius', 'Radius', 0, 60, 0.5), v('intensity', 'Intensity', 0, 3)], create: () => ({ type: 'bloom', threshold: 0.7, radius: 10, intensity: 0.8 }) },
  pixelate: { label: 'Pixelate', fields: [v('size', 'Pixel size', 1, 64, 1)], create: () => ({ type: 'pixelate', size: 8 }) },
  posterize: { label: 'Posterize', fields: [v('levels', 'Levels', 2, 32, 1)], create: () => ({ type: 'posterize', levels: 4 }) },
  palette: { label: 'Palette', fields: [{ key: 'preset', label: 'Palette', kind: 'enum', options: ['gameboy', 'gameboy-pocket', 'mono', 'sepia-4', 'cga', 'custom'] }, { key: 'colors', label: 'Custom colours', kind: 'colors' }], create: () => ({ type: 'palette', preset: 'gameboy' }) },
  duotone: { label: 'Duotone', fields: [{ key: 'shadows', label: 'Shadows', kind: 'color' }, { key: 'highlights', label: 'Highlights', kind: 'color' }], create: () => ({ type: 'duotone', shadows: '#1b0b3a', highlights: '#ffcf4a' }) },
  'chromatic-aberration': { label: 'Chromatic aberration', fields: [v('offset', 'Offset', 0, 20, 0.5)], create: () => ({ type: 'chromatic-aberration', offset: 2 }) },
  scanlines: { label: 'Scanlines', fields: [v('spacing', 'Spacing', 1, 20, 1), v('thickness', 'Thickness', 0.1, 10, 0.1), v('opacity', 'Opacity', 0, 1), { key: 'color', label: 'Color', kind: 'color' }], create: () => ({ type: 'scanlines', spacing: 3, thickness: 1, opacity: 0.35, color: '#000000' }) },
  noise: { label: 'Noise', fields: [v('amount', 'Amount', 0, 1), { key: 'seed', label: 'Seed', kind: 'number', min: 0, step: 1 }], create: () => ({ type: 'noise', amount: 0.15, seed: 1 }) },
};

function SpecFields({ fields, value, onChange }: { fields: FieldSpec[]; value: any; onChange: (patch: Record<string, unknown>, coalesce?: boolean) => void }) {
  return (
    <>
      {fields.map((f) => {
        if (f.kind === 'color')
          return (
            <Row key={f.key} label={f.label}>
              <ColorField value={value[f.key] ?? '#000000'} onChange={(c, co) => onChange({ [f.key]: c }, co)} />
            </Row>
          );
        if (f.kind === 'enum')
          return (
            <Row key={f.key} label={f.label}>
              <Select value={value[f.key]} options={f.options} onChange={(x) => onChange({ [f.key]: x })} />
            </Row>
          );
        if (f.kind === 'colors') {
          if (value.preset !== 'custom') return null;
          const colors: string[] = value.colors ?? ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'];
          return (
            <Row key={f.key} label={f.label}>
              <div className="color-list">
                {colors.map((c, i) => (
                  <ColorField key={i} value={c} onChange={(nc, co) => onChange({ colors: colors.map((x, j) => (j === i ? nc : x)) }, co)} />
                ))}
                <button type="button" className="btn small ghost" onClick={() => onChange({ colors: [...colors, '#ffffff'] })}>
                  <Icon name="plus" size={12} /> Colour
                </button>
              </div>
            </Row>
          );
        }
        const val = Number(value[f.key] ?? 0);
        return (
          <Row key={f.key} label={f.label}>
            {f.slider && f.min != null && f.max != null ? (
              <Slider value={val} min={f.min} max={f.max} step={f.step ?? 1} suffix={f.suffix} onChange={(x, co) => onChange({ [f.key]: x }, co)} />
            ) : (
              <NumberField value={val} min={f.min} max={f.max} step={f.step ?? 1} suffix={f.suffix} onChange={(x, co) => onChange({ [f.key]: x }, co)} />
            )}
          </Row>
        );
      })}
    </>
  );
}

function StackEditor<T extends { type: string }>({ items, specs, onChange, addLabel }: { items: T[]; specs: Record<string, { label: string; fields: FieldSpec[]; create: () => any }>; onChange: (next: T[], coalesce?: boolean) => void; addLabel: string }) {
  const [open, setOpen] = useState<number | null>(items.length ? items.length - 1 : null);
  return (
    <div className="list-editor">
      {items.map((it, i) => {
        const spec = specs[it.type];
        const enabled = (it as any).__disabled !== true;
        return (
          <div key={i} className={`list-item ${open === i ? 'open' : ''}`}>
            <div className="list-item-head clickable" onClick={() => setOpen(open === i ? null : i)}>
              <Icon name={open === i ? 'chevronDown' : 'chevronRight'} size={11} />
              <span className="list-title">{spec?.label ?? it.type}</span>
              <span className="spacer" />
              <IconButton icon="chevronDown" title="Move down" disabled={i === items.length - 1} onClick={(e) => (e.stopPropagation(), onChange(swap(items, i, i + 1)))} size={12} />
              <IconButton icon="trash" title="Remove" onClick={(e) => (e.stopPropagation(), onChange(items.filter((_, j) => j !== i)))} size={13} />
            </div>
            {open === i && spec && enabled ? <SpecFields fields={spec.fields} value={it} onChange={(p, co) => onChange(items.map((x, j) => (j === i ? ({ ...x, ...p } as T) : x)), co)} /> : null}
          </div>
        );
      })}
      <div className="add-row">
        <Select
          value={'' as string}
          options={[{ value: '', label: addLabel }, ...Object.entries(specs).map(([k, s]) => ({ value: k, label: s.label }))]}
          onChange={(k) => {
            if (!k) return;
            onChange([...items, specs[k].create()]);
            setOpen(items.length);
          }}
        />
      </div>
    </div>
  );
}

function swap<T>(a: T[], i: number, j: number): T[] {
  const b = [...a];
  [b[i], b[j]] = [b[j], b[i]];
  return b;
}

export function EffectsEditor({ effects, onChange }: { effects: Effect[]; onChange: (e: Effect[], coalesce?: boolean) => void }) {
  return <StackEditor items={effects} specs={EFFECT_SPECS as any} onChange={onChange} addLabel="+ Add effect…" />;
}

export function AdjustmentsEditor({ adjustments, onChange }: { adjustments: Adjustment[]; onChange: (a: Adjustment[], coalesce?: boolean) => void }) {
  return (
    <>
      <div className="presets">
        {Object.keys(GRADING_PRESETS).map((k) => (
          <button key={k} type="button" className="preset-chip" title={`Apply “${GRADING_PRESET_LABELS[k as keyof typeof GRADING_PRESET_LABELS]}” grading (replaces adjustments)`} onClick={() => onChange(structuredClone((GRADING_PRESETS as any)[k]))}>
            <span className={`preset-swatch p-${k}`} />
            {GRADING_PRESET_LABELS[k as keyof typeof GRADING_PRESET_LABELS]}
          </button>
        ))}
      </div>
      <StackEditor items={adjustments} specs={ADJUSTMENT_SPECS as any} onChange={onChange} addLabel="+ Add adjustment…" />
    </>
  );
}

export function BlendSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <Select value={value} options={BLEND} onChange={onChange} />;
}

export { Toggle };
