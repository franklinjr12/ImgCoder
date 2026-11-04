/** Inline stroke icons (24×24 grid, currentColor). */
import type { ReactNode } from 'react';

const P: Record<string, ReactNode> = {
  select: <path d="M5 3l14 8-6 2-3 6z" />,
  hand: <path d="M8 13V5.5a1.5 1.5 0 013 0V11m0-6.5a1.5 1.5 0 013 0V11m0-5a1.5 1.5 0 013 0v7c0 4-3 7-7 7s-6-2-7.5-5L5 13a1.5 1.5 0 012.6-1.5L8 13" />,
  text: <path d="M5 6V4h14v2M12 4v16m-3 0h6" />,
  rect: <rect x="4" y="6" width="16" height="12" rx="2" />,
  ellipse: <ellipse cx="12" cy="12" rx="8" ry="7" />,
  polygon: <path d="M12 3l8 6-3 10H7L4 9z" />,
  star: <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />,
  line: <path d="M5 19L19 5" />,
  path: <path d="M4 14h9V9l7 6-7 6v-5H4z" transform="translate(0 -3)" />,
  image: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M21 16l-5-5-9 8" />
    </>
  ),
  gradient: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M4 15l11-11M4 20L20 4M9 20l11-11" opacity=".6" />
    </>
  ),
  halftone: (
    <>
      <circle cx="7" cy="7" r="2.2" />
      <circle cx="17" cy="7" r="1.4" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="7" cy="17" r="1.2" />
      <circle cx="17" cy="17" r=".8" />
    </>
  ),
  scanlines: <path d="M4 6h16M4 10h16M4 14h16M4 18h16" />,
  pattern: <path d="M4 4h6v6H4zM14 14h6v6h-6zM14 4h6v6h-6zM4 14h6v6H4z" />,
  group: <path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M8 8h8v8H8z" />,
  frame: <path d="M7 3v18M17 3v18M3 7h18M3 17h18" />,
  mask: (
    <>
      <circle cx="9" cy="12" r="6" />
      <circle cx="15" cy="12" r="6" />
    </>
  ),
  boolean: (
    <>
      <rect x="4" y="4" width="10" height="10" rx="1" />
      <rect x="10" y="10" width="10" height="10" rx="1" />
    </>
  ),
  svg: <path d="M8 6l-5 6 5 6M16 6l5 6-5 6M14 4l-4 16" />,
  raster: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M21 16l-5-5-9 8" />
    </>
  ),
  vector: <path d="M4 20L12 4l8 16zM12 4v0" />,
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: <path d="M3 3l18 18M10.6 5.1A10 10 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3.2 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.6 9.6 0 005.4-1.6M9.9 9.9a3 3 0 004.2 4.2" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 018 0v4" />
    </>
  ),
  unlock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 017.5-2" />
    </>
  ),
  undo: <path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3" />,
  redo: <path d="M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3" />
    </>
  ),
  code: <path d="M8 7l-5 5 5 5M16 7l5 5-5 5" />,
  download: <path d="M12 4v11m-5-5l5 5 5-5M4 20h16" />,
  upload: <path d="M12 20V9m-5 5l5-5 5 5M4 4h16" />,
  folder: <path d="M3 6a1 1 0 011-1h5l2 2h9a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1z" />,
  file: <path d="M6 3h8l4 4v14H6zM14 3v4h4" />,
  chevronRight: <path d="M9 6l6 6-6 6" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  layers: <path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5" opacity="1" />,
  template: (
    <>
      <rect x="3" y="3" width="8" height="8" rx="1.5" />
      <rect x="13" y="3" width="8" height="8" rx="1.5" />
      <rect x="3" y="13" width="8" height="8" rx="1.5" />
      <rect x="13" y="13" width="8" height="8" rx="1.5" />
    </>
  ),
  design: <path d="M4 20l4-1 11-11-3-3L5 16zM14 6l3 3" />,
  assets: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="M21 15l-5-5L5 21" />
    </>
  ),
  warning: <path d="M12 3l10 18H2zM12 10v5M12 18v.5" />,
  reset: <path d="M4 4v6h6M4.5 15a8 8 0 102-8.5L4 10" />,
  link: <path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" />,
  unlink: <path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1M4 4l16 16" />,
  grid: <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />,
  ruler: <path d="M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2" />,
  magnet: <path d="M6 3v8a6 6 0 0012 0V3h-4v8a2 2 0 01-4 0V3zM6 7h4M14 7h4" />,
  safe: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />,
  steam: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="15" cy="10" r="2.5" />
      <path d="M3.5 14l5 2a2.5 2.5 0 004.5-1.5l2-2.5" />
    </>
  ),
  fit: <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />,
  save: <path d="M5 3h11l3 3v15H5zM8 3v5h7V3M8 21v-7h8v7" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1.3" />
      <circle cx="12" cy="12" r="1.3" />
      <circle cx="19" cy="12" r="1.3" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
    </>
  ),
  outline: <path d="M4 4h16v16H4z" strokeDasharray="3 2" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M20 20l-4.5-4.5" />
    </>
  ),
  sparkle: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />,
  badge: <path d="M12 2l2.4 2.1 3.1-.5.9 3 2.9 1.4-1 3 1 3-2.9 1.4-.9 3-3.1-.5L12 22l-2.4-2.1-3.1.5-.9-3-2.9-1.4 1-3-1-3 2.9-1.4.9-3 3.1.5z" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" />
    </>
  ),
  artboard: <path d="M6 3v3M18 3v3M6 18v3M18 18v3M3 6h3M18 6h3M3 18h3M18 18h3M6 6h12v12H6z" />,
};

export function Icon({ name, size = 16, className, title }: { name: string; size?: number; className?: string; title?: string }) {
  const body = P[name] ?? P[name.replace(/^shape-/, '')] ?? P.rect;
  return (
    <svg className={`icon ${className ?? ''}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      {body}
    </svg>
  );
}
