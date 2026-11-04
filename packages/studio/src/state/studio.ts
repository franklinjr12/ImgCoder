/**
 * Studio controller: app state, document modes (code compositions vs. designs), edit routing,
 * undo/redo, persistence and the render scheduler. UI components read state via `useStudio()`
 * and call the exported actions.
 */
import {
  applyOverrides,
  compileComposition,
  computeWorldMatrices,
  deserializeDocument,
  describeComposition,
  diffProps,
  findLayer,
  getPath,
  isContainer,
  isVariableProp,
  layoutTextLayer,
  renderArtboardToSvg,
  resolveProps,
  serializeDocument,
  walkLayers,
  type Artboard,
  type ArtisanDocument,
  type CompositionDefinition,
  type Guide,
  type Layer,
  type LayerOverrides,
  type Matrix,
} from '@game-artisan/core';
import { createStore, useSelector } from './store';
import { History } from '../editor/history';
import { applyCompositionEdit, routePatch, clearOverride, type FlatPatch } from '../editor/routing';
import {
  allLayerIds,
  deleteLayers,
  duplicateLayers,
  findParent,
  getLayer,
  groupLayers,
  insertLayers,
  mapLayer,
  moveLayers,
  patchLayer,
  reorderLayers,
  setClippingMask,
  topLevelSelection,
  ungroupLayers,
  cloneWithNewIds,
  type ZOrderOp,
} from '../editor/tree-ops';
import { addArtboard, designProps, detachToDocument, documentFileName, exposeField, newDesign, replaceArtboard, resolveDesignArtboard, setDesignProps, unexposeField, type StorePresetLike } from '../editor/documents';
import { fonts, initFonts, ensureFontsForText, onFontsChanged } from '../runtime/fonts';
import { displayAssets, exportAssets, invalidateProjectAssets } from '../runtime/assets';
import { loadSources, onSourcesChanged, type CompositionEntry, type Sources } from '../runtime/project';
import { idbAll, idbDelete, idbGet, idbPut, local } from '../runtime/idb';
import { setThumbRasterizer, onThumb } from '../runtime/thumbs';

export type Mode = 'composition' | 'design';

export interface CompState {
  /** Props input (merged over schema defaults by resolveProps). */
  props: Record<string, unknown>;
  overrides: LayerOverrides;
  guides: Guide[];
}

export interface DesignRecord {
  id: string;
  name: string;
  updatedAt: number;
  json: string;
  width: number;
  height: number;
  thumb?: string;
}

export interface DesignListEntry {
  id: string;
  name: string;
  updatedAt: number;
  width: number;
  height: number;
  thumb?: string;
  source: 'local' | 'project';
  file?: string;
}

export interface Overlays {
  safeZones: boolean;
  steamUi: boolean;
  guides: boolean;
  pixelGrid: boolean;
  rulers: boolean;
  snapping: boolean;
  pixelSnap: boolean;
  outlines: boolean;
}

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'success' | 'warning' | 'error';
}

export type Dialog =
  | { kind: 'new-design' }
  | { kind: 'code'; title: string; code: string; filename?: string; language?: string }
  | { kind: 'add-artboard' }
  | { kind: 'shortcuts' }
  | null;

export interface RenderInfo {
  svg: string;
  /** artboard the SVG was rendered from */
  artboard: Artboard | null;
  status: 'idle' | 'rendering' | 'error';
  error?: string;
  warnings: string[];
  ms: number;
  nonce: number;
}

export interface StudioState {
  ready: boolean;
  bootError?: string;
  sources: Sources | null;
  sourcesVersion: number;
  mode: Mode | null;
  compositionId: string | null;
  comp: Record<string, CompState>;
  doc: ArtisanDocument | null;
  docSource: { kind: 'local' } | { kind: 'project'; file: string };
  docDirty: boolean;
  artboardId: string | null;
  designs: DesignListEntry[];
  /** current resolved artboard (sync; may be ahead of the rendered SVG) */
  live: Artboard | null;
  selection: string[];
  hoverId: string | null;
  /** container the user "entered" (double-click) — clicks select its children */
  scopeId: string | null;
  view: { zoom: number; panX: number; panY: number };
  viewportSize: { width: number; height: number };
  overlays: Overlays;
  tool: 'select' | 'hand';
  render: RenderInfo;
  toasts: Toast[];
  dialog: Dialog;
  leftTab: 'templates' | 'designs' | 'assets';
  rightTab: 'props' | 'layer' | 'document';
  assetsVersion: number;
  fontsVersion: number;
  thumbsVersion: number;
  historyVersion: number;
  cursor: { x: number; y: number } | null;
  locale: string;
}

const DEFAULT_OVERLAYS: Overlays = { safeZones: true, steamUi: false, guides: true, pixelGrid: true, rulers: true, snapping: true, pixelSnap: true, outlines: false };

export const studio = createStore<StudioState>({
  ready: false,
  sources: null,
  sourcesVersion: 0,
  mode: null,
  compositionId: null,
  comp: {},
  doc: null,
  docSource: { kind: 'local' },
  docDirty: false,
  artboardId: null,
  designs: [],
  live: null,
  selection: [],
  hoverId: null,
  scopeId: null,
  view: { zoom: 1, panX: 0, panY: 0 },
  viewportSize: { width: 800, height: 600 },
  overlays: { ...DEFAULT_OVERLAYS, ...local.get<Partial<Overlays>>('overlays', {}) },
  tool: 'select',
  render: { svg: '', artboard: null, status: 'idle', warnings: [], ms: 0, nonce: 0 },
  toasts: [],
  dialog: null,
  leftTab: local.get('leftTab', 'templates'),
  rightTab: 'props',
  assetsVersion: 0,
  fontsVersion: 0,
  thumbsVersion: 0,
  historyVersion: 0,
  cursor: null,
  locale: '',
});

export const useStudio = <T,>(sel: (s: StudioState) => T): T => useSelector(studio, sel);
const S = () => studio.get();

// ---------------------------------------------------------------------------------------
// Toasts

let toastId = 0;
export function toast(message: string, kind: Toast['kind'] = 'info', ms = 3200): void {
  const t = { id: ++toastId, message, kind };
  studio.set((s) => ({ toasts: [...s.toasts.slice(-3), t] }));
  setTimeout(() => studio.set((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) })), ms);
}

// ---------------------------------------------------------------------------------------
// Composition helpers

export function currentEntry(s = S()): CompositionEntry | null {
  if (!s.compositionId || !s.sources) return null;
  return s.sources.compositions.find((c) => c.def.id === s.compositionId) ?? null;
}

export function currentDef(s = S()): CompositionDefinition | null {
  return currentEntry(s)?.def ?? null;
}

export function compState(id: string, s = S()): CompState {
  return s.comp[id] ?? { props: {}, overrides: {}, guides: [] };
}

const resolvedCache = new WeakMap<object, Map<CompositionDefinition, { ok: boolean; value: Record<string, unknown>; error?: string }>>();

/** Resolved (defaults-merged, validated) props of a composition. Never throws. */
export function resolvedPropsOf(def: CompositionDefinition, input: Record<string, unknown>): { ok: boolean; value: Record<string, unknown>; error?: string } {
  let m = resolvedCache.get(input);
  if (!m) resolvedCache.set(input, (m = new Map()));
  let r = m.get(def);
  if (!r) {
    try {
      r = { ok: true, value: resolveProps(def, input) as Record<string, unknown> };
    } catch (e) {
      r = { ok: false, value: { ...(describeComposition(def).defaultProps ?? {}), ...input }, error: (e as Error).message };
    }
    m.set(def, r);
  }
  return r;
}

const EMPTY: Record<string, unknown> = {};

/** Props currently driving the canvas (composition: resolved props; design: doc defaults). */
export function currentProps(s = S()): Record<string, unknown> {
  if (s.mode === 'composition') {
    const def = currentDef(s);
    if (!def) return EMPTY;
    return resolvedPropsOf(def, compState(def.id, s).props).value;
  }
  if (s.mode === 'design' && s.doc) return designProps(s.doc);
  return EMPTY;
}

/** Prop paths deviating from programmatic defaults (+ override count) for the warning indicator. */
export function deviation(s = S()): { props: string[]; overrides: number } {
  if (s.mode !== 'composition') return { props: [], overrides: 0 };
  const def = currentDef(s);
  if (!def) return { props: [], overrides: 0 };
  const st = compState(def.id, s);
  const base = resolvedPropsOf(def, EMPTY).value;
  const cur = resolvedPropsOf(def, st.props).value;
  return { props: diffProps(base, cur), overrides: Object.keys(st.overrides).length };
}

export function currentArtboardRaw(s = S()): Artboard | null {
  if (s.mode !== 'design' || !s.doc) return null;
  return s.doc.artboards.find((a) => a.id === s.artboardId) ?? s.doc.artboards[0] ?? null;
}

export function guides(s = S()): Guide[] {
  if (s.mode === 'design') return currentArtboardRaw(s)?.guides ?? [];
  if (s.mode === 'composition' && s.compositionId) return compState(s.compositionId, s).guides;
  return [];
}

// ---------------------------------------------------------------------------------------
// Live artboard + render scheduler

let baseCache: { key: string; artboard: Artboard; props: Record<string, unknown> } | null = null;
let compileError: string | undefined;

function baseKey(s: StudioState): string {
  const def = currentDef(s);
  if (!def) return '';
  return JSON.stringify([def.id, s.sourcesVersion, fonts.revision, s.locale, compState(def.id, s).props]);
}

/** Recompute the sync live artboard (design: resolve vars; composition: overrides on cached base). */
function refreshLive(): void {
  const s = S();
  let live: Artboard | null = null;
  if (s.mode === 'design' && s.doc && s.artboardId) live = resolveDesignArtboard(s.doc, s.artboardId);
  else if (s.mode === 'composition' && baseCache && baseCache.key.startsWith(JSON.stringify([s.compositionId]).slice(0, -1))) {
    const def = currentDef(s);
    if (def) live = applyOverrides(baseCache.artboard, compState(def.id, s).overrides);
  }
  if (live) studio.set({ live });
}

let renderQueued = false;
let rendering = false;
let renderAgain = false;

export function scheduleRender(): void {
  refreshLive();
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    void renderNow();
  });
}

function collectText(ab: Artboard): string {
  let t = '';
  walkLayers(ab, ({ layer }) => {
    if (layer.type === 'text') t += layer.content;
  });
  return t;
}

async function renderNow(): Promise<void> {
  if (rendering) {
    renderAgain = true;
    return;
  }
  rendering = true;
  try {
    do {
      renderAgain = false;
      const s = S();
      const t0 = performance.now();
      studio.set((st) => ({ render: { ...st.render, status: 'rendering' } }));
      try {
        let artboard: Artboard | null = null;
        if (s.mode === 'composition') {
          const def = currentDef(s);
          if (!def) continue;
          if (def.kind === 'html') throw new Error(`"${def.id}" is an HTML composition (Chromium renderer) — not editable on the vector canvas.`);
          const key = baseKey(s);
          if (!baseCache || baseCache.key !== key) {
            const input = compState(def.id, s).props;
            const { artboard: ab, props } = await compileComposition(def, { fonts, assets: displayAssets, props: input, locale: s.locale || undefined, surface: 'studio' });
            compileError = undefined;
            baseCache = { key, artboard: ab, props };
            const extra = collectText(ab);
            if (await ensureFontsForText(extra)) {
              renderAgain = true;
              continue;
            }
          }
          if (renderAgain) continue;
          artboard = applyOverrides(baseCache.artboard, compState(def.id, S()).overrides);
        } else if (s.mode === 'design' && s.doc) {
          artboard = resolveDesignArtboard(s.doc, s.artboardId ?? s.doc.artboards[0].id);
          if (await ensureFontsForText(collectText(artboard))) {
            renderAgain = true;
            continue;
          }
        }
        if (!artboard) continue;
        const r = await renderArtboardToSvg(artboard, { fonts, assets: displayAssets, idPrefix: 'ga', annotate: true, onMissingAsset: 'placeholder', locale: s.locale || artboard.locale });
        if (renderAgain) continue;
        studio.set((st) => ({
          live: artboard,
          render: { svg: r.svg, artboard, status: 'idle', warnings: r.warnings, ms: Math.round(performance.now() - t0), nonce: st.render.nonce + 1 },
        }));
      } catch (e) {
        compileError = (e as Error).message;
        console.error('[studio] render failed', e);
        studio.set((st) => ({ render: { ...st.render, status: 'error', error: compileError, ms: Math.round(performance.now() - t0) } }));
      }
    } while (renderAgain);
  } finally {
    rendering = false;
  }
}

/** Force the canvas to re-apply the last SVG (discarding transient DOM previews). */
export function resetCanvasDom(): void {
  studio.set((s) => ({ render: { ...s.render, nonce: s.render.nonce + 1 } }));
}

// ---------------------------------------------------------------------------------------
// History

type Snapshot = { kind: 'comp'; id: string; state: CompState } | { kind: 'doc'; doc: ArtisanDocument; artboardId: string | null };
const histories = new Map<string, History<Snapshot>>();

function historyKey(s = S()): string | null {
  if (s.mode === 'composition' && s.compositionId) return `comp:${s.compositionId}`;
  if (s.mode === 'design' && s.doc) return `doc:${s.doc.id}`;
  return null;
}

function snapshot(s = S()): Snapshot | null {
  if (s.mode === 'composition' && s.compositionId) return { kind: 'comp', id: s.compositionId, state: compState(s.compositionId, s) };
  if (s.mode === 'design' && s.doc) return { kind: 'doc', doc: s.doc, artboardId: s.artboardId };
  return null;
}

function history(): History<Snapshot> | null {
  const key = historyKey();
  if (!key) return null;
  let h = histories.get(key);
  if (!h) {
    h = new History<Snapshot>(snapshot()!);
    histories.set(key, h);
  }
  return h;
}

function record(label?: string, coalesce?: string): void {
  const h = history();
  const snap = snapshot();
  if (!h || !snap) return;
  if (h.push(snap, { label, coalesce })) studio.set((s) => ({ historyVersion: s.historyVersion + 1 }));
}

function restore(snap: Snapshot): void {
  if (snap.kind === 'comp') {
    studio.set((s) => ({ comp: { ...s.comp, [snap.id]: snap.state } }));
    persistComp(snap.id);
  } else {
    const ab = snap.doc.artboards.some((a) => a.id === S().artboardId) ? S().artboardId : snap.artboardId;
    studio.set({ doc: snap.doc, artboardId: ab ?? snap.doc.artboards[0].id, docDirty: true });
    queueSaveDesign();
  }
  scheduleRender(); // refreshes the live artboard synchronously
  studio.set((s) => ({ selection: s.live ? s.selection.filter((id) => !!findLayerIn(id, s)) : [], historyVersion: s.historyVersion + 1 }));
}

export function undo(): void {
  const h = history();
  const snap = h?.undo();
  if (snap) restore(snap);
  else toast('Nothing to undo');
}

export function redo(): void {
  const h = history();
  const snap = h?.redo();
  if (snap) restore(snap);
  else toast('Nothing to redo');
}

export function historyState(): { canUndo: boolean; canRedo: boolean } {
  const key = historyKey();
  const h = key ? histories.get(key) : null;
  return { canUndo: !!h?.canUndo, canRedo: !!h?.canRedo };
}

// ---------------------------------------------------------------------------------------
// Persistence

const compTimers = new Map<string, ReturnType<typeof setTimeout>>();
function persistComp(id: string): void {
  clearTimeout(compTimers.get(id));
  compTimers.set(
    id,
    setTimeout(() => local.set(`comp:${id}`, S().comp[id] ?? null), 300),
  );
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function queueSaveDesign(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void saveDesignLocal(), 600);
}

async function saveDesignLocal(): Promise<void> {
  const s = S();
  if (!s.doc || s.docSource.kind !== 'local') return;
  const ab = s.doc.artboards[0];
  const prev = await idbGet<DesignRecord>('documents', s.doc.id);
  const rec: DesignRecord = { id: s.doc.id, name: s.doc.name, updatedAt: Date.now(), json: serializeDocument(s.doc), width: ab.width, height: ab.height, thumb: prev?.thumb };
  await idbPut('documents', rec.id, rec);
  studio.set({ docDirty: false });
  void refreshDesignList();
  scheduleThumb();
}

let thumbTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleThumb(): void {
  if (thumbTimer) clearTimeout(thumbTimer);
  thumbTimer = setTimeout(async () => {
    const s = S();
    if (!s.doc || s.docSource.kind !== 'local') return;
    try {
      const ab = resolveDesignArtboard(s.doc, s.doc.artboards[0].id);
      const scale = Math.min(1, 240 / ab.width, 160 / ab.height);
      const png = await artboardToPng(ab, scale, 'image/jpeg');
      const rec = await idbGet<DesignRecord>('documents', s.doc.id);
      if (rec) {
        await idbPut('documents', rec.id, { ...rec, thumb: png });
        void refreshDesignList();
      }
    } catch (e) {
      console.warn('[studio] thumbnail failed', e);
    }
  }, 1500);
}

export async function refreshDesignList(): Promise<void> {
  const locals = await idbAll<DesignRecord>('documents');
  const list: DesignListEntry[] = locals.map((r) => ({ id: r.id, name: r.name, updatedAt: r.updatedAt, width: r.width, height: r.height, thumb: r.thumb, source: 'local' }));
  if (S().sources?.info.documentsDir) {
    try {
      const res = await fetch('/__artisan/documents', { cache: 'no-store' });
      const j = await res.json();
      for (const d of j.documents ?? []) list.push({ id: d.id ?? d.file, name: d.name, updatedAt: d.mtime, width: 0, height: 0, source: 'project', file: d.file });
    } catch {
      /* ignore */
    }
  }
  list.sort((a, b) => b.updatedAt - a.updatedAt);
  studio.set({ designs: list });
}

// ---------------------------------------------------------------------------------------
// Boot

export async function boot(): Promise<void> {
  try {
    const [, sources] = await Promise.all([initFonts(), loadSources()]);
    const comp: Record<string, CompState> = {};
    for (const c of sources.compositions) {
      const saved = local.get<CompState | null>(`comp:${c.def.id}`, null);
      if (saved) comp[c.def.id] = { props: saved.props ?? {}, overrides: saved.overrides ?? {}, guides: saved.guides ?? [] };
    }
    studio.set({ sources, comp, ready: true, rightTab: 'props' });
    if (sources.error) toast(sources.error, 'error', 8000);
    onSourcesChanged((next) => {
      // HMR: compositions re-registered — keep props/overrides (keyed by id), recompile
      baseCache = null;
      studio.set((s) => ({ sources: next, sourcesVersion: s.sourcesVersion + 1 }));
      if (next.error) toast(next.error, 'error', 8000);
      else toast('Compositions reloaded (HMR)', 'success', 1600);
      if (S().mode === 'composition') {
        if (!currentEntry()) {
          const first = next.compositions[0];
          if (first) openComposition(first.def.id);
        } else scheduleRender();
      }
    });
    setThumbRasterizer(artboardToPng);
    onThumb(() => studio.set((s) => ({ thumbsVersion: s.thumbsVersion + 1 })));
    onFontsChanged(() => {
      baseCache = null;
      studio.set((s) => ({ fontsVersion: s.fontsVersion + 1 }));
      scheduleRender();
    });
    if (import.meta.hot) {
      import.meta.hot.on('artisan:assets-changed', (data: { paths: string[] }) => {
        invalidateProjectAssets(data?.paths ?? []);
        baseCache = null;
        studio.set((s) => ({ assetsVersion: s.assetsVersion + 1 }));
        scheduleRender();
        toast(`Assets updated on disk: ${(data?.paths ?? []).slice(0, 2).join(', ')}${(data?.paths?.length ?? 0) > 2 ? '…' : ''}`, 'info', 2000);
      });
      import.meta.hot.on('artisan:documents-changed', (data: { file?: string }) => {
        void refreshDesignList();
        const s = S();
        // external edit of the open project document → reload it (unless we just saved it / have local edits)
        if (s.mode === 'design' && s.docSource.kind === 'project' && s.docSource.file === data?.file && !s.docDirty && Date.now() - lastProjectSave > 2500) {
          void openProjectDocument(data.file!).then(() => toast(`${data.file} changed on disk — reloaded`, 'info', 2200));
        }
      });
    }
    await refreshDesignList();
    // restore last session
    const last = local.get<{ mode: Mode; id: string } | null>('last', null);
    const urlComp = new URLSearchParams(location.search).get('composition');
    if (urlComp && sources.compositions.some((c) => c.def.id === urlComp)) openComposition(urlComp);
    else if (last?.mode === 'design' && (await idbGet('documents', last.id))) await openDesign(last.id);
    else if (last?.mode === 'composition' && sources.compositions.some((c) => c.def.id === last.id)) openComposition(last.id);
    else if (sources.compositions.length) openComposition(sources.compositions[0].def.id);
    else newDesignFromSize(1200, 675, 'Untitled design');
  } catch (e) {
    console.error(e);
    studio.set({ bootError: (e as Error).stack ?? String(e) });
  }
}

// ---------------------------------------------------------------------------------------
// Mode switching

export function openComposition(id: string): void {
  const s = S();
  if (s.mode === 'design') void flushDesign();
  baseCache = null;
  studio.set({ mode: 'composition', compositionId: id, doc: null, artboardId: null, selection: [], scopeId: null, live: null, rightTab: s.rightTab === 'document' ? 'props' : s.rightTab, render: { ...s.render, svg: '', artboard: null } });
  local.set('last', { mode: 'composition', id });
  history();
  pendingFit = true;
  scheduleRender();
}

async function flushDesign(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    await saveDesignLocal();
  }
}

function enterDesign(doc: ArtisanDocument, source: StudioState['docSource']): void {
  baseCache = null;
  studio.set((s) => ({
    mode: 'design',
    doc,
    docSource: source,
    docDirty: false,
    artboardId: doc.artboards[0].id,
    compositionId: null,
    selection: [],
    scopeId: null,
    rightTab: s.rightTab === 'props' && !doc.props ? 'layer' : s.rightTab,
    render: { ...s.render, svg: '', artboard: null },
  }));
  if (source.kind === 'local') local.set('last', { mode: 'design', id: doc.id });
  history();
  pendingFit = true;
  scheduleRender();
}

export async function openDesign(id: string): Promise<void> {
  await flushDesign();
  const rec = await idbGet<DesignRecord>('documents', id);
  if (!rec) return toast('Design not found', 'error');
  try {
    enterDesign(deserializeDocument(rec.json), { kind: 'local' });
  } catch (e) {
    toast(`Cannot open design: ${(e as Error).message}`, 'error', 6000);
  }
}

export async function openProjectDocument(file: string): Promise<void> {
  await flushDesign();
  try {
    const res = await fetch(`/__artisan/documents/${encodeURIComponent(file)}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    enterDesign(deserializeDocument(await res.text()), { kind: 'project', file });
  } catch (e) {
    toast(`Cannot open ${file}: ${(e as Error).message}`, 'error', 6000);
  }
}

let lastProjectSave = 0;

export async function saveToProject(): Promise<void> {
  lastProjectSave = Date.now();
  const s = S();
  if (!s.doc) return;
  if (!s.sources?.info.documentsDir) return toast('No project documents directory (start the Studio with a project).', 'warning');
  const file = s.docSource.kind === 'project' ? s.docSource.file : documentFileName(s.doc);
  const res = await fetch(`/__artisan/documents/${encodeURIComponent(file)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: serializeDocument(s.doc) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) return toast(`Save failed: ${j.error ?? res.status}`, 'error');
  studio.set({ docSource: { kind: 'project', file: j.file ?? file }, docDirty: false });
  toast(`Saved ${j.path ?? file}`, 'success');
  void refreshDesignList();
}

export async function deleteDesign(id: string): Promise<void> {
  await idbDelete('documents', id);
  if (S().doc?.id === id && S().docSource.kind === 'local') {
    const first = S().sources?.compositions[0];
    if (first) openComposition(first.def.id);
  }
  void refreshDesignList();
}

export function newDesignFromSize(width: number, height: number, name?: string, preset?: StorePresetLike): void {
  const zones = preset && S().sources ? S().sources!.presetSafeZones(preset) : undefined;
  const doc = newDesign({ width, height, name, preset, safeZones: zones });
  enterDesign(doc, { kind: 'local' });
  queueSaveDesign();
}

export function importDocument(json: string): void {
  try {
    const doc = deserializeDocument(json);
    if (S().designs.some((d) => d.id === doc.id && d.source === 'local')) (doc as any).id = `${doc.id}-${Date.now().toString(36)}`;
    enterDesign(doc, { kind: 'local' });
    queueSaveDesign();
    toast(`Opened “${doc.name}”`, 'success');
  } catch (e) {
    toast(`Invalid .artisan.json: ${(e as Error).message}`, 'error', 7000);
  }
}

/** "Detach to design": compiled composition → editable UDM document. */
export function detachCurrent(): void {
  const s = S();
  const def = currentDef(s);
  if (!def || !s.live) return;
  const info = describeComposition(def);
  const doc = detachToDocument(s.live, { name: `${info.name} (design)`, props: currentProps(s), propsSchema: info.propsSchema, description: `Detached from composition “${def.id}”` });
  enterDesign(doc, { kind: 'local' });
  queueSaveDesign();
  toast('Detached to an editable design — full structural editing enabled', 'success');
}

export function renameDocument(name: string): void {
  updateDoc((d) => ({ ...d, name }), 'Rename document');
}

export function selectArtboard(id: string): void {
  studio.set({ artboardId: id, selection: [], scopeId: null });
  pendingFit = true;
  scheduleRender();
}

export function addArtboardToDoc(width: number, height: number, preset?: StorePresetLike): void {
  const s = S();
  if (!s.doc) return;
  const zones = preset && s.sources ? s.sources.presetSafeZones(preset) : undefined;
  const r = addArtboard(s.doc, { width, height, preset, safeZones: zones });
  setDoc(r.doc, 'Add artboard');
  selectArtboard(r.artboardId);
}

export function deleteArtboard(id: string): void {
  const s = S();
  if (!s.doc || s.doc.artboards.length < 2) return toast('A design needs at least one artboard', 'warning');
  const doc = { ...s.doc, artboards: s.doc.artboards.filter((a) => a.id !== id) };
  setDoc(doc, 'Delete artboard');
  if (s.artboardId === id) selectArtboard(doc.artboards[0].id);
}

// ---------------------------------------------------------------------------------------
// Edits

/**
 * Keep auto-sized text boxes (sizing: auto-height / auto-width) in sync with their layout so the
 * gizmo, snapping and exports see the real box.
 */
function autosizeText(doc: ArtisanDocument, artboardId: string | null): ArtisanDocument {
  const raw = doc.artboards.find((a) => a.id === artboardId) ?? doc.artboards[0];
  let resolved: Artboard | null = null;
  let ab = raw;
  walkLayers(raw, ({ layer }) => {
    if (layer.type !== 'text' || layer.sizing === 'fixed' || !layer.sizing) return;
    resolved ??= resolveDesignArtboard(doc, raw.id);
    const r = findLayer(resolved, layer.id)?.layer;
    if (!r || r.type !== 'text') return;
    let lay;
    try {
      lay = layoutTextLayer(r, fonts, S().locale || resolved.locale);
    } catch {
      return;
    }
    const t: any = layer.transform;
    const h = Math.ceil(lay.height * 100) / 100;
    const w = Math.ceil(lay.width * 100) / 100;
    const patch: Record<string, number> = {};
    if (!isVariableProp(t.height) && Math.abs(t.height - h) > 0.5) patch.height = h;
    if (layer.sizing === 'auto-width' && !isVariableProp(t.width) && Math.abs(t.width - w) > 0.5) patch.width = w;
    if (Object.keys(patch).length) ab = mapLayer(ab, layer.id, (l) => ({ ...l, transform: { ...l.transform, ...patch } }) as Layer);
  });
  return ab === raw ? doc : replaceArtboard(doc, ab);
}

function setDoc(doc: ArtisanDocument, label?: string, coalesce?: string): void {
  doc = autosizeText(doc, S().artboardId);
  studio.set({ doc, docDirty: true });
  record(label, coalesce);
  queueSaveDesign();
  scheduleRender();
}

export function updateDoc(fn: (d: ArtisanDocument) => ArtisanDocument, label?: string, coalesce?: string): void {
  const s = S();
  if (!s.doc) return;
  setDoc(fn(s.doc), label, coalesce);
}

function updateArtboard(fn: (ab: Artboard) => Artboard, label?: string, coalesce?: string): void {
  const ab = currentArtboardRaw();
  const s = S();
  if (!ab || !s.doc) return;
  setDoc(replaceArtboard(s.doc, fn(ab)), label, coalesce);
}

function setComp(id: string, next: CompState, label?: string, coalesce?: string): void {
  studio.set((s) => ({ comp: { ...s.comp, [id]: next } }));
  persistComp(id);
  record(label, coalesce);
  scheduleRender();
}

/** Set composition/design props (inspector). */
export function setProps(next: Record<string, unknown>, coalesce?: string): void {
  const s = S();
  if (s.mode === 'composition' && s.compositionId) {
    setComp(s.compositionId, { ...compState(s.compositionId), props: next }, 'Edit props', coalesce);
  } else if (s.mode === 'design' && s.doc) {
    setDoc(setDesignProps(s.doc, next), 'Edit props', coalesce);
  }
}

export function setProp(path: string, value: unknown, coalesce = `prop:${path}`): void {
  const cur = S().mode === 'composition' ? { ...currentProps() } : { ...currentProps() };
  const parts = path.split('.');
  let o: any = cur;
  for (let i = 0; i < parts.length - 1; i++) {
    o[parts[i]] = Array.isArray(o[parts[i]]) ? [...o[parts[i]]] : { ...(o[parts[i]] ?? {}) };
    o = o[parts[i]];
  }
  if (value === undefined) delete o[parts[parts.length - 1]];
  else o[parts[parts.length - 1]] = value;
  setProps(cur, coalesce);
}

export function resetToDefaults(): void {
  const s = S();
  if (s.mode !== 'composition' || !s.compositionId) return;
  setComp(s.compositionId, { ...compState(s.compositionId), props: {}, overrides: {} }, 'Reset to defaults');
  toast('Props and overrides reset to template defaults', 'success');
}

export function resetLayerOverrides(layerId: string): void {
  const s = S();
  if (s.mode !== 'composition' || !s.compositionId) return;
  const st = compState(s.compositionId);
  setComp(s.compositionId, { ...st, overrides: clearOverride(st.overrides, layerId) }, 'Reset layer');
}

export function findLayerIn(id: string, s = S()): Layer | null {
  return s.live ? (findLayer(s.live, id)?.layer ?? null) : null;
}

/**
 * Apply flat field patches to layers. Composition mode: bound fields → props, rest → overrides.
 * Design mode: bound fields → doc prop defaults, rest → document layers.
 */
export function editLayers(patches: Record<string, FlatPatch>, opts: { label?: string; coalesce?: string } = {}): void {
  const s = S();
  const ids = Object.keys(patches).filter((id) => Object.keys(patches[id]).length);
  if (!ids.length || !s.live) return;
  if (s.mode === 'composition' && s.compositionId) {
    let st = compState(s.compositionId);
    let props = currentProps(s);
    let propsChanged = false;
    for (const id of ids) {
      const layer = findLayerIn(id, s);
      if (!layer) continue;
      const r = applyCompositionEdit(layer, patches[id], { props, overrides: st.overrides });
      if (r.changedProps.length) propsChanged = true;
      props = r.props;
      st = { ...st, overrides: r.overrides };
    }
    if (propsChanged) st = { ...st, props };
    setComp(s.compositionId, st, opts.label ?? 'Edit layer', opts.coalesce);
    return;
  }
  if (s.mode === 'design' && s.doc) {
    let doc = s.doc;
    let props = designProps(doc);
    let propsChanged = false;
    let ab = currentArtboardRaw(s)!;
    for (const id of ids) {
      const resolved = findLayerIn(id, s);
      if (!resolved) continue;
      const r = routePatch(resolved, patches[id], props);
      if (r.props) {
        props = r.props;
        propsChanged = true;
      }
      if (Object.keys(r.layerPatch).length) ab = mapLayer(ab, id, (l) => patchLayer(l, r.layerPatch));
    }
    doc = replaceArtboard(doc, ab);
    if (propsChanged) doc = setDesignProps(doc, props);
    setDoc(doc, opts.label ?? 'Edit layer', opts.coalesce);
  }
}

export function editLayer(id: string, patch: FlatPatch, coalesce?: string): void {
  editLayers({ [id]: patch }, { coalesce: coalesce ?? `layer:${id}:${Object.keys(patch).join(',')}` });
}

/** Design-only structural edit guard. */
function requireDesign(action: string): boolean {
  if (S().mode === 'design') return true;
  toast(`${action} needs an editable design — use “Detach to design” first`, 'warning', 4200);
  return false;
}

export function setSelection(ids: string[], scopeId?: string | null): void {
  studio.set((s) => ({ selection: ids, scopeId: scopeId === undefined ? s.scopeId : scopeId, rightTab: ids.length && s.rightTab !== 'layer' && s.mode === 'design' ? 'layer' : s.rightTab }));
}

export function selectAll(): void {
  const s = S();
  if (!s.live) return;
  const scope = s.scopeId ? (findLayerIn(s.scopeId) as any) : null;
  const list: Layer[] = scope && isContainer(scope) ? scope.children : s.live.children;
  setSelection(list.filter((l) => !l.locked && l.visible !== false).map((l) => l.id));
}

export function insertLayer(layer: Layer, opts: { select?: boolean } = {}): void {
  if (!requireDesign('Adding layers')) return;
  const s = S();
  // insert inside the entered group, else above the selection, else on top
  let at: { parentId: string | null; index?: number } = { parentId: null };
  if (s.selection.length) {
    const info = findParent(currentArtboardRaw()!, s.selection[s.selection.length - 1]);
    if (info) at = { parentId: info.parent?.id ?? null, index: info.index + 1 };
  } else if (s.scopeId) at = { parentId: s.scopeId };
  updateArtboard((ab) => insertLayers(ab, [layer], at), `Add ${layer.name ?? layer.type}`);
  if (opts.select !== false) setSelection([layer.id]);
}

export function deleteSelection(): void {
  const s = S();
  if (!s.selection.length) return;
  if (s.mode === 'composition') {
    editLayers(Object.fromEntries(s.selection.map((id) => [id, { visible: false }])), { label: 'Hide layers' });
    toast('Code-template layers are hidden via overrides (detach to design to delete)', 'info', 3500);
    setSelection([]);
    return;
  }
  updateArtboard((ab) => deleteLayers(ab, topLevelSelection(ab, s.selection)), 'Delete');
  setSelection([]);
}

export function duplicateSelection(): void {
  if (!requireDesign('Duplicate')) return;
  const s = S();
  if (!s.selection.length) return;
  const r = duplicateLayers(currentArtboardRaw()!, s.selection, { x: 16, y: 16 });
  updateArtboard(() => r.artboard, 'Duplicate');
  setSelection(r.ids);
}

export function groupSelection(): void {
  if (!requireDesign('Grouping')) return;
  const s = S();
  if (!s.selection.length) return;
  const r = groupLayers(currentArtboardRaw()!, s.selection, { resolved: s.live ?? undefined });
  if (!r) return;
  updateArtboard(() => r.artboard, 'Group');
  setSelection([r.groupId]);
}

export function ungroupSelection(): void {
  if (!requireDesign('Ungrouping')) return;
  const s = S();
  const groups = s.selection.filter((id) => findLayerIn(id)?.type === 'group');
  if (!groups.length) return toast('Select a group to ungroup');
  const r = ungroupLayers(currentArtboardRaw()!, groups, { resolved: s.live ?? undefined });
  updateArtboard(() => r.artboard, 'Ungroup');
  setSelection(r.ids, null);
}

export function reorderSelection(op: ZOrderOp): void {
  if (!requireDesign('Reordering')) return;
  const s = S();
  if (!s.selection.length) return;
  updateArtboard((ab) => reorderLayers(ab, s.selection, op), 'Reorder');
}

export function moveLayersTo(ids: string[], parentId: string | null, index: number): void {
  if (!requireDesign('Reordering layers')) return;
  const s = S();
  updateArtboard((ab) => moveLayers(ab, ids, { parentId, index }, s.live ?? undefined), 'Move layers');
}

export function toggleClippingMask(ids = S().selection): void {
  const s = S();
  if (!ids.length) return;
  const value = !ids.every((id) => findLayerIn(id)?.clippingMask);
  if (s.mode === 'composition') return editLayers(Object.fromEntries(ids.map((id) => [id, { clippingMask: value }])), { label: 'Clipping mask' });
  updateArtboard((ab) => setClippingMask(ab, ids, value), value ? 'Create clipping mask' : 'Release clipping mask');
}

export function setLayerFlag(id: string, flag: 'visible' | 'locked', value: boolean): void {
  editLayers({ [id]: { [flag]: value } }, { label: flag === 'visible' ? (value ? 'Show' : 'Hide') : value ? 'Lock' : 'Unlock' });
  if (flag === 'locked' && value) setSelection(S().selection.filter((x) => x !== id));
}

export function renameLayer(id: string, name: string): void {
  editLayers({ [id]: { name } }, { label: 'Rename' });
}

// clipboard (layers JSON)
let clipboard: Layer[] = [];
export function copySelection(cut = false): void {
  const s = S();
  if (!s.selection.length || !s.live) return;
  const src = s.mode === 'design' ? currentArtboardRaw()! : s.live;
  clipboard = topLevelSelection(src, s.selection)
    .map((id) => getLayer(src, id))
    .filter((l): l is Layer => !!l);
  try {
    void navigator.clipboard?.writeText(JSON.stringify({ kind: 'artisan-layers', layers: clipboard }));
  } catch {
    /* ignore */
  }
  toast(`${cut ? 'Cut' : 'Copied'} ${clipboard.length} layer${clipboard.length > 1 ? 's' : ''}`, 'info', 1200);
  if (cut) deleteSelection();
}

export async function paste(): Promise<void> {
  let layers = clipboard;
  try {
    const text = await navigator.clipboard?.readText?.();
    if (text && text.includes('artisan-layers')) {
      const j = JSON.parse(text);
      if (j.kind === 'artisan-layers' && Array.isArray(j.layers)) layers = j.layers;
    }
  } catch {
    /* clipboard permission denied: use internal clipboard */
  }
  if (!layers.length) return;
  if (!requireDesign('Paste')) return;
  const copies = layers.map((l) => {
    const c = cloneWithNewIds(l);
    if (typeof c.transform.x === 'number') c.transform = { ...c.transform, x: c.transform.x + 12, y: (c.transform.y as number) + 12 };
    return c;
  });
  updateArtboard((ab) => insertLayers(ab, copies), 'Paste');
  setSelection(copies.map((c) => c.id), null);
  clipboard = copies;
}

// guides
export function setGuides(next: Guide[], label = 'Edit guides'): void {
  const s = S();
  if (s.mode === 'design') updateArtboard((ab) => ({ ...ab, guides: next }), label);
  else if (s.mode === 'composition' && s.compositionId) setComp(s.compositionId, { ...compState(s.compositionId), guides: next }, label);
}

// expose / unexpose design props
export function exposeLayerField(layerId: string, path: string, propName: string): void {
  const s = S();
  if (!s.doc || !s.artboardId) return;
  const resolved = findLayerIn(layerId);
  setDoc(exposeField(s.doc, s.artboardId, layerId, path, propName, resolved ? getPath(resolved, path) : undefined), `Expose ${propName}`);
  toast(`“${path}” is now driven by prop “${propName}” (agent/CLI renderable)`, 'success');
}

export function unexposeLayerField(layerId: string, path: string): void {
  const s = S();
  if (!s.doc || !s.artboardId) return;
  setDoc(unexposeField(s.doc, s.artboardId, layerId, path), 'Unexpose prop');
}

// ---------------------------------------------------------------------------------------
// View

let pendingFit = false;
export function consumePendingFit(): boolean {
  const v = pendingFit;
  pendingFit = false;
  return v;
}

export function setView(v: Partial<StudioState['view']>): void {
  studio.set((s) => ({ view: { ...s.view, ...v } }));
}

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 32;

export function zoomTo(zoom: number, anchor?: { x: number; y: number }): void {
  const s = S();
  const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
  const a = anchor ?? { x: s.viewportSize.width / 2, y: s.viewportSize.height / 2 };
  const wx = (a.x - s.view.panX) / s.view.zoom;
  const wy = (a.y - s.view.panY) / s.view.zoom;
  setView({ zoom: z, panX: a.x - wx * z, panY: a.y - wy * z });
}

const ZOOM_STEPS = [0.1, 0.125, 0.167, 0.25, 0.333, 0.5, 0.667, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32];
export function zoomStep(dir: 1 | -1, anchor?: { x: number; y: number }): void {
  const z = S().view.zoom;
  const next = dir > 0 ? (ZOOM_STEPS.find((s) => s > z + 1e-6) ?? ZOOM_MAX) : ([...ZOOM_STEPS].reverse().find((s) => s < z - 1e-6) ?? ZOOM_MIN);
  zoomTo(next, anchor);
}

export function zoomToFit(): void {
  const s = S();
  const ab = s.live ?? s.render.artboard;
  if (!ab) return;
  const pad = 64;
  const vw = s.viewportSize.width - pad * 2;
  const vh = s.viewportSize.height - pad * 2;
  const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.min(vw / ab.width, vh / ab.height)));
  setView({ zoom: z, panX: (s.viewportSize.width - ab.width * z) / 2, panY: (s.viewportSize.height - ab.height * z) / 2 });
}

export function zoomToSelection(): void {
  const s = S();
  if (!s.selection.length || !s.live) return zoomToFit();
  const world = computeWorldMatrices(s.live);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of s.selection) {
    const l = findLayerIn(id);
    const m = world.get(id) as Matrix | undefined;
    if (!l || !m) continue;
    for (const [x, y] of [[0, 0], [l.transform.width, 0], [0, l.transform.height], [l.transform.width, l.transform.height]]) {
      const px = m[0] * x + m[2] * y + m[4];
      const py = m[1] * x + m[3] * y + m[5];
      minX = Math.min(minX, px); minY = Math.min(minY, py); maxX = Math.max(maxX, px); maxY = Math.max(maxY, py);
    }
  }
  if (!Number.isFinite(minX)) return;
  const pad = 80;
  const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.min((s.viewportSize.width - pad * 2) / Math.max(1, maxX - minX), (s.viewportSize.height - pad * 2) / Math.max(1, maxY - minY))));
  setView({ zoom: z, panX: s.viewportSize.width / 2 - ((minX + maxX) / 2) * z, panY: s.viewportSize.height / 2 - ((minY + maxY) / 2) * z });
}

export function setOverlay<K extends keyof Overlays>(k: K, v: Overlays[K]): void {
  studio.set((s) => {
    const overlays = { ...s.overlays, [k]: v };
    local.set('overlays', overlays);
    return { overlays };
  });
}

export function setLeftTab(t: StudioState['leftTab']): void {
  local.set('leftTab', t);
  studio.set({ leftTab: t });
}

export function setLocale(locale: string): void {
  studio.set({ locale });
  baseCache = null;
  scheduleRender();
}

// ---------------------------------------------------------------------------------------
// Export

export async function exportSvg(): Promise<string> {
  const ab = S().live;
  if (!ab) throw new Error('Nothing to export');
  const r = await renderArtboardToSvg(ab, { fonts, assets: exportAssets, annotate: false, onMissingAsset: 'placeholder', locale: S().locale || ab.locale });
  return r.svg;
}

export async function artboardToPng(ab: Artboard, scale = 1, type: 'image/png' | 'image/jpeg' = 'image/png'): Promise<string> {
  const r = await renderArtboardToSvg(ab, { fonts, assets: exportAssets, annotate: false, onMissingAsset: 'placeholder', scale });
  const w = Math.max(1, Math.round(ab.width * scale));
  const h = Math.max(1, Math.round(ab.height * scale));
  const img = new Image();
  const url = URL.createObjectURL(new Blob([r.svg], { type: 'image/svg+xml' }));
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('SVG rasterisation failed'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    if (type === 'image/jpeg') {
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL(type, 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function download(name: string, data: string | Blob, mime = 'application/octet-stream'): void {
  const blob = typeof data === 'string' ? (data.startsWith('data:') ? dataUrlToBlob(data) : new Blob([data], { type: mime })) : data;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function dataUrlToBlob(d: string): Blob {
  const [head, b64] = d.split(',');
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'application/octet-stream';
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u], { type: mime });
}

export function exportBaseName(): string {
  const s = S();
  if (s.mode === 'composition') return s.compositionId ?? 'composition';
  return documentFileName(s.doc!).replace(/\.artisan\.json$/, '');
}
