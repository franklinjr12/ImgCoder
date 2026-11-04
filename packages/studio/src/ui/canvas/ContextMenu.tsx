import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  useStudio,
  copySelection,
  paste,
  duplicateSelection,
  deleteSelection,
  groupSelection,
  ungroupSelection,
  reorderSelection,
  toggleClippingMask,
  setLayerFlag,
  findLayerIn,
  zoomToSelection,
  resetLayerOverrides,
  selectAll,
} from '../../state/studio';
import { MenuItem, mod } from '../controls';

export function ContextMenu({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const selection = useStudio((s) => s.selection);
  const mode = useStudio((s) => s.mode);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    // keep the menu inside the viewport
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    const pw = parent.clientWidth;
    const ph = parent.clientHeight;
    setPos({ left: Math.max(4, Math.min(x, pw - el.offsetWidth - 4)), top: Math.max(4, Math.min(y, ph - el.offsetHeight - 4)) });
  }, [x, y]);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [onClose]);
  const has = selection.length > 0;
  const first = has ? findLayerIn(selection[0]) : null;
  const design = mode === 'design';
  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };
  return (
    <div ref={ref} className="menu context" style={{ left: pos.left, top: pos.top }} onPointerDown={(e) => e.stopPropagation()}>
      <MenuItem icon="copy" label="Copy" shortcut={`${mod}C`} disabled={!has} onClick={run(() => copySelection())} />
      <MenuItem icon="copy" label="Paste" shortcut={`${mod}V`} disabled={!design} onClick={run(() => void paste())} />
      <MenuItem icon="copy" label="Duplicate" shortcut={`${mod}D`} disabled={!has || !design} onClick={run(duplicateSelection)} />
      <div className="menu-sep" />
      <MenuItem icon="group" label="Group" shortcut={`${mod}G`} disabled={!has || !design} onClick={run(groupSelection)} />
      <MenuItem icon="frame" label="Ungroup" shortcut={`${mod}⇧G`} disabled={!design || first?.type !== 'group'} onClick={run(ungroupSelection)} />
      <MenuItem icon="mask" label={first?.clippingMask ? 'Release clipping mask' : 'Clipping mask'} shortcut={`${mod}⌥G`} disabled={!has} onClick={run(() => toggleClippingMask())} />
      <div className="menu-sep" />
      <MenuItem label="Bring to front" shortcut={`${mod}⇧]`} disabled={!has || !design} onClick={run(() => reorderSelection('front'))} />
      <MenuItem label="Bring forward" shortcut={`${mod}]`} disabled={!has || !design} onClick={run(() => reorderSelection('forward'))} />
      <MenuItem label="Send backward" shortcut={`${mod}[`} disabled={!has || !design} onClick={run(() => reorderSelection('backward'))} />
      <MenuItem label="Send to back" shortcut={`${mod}⇧[`} disabled={!has || !design} onClick={run(() => reorderSelection('back'))} />
      <div className="menu-sep" />
      <MenuItem icon={first?.visible === false ? 'eye' : 'eyeOff'} label={first?.visible === false ? 'Show' : 'Hide'} disabled={!has} onClick={run(() => selection.forEach((id) => setLayerFlag(id, 'visible', findLayerIn(id)?.visible === false)))} />
      <MenuItem icon="lock" label={first?.locked ? 'Unlock' : 'Lock'} disabled={!has} onClick={run(() => selection.forEach((id) => setLayerFlag(id, 'locked', !findLayerIn(id)?.locked)))} />
      {mode === 'composition' && has ? <MenuItem icon="reset" label="Reset layer overrides" onClick={run(() => selection.forEach(resetLayerOverrides))} /> : null}
      <MenuItem icon="fit" label="Zoom to selection" shortcut="⇧2" disabled={!has} onClick={run(zoomToSelection)} />
      <MenuItem label="Select all" shortcut={`${mod}A`} onClick={run(selectAll)} />
      <div className="menu-sep" />
      <MenuItem icon="trash" label={design ? 'Delete' : 'Hide (override)'} shortcut="Del" danger disabled={!has} onClick={run(deleteSelection)} />
    </div>
  );
}
