/**
 * JSX primitives for code-as-canvas templates. They are inert marker components: the
 * GameArtisan compiler reads their props and builds UDM layers (no React renderer needed,
 * like Satori). They work with React's JSX runtime or any element-shaped objects.
 */
import type { Adjustment, BlendMode, Effect, Fill, Stroke, TextStyle } from '../udm/schema.js';

export type Length = number | `${number}%` | `${number}px` | 'auto';

/** CSS-like style subset understood by the compiler (layout uses Yoga flexbox). */
export interface ArtisanStyle {
  position?: 'absolute' | 'relative' | 'static';
  top?: Length;
  right?: Length;
  bottom?: Length;
  left?: Length;
  inset?: Length;
  width?: Length;
  height?: Length;
  minWidth?: Length;
  minHeight?: Length;
  maxWidth?: Length;
  maxHeight?: Length;
  margin?: Length;
  marginTop?: Length;
  marginRight?: Length;
  marginBottom?: Length;
  marginLeft?: Length;
  marginHorizontal?: Length;
  marginVertical?: Length;
  padding?: Length;
  paddingTop?: Length;
  paddingRight?: Length;
  paddingBottom?: Length;
  paddingLeft?: Length;
  paddingHorizontal?: Length;
  paddingVertical?: Length;
  display?: 'flex' | 'none' | 'block';
  flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse';
  justifyContent?: 'flex-start' | 'center' | 'flex-end' | 'space-between' | 'space-around' | 'space-evenly' | 'start' | 'end';
  alignItems?: 'flex-start' | 'center' | 'flex-end' | 'stretch' | 'baseline' | 'start' | 'end';
  alignSelf?: 'auto' | 'flex-start' | 'center' | 'flex-end' | 'stretch' | 'baseline';
  alignContent?: 'flex-start' | 'center' | 'flex-end' | 'stretch' | 'space-between' | 'space-around';
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: Length;
  flex?: number;
  flexWrap?: 'wrap' | 'nowrap' | 'wrap-reverse';
  gap?: number;
  rowGap?: number;
  columnGap?: number;
  aspectRatio?: number;
  overflow?: 'visible' | 'hidden';
  // paint
  opacity?: number;
  backgroundColor?: string;
  backgroundImage?: string;
  background?: string;
  borderRadius?: number;
  border?: string;
  borderWidth?: number;
  borderColor?: string;
  boxShadow?: string;
  filter?: string;
  mixBlendMode?: BlendMode;
  transform?: string;
  transformOrigin?: string;
  objectFit?: 'cover' | 'contain' | 'fill' | 'none';
  objectPosition?: string;
  imageRendering?: 'auto' | 'pixelated' | 'smooth' | 'crisp-edges';
  // text (inherited)
  color?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number | 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  letterSpacing?: number | string;
  lineHeight?: number | string;
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  textShadow?: string;
  WebkitTextStroke?: string;
  verticalAlign?: 'top' | 'middle' | 'bottom';
  whiteSpace?: 'normal' | 'nowrap' | 'pre' | 'pre-wrap';
  [key: string]: unknown;
}

export interface CommonLayerProps {
  id?: string;
  key?: string | number;
  name?: string;
  style?: ArtisanStyle;
  /** Shorthands: absolute position/size relative to the parent. */
  x?: number;
  y?: number;
  width?: Length;
  height?: Length;
  rotation?: number;
  scale?: number;
  scaleX?: number;
  scaleY?: number;
  skewX?: number;
  skewY?: number;
  opacity?: number;
  blendMode?: BlendMode;
  hidden?: boolean;
  locked?: boolean;
  effects?: Effect[];
  adjustments?: Adjustment[];
  /** Clip to the alpha of the previous sibling (Photoshop clipping mask). */
  clippingMask?: boolean;
  /** Bind layer fields to props for two-way Studio editing, e.g. `{ x: 'heroX', y: 'heroY' }`. */
  bind?: Partial<Record<'x' | 'y' | 'width' | 'height' | 'rotation' | 'scaleX' | 'scaleY' | 'opacity' | 'content' | 'src', string>> & Record<string, string>;
  meta?: Record<string, unknown>;
  children?: unknown;
}

export interface ImageProps extends CommonLayerProps {
  src: string;
  fit?: 'cover' | 'contain' | 'fill' | 'none';
  position?: { x: number; y: number };
  rendering?: 'auto' | 'pixelated' | 'smooth';
  cornerRadius?: number;
}

export interface GradientProps extends CommonLayerProps {
  type?: 'linear' | 'radial';
  angle?: number;
  colors: string[];
  stops?: number[];
  cx?: number | string;
  cy?: number | string;
  radius?: number | string;
}

export interface ShapeProps extends CommonLayerProps {
  fill?: string | Fill;
  stroke?: string;
  strokeWidth?: number;
  strokes?: Stroke[];
}

export interface RectProps extends ShapeProps {
  cornerRadius?: number | [number, number, number, number];
}
export interface PolygonProps extends ShapeProps {
  sides?: number;
}
export interface StarProps extends ShapeProps {
  points?: number;
  innerRatio?: number;
}
export interface PathProps extends ShapeProps {
  d: string;
  viewBox?: [number, number, number, number];
  fillRule?: 'nonzero' | 'evenodd';
}
export interface LineProps extends ShapeProps {
  points: { x: number; y: number }[];
  closed?: boolean;
}

export interface TextProps extends CommonLayerProps {
  content?: string | number;
  /** Fill override (colour, CSS gradient string or Fill) */
  fill?: string | Fill;
  /** Multi-stroke outlines, inner → outer */
  strokes?: Stroke[];
  fit?: 'none' | 'shrink';
  minFontSize?: number;
  maxLines?: number;
  sizing?: 'fixed' | 'auto-height' | 'auto-width';
  textStyle?: Partial<TextStyle>;
}

export interface SvgProps extends CommonLayerProps {
  src?: string;
  markup?: string;
  /** Recolour (single-colour icons). Alias: color */
  fill?: string;
  color?: string;
  fit?: 'contain' | 'cover' | 'fill';
}

export interface GroupProps extends CommonLayerProps {
  fill?: string | Fill;
  clip?: boolean;
}

export interface HalftoneProps extends CommonLayerProps {
  spacing?: number;
  angle?: number;
  dot?: 'circle' | 'square' | 'diamond' | 'line';
  minSize?: number;
  maxSize?: number;
  gradientAngle?: number;
  falloff?: 'linear' | 'radial';
  color?: string;
}

export interface PatternProps extends CommonLayerProps {
  pattern?: 'scanlines' | 'grid' | 'dots' | 'checker' | 'diagonal';
  spacing?: number;
  thickness?: number;
  color?: string;
  background?: string;
}

export interface MaskProps extends CommonLayerProps {
  mask: unknown;
  mode?: 'alpha' | 'luminance';
}

export interface BooleanProps extends ShapeProps {
  operation?: 'union' | 'subtract' | 'intersect' | 'exclude';
}

export const ARTISAN_KIND = '__artisan';

type Marker<P> = ((props: P) => null) & { [ARTISAN_KIND]: string; displayName: string };

function marker<P>(kind: string, displayName: string): Marker<P> {
  const C = ((_props: P) => null) as Marker<P>;
  C[ARTISAN_KIND] = kind;
  C.displayName = displayName;
  return C;
}

export const Image = marker<ImageProps>('image', 'Layer.Image');
export const Gradient = marker<GradientProps>('gradient', 'Layer.Gradient');
export const Group = marker<GroupProps>('group', 'Layer.Group');
export const Rect = marker<RectProps>('rect', 'Layer.Rect');
export const Ellipse = marker<ShapeProps>('ellipse', 'Layer.Ellipse');
export const Polygon = marker<PolygonProps>('polygon', 'Layer.Polygon');
export const Star = marker<StarProps>('star', 'Layer.Star');
export const Path = marker<PathProps>('path', 'Layer.Path');
export const Line = marker<LineProps>('line', 'Layer.Line');
export const Text = marker<TextProps>('text', 'Text');
export const VectorImage = marker<SvgProps>('svg', 'VectorImage');
export const Halftone = marker<HalftoneProps>('halftone', 'Layer.Halftone');
export const Pattern = marker<PatternProps>('pattern', 'Layer.Pattern');
export const Mask = marker<MaskProps>('mask', 'Layer.Mask');
export const BooleanShape = marker<BooleanProps>('boolean', 'Layer.Boolean');

/** Namespace used in templates: `<Layer.Image />`, `<Layer.Gradient />`, ... */
export const Layer = {
  Image,
  Gradient,
  Group,
  Rect,
  Ellipse,
  Polygon,
  Star,
  Path,
  Line,
  Text,
  Svg: VectorImage,
  Halftone,
  Pattern,
  Mask,
  Boolean: BooleanShape,
};

export function getArtisanKind(type: unknown): string | undefined {
  return typeof type === 'function' ? (type as any)[ARTISAN_KIND] : undefined;
}

// Value + type share names so `Layer.Image` (component namespace) and `Layer` (UDM type) can
// both be imported from '@game-artisan/core'.
export type Layer = import('../udm/schema.js').Layer;
export type Rect = import('../math/matrix.js').Rect;
