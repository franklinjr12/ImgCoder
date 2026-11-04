declare module 'svg-to-pdfkit' {
  const SVGtoPDF: (doc: any, svg: string, x?: number, y?: number, options?: Record<string, unknown>) => void;
  export default SVGtoPDF;
}
