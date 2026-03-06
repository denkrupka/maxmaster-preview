/**
 * PDF Geometry Worker — Runs heavy operator processing off the main thread.
 *
 * Receives: fnArray, argsArray, viewport transform, OPS map
 * Returns: paths[], images[] + progress updates
 */

// ==================== Types (duplicated to keep worker self-contained) ====================

interface Point { x: number; y: number }
interface PathSegment { type: 'M' | 'L' | 'C' | 'Z'; points: Point[] }
interface PathStyle {
  strokeColor: string; fillColor: string; lineWidth: number;
  dashPattern: number[]; isStroked: boolean; isFilled: boolean;
}
interface PathResult {
  segments: PathSegment[]; style: PathStyle;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  isClosed: boolean; lengthPx: number;
}
interface ImageResult { objectName: string; x: number; y: number; width: number; height: number }
type CTM = [number, number, number, number, number, number];
interface GfxState {
  ctm: CTM; strokeColor: string; fillColor: string;
  lineWidth: number; dashPattern: number[]; dashPhase: number;
}

// ==================== Helpers ====================

function cloneState(s: GfxState): GfxState {
  return { ctm: [...s.ctm] as CTM, strokeColor: s.strokeColor, fillColor: s.fillColor,
    lineWidth: s.lineWidth, dashPattern: [...s.dashPattern], dashPhase: s.dashPhase };
}

function multiplyCTM(m1: CTM, m2: CTM): CTM {
  return [
    m1[0]*m2[0]+m1[2]*m2[1], m1[1]*m2[0]+m1[3]*m2[1],
    m1[0]*m2[2]+m1[2]*m2[3], m1[1]*m2[2]+m1[3]*m2[3],
    m1[0]*m2[4]+m1[2]*m2[5]+m1[4], m1[1]*m2[4]+m1[3]*m2[5]+m1[5],
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  return '#' + [r,g,b].map(v => c(v).toString(16).padStart(2,'0')).join('');
}
function grayToHex(g: number) { return rgbToHex(g,g,g); }
function cmykToHex(c: number, m: number, y: number, k: number) {
  return rgbToHex((1-c)*(1-k), (1-m)*(1-k), (1-y)*(1-k));
}

function segmentLength(segs: PathSegment[]): number {
  let total = 0, cx = 0, cy = 0;
  for (const s of segs) {
    if (s.type === 'M' && s.points.length > 0) { cx = s.points[0].x; cy = s.points[0].y; }
    else if (s.type === 'L' && s.points.length > 0) {
      const p = s.points[0]; total += Math.sqrt((p.x-cx)**2+(p.y-cy)**2); cx = p.x; cy = p.y;
    } else if (s.type === 'C' && s.points.length >= 3) {
      const [cp1,cp2,end] = s.points;
      const chord = Math.sqrt((end.x-cx)**2+(end.y-cy)**2);
      const poly = Math.sqrt((cp1.x-cx)**2+(cp1.y-cy)**2)
        + Math.sqrt((cp2.x-cp1.x)**2+(cp2.y-cp1.y)**2)
        + Math.sqrt((end.x-cp2.x)**2+(end.y-cp2.y)**2);
      total += (chord+poly)/2; cx = end.x; cy = end.y;
    }
  }
  return total;
}

function computeBBox(segs: PathSegment[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of segs) for (const p of s.points) {
    if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
  }
  return isFinite(minX) ? { minX, minY, maxX, maxY } : { minX:0, minY:0, maxX:0, maxY:0 };
}

// ==================== Main processing ====================

interface WorkerInput {
  fnArray: number[];
  argsArray: any[][];
  viewportTransform: number[];
  ops: Record<string, number>;
}

function processOperators(data: WorkerInput): { paths: PathResult[]; images: ImageResult[] } {
  const { fnArray, argsArray, viewportTransform: vt, ops } = data;

  const stateStack: GfxState[] = [];
  let state: GfxState = {
    ctm: [1,0,0,1,0,0], strokeColor: '#000000', fillColor: '#000000',
    lineWidth: 1, dashPattern: [], dashPhase: 0,
  };
  let currentSegments: PathSegment[] = [];
  const paths: PathResult[] = [];
  const images: ImageResult[] = [];

  function toScreen(x: number, y: number): Point {
    const ctm = state.ctm;
    const tx = ctm[0]*x + ctm[2]*y + ctm[4];
    const ty = ctm[1]*x + ctm[3]*y + ctm[5];
    return { x: vt[0]*tx + vt[2]*ty + vt[4], y: vt[1]*tx + vt[3]*ty + vt[5] };
  }

  function savePath(isStroked: boolean, isFilled: boolean) {
    if (currentSegments.length === 0) return;
    paths.push({
      segments: currentSegments,
      style: { strokeColor: state.strokeColor, fillColor: state.fillColor,
        lineWidth: state.lineWidth, dashPattern: [...state.dashPattern], isStroked, isFilled },
      bbox: computeBBox(currentSegments),
      isClosed: currentSegments.length > 0 && currentSegments[currentSegments.length-1].type === 'Z',
      lengthPx: segmentLength(currentSegments),
    });
    currentSegments = [];
  }

  const total = fnArray.length;
  const PROGRESS_INTERVAL = 50000;
  let lastProgress = 0;

  for (let i = 0; i < total; i++) {
    // Report progress periodically
    if (i - lastProgress >= PROGRESS_INTERVAL) {
      lastProgress = i;
      self.postMessage({ type: 'progress', percent: Math.round((i / total) * 100) });
    }

    const fn = fnArray[i];
    const args = argsArray[i];

    if (fn === ops.save) { stateStack.push(cloneState(state)); continue; }
    if (fn === ops.restore) { if (stateStack.length > 0) state = stateStack.pop()!; continue; }
    if (fn === ops.transform) {
      if (args?.length >= 6) state.ctm = multiplyCTM(state.ctm, [args[0],args[1],args[2],args[3],args[4],args[5]]);
      continue;
    }

    // Colors
    if (fn === ops.setStrokeRGBColor) { if (args?.length>=3) state.strokeColor = rgbToHex(args[0],args[1],args[2]); continue; }
    if (fn === ops.setFillRGBColor) { if (args?.length>=3) state.fillColor = rgbToHex(args[0],args[1],args[2]); continue; }
    if (fn === ops.setStrokeGray) { if (args?.length>=1) state.strokeColor = grayToHex(args[0]); continue; }
    if (fn === ops.setFillGray) { if (args?.length>=1) state.fillColor = grayToHex(args[0]); continue; }
    if (fn === ops.setStrokeCMYKColor) { if (args?.length>=4) state.strokeColor = cmykToHex(args[0],args[1],args[2],args[3]); continue; }
    if (fn === ops.setFillCMYKColor) { if (args?.length>=4) state.fillColor = cmykToHex(args[0],args[1],args[2],args[3]); continue; }

    // Line style
    if (fn === ops.setLineWidth) { if (args?.length>=1) state.lineWidth = args[0]; continue; }
    if (fn === ops.setDash) { if (args?.length>=2) { state.dashPattern = Array.isArray(args[0]) ? args[0] : []; state.dashPhase = args[1]||0; } continue; }

    // Path construction
    if (fn === ops.moveTo) { if (args?.length>=2) currentSegments.push({ type:'M', points:[toScreen(args[0],args[1])] }); continue; }
    if (fn === ops.lineTo) { if (args?.length>=2) currentSegments.push({ type:'L', points:[toScreen(args[0],args[1])] }); continue; }
    if (fn === ops.curveTo) { if (args?.length>=6) currentSegments.push({ type:'C', points:[toScreen(args[0],args[1]),toScreen(args[2],args[3]),toScreen(args[4],args[5])] }); continue; }
    if (fn === ops.curveTo2) { if (args?.length>=4) { const cp2=toScreen(args[0],args[1]),end=toScreen(args[2],args[3]); currentSegments.push({type:'C',points:[cp2,cp2,end]}); } continue; }
    if (fn === ops.curveTo3) { if (args?.length>=4) { const cp1=toScreen(args[0],args[1]),end=toScreen(args[2],args[3]); currentSegments.push({type:'C',points:[cp1,end,end]}); } continue; }
    if (fn === ops.closePath) { currentSegments.push({ type:'Z', points:[] }); continue; }
    if (fn === ops.rectangle) {
      if (args?.length>=4) {
        const [rx,ry,rw,rh] = args;
        currentSegments.push({type:'M',points:[toScreen(rx,ry)]},{type:'L',points:[toScreen(rx+rw,ry)]},
          {type:'L',points:[toScreen(rx+rw,ry+rh)]},{type:'L',points:[toScreen(rx,ry+rh)]},{type:'Z',points:[]});
      }
      continue;
    }

    // constructPath (batched ops in pdf.js v4+)
    if (fn === ops.constructPath) {
      if (!args || args.length < 2) continue;
      const subOps: number[] = args[0]; const coords: number[] = args[1];
      let ci = 0;
      for (const sub of subOps) {
        if (sub === ops.moveTo) { if (ci+2<=coords.length) { currentSegments.push({type:'M',points:[toScreen(coords[ci],coords[ci+1])]}); ci+=2; } }
        else if (sub === ops.lineTo) { if (ci+2<=coords.length) { currentSegments.push({type:'L',points:[toScreen(coords[ci],coords[ci+1])]}); ci+=2; } }
        else if (sub === ops.curveTo) { if (ci+6<=coords.length) { currentSegments.push({type:'C',points:[toScreen(coords[ci],coords[ci+1]),toScreen(coords[ci+2],coords[ci+3]),toScreen(coords[ci+4],coords[ci+5])]}); ci+=6; } }
        else if (sub === ops.curveTo2) { if (ci+4<=coords.length) { const cp2=toScreen(coords[ci],coords[ci+1]),end=toScreen(coords[ci+2],coords[ci+3]); currentSegments.push({type:'C',points:[cp2,cp2,end]}); ci+=4; } }
        else if (sub === ops.curveTo3) { if (ci+4<=coords.length) { const cp1=toScreen(coords[ci],coords[ci+1]),end=toScreen(coords[ci+2],coords[ci+3]); currentSegments.push({type:'C',points:[cp1,end,end]}); ci+=4; } }
        else if (sub === ops.closePath) { currentSegments.push({type:'Z',points:[]}); }
        else if (sub === ops.rectangle) { if (ci+4<=coords.length) { const [rx,ry,rw,rh]=[coords[ci],coords[ci+1],coords[ci+2],coords[ci+3]]; currentSegments.push({type:'M',points:[toScreen(rx,ry)]},{type:'L',points:[toScreen(rx+rw,ry)]},{type:'L',points:[toScreen(rx+rw,ry+rh)]},{type:'L',points:[toScreen(rx,ry+rh)]},{type:'Z',points:[]}); ci+=4; } }
      }
      continue;
    }

    // Path rendering
    if (fn === ops.stroke) { savePath(true,false); continue; }
    if (fn === ops.closeStroke) { currentSegments.push({type:'Z',points:[]}); savePath(true,false); continue; }
    if (fn === ops.fill || fn === ops.eoFill) { savePath(false,true); continue; }
    if (fn === ops.fillStroke || fn === ops.eoFillStroke) { savePath(true,true); continue; }
    if (fn === ops.closeFillStroke || fn === ops.closeEOFillStroke) { currentSegments.push({type:'Z',points:[]}); savePath(true,true); continue; }
    if (fn === ops.endPath) { currentSegments = []; continue; }

    // Images
    if (fn === ops.paintImageXObject || fn === ops.paintImageMaskXObject || fn === ops.paintInlineImageXObject) {
      const origin = toScreen(0,0), corner = toScreen(1,1);
      images.push({ objectName: args?.[0]||'inline', x: Math.min(origin.x,corner.x), y: Math.min(origin.y,corner.y),
        width: Math.abs(corner.x-origin.x), height: Math.abs(corner.y-origin.y) });
    }
  }

  // Filter out degenerate paths (no segments or zero-size bbox)
  const filtered = paths.filter(p => {
    if (p.segments.length === 0) return false;
    const b = p.bbox;
    // Skip paths smaller than 0.5px in both dimensions (noise/artifacts)
    if (b.maxX - b.minX < 0.5 && b.maxY - b.minY < 0.5 && p.lengthPx < 0.5) return false;
    return true;
  });

  return { paths: filtered, images };
}

// ==================== Worker message handler ====================

self.onmessage = function(e: MessageEvent) {
  try {
    const result = processOperators(e.data as WorkerInput);
    self.postMessage({ type: 'result', paths: result.paths, images: result.images });
  } catch (err: any) {
    self.postMessage({ type: 'error', message: err.message || 'Worker error' });
  }
};
