import { useMemo, useState } from 'react';
import { useStudio, studio, newDesignFromSize, addArtboardToDoc, download, toast } from '../state/studio';
import type { StorePresetLike } from '../editor/documents';
import { Icon } from './icons';
import { IconButton, NumberField, TextField, mod } from './controls';

const PLATFORM_LABEL: Record<string, string> = { steam: 'Steam', itch: 'Itch.io', epic: 'Epic Games Store', gog: 'GOG', playstation: 'PlayStation', switch: 'Nintendo Switch', social: 'Social media' };

export function Dialogs() {
  const dialog = useStudio((s) => s.dialog);
  if (!dialog) return null;
  const close = () => studio.set({ dialog: null });
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className={`modal ${dialog.kind}`} role="dialog" onKeyDown={(e) => (e.key === 'Escape' ? close() : e.stopPropagation())}>
        {dialog.kind === 'new-design' || dialog.kind === 'add-artboard' ? <PresetDialog mode={dialog.kind} onClose={close} /> : null}
        {dialog.kind === 'code' ? <CodeDialog title={dialog.title} code={dialog.code} filename={dialog.filename} onClose={close} /> : null}
        {dialog.kind === 'shortcuts' ? <ShortcutsDialog onClose={close} /> : null}
      </div>
    </div>
  );
}

function PresetDialog({ mode, onClose }: { mode: 'new-design' | 'add-artboard'; onClose: () => void }) {
  const presets = useStudio((s) => s.sources?.presets ?? {});
  const [name, setName] = useState('');
  const [w, setW] = useState(1200);
  const [h, setH] = useState(675);
  const groups = useMemo(() => {
    const m = new Map<string, StorePresetLike[]>();
    for (const p of Object.values(presets)) {
      const k = p.platform ?? 'other';
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(p);
    }
    return [...m.entries()];
  }, [presets]);
  const create = (width: number, height: number, preset?: StorePresetLike) => {
    if (mode === 'new-design') newDesignFromSize(width, height, name || preset?.name || `Design ${width}×${height}`, preset);
    else addArtboardToDoc(width, height, preset);
    onClose();
  };
  return (
    <>
      <div className="modal-head">
        <h2>{mode === 'new-design' ? 'New design' : 'Add artboard'}</h2>
        <IconButton icon="x" title="Close" onClick={onClose} />
      </div>
      <div className="modal-body">
        {mode === 'new-design' ? (
          <div className="field-inline">
            <label>Name</label>
            <TextField value={name} onChange={setName} placeholder="Untitled design" />
          </div>
        ) : null}
        {groups.map(([platform, list]) => (
          <div key={platform} className="preset-group">
            <h3>{PLATFORM_LABEL[platform] ?? platform}</h3>
            <div className="preset-grid">
              {list.map((p) => {
                const s = Math.min(64 / p.width, 44 / p.height);
                return (
                  <button key={p.id} type="button" className="preset-card" onClick={() => create(p.width, p.height, p)} title={p.notes} data-preset={p.id}>
                    <span className="preset-shape-wrap">
                      <span className="preset-shape" style={{ width: Math.max(6, p.width * s), height: Math.max(6, p.height * s) }} />
                    </span>
                    <span className="preset-name">{p.name}</span>
                    <span className="preset-size">
                      {p.width} × {p.height}
                      {p.safeZoneMargins ? ' · safe zones' : ''}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <div className="preset-group">
          <h3>Custom size</h3>
          <div className="custom-size">
            <NumberField label="W" value={w} min={1} max={16384} precision={0} onChange={(v) => setW(Math.round(v))} />
            <span>×</span>
            <NumberField label="H" value={h} min={1} max={16384} precision={0} onChange={(v) => setH(Math.round(v))} />
            <button type="button" className="btn primary" onClick={() => create(w, h)}>
              Create
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function CodeDialog({ title, code, filename, onClose }: { title: string; code: string; filename?: string; onClose: () => void }) {
  return (
    <>
      <div className="modal-head">
        <h2>{title}</h2>
        <IconButton icon="x" title="Close" onClick={onClose} />
      </div>
      <div className="modal-body">
        <pre className="code" data-testid="code-output">
          {code}
        </pre>
      </div>
      <div className="modal-foot">
        <button
          type="button"
          className="btn"
          onClick={() => {
            void navigator.clipboard?.writeText(code).then(
              () => toast('Copied to clipboard', 'success'),
              () => toast('Clipboard unavailable — select and copy manually', 'warning'),
            );
          }}
        >
          <Icon name="copy" size={13} /> Copy
        </button>
        {filename ? (
          <button type="button" className="btn primary" onClick={() => download(filename, code, 'text/plain')}>
            <Icon name="download" size={13} /> Download {filename}
          </button>
        ) : null}
      </div>
    </>
  );
}

const SHORTCUTS: [string, string][] = [
  ['V / H', 'Select / hand tool'],
  ['Space + drag, middle mouse, wheel', 'Pan'],
  [`${mod}wheel, + / −`, 'Zoom (10%–3200%)'],
  ['Shift+1 / Shift+0 / Shift+2', 'Zoom to fit / 100% / selection'],
  ['T, R, O, L', 'Insert text / rectangle / ellipse / line'],
  ['Shift + drag handle', 'Keep aspect ratio'],
  ['Alt + drag handle', 'Resize from centre'],
  ['Shift + rotate', '15° steps'],
  [`${mod}drag side handle`, 'Skew'],
  ['Arrows / Shift+arrows', 'Nudge 1px / 10px'],
  [`${mod}click`, 'Deep select inside groups'],
  ['Double-click', 'Edit text / enter group'],
  [`${mod}G / ${mod}⇧G`, 'Group / ungroup'],
  [`${mod}⌥G`, 'Toggle clipping mask'],
  [`${mod}D`, 'Duplicate'],
  [`${mod}C / ${mod}X / ${mod}V`, 'Copy / cut / paste'],
  [`${mod}Z / ${mod}⇧Z`, 'Undo / redo'],
  [`${mod}] / ${mod}[`, 'Bring forward / send backward'],
  ['Delete', 'Delete (hide on code templates)'],
  [`${mod}A / Esc`, 'Select all / deselect, exit group'],
  [`${mod}S`, 'Save design (download / project)'],
  ["'", 'Toggle pixel grid'],
];

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <>
      <div className="modal-head">
        <h2>Keyboard shortcuts</h2>
        <IconButton icon="x" title="Close" onClick={onClose} />
      </div>
      <div className="modal-body shortcuts">
        {SHORTCUTS.map(([k, d]) => (
          <div key={k} className="shortcut">
            <kbd>{k}</kbd>
            <span>{d}</span>
          </div>
        ))}
      </div>
    </>
  );
}

export function Toasts() {
  const toasts = useStudio((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <Icon name={t.kind === 'error' || t.kind === 'warning' ? 'warning' : t.kind === 'success' ? 'sparkle' : 'sparkle'} size={14} />
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}

export { download };
