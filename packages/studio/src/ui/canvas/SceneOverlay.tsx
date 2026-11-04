/**
 * Store overlays (US-5.1): safe zones (artboard.safeZones or the preset's zones) and a Steam
 * client/store UI simulation (library hero: top nav gradient, logo anchor, Play bar; capsules:
 * discount/price block; page background: content column).
 */
import type { Artboard, SafeZone } from '@game-artisan/core';
import { studio, type Overlays } from '../../state/studio';

interface View {
  zoom: number;
  panX: number;
  panY: number;
}

function presetIdOf(ab: Artboard): string {
  if (ab.preset) return ab.preset;
  const k = `${ab.width}x${ab.height}`;
  const bySize: Record<string, string> = {
    '3840x1240': 'steam-library-hero',
    '460x215': 'steam-header-capsule',
    '616x353': 'steam-main-capsule',
    '374x448': 'steam-vertical-capsule',
    '231x87': 'steam-small-capsule',
    '1438x810': 'steam-page-background',
    '600x900': 'steam-library-capsule',
    '1280x720': 'steam-library-logo',
  };
  return bySize[k] ?? '';
}

function zonesFor(ab: Artboard): SafeZone[] {
  if (ab.safeZones?.length) return ab.safeZones;
  const s = studio.get().sources;
  const id = presetIdOf(ab);
  if (!s || !id) return [];
  const spec = Object.values(s.presets).find((p) => p.id === id);
  return spec ? s.presetSafeZones(spec) : [];
}

export function SceneOverlay({ artboard: ab, view, overlays }: { artboard: Artboard; view: View; overlays: Overlays }) {
  const z = view.zoom;
  const tr = (x: number, y: number) => ({ x: x * z + view.panX, y: y * z + view.panY });
  const zones = overlays.safeZones ? zonesFor(ab) : [];
  const preset = presetIdOf(ab);
  return (
    <g className="scene-overlay" pointerEvents="none">
      <defs>
        <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="8" height="8" fill="rgba(255,64,64,0.10)" />
          <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(255,80,80,0.45)" strokeWidth="2" />
        </pattern>
        <linearGradient id="steam-top" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#000" stopOpacity="0.75" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="steam-bottom" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#171a21" stopOpacity="0" />
          <stop offset="1" stopColor="#171a21" stopOpacity="0.95" />
        </linearGradient>
        <linearGradient id="steam-side" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#1b2838" stopOpacity="0.9" />
          <stop offset="0.18" stopColor="#1b2838" stopOpacity="0" />
          <stop offset="0.82" stopColor="#1b2838" stopOpacity="0" />
          <stop offset="1" stopColor="#1b2838" stopOpacity="0.9" />
        </linearGradient>
      </defs>
      {zones.map((zone) => {
        const a = tr(zone.x, zone.y);
        const w = zone.width * z;
        const h = zone.height * z;
        return (
          <g key={zone.id} className={`zone zone-${zone.kind}`}>
            <rect x={a.x} y={a.y} width={w} height={h} fill={zone.kind === 'danger' ? 'url(#hatch)' : 'none'} />
            {zone.label && w > 60 ? (
              <text x={a.x + 6} y={a.y + 14}>
                {zone.label}
              </text>
            ) : null}
          </g>
        );
      })}
      {overlays.steamUi ? <SteamUi ab={ab} preset={preset} view={view} /> : null}
    </g>
  );
}

function SteamUi({ ab, preset, view }: { ab: Artboard; preset: string; view: View }) {
  const W = ab.width;
  const H = ab.height;
  const t = `translate(${view.panX} ${view.panY}) scale(${view.zoom})`;
  const font = { fontFamily: '"Inter UI", Inter, Arial, sans-serif' };
  if (preset === 'steam-library-hero') {
    const u = H / 1240;
    return (
      <g transform={t} className="steam-ui" style={font}>
        <rect width={W} height={170 * u} fill="url(#steam-top)" />
        <text x={60 * u} y={70 * u} fontSize={30 * u} fill="#c7d5e0" opacity="0.9">
          ◀  ▶   LIBRARY   ›   HOME
        </text>
        <rect y={H * 0.62} width={W} height={H * 0.38} fill="url(#steam-bottom)" />
        <rect x={160 * u} y={300 * u} width={1100 * u} height={520 * u} fill="none" stroke="#66c0f4" strokeWidth={4 * u} strokeDasharray={`${16 * u} ${10 * u}`} opacity="0.8" />
        <text x={180 * u} y={345 * u} fontSize={30 * u} fill="#66c0f4">
          LIBRARY LOGO (anchored bottom-left)
        </text>
        <rect x={0} y={H - 170 * u} width={W} height={170 * u} fill="#171a21" opacity="0.88" />
        <rect x={160 * u} y={H - 140 * u} width={330 * u} height={110 * u} rx={6 * u} fill="#5c7e10" />
        <rect x={160 * u} y={H - 140 * u} width={330 * u} height={110 * u} rx={6 * u} fill="url(#steam-top)" opacity="0.2" />
        <text x={325 * u} y={H - 70 * u} fontSize={44 * u} fontWeight={700} fill="#ffffff" textAnchor="middle">
          ▶  PLAY
        </text>
        <text x={560 * u} y={H - 95 * u} fontSize={24 * u} fill="#8f98a0">
          LAST PLAYED
        </text>
        <text x={560 * u} y={H - 58 * u} fontSize={28 * u} fill="#dcdedf">
          Today
        </text>
        <text x={860 * u} y={H - 95 * u} fontSize={24 * u} fill="#8f98a0">
          PLAY TIME
        </text>
        <text x={860 * u} y={H - 58 * u} fontSize={28 * u} fill="#dcdedf">
          42.7 hours
        </text>
        <text x={1160 * u} y={H - 95 * u} fontSize={24 * u} fill="#8f98a0">
          ACHIEVEMENTS
        </text>
        <rect x={1160 * u} y={H - 80 * u} width={300 * u} height={14 * u} rx={7 * u} fill="#3d4450" />
        <rect x={1160 * u} y={H - 80 * u} width={190 * u} height={14 * u} rx={7 * u} fill="#1a9fff" />
      </g>
    );
  }
  if (preset === 'steam-page-background') {
    const colW = 940 * (W / 1438);
    const x0 = (W - colW) / 2;
    return (
      <g transform={t} className="steam-ui" style={font}>
        <rect width={W} height={H} fill="url(#steam-side)" />
        <rect x={x0} y={H * 0.08} width={colW} height={H * 0.92} fill="#1b2838" opacity="0.55" />
        <rect x={x0 + 16} y={H * 0.12} width={colW * 0.62} height={H * 0.38} fill="#000" opacity="0.45" />
        <rect x={x0 + colW * 0.66} y={H * 0.12} width={colW * 0.32} height={H * 0.18} fill="#000" opacity="0.4" />
        <text x={x0 + 16} y={H * 0.1} fontSize={16} fill="#c7d5e0">
          Store page content column (940 px)
        </text>
      </g>
    );
  }
  if (preset.startsWith('steam-') && preset.includes('capsule')) {
    const s = Math.min(W, H) / 215;
    const bh = 34 * s;
    const bw = 150 * s;
    return (
      <g transform={t} className="steam-ui" style={font}>
        <rect y={H * 0.7} width={W} height={H * 0.3} fill="url(#steam-bottom)" opacity="0.6" />
        <g transform={`translate(${W - bw - 8 * s} ${H - bh - 8 * s})`}>
          <rect width={bw * 0.42} height={bh} fill="#4c6b22" />
          <text x={bw * 0.21} y={bh * 0.7} fontSize={20 * s} fontWeight={800} fill="#beee11" textAnchor="middle">
            -50%
          </text>
          <rect x={bw * 0.42} width={bw * 0.58} height={bh} fill="#344654" />
          <text x={bw * 0.71} y={bh * 0.38} fontSize={10 * s} fill="#738895" textAnchor="middle" textDecoration="line-through">
            $19.99
          </text>
          <text x={bw * 0.71} y={bh * 0.82} fontSize={14 * s} fill="#beee11" textAnchor="middle">
            $9.99
          </text>
        </g>
      </g>
    );
  }
  // generic storefront hint
  return (
    <g transform={t} className="steam-ui" style={font}>
      <rect y={H * 0.75} width={W} height={H * 0.25} fill="url(#steam-bottom)" opacity="0.7" />
    </g>
  );
}
