/**
 * PDF Takeoff Types — All interfaces for PDF analysis pipeline
 */

// Classification result from scanning OperatorList
export interface PdfClassification {
  contentType: 'vector' | 'raster' | 'mixed';
  vectorOpCount: number;
  rasterOpCount: number;
  textOpCount: number;
  confidence: number; // 0-1
}

// Graphics state tracked during operator processing
export interface PdfGraphicsState {
  ctm: [number, number, number, number, number, number]; // Current Transform Matrix [a,b,c,d,e,f]
  strokeColor: string; // hex color
  fillColor: string;   // hex color
  lineWidth: number;
  dashPattern: number[];
  dashPhase: number;
}

// A single path segment
export interface PdfPathSegment {
  type: 'M' | 'L' | 'C' | 'Z'; // moveTo, lineTo, curveTo, closePath
  points: { x: number; y: number }[];
}

// A complete path with style
export interface PdfPath {
  segments: PdfPathSegment[];
  style: PdfStyle;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  isClosed: boolean;
  lengthPx: number;
}

// Style snapshot at the time a path was stroked/filled
export interface PdfStyle {
  strokeColor: string;
  fillColor: string;
  lineWidth: number;
  dashPattern: number[];
  isFilled: boolean;
  isStroked: boolean;
}

// Style group (pseudo-layer) — paths grouped by visual appearance
export interface PdfStyleGroup {
  id: string;
  name: string;
  styleKey: string; // "${strokeColor}-${lineWidth}-${dashKey}"
  strokeColor: string;
  lineWidth: number;
  dashPattern: number[];
  pathCount: number;
  pathIndices: number[];
  totalLengthPx: number;
  totalLengthM: number;
  category?: string;
  aiConfidence?: number;
  visible: boolean;
}

// Extracted text item from page.getTextContent()
export interface PdfExtractedText {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontName: string;
}

// Extracted image placement
export interface PdfExtractedImage {
  objectName: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

// Full extraction result for a single page
export interface PdfPageExtraction {
  paths: PdfPath[];
  texts: PdfExtractedText[];
  images: PdfExtractedImage[];
  pageWidth: number;
  pageHeight: number;
}

// Detected symbol (clustered small paths)
export interface PdfDetectedSymbol {
  clusterId: string;
  shape: 'CIRCLE' | 'CROSS' | 'SQUARE' | 'TRIANGLE' | 'DIAMOND' | 'OTHER';
  centerX: number;
  centerY: number;
  radius: number; // approximate bounding radius
  styleGroupId?: string;
  category?: string;
  description?: string;
  confidence?: number; // 0-1 confidence score
  room?: string; // detected room/zone name
}

// Detected room/zone boundary
export interface PdfDetectedRoom {
  id: string;
  name: string;
  polygon: { x: number; y: number }[];
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  area: number; // in px²
  symbolCount: number;
  routeCount: number;
}

// Legend entry detected from the drawing
export interface PdfLegendEntry {
  label: string;
  description: string;
  styleKey?: string;
  category?: string;
  sampleColor?: string;
  sampleLineWidth?: number;
  // Symbol template from legend (for shape matching on drawing)
  symbolSignature?: string;     // normalized shape signature for matching
  symbolBbox?: { w: number; h: number }; // template size
  symbolPathIndices?: number[]; // path indices that form this symbol in legend
  matchCount?: number;          // how many instances found on drawing (excl. legend)
  totalLengthM?: number;        // total length in meters of matched routes on drawing
  matchedPathCount?: number;    // number of paths matched on drawing by style
}

// Legend region with entries
export interface PdfLegend {
  boundingBox: { x: number; y: number; width: number; height: number };
  entries: PdfLegendEntry[];
}

// Scale information
export interface PdfScaleInfo {
  scaleText?: string;   // e.g., "1:100"
  scaleRatio?: number;  // e.g., 100
  scaleFactor: number;  // px to meters conversion factor
  source: 'text_detection' | 'calibration' | 'default';
}

// AI result from raster analysis (Gemini Vision)
export interface PdfRasterAiResult {
  symbols: PdfRasterAiSymbol[];
  routes: PdfRasterAiRoute[];
  scaleText?: string;
  legendEntries: PdfRasterAiLegendEntry[];
  drawingType: string;
}

export interface PdfRasterAiSymbol {
  type: string;       // e.g., "Oprawa oświetleniowa LED"
  category: string;   // e.g., "Oprawy"
  count: number;
  description?: string;
}

export interface PdfRasterAiRoute {
  type: string;       // e.g., "Kabel YDYp 3x2.5"
  category: string;   // "Kable"
  estimatedLengthM: number;
  description?: string;
}

export interface PdfRasterAiLegendEntry {
  symbol: string;
  description: string;
  category: string;
}

// Analysis step for progress tracking in UI
export type PdfAnalysisStep =
  | 'idle'
  | 'classifying'
  | 'extracting'
  | 'analyzing'
  | 'analyzed'
  | 'ai_classifying'
  | 'saving'
  | 'done'
  | 'error';
