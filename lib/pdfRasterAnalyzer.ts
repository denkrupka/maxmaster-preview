/**
 * PDF Raster Analyzer — Render page to canvas → preprocess → OCR → Gemini Vision → DxfAnalysis
 * For scanned/raster PDF pages where vector extraction isn't possible.
 *
 * Preprocessing pipeline:
 * 1. Deskew (angle detection via projection profile)
 * 2. Auto-contrast stretch
 * 3. Denoise (4-neighbor smoothing)
 * 4. Color separation (extract dominant drawing colors in HSV)
 * 5. OCR (Tesseract.js) for scale/legend/label text
 */
import type { PDFPageProxy } from 'pdfjs-dist';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PdfRasterAiResult } from './pdfTypes';
import type {
  DxfAnalysis,
  AnalyzedLayer,
  AnalyzedEntity,
  AnalyzedBlock,
  LineGroup,
} from './dxfAnalyzer';

// ==================== RENDER ====================

/** Render a PDF page to canvas and get base64 JPEG */
async function renderPageToBase64(page: PDFPageProxy, scale: number = 2): Promise<{
  base64: string;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d')!;

  await page.render({ canvasContext: ctx, viewport }).promise;

  // Apply full preprocessing pipeline
  deskewCanvas(ctx, canvas);
  preprocessCanvas(ctx, canvas.width, canvas.height);

  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  const base64 = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
  return { base64, canvas, ctx };
}

// ==================== DESKEW ====================

/** Detect skew angle and rotate canvas to straighten the image.
 *  Uses horizontal projection profile variance — the straightest angle
 *  produces the sharpest (highest variance) profile. */
function deskewCanvas(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
  const w = canvas.width;
  const h = canvas.height;

  // Work on a downscaled grayscale copy for speed
  const sampleScale = 4;
  const sw = Math.floor(w / sampleScale);
  const sh = Math.floor(h / sampleScale);

  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = sw;
  sampleCanvas.height = sh;
  const sCtx = sampleCanvas.getContext('2d')!;
  sCtx.drawImage(canvas, 0, 0, sw, sh);

  const imgData = sCtx.getImageData(0, 0, sw, sh);
  const gray = new Uint8Array(sw * sh);
  for (let i = 0; i < gray.length; i++) {
    const j = i * 4;
    gray[i] = Math.round(0.299 * imgData.data[j] + 0.587 * imgData.data[j + 1] + 0.114 * imgData.data[j + 2]);
  }

  // Binarize with Otsu threshold
  const threshold = otsuThreshold(gray);
  const binary = gray.map(v => v < threshold ? 1 : 0);

  // Test angles from -5° to +5° in 0.25° steps
  let bestAngle = 0;
  let bestVariance = -1;

  for (let deg = -5; deg <= 5; deg += 0.25) {
    const rad = (deg * Math.PI) / 180;
    const variance = projectionVariance(binary, sw, sh, rad);
    if (variance > bestVariance) {
      bestVariance = variance;
      bestAngle = deg;
    }
  }

  // Only correct if angle is significant (> 0.3°)
  if (Math.abs(bestAngle) < 0.3) return;

  // Rotate the original canvas
  const rad = (bestAngle * Math.PI) / 180;
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = w;
  tempCanvas.height = h;
  const tCtx = tempCanvas.getContext('2d')!;
  tCtx.drawImage(canvas, 0, 0);

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-rad);
  ctx.translate(-w / 2, -h / 2);
  ctx.drawImage(tempCanvas, 0, 0);
  ctx.restore();
}

/** Otsu threshold for binarization */
function otsuThreshold(gray: Uint8Array): number {
  const hist = new Array(256).fill(0);
  for (const v of gray) hist[v]++;
  const total = gray.length;

  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];

  let sumB = 0, wB = 0, wF: number;
  let best = 0, bestT = 0;

  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; bestT = t; }
  }
  return bestT;
}

/** Compute variance of horizontal projection profile at given rotation angle */
function projectionVariance(binary: Uint8Array, w: number, h: number, angle: number): number {
  const profile = new Float64Array(h);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const cx = w / 2, cy = h / 2;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const rx = cos * (x - cx) - sin * (y - cy) + cx;
      const ry = sin * (x - cx) + cos * (y - cy) + cy;
      const iy = Math.round(ry);
      if (iy >= 0 && iy < h && rx >= 0 && rx < w) {
        profile[iy] += binary[y * w + x];
      }
    }
  }

  // Variance
  let sum = 0, sum2 = 0, count = 0;
  for (let i = 0; i < h; i++) {
    sum += profile[i];
    sum2 += profile[i] ** 2;
    count++;
  }
  const mean = sum / count;
  return sum2 / count - mean * mean;
}

// ==================== PREPROCESSING ====================

/** Preprocess: auto-contrast + denoise */
function preprocessCanvas(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // 1. Auto-contrast stretch
  let minLum = 255, maxLum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (lum < minLum) minLum = lum;
    if (lum > maxLum) maxLum = lum;
  }
  const range = maxLum - minLum;
  if (range > 20 && range < 220) {
    const s = 255 / range;
    for (let i = 0; i < data.length; i += 4) {
      data[i]     = Math.min(255, Math.max(0, (data[i] - minLum) * s));
      data[i + 1] = Math.min(255, Math.max(0, (data[i + 1] - minLum) * s));
      data[i + 2] = Math.min(255, Math.max(0, (data[i + 2] - minLum) * s));
    }
  }

  // 2. Denoise (4-neighbor smoothing)
  const copy = new Uint8ClampedArray(data);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const center = copy[idx + c];
        const avg = (
          copy[((y - 1) * width + x) * 4 + c] +
          copy[((y + 1) * width + x) * 4 + c] +
          copy[(y * width + x - 1) * 4 + c] +
          copy[(y * width + x + 1) * 4 + c]
        ) / 4;
        if (Math.abs(center - avg) > 40) {
          data[idx + c] = Math.round(center * 0.5 + avg * 0.5);
        }
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

// ==================== COLOR SEPARATION ====================

/** Extract dominant drawing colors from the canvas (HSV analysis).
 *  Returns a description of detected color channels for Gemini context. */
function extractDominantColors(ctx: CanvasRenderingContext2D, width: number, height: number): string[] {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // Sample every 4th pixel for speed
  const colorBuckets: Record<string, number> = {};
  const step = 4;

  for (let i = 0; i < data.length; i += 4 * step) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    // Skip near-white and near-black (background/text)
    if (lum > 220 || lum < 30) continue;

    const hsv = rgbToHsv(r, g, b);
    // Skip very low saturation (grays)
    if (hsv.s < 0.15) continue;

    // Bucket by hue (30° buckets) and saturation level
    const hueBucket = Math.floor(hsv.h / 30) * 30;
    const satLevel = hsv.s > 0.5 ? 'vivid' : 'muted';
    const key = `${hueBucket}-${satLevel}`;
    colorBuckets[key] = (colorBuckets[key] || 0) + 1;
  }

  // Get top colors
  const sorted = Object.entries(colorBuckets).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((s, e) => s + e[1], 0);
  if (total === 0) return [];

  const colors: string[] = [];
  const hueNames: Record<number, string> = {
    0: 'czerwony', 30: 'pomarańczowy', 60: 'żółty', 90: 'limonkowy',
    120: 'zielony', 150: 'morski', 180: 'cyjan', 210: 'jasnoniebieski',
    240: 'niebieski', 270: 'fioletowy', 300: 'magenta', 330: 'różowy',
  };

  for (const [key, count] of sorted.slice(0, 5)) {
    const pct = ((count / total) * 100).toFixed(0);
    if (parseFloat(pct) < 3) continue;
    const [hue, sat] = key.split('-');
    const name = hueNames[parseInt(hue)] || `hue${hue}`;
    colors.push(`${name} (${sat}, ${pct}%)`);
  }

  return colors;
}

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  const v = max;
  const s = max === 0 ? 0 : d / max;

  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  return { h, s, v };
}

// ==================== OCR ====================

/** Run OCR on the canvas to extract text (scale, legend, labels).
 *  Returns extracted text strings. Uses Tesseract.js if available. */
async function runOcr(canvas: HTMLCanvasElement): Promise<string[]> {
  try {
    const Tesseract = await import('tesseract.js');
    const worker = await Tesseract.createWorker('pol+eng', undefined, {
      logger: () => {}, // suppress logs
    });

    const { data } = await worker.recognize(canvas);
    await worker.terminate();

    if (!data.text || data.text.trim().length < 3) return [];

    // Split into meaningful lines, filter noise
    const lines = data.text
      .split('\n')
      .map((l: string) => l.trim())
      .filter((l: string) => l.length >= 2 && l.length <= 200);

    return lines;
  } catch {
    // Tesseract not available — skip OCR silently
    return [];
  }
}

/** Extract scale, legend keywords, and labels from OCR text */
function parseOcrText(lines: string[]): {
  scaleText?: string;
  labels: string[];
  legendKeywords: string[];
} {
  let scaleText: string | undefined;
  const labels: string[] = [];
  const legendKeywords: string[] = [];

  const scalePatterns = [
    /[Ss]kala\s*:?\s*(1\s*:\s*\d+)/,
    /[Ss]cale\s*:?\s*(1\s*:\s*\d+)/,
    /SKALA\s*:?\s*(1\s*:\s*\d+)/,
    /M\s*(1\s*:\s*\d+)/,
  ];

  const labelPatterns = /\b(OP\d*|G\d*|W\d*|AP\d*|CZ\d*|TB\d*|RG|RJ\d+|KAM\d*|LED|UTP)\b/gi;

  for (const line of lines) {
    // Scale
    if (!scaleText) {
      for (const pat of scalePatterns) {
        const m = line.match(pat);
        if (m) { scaleText = m[1].replace(/\s/g, ''); break; }
      }
    }

    // Legend area marker
    if (/legenda|oznaczenia|objaśnienia/i.test(line)) {
      legendKeywords.push(line);
    }

    // Symbol labels
    const labelMatches = line.match(labelPatterns);
    if (labelMatches) labels.push(...labelMatches);
  }

  return { scaleText, labels: [...new Set(labels)], legendKeywords };
}

// ==================== SKELETONIZATION & LINE DETECTION ====================

/** Binarize canvas to Uint8Array (1 = foreground/dark, 0 = background/light) */
function binarizeCanvas(ctx: CanvasRenderingContext2D, w: number, h: number): Uint8Array {
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;
  const gray = new Uint8Array(w * h);

  for (let i = 0; i < gray.length; i++) {
    const j = i * 4;
    gray[i] = Math.round(0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2]);
  }

  const threshold = otsuThreshold(gray);
  const binary = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i++) {
    binary[i] = gray[i] < threshold ? 1 : 0;
  }
  return binary;
}

/** Zhang-Suen thinning algorithm — produces 1-pixel wide skeleton */
function zhangSuenThin(binary: Uint8Array, w: number, h: number): Uint8Array {
  const img = new Uint8Array(binary);
  let changed = true;

  while (changed) {
    changed = false;

    // Sub-iteration 1
    const toRemove1: number[] = [];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = y * w + x;
        if (img[idx] === 0) continue;

        const p2 = img[(y - 1) * w + x];
        const p3 = img[(y - 1) * w + x + 1];
        const p4 = img[y * w + x + 1];
        const p5 = img[(y + 1) * w + x + 1];
        const p6 = img[(y + 1) * w + x];
        const p7 = img[(y + 1) * w + x - 1];
        const p8 = img[y * w + x - 1];
        const p9 = img[(y - 1) * w + x - 1];

        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (B < 2 || B > 6) continue;

        // Count 0→1 transitions in clockwise order
        const neighbors = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
        let A = 0;
        for (let i = 0; i < 8; i++) {
          if (neighbors[i] === 0 && neighbors[i + 1] === 1) A++;
        }
        if (A !== 1) continue;

        if (p2 * p4 * p6 !== 0) continue;
        if (p4 * p6 * p8 !== 0) continue;

        toRemove1.push(idx);
      }
    }
    for (const idx of toRemove1) { img[idx] = 0; changed = true; }

    // Sub-iteration 2
    const toRemove2: number[] = [];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = y * w + x;
        if (img[idx] === 0) continue;

        const p2 = img[(y - 1) * w + x];
        const p3 = img[(y - 1) * w + x + 1];
        const p4 = img[y * w + x + 1];
        const p5 = img[(y + 1) * w + x + 1];
        const p6 = img[(y + 1) * w + x];
        const p7 = img[(y + 1) * w + x - 1];
        const p8 = img[y * w + x - 1];
        const p9 = img[(y - 1) * w + x - 1];

        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (B < 2 || B > 6) continue;

        const neighbors = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
        let A = 0;
        for (let i = 0; i < 8; i++) {
          if (neighbors[i] === 0 && neighbors[i + 1] === 1) A++;
        }
        if (A !== 1) continue;

        if (p2 * p4 * p8 !== 0) continue;
        if (p2 * p6 * p8 !== 0) continue;

        toRemove2.push(idx);
      }
    }
    for (const idx of toRemove2) { img[idx] = 0; changed = true; }
  }

  return img;
}

/** Extract endpoints and junctions from skeleton */
function extractSkeletonFeatures(skeleton: Uint8Array, w: number, h: number): {
  endpoints: { x: number; y: number }[];
  junctions: { x: number; y: number; degree: number }[];
  linePixelCount: number;
} {
  const endpoints: { x: number; y: number }[] = [];
  const junctions: { x: number; y: number; degree: number }[] = [];
  let linePixelCount = 0;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (skeleton[y * w + x] === 0) continue;
      linePixelCount++;

      // Count 8-connected neighbors
      let neighbors = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (skeleton[(y + dy) * w + (x + dx)] === 1) neighbors++;
        }
      }

      if (neighbors === 1) endpoints.push({ x, y });
      else if (neighbors >= 3) junctions.push({ x, y, degree: neighbors });
    }
  }

  return { endpoints, junctions, linePixelCount };
}

/** Trace lines from the skeleton to estimate total route length and count */
function traceSkeletonRoutes(
  skeleton: Uint8Array, w: number, h: number
): { routeCount: number; totalLengthPx: number } {
  const visited = new Uint8Array(w * h);
  let routeCount = 0;
  let totalLengthPx = 0;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      if (skeleton[idx] === 0 || visited[idx]) continue;

      // BFS/flood-fill for connected skeleton component
      const queue: number[] = [idx];
      visited[idx] = 1;
      let pixelCount = 0;

      while (queue.length > 0) {
        const ci = queue.shift()!;
        pixelCount++;
        const cx = ci % w, cy = Math.floor(ci / w);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const ni = (cy + dy) * w + (cx + dx);
            if (ni >= 0 && ni < w * h && skeleton[ni] === 1 && !visited[ni]) {
              visited[ni] = 1;
              queue.push(ni);
            }
          }
        }
      }

      // Only count substantial routes (>20 pixels)
      if (pixelCount > 20) {
        routeCount++;
        totalLengthPx += pixelCount;
      }
    }
  }

  return { routeCount, totalLengthPx };
}

/** Run local skeletonization pipeline on the rendered canvas.
 *  Returns route statistics to merge with Gemini Vision results. */
function runSkeletonPipeline(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): {
  routeCount: number;
  totalLengthPx: number;
  endpoints: { x: number; y: number }[];
  junctions: { x: number; y: number; degree: number }[];
  linePixelCount: number;
} {
  // Work on downscaled version for speed (skeleton is O(n²))
  const scale = 2;
  const sw = Math.floor(canvas.width / scale);
  const sh = Math.floor(canvas.height / scale);

  const smallCanvas = document.createElement('canvas');
  smallCanvas.width = sw;
  smallCanvas.height = sh;
  const sCtx = smallCanvas.getContext('2d')!;
  sCtx.drawImage(canvas, 0, 0, sw, sh);

  const binary = binarizeCanvas(sCtx, sw, sh);
  const skeleton = zhangSuenThin(binary, sw, sh);
  const features = extractSkeletonFeatures(skeleton, sw, sh);
  const routes = traceSkeletonRoutes(skeleton, sw, sh);

  // Scale coordinates back
  return {
    routeCount: routes.routeCount,
    totalLengthPx: routes.totalLengthPx * scale,
    endpoints: features.endpoints.map(p => ({ x: p.x * scale, y: p.y * scale })),
    junctions: features.junctions.map(p => ({ x: p.x * scale, y: p.y * scale, degree: p.degree })),
    linePixelCount: features.linePixelCount,
  };
}

// ==================== MAIN ANALYZER ====================

/** Analyze a raster PDF page using Gemini Vision via edge function */
export async function analyzeRasterPdf(
  page: PDFPageProxy,
  supabase: SupabaseClient,
  pageNumber: number = 1,
): Promise<{ analysis: DxfAnalysis; aiResult: PdfRasterAiResult }> {
  // 1. Render + preprocess (deskew, contrast, denoise)
  const { base64, canvas, ctx } = await renderPageToBase64(page);

  // 2. Color separation analysis
  const dominantColors = extractDominantColors(ctx, canvas.width, canvas.height);

  // 3. OCR text extraction
  const ocrLines = await runOcr(canvas);
  const ocrData = parseOcrText(ocrLines);

  // 4. Build enriched context for Gemini
  const extraContext: string[] = [];
  if (ocrData.scaleText) extraContext.push(`Detected scale: ${ocrData.scaleText}`);
  if (ocrData.labels.length > 0) extraContext.push(`Detected labels: ${ocrData.labels.join(', ')}`);
  if (dominantColors.length > 0) extraContext.push(`Dominant drawing colors: ${dominantColors.join(', ')}`);
  if (ocrData.legendKeywords.length > 0) extraContext.push(`Legend area detected`);

  // 5. Run skeleton pipeline in parallel with Gemini call
  const skeletonResult = runSkeletonPipeline(ctx, canvas);

  // 6. Call edge function with enriched context (including skeleton stats)
  if (skeletonResult.routeCount > 0) {
    extraContext.push(`Skeleton analysis: ${skeletonResult.routeCount} routes, ${skeletonResult.junctions.length} junctions, ${skeletonResult.endpoints.length} endpoints`);
  }

  const { data, error } = await supabase.functions.invoke('pdf-analyze-raster', {
    body: {
      imageBase64: base64,
      mimeType: 'image/jpeg',
      pageNumber,
      ocrContext: extraContext.length > 0 ? extraContext.join('; ') : undefined,
    },
  });

  if (error) throw new Error(`Raster analysis failed: ${error.message}`);
  if (data?.error) throw new Error(data.error);

  const aiResult: PdfRasterAiResult = data.data || data;

  // Override scale from OCR if AI didn't detect it
  if (!aiResult.scaleText && ocrData.scaleText) {
    aiResult.scaleText = ocrData.scaleText;
  }

  // 7. Convert to DxfAnalysis and merge skeleton data
  const analysis = rasterAiToDxfAnalysis(aiResult, skeletonResult);

  return { analysis, aiResult };
}

// ==================== CONVERSION ====================

/** Convert Gemini Vision AI result to DxfAnalysis-compatible format, merging skeleton data */
function rasterAiToDxfAnalysis(
  ai: PdfRasterAiResult,
  skeleton?: { routeCount: number; totalLengthPx: number; endpoints: { x: number; y: number }[]; junctions: { x: number; y: number; degree: number }[]; linePixelCount: number },
): DxfAnalysis {
  const layers: AnalyzedLayer[] = [];
  const entities: AnalyzedEntity[] = [];
  const blocks: AnalyzedBlock[] = [];
  const lineGroups: LineGroup[] = [];

  let entityIdx = 0;
  const categoryColors: Record<string, string> = {
    'Kable': '#cc0000',
    'Oprawy': '#0066cc',
    'Osprzęt': '#00aa00',
    'Trasy': '#ff8800',
    'Tablice': '#6600cc',
    'Alarmy': '#cc6600',
    'Inne': '#808080',
  };

  // Process symbols → layers + entities + blocks
  for (const sym of ai.symbols || []) {
    const layerName = `${sym.category} — ${sym.type}`;
    const color = categoryColors[sym.category] || '#808080';

    layers.push({
      name: layerName,
      color,
      entityCount: sym.count,
      frozen: false,
      entityTypes: { 'PDF_SYMBOL': sym.count },
    });

    blocks.push({
      name: sym.type,
      insertCount: sym.count,
      sampleLayer: layerName,
      entityCount: 1,
      containedTypes: ['PDF_SYMBOL'],
    });

    for (let i = 0; i < sym.count; i++) {
      entities.push({
        index: entityIdx++,
        entityType: 'PDF_SYMBOL',
        layerName,
        blockName: sym.type,
        geometry: { type: 'point' },
        lengthM: 0,
        areaM2: 0,
        properties: {
          aiCategory: sym.category,
          aiType: sym.type,
          aiDescription: sym.description,
          symbolShape: 'OTHER',
          styleColor: color,
        },
      });
    }
  }

  // Process routes → layers + entities + lineGroups
  let routeIdx = 0;
  for (const route of ai.routes || []) {
    const layerName = `Kable — ${route.type}`;
    const color = categoryColors['Kable'] || '#cc0000';

    layers.push({
      name: layerName,
      color,
      entityCount: 1,
      frozen: false,
      entityTypes: { 'PDF_PATH': 1 },
    });

    const entityIndex = entityIdx++;
    entities.push({
      index: entityIndex,
      entityType: 'PDF_PATH',
      layerName,
      geometry: { type: 'polyline' },
      lengthM: route.estimatedLengthM,
      areaM2: 0,
      properties: {
        aiCategory: route.category,
        aiType: route.type,
        aiDescription: route.description,
        styleColor: color,
      },
    });

    lineGroups.push({
      id: `ai_route_${++routeIdx}`,
      entityIndices: [entityIndex],
      totalLengthM: route.estimatedLengthM,
      layer: layerName,
      points: [],
    });
  }

  // Merge skeleton data: add junction/endpoint annotations to line groups
  if (skeleton && skeleton.routeCount > 0) {
    // If AI didn't detect routes but skeleton did, add skeleton-based routes
    if (lineGroups.length === 0 && skeleton.routeCount > 0) {
      const skeletonLayer = 'Trasy (szkielet)';
      layers.push({
        name: skeletonLayer,
        color: '#888888',
        entityCount: skeleton.routeCount,
        frozen: false,
        entityTypes: { 'PDF_PATH': skeleton.routeCount },
      });

      for (let r = 0; r < skeleton.routeCount; r++) {
        const entityIndex = entityIdx++;
        entities.push({
          index: entityIndex,
          entityType: 'PDF_PATH',
          layerName: skeletonLayer,
          geometry: { type: 'polyline' },
          lengthM: 0, // Unknown without scale
          areaM2: 0,
          properties: {
            source: 'skeleton',
            styleColor: '#888888',
          },
        });
        lineGroups.push({
          id: `skel_route_${r + 1}`,
          entityIndices: [entityIndex],
          totalLengthM: 0,
          layer: skeletonLayer,
          points: [],
        });
      }
    }

    // Add junction and endpoint info to the first route for reference
    if (lineGroups.length > 0 && skeleton.junctions.length > 0) {
      (lineGroups[0] as any).branchPoints = skeleton.junctions;
      (lineGroups[0] as any).endpoints = skeleton.endpoints;
      (lineGroups[0] as any).branchCount = skeleton.junctions.length;
    }
  }

  return {
    totalEntities: entities.length,
    totalBlocks: blocks.length,
    totalLayers: layers.length,
    unitSystem: ai.scaleText || 'AI (szacunkowo)',
    insUnits: 6,
    layers,
    entities,
    blocks,
    lineGroups,
  };
}
