/**
 * Canvas viewport (US-3.1/3.3): inline SVG from the core emitter (parity with the CLI), infinite
 * pan/zoom, rulers, guides, pixel grid, snapping with smart guides, transform gizmos, marquee,
 * inline text editing, drag & drop of images. Gestures write transforms straight to the
 * layer's `<g data-layer-id>` DOM node (60 fps) and commit to the store on pointer-up.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { applyToPoint, invert, multiply, rectsIntersect, toSvgMatrix, transformToMatrix, type Matrix, type Point, type Rect, type Transform, type TextLayer } from '@game-artisan/core';
import {
  studio,
  useStudio,
  editLayers,
  setSelection,
  setView,
  zoomTo,
  consumePendingFit,
  zoomToFit,
  guides as currentGuides,
  setGuides,
  insertLayer,
  editLayer,
  toast,
  findLayerIn,
  resetCanvasDom,
  selectArtboard,
  type StudioState,
} from '../../state/studio';
import {
  HANDLES,
  HANDLE_POS,
  boxCorners,
  handleCursor,
  rectScaleFactors,
  resizeTransform,
  rotateSelection,
  rotateTransform,
  scaleSelection,
  skewTransform,
  tidyTransform,
  translateSelection,
  type Handle,
  type SelectionItem,
} from '../../editor/geometry';
import { collectSnapTargets, snapPoint, snapRect, type SmartGuide, type SnapTargets } from '../../editor/snapping';
import { canvasModel, parentWorld, worldWithPreview, ancestors, type CanvasModel } from './model';
import { Rulers, RULER } from './Rulers';
import { SceneOverlay } from './SceneOverlay';
import { ContextMenu } from './ContextMenu';
import { createImageLayer } from '../../editor/primitives';
import { addToLibrary, fileToImage, librarySrc, probeSrc } from '../../runtime/assets';

type Gesture =
  | { kind: 'pan'; sx: number; sy: number; panX: number; panY: number }
  | { kind: 'move'; start: Point; items: SelectionItem[]; rect: Rect; targets: SnapTargets; moved: boolean }
  | { kind: 'resize'; handle: Handle; start: Point; items: SelectionItem[]; rect: Rect; single: boolean; targets: SnapTargets; axisAligned: boolean }
  | { kind: 'rotate'; start: Point; items: SelectionItem[]; rect: Rect; single: boolean; center: Point }
  | { kind: 'skew'; handle: 'n' | 's' | 'e' | 'w'; start: Point; items: SelectionItem[] }
  | { kind: 'marquee'; start: Point; current: Point; additive: boolean; base: string[] }
  | { kind: 'guide'; axis: 'x' | 'y'; index: number; position: number; overRuler: boolean };

const sel = (s: StudioState) => ({
  live: s.live,
  render: s.render,
  view: s.view,
  selection: s.selection,
  overlays: s.overlays,
  tool: s.tool,
  hoverId: s.hoverId,
  scopeId: s.scopeId,
  mode: s.mode,
  size: s.viewportSize,
  guidesKey: s.mode === 'design' ? s.doc : s.comp,
  artboards: s.mode === 'design' && s.doc && s.doc.artboards.length > 1 ? s.doc.artboards.map((a) => `${a.id}\u0000${a.name ?? a.id}`).join('\u0001') : '',
  artboardId: s.artboardId,
});

export function Canvas() {
  const { live, render, view, selection, overlays, tool, hoverId, scopeId, mode, size, artboards, artboardId } = useStudio(sel);
  const vpRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const preview = useRef<Map<string, Transform>>(new Map());
  const smart = useRef<SmartGuide[]>([]);
  const space = useRef(false);
  const [, setTick] = useState(0);
  const raf = useRef(0);
  const [panning, setPanning] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [dropHint, setDropHint] = useState(false);
  const redraw = useCallback(() => {
    if (!raf.current)
      raf.current = requestAnimationFrame(() => {
        raf.current = 0;
        setTick((t) => t + 1);
      });
  }, []);

  const model: CanvasModel | null = useMemo(() => (live ? canvasModel(live) : null), [live]);
  const renderedModel = useMemo(() => (render.artboard ? canvasModel(render.artboard) : null), [render.artboard]);
  const guideList = currentGuides();

  // ---- SVG host (manual innerHTML so transient DOM previews can be reset deterministically)
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.innerHTML = render.svg;
    const svg = host.firstElementChild as SVGSVGElement | null;
    if (svg) {
      svg.style.display = 'block';
      svg.setAttribute('width', String(render.artboard?.width ?? ''));
      svg.setAttribute('height', String(render.artboard?.height ?? ''));
    }
    if (gesture.current && preview.current.size) applyPreviewToDom();
    else preview.current.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [render.svg, render.nonce]);

  // ---- viewport size + fit on open
  useLayoutEffect(() => {
    const el = vpRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      studio.set({ viewportSize: { width: r.width, height: r.height } });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (live && size.width > 50 && consumePendingFit()) zoomToFit();
  }, [live, size.width, size.height]);

  // ---- coordinate helpers
  const toScreen = (p: Point): Point => ({ x: p.x * view.zoom + view.panX, y: p.y * view.zoom + view.panY });
  const clientToLocal = (cx: number, cy: number): Point => {
    const r = vpRef.current!.getBoundingClientRect();
    return { x: cx - r.left, y: cy - r.top };
  };
  const clientToWorld = (cx: number, cy: number): Point => {
    const v = studio.get().view;
    const p = clientToLocal(cx, cy);
    return { x: (p.x - v.panX) / v.zoom, y: (p.y - v.panY) / v.zoom };
  };

  // ---- wheel: pan / zoom (non-passive listener)
  useEffect(() => {
    const el = vpRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = studio.get().view;
      const p = clientToLocal(e.clientX, e.clientY);
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025) * (e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < 10 ? 4 : 1));
        zoomTo(v.zoom * factor, p);
      } else {
        const k = e.deltaMode === 1 ? 16 : 1;
        const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
        const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
        setView({ panX: v.panX - dx * k, panY: v.panY - dy * k });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- space = temporary hand tool
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e)) {
        if (!space.current) {
          space.current = true;
          setPanning(true);
        }
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        space.current = false;
        setPanning(false);
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // ---- selection items for gestures
  const itemsFor = (ids: string[]): SelectionItem[] => {
    if (!model) return [];
    // only outermost selected layers move (children follow their parents)
    const set = new Set(ids);
    return ids
      .filter((id) => model.layers.has(id) && !ancestors(model, id).some((a) => set.has(a)))
      .map((id) => ({ id, transform: { ...model.layers.get(id)!.transform }, parentWorld: parentWorld(model, id) }));
  };

  const worldBounds = (ids: string[], pv: Map<string, Transform> | null): Rect | null => {
    if (!model) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of ids) {
      const l = model.layers.get(id);
      if (!l) continue;
      const t = pv?.get(id) ?? l.transform;
      const m = worldWithPreview(model, id, pv);
      for (const c of boxCorners(m, t.width, t.height)) {
        minX = Math.min(minX, c.x);
        minY = Math.min(minY, c.y);
        maxX = Math.max(maxX, c.x);
        maxY = Math.max(maxY, c.y);
      }
    }
    return Number.isFinite(minX) ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null;
  };

  const snapTargetsFor = (ids: string[]): SnapTargets => {
    if (!model) return { x: [], y: [] };
    const exclude = new Set<string>(ids);
    for (const [id] of model.layers) if (ancestors(model, id).some((a) => exclude.has(a))) exclude.add(id);
    return collectSnapTargets(model.artboard, exclude, currentGuides());
  };

  // ---- DOM preview
  function applyPreviewToDom() {
    const host = hostRef.current;
    if (!host) return;
    for (const [id, t] of preview.current) {
      const node = host.querySelector(`[data-layer-id="${CSS.escape(id)}"]`);
      if (!node) continue;
      const rendered = renderedModel?.layers.get(id)?.transform ?? model?.layers.get(id)?.transform;
      let m: Matrix = transformToMatrix(t);
      if (rendered && rendered.width > 0 && rendered.height > 0 && (Math.abs(rendered.width - t.width) > 1e-6 || Math.abs(rendered.height - t.height) > 1e-6)) {
        m = multiply(m, [t.width / rendered.width, 0, 0, t.height / rendered.height, 0, 0]);
      }
      node.setAttribute('transform', toSvgMatrix(m));
    }
  }

  const setPreview = (map: Map<string, Transform>) => {
    preview.current = map;
    applyPreviewToDom();
    redraw();
  };

  const commitPreview = (label: string) => {
    const pv = preview.current;
    if (!model || !pv.size) return;
    const patches: Record<string, Record<string, unknown>> = {};
    for (const [id, t0] of pv) {
      const before = model.layers.get(id)?.transform;
      if (!before) continue;
      const t = tidyTransform(t0);
      const patch: Record<string, unknown> = {};
      for (const k of ['x', 'y', 'width', 'height', 'rotation', 'scaleX', 'scaleY', 'skewX', 'skewY'] as const) {
        if (Math.abs((t as any)[k] - (before as any)[k]) > 1e-6) patch[`transform.${k}`] = (t as any)[k];
      }
      for (const k of ['flipX', 'flipY'] as const) if (!!t[k] !== !!before[k]) patch[`transform.${k}`] = !!t[k];
      if (Object.keys(patch).length) patches[id] = patch;
    }
    if (Object.keys(patches).length) editLayers(patches, { label });
    else resetCanvasDom();
  };

  // ---- hit testing (data-layer-id), respecting locked / hidden, scope and text boxes
  const hitTest = (cx: number, cy: number, deep: boolean): string | null => {
    if (!model || !hostRef.current) return null;
    const cands = new Set<string>();
    for (const el of document.elementsFromPoint(cx, cy)) {
      if (!hostRef.current.contains(el)) continue;
      const g = el.closest('[data-layer-id]');
      const id = g?.getAttribute('data-layer-id');
      if (id) cands.add(id);
    }
    const w = clientToWorld(cx, cy);
    for (const [id, l] of model.layers) {
      if (l.type !== 'text') continue;
      const p = applyToPoint(invert(model.world.get(id)!), w);
      if (p.x >= 0 && p.y >= 0 && p.x <= l.transform.width && p.y <= l.transform.height) cands.add(id);
    }
    // topmost first; full-bleed overlays (gradients, scanlines, halftones covering the whole
    // artboard) don't steal clicks from smaller layers below them (select them in the layers panel)
    const ranked = [...cands].filter((id) => !model.locked.has(id) && !model.hidden.has(id)).sort((a, b) => (model.order.get(b) ?? 0) - (model.order.get(a) ?? 0));
    const fullBleed = (id: string) => {
      const l = model.layers.get(id)!;
      const pts = boxCorners(model.world.get(id)!, l.transform.width, l.transform.height);
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const W = model.artboard.width;
      const H = model.artboard.height;
      return Math.min(...xs) <= 0.5 && Math.min(...ys) <= 0.5 && Math.max(...xs) >= W - 0.5 && Math.max(...ys) >= H - 0.5;
    };
    const best = deep ? (ranked[0] ?? null) : (ranked.find((id) => !fullBleed(id)) ?? ranked[0] ?? null);
    if (!best || deep) return best;
    const chain = [...ancestors(model, best), best];
    const scope = studio.get().scopeId;
    if (scope && chain.includes(scope)) return chain[chain.indexOf(scope) + 1] ?? best;
    return chain[0];
  };

  // ---- pointer handling
  const onPointerDown = (e: React.PointerEvent) => {
    if (editing) return;
    vpRef.current?.focus({ preventScroll: true });
    setMenu(null);
    if (e.button === 2) return;
    const s = studio.get();
    const w = clientToWorld(e.clientX, e.clientY);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (e.button === 1 || s.tool === 'hand' || space.current) {
      gesture.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, panX: s.view.panX, panY: s.view.panY };
      setPanning(true);
      return;
    }
    if (!model) return;
    const hit = hitTest(e.clientX, e.clientY, e.metaKey || e.ctrlKey);
    let selection = s.selection;
    const bounds = worldBounds(selection, null);
    const insideSelection = !!bounds && selection.length > 1 && w.x >= bounds.x && w.y >= bounds.y && w.x <= bounds.x + bounds.width && w.y <= bounds.y + bounds.height;
    if (hit) {
      if (e.shiftKey) {
        selection = selection.includes(hit) ? selection.filter((x) => x !== hit) : [...selection, hit];
        setSelection(selection);
        if (!selection.includes(hit)) return;
      } else if (!selection.includes(hit) && !insideSelection) {
        selection = [hit];
        const newScope = e.metaKey || e.ctrlKey ? (model.parentOf.get(hit) ?? null) : s.scopeId && ancestors(model, hit).includes(s.scopeId) ? s.scopeId : null;
        setSelection(selection, newScope);
      }
    } else if (insideSelection) {
      // drag the multi-selection by its box
    } else {
      gesture.current = { kind: 'marquee', start: w, current: w, additive: e.shiftKey, base: e.shiftKey ? selection : [] };
      if (!e.shiftKey) setSelection([], null);
      redraw();
      return;
    }
    const movable = selection.filter((id) => !model.locked.has(id));
    if (!movable.length) return;
    const items = itemsFor(movable);
    gesture.current = { kind: 'move', start: w, items, rect: worldBounds(items.map((i) => i.id), null)!, targets: snapTargetsFor(movable), moved: false };
  };

  const startHandle = (e: React.PointerEvent, handle: Handle | 'rotate') => {
    e.stopPropagation();
    if (e.button !== 0 || !model) return;
    vpRef.current?.setPointerCapture(e.pointerId);
    const s = studio.get();
    const ids = s.selection.filter((id) => !model.locked.has(id) && model.layers.has(id));
    if (!ids.length) return;
    const items = itemsFor(ids);
    const rect = worldBounds(items.map((i) => i.id), null)!;
    const w = clientToWorld(e.clientX, e.clientY);
    const single = items.length === 1;
    if (handle === 'rotate') {
      const center = single ? applyToPoint(items[0].parentWorld, { x: items[0].transform.x + items[0].transform.originX * items[0].transform.width, y: items[0].transform.y + items[0].transform.originY * items[0].transform.height }) : { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      gesture.current = { kind: 'rotate', start: w, items, rect, single, center };
      return;
    }
    if (single && (e.ctrlKey || e.metaKey) && (handle === 'n' || handle === 's' || handle === 'e' || handle === 'w')) {
      gesture.current = { kind: 'skew', handle, start: w, items };
      return;
    }
    const t = items[0].transform;
    const pw = items[0].parentWorld;
    const axisAligned = single && !t.rotation && !t.skewX && !t.skewY && Math.abs(pw[1]) < 1e-9 && Math.abs(pw[2]) < 1e-9;
    gesture.current = { kind: 'resize', handle, start: w, items, rect, single, targets: snapTargetsFor(ids), axisAligned };
  };

  const startGuide = (e: React.PointerEvent, axis: 'x' | 'y', index: number) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    vpRef.current?.setPointerCapture(e.pointerId);
    const w = clientToWorld(e.clientX, e.clientY);
    gesture.current = { kind: 'guide', axis, index, position: axis === 'x' ? w.x : w.y, overRuler: index < 0 };
    redraw();
  };

  const cursorRaf = useRef(0);
  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    const s = studio.get();
    const w = clientToWorld(e.clientX, e.clientY);
    if (!cursorRaf.current) {
      cursorRaf.current = requestAnimationFrame(() => {
        cursorRaf.current = 0;
        studio.set({ cursor: { x: w.x, y: w.y } });
      });
    }
    if (!g) {
      if (!model || editing || space.current || s.tool === 'hand') return;
      const hit = hitTest(e.clientX, e.clientY, e.metaKey || e.ctrlKey);
      if (hit !== s.hoverId) studio.set({ hoverId: hit });
      return;
    }
    const threshold = 6 / s.view.zoom;
    const snapOn = s.overlays.snapping && !e.altKey;
    switch (g.kind) {
      case 'pan':
        setView({ panX: g.panX + (e.clientX - g.sx), panY: g.panY + (e.clientY - g.sy) });
        return;
      case 'marquee':
        g.current = w;
        redraw();
        return;
      case 'guide': {
        const local = clientToLocal(e.clientX, e.clientY);
        g.overRuler = g.axis === 'x' ? local.x < 0 : local.y < 0;
        let pos = g.axis === 'x' ? w.x : w.y;
        if (s.overlays.pixelSnap) pos = Math.round(pos);
        g.position = pos;
        redraw();
        return;
      }
      case 'move': {
        let d = { x: w.x - g.start.x, y: w.y - g.start.y };
        if (!g.moved && Math.hypot(d.x * s.view.zoom, d.y * s.view.zoom) < 3) return;
        g.moved = true;
        if (e.shiftKey) {
          if (Math.abs(d.x) > Math.abs(d.y)) d.y = 0;
          else d.x = 0;
        }
        smart.current = [];
        if (snapOn || s.overlays.pixelSnap) {
          const r = snapRect({ ...g.rect, x: g.rect.x + d.x, y: g.rect.y + d.y }, g.targets, { threshold, pixelGrid: s.overlays.pixelSnap, objects: snapOn, guides: snapOn && s.overlays.guides });
          d = { x: d.x + (e.shiftKey && d.x === 0 ? 0 : r.dx), y: d.y + (e.shiftKey && d.y === 0 ? 0 : r.dy) };
          smart.current = r.guides;
        }
        setPreview(translateSelection(g.items, d));
        return;
      }
      case 'resize': {
        smart.current = [];
        let p = w;
        const [hx, hy] = HANDLE_POS[g.handle];
        if (g.single) {
          const it = g.items[0];
          if (g.axisAligned && (snapOn || s.overlays.pixelSnap) && !e.altKey) {
            // snap the dragged edge(s)
            const t = it.transform;
            const M = multiply(it.parentWorld, transformToMatrix(t));
            const handleWorld = applyToPoint(M, { x: hx * t.width, y: hy * t.height });
            const moved = { x: handleWorld.x + (w.x - g.start.x), y: handleWorld.y + (w.y - g.start.y) };
            const sp = snapPoint(moved, g.targets, { threshold, pixelGrid: s.overlays.pixelSnap, objects: snapOn, guides: snapOn && s.overlays.guides }, { x: hx !== 0.5, y: hy !== 0.5 });
            p = { x: w.x + (sp.x - moved.x), y: w.y + (sp.y - moved.y) };
            smart.current = sp.guides;
          }
          const inv = invert(it.parentWorld);
          const next = resizeTransform(it.transform, g.handle, applyToPoint(inv, g.start), applyToPoint(inv, p), { keepAspect: e.shiftKey, fromCenter: e.altKey });
          setPreview(new Map([[it.id, next]]));
        } else {
          const f = rectScaleFactors(g.rect, g.handle, g.start, p, { keepAspect: e.shiftKey, fromCenter: e.altKey });
          setPreview(scaleSelection(g.items, f.anchor, f.sx, f.sy));
        }
        return;
      }
      case 'rotate': {
        const a0 = Math.atan2(g.start.y - g.center.y, g.start.x - g.center.x);
        const a1 = Math.atan2(w.y - g.center.y, w.x - g.center.x);
        if (g.single) {
          const it = g.items[0];
          const inv = invert(it.parentWorld);
          setPreview(new Map([[it.id, rotateTransform(it.transform, applyToPoint(inv, g.start), applyToPoint(inv, w), e.shiftKey ? 15 : undefined)]]));
        } else {
          let delta = ((a1 - a0) * 180) / Math.PI;
          if (e.shiftKey) delta = Math.round(delta / 15) * 15;
          setPreview(rotateSelection(g.items, g.center, delta));
        }
        return;
      }
      case 'skew': {
        const it = g.items[0];
        const inv = invert(it.parentWorld);
        setPreview(new Map([[it.id, skewTransform(it.transform, g.handle, applyToPoint(inv, g.start), applyToPoint(inv, w))]]));
        return;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    gesture.current = null;
    smart.current = [];
    if (!g) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    switch (g.kind) {
      case 'pan':
        setPanning(space.current);
        break;
      case 'marquee': {
        if (!model) break;
        const r = normRect(g.start, g.current);
        if (r.width * view.zoom < 2 && r.height * view.zoom < 2) break;
        const scope = studio.get().scopeId;
        const ids: string[] = [];
        for (const [id] of model.layers) {
          if ((model.parentOf.get(id) ?? null) !== scope || model.locked.has(id) || model.hidden.has(id)) continue;
          const b = worldBounds([id], null);
          if (b && rectsIntersect(b, r)) ids.push(id);
        }
        setSelection([...new Set([...g.base, ...ids])]);
        break;
      }
      case 'guide': {
        const list = [...currentGuides()];
        if (g.index >= 0) {
          if (g.overRuler) list.splice(g.index, 1);
          else list[g.index] = { axis: g.axis, position: g.position };
          setGuides(list, g.overRuler ? 'Remove guide' : 'Move guide');
        } else if (!g.overRuler) {
          list.push({ axis: g.axis, position: g.position });
          setGuides(list, 'Add guide');
        }
        break;
      }
      case 'move':
        if (g.moved) commitPreview('Move');
        break;
      case 'resize':
        commitPreview('Resize');
        break;
      case 'rotate':
        commitPreview('Rotate');
        break;
      case 'skew':
        commitPreview('Skew');
        break;
    }
    redraw();
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (!model) return;
    const deep = hitTest(e.clientX, e.clientY, true);
    if (!deep) return;
    const l = model.layers.get(deep);
    if (l?.type === 'text' && !model.locked.has(deep)) {
      setSelection([deep], model.parentOf.get(deep) ?? null);
      setEditing(deep);
      return;
    }
    const s = studio.get();
    const cur = s.selection[0];
    const curLayer = cur ? model.layers.get(cur) : null;
    if (curLayer && (curLayer.type === 'group' || curLayer.type === 'mask' || curLayer.type === 'boolean')) {
      const chain = [...ancestors(model, deep), deep];
      const idx = chain.indexOf(cur);
      if (idx >= 0 && chain[idx + 1]) setSelection([chain[idx + 1]], cur);
    }
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const hit = hitTest(e.clientX, e.clientY, e.metaKey || e.ctrlKey);
    if (hit && !studio.get().selection.includes(hit)) setSelection([hit]);
    const p = clientToLocal(e.clientX, e.clientY);
    setMenu({ x: p.x, y: p.y });
  };

  // ---- drag & drop images / library assets onto the canvas
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDropHint(false);
    const s = studio.get();
    if (!s.live) return;
    const at = clientToWorld(e.clientX, e.clientY);
    const assetJson = e.dataTransfer.getData('application/x-artisan-asset');
    if (s.mode !== 'design') {
      toast('Detach to design to add images to a code template (or use an image prop)', 'warning', 4000);
      return;
    }
    if (assetJson) {
      const a = JSON.parse(assetJson) as { src?: string; libId?: string; name: string; mime: string; width?: number; height?: number };
      const src = a.libId ? await librarySrc(a.libId) : a.src!;
      let { width, height } = a;
      if (!width || !height) {
        const p = await probeSrc(src).catch(() => ({ width: undefined, height: undefined, mime: a.mime }));
        width = p.width;
        height = p.height;
      }
      insertLayer(createImageLayer({ src, name: a.name, width, height, mime: a.mime, artboardWidth: s.live.width, artboardHeight: s.live.height, at }));
      return;
    }
    const files = [...e.dataTransfer.files].filter((f) => /^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(f.name));
    if (!files.length) return toast('Drop PNG, JPEG, WebP, GIF or SVG images', 'warning');
    for (const [i, f] of files.entries()) {
      const img = await fileToImage(f);
      void addToLibrary(f).then(() => studio.set((st) => ({ assetsVersion: st.assetsVersion + 1 })));
      insertLayer(createImageLayer({ ...img, artboardWidth: s.live.width, artboardHeight: s.live.height, at: { x: at.x + i * 24, y: at.y + i * 24 } }));
    }
  };

  // ---- overlay drawing
  const zoom = view.zoom;
  const pv = preview.current.size ? preview.current : null;
  const ab = live;
  const g = gesture.current;
  const selectedIds = model ? selection.filter((id) => model.layers.has(id)) : [];
  let selectionUi: React.JSX.Element | null = null;
  let label: string | null = null;
  if (model && selectedIds.length && !editing) {
    const single = selectedIds.length === 1;
    let corners: Point[];
    if (single) {
      const id = selectedIds[0];
      const l = model.layers.get(id)!;
      const t = pv?.get(id) ?? l.transform;
      corners = boxCorners(worldWithPreview(model, id, pv), t.width, t.height).map(toScreen);
      if (g?.kind === 'resize' || g?.kind === 'skew') label = `${Math.round(t.width)} × ${Math.round(t.height)}`;
      if (g?.kind === 'rotate') label = `${Math.round(t.rotation * 10) / 10}°`;
      if (g?.kind === 'skew') label = `skew ${Math.round(t.skewX)}° / ${Math.round(t.skewY)}°`;
    } else {
      const b = worldBounds(selectedIds, pv)!;
      corners = [{ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y }, { x: b.x + b.width, y: b.y + b.height }, { x: b.x, y: b.y + b.height }].map(toScreen);
      if (g?.kind === 'resize') label = `${Math.round(b.width)} × ${Math.round(b.height)}`;
    }
    if (g?.kind === 'move' && g.moved) {
      const b = worldBounds(selectedIds, pv);
      if (b) label = `X ${Math.round(b.x)}  Y ${Math.round(b.y)}`;
    }
    const allLocked = selectedIds.every((id) => model.locked.has(id));
    const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const hp: Record<Handle, Point> = {
      nw: corners[0], n: mid(corners[0], corners[1]), ne: corners[1], e: mid(corners[1], corners[2]),
      se: corners[2], s: mid(corners[2], corners[3]), sw: corners[3], w: mid(corners[3], corners[0]),
    };
    const angle = (Math.atan2(corners[1].y - corners[0].y, corners[1].x - corners[0].x) * 180) / Math.PI;
    const up = (() => {
      const top = hp.n;
      const bot = hp.s;
      const len = Math.hypot(top.x - bot.x, top.y - bot.y);
      if (len < 1e-3) return { x: 0, y: -1 };
      return { x: (top.x - bot.x) / len, y: (top.y - bot.y) / len };
    })();
    const rot = { x: hp.n.x + up.x * 26, y: hp.n.y + up.y * 26 };
    const w = Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y);
    const h = Math.hypot(corners[3].x - corners[0].x, corners[3].y - corners[0].y);
    const tiny = w < 18 || h < 18;
    selectionUi = (
      <g className={`selection ${allLocked ? 'locked' : ''}`}>
        <polygon points={corners.map((c) => `${c.x},${c.y}`).join(' ')} className="sel-box" />
        {!allLocked && g?.kind !== 'move' ? (
          <>
            <line x1={hp.n.x} y1={hp.n.y} x2={rot.x} y2={rot.y} className="rot-stem" />
            <circle cx={rot.x} cy={rot.y} r={5.5} className="handle rot" data-handle="rotate" onPointerDown={(e) => startHandle(e, 'rotate')} />
            {HANDLES.filter((hd) => !tiny || hd.length === 2).map((hd) => (
              <rect
                key={hd}
                data-handle={hd}
                x={hp[hd].x - 4.5}
                y={hp[hd].y - 4.5}
                width={9}
                height={9}
                rx={hd.length === 1 ? 4.5 : 1.5}
                className={`handle ${hd.length === 1 ? 'side' : 'corner'}`}
                style={{ cursor: handleCursor(hd, angle) }}
                transform={`rotate(${angle} ${hp[hd].x} ${hp[hd].y})`}
                onPointerDown={(e) => startHandle(e, hd)}
              />
            ))}
          </>
        ) : null}
        {label ? (
          <g transform={`translate(${(corners[2].x + corners[3].x) / 2} ${Math.max(corners[2].y, corners[3].y, corners[0].y, corners[1].y) + 16})`}>
            <rect x={-label.length * 3.6 - 8} y={-10} width={label.length * 7.2 + 16} height={20} rx={4} className="dim-bg" />
            <text textAnchor="middle" y={4} className="dim-text">
              {label}
            </text>
          </g>
        ) : null}
      </g>
    );
  }

  const hoverUi = (() => {
    if (!model || !hoverId || selection.includes(hoverId) || g) return null;
    const l = model.layers.get(hoverId);
    if (!l) return null;
    const c = boxCorners(model.world.get(hoverId)!, l.transform.width, l.transform.height).map(toScreen);
    return <polygon points={c.map((p) => `${p.x},${p.y}`).join(' ')} className="hover-box" />;
  })();

  const outlinesUi =
    overlays.outlines && model ? (
      <g className="outlines">
        {[...model.layers.values()].map((l) => {
          if (model.hidden.has(l.id)) return null;
          const c = boxCorners(model.world.get(l.id)!, l.transform.width, l.transform.height).map(toScreen);
          return <polygon key={l.id} points={c.map((p) => `${p.x},${p.y}`).join(' ')} />;
        })}
      </g>
    ) : null;

  const scopeUi = (() => {
    if (!model || !scopeId || !model.layers.has(scopeId)) return null;
    const l = model.layers.get(scopeId)!;
    const c = boxCorners(model.world.get(scopeId)!, l.transform.width, l.transform.height).map(toScreen);
    return <polygon points={c.map((p) => `${p.x},${p.y}`).join(' ')} className="scope-box" />;
  })();

  const marquee = g?.kind === 'marquee' ? normRect(toScreen(g.start), toScreen(g.current)) : null;

  // guides
  const W = size.width;
  const H = size.height;
  const guideLines = overlays.guides
    ? guideList.map((gd, i) => {
        const moving = g?.kind === 'guide' && g.index === i;
        const pos = moving ? (g as any).position : gd.position;
        const sc = gd.axis === 'x' ? pos * zoom + view.panX : pos * zoom + view.panY;
        return gd.axis === 'x' ? (
          <g key={`g${i}`} className={`guide ${moving && (g as any).overRuler ? 'removing' : ''}`}>
            <line x1={sc} y1={0} x2={sc} y2={H} />
            <line x1={sc} y1={0} x2={sc} y2={H} className="guide-hit" style={{ cursor: 'ew-resize' }} onPointerDown={(e) => startGuide(e, 'x', i)} />
          </g>
        ) : (
          <g key={`g${i}`} className={`guide ${moving && (g as any).overRuler ? 'removing' : ''}`}>
            <line x1={0} y1={sc} x2={W} y2={sc} />
            <line x1={0} y1={sc} x2={W} y2={sc} className="guide-hit" style={{ cursor: 'ns-resize' }} onPointerDown={(e) => startGuide(e, 'y', i)} />
          </g>
        );
      })
    : null;
  const newGuide =
    g?.kind === 'guide' && g.index < 0 && !g.overRuler ? (
      g.axis === 'x' ? (
        <line className="guide new" x1={g.position * zoom + view.panX} y1={0} x2={g.position * zoom + view.panX} y2={H} />
      ) : (
        <line className="guide new" x1={0} y1={g.position * zoom + view.panY} x2={W} y2={g.position * zoom + view.panY} />
      )
    ) : null;

  const smartUi = smart.current.map((sg, i) =>
    sg.axis === 'x' ? (
      <line key={i} className={`smart ${sg.source}`} x1={sg.value * zoom + view.panX} y1={Math.max(-10, sg.from * zoom + view.panY)} x2={sg.value * zoom + view.panX} y2={Math.min(H + 10, sg.to * zoom + view.panY)} />
    ) : (
      <line key={i} className={`smart ${sg.source}`} x1={Math.max(-10, sg.from * zoom + view.panX)} y1={sg.value * zoom + view.panY} x2={Math.min(W + 10, sg.to * zoom + view.panX)} y2={sg.value * zoom + view.panY} />
    ),
  );

  const pixelGrid =
    overlays.pixelGrid && ab && zoom >= 8 ? (
      <>
        <defs>
          <pattern id="pxgrid" width={zoom} height={zoom} patternUnits="userSpaceOnUse" x={view.panX} y={view.panY}>
            <path d={`M ${zoom} 0 L 0 0 0 ${zoom}`} fill="none" className="pxgrid-line" />
          </pattern>
        </defs>
        <rect x={view.panX} y={view.panY} width={ab.width * zoom} height={ab.height * zoom} fill="url(#pxgrid)" pointerEvents="none" />
      </>
    ) : null;

  const editingLayer = editing && model ? (model.layers.get(editing) as TextLayer | undefined) : undefined;

  const cursor = panning || tool === 'hand' ? (g?.kind === 'pan' ? 'grabbing' : 'grab') : 'default';

  return (
    <div className={`canvas-area ${overlays.rulers ? 'with-rulers' : ''}`}>
      {overlays.rulers ? <Rulers onStartGuide={(e, axis) => startGuide(e, axis, -1)} preview={pv} /> : null}
      <div
        ref={vpRef}
        className={`viewport ${dropHint ? 'drop-hint' : ''}`}
        tabIndex={0}
        data-testid="viewport"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          if (!gesture.current) studio.set({ cursor: null, hoverId: null });
        }}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        onDragOver={(e) => {
          e.preventDefault();
          setDropHint(true);
        }}
        onDragLeave={() => setDropHint(false)}
        onDrop={onDrop}
      >
        <div className="world" style={{ transform: `translate(${view.panX}px, ${view.panY}px) scale(${zoom})` }}>
          {ab ? (
            <div className={`artboard ${ab.background ? '' : 'transparent'}`} style={{ width: ab.width, height: ab.height }}>
              <div ref={hostRef} className="artboard-host" data-testid="artboard" />
            </div>
          ) : (
            <div ref={hostRef} className="artboard-host" />
          )}
        </div>
        {ab ? (
          <div className="artboard-title" style={{ left: view.panX, top: view.panY - 22 }}>
            {ab.name ?? ab.id} <span>{ab.width} × {ab.height}</span>
          </div>
        ) : null}
        <svg className="overlay" width={W} height={H}>
          {pixelGrid}
          {ab ? <SceneOverlay artboard={ab} view={view} overlays={overlays} /> : null}
          {outlinesUi}
          {scopeUi}
          {guideLines}
          {newGuide}
          {hoverUi}
          {smartUi}
          {selectionUi}
          {marquee ? <rect className="marquee" x={marquee.x} y={marquee.y} width={marquee.width} height={marquee.height} /> : null}
        </svg>
        {editingLayer && model ? <InlineTextEditor layer={editingLayer} world={model.world.get(editingLayer.id)!} view={view} onDone={() => setEditing(null)} /> : null}
        {render.status === 'error' ? (
          <div className="canvas-error">
            <strong>Render error</strong>
            <pre>{render.error}</pre>
          </div>
        ) : null}
        {!ab && mode ? <div className="canvas-loading">Compiling…</div> : null}
        {menu ? <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} /> : null}
        {artboards ? (
          <div className="artboard-tabs" onPointerDown={(e) => e.stopPropagation()}>
            {artboards.split('\u0001').map((x) => {
              const [id, name] = x.split('\u0000');
              return (
                <button key={id} type="button" className={id === artboardId ? 'active' : ''} onClick={() => selectArtboard(id)}>
                  {name}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function normRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

export function isTyping(e: KeyboardEvent | React.KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
}

function InlineTextEditor({ layer, world, view, onDone }: { layer: TextLayer; world: Matrix; view: { zoom: number; panX: number; panY: number }; onDone: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(layer.content);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const m = multiply([view.zoom, 0, 0, view.zoom, view.panX, view.panY], world);
  const st = layer.style;
  return (
    <textarea
      ref={ref}
      className="inline-text"
      value={text}
      spellCheck={false}
      style={{
        width: Math.max(40, layer.transform.width),
        height: Math.max(st.fontSize * st.lineHeight, layer.transform.height),
        transform: `matrix(${m.join(',')})`,
        fontSize: st.fontSize,
        lineHeight: st.lineHeight,
        letterSpacing: st.letterSpacing,
        textAlign: st.textAlign === 'justify' ? 'justify' : st.textAlign,
        fontWeight: st.fontWeight,
        fontStyle: st.fontStyle,
        textTransform: st.textTransform,
        fontFamily: `'${st.fontFamily.split(',')[0].replace(/['"]/g, '')}', 'Inter UI', sans-serif`,
      }}
      onChange={(e) => {
        setText(e.target.value);
        editLayer(layer.id, { content: e.target.value }, `content:${layer.id}`);
      }}
      onBlur={onDone}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) onDone();
      }}
    />
  );
}

// re-export for tests / other modules
export { findLayerIn };
