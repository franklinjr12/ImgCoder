/** Left sidebar: compositions (by folder), designs (IndexedDB + project), asset library. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { compileComposition, createLayer, describeComposition } from '@game-artisan/core';
import { fonts } from '../runtime/fonts';
import { displayAssets } from '../runtime/assets';
import { cloneWithNewIds } from '../editor/tree-ops';
import { useStudio, openComposition, openDesign, openProjectDocument, deleteDesign, studio, importDocument, setLeftTab, toast, insertLayer, deviation } from '../state/studio';
import { Icon } from './icons';
import { IconButton } from './controls';
import { AssetsPanel } from './AssetsPanel';
import { getThumb, requestThumb } from '../runtime/thumbs';

export function Sidebar() {
  const tab = useStudio((s) => s.leftTab);
  return (
    <div className="sidebar-browser">
      <div className="tabs">
        <button type="button" className={tab === 'templates' ? 'active' : ''} onClick={() => setLeftTab('templates')}>
          <Icon name="template" size={14} /> Templates
        </button>
        <button type="button" className={tab === 'designs' ? 'active' : ''} onClick={() => setLeftTab('designs')}>
          <Icon name="design" size={14} /> Designs
        </button>
        <button type="button" className={tab === 'assets' ? 'active' : ''} onClick={() => setLeftTab('assets')}>
          <Icon name="assets" size={14} /> Assets
        </button>
      </div>
      <div className="tab-body">{tab === 'templates' ? <TemplatesPanel /> : tab === 'designs' ? <DesignsPanel /> : <AssetsPanel />}</div>
    </div>
  );
}

function TemplatesPanel() {
  const sources = useStudio((s) => s.sources);
  const active = useStudio((s) => (s.mode === 'composition' ? s.compositionId : null));
  const comp = useStudio((s) => s.comp);
  useStudio((s) => s.thumbsVersion);
  const [q, setQ] = useState('');
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const groups = useMemo(() => {
    const m = new Map<string, NonNullable<typeof sources>['compositions']>();
    for (const c of sources?.compositions ?? []) {
      const hay = `${c.def.id} ${c.def.name ?? ''} ${c.def.tags?.join(' ') ?? ''} ${c.folder}`.toLowerCase();
      if (q && !hay.includes(q.toLowerCase())) continue;
      if (!m.has(c.folder)) m.set(c.folder, []);
      m.get(c.folder)!.push(c);
    }
    return [...m.entries()];
  }, [sources, q]);
  if (!sources) return null;
  return (
    <div className="templates">
      <div className="search">
        <Icon name="search" size={14} />
        <input placeholder="Search compositions" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      </div>
      {sources.info.hasProject ? (
        <div className="project-chip" title={sources.info.root}>
          <Icon name="folder" size={13} /> {sources.info.entry ?? 'project'}
        </div>
      ) : null}
      {groups.map(([folder, list]) => (
        <div key={folder} className="folder">
          <button type="button" className="folder-head" onClick={() => setClosed((c) => new Set(c.has(folder) ? [...c].filter((x) => x !== folder) : [...c, folder]))}>
            <Icon name={closed.has(folder) ? 'chevronRight' : 'chevronDown'} size={11} />
            <Icon name="folder" size={13} />
            <span>{folder}</span>
            <span className="count">{list.length}</span>
          </button>
          {!closed.has(folder)
            ? list.map((c) => {
                const st = comp[c.def.id];
                const dirty = !!st && (Object.keys(st.props ?? {}).length > 0 || Object.keys(st.overrides ?? {}).length > 0);
                return (
                  <button key={c.def.id} type="button" className={`comp-item ${active === c.def.id ? 'active' : ''}`} onClick={() => openComposition(c.def.id)} data-composition={c.def.id} title={c.def.description ?? c.def.id}>
                    <Thumb def={c.def} />
                    <span className="comp-text">
                      <span className="comp-name">
                        {c.def.name ?? c.def.id}
                        {dirty ? <span className="dot warn" title="Props/overrides differ from defaults" /> : null}
                      </span>
                      <span className="comp-meta">
                        {c.def.width}×{c.def.height}
                        {c.def.kind === 'html' ? ' · html' : ''}
                        {c.source === 'project' ? ' · project' : ''}
                      </span>
                    </span>
                  </button>
                );
              })
            : null}
        </div>
      ))}
      {!groups.length ? <div className="empty-hint">No compositions{q ? ' match' : ''}.</div> : null}
      {!sources.templatesGameAvailable ? <div className="empty-hint small">@game-artisan/templates-game not available — showing Studio samples.</div> : null}
      <BadgeInserter />
    </div>
  );
}

function Thumb({ def }: { def: NonNullable<ReturnType<typeof studio.get>['sources']>['compositions'][number]['def'] }) {
  const ref = useRef<HTMLSpanElement>(null);
  const t = getThumb(def);
  useEffect(() => {
    if (t !== undefined || !ref.current) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        requestThumb(def);
        io.disconnect();
      }
    });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [def, t]);
  const r = def.width / def.height;
  return (
    <span className="thumb" ref={ref}>
      {t ? <img src={t} alt="" /> : <span className="ratio" style={{ width: r >= 56 / 36 ? 56 : 36 * r, height: r >= 56 / 36 ? 56 / r : 36 }} />}
    </span>
  );
}

/** Insert badge/laurel components (compositions tagged badge) into the current design as groups. */
function BadgeInserter() {
  const sources = useStudio((s) => s.sources);
  const mode = useStudio((s) => s.mode);
  const badges = (sources?.compositions ?? []).filter((c) => c.def.kind !== 'html' && (/(^|\s)(badge|badges|laurel|component|accolade|rating)(\s|$)/i.test(c.def.tags?.join(' ') ?? '') || /badge|laurel|component/i.test(c.folder)));
  if (!badges.length || mode !== 'design') return null;
  return (
    <div className="folder">
      <div className="folder-head static">
        <Icon name="badge" size={13} /> <span>Insert component into design</span>
      </div>
      {badges.slice(0, 30).map((c) => (
        <button key={c.def.id} type="button" className="comp-item compact" onClick={() => void insertComposition(c.def.id)}>
          <Icon name="plus" size={12} /> {c.def.name ?? c.def.id}
        </button>
      ))}
    </div>
  );
}

async function insertComposition(id: string) {
  const s = studio.get();
  const entry = s.sources?.compositions.find((c) => c.def.id === id);
  if (!entry || !s.live) return;
  try {
    const { artboard } = await compileComposition(entry.def, { fonts, assets: displayAssets, surface: 'studio' });
    const scale = Math.min(1, (s.live.width * 0.4) / artboard.width, (s.live.height * 0.4) / artboard.height);
    const group = createLayer('group', {
      name: describeComposition(entry.def).name,
      transform: { x: Math.round((s.live.width - artboard.width * scale) / 2), y: Math.round((s.live.height - artboard.height * scale) / 2), width: artboard.width, height: artboard.height, scaleX: scale, scaleY: scale, originX: 0, originY: 0 },
      fill: artboard.background,
      children: [],
    } as any);
    const kids = artboard.children.map((c) => {
      const k: any = cloneWithNewIds(c);
      delete k.bindings;
      return k;
    });
    insertLayer({ ...group, children: kids } as any);
  } catch (e) {
    toast(`Cannot insert ${id}: ${(e as Error).message}`, 'error');
  }
}

function DesignsPanel() {
  const designs = useStudio((s) => s.designs);
  const activeId = useStudio((s) => (s.mode === 'design' ? s.doc?.id : null));
  const fileRef = useRef<HTMLInputElement>(null);
  const hasProject = useStudio((s) => !!s.sources?.info.documentsDir);
  return (
    <div className="designs">
      <div className="designs-actions">
        <button type="button" className="btn primary" onClick={() => studio.set({ dialog: { kind: 'new-design' } })}>
          <Icon name="plus" size={14} /> New design
        </button>
        <button type="button" className="btn" title="Open .artisan.json" onClick={() => fileRef.current?.click()}>
          <Icon name="upload" size={14} /> Open
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,.artisan.json,application/json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) importDocument(await f.text());
            e.target.value = '';
          }}
        />
      </div>
      <div className="design-grid">
        {designs.map((d) => (
          <div key={`${d.source}:${d.id}:${d.file ?? ''}`} className={`design-card ${activeId === d.id ? 'active' : ''}`} onClick={() => (d.source === 'project' ? void openProjectDocument(d.file!) : void openDesign(d.id))}>
            <div className="design-thumb">{d.thumb ? <img src={d.thumb} alt="" /> : <Icon name={d.source === 'project' ? 'file' : 'design'} size={22} />}</div>
            <div className="design-info">
              <span className="design-name">{d.name}</span>
              <span className="design-meta">
                {d.source === 'project' ? `project · ${d.file}` : `${d.width}×${d.height} · ${timeAgo(d.updatedAt)}`}
              </span>
            </div>
            {d.source === 'local' ? (
              <IconButton
                icon="trash"
                title="Delete design"
                className="design-del"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete “${d.name}”? This cannot be undone.`)) void deleteDesign(d.id);
                }}
              />
            ) : null}
          </div>
        ))}
        {!designs.length ? <div className="empty-hint">No designs yet. Create one from a store preset, or detach a template.</div> : null}
      </div>
      {hasProject ? <div className="empty-hint small">Project designs are read from and saved to the project's documents folder.</div> : null}
    </div>
  );
}

export function timeAgo(t: number): string {
  const d = (Date.now() - t) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}

export function useDeviation() {
  useStudio((s) => [s.comp, s.compositionId, s.mode]);
  return deviation();
}

export function useInterval(fn: () => void, ms: number) {
  useEffect(() => {
    const t = setInterval(fn, ms);
    return () => clearInterval(t);
  }, [fn, ms]);
}
