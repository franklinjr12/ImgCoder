import { useEffect, useRef, useState } from 'react';
import { serializeDocument, computeWorldMatrices } from '@game-artisan/core';
import {
  useStudio,
  studio,
  undo,
  redo,
  deleteSelection,
  duplicateSelection,
  groupSelection,
  ungroupSelection,
  toggleClippingMask,
  copySelection,
  paste,
  selectAll,
  setSelection,
  zoomStep,
  zoomToFit,
  zoomTo,
  zoomToSelection,
  reorderSelection,
  editLayers,
  findLayerIn,
  setOverlay,
  saveToProject,
  download,
  deviation,
} from '../state/studio';
import { TopBar, insertPrimitive } from './TopBar';
import { Sidebar } from './Sidebar';
import { LayersPanel } from './LayersPanel';
import { Canvas, isTyping } from './canvas/Canvas';
import { Inspector } from './inspector/Inspector';
import { Dialogs, Toasts } from './Dialogs';
import { Icon } from './icons';
import { translateTransform } from '../editor/geometry';
import { canvasModel, parentWorld } from './canvas/model';
import { documentFileName } from '../editor/documents';
import { local } from '../runtime/idb';

export function App() {
  const ready = useStudio((s) => s.ready);
  const bootError = useStudio((s) => s.bootError);
  const [split, setSplit] = useState<number>(() => local.get('split', 0.48));
  const leftRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => handleKey(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (bootError)
    return (
      <div className="boot-error">
        <h1>Studio failed to start</h1>
        <pre>{bootError}</pre>
      </div>
    );
  if (!ready)
    return (
      <div className="boot">
        <div className="spinner" />
        <div>Loading fonts & compositions…</div>
      </div>
    );

  return (
    <div className="app">
      <TopBar />
      <div className="main">
        <aside className="left" ref={leftRef} style={{ gridTemplateRows: `${split * 100}% 6px 1fr` }}>
          <Sidebar />
          <div
            className="splitter"
            onPointerDown={(e) => {
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              const rect = leftRef.current!.getBoundingClientRect();
              const move = (ev: PointerEvent) => {
                const v = Math.max(0.15, Math.min(0.85, (ev.clientY - rect.top) / rect.height));
                setSplit(v);
                local.set('split', v);
              };
              const up = () => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
              };
              window.addEventListener('pointermove', move);
              window.addEventListener('pointerup', up);
            }}
          />
          <div className="layers-panel">
            <div className="panel-title">
              <Icon name="layers" size={14} /> Layers
            </div>
            <LayersPanel />
          </div>
        </aside>
        <main className="center">
          <Canvas />
          <StatusBar />
        </main>
        <aside className="right">
          <Inspector />
        </aside>
      </div>
      <Dialogs />
      <Toasts />
    </div>
  );
}

function StatusBar() {
  const cursor = useStudio((s) => s.cursor);
  const render = useStudio((s) => ({ ms: s.render.ms, status: s.render.status, warnings: s.render.warnings }));
  const zoom = useStudio((s) => s.view.zoom);
  const nSel = useStudio((s) => s.selection.length);
  const live = useStudio((s) => s.live);
  useStudio((s) => [s.comp, s.compositionId]);
  const dev = deviation();
  return (
    <div className="statusbar">
      <span className="mono">{cursor ? `X ${Math.round(cursor.x)}  Y ${Math.round(cursor.y)}` : 'X —  Y —'}</span>
      <span>{Math.round(zoom * 100)}%</span>
      {live ? (
        <span>
          {live.width} × {live.height}
        </span>
      ) : null}
      {nSel ? <span>{nSel} selected</span> : null}
      <span className="spacer" />
      {dev.props.length || dev.overrides ? (
        <span className="warn-text" title={`Props: ${dev.props.join(', ') || '—'}`}>
          <Icon name="warning" size={12} /> Deviates from defaults
        </span>
      ) : null}
      {render.warnings.length ? (
        <span className="warn-text" title={render.warnings.join('\n')}>
          <Icon name="warning" size={12} /> {render.warnings.length} warning{render.warnings.length > 1 ? 's' : ''}
        </span>
      ) : null}
      <span className={`render-state ${render.status}`} data-testid="render-state">
        {render.status === 'rendering' ? 'Rendering…' : render.status === 'error' ? 'Render error' : `Rendered in ${render.ms} ms`}
      </span>
    </div>
  );
}

function nudge(dx: number, dy: number) {
  const s = studio.get();
  if (!s.live || !s.selection.length) return;
  const model = canvasModel(s.live);
  const patches: Record<string, Record<string, unknown>> = {};
  for (const id of s.selection) {
    const l = model.layers.get(id);
    if (!l || model.locked.has(id)) continue;
    const t = translateTransform(l.transform, parentWorld(model, id), { x: dx, y: dy });
    patches[id] = { 'transform.x': Math.round(t.x * 1000) / 1000, 'transform.y': Math.round(t.y * 1000) / 1000 };
  }
  editLayers(patches, { label: 'Nudge', coalesce: 'nudge' });
  void computeWorldMatrices;
}

function handleKey(e: KeyboardEvent) {
  if (isTyping(e)) return;
  if (studio.get().dialog) return;
  const m = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  const s = studio.get();
  const stop = () => {
    e.preventDefault();
    e.stopPropagation();
  };
  if (m && k === 'z') return stop(), e.shiftKey ? redo() : undo();
  if (m && k === 'y') return stop(), redo();
  if (m && k === 'g' && e.altKey) return stop(), toggleClippingMask();
  if (m && k === 'g') return stop(), e.shiftKey ? ungroupSelection() : groupSelection();
  if (m && k === 'd') return stop(), duplicateSelection();
  if (m && k === 'c') return stop(), copySelection();
  if (m && k === 'x') return stop(), copySelection(true);
  if (m && k === 'v') return stop(), void paste();
  if (m && k === 'a') return stop(), selectAll();
  if (m && k === 's') {
    stop();
    if (s.mode === 'design' && s.doc) {
      if (s.sources?.info.documentsDir) void saveToProject();
      else download(documentFileName(s.doc), serializeDocument(s.doc), 'application/json');
    }
    return;
  }
  if (m && (e.key === ']' || e.key === '}')) return stop(), reorderSelection(e.shiftKey ? 'front' : 'forward');
  if (m && (e.key === '[' || e.key === '{')) return stop(), reorderSelection(e.shiftKey ? 'back' : 'backward');
  if (m && (k === '=' || k === '+')) return stop(), zoomStep(1);
  if (m && k === '-') return stop(), zoomStep(-1);
  if (m && k === '0') return stop(), zoomToFit();
  if (m) return;
  if (e.key === 'Delete' || e.key === 'Backspace') return stop(), deleteSelection();
  if (e.key === 'Escape') {
    stop();
    if (s.scopeId) {
      const scope = s.scopeId;
      const parent = s.live ? canvasModel(s.live).parentOf.get(scope) ?? null : null;
      setSelection([scope], parent);
    } else setSelection([], null);
    return;
  }
  if (e.key.startsWith('Arrow')) {
    stop();
    const d = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft') nudge(-d, 0);
    if (e.key === 'ArrowRight') nudge(d, 0);
    if (e.key === 'ArrowUp') nudge(0, -d);
    if (e.key === 'ArrowDown') nudge(0, d);
    return;
  }
  if (e.key === '+' || e.key === '=') return stop(), zoomStep(1);
  if (e.key === '-' || e.key === '_') return stop(), zoomStep(-1);
  if (e.shiftKey && (e.key === '!' || e.code === 'Digit1')) return stop(), zoomToFit();
  if (e.shiftKey && (e.key === ')' || e.code === 'Digit0')) return stop(), zoomTo(1);
  if (e.shiftKey && (e.key === '@' || e.code === 'Digit2')) return stop(), zoomToSelection();
  if (e.key === '?') return stop(), studio.set({ dialog: { kind: 'shortcuts' } });
  if (e.key === "'") return stop(), setOverlay('pixelGrid', !s.overlays.pixelGrid);
  if (k === 'v') return studio.set({ tool: 'select' });
  if (k === 'h') return studio.set({ tool: 'hand' });
  if (k === 't') return stop(), insertPrimitive('text');
  if (k === 'r') return stop(), insertPrimitive('rect');
  if (k === 'o') return stop(), insertPrimitive('ellipse');
  if (k === 'l') return stop(), insertPrimitive('line');
  if (e.key === 'Enter' && s.selection.length === 1) {
    const l = findLayerIn(s.selection[0]);
    if (l && 'children' in l && (l as any).children.length) setSelection([(l as any).children[(l as any).children.length - 1].id], l.id);
  }
}
