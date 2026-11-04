/**
 * Ergonomic constructors that fill every default so code can build valid UDM trees quickly.
 */
import { ArtboardSchema, DocumentSchema, LayerSchema, TransformSchema, TextStyleSchema } from './schema.js';
import type { Artboard, ArtisanDocument, Layer, Transform, TextStyle } from './schema.js';
import { generateId } from './tree.js';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends any[] ? T[K] : DeepPartial<T[K]>) : T[K] };

export function createTransform(t: Partial<Transform> = {}): Transform {
  return TransformSchema.parse(t);
}

export function createTextStyle(s: Partial<TextStyle> = {}): TextStyle {
  return TextStyleSchema.parse(s);
}

type LayerInputOf<T extends Layer['type']> = Omit<Extract<Layer, { type: T }>, 'id' | 'transform' | 'visible' | 'locked' | 'opacity' | 'blendMode' | 'effects' | 'adjustments' | 'clippingMask'> & {
  id?: string;
  transform?: Partial<Transform>;
  visible?: boolean;
  locked?: boolean;
  opacity?: number;
  blendMode?: Layer['blendMode'];
  effects?: Layer['effects'];
  adjustments?: Layer['adjustments'];
  clippingMask?: boolean;
};

/** Create a fully-defaulted, validated layer. */
export function createLayer<T extends Layer['type']>(type: T, input: DeepPartial<LayerInputOf<T>> & Record<string, unknown>): Extract<Layer, { type: T }> {
  const raw: any = { ...input, type, id: (input as any).id ?? generateId(type) };
  raw.transform = { ...(input as any).transform };
  return LayerSchema.parse(raw) as any;
}

export function createArtboard(input: Partial<Artboard> & { width: number; height: number }): Artboard {
  return ArtboardSchema.parse({ id: input.id ?? generateId('artboard'), ...input });
}

export function createDocument(input: Partial<ArtisanDocument> & { artboards: Artboard[] }): ArtisanDocument {
  return DocumentSchema.parse({ id: input.id ?? generateId('doc'), ...input });
}
