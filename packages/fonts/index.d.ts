export interface BundledFont {
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  file: string;
  url: URL;
}
export interface LoadedBundledFont extends BundledFont {
  data: Uint8Array;
}
export declare const BUNDLED_FONTS: BundledFont[];
export declare const DEFAULT_FONT_FAMILY: string;
export declare function loadBundledFonts(): Promise<LoadedBundledFont[]>;
