/**
 * Unified Declarative Document Model (UDM).
 *
 * A deterministic, JSON-serialisable AST shared by the CLI renderers, the Studio and the
 * agent tooling. Every value field may alternatively hold a VariableProp binding
 * (`{ "$prop": "title" }`) which is resolved against composition props before rendering.
 */
import { z } from 'zod';

export const UDM_VERSION = 1 as const;

// ---------------------------------------------------------------------------------------
// Variable props

export const VariablePropSchema = z
  .object({
    $prop: z.string().describe('Name of the composition prop this value is bound to'),
    fallback: z.unknown().optional(),
    /** Optional template, e.g. "{value}%" — `{value}` is replaced with the prop value. */
    format: z.string().optional(),
  })
  .meta({ id: 'VariableProp', description: 'Binding of a field to a dynamic prop' });
export type VariableProp = z.infer<typeof VariablePropSchema>;

/** Accepts a literal of type T or a VariableProp binding. */
export const v = <T extends z.ZodType>(schema: T) => z.union([schema, VariablePropSchema]);

// ---------------------------------------------------------------------------------------
// Primitives

export const BlendModeSchema = z
  .enum([
    'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn',
    'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
  ])
  .meta({ id: 'BlendMode' });
export type BlendMode = z.infer<typeof BlendModeSchema>;

export const TransformSchema = z
  .object({
    x: z.number().default(0),
    y: z.number().default(0),
    width: z.number().min(0).default(100),
    height: z.number().min(0).default(100),
    rotation: z.number().default(0).describe('Degrees, clockwise'),
    scaleX: z.number().default(1),
    scaleY: z.number().default(1),
    skewX: z.number().default(0).describe('Degrees'),
    skewY: z.number().default(0).describe('Degrees'),
    originX: z.number().default(0.5).describe('Pivot as a fraction of width'),
    originY: z.number().default(0.5).describe('Pivot as a fraction of height'),
    flipX: z.boolean().optional(),
    flipY: z.boolean().optional(),
  })
  .meta({ id: 'Transform', description: 'Local box (x,y,width,height) in parent space plus affine T·R·K·S about origin' });
export type Transform = z.infer<typeof TransformSchema>;

export const GradientStopSchema = z.object({ offset: z.number().min(0).max(1), color: z.string() }).meta({ id: 'GradientStop' });
export type GradientStop = z.infer<typeof GradientStopSchema>;

export const SolidFillSchema = z.object({ type: z.literal('solid'), color: z.string() });
export const LinearGradientFillSchema = z.object({
  type: z.literal('linear-gradient'),
  angle: z.number().default(180).describe('CSS angle: 0 = to top, 90 = to right, 180 = to bottom'),
  stops: z.array(GradientStopSchema).min(1),
});
export const RadialGradientFillSchema = z.object({
  type: z.literal('radial-gradient'),
  cx: z.number().default(0.5),
  cy: z.number().default(0.5),
  r: z.number().default(0.5).describe('Radius as fraction of the box (elliptical)'),
  fx: z.number().optional(),
  fy: z.number().optional(),
  stops: z.array(GradientStopSchema).min(1),
});
export const NoneFillSchema = z.object({ type: z.literal('none') });
export const FillSchema = z
  .discriminatedUnion('type', [SolidFillSchema, LinearGradientFillSchema, RadialGradientFillSchema, NoneFillSchema])
  .meta({ id: 'Fill' });
export type Fill = z.infer<typeof FillSchema>;

export const StrokeSchema = z
  .object({
    fill: FillSchema.optional(),
    color: z.string().optional().describe('Shorthand for a solid fill'),
    width: z.number().min(0).default(1),
    dash: z.array(z.number()).optional(),
    dashOffset: z.number().optional(),
    cap: z.enum(['butt', 'round', 'square']).default('butt'),
    join: z.enum(['miter', 'round', 'bevel']).default('miter'),
    miterLimit: z.number().optional(),
    align: z.enum(['center', 'outside']).default('center').describe('outside: drawn behind the fill (logo-style outlines)'),
    opacity: z.number().min(0).max(1).optional(),
  })
  .meta({ id: 'Stroke' });
export type Stroke = z.infer<typeof StrokeSchema>;

// ---------------------------------------------------------------------------------------
// Effects (layer styles) & adjustments (colour filters)

const shadowBase = {
  color: z.string().default('rgba(0,0,0,0.6)'),
  x: z.number().default(0),
  y: z.number().default(4),
  blur: z.number().min(0).default(8),
  spread: z.number().default(0),
  opacity: z.number().min(0).max(1).default(1),
};
export const EffectSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('drop-shadow'), ...shadowBase }),
    z.object({ type: z.literal('inner-shadow'), ...shadowBase }),
    z.object({
      type: z.literal('outer-glow'),
      color: z.string().default('#ffffff'),
      radius: z.number().min(0).default(4).describe('Alpha dilation radius'),
      blur: z.number().min(0).default(12),
      opacity: z.number().min(0).max(1).default(0.9),
      blendMode: BlendModeSchema.default('normal'),
    }),
    z.object({
      type: z.literal('rim-light'),
      color: z.string().default('#ffffff'),
      width: z.number().min(0).default(3),
      blur: z.number().min(0).default(2),
      angle: z.number().default(315).describe('Direction the light comes from (degrees)'),
      opacity: z.number().min(0).max(1).default(1),
      blendMode: BlendModeSchema.default('screen'),
    }),
    z.object({ type: z.literal('outline'), color: z.string().default('#000000'), width: z.number().min(0).default(2), opacity: z.number().min(0).max(1).default(1) }),
    z.object({ type: z.literal('silhouette'), color: z.string().default('#000000'), opacity: z.number().min(0).max(1).default(1) }),
  ])
  .meta({ id: 'Effect' });
export type Effect = z.infer<typeof EffectSchema>;

export const AdjustmentSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('brightness'), value: z.number().default(1) }),
    z.object({ type: z.literal('contrast'), value: z.number().default(1) }),
    z.object({ type: z.literal('saturate'), value: z.number().default(1) }),
    z.object({ type: z.literal('exposure'), value: z.number().default(0).describe('Stops (EV)') }),
    z.object({ type: z.literal('gamma'), value: z.number().default(1) }),
    z.object({ type: z.literal('hue-rotate'), value: z.number().default(0).describe('Degrees') }),
    z.object({ type: z.literal('grayscale'), value: z.number().min(0).max(1).default(1) }),
    z.object({ type: z.literal('sepia'), value: z.number().min(0).max(1).default(1) }),
    z.object({ type: z.literal('invert'), value: z.number().min(0).max(1).default(1) }),
    z.object({ type: z.literal('temperature'), value: z.number().min(-1).max(1).default(0) }),
    z.object({ type: z.literal('tint'), color: z.string(), amount: z.number().min(0).max(1).default(0.2) }),
    z.object({ type: z.literal('blur'), radius: z.number().min(0).default(4) }),
    z.object({ type: z.literal('sharpen'), amount: z.number().min(0).default(0.5) }),
    z.object({ type: z.literal('vignette'), amount: z.number().min(0).max(1).default(0.5), size: z.number().min(0).max(1).default(0.6), color: z.string().default('#000000') }),
    z.object({ type: z.literal('bloom'), threshold: z.number().min(0).max(1).default(0.7), radius: z.number().min(0).default(10), intensity: z.number().min(0).default(0.8) }),
    z.object({ type: z.literal('pixelate'), size: z.number().min(1).default(8) }),
    z.object({ type: z.literal('posterize'), levels: z.number().int().min(2).max(32).default(4) }),
    z.object({
      type: z.literal('palette'),
      preset: z.enum(['gameboy', 'gameboy-pocket', 'mono', 'sepia-4', 'cga', 'custom']).default('gameboy'),
      colors: z.array(z.string()).optional().describe('Custom palette (dark → light) for preset=custom'),
    }),
    z.object({ type: z.literal('duotone'), shadows: z.string(), highlights: z.string() }),
    z.object({ type: z.literal('chromatic-aberration'), offset: z.number().default(2) }),
    z.object({ type: z.literal('scanlines'), spacing: z.number().min(1).default(3), thickness: z.number().min(0.1).default(1), opacity: z.number().min(0).max(1).default(0.35), color: z.string().default('#000000') }),
    z.object({ type: z.literal('noise'), amount: z.number().min(0).max(1).default(0.15), seed: z.number().int().default(1) }),
  ])
  .meta({ id: 'Adjustment' });
export type Adjustment = z.infer<typeof AdjustmentSchema>;

// ---------------------------------------------------------------------------------------
// Typography

export const TextStyleSchema = z
  .object({
    fontFamily: z.string().default('Inter').describe('Comma separated family list, first match wins'),
    fontSize: z.number().min(1).default(32),
    fontWeight: z.number().min(100).max(1000).default(400),
    fontStyle: z.enum(['normal', 'italic']).default('normal'),
    letterSpacing: z.number().default(0).describe('Tracking in px'),
    lineHeight: z.number().default(1.2).describe('Multiplier of font size'),
    textAlign: z.enum(['left', 'center', 'right', 'justify']).default('left'),
    verticalAlign: z.enum(['top', 'middle', 'bottom']).default('top'),
    textTransform: z.enum(['none', 'uppercase', 'lowercase', 'capitalize']).default('none'),
    fill: FillSchema.default({ type: 'solid', color: '#ffffff' }),
    strokes: z.array(StrokeSchema).default([]).describe('Multi-stroke outlines, listed inner → outer'),
    fit: z.enum(['none', 'shrink']).default('none').describe('shrink: reduce font size until text fits the box'),
    minFontSize: z.number().min(1).default(6),
    maxLines: z.number().int().min(1).optional(),
    wrap: z.boolean().default(true),
  })
  .meta({ id: 'TextStyle' });
export type TextStyle = z.infer<typeof TextStyleSchema>;

// ---------------------------------------------------------------------------------------
// Layers

const LayerBase = {
  id: z.string(),
  name: z.string().optional(),
  visible: z.boolean().default(true),
  locked: z.boolean().default(false),
  opacity: z.number().min(0).max(1).default(1),
  blendMode: BlendModeSchema.default('normal'),
  transform: TransformSchema,
  effects: z.array(EffectSchema).default([]),
  adjustments: z.array(AdjustmentSchema).default([]),
  /** Clip this layer by the alpha of the nearest non-clipping layer below it (Photoshop-style clipping mask). */
  clippingMask: z.boolean().default(false),
  /** Maps a layer field path (e.g. "transform.x") to the prop that drives it — enables canvas → props sync. */
  bindings: z.record(z.string(), z.string()).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
};

export const ShapeSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('rect'), cornerRadius: z.union([z.number(), z.tuple([z.number(), z.number(), z.number(), z.number()])]).default(0) }),
    z.object({ kind: z.literal('ellipse') }),
    z.object({ kind: z.literal('polygon'), sides: z.number().int().min(3).default(6), rotation: z.number().default(0) }),
    z.object({ kind: z.literal('star'), points: z.number().int().min(2).default(5), innerRatio: z.number().min(0).max(1).default(0.5), rotation: z.number().default(0) }),
    z.object({
      kind: z.literal('path'),
      d: z.string(),
      viewBox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional().describe('Source coordinate box scaled into the layer box; omitted = path is in layer pixels'),
      fillRule: z.enum(['nonzero', 'evenodd']).default('nonzero'),
    }),
    z.object({ kind: z.literal('line'), points: z.array(z.object({ x: z.number(), y: z.number() })).min(2), closed: z.boolean().default(false) }),
  ])
  .meta({ id: 'Shape' });
export type Shape = z.infer<typeof ShapeSchema>;

export const VectorLayerSchema = z.object({
  ...LayerBase,
  type: z.literal('vector'),
  shape: ShapeSchema,
  fill: FillSchema.default({ type: 'solid', color: '#cccccc' }),
  strokes: z.array(StrokeSchema).default([]),
});

export const RasterLayerSchema = z.object({
  ...LayerBase,
  type: z.literal('raster'),
  src: z.string().describe('Path, URL or data URI'),
  fit: z.enum(['cover', 'contain', 'fill', 'none']).default('cover'),
  position: z.object({ x: z.number().min(0).max(1).default(0.5), y: z.number().min(0).max(1).default(0.5) }).default({ x: 0.5, y: 0.5 }),
  rendering: z.enum(['auto', 'pixelated', 'smooth']).default('auto'),
  cornerRadius: z.number().min(0).default(0),
});

export const TextLayerSchema = z.object({
  ...LayerBase,
  type: z.literal('text'),
  content: z.string(),
  style: TextStyleSchema,
  sizing: z.enum(['fixed', 'auto-height', 'auto-width']).default('fixed'),
});

export const SvgLayerSchema = z.object({
  ...LayerBase,
  type: z.literal('svg'),
  src: z.string().optional().describe('Path/URL/data URI of an SVG file'),
  markup: z.string().optional().describe('Inline SVG markup'),
  fit: z.enum(['contain', 'cover', 'fill']).default('contain'),
  color: z.string().optional().describe('Recolour every painted pixel (single-colour icons)'),
});

export const HalftoneLayerSchema = z.object({
  ...LayerBase,
  type: z.literal('halftone'),
  spacing: z.number().min(1).default(10),
  angle: z.number().default(45),
  dot: z.enum(['circle', 'square', 'diamond', 'line']).default('circle'),
  minSize: z.number().min(0).max(1).default(0.05).describe('Dot size at the light end as fraction of spacing'),
  maxSize: z.number().min(0).max(1.5).default(0.9),
  gradientAngle: z.number().default(180).describe('Direction the dots grow towards (CSS angle)'),
  falloff: z.enum(['linear', 'radial']).default('linear'),
  color: z.string().default('#000000'),
});

export const PatternLayerSchema = z.object({
  ...LayerBase,
  type: z.literal('pattern'),
  pattern: z.enum(['scanlines', 'grid', 'dots', 'checker', 'diagonal']).default('scanlines'),
  spacing: z.number().min(1).default(4),
  thickness: z.number().min(0.1).default(1),
  color: z.string().default('rgba(0,0,0,0.4)'),
  background: z.string().optional(),
});

export interface GroupLayer extends z.infer<typeof GroupLayerBaseSchema> {
  children: Layer[];
}
export interface MaskLayer extends z.infer<typeof MaskLayerBaseSchema> {
  mask: Layer;
  children: Layer[];
}
export interface BooleanLayer extends z.infer<typeof BooleanLayerBaseSchema> {
  children: Layer[];
}

const GroupLayerBaseSchema = z.object({
  ...LayerBase,
  type: z.literal('group'),
  fill: FillSchema.optional().describe('Frame background'),
  strokes: z.array(StrokeSchema).default([]),
  cornerRadius: z.number().min(0).default(0),
  clipContent: z.boolean().default(false),
});
const MaskLayerBaseSchema = z.object({
  ...LayerBase,
  type: z.literal('mask'),
  mode: z.enum(['alpha', 'luminance']).default('alpha'),
});
const BooleanLayerBaseSchema = z.object({
  ...LayerBase,
  type: z.literal('boolean'),
  operation: z.enum(['union', 'subtract', 'intersect', 'exclude']).default('union'),
  fill: FillSchema.default({ type: 'solid', color: '#cccccc' }),
  strokes: z.array(StrokeSchema).default([]),
});

export type VectorLayer = z.infer<typeof VectorLayerSchema>;
export type RasterLayer = z.infer<typeof RasterLayerSchema>;
export type TextLayer = z.infer<typeof TextLayerSchema>;
export type SvgLayer = z.infer<typeof SvgLayerSchema>;
export type HalftoneLayer = z.infer<typeof HalftoneLayerSchema>;
export type PatternLayer = z.infer<typeof PatternLayerSchema>;
export type Layer = VectorLayer | RasterLayer | TextLayer | SvgLayer | HalftoneLayer | PatternLayer | GroupLayer | MaskLayer | BooleanLayer;
export type LayerType = Layer['type'];

export const GroupLayerSchema: z.ZodType<GroupLayer> = GroupLayerBaseSchema.extend({
  get children() {
    return z.array(LayerSchema);
  },
}) as any;
export const MaskLayerSchema: z.ZodType<MaskLayer> = MaskLayerBaseSchema.extend({
  get mask() {
    return LayerSchema;
  },
  get children() {
    return z.array(LayerSchema);
  },
}) as any;
export const BooleanLayerSchema: z.ZodType<BooleanLayer> = BooleanLayerBaseSchema.extend({
  get children() {
    return z.array(LayerSchema);
  },
}) as any;

export const LayerSchema: z.ZodType<Layer> = z
  .lazy(() =>
    z.discriminatedUnion('type', [
      VectorLayerSchema,
      RasterLayerSchema,
      TextLayerSchema,
      SvgLayerSchema,
      HalftoneLayerSchema,
      PatternLayerSchema,
      GroupLayerSchema as any,
      MaskLayerSchema as any,
      BooleanLayerSchema as any,
    ]),
  )
  .meta({ id: 'Layer' }) as any;

// ---------------------------------------------------------------------------------------
// Artboards & documents

export const SafeZoneSchema = z
  .object({
    id: z.string(),
    label: z.string().optional(),
    kind: z.enum(['safe', 'danger', 'overlay']).default('safe').describe('safe: keep content inside; danger: client UI covers this area'),
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  })
  .meta({ id: 'SafeZone' });
export type SafeZone = z.infer<typeof SafeZoneSchema>;

export const GuideSchema = z.object({ axis: z.enum(['x', 'y']), position: z.number() }).meta({ id: 'Guide' });
export type Guide = z.infer<typeof GuideSchema>;

export const ArtboardSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    width: z.number().int().min(1).max(16384),
    height: z.number().int().min(1).max(16384),
    background: FillSchema.optional().describe('Omit for a transparent artboard'),
    children: z.array(LayerSchema).default([]),
    safeZones: z.array(SafeZoneSchema).default([]),
    guides: z.array(GuideSchema).default([]),
    preset: z.string().optional().describe('Store preset id this artboard was created from'),
    locale: z.string().optional(),
  })
  .meta({ id: 'Artboard' });
export type Artboard = z.infer<typeof ArtboardSchema>;

export const FontFaceSchema = z
  .object({ family: z.string(), src: z.string(), weight: z.number().default(400), style: z.enum(['normal', 'italic']).default('normal'), locales: z.array(z.string()).optional() })
  .meta({ id: 'FontFace' });
export type FontFace = z.infer<typeof FontFaceSchema>;

export const DocumentSchema = z
  .object({
    $schema: z.string().optional(),
    kind: z.literal('artisan-document').default('artisan-document'),
    version: z.literal(UDM_VERSION).default(UDM_VERSION),
    id: z.string(),
    name: z.string().default('Untitled'),
    description: z.string().optional(),
    artboards: z.array(ArtboardSchema).min(1),
    props: z
      .object({
        schema: z.record(z.string(), z.unknown()).describe('JSON Schema of the dynamic props'),
        defaults: z.record(z.string(), z.unknown()).default({}),
      })
      .optional(),
    fonts: z.array(FontFaceSchema).default([]),
    meta: z.record(z.string(), z.unknown()).optional(),
  })
  .meta({ id: 'Document', title: 'GameArtisan UDM Document' });
export type ArtisanDocument = z.infer<typeof DocumentSchema>;
export type ArtisanDocumentInput = z.input<typeof DocumentSchema>;
