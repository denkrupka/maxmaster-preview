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
