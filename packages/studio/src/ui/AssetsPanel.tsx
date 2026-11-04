/** Media tray (US-3.5): IndexedDB library + project assets (live-refreshed), category tags, drag to canvas. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStudio, studio, insertLayer, toast } from '../state/studio';
import {
  ASSET_CATEGORIES,
  addToLibrary,
  libraryItem,
  listLibrary,
  listProjectAssets,
  projectItem,
  removeFromLibrary,
  updateLibraryAsset,
  librarySrc,
  formatBytes,
  type AssetItem,
} from '../runtime/assets';
import { createImageLayer } from '../editor/primitives';
import { Icon } from './icons';

export function AssetsPanel() {
  const version = useStudio((s) => s.assetsVersion);
  const hasProjectAssets = useStudio((s) => !!s.sources?.info.assetsDir);
  const [items, setItems] = useState<AssetItem[]>([]);
  const [filter, setFilter] = useState<string>('All');
  const [source, setSource] = useState<'all' | 'library' | 'project'>('all');
  const [q, setQ] = useState('');
  const [over, setOver] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [lib, prj] = await Promise.all([listLibrary(), hasProjectAssets ? listProjectAssets() : Promise.resolve([])]);
      if (!alive) return;
      setItems([...prj.map(projectItem), ...lib.map(libraryItem)]);
    })();
    return () => {
      alive = false;
    };
  }, [version, hasProjectAssets]);

  const shown = useMemo(
    () =>
      items.filter(
        (i) =>
          (filter === 'All' || (filter === 'Untagged' ? !i.tags.length : i.tags.includes(filter))) &&
          (source === 'all' || i.source === source) &&
          (!q || i.name.toLowerCase().includes(q.toLowerCase())),
      ),
    [items, filter, source, q],
  );

  const addFiles = async (files: FileList | File[]) => {
    const list = [...files].filter((f) => /^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(f.name));
    if (!list.length) return toast('Only images can be added to the library', 'warning');
    for (const f of list) await addToLibrary(f, { tags: filter !== 'All' && filter !== 'Untagged' ? [filter] : undefined });
    studio.set((s) => ({ assetsVersion: s.assetsVersion + 1 }));
    toast(`Added ${list.length} asset${list.length > 1 ? 's' : ''} to the library`, 'success');
  };

  const insert = async (it: AssetItem) => {
    const s = studio.get();
    if (s.mode !== 'design' || !s.live) return toast('Open or create a design to place assets (templates use image props)', 'warning', 3500);
    const src = it.source === 'library' ? await librarySrc(it.key.slice(4)) : it.src;
    insertLayer(createImageLayer({ src, name: it.name, width: it.width, height: it.height, mime: it.mime, artboardWidth: s.live.width, artboardHeight: s.live.height }));
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = { All: items.length, Untagged: 0 };
    for (const i of items) {
      if (!i.tags.length) c.Untagged++;
      for (const t of i.tags) c[t] = (c[t] ?? 0) + 1;
    }
    return c;
  }, [items]);

  return (
    <div
      className={`assets ${over ? 'drop-over' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
      }}
    >
      <div className="assets-head">
        <div className="search">
          <Icon name="search" size={14} />
          <input placeholder="Search assets" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        </div>
        <button type="button" className="btn" onClick={() => fileRef.current?.click()} title="Upload images">
          <Icon name="upload" size={14} />
        </button>
        <input ref={fileRef} type="file" accept="image/*,.svg" multiple hidden onChange={(e) => e.target.files && void addFiles(e.target.files).finally(() => (e.target.value = ''))} />
      </div>
      <div className="chips">
        {['All', ...ASSET_CATEGORIES, 'Untagged'].map((c) => (
          <button key={c} type="button" className={`chip ${filter === c ? 'active' : ''}`} onClick={() => setFilter(c)}>
            {c}
            {counts[c] ? <span>{counts[c]}</span> : null}
          </button>
        ))}
      </div>
      {hasProjectAssets ? (
        <div className="chips small">
          {(['all', 'project', 'library'] as const).map((s) => (
            <button key={s} type="button" className={`chip ${source === s ? 'active' : ''}`} onClick={() => setSource(s)}>
              {s === 'all' ? 'All sources' : s === 'project' ? 'Project folder' : 'Library'}
            </button>
          ))}
        </div>
      ) : null}
      <div className="asset-grid">
        {shown.map((it) => (
          <div
            key={it.key}
            className="asset"
            draggable
            title={`${it.name}\n${it.width && it.height ? `${it.width}×${it.height} · ` : ''}${formatBytes(it.size)}${it.source === 'project' ? `\n${it.src}` : ''}\nDouble-click or drag onto the canvas`}
            onDragStart={(e) => {
              e.dataTransfer.setData('application/x-artisan-asset', JSON.stringify({ src: it.source === 'project' ? it.src : undefined, libId: it.source === 'library' ? it.key.slice(4) : undefined, name: it.name, mime: it.mime, width: it.width, height: it.height }));
              e.dataTransfer.effectAllowed = 'copy';
            }}
            onDoubleClick={() => void insert(it)}
          >
            <div className="asset-thumb">
              <img src={it.thumb} alt={it.name} loading="lazy" draggable={false} />
              {it.source === 'project' ? <span className="asset-src">project</span> : null}
            </div>
            <div className="asset-name">{it.name}</div>
            <div className="asset-tags">
              {it.tags.map((t) => (
                <span key={t} className="tag-chip">
                  {t}
                </span>
              ))}
              {it.source === 'library' ? (
                <button type="button" className="tag-edit" title="Edit tags" onClick={() => setEditing(editing === it.key ? null : it.key)}>
                  <Icon name="plus" size={10} />
                </button>
              ) : null}
            </div>
            {editing === it.key ? (
              <div className="tag-menu" onClick={(e) => e.stopPropagation()}>
                {ASSET_CATEGORIES.map((c) => (
                  <label key={c}>
                    <input
                      type="checkbox"
                      checked={it.tags.includes(c)}
                      onChange={async (e) => {
                        const tags = e.target.checked ? [...it.tags, c] : it.tags.filter((t) => t !== c);
                        await updateLibraryAsset(it.key.slice(4), { tags });
                        studio.set((s) => ({ assetsVersion: s.assetsVersion + 1 }));
                      }}
                    />
                    {c}
                  </label>
                ))}
                <button
                  type="button"
                  className="btn danger small"
                  onClick={async () => {
                    await removeFromLibrary(it.key.slice(4));
                    setEditing(null);
                    studio.set((s) => ({ assetsVersion: s.assetsVersion + 1 }));
                  }}
                >
                  <Icon name="trash" size={12} /> Remove
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
      {!shown.length ? (
        <div className="drop-zone" onClick={() => fileRef.current?.click()}>
          <Icon name="upload" size={22} />
          <div>Drop screenshots, key art, character cutouts & logos here</div>
          <div className="small">Stored offline in your browser (IndexedDB)</div>
        </div>
      ) : null}
    </div>
  );
}
