/**
 * @game-artisan/core — Unified Declarative Document Model, composition runtime, JSX
 * compiler, text engine and isomorphic SVG emitter.
 */
export * from './udm/schema.js';
export * from './udm/tree.js';
export * from './udm/factory.js';
export * from './udm/variables.js';
export * from './udm/serialize.js';
export * from './udm/codegen.js';
export * from './math/matrix.js';
export * from './vector/path.js';
export * from './color.js';
export * from './text/fonts.js';
export * from './text/layout.js';
export * from './assets/resolver.js';
export * from './jsx/components.js';
export { Layer, Rect } from './jsx/components.js';
export * from './jsx/context.js';
export { compileElement, cssToTextStyle, getYoga, TemplateCompileError, type CompileEnv } from './jsx/compile.js';
export * as css from './jsx/css.js';
export * from './composition/composition.js';
export * from './composition/props.js';
export * from './composition/overrides.js';
export * from './composition/schema-helpers.js';
export * from './effects/presets.js';
export { buildFilter, filterMargin, PALETTES } from './svg/filters.js';
export { renderArtboardToSvg, renderDocumentToSvg, shapeToPath, layoutTextLayer, layerDomId, type SvgRenderOptions, type SvgRenderResult } from './svg/emit.js';
export { escapeXml, sanitizeSvg } from './svg/xml.js';
export { linearGradientPoints } from './svg/paint.js';
export { z } from 'zod';
