/** Right panel: Props / Layer / Document tabs. */
import { useStudio, studio, currentArtboardRaw, updateDoc, selectArtboard, deleteArtboard, setGuides, guides as currentGuides, currentDef, setOverlay, setLocale } from '../../state/studio';
import { PropsInspector } from './PropsInspector';
import { LayerInspector } from './LayerInspector';
import { FillEditor } from './paint';
import { IconButton, NumberField, Row, Section, TextField, Toggle } from '../controls';
import { Icon } from '../icons';
import { replaceArtboard } from '../../editor/documents';
import { describeComposition } from '@game-artisan/core';

export function Inspector() {
  const tab = useStudio((s) => s.rightTab);
  const mode = useStudio((s) => s.mode);
  const nSel = useStudio((s) => s.selection.length);
  const propsCount = useStudio((s) => {
    if (s.mode === 'design') return Object.keys((s.doc?.props?.schema as any)?.properties ?? {}).length;
    const def = currentDef(s);
    return def ? Object.keys((describeComposition(def).propsSchema as any).properties ?? {}).length : 0;
  });
  const tabs: { k: 'props' | 'layer' | 'document'; label: string; badge?: number }[] =
    mode === 'design'
      ? [
          { k: 'layer', label: 'Layer', badge: nSel || undefined },
          { k: 'props', label: 'Props', badge: propsCount || undefined },
          { k: 'document', label: 'Document' },
        ]
      : [
          { k: 'props', label: 'Props', badge: propsCount || undefined },
          { k: 'layer', label: 'Layer', badge: nSel || undefined },
          { k: 'document', label: 'Artboard' },
        ];
  return (
    <div className="inspector">
      <div className="tabs">
        {tabs.map((t) => (
          <button key={t.k} type="button" className={tab === t.k ? 'active' : ''} data-tab={t.k} onClick={() => studio.set({ rightTab: t.k })}>
            {t.label}
            {t.badge ? <span className="count">{t.badge}</span> : null}
          </button>
        ))}
      </div>
      <div className="tab-body">{tab === 'props' ? <PropsInspector /> : tab === 'layer' ? <LayerInspector /> : <DocumentInspector />}</div>
    </div>
  );
}

function DocumentInspector() {
  const mode = useStudio((s) => s.mode);
  const doc = useStudio((s) => s.doc);
  const live = useStudio((s) => s.live);
  const artboardId = useStudio((s) => s.artboardId);
  const overlays = useStudio((s) => s.overlays);
  const locale = useStudio((s) => s.locale);
  useStudio((s) => s.comp);
  const ab = mode === 'design' ? currentArtboardRaw() : live;
  if (!ab) return null;
  const editable = mode === 'design' && !!doc;
  const setAb = (patch: Record<string, unknown>, label = 'Edit artboard') => updateDoc((d) => replaceArtboard(d, { ...currentArtboardRaw()!, ...patch } as any), label);
  const gl = currentGuides();
  const zones = ab.safeZones ?? [];
  return (
    <div className="inspector-scroll">
      {editable ? (
        <Section title="Artboards" badge={<span className="count">{doc!.artboards.length}</span>}>
          <div className="artboard-list">
            {doc!.artboards.map((a) => (
              <div key={a.id} className={`artboard-item ${a.id === artboardId ? 'active' : ''}`} onClick={() => selectArtboard(a.id)}>
                <Icon name="artboard" size={14} />
                <span className="artboard-name">{a.name ?? a.id}</span>
                <span className="artboard-size">
                  {a.width}×{a.height}
                </span>
                {doc!.artboards.length > 1 ? <IconButton icon="trash" title="Delete artboard" size={12} onClick={(e) => (e.stopPropagation(), deleteArtboard(a.id))} /> : null}
              </div>
            ))}
          </div>
          <button type="button" className="btn small ghost" onClick={() => studio.set({ dialog: { kind: 'add-artboard' } })}>
            <Icon name="plus" size={12} /> Add artboard (store preset or custom)
          </button>
        </Section>
      ) : null}
      <Section title="Artboard">
        {editable ? (
          <Row label="Name">
            <TextField value={ab.name ?? ''} onChange={(v) => setAb({ name: v }, 'Rename artboard')} live={false} />
          </Row>
        ) : null}
        <div className="grid2">
          <NumberField label="W" value={ab.width} min={1} max={16384} step={1} precision={0} disabled={!editable} onChange={(v) => setAb({ width: Math.max(1, Math.round(v)) }, 'Resize artboard')} />
          <NumberField label="H" value={ab.height} min={1} max={16384} step={1} precision={0} disabled={!editable} onChange={(v) => setAb({ height: Math.max(1, Math.round(v)) }, 'Resize artboard')} />
        </div>
        {ab.preset ? (
          <Row label="Preset">
            <code className="pill">{ab.preset}</code>
          </Row>
        ) : null}
        {editable ? (
          <>
            <Row label="Background" wide>
              <FillEditor fill={ab.background ?? { type: 'none' }} onChange={(f, co) => updateDoc((d) => replaceArtboard(d, { ...currentArtboardRaw()!, background: f && f.type !== 'none' ? f : undefined }), 'Background', co ? 'artboard-bg' : undefined)} />
            </Row>
          </>
        ) : null}
        <Row label="Preview locale">
          <TextField value={locale} placeholder="e.g. ja, zh-CN (blank = default)" onChange={(v) => setLocale(v.trim())} live={false} />
        </Row>
      </Section>
      <Section title="Overlays">
        <Row label="Safe zones">
          <Toggle value={overlays.safeZones} onChange={(v) => setOverlay('safeZones', v)} />
        </Row>
        <Row label="Steam UI simulation">
          <Toggle value={overlays.steamUi} onChange={(v) => setOverlay('steamUi', v)} />
        </Row>
        <Row label="Guides">
          <Toggle value={overlays.guides} onChange={(v) => setOverlay('guides', v)} />
        </Row>
        <Row label="Pixel grid (≥800%)">
          <Toggle value={overlays.pixelGrid} onChange={(v) => setOverlay('pixelGrid', v)} />
        </Row>
        <Row label="Layer outlines">
          <Toggle value={overlays.outlines} onChange={(v) => setOverlay('outlines', v)} />
        </Row>
        <Row label="Rulers">
          <Toggle value={overlays.rulers} onChange={(v) => setOverlay('rulers', v)} />
        </Row>
        <Row label="Snap to objects & guides">
          <Toggle value={overlays.snapping} onChange={(v) => setOverlay('snapping', v)} />
        </Row>
        <Row label="Snap to pixel grid">
          <Toggle value={overlays.pixelSnap} onChange={(v) => setOverlay('pixelSnap', v)} />
        </Row>
      </Section>
      <Section title="Safe zones" badge={<span className="count">{zones.length}</span>} defaultOpen={zones.length > 0}>
        {zones.map((z) => (
          <div key={z.id} className={`zone-row zone-${z.kind}`}>
            <span className="zone-kind">{z.kind}</span>
            <span className="zone-label">{z.label ?? z.id}</span>
            <span className="zone-rect">
              {Math.round(z.x)},{Math.round(z.y)} · {Math.round(z.width)}×{Math.round(z.height)}
            </span>
            {editable ? <IconButton icon="trash" title="Remove" size={12} onClick={() => setAb({ safeZones: zones.filter((x) => x.id !== z.id) }, 'Remove safe zone')} /> : null}
          </div>
        ))}
        {editable ? (
          <button
            type="button"
            className="btn small ghost"
            onClick={() => {
              const m = Math.round(Math.min(ab.width, ab.height) * 0.06);
              setAb({ safeZones: [...zones, { id: `zone-${Date.now().toString(36)}`, label: 'Safe area', kind: 'safe', x: m, y: m, width: ab.width - 2 * m, height: ab.height - 2 * m }] }, 'Add safe zone');
            }}
          >
            <Icon name="plus" size={12} /> Add safe zone
          </button>
        ) : null}
        {!zones.length && !editable ? <div className="empty-hint small">The template declares no safe zones.</div> : null}
      </Section>
      <Section title="Guides" badge={<span className="count">{gl.length}</span>} defaultOpen={false}>
        <div className="empty-hint small">Drag from the rulers to add guides; drag a guide back onto a ruler to remove it.</div>
        {gl.map((g, i) => (
          <div key={i} className="guide-row">
            <span>{g.axis === 'x' ? 'Vertical' : 'Horizontal'}</span>
            <NumberField value={g.position} onChange={(v) => setGuides(gl.map((x, j) => (j === i ? { ...x, position: v } : x)), 'Move guide')} />
            <IconButton icon="trash" title="Remove guide" size={12} onClick={() => setGuides(gl.filter((_, j) => j !== i), 'Remove guide')} />
          </div>
        ))}
        {gl.length ? (
          <button type="button" className="btn small ghost" onClick={() => setGuides([], 'Clear guides')}>
            Clear guides
          </button>
        ) : null}
      </Section>
    </div>
  );
}
