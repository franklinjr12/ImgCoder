/** Props Inspector (US-4.1): auto-generated from the composition JSON Schema; two-way with the canvas. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { compositionCode, describeComposition, propsToJson } from '@game-artisan/core';
import { useStudio, currentDef, currentProps, setProp, resetToDefaults, studio, toast, compState, deviation, detachCurrent, resolvedPropsOf, renameDocument } from '../../state/studio';
import { buildPropFields, defaultValueFor, type PropField } from '../../editor/prop-form';
import { collectPropUsage, renameDesignProp } from '../../editor/documents';
import { ColorField, IconButton, NumberField, Row, Section, Select, Slider, TextField, Toggle } from '../controls';
import { Icon } from '../icons';
import { fontFamilies, uploadFont } from '../../runtime/fonts';
import { addToLibrary, libraryItem, listLibrary, listProjectAssets, projectItem, librarySrc, previewUrl, type AssetItem } from '../../runtime/assets';
import { updateDoc } from '../../state/studio';

export function PropsInspector() {
  const mode = useStudio((s) => s.mode);
  useStudio((s) => [s.comp, s.compositionId, s.doc, s.sourcesVersion]);
  const s = studio.get();
  const def = currentDef(s);
  const schema = mode === 'composition' ? (def ? describeComposition(def).propsSchema : null) : (s.doc?.props?.schema ?? null);
  const fields = useMemo(() => buildPropFields(schema as any), [schema]);
  const values = currentProps(s);
  const dev = deviation(s);
  const validation = mode === 'composition' && def ? resolvedPropsOf(def, compState(def.id, s).props) : null;
  const defaults = mode === 'composition' && def ? resolvedPropsOf(def, {}).value : {};

  if (mode === 'composition' && def) {
    const info = describeComposition(def);
    const deviates = dev.props.length > 0 || dev.overrides > 0;
    return (
      <div className="inspector-scroll">
        <div className="comp-header">
          <div className="comp-title">{info.name}</div>
          <div className="comp-sub">
            <code>{info.id}</code> · {info.width}×{info.height}
            {info.preset ? ` · ${info.preset}` : ''}
          </div>
          {info.description ? <div className="comp-desc">{info.description}</div> : null}
          {deviates ? (
            <div className="deviation" data-testid="deviation">
              <Icon name="warning" size={14} />
              <span>
                Canvas deviates from template defaults
                <small>
                  {dev.props.length ? `${dev.props.length} prop${dev.props.length > 1 ? 's' : ''}: ${dev.props.slice(0, 3).join(', ')}${dev.props.length > 3 ? '…' : ''}` : ''}
                  {dev.props.length && dev.overrides ? ' · ' : ''}
                  {dev.overrides ? `${dev.overrides} layer override${dev.overrides > 1 ? 's' : ''}` : ''}
                </small>
              </span>
            </div>
          ) : (
            <div className="in-sync">
              <Icon name="sparkle" size={13} /> Matches template defaults
            </div>
          )}
          <div className="btn-row">
            <button type="button" className="btn" disabled={!deviates} onClick={resetToDefaults} title="Reset props and overrides">
              <Icon name="reset" size={13} /> Reset to defaults
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                const st = compState(def.id);
                const json = propsToJson(values, st.overrides);
                void navigator.clipboard?.writeText(json).catch(() => {});
                studio.set({ dialog: { kind: 'code', title: 'Props JSON', code: json, filename: `${def.id}.props.json`, language: 'json' } });
                toast('Props JSON copied to clipboard', 'success');
              }}
            >
              <Icon name="copy" size={13} /> Copy as Props JSON
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                const st = compState(def.id);
                const name = (def.component as any)?.name || def.id.replace(/(^|[-_.])(\w)/g, (_: string, __: string, c: string) => c.toUpperCase());
                const code = compositionCode({ id: def.id, componentName: name, schemaName: def.schema ? `${name}Schema` : undefined, width: def.width, height: def.height, props: values, overrides: st.overrides });
                void navigator.clipboard?.writeText(code).catch(() => {});
                studio.set({ dialog: { kind: 'code', title: 'Template code', code, filename: `${def.id}.composition.tsx`, language: 'tsx' } });
              }}
            >
              <Icon name="code" size={13} /> Export Template Code
            </button>
            <button type="button" className="btn" onClick={detachCurrent} title="Convert the compiled artboard into an editable design (UDM document)">
              <Icon name="design" size={13} /> Detach to design
            </button>
          </div>
        </div>
        {validation && !validation.ok ? (
          <div className="validation">
            <Icon name="warning" size={13} />
            <pre>{validation.error}</pre>
          </div>
        ) : null}
        <Section title="Props" badge={<span className="count">{fields.length}</span>}>
          {fields.map((f) => (
            <PropEditor key={f.key} field={f} path={f.key} value={values[f.key]} changed={JSON.stringify(values[f.key]) !== JSON.stringify(defaults[f.key])} />
          ))}
          {!fields.length ? <div className="empty-hint">This composition has no props schema.</div> : null}
        </Section>
      </div>
    );
  }

  if (mode === 'design' && s.doc) {
    const usage = collectPropUsage(s.doc);
    return (
      <div className="inspector-scroll">
        <div className="comp-header">
          <div className="comp-title">
            <TextField value={s.doc.name} onChange={(v) => renameDocument(v)} live={false} />
          </div>
          <div className="comp-desc">
            Design props make this document renderable by agents & the CLI (<code>{'{ "$prop": name }'}</code> bindings). Expose any layer field with the <Icon name="link" size={11} /> button in the Layer tab.
          </div>
        </div>
        <Section title="Design props" badge={<span className="count">{fields.length}</span>}>
          {fields.map((f) => (
            <div key={f.key} className="design-prop">
              <PropEditor field={f} path={f.key} value={values[f.key]} />
              <div className="prop-usage">
                {(usage.get(f.key) ?? []).map((u, i) => (
                  <span key={i} className="tag-chip" title={`${u.layerId} · ${u.path}`}>
                    {u.path}
                  </span>
                ))}
                <IconButton
                  icon="design"
                  title="Rename prop"
                  size={12}
                  onClick={() => {
                    const n = prompt('Rename prop', f.key);
                    if (n && /^[a-zA-Z_][\w]*$/.test(n)) updateDoc((d) => renameDesignProp(d, f.key, n), 'Rename prop');
                  }}
                />
              </div>
            </div>
          ))}
          {!fields.length ? <div className="empty-hint">No props yet. Select a layer and click the link icon next to a field to expose it as a prop.</div> : null}
        </Section>
      </div>
    );
  }
  return <div className="empty-hint">Open a composition to edit its props.</div>;
}

function PropEditor({ field, path, value, changed }: { field: PropField; path: string; value: unknown; changed?: boolean }) {
  const set = (v: unknown, coalesce?: boolean) => setProp(path, v, coalesce === false ? undefined : `prop:${path}`);
  const label = (
    <span className={`prop-label ${changed ? 'changed' : ''}`} title={`${field.description ?? ''}${field.description ? '\n' : ''}${path}${field.required ? ' (required)' : ''}`}>
      {field.label}
      {changed ? <span className="dot warn" /> : null}
    </span>
  );
  switch (field.kind) {
    case 'text':
      return (
        <Row label={label}>
          <TextField value={(value as string) ?? ''} onChange={(v) => set(v)} placeholder={field.nullable ? '(empty)' : undefined} />
        </Row>
      );
    case 'textarea':
      return (
        <Row label={label} wide>
          <TextField value={(value as string) ?? ''} multiline onChange={(v) => set(v)} />
        </Row>
      );
    case 'number':
      return (
        <Row label={label}>
          <NumberField value={(value as number) ?? 0} min={field.min} max={field.max} step={field.step} onChange={(v) => set(field.integer ? Math.round(v) : v)} />
        </Row>
      );
    case 'slider':
      return (
        <Row label={label}>
          <Slider value={(value as number) ?? field.min ?? 0} min={field.min ?? 0} max={field.max ?? 100} step={field.step} onChange={(v) => set(field.integer ? Math.round(v) : v)} />
        </Row>
      );
    case 'boolean':
      return (
        <Row label={label}>
          <Toggle value={!!value} onChange={(v) => set(v, false)} />
        </Row>
      );
    case 'enum':
      return (
        <Row label={label}>
          <Select value={value as any} options={field.options!.map((o) => ({ value: o.value as any, label: o.label }))} onChange={(v) => set(v, false)} />
        </Row>
      );
    case 'color':
      return (
        <Row label={label}>
          <ColorField value={(value as string) ?? '#000000'} onChange={(v) => set(v)} />
        </Row>
      );
    case 'image':
    case 'svg':
      return (
        <Row label={label} wide>
          <AssetPicker value={(value as string) ?? ''} onChange={(v) => set(v, false)} svg={field.kind === 'svg'} />
        </Row>
      );
    case 'font':
      return (
        <Row label={label}>
          <FontPicker value={(value as string) ?? 'Inter'} onChange={(v) => set(v, false)} />
        </Row>
      );
    case 'object':
      return (
        <div className="nested">
          <div className="nested-title">{label}</div>
          {(field.fields ?? []).map((f) => (
            <PropEditor key={f.key} field={f} path={`${path}.${f.key}`} value={(value as any)?.[f.key]} />
          ))}
        </div>
      );
    case 'array': {
      const arr = Array.isArray(value) ? value : [];
      return (
        <div className="nested">
          <div className="nested-title">
            {label} <span className="count">{arr.length}</span>
          </div>
          {arr.map((item, i) => (
            <div key={i} className="array-item">
              <div className="array-item-body">
                <PropEditor field={{ ...field.item!, label: `#${i + 1}` }} path={`${path}.${i}`} value={item} />
              </div>
              <IconButton icon="minus" title="Remove item" onClick={() => set(arr.filter((_, j) => j !== i), false)} />
            </div>
          ))}
          <button type="button" className="btn small ghost" disabled={field.max != null && arr.length >= field.max} onClick={() => set([...arr, defaultValueFor(field.item!)], false)}>
            <Icon name="plus" size={12} /> Add item
          </button>
        </div>
      );
    }
    case 'locale-map':
    case 'record': {
      const obj = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
      return (
        <div className="nested">
          <div className="nested-title">
            {label} {field.kind === 'locale-map' ? <Icon name="globe" size={12} /> : null}
          </div>
          {Object.entries(obj).map(([k, v]) => (
            <div key={k} className="array-item">
              <span className="locale-key">{k}</span>
              <div className="array-item-body">
                <PropEditor field={{ ...field.item!, label: '' }} path={`${path}.${k}`} value={v} />
              </div>
              <IconButton
                icon="minus"
                title="Remove entry"
                onClick={() => {
                  const n = { ...obj };
                  delete n[k];
                  set(n, false);
                }}
              />
            </div>
          ))}
          <AddKey
            placeholder={field.kind === 'locale-map' ? 'Add locale (e.g. ja, zh-CN)' : 'Add key'}
            onAdd={(k) => set({ ...obj, [k]: defaultValueFor(field.item!) }, false)}
          />
        </div>
      );
    }
    default:
      return (
        <Row label={label} wide>
          <JsonField value={value} onChange={(v) => set(v, false)} />
        </Row>
      );
  }
}

function AddKey({ onAdd, placeholder }: { onAdd: (k: string) => void; placeholder: string }) {
  const [k, setK] = useState('');
  return (
    <div className="add-key">
      <input value={k} placeholder={placeholder} onChange={(e) => setK(e.target.value)} onKeyDown={(e) => (e.stopPropagation(), e.key === 'Enter' && k && (onAdd(k), setK('')))} />
      <IconButton icon="plus" title="Add" disabled={!k} onClick={() => (onAdd(k), setK(''))} />
    </div>
  );
}

function JsonField({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const [text, setText] = useState(JSON.stringify(value ?? null, null, 2));
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setText(JSON.stringify(value ?? null, null, 2)), [value]);
  return (
    <div className="json-field">
      <textarea
        className="mono"
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
        onBlur={() => {
          try {
            onChange(JSON.parse(text));
            setErr(null);
          } catch (e) {
            setErr((e as Error).message);
          }
        }}
      />
      {err ? <div className="row-hint error">{err}</div> : null}
    </div>
  );
}

export function FontPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const fv = useStudio((s) => s.fontsVersion);
  const families = useMemo(() => fontFamilies(), [fv]);
  const ref = useRef<HTMLInputElement>(null);
  const first = value.split(',')[0].trim().replace(/['"]/g, '');
  return (
    <div className="font-picker">
      <Select value={families.includes(first) ? first : value} options={[...(families.includes(first) ? [] : [{ value, label: value }]), ...families.map((f) => ({ value: f, label: f }))]} onChange={onChange} />
      <IconButton icon="upload" title="Upload font (.ttf .otf .woff .woff2)" onClick={() => ref.current?.click()} />
      <input
        ref={ref}
        type="file"
        accept=".ttf,.otf,.woff,.woff2,.ttc"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            const fams = await uploadFont(f);
            toast(`Font registered: ${fams.join(', ')}`, 'success');
            if (fams[0]) onChange(fams[0]);
          } catch (err) {
            toast(`Font upload failed: ${(err as Error).message}`, 'error');
          }
        }}
      />
    </div>
  );
}

export function AssetPicker({ value, onChange, svg }: { value: string; onChange: (v: string) => void; svg?: boolean }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AssetItem[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const version = useStudio((s) => s.assetsVersion);
  useEffect(() => {
    if (!open) return;
    void (async () => {
      const [lib, prj] = await Promise.all([listLibrary(), listProjectAssets()]);
      setItems([...prj.map(projectItem), ...lib.map(libraryItem)].filter((i) => !svg || i.mime === 'image/svg+xml'));
    })();
  }, [open, version, svg]);
  const preview = previewUrl(value);
  return (
    <div className="asset-picker">
      <div className="asset-picker-row">
        <div className="asset-preview" onClick={() => setOpen(!open)}>
          {preview ? <img src={preview} alt="" onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} /> : <Icon name="image" size={16} />}
        </div>
        <TextField value={value.startsWith('data:') ? `(embedded ${value.slice(5, value.indexOf(';'))})` : value} onChange={(v) => !v.startsWith('(embedded') && onChange(v)} live={false} placeholder="path, URL or data URI" />
        <IconButton icon="assets" title="Choose from asset library" active={open} onClick={() => setOpen(!open)} />
      </div>
      {open ? (
        <div className="asset-popover">
          <div className="asset-popover-grid">
            {items.map((it) => (
              <button
                key={it.key}
                type="button"
                className="asset-mini"
                title={it.name}
                onClick={async () => {
                  onChange(it.source === 'library' ? await librarySrc(it.key.slice(4)) : it.src);
                  setOpen(false);
                }}
              >
                <img src={it.thumb} alt="" />
              </button>
            ))}
            <button type="button" className="asset-mini upload" title="Upload" onClick={() => fileRef.current?.click()}>
              <Icon name="upload" size={16} />
            </button>
          </div>
          {!items.length ? <div className="empty-hint small">Library is empty — upload an image.</div> : null}
          <input
            ref={fileRef}
            type="file"
            accept={svg ? '.svg,image/svg+xml' : 'image/*'}
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              const a = await addToLibrary(f);
              studio.set((s) => ({ assetsVersion: s.assetsVersion + 1 }));
              onChange(await librarySrc(a.id));
              setOpen(false);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
