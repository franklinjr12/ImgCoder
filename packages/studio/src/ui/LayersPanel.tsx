/** Layer tree (US-3.2): drag & drop reorder/reparent, rename, visibility/lock, clipping masks. */
import { useMemo, useState } from 'react';
import { isContainer, type Layer } from '@game-artisan/core';
import { useStudio, setSelection, setLayerFlag, renameLayer, moveLayersTo, studio, toggleClippingMask, groupSelection, ungroupSelection, deleteSelection, duplicateSelection } from '../state/studio';
import { Icon } from './icons';
import { IconButton, mod } from './controls';
import { layerDisplayName, layerIcon } from '../editor/primitives';

type Drop = { id: string; pos: 'above' | 'below' | 'inside' } | null;

export function LayersPanel() {
  const live = useStudio((s) => s.live);
  const selection = useStudio((s) => s.selection);
  const hoverId = useStudio((s) => s.hoverId);
  const mode = useStudio((s) => s.mode);
  const overrides = useStudio((s) => (s.mode === 'composition' && s.compositionId ? s.comp[s.compositionId]?.overrides : undefined));
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [drag, setDrag] = useState<string[] | null>(null);
  const [drop, setDrop] = useState<Drop>(null);
  const [anchor, setAnchor] = useState<string | null>(null);

  const flat = useMemo(() => {
    const out: { layer: Layer; depth: number; parent: Layer | null; index: number }[] = [];
    if (!live) return out;
    const rec = (list: Layer[], depth: number, parent: Layer | null) => {
      for (let i = list.length - 1; i >= 0; i--) {
        const l = list[i];
        out.push({ layer: l, depth, parent, index: i });
        if (isContainer(l) && !collapsed.has(l.id)) rec(l.children, depth + 1, l);
      }
    };
    rec(live.children, 0, null);
    return out;
  }, [live, collapsed]);

  if (!live) return <div className="empty-hint">No document</div>;

  const onRowClick = (e: React.MouseEvent, id: string) => {
    if (e.shiftKey && anchor) {
      const ids = flat.map((r) => r.layer.id);
      const a = ids.indexOf(anchor);
      const b = ids.indexOf(id);
      if (a >= 0 && b >= 0) setSelection(ids.slice(Math.min(a, b), Math.max(a, b) + 1));
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      setSelection(selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id]);
    } else {
      const row = flat.find((r) => r.layer.id === id);
      setSelection([id], row?.parent?.id ?? null);
    }
    setAnchor(id);
  };

  const onDragOver = (e: React.DragEvent, row: (typeof flat)[number]) => {
    if (!drag) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const f = (e.clientY - r.top) / r.height;
    const container = isContainer(row.layer);
    const pos: 'above' | 'below' | 'inside' = container && f > 0.3 && f < 0.7 ? 'inside' : f < 0.5 ? 'above' : 'below';
    if (drop?.id !== row.layer.id || drop.pos !== pos) setDrop({ id: row.layer.id, pos });
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (!drag || !drop) return;
    const row = flat.find((r) => r.layer.id === drop.id);
    if (!row || drag.includes(drop.id)) {
      setDrag(null);
      setDrop(null);
      return;
    }
    if (drop.pos === 'inside' && isContainer(row.layer)) moveLayersTo(drag, row.layer.id, row.layer.children.length);
    else moveLayersTo(drag, row.parent?.id ?? null, drop.pos === 'above' ? row.index + 1 : row.index);
    setDrag(null);
    setDrop(null);
  };

  const design = mode === 'design';
  const first = selection[0] ? flat.find((r) => r.layer.id === selection[0])?.layer : null;

  return (
    <div className="layers">
      <div className="layers-toolbar">
        <IconButton icon="group" title={`Group (${mod}G)`} disabled={!design || !selection.length} onClick={groupSelection} />
        <IconButton icon="frame" title={`Ungroup (${mod}⇧G)`} disabled={!design || first?.type !== 'group'} onClick={ungroupSelection} />
        <IconButton icon="mask" title="Toggle clipping mask (clip to layer below)" disabled={!selection.length} active={!!first?.clippingMask} onClick={() => toggleClippingMask()} />
        <IconButton icon="copy" title={`Duplicate (${mod}D)`} disabled={!design || !selection.length} onClick={duplicateSelection} />
        <span className="spacer" />
        <IconButton icon="trash" title={design ? 'Delete (Del)' : 'Hide via override (Del)'} disabled={!selection.length} onClick={deleteSelection} />
      </div>
      <div className="layer-list" onDragLeave={() => setDrop(null)} onClick={(e) => e.target === e.currentTarget && setSelection([], null)} role="tree">
        {flat.map((row) => {
          const l = row.layer;
          const selected = selection.includes(l.id);
          const container = isContainer(l);
          const isOverridden = !!overrides?.[l.id];
          const bound = l.bindings && Object.keys(l.bindings).length;
          return (
            <div
              key={l.id}
              role="treeitem"
              aria-selected={selected}
              className={`layer-row ${selected ? 'selected' : ''} ${hoverId === l.id ? 'hover' : ''} ${l.visible === false ? 'hidden' : ''} ${l.locked ? 'locked' : ''} ${drop?.id === l.id ? `drop-${drop.pos}` : ''}`}
              style={{ paddingLeft: 8 + row.depth * 14 + (l.clippingMask ? 10 : 0) }}
              draggable={design && renaming !== l.id}
              onDragStart={(e) => {
                const ids = selected ? selection : [l.id];
                if (!selected) setSelection([l.id]);
                setDrag(ids);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', ids.join(','));
              }}
              onDragEnd={() => {
                setDrag(null);
                setDrop(null);
              }}
              onDragOver={(e) => onDragOver(e, row)}
              onDrop={onDrop}
              onClick={(e) => onRowClick(e, l.id)}
              onMouseEnter={() => studio.set({ hoverId: l.id })}
              onMouseLeave={() => studio.set({ hoverId: null })}
              onDoubleClick={() => setRenaming(l.id)}
            >
              {l.clippingMask ? <span className="clip-arrow" title="Clipped to the layer below">↳</span> : null}
              <button
                type="button"
                className={`disclosure ${container ? '' : 'invisible'}`}
                onClick={(e) => {
                  e.stopPropagation();
                  const n = new Set(collapsed);
                  if (n.has(l.id)) n.delete(l.id);
                  else n.add(l.id);
                  setCollapsed(n);
                }}
              >
                <Icon name={collapsed.has(l.id) ? 'chevronRight' : 'chevronDown'} size={11} />
              </button>
              <Icon name={layerIcon(l)} size={14} className="layer-type" />
              {renaming === l.id ? (
                <input
                  className="rename"
                  autoFocus
                  defaultValue={layerDisplayName(l)}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    if (e.target.value && e.target.value !== layerDisplayName(l)) renameLayer(l.id, e.target.value);
                    setRenaming(null);
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                />
              ) : (
                <span className="layer-name" title={`${layerDisplayName(l)} · ${l.type} · ${l.id}`}>
                  {layerDisplayName(l)}
                </span>
              )}
              {bound ? (
                <span className="tag bound" title={`Bound to props: ${Object.entries(l.bindings!).map(([k, v]) => `${k} → ${v}`).join(', ')}`}>
                  <Icon name="link" size={11} />
                </span>
              ) : null}
              {isOverridden ? <span className="tag override" title="Has canvas overrides ($overrides)" /> : null}
              <span className="row-actions">
                <button type="button" className={`mini ${l.locked ? 'on' : ''}`} title={l.locked ? 'Unlock' : 'Lock'} onClick={(e) => (e.stopPropagation(), setLayerFlag(l.id, 'locked', !l.locked))}>
                  <Icon name={l.locked ? 'lock' : 'unlock'} size={13} />
                </button>
                <button type="button" className={`mini ${l.visible === false ? 'on' : ''}`} title={l.visible === false ? 'Show' : 'Hide'} onClick={(e) => (e.stopPropagation(), setLayerFlag(l.id, 'visible', l.visible === false))}>
                  <Icon name={l.visible === false ? 'eyeOff' : 'eye'} size={13} />
                </button>
              </span>
            </div>
          );
        })}
        {!flat.length ? <div className="empty-hint">Empty artboard — insert text, shapes or drop images.</div> : null}
      </div>
    </div>
  );
}
