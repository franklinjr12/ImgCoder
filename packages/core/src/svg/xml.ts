export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function attrs(obj: Record<string, string | number | boolean | null | undefined>): string {
  let out = '';
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === false) continue;
    const val = typeof v === 'number' ? num(v) : v === true ? k : String(v);
    out += ` ${k}="${escapeXml(val)}"`;
  }
  return out;
}

export function num(n: number): string {
  if (!isFinite(n)) return '0';
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
}

export function el(tag: string, a: Record<string, string | number | boolean | null | undefined>, children?: string): string {
  return children == null || children === '' ? `<${tag}${attrs(a)}/>` : `<${tag}${attrs(a)}>${children}</${tag}>`;
}

/**
 * Strip active content from third-party SVG markup and namespace its ids so it can be
 * inlined safely into a composed document.
 */
export function sanitizeSvg(markup: string, idPrefix: string): { inner: string; viewBox?: [number, number, number, number]; width?: number; height?: number } {
  let s = markup
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script[^>]*\/>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/(href\s*=\s*["'])\s*javascript:[^"']*(["'])/gi, '$1#$2');
  const open = /<svg\b([^>]*)>/i.exec(s);
  if (!open) return { inner: s };
  const tagAttrs = open[1];
  const attr = (n: string) => new RegExp(`\\s${n}\\s*=\\s*["']([^"']+)["']`, 'i').exec(' ' + tagAttrs)?.[1];
  const vbRaw = attr('viewBox');
  const vb = vbRaw?.trim().split(/[\s,]+/).map(Number);
  const width = parseFloat(attr('width') ?? '') || undefined;
  const height = parseFloat(attr('height') ?? '') || undefined;
  const end = s.lastIndexOf('</svg>');
  let inner = s.slice(open.index + open[0].length, end === -1 ? undefined : end);
  // Namespace ids
  const ids = new Set<string>();
  inner.replace(/\sid\s*=\s*["']([^"']+)["']/g, (_, id) => {
    ids.add(id);
    return '';
  });
  for (const id of ids) {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    inner = inner
      .replace(new RegExp(`(\\sid\\s*=\\s*["'])${esc}(["'])`, 'g'), `$1${idPrefix}${id}$2`)
      .replace(new RegExp(`url\\(\\s*['"]?#${esc}['"]?\\s*\\)`, 'g'), `url(#${idPrefix}${id})`)
      .replace(new RegExp(`(href\\s*=\\s*["'])#${esc}(["'])`, 'g'), `$1#${idPrefix}${id}$2`);
  }
  return {
    inner,
    viewBox: vb && vb.length === 4 && vb.every((n) => isFinite(n)) ? (vb as [number, number, number, number]) : width && height ? [0, 0, width, height] : undefined,
    width,
    height,
  };
}
