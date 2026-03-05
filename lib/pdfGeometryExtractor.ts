/**
 * PDF Geometry Extractor — Extract paths, text, images from PDF
 * via page.getOperatorList() with graphics state tracking
 *
 * Processes PDF operators to build structured path data with style info.
 * Handles constructPath batch optimization in pdf.js v4+.
 */
import { OPS } from 'pdfjs-dist';
import type { PDFPageProxy } from 'pdfjs-dist';
import type {
  PdfGraphicsState,
  PdfPath,
  PdfPathSegment,
  PdfStyle,
  PdfExtractedText,
  PdfExtractedImage,
  PdfPageExtraction,
} from './pdfTypes';

// ==================== HELPERS ====================

function cloneState(s: PdfGraphicsState): PdfGraphicsState {
  return {
    ctm: [...s.ctm] as PdfGraphicsState['ctm'],
    strokeColor: s.strokeColor,
    fillColor: s.fillColor,
    lineWidth: s.lineWidth,
    dashPattern: [...s.dashPattern],
    dashPhase: s.dashPhase,
  };
}

function defaultState(): PdfGraphicsState {
  return {
    ctm: [1, 0, 0, 1, 0, 0],
    strokeColor: '#000000',
    fillColor: '#000000',
    lineWidth: 1,
    dashPattern: [],
    dashPhase: 0,
  };
}

/** Multiply two 3x3 affine matrices represented as [a,b,c,d,e,f] */
function multiplyCTM(
  m1: [number, number, number, number, number, number],
  m2: [number, number, number, number, number, number]
): [number, number, number, number, number, number] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

/** Transform a point by CTM */
function transformPoint(
  x: number, y: number,
  ctm: [number, number, number, number, number, number]
): { x: number; y: number } {
  return {
    x: ctm[0] * x + ctm[2] * y + ctm[4],
    y: ctm[1] * x + ctm[3] * y + ctm[5],
  };
}

/** Convert RGB [0-1] to hex string */
function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  return '#' + [r, g, b].map(v => clamp(v).toString(16).padStart(2, '0')).join('');
}

/** Convert gray [0-1] to hex string */
function grayToHex(g: number): string {
  return rgbToHex(g, g, g);
}

/** Convert CMYK to hex string */
function cmykToHex(c: number, m: number, y: number, k: number): string {
  const r = (1 - c) * (1 - k);
  const g = (1 - m) * (1 - k);
  const b = (1 - y) * (1 - k);
  return rgbToHex(r, g, b);
}

/** Calculate length of a path segment */
function segmentLength(segments: PdfPathSegment[]): number {
  let total = 0;
  let cx = 0, cy = 0;
  for (const seg of segments) {
    switch (seg.type) {
      case 'M':
        if (seg.points.length > 0) { cx = seg.points[0].x; cy = seg.points[0].y; }
        break;
      case 'L':
        if (seg.points.length > 0) {
          const p = seg.points[0];
          total += Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2);
          cx = p.x; cy = p.y;
        }
        break;
      case 'C':
        if (seg.points.length >= 3) {
          // Approximate cubic Bézier length with chord + control polygon average
          const [cp1, cp2, end] = seg.points;
          const chord = Math.sqrt((end.x - cx) ** 2 + (end.y - cy) ** 2);
          const poly = Math.sqrt((cp1.x - cx) ** 2 + (cp1.y - cy) ** 2)
            + Math.sqrt((cp2.x - cp1.x) ** 2 + (cp2.y - cp1.y) ** 2)
            + Math.sqrt((end.x - cp2.x) ** 2 + (end.y - cp2.y) ** 2);
          total += (chord + poly) / 2;
          cx = end.x; cy = end.y;
        }
        break;
      case 'Z':
        // Close path — length to first point handled by caller if needed
        break;
    }
  }
  return total;
}

/** Compute bounding box from segments */
function computeBBox(segments: PdfPathSegment[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const seg of segments) {
    for (const p of seg.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

/** Check if path is closed */
function isClosed(segments: PdfPathSegment[]): boolean {
  return segments.length > 0 && segments[segments.length - 1].type === 'Z';
}

// ==================== HELPERS (yield) ====================

/** Yield control back to the browser to keep UI responsive */
function yieldToUI(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

// ==================== MAIN EXTRACTOR ====================

/** Extract all geometry from a single PDF page */
export async function extractPageGeometry(page: PDFPageProxy): Promise<PdfPageExtraction> {
  const viewport = page.getViewport({ scale: 1 });
  const pageWidth = viewport.width;
  const pageHeight = viewport.height;

  const opList = await page.getOperatorList();
  const { fnArray, argsArray } = opList;

  // Graphics state stack
  const stateStack: PdfGraphicsState[] = [];
  let state = defaultState();

  // Current path being accumulated
  let currentSegments: PdfPathSegment[] = [];

  // Results
  const paths: PdfPath[] = [];
  const images: PdfExtractedImage[] = [];

  /** Apply viewport transform to a point (PDF coords → screen coords) */
  function toScreen(x: number, y: number): { x: number; y: number } {
    const tp = transformPoint(x, y, state.ctm);
    // Apply viewport transform: PDF has origin at bottom-left, viewport flips Y
    const vt = viewport.transform;
    return {
      x: vt[0] * tp.x + vt[2] * tp.y + vt[4],
      y: vt[1] * tp.x + vt[3] * tp.y + vt[5],
    };
  }

  /** Save the current path with given rendering mode */
  function savePath(isStroked: boolean, isFilled: boolean) {
    if (currentSegments.length === 0) return;
    const style: PdfStyle = {
      strokeColor: state.strokeColor,
      fillColor: state.fillColor,
      lineWidth: state.lineWidth,
      dashPattern: [...state.dashPattern],
      isStroked,
      isFilled,
    };
    const bbox = computeBBox(currentSegments);
    const lengthPx = segmentLength(currentSegments);
    paths.push({
      segments: currentSegments,
      style,
      bbox,
      isClosed: isClosed(currentSegments),
      lengthPx,
    });
    currentSegments = [];
  }

  // Process operators (yield every 50k ops to keep UI responsive)
  const YIELD_INTERVAL = 50000;
  for (let i = 0; i < fnArray.length; i++) {
    if (i > 0 && i % YIELD_INTERVAL === 0) await yieldToUI();
    const fn = fnArray[i];
    const args = argsArray[i];

    switch (fn) {
      // Graphics state
      case OPS.save:
        stateStack.push(cloneState(state));
        break;

      case OPS.restore:
        if (stateStack.length > 0) state = stateStack.pop()!;
        break;

      case OPS.transform:
        if (args && args.length >= 6) {
          const m: [number, number, number, number, number, number] = [
            args[0], args[1], args[2], args[3], args[4], args[5],
          ];
          state.ctm = multiplyCTM(state.ctm, m);
        }
        break;

      // Colors
      case OPS.setStrokeRGBColor:
        if (args && args.length >= 3) state.strokeColor = rgbToHex(args[0], args[1], args[2]);
        break;
      case OPS.setFillRGBColor:
        if (args && args.length >= 3) state.fillColor = rgbToHex(args[0], args[1], args[2]);
        break;
      case OPS.setStrokeGray:
        if (args && args.length >= 1) state.strokeColor = grayToHex(args[0]);
        break;
      case OPS.setFillGray:
        if (args && args.length >= 1) state.fillColor = grayToHex(args[0]);
        break;
      case OPS.setStrokeCMYKColor:
        if (args && args.length >= 4) state.strokeColor = cmykToHex(args[0], args[1], args[2], args[3]);
        break;
      case OPS.setFillCMYKColor:
        if (args && args.length >= 4) state.fillColor = cmykToHex(args[0], args[1], args[2], args[3]);
        break;

      // Line style
      case OPS.setLineWidth:
        if (args && args.length >= 1) state.lineWidth = args[0];
        break;
      case OPS.setDash:
        if (args && args.length >= 2) {
          state.dashPattern = Array.isArray(args[0]) ? args[0] : [];
          state.dashPhase = args[1] || 0;
        }
        break;

      // Path construction
      case OPS.moveTo:
        if (args && args.length >= 2) {
          const p = toScreen(args[0], args[1]);
          currentSegments.push({ type: 'M', points: [p] });
        }
        break;
      case OPS.lineTo:
        if (args && args.length >= 2) {
          const p = toScreen(args[0], args[1]);
          currentSegments.push({ type: 'L', points: [p] });
        }
        break;
      case OPS.curveTo:
        if (args && args.length >= 6) {
          const cp1 = toScreen(args[0], args[1]);
          const cp2 = toScreen(args[2], args[3]);
          const end = toScreen(args[4], args[5]);
          currentSegments.push({ type: 'C', points: [cp1, cp2, end] });
        }
        break;
      case OPS.curveTo2:
        // curveTo2: first control point = current point (args: cp2x, cp2y, x, y)
        if (args && args.length >= 4) {
          const cp2 = toScreen(args[0], args[1]);
          const end = toScreen(args[2], args[3]);
          // Use cp2 as both control points (approximation)
          currentSegments.push({ type: 'C', points: [cp2, cp2, end] });
        }
        break;
      case OPS.curveTo3:
        // curveTo3: second control point = end point (args: cp1x, cp1y, x, y)
        if (args && args.length >= 4) {
          const cp1 = toScreen(args[0], args[1]);
          const end = toScreen(args[2], args[3]);
          currentSegments.push({ type: 'C', points: [cp1, end, end] });
        }
        break;
      case OPS.closePath:
        currentSegments.push({ type: 'Z', points: [] });
        break;
      case OPS.rectangle:
        if (args && args.length >= 4) {
          const [rx, ry, rw, rh] = args;
          const p1 = toScreen(rx, ry);
          const p2 = toScreen(rx + rw, ry);
          const p3 = toScreen(rx + rw, ry + rh);
          const p4 = toScreen(rx, ry + rh);
          currentSegments.push(
            { type: 'M', points: [p1] },
            { type: 'L', points: [p2] },
            { type: 'L', points: [p3] },
            { type: 'L', points: [p4] },
            { type: 'Z', points: [] },
          );
        }
        break;

      // constructPath — batched path ops in pdf.js v4+
      case OPS.constructPath: {
        if (!args || args.length < 2) break;
        const subOps: number[] = args[0];
        const coords: number[] = args[1];
        // Optional: minMax = args[2]
        let ci = 0; // coord index

        for (const subOp of subOps) {
          switch (subOp) {
            case OPS.moveTo: {
              if (ci + 2 <= coords.length) {
                const p = toScreen(coords[ci], coords[ci + 1]);
                currentSegments.push({ type: 'M', points: [p] });
                ci += 2;
              }
              break;
            }
            case OPS.lineTo: {
              if (ci + 2 <= coords.length) {
                const p = toScreen(coords[ci], coords[ci + 1]);
                currentSegments.push({ type: 'L', points: [p] });
                ci += 2;
              }
              break;
            }
            case OPS.curveTo: {
              if (ci + 6 <= coords.length) {
                const cp1 = toScreen(coords[ci], coords[ci + 1]);
                const cp2 = toScreen(coords[ci + 2], coords[ci + 3]);
                const end = toScreen(coords[ci + 4], coords[ci + 5]);
                currentSegments.push({ type: 'C', points: [cp1, cp2, end] });
                ci += 6;
              }
              break;
            }
            case OPS.curveTo2: {
              if (ci + 4 <= coords.length) {
                const cp2 = toScreen(coords[ci], coords[ci + 1]);
                const end = toScreen(coords[ci + 2], coords[ci + 3]);
                currentSegments.push({ type: 'C', points: [cp2, cp2, end] });
                ci += 4;
              }
              break;
            }
            case OPS.curveTo3: {
              if (ci + 4 <= coords.length) {
                const cp1 = toScreen(coords[ci], coords[ci + 1]);
                const end = toScreen(coords[ci + 2], coords[ci + 3]);
                currentSegments.push({ type: 'C', points: [cp1, end, end] });
                ci += 4;
              }
              break;
            }
            case OPS.closePath: {
              currentSegments.push({ type: 'Z', points: [] });
              break;
            }
            case OPS.rectangle: {
              if (ci + 4 <= coords.length) {
                const [rx, ry, rw, rh] = [coords[ci], coords[ci + 1], coords[ci + 2], coords[ci + 3]];
                const p1 = toScreen(rx, ry);
                const p2 = toScreen(rx + rw, ry);
                const p3 = toScreen(rx + rw, ry + rh);
                const p4 = toScreen(rx, ry + rh);
                currentSegments.push(
                  { type: 'M', points: [p1] },
                  { type: 'L', points: [p2] },
                  { type: 'L', points: [p3] },
                  { type: 'L', points: [p4] },
                  { type: 'Z', points: [] },
                );
                ci += 4;
              }
              break;
            }
          }
        }
        break;
      }

      // Path rendering (commit current path)
      case OPS.stroke:
      case OPS.closeStroke:
        if (fn === OPS.closeStroke) currentSegments.push({ type: 'Z', points: [] });
        savePath(true, false);
        break;
      case OPS.fill:
      case OPS.eoFill:
        savePath(false, true);
        break;
      case OPS.fillStroke:
      case OPS.eoFillStroke:
      case OPS.closeFillStroke:
      case OPS.closeEOFillStroke:
        if (fn === OPS.closeFillStroke || fn === OPS.closeEOFillStroke) {
          currentSegments.push({ type: 'Z', points: [] });
        }
        savePath(true, true);
        break;
      case OPS.endPath:
        // Discard current path without rendering
        currentSegments = [];
        break;

      // Images
      case OPS.paintImageXObject:
      case OPS.paintImageMaskXObject:
      case OPS.paintInlineImageXObject: {
        // Image is placed at current CTM position
        const origin = toScreen(0, 0);
        const corner = toScreen(1, 1);
        images.push({
          objectName: args?.[0] || 'inline',
          x: Math.min(origin.x, corner.x),
          y: Math.min(origin.y, corner.y),
          width: Math.abs(corner.x - origin.x),
          height: Math.abs(corner.y - origin.y),
        });
        break;
      }
    }
  }

  // Extract text using the simpler getTextContent API
  const textContent = await page.getTextContent();
  const texts: PdfExtractedText[] = [];

  for (const item of textContent.items) {
    if (!('str' in item) || !item.str.trim()) continue;
    const tx = item.transform;
    // transform is [scaleX, skewX, skewY, scaleY, translateX, translateY]
    // Apply viewport transform
    const vt = viewport.transform;
    const x = vt[0] * tx[4] + vt[2] * tx[5] + vt[4];
    const y = vt[1] * tx[4] + vt[3] * tx[5] + vt[5];
    const fontSize = Math.abs(tx[3]) || Math.abs(tx[0]) || 12;

    texts.push({
      text: item.str,
      x,
      y,
      width: item.width || 0,
      height: item.height || fontSize,
      fontSize,
      fontName: ('fontName' in item ? item.fontName : '') as string,
    });
  }

  return { paths, texts, images, pageWidth, pageHeight };
}
