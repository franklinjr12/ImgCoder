import { useRef } from 'react';
import { describeComposition, documentToTemplateCode, serializeDocument } from '@game-artisan/core';
import {
  useStudio,
  studio,
  undo,
  redo,
  historyState,
  zoomStep,
  zoomToFit,
  zoomTo,
  setOverlay,
  insertLayer,
  toast,
  exportSvg,
  artboardToPng,
  download,
  exportBaseName,
  currentDef,
  saveToProject,
  detachCurrent,
  compState,
  currentProps,
} from '../state/studio';
import { createImageLayer, createPrimitive, PRIMITIVE_LABELS, type PrimitiveKind } from '../editor/primitives';
import { documentFileName } from '../editor/documents';
import { fileToImage, addToLibrary } from '../runtime/assets';
import { Icon } from './icons';
import { IconButton, Menu, MenuItem, mod } from './controls';
import { propsToJson, compositionCode } from '@game-artisan/core';

const INSERT: { kind: PrimitiveKind; icon: string; key?: string }[] = [
  { kind: 'text', icon: 'text', key: 'T' },
  { kind: 'rect', icon: 'rect', key: 'R' },
  { kind: 'ellipse', icon: 'ellipse', key: 'O' },
  { kind: 'polygon', icon: 'polygon' },
  { kind: 'star', icon: 'star' },
  { kind: 'line', icon: 'line', key: 'L' },
  { kind: 'path', icon: 'path' },
];
const INSERT_MORE: { kind: PrimitiveKind; icon: string }[] = [
  { kind: 'heading', icon: 'text' },
  { kind: 'gradient', icon: 'gradient' },
  { kind: 'halftone', icon: 'halftone' },
  { kind: 'scanlines', icon: 'scanlines' },
  { kind: 'pattern', icon: 'pattern' },
  { kind: 'group', icon: 'frame' },
];

export function insertPrimitive(kind: PrimitiveKind) {
  const s = studio.get();
  if (!s.live) return;
  if (s.mode !== 'design') {
    toast('Code templates are edited via props & overrides — “Detach to design” to add layers', 'warning', 4200);
    return;
  }
  insertLayer(createPrimitive(kind, { artboardWidth: s.live.width, artboardHeight: s.live.height }));
}

export function TopBar() {
  const mode = useStudio((s) => s.mode);
  const tool = useStudio((s) => s.tool);
  const zoom = useStudio((s) => s.view.zoom);
  const overlays = useStudio((s) => s.overlays);
  const docName = useStudio((s) => s.doc?.name);
  const docDirty = useStudio((s) => s.docDirty);
  const docSource = useStudio((s) => s.docSource);
  useStudio((s) => s.historyVersion);
  useStudio((s) => s.compositionId);
  const hasProjectDocs = useStudio((s) => !!s.sources?.info.documentsDir);
  const def = currentDef();
  const hist = historyState();
  const imgRef = useRef<HTMLInputElement>(null);
  const title = mode === 'composition' && def ? describeComposition(def).name : (docName ?? '');

  const exportPng = async (scale: number) => {
    const ab = studio.get().live;
    if (!ab) return;
    try {
      const png = await artboardToPng(ab, scale);
      download(`${exportBaseName()}${scale !== 1 ? `@${scale}x` : ''}.png`, png);
    } catch (e) {
      toast(`PNG export failed: ${(e as Error).message}`, 'error');
    }
  };

  return (
    <header className="topbar">
      <div className="brand">
        <div className="logo">
          <svg viewBox="0 0 24 24" width="20" height="20">
            <defs>
              <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#7c9cff" />
                <stop offset="1" stopColor="#c86bff" />
              </linearGradient>
            </defs>
            <path d="M12 2l9 5v10l-9 5-9-5V7z" fill="url(#lg)" />
            <path d="M8 15l4-7 4 7M9.5 12.5h5" stroke="#0d0f16" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="doc-title">
          <span className={`mode-pill ${mode ?? ''}`}>{mode === 'composition' ? 'Code template' : mode === 'design' ? (docSource.kind === 'project' ? 'Project design' : 'Design') : ''}</span>
          <span className="title-text" title={title}>
            {title}
          </span>
          {mode === 'design' && docDirty ? <span className="dot" title="Unsaved changes" /> : null}
        </div>
      </div>

      <div className="tools">
        <IconButton icon="select" title="Select (V)" active={tool === 'select'} onClick={() => studio.set({ tool: 'select' })} />
        <IconButton icon="hand" title="Hand — pan (H, or hold Space)" active={tool === 'hand'} onClick={() => studio.set({ tool: 'hand' })} />
        <span className="sep" />
        {INSERT.map((i) => (
          <IconButton key={i.kind} icon={i.icon} title={`${PRIMITIVE_LABELS[i.kind]}${i.key ? ` (${i.key})` : ''}`} disabled={mode !== 'design'} onClick={() => insertPrimitive(i.kind)} />
        ))}
        <IconButton icon="image" title="Image (upload)" disabled={mode !== 'design'} onClick={() => imgRef.current?.click()} />
        <input
          ref={imgRef}
          type="file"
          accept="image/*,.svg"
          hidden
          multiple
          onChange={async (e) => {
            const s = studio.get();
            for (const f of [...(e.target.files ?? [])]) {
              const img = await fileToImage(f);
              void addToLibrary(f).then(() => studio.set((st) => ({ assetsVersion: st.assetsVersion + 1 })));
              if (s.live) insertLayer(createImageLayer({ ...img, artboardWidth: s.live.width, artboardHeight: s.live.height }));
            }
            e.target.value = '';
          }}
        />
        <Menu
          trigger={(open) => (
            <button type="button" className={`icon-btn ${open ? 'active' : ''}`} title="More elements" disabled={mode !== 'design'}>
              <Icon name="plus" size={16} />
              <Icon name="chevronDown" size={10} />
            </button>
          )}
        >
          {(close) =>
            INSERT_MORE.map((i) => (
              <MenuItem
                key={i.kind}
                icon={i.icon}
                label={PRIMITIVE_LABELS[i.kind]}
                onClick={() => {
                  insertPrimitive(i.kind);
                  close();
                }}
              />
            ))
          }
        </Menu>
        {mode === 'composition' ? (
          <button type="button" className="btn small accent-ghost" onClick={detachCurrent} title="Convert into an editable design to add/remove layers">
            <Icon name="design" size={13} /> Detach to design
          </button>
        ) : null}
      </div>

      <div className="right-tools">
        <IconButton icon="undo" title={`Undo (${mod}Z)`} disabled={!hist.canUndo} onClick={undo} />
        <IconButton icon="redo" title={`Redo (${mod}⇧Z)`} disabled={!hist.canRedo} onClick={redo} />
        <span className="sep" />
        <IconButton icon="safe" title="Safe zones" active={overlays.safeZones} onClick={() => setOverlay('safeZones', !overlays.safeZones)} />
        <IconButton icon="steam" title="Steam UI simulation overlay" active={overlays.steamUi} onClick={() => setOverlay('steamUi', !overlays.steamUi)} />
        <IconButton icon="grid" title="Pixel grid (visible ≥ 800%)" active={overlays.pixelGrid} onClick={() => setOverlay('pixelGrid', !overlays.pixelGrid)} />
        <IconButton icon="ruler" title="Rulers & guides" active={overlays.rulers} onClick={() => setOverlay('rulers', !overlays.rulers)} />
        <IconButton icon="magnet" title="Snapping" active={overlays.snapping} onClick={() => setOverlay('snapping', !overlays.snapping)} />
        <span className="sep" />
        <div className="zoom">
          <IconButton icon="minus" title="Zoom out (-)" onClick={() => zoomStep(-1)} />
          <Menu
            align="right"
            trigger={() => (
              <button type="button" className="zoom-value" data-testid="zoom">
                {Math.round(zoom * 100)}%
              </button>
            )}
          >
            {(close) => (
              <>
                <MenuItem icon="fit" label="Zoom to fit" shortcut="⇧1" onClick={() => (zoomToFit(), close())} />
                {[0.25, 0.5, 1, 2, 4, 8, 16, 32].map((z) => (
                  <MenuItem key={z} label={`${z * 100}%`} shortcut={z === 1 ? '⇧0' : undefined} onClick={() => (zoomTo(z), close())} />
                ))}
              </>
            )}
          </Menu>
          <IconButton icon="plus" title="Zoom in (+)" onClick={() => zoomStep(1)} />
          <IconButton icon="fit" title="Zoom to fit (Shift+1)" onClick={zoomToFit} />
        </div>
        <Menu
          align="right"
          trigger={(open) => (
            <button type="button" className={`btn primary ${open ? 'pressed' : ''}`} data-testid="export-menu">
              <Icon name="download" size={14} /> Export
            </button>
          )}
        >
          {(close) => (
            <>
              <MenuItem icon="image" label="PNG" onClick={() => (void exportPng(1), close())} />
              <MenuItem icon="image" label="PNG @2x" onClick={() => (void exportPng(2), close())} />
              <MenuItem
                icon="svg"
                label="SVG (standalone)"
                onClick={async () => {
                  close();
                  download(`${exportBaseName()}.svg`, await exportSvg(), 'image/svg+xml');
                }}
              />
              <div className="menu-sep" />
              {mode === 'composition' && def ? (
                <>
                  <MenuItem
                    icon="copy"
                    label="Props JSON"
                    onClick={() => {
                      close();
                      const json = propsToJson(currentProps(), compState(def.id).overrides);
                      studio.set({ dialog: { kind: 'code', title: 'Props JSON (artisan render --props)', code: json, filename: `${def.id}.props.json`, language: 'json' } });
                    }}
                  />
                  <MenuItem
                    icon="code"
                    label="Template code (TSX)"
                    onClick={() => {
                      close();
                      const name = (def.component as any)?.name || 'Template';
                      studio.set({ dialog: { kind: 'code', title: 'Template code', code: compositionCode({ id: def.id, componentName: name, width: def.width, height: def.height, props: currentProps(), overrides: compState(def.id).overrides }), filename: `${def.id}.tsx`, language: 'tsx' } });
                    }}
                  />
                </>
              ) : null}
              {mode === 'design' ? (
                <>
                  <MenuItem
                    icon="file"
                    label="Download .artisan.json"
                    shortcut={`${mod}S`}
                    onClick={() => {
                      close();
                      const doc = studio.get().doc!;
                      download(documentFileName(doc), serializeDocument(doc), 'application/json');
                    }}
                  />
                  <MenuItem
                    icon="code"
                    label="Export as TypeScript template"
                    onClick={() => {
                      close();
                      const doc = studio.get().doc!;
                      studio.set({ dialog: { kind: 'code', title: 'TypeScript template (compositionFromDocument)', code: documentToTemplateCode(doc), filename: documentFileName(doc).replace('.artisan.json', '.template.ts'), language: 'ts' } });
                    }}
                  />
                  {hasProjectDocs ? <MenuItem icon="save" label="Save to project" onClick={() => (void saveToProject(), close())} /> : null}
                </>
              ) : null}
            </>
          )}
        </Menu>
        <IconButton icon="keyboard" title="Keyboard shortcuts (?)" onClick={() => studio.set({ dialog: { kind: 'shortcuts' } })} />
      </div>
    </header>
  );
}
