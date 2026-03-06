/**
 * PDF Geometry Extractor — Extract paths, text, images from PDF
 * via page.getOperatorList() with graphics state tracking.
 *
 * Heavy geometry processing runs in a Web Worker to avoid blocking the UI.
 */
import { OPS } from 'pdfjs-dist';
import type { PDFPageProxy } from 'pdfjs-dist';
import type {
  PdfPath,
  PdfExtractedText,
  PdfExtractedImage,
  PdfPageExtraction,
  PdfClassification,
} from './pdfTypes';

/** OPS map passed to the worker so it doesn't need pdfjs-dist */
function buildOpsMap(): Record<string, number> {
  return {
    save: OPS.save, restore: OPS.restore, transform: OPS.transform,
    setStrokeRGBColor: OPS.setStrokeRGBColor, setFillRGBColor: OPS.setFillRGBColor,
    setStrokeGray: OPS.setStrokeGray, setFillGray: OPS.setFillGray,
    setStrokeCMYKColor: OPS.setStrokeCMYKColor, setFillCMYKColor: OPS.setFillCMYKColor,
    setLineWidth: OPS.setLineWidth, setDash: OPS.setDash,
    moveTo: OPS.moveTo, lineTo: OPS.lineTo, curveTo: OPS.curveTo,
    curveTo2: OPS.curveTo2, curveTo3: OPS.curveTo3,
    closePath: OPS.closePath, rectangle: OPS.rectangle, constructPath: OPS.constructPath,
    stroke: OPS.stroke, closeStroke: OPS.closeStroke,
    fill: OPS.fill, eoFill: OPS.eoFill,
    fillStroke: OPS.fillStroke, eoFillStroke: OPS.eoFillStroke,
    closeFillStroke: OPS.closeFillStroke, closeEOFillStroke: OPS.closeEOFillStroke,
    endPath: OPS.endPath,
    paintImageXObject: OPS.paintImageXObject, paintImageMaskXObject: OPS.paintImageMaskXObject,
    paintInlineImageXObject: OPS.paintInlineImageXObject,
  };
}

// OPS sets for classification
const VECTOR_OPS = new Set([
  OPS.moveTo, OPS.lineTo, OPS.curveTo, OPS.curveTo2, OPS.curveTo3,
  OPS.closePath, OPS.rectangle,
  OPS.stroke, OPS.closeStroke, OPS.fill, OPS.eoFill,
  OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke,
  OPS.constructPath,
]);
const RASTER_OPS = new Set([
  OPS.paintImageXObject, OPS.paintImageMaskXObject,
  OPS.paintInlineImageXObject, OPS.paintImageXObjectRepeat,
  OPS.paintImageMaskXObjectRepeat, OPS.paintInlineImageXObjectGroup,
  OPS.paintImageMaskXObjectGroup,
]);
const TEXT_OPS = new Set([
  OPS.showText, OPS.showSpacedText,
  OPS.nextLineShowText, OPS.nextLineSetSpacingShowText,
]);

/** Classify from already-fetched fnArray (no extra getOperatorList call) */
export function classifyFromOpList(fnArray: ArrayLike<number>): PdfClassification {
  let vectorCount = 0, rasterCount = 0, textCount = 0;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    if (VECTOR_OPS.has(fn)) vectorCount++;
    else if (RASTER_OPS.has(fn)) rasterCount++;
    else if (TEXT_OPS.has(fn)) textCount++;
  }
  let contentType: PdfClassification['contentType'];
  let confidence: number;
  if (rasterCount > 0 && vectorCount < 50) {
    contentType = 'raster'; confidence = rasterCount > 5 ? 0.95 : 0.7;
  } else if (vectorCount > 100 && rasterCount === 0) {
    contentType = 'vector'; confidence = vectorCount > 500 ? 0.95 : 0.8;
  } else if (vectorCount > 100 && rasterCount > 0) {
    contentType = 'mixed'; confidence = 0.7;
  } else if (rasterCount > 0) {
    contentType = 'raster'; confidence = 0.6;
  } else {
    contentType = 'vector'; confidence = vectorCount > 20 ? 0.7 : 0.5;
  }
  return { contentType, vectorOpCount: vectorCount, rasterOpCount: rasterCount, textOpCount: textCount, confidence };
}

/** Process geometry in a Web Worker. Returns paths + images. */
function processInWorker(
  fnArray: number[],
  argsArray: any[][],
  viewportTransform: number[],
  onProgress?: (pct: number) => void,
): Promise<{ paths: PdfPath[]; images: PdfExtractedImage[] }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('./pdfGeometryWorker.ts', import.meta.url),
      { type: 'module' }
    );

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        onProgress?.(msg.percent);
      } else if (msg.type === 'result') {
        worker.terminate();
        resolve({ paths: msg.paths, images: msg.images });
      } else if (msg.type === 'error') {
        worker.terminate();
        reject(new Error(msg.message));
      }
    };

    worker.onerror = (err) => {
      worker.terminate();
      reject(new Error(err.message || 'Worker failed'));
    };

    // Send data to worker
    worker.postMessage({
      fnArray: Array.from(fnArray),
      argsArray,
      viewportTransform: Array.from(viewportTransform),
      ops: buildOpsMap(),
    });
  });
}

/** Extract all geometry from a single PDF page (non-blocking) */
export async function extractPageGeometry(
  page: PDFPageProxy,
  onProgress?: (pct: number) => void,
): Promise<PdfPageExtraction> {
  const viewport = page.getViewport({ scale: 1 });
  const pageWidth = viewport.width;
  const pageHeight = viewport.height;

  // Get operator list (fast — just an API call)
  const opList = await page.getOperatorList();

  // Start text extraction in parallel with geometry processing
  const textPromise = page.getTextContent();

  // Process geometry in Web Worker (heavy — 400k+ ops)
  const { paths, images } = await processInWorker(
    opList.fnArray as unknown as number[],
    opList.argsArray,
    viewport.transform as unknown as number[],
    onProgress,
  );

  // Extract text (usually fast)
  const textContent = await textPromise;
  const texts: PdfExtractedText[] = [];
  const vt = viewport.transform;

  for (const item of textContent.items) {
    if (!('str' in item) || !item.str.trim()) continue;
    const tx = item.transform;
    const x = vt[0] * tx[4] + vt[2] * tx[5] + vt[4];
    const y = vt[1] * tx[4] + vt[3] * tx[5] + vt[5];
    const fontSize = Math.abs(tx[3]) || Math.abs(tx[0]) || 12;

    texts.push({
      text: item.str, x, y,
      width: item.width || 0, height: item.height || fontSize,
      fontSize, fontName: ('fontName' in item ? item.fontName : '') as string,
    });
  }

  return { paths, texts, images, pageWidth, pageHeight };
}
