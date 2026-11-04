/**
 * JSX → UDM compiler. Evaluates a template's element tree (function components are called
 * directly, hooks are not supported — like Satori), lays it out with Yoga flexbox and emits
 * a concrete UDM artboard with absolute frames.
 */
import { loadYoga, Align, Direction, Display, Edge, FlexDirection, Gutter, Justify, MeasureMode, Overflow, PositionType, Wrap } from 'yoga-layout/load';
import type { Yoga, Node as YogaNode } from 'yoga-layout/load';
import type { Adjustment, Artboard, Effect, Fill, Layer, Shape, Stroke, TextStyle } from '../udm/schema.js';
import { ArtboardSchema, LayerSchema, TextStyleSchema } from '../udm/schema.js';
import type { FontRegistry } from '../text/fonts.js';
import { layoutText } from '../text/layout.js';
import type { AssetResolver, ResolvedAsset } from '../assets/resolver.js';
import { getArtisanKind, type ArtisanStyle } from './components.js';
import { parseBorder, parseCssTransform, parseFill, parseFilter, parseLength, parseObjectPosition, parseShadows, parseTextStroke } from './css.js';
import { withRenderContext, type RenderContext } from './context.js';

let yogaPromise: Promise<Yoga> | null = null;
export function getYoga(): Promise<Yoga> {
  return (yogaPromise ??= loadYoga());
}

export interface CompileEnv {
  fonts: FontRegistry;
  assets?: AssetResolver;
  width: number;
  height: number;
  locale?: string;
  compositionId?: string;
  props?: Record<string, unknown>;
  artboardId?: string;
  background?: Fill;
  surface?: string;
}

export class TemplateCompileError extends Error {
  constructor(message: string, readonly path?: string) {
    super(message);
    this.name = 'TemplateCompileError';
  }
}

type Kind = 'box' | 'text' | 'image' | 'gradient' | 'shape' | 'svg' | 'halftone' | 'pattern' | 'mask' | 'boolean';

interface LNode {
  kind: Kind;
  id: string;
  name?: string;
  style: ArtisanStyle;
  props: Record<string, any>;
  children: LNode[];
  mask?: LNode;
  text?: { content: string; style: TextStyle; effects: Effect[] };
  shape?: Shape;
  src?: string;
  asset?: ResolvedAsset;
  fillParent?: boolean;
  yoga?: YogaNode;
}

const TEXT_KEYS = ['color', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'textAlign', 'textTransform', 'textShadow', 'WebkitTextStroke', 'verticalAlign', 'whiteSpace'] as const;
const BOX_TAGS = new Set(['div', 'section', 'header', 'footer', 'main', 'article', 'aside', 'nav', 'figure', 'ul', 'ol', 'li']);
const TEXT_TAGS = new Set(['span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'b', 'i', 'label', 'small', 'code']);
const TAG_TEXT_DEFAULTS: Record<string, ArtisanStyle> = { strong: { fontWeight: 700 }, b: { fontWeight: 700 }, em: { fontStyle: 'italic' }, i: { fontStyle: 'italic' } };

const FRAGMENT = Symbol.for('react.fragment');

function isElement(v: any): v is { type: any; props: any; key?: any } {
  return !!v && typeof v === 'object' && 'type' in v && 'props' in v;
}

function pickText(style: ArtisanStyle | undefined): ArtisanStyle {
  const out: ArtisanStyle = {};
  if (!style) return out;
  for (const k of TEXT_KEYS) if (style[k] !== undefined) (out as any)[k] = style[k];
  if (style.backgroundClip === 'text' || style.WebkitBackgroundClip === 'text') {
    out.__textFill = style.backgroundImage ?? style.background;
  }
  return out;
}

export function cssToTextStyle(css: ArtisanStyle, overrides: Partial<TextStyle> = {}): TextStyle {
  const fontSize = typeof css.fontSize === 'number' ? css.fontSize : parseLength(css.fontSize as any) ?? 32;
  const fw = css.fontWeight === 'bold' ? 700 : css.fontWeight === 'normal' ? 400 : (css.fontWeight as number | undefined);
  let lineHeight: number | undefined;
  if (typeof css.lineHeight === 'number') lineHeight = css.lineHeight > 4 ? css.lineHeight / fontSize : css.lineHeight;
  else if (typeof css.lineHeight === 'string') {
    const s = css.lineHeight.trim();
    lineHeight = s.endsWith('px') ? parseFloat(s) / fontSize : s.endsWith('%') ? parseFloat(s) / 100 : parseFloat(s);
  }
  const ls = typeof css.letterSpacing === 'number' ? css.letterSpacing : css.letterSpacing ? parseLength(css.letterSpacing, 0, fontSize) : undefined;
  const fill = parseFill((css as any).__textFill) ?? (css.color ? parseFill(css.color) : undefined);
  const stroke = parseTextStroke(css.WebkitTextStroke);
  return TextStyleSchema.parse({
    fontFamily: css.fontFamily,
    fontSize,
    fontWeight: fw,
    fontStyle: css.fontStyle,
    letterSpacing: ls,
    lineHeight,
    textAlign: css.textAlign,
    textTransform: css.textTransform,
    verticalAlign: css.verticalAlign,
    fill,
    strokes: stroke ? [stroke] : undefined,
    wrap: css.whiteSpace === 'nowrap' || css.whiteSpace === 'pre' ? false : undefined,
    ...overrides,
  });
}

function childArray(children: unknown): unknown[] {
  if (children === undefined) return [];
  return Array.isArray(children) ? children : [children];
}

function textOf(children: unknown): string | null {
  const arr = childArray(children).flat(Infinity as 1);
  if (!arr.length) return null;
  let out = '';
  for (const c of arr) {
    if (c == null || c === false || c === true) continue;
    if (typeof c === 'string' || typeof c === 'number') out += String(c);
    else return null;
  }
  return out;
}

interface EvalState {
  ids: Set<string>;
}

function uniqueId(state: EvalState, base: string): string {
  let id = base;
  let i = 1;
  while (state.ids.has(id)) id = `${base}_${i++}`;
  state.ids.add(id);
  return id;
}

function shorthandStyle(props: any): ArtisanStyle {
  const s: ArtisanStyle = {};
  if (props.x != null || props.y != null) {
    s.position = 'absolute';
    if (props.x != null) s.left = props.x;
    if (props.y != null) s.top = props.y;
  }
  if (props.width != null) s.width = props.width;
  if (props.height != null) s.height = props.height;
  return s;
}

function makeTextNode(state: EvalState, id: string, content: string, inherited: ArtisanStyle, ownStyle: ArtisanStyle, props: any): LNode {
  const merged = { ...inherited, ...ownStyle };
  const overrides: Partial<TextStyle> = { ...(props.textStyle ?? {}) };
  if (props.fill) overrides.fill = parseFill(props.fill);
  if (props.strokes) overrides.strokes = props.strokes;
  if (props.fit) overrides.fit = props.fit;
  if (props.minFontSize) overrides.minFontSize = props.minFontSize;
  if (props.maxLines) overrides.maxLines = props.maxLines;
  const style = cssToTextStyle(merged, overrides);
  return {
    kind: 'text',
    id: uniqueId(state, id),
    name: props.name,
    style: ownStyle,
    props,
    children: [],
    text: { content, style, effects: parseShadows(merged.textShadow) },
  };
}

function evaluate(node: unknown, path: string, inherited: ArtisanStyle, state: EvalState, out: LNode[]): void {
  if (node == null || node === false || node === true) return;
  if (Array.isArray(node)) {
    node.forEach((c, i) => evaluate(c, `${path}-${i}`, inherited, state, out));
    return;
  }
  if (typeof node === 'string' || typeof node === 'number') {
    const s = String(node);
    if (s.trim() === '') return;
    out.push(makeTextNode(state, `text${path}`, s, inherited, {}, {}));
    return;
  }
  if (!isElement(node)) {
    throw new TemplateCompileError(`Unsupported child in template at ${path}: ${typeof node === 'object' ? JSON.stringify(node).slice(0, 80) : String(node)}`);
  }
  const { type, props = {} } = node;
  const keyPart = node.key != null ? `${node.key}` : '';
  if (type === FRAGMENT || (typeof type === 'symbol' && String(type).includes('fragment'))) {
    evaluate(props.children, path, inherited, state, out);
    return;
  }
  const kind = getArtisanKind(type);
  const ownStyle: ArtisanStyle = { ...shorthandStyle(props), ...(props.style ?? {}) };
  const baseId = (k: string) => (props.id ? String(props.id) : `${k}${keyPart ? `-${keyPart}` : ''}${path}`);
  if (kind) {
    const nextInherited = { ...inherited, ...pickText(props.style) };
    switch (kind) {
      case 'text': {
        const content = props.content != null ? String(props.content) : textOf(props.children) ?? '';
        out.push(makeTextNode(state, baseId('text'), content, inherited, ownStyle, props));
        return;
      }
      case 'group':
      case 'mask':
      case 'boolean': {
        const children: LNode[] = [];
        evaluate(props.children, `${path}`, nextInherited, state, children);
        const ln: LNode = { kind: kind === 'group' ? 'box' : kind, id: uniqueId(state, baseId(kind)), name: props.name, style: ownStyle, props, children };
        if (kind === 'mask') {
          const m: LNode[] = [];
          evaluate(props.mask, `${path}-mask`, nextInherited, state, m);
          if (m.length !== 1) throw new TemplateCompileError(`<Layer.Mask> needs exactly one mask element (got ${m.length})`, path);
          ln.mask = m[0];
        }
        out.push(ln);
        return;
      }
      case 'image':
      case 'svg':
        out.push({ kind: kind === 'image' ? 'image' : 'svg', id: uniqueId(state, baseId(kind)), name: props.name, style: ownStyle, props, children: [], src: props.src });
        return;
      case 'gradient':
      case 'halftone':
      case 'pattern':
        out.push({ kind, id: uniqueId(state, baseId(kind)), name: props.name, style: ownStyle, props, children: [], fillParent: true });
        return;
      case 'rect':
      case 'ellipse':
      case 'polygon':
      case 'star':
      case 'path':
      case 'line': {
        let shape: Shape;
        if (kind === 'rect') shape = { kind: 'rect', cornerRadius: props.cornerRadius ?? ownStyle.borderRadius ?? 0 };
        else if (kind === 'ellipse') shape = { kind: 'ellipse' };
        else if (kind === 'polygon') shape = { kind: 'polygon', sides: props.sides ?? 6, rotation: 0 };
        else if (kind === 'star') shape = { kind: 'star', points: props.points ?? 5, innerRatio: props.innerRatio ?? 0.5, rotation: 0 };
        else if (kind === 'path') shape = { kind: 'path', d: props.d, viewBox: props.viewBox, fillRule: props.fillRule ?? 'nonzero' };
        else shape = { kind: 'line', points: props.points, closed: props.closed ?? false };
        out.push({ kind: 'shape', id: uniqueId(state, baseId(kind)), name: props.name, style: ownStyle, props, children: [], shape });
        return;
      }
      default:
        throw new TemplateCompileError(`Unknown artisan primitive "${kind}"`, path);
    }
  }
  if (typeof type === 'function') {
    if ((type as any).prototype?.isReactComponent) throw new TemplateCompileError(`Class components are not supported (${type.name}); use function components.`, path);
    let rendered: unknown;
    try {
      rendered = (type as any)(props);
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      if (/Invalid hook call|useState|useEffect|dispatcher/i.test(msg)) {
        throw new TemplateCompileError(`Component ${type.name || 'anonymous'} uses React hooks, which are not supported in GameArtisan templates (templates are pure functions of props).`, path);
      }
      throw e;
    }
    evaluate(rendered, `${path}`, inherited, state, out);
    return;
  }
  if (typeof type === 'string') {
    const tag = type.toLowerCase();
    if (tag === 'br') return;
    if (tag === 'img') {
      out.push({ kind: 'image', id: uniqueId(state, baseId('image')), name: props.alt ?? props.name, style: ownStyle, props, children: [], src: props.src });
      return;
    }
    if (tag === 'svg') throw new TemplateCompileError('Inline <svg> JSX is not supported; use <VectorImage markup={...} /> or <Layer.Path d="..."/>.', path);
    const tagDefaults = TAG_TEXT_DEFAULTS[tag] ?? {};
    const styleWithDefaults = { ...tagDefaults, ...ownStyle };
    if (TEXT_TAGS.has(tag)) {
      const t = textOf(props.children);
      if (t != null) {
        out.push(makeTextNode(state, baseId('text'), t, inherited, styleWithDefaults, props));
        return;
      }
    }
    if (BOX_TAGS.has(tag) || TEXT_TAGS.has(tag)) {
      const children: LNode[] = [];
      evaluate(props.children, path, { ...inherited, ...pickText(styleWithDefaults) }, state, children);
      out.push({ kind: 'box', id: uniqueId(state, baseId('group')), name: props.name ?? props.className, style: styleWithDefaults, props, children });
      return;
    }
    throw new TemplateCompileError(`Unsupported intrinsic element <${tag}>`, path);
  }
  throw new TemplateCompileError(`Unsupported element type at ${path}`, path);
}

// ---------------------------------------------------------------------------------------
// Yoga

const yogaValue = (v: unknown): number | `${number}%` | 'auto' | undefined => {
  if (v == null) return undefined;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  if (s === 'auto') return 'auto';
  if (s.endsWith('%')) return s as `${number}%`;
  const n = parseFloat(s);
  return isFinite(n) ? n : undefined;
};

function applyYoga(y: YogaNode, s: ArtisanStyle, fillParent: boolean): void {
  const set = (fn: (v: any) => void, v: unknown) => {
    const val = yogaValue(v);
    if (val !== undefined) fn(val);
  };
  const hasPos = s.position === 'absolute';
  const noBox = s.width == null && s.height == null && s.left == null && s.top == null && s.right == null && s.bottom == null && s.inset == null;
  if (hasPos || (fillParent && (s.position == null || noBox))) y.setPositionType(PositionType.Absolute);
  else y.setPositionType(PositionType.Relative);
  if (fillParent && noBox) {
    for (const e of [Edge.Left, Edge.Top, Edge.Right, Edge.Bottom]) y.setPosition(e, 0);
  }
  if (s.inset != null) for (const e of [Edge.Left, Edge.Top, Edge.Right, Edge.Bottom]) set((v) => y.setPosition(e, v), s.inset);
  set((v) => y.setPosition(Edge.Left, v), s.left);
  set((v) => y.setPosition(Edge.Top, v), s.top);
  set((v) => y.setPosition(Edge.Right, v), s.right);
  set((v) => y.setPosition(Edge.Bottom, v), s.bottom);
  set((v) => y.setWidth(v), s.width);
  set((v) => y.setHeight(v), s.height);
  set((v) => y.setMinWidth(v), s.minWidth);
  set((v) => y.setMinHeight(v), s.minHeight);
  set((v) => y.setMaxWidth(v), s.maxWidth);
  set((v) => y.setMaxHeight(v), s.maxHeight);
  const edges: [keyof ArtisanStyle, Edge][] = [
    ['margin', Edge.All], ['marginTop', Edge.Top], ['marginRight', Edge.Right], ['marginBottom', Edge.Bottom], ['marginLeft', Edge.Left], ['marginHorizontal', Edge.Horizontal], ['marginVertical', Edge.Vertical],
  ];
  for (const [k, e] of edges) set((v) => y.setMargin(e, v), s[k]);
  const pads: [keyof ArtisanStyle, Edge][] = [
    ['padding', Edge.All], ['paddingTop', Edge.Top], ['paddingRight', Edge.Right], ['paddingBottom', Edge.Bottom], ['paddingLeft', Edge.Left], ['paddingHorizontal', Edge.Horizontal], ['paddingVertical', Edge.Vertical],
  ];
  for (const [k, e] of pads) set((v) => y.setPadding(e, v), s[k]);
  if (s.borderWidth != null) y.setBorder(Edge.All, s.borderWidth);
  if (s.display === 'none') y.setDisplay(Display.None);
  const fd = { row: FlexDirection.Row, column: FlexDirection.Column, 'row-reverse': FlexDirection.RowReverse, 'column-reverse': FlexDirection.ColumnReverse };
  y.setFlexDirection(fd[s.flexDirection ?? (s.display === 'flex' ? 'row' : 'column')] ?? FlexDirection.Column);
  const jc: Record<string, Justify> = { 'flex-start': Justify.FlexStart, start: Justify.FlexStart, center: Justify.Center, 'flex-end': Justify.FlexEnd, end: Justify.FlexEnd, 'space-between': Justify.SpaceBetween, 'space-around': Justify.SpaceAround, 'space-evenly': Justify.SpaceEvenly };
  if (s.justifyContent) y.setJustifyContent(jc[s.justifyContent] ?? Justify.FlexStart);
  const al: Record<string, Align> = { auto: Align.Auto, 'flex-start': Align.FlexStart, start: Align.FlexStart, center: Align.Center, 'flex-end': Align.FlexEnd, end: Align.FlexEnd, stretch: Align.Stretch, baseline: Align.Baseline, 'space-between': Align.SpaceBetween, 'space-around': Align.SpaceAround };
  if (s.alignItems) y.setAlignItems(al[s.alignItems]);
  if (s.alignSelf) y.setAlignSelf(al[s.alignSelf]);
  if (s.alignContent) y.setAlignContent(al[s.alignContent]);
  if (s.flex != null) {
    y.setFlexGrow(s.flex);
    y.setFlexShrink(1);
    y.setFlexBasis(0);
  }
  if (s.flexGrow != null) y.setFlexGrow(s.flexGrow);
  if (s.flexShrink != null) y.setFlexShrink(s.flexShrink);
  set((v) => y.setFlexBasis(v), s.flexBasis);
  if (s.flexWrap) y.setFlexWrap(s.flexWrap === 'wrap' ? Wrap.Wrap : s.flexWrap === 'wrap-reverse' ? Wrap.WrapReverse : Wrap.NoWrap);
  if (s.gap != null) y.setGap(Gutter.All, s.gap);
  if (s.rowGap != null) y.setGap(Gutter.Row, s.rowGap);
  if (s.columnGap != null) y.setGap(Gutter.Column, s.columnGap);
  if (s.aspectRatio != null) y.setAspectRatio(s.aspectRatio);
  if (s.overflow === 'hidden') y.setOverflow(Overflow.Hidden);
}

function buildYoga(Y: Yoga, config: any, ln: LNode, env: CompileEnv): YogaNode {
  const y = Y.Node.create(config);
  ln.yoga = y;
  applyYoga(y, ln.style, !!ln.fillParent);
  if (ln.kind === 'text' && ln.text) {
    const t = ln.text;
    y.setMeasureFunc((width, widthMode) => {
      const maxWidth = widthMode === MeasureMode.Undefined ? Infinity : width;
      const l = layoutText(t.content, t.style, env.fonts, { maxWidth, locale: env.locale });
      const w = widthMode === MeasureMode.Exactly ? width : Math.min(Math.ceil(l.width * 100) / 100, maxWidth);
      return { width: w, height: l.height };
    });
  } else if ((ln.kind === 'image' || ln.kind === 'svg') && ln.asset?.width && ln.asset?.height) {
    const s = ln.style;
    const hasW = s.width != null || (s.left != null && s.right != null);
    const hasH = s.height != null || (s.top != null && s.bottom != null);
    if (!hasW && !hasH) {
      y.setWidth(ln.asset.width);
      y.setHeight(ln.asset.height);
    } else if (!hasW || !hasH) {
      if (s.aspectRatio == null) y.setAspectRatio(ln.asset.width / ln.asset.height);
    }
  }
  ln.children.forEach((c, i) => y.insertChild(buildYoga(Y, config, c, env), i));
  return y;
}

// ---------------------------------------------------------------------------------------
// LNode → UDM

function commonFields(ln: LNode, w: number, h: number, x: number, y: number) {
  const s = ln.style;
  const p = ln.props;
  const css = parseCssTransform(s.transform, w, h);
  const filter = parseFilter(s.filter);
  let originX = 0.5, originY = 0.5;
  if (s.transformOrigin) {
    const o = parseObjectPosition(s.transformOrigin);
    originX = o.x;
    originY = o.y;
  }
  const effects: Effect[] = [...parseShadows(s.boxShadow), ...filter.effects, ...(ln.text?.effects ?? []), ...(p.effects ?? [])];
  const adjustments: Adjustment[] = [...filter.adjustments, ...(p.adjustments ?? [])];
  const bindings: Record<string, string> = {};
  for (const [k, v] of Object.entries((p.bind ?? {}) as Record<string, string>)) {
    const path = ['x', 'y', 'width', 'height', 'rotation', 'scaleX', 'scaleY', 'skewX', 'skewY'].includes(k) ? `transform.${k}` : k;
    bindings[path] = v;
  }
  const opacity = (s.opacity ?? 1) * (p.opacity ?? 1);
  return {
    id: ln.id,
    name: ln.name ?? p.name,
    visible: !p.hidden,
    locked: !!p.locked,
    opacity: Math.max(0, Math.min(1, opacity)),
    blendMode: p.blendMode ?? s.mixBlendMode ?? 'normal',
    transform: {
      x: x + css.tx,
      y: y + css.ty,
      width: Math.max(0, w),
      height: Math.max(0, h),
      rotation: css.rotation + (p.rotation ?? 0),
      scaleX: css.scaleX * (p.scaleX ?? p.scale ?? 1),
      scaleY: css.scaleY * (p.scaleY ?? p.scale ?? 1),
      skewX: css.skewX + (p.skewX ?? 0),
      skewY: css.skewY + (p.skewY ?? 0),
      originX,
      originY,
    },
    effects,
    adjustments,
    clippingMask: !!p.clippingMask,
    bindings: Object.keys(bindings).length ? bindings : undefined,
    meta: p.meta,
  };
}

function shapeFill(p: any, s: ArtisanStyle): Fill {
  return parseFill(p.fill) ?? parseFill(s.backgroundImage) ?? parseFill(s.background) ?? parseFill(s.backgroundColor) ?? { type: 'solid', color: '#cccccc' };
}

function shapeStrokes(p: any, s: ArtisanStyle): Stroke[] {
  const out: Stroke[] = [...(p.strokes ?? [])];
  if (p.stroke) out.push({ color: p.stroke, width: p.strokeWidth ?? 1, cap: 'butt', join: 'miter', align: 'center' });
  const b = parseBorder(s.border) ?? (s.borderColor ? { color: s.borderColor, width: s.borderWidth ?? 1, cap: 'butt' as const, join: 'miter' as const, align: 'center' as const } : undefined);
  if (b) out.push(b);
  return out;
}

function toLayer(ln: LNode): Layer {
  const lay = ln.yoga!.getComputedLayout();
  const base = commonFields(ln, lay.width, lay.height, lay.left, lay.top);
  const p = ln.props;
  const s = ln.style;
  let layer: any;
  switch (ln.kind) {
    case 'text':
      layer = { ...base, type: 'text', content: ln.text!.content, style: ln.text!.style, sizing: p.sizing ?? 'fixed' };
      if (ln.text!.style.wrap === false && !p.sizing) layer.sizing = 'auto-width';
      // Keep a little slack so floating point never causes an extra wrap at render time.
      if (layer.sizing === 'fixed') layer.transform.width = layer.transform.width + 0.01;
      break;
    case 'image':
      layer = {
        ...base,
        type: 'raster',
        src: ln.src ?? '',
        fit: p.fit ?? s.objectFit ?? 'cover',
        position: p.position ?? parseObjectPosition(s.objectPosition),
        rendering: p.rendering ?? (s.imageRendering === 'pixelated' || s.imageRendering === 'crisp-edges' ? 'pixelated' : 'auto'),
        cornerRadius: p.cornerRadius ?? s.borderRadius ?? 0,
      };
      break;
    case 'svg':
      layer = { ...base, type: 'svg', src: ln.src, markup: p.markup, fit: p.fit ?? 'contain', color: p.fill ?? p.color };
      break;
    case 'gradient': {
      const colors: string[] = p.colors ?? ['#000', 'transparent'];
      const stops = colors.map((color, i) => ({ color, offset: p.stops?.[i] ?? (colors.length === 1 ? 0 : i / (colors.length - 1)) }));
      const frac = (v: unknown, d: number) => (v == null ? d : typeof v === 'number' ? (v > 1 ? v / 100 : v) : String(v).endsWith('%') ? parseFloat(String(v)) / 100 : parseFloat(String(v)));
      const fill: Fill =
        p.type === 'radial'
          ? { type: 'radial-gradient', cx: frac(p.cx, 0.5), cy: frac(p.cy, 0.5), r: frac(p.radius, 0.5), stops }
          : { type: 'linear-gradient', angle: p.angle ?? 180, stops };
      layer = { ...base, type: 'vector', shape: { kind: 'rect', cornerRadius: s.borderRadius ?? 0 }, fill, strokes: [] };
      break;
    }
    case 'shape':
      layer = { ...base, type: 'vector', shape: ln.shape, fill: shapeFill(p, s), strokes: shapeStrokes(p, s) };
      break;
    case 'halftone':
      layer = { ...base, type: 'halftone', spacing: p.spacing, angle: p.angle, dot: p.dot, minSize: p.minSize, maxSize: p.maxSize, gradientAngle: p.gradientAngle, falloff: p.falloff, color: p.color };
      break;
    case 'pattern':
      layer = { ...base, type: 'pattern', pattern: p.pattern, spacing: p.spacing, thickness: p.thickness, color: p.color, background: p.background };
      break;
    case 'mask':
      layer = { ...base, type: 'mask', mode: p.mode ?? 'alpha', mask: toLayer(ln.mask!), children: ln.children.map(toLayer) };
      break;
    case 'boolean':
      layer = { ...base, type: 'boolean', operation: p.operation ?? 'union', fill: shapeFill(p, s), strokes: shapeStrokes(p, s), children: ln.children.map(toLayer) };
      break;
    case 'box': {
      const children = ln.children.map(toLayer);
      const bgImage = typeof s.backgroundImage === 'string' && /^url\(/.test(s.backgroundImage) ? /url\(["']?([^"')]+)["']?\)/.exec(s.backgroundImage)?.[1] : undefined;
      if (bgImage) {
        children.unshift(
          LayerSchema.parse({
            id: `${ln.id}-bg`,
            type: 'raster',
            src: bgImage,
            fit: s.backgroundSize === 'contain' ? 'contain' : 'cover',
            transform: { x: 0, y: 0, width: lay.width, height: lay.height },
          }),
        );
      }
      const fill = bgImage ? parseFill(s.backgroundColor) : parseFill(p.fill) ?? parseFill(s.backgroundImage) ?? parseFill(s.background) ?? parseFill(s.backgroundColor);
      const strokes = shapeStrokes({ strokes: p.strokes }, s);
      layer = { ...base, type: 'group', fill, strokes, cornerRadius: s.borderRadius ?? 0, clipContent: !!p.clip || s.overflow === 'hidden', children };
      break;
    }
  }
  return layer as Layer;
}

function collectAssetNodes(ln: LNode, out: LNode[]): void {
  if ((ln.kind === 'image' || ln.kind === 'svg') && ln.src) out.push(ln);
  ln.children.forEach((c) => collectAssetNodes(c, out));
  if (ln.mask) collectAssetNodes(ln.mask, out);
}

/** Evaluate a template element into an LNode forest (sync; render context is active). */
function evaluateRoot(element: unknown, ctx: RenderContext): LNode[] {
  const state: EvalState = { ids: new Set() };
  const out: LNode[] = [];
  withRenderContext(ctx, () => evaluate(element, '', {}, state, out));
  return out;
}

/** Compile a JSX element tree into a concrete UDM artboard. */
export async function compileElement(element: unknown, env: CompileEnv): Promise<Artboard> {
  const roots = evaluateRoot(element, { compositionId: env.compositionId, width: env.width, height: env.height, locale: env.locale, props: env.props ?? {}, surface: env.surface });

  // Resolve intrinsic sizes for images without explicit dimensions.
  const assetNodes: LNode[] = [];
  roots.forEach((r) => collectAssetNodes(r, assetNodes));
  await Promise.all(
    assetNodes.map(async (n) => {
      if (!env.assets || !n.src) return;
      try {
        n.asset = await env.assets.resolve(n.src);
      } catch {
        /* the emitter reports missing assets */
      }
    }),
  );

  const Y = await getYoga();
  const config = Y.Config.create();
  config.setPointScaleFactor(0);
  const container = Y.Node.create(config);
  container.setWidth(env.width);
  container.setHeight(env.height);
  container.setFlexDirection(FlexDirection.Column);
  roots.forEach((r, i) => container.insertChild(buildYoga(Y, config, r, env), i));
  try {
    container.calculateLayout(env.width, env.height, Direction.LTR);
    let layers = roots.map(toLayer);
    let background = env.background;
    // Promote a full-bleed root frame to the artboard (cleaner layer tree for the Studio).
    if (layers.length === 1 && layers[0].type === 'group') {
      const g = layers[0];
      const t = g.transform;
      const plain = t.x === 0 && t.y === 0 && Math.abs(t.width - env.width) < 0.5 && Math.abs(t.height - env.height) < 0.5 && !t.rotation && t.scaleX === 1 && t.scaleY === 1 && !t.skewX && !t.skewY;
      if (plain && !g.effects.length && !g.adjustments.length && g.opacity === 1 && g.blendMode === 'normal' && !g.strokes.length && !g.cornerRadius && !g.clippingMask) {
        background = g.fill ?? background;
        layers = g.children;
      }
    }
    return ArtboardSchema.parse({
      id: env.artboardId ?? env.compositionId ?? 'artboard',
      width: env.width,
      height: env.height,
      background,
      children: layers,
      locale: env.locale,
    });
  } finally {
    container.freeRecursive();
  }
}
