/**
 * PDF Analyzer — Main pipeline: style grouping → route detection →
 * symbol detection → scale detection → legend extraction → DxfAnalysis output
 *
 * Produces DxfAnalysis-compatible output so the existing rules engine
 * (applyRules) and UI (DxfTakeoffPanel) work without changes.
 */
import type {
  PdfPageExtraction,
  PdfPath,
  PdfStyleGroup,
  PdfDetectedSymbol,
  PdfDetectedRoom,
  PdfLegend,
  PdfLegendEntry,
  PdfScaleInfo,
  PdfExtractedText,
} from './pdfTypes';
import type {
  DxfAnalysis,
  AnalyzedLayer,
  AnalyzedEntity,
  AnalyzedBlock,
  LineGroup,
  EntityGeometry,
} from './dxfAnalyzer';

// ==================== STYLE GROUPING ====================

function dashKey(pattern: number[]): string {
  if (!pattern || pattern.length === 0) return 'solid';
  return pattern.map(v => v.toFixed(0)).join('-');
}

/** Group paths by visual style into pseudo-layers */
export function groupPathsByStyle(paths: PdfPath[]): PdfStyleGroup[] {
  const groupMap = new Map<string, { indices: number[]; totalLen: number }>();

  for (let i = 0; i < paths.length; i++) {
    const p = paths[i];
    const color = p.style.isStroked ? p.style.strokeColor : p.style.fillColor;
    const lw = p.style.lineWidth.toFixed(1);
    const dk = dashKey(p.style.dashPattern);
    const key = `${color}-${lw}-${dk}`;

    if (!groupMap.has(key)) groupMap.set(key, { indices: [], totalLen: 0 });
    const g = groupMap.get(key)!;
    g.indices.push(i);
    g.totalLen += p.lengthPx;
  }

  const groups: PdfStyleGroup[] = [];
  let idx = 0;

  for (const [key, data] of groupMap) {
    const [color, lw, dk] = key.split('-');
    const firstPath = paths[data.indices[0]];
    const lineWidth = parseFloat(lw) || 1;

    // Human-readable name
    const colorName = getColorName(color);
    const dashName = dk === 'solid' ? 'ciągły' : 'przeryw.';
    const name = `Grupa-${++idx} (${colorName}, ${lw}px, ${dashName})`;

    groups.push({
      id: `sg_${idx}`,
      name,
      styleKey: key,
      strokeColor: color,
      lineWidth,
      dashPattern: firstPath.style.dashPattern,
      pathCount: data.indices.length,
      pathIndices: data.indices,
      totalLengthPx: data.totalLen,
      totalLengthM: 0, // Will be set after scale detection
      visible: true,
    });
  }

  // Compute confidence for each group
  for (const g of groups) {
    g.aiConfidence = computeStyleGroupConfidence(g, paths);
  }

  // Sort by path count descending
  groups.sort((a, b) => b.pathCount - a.pathCount);

  // Split large groups by spatial proximity
  return splitGroupsByProximity(groups, paths);
}

function getColorName(hex: string): string {
  const c = hex.toLowerCase();
  if (c === '#ff0000' || c === '#cc0000') return 'czerwony';
  if (c === '#00ff00' || c === '#00cc00' || c === '#008000') return 'zielony';
  if (c === '#0000ff' || c === '#0000cc') return 'niebieski';
  if (c === '#000000') return 'czarny';
  if (c === '#ffffff') return 'biały';
  if (c === '#ffff00' || c === '#cccc00') return 'żółty';
  if (c === '#ff6600' || c === '#ff8800') return 'pomarańczowy';
  if (c === '#800080' || c === '#660066') return 'fioletowy';
  return hex;
}

/** Compute confidence for a style group being a meaningful electrical element group.
 *  Based on: path count, color distinctiveness, length consistency. */
function computeStyleGroupConfidence(group: PdfStyleGroup, paths: PdfPath[]): number {
  let conf = 0;

  // Path count factor: more paths = more confidence (up to 0.3)
  conf += Math.min(group.pathCount / 50, 1) * 0.3;

  // Non-black color = more likely intentional drawing layer (up to 0.3)
  const c = group.strokeColor.toLowerCase();
  if (c !== '#000000' && c !== '#ffffff' && c !== '#808080') {
    conf += 0.3;
  } else if (c === '#000000') {
    conf += 0.1; // Black is common for construction lines
  }

  // Has dash pattern = likely a specific cable type (up to 0.2)
  if (group.dashPattern.length > 0) conf += 0.2;

  // Category assigned (from legend or AI) = high confidence (up to 0.2)
  if (group.category) conf += 0.2;

  return parseFloat(Math.min(conf, 1).toFixed(2));
}

// ==================== PROXIMITY SPLITTING ====================

/**
 * Split style groups where paths are spatially disconnected.
 * Uses grid-based clustering: paths in the same grid cell or adjacent cells
 * are in the same spatial cluster. Only splits groups with 5+ paths
 * and where 2+ spatial clusters emerge.
 */
function splitGroupsByProximity(
  groups: PdfStyleGroup[],
  paths: PdfPath[],
  gridSize: number = 100, // px per cell
): PdfStyleGroup[] {
  const result: PdfStyleGroup[] = [];
  let globalIdx = 0;

  for (const group of groups) {
    // Don't split small groups
    if (group.pathCount < 5) {
      result.push({ ...group, id: `sg_${++globalIdx}` });
      continue;
    }

    // Assign each path to a grid cell based on its bbox center
    const cellMap = new Map<string, number[]>(); // "cx,cy" → pathIndices
    for (const pi of group.pathIndices) {
      const p = paths[pi];
      const cx = Math.floor(((p.bbox.minX + p.bbox.maxX) / 2) / gridSize);
      const cy = Math.floor(((p.bbox.minY + p.bbox.maxY) / 2) / gridSize);
      const key = `${cx},${cy}`;
      if (!cellMap.has(key)) cellMap.set(key, []);
      cellMap.get(key)!.push(pi);
    }

    // Union-Find on grid cells: adjacent cells (8-connected) belong to same cluster
    const cells = [...cellMap.keys()];
    const parent = new Map<string, string>();
    for (const c of cells) parent.set(c, c);

    function find(x: string): string {
      while (parent.get(x) !== x) {
        parent.set(x, parent.get(parent.get(x)!)!);
        x = parent.get(x)!;
      }
      return x;
    }
    function union(a: string, b: string) {
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    }

    for (const c of cells) {
      const [cx, cy] = c.split(',').map(Number);
      // Check 8 neighbors
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          const neighbor = `${cx + dx},${cy + dy}`;
          if (cellMap.has(neighbor)) union(c, neighbor);
        }
      }
    }

    // Collect clusters
    const clusters = new Map<string, number[]>();
    for (const c of cells) {
      const root = find(c);
      if (!clusters.has(root)) clusters.set(root, []);
      clusters.get(root)!.push(...cellMap.get(c)!);
    }

    // If only 1 cluster — keep original group
    if (clusters.size <= 1) {
      result.push({ ...group, id: `sg_${++globalIdx}` });
      continue;
    }

    // Split into sub-groups
    let subIdx = 0;
    const colorName = getColorName(group.strokeColor);
    const dk = dashKey(group.dashPattern);
    const dashName = dk === 'solid' ? 'ciągły' : 'przeryw.';

    for (const [, indices] of clusters) {
      subIdx++;
      const totalLen = indices.reduce((sum, pi) => sum + paths[pi].lengthPx, 0);
      const name = `Grupa-${++globalIdx} (${colorName}, ${group.lineWidth.toFixed(1)}px, ${dashName}, region ${subIdx})`;

      result.push({
        id: `sg_${globalIdx}`,
        name,
        styleKey: group.styleKey,
        strokeColor: group.strokeColor,
        lineWidth: group.lineWidth,
        dashPattern: group.dashPattern,
        pathCount: indices.length,
        pathIndices: indices,
        totalLengthPx: totalLen,
        totalLengthM: 0,
        visible: true,
        category: group.category,
        aiConfidence: group.aiConfidence,
      });
    }
  }

  result.sort((a, b) => b.pathCount - a.pathCount);
  return result;
}

// ==================== ROUTE DETECTION ====================

interface LineSegment {
  pathIndex: number;
  p1: { x: number; y: number };
  p2: { x: number; y: number };
  length: number;
}

/** Extract line segments from a path (flatten curves to polylines) */
function pathToLineSegments(path: PdfPath, pathIndex: number): LineSegment[] {
  const segments: LineSegment[] = [];
  let cx = 0, cy = 0;
  let startX = 0, startY = 0;

  for (const seg of path.segments) {
    switch (seg.type) {
      case 'M':
        if (seg.points.length > 0) {
          cx = seg.points[0].x; cy = seg.points[0].y;
          startX = cx; startY = cy;
        }
        break;
      case 'L':
        if (seg.points.length > 0) {
          const p = seg.points[0];
          const len = Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2);
          if (len > 0.5) {
            segments.push({ pathIndex, p1: { x: cx, y: cy }, p2: { x: p.x, y: p.y }, length: len });
          }
          cx = p.x; cy = p.y;
        }
        break;
      case 'C':
        if (seg.points.length >= 3) {
          // Flatten Bézier to ~4 line segments
          const [cp1, cp2, end] = seg.points;
          const steps = 4;
          for (let t = 0; t < steps; t++) {
            const t0 = t / steps;
            const t1 = (t + 1) / steps;
            const x0 = bezierPoint(cx, cp1.x, cp2.x, end.x, t0);
            const y0 = bezierPoint(cy, cp1.y, cp2.y, end.y, t0);
            const x1 = bezierPoint(cx, cp1.x, cp2.x, end.x, t1);
            const y1 = bezierPoint(cy, cp1.y, cp2.y, end.y, t1);
            const len = Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2);
            if (len > 0.5) {
              segments.push({ pathIndex, p1: { x: x0, y: y0 }, p2: { x: x1, y: y1 }, length: len });
            }
          }
          cx = end.x; cy = end.y;
        }
        break;
      case 'Z':
        if (Math.sqrt((startX - cx) ** 2 + (startY - cy) ** 2) > 0.5) {
          segments.push({ pathIndex, p1: { x: cx, y: cy }, p2: { x: startX, y: startY }, length: Math.sqrt((startX - cx) ** 2 + (startY - cy) ** 2) });
        }
        cx = startX; cy = startY;
        break;
    }
  }
  return segments;
}

function bezierPoint(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

/** Find connected line groups within a style group */
function findConnectedRoutes(
  paths: PdfPath[],
  pathIndices: number[],
  groupId: string,
  tolerance: number = 3
): LineGroup[] {
  // Extract all line segments from group's paths
  const allSegments: LineSegment[] = [];
  for (const pi of pathIndices) {
    allSegments.push(...pathToLineSegments(paths[pi], pi));
  }
  if (allSegments.length < 2) return [];

  // DFS for connected components
  const n = allSegments.length;
  const visited = new Array(n).fill(false);

  function pointsClose(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
    return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;
  }

  function connected(a: LineSegment, b: LineSegment): boolean {
    return pointsClose(a.p1, b.p1) || pointsClose(a.p1, b.p2) ||
           pointsClose(a.p2, b.p1) || pointsClose(a.p2, b.p2);
  }

  const groups: LineGroup[] = [];
  let counter = 0;

  for (let start = 0; start < n; start++) {
    if (visited[start]) continue;
    const component: number[] = [];
    const stack = [start];
    while (stack.length > 0) {
      const idx = stack.pop()!;
      if (visited[idx]) continue;
      visited[idx] = true;
      component.push(idx);
      for (let j = 0; j < n; j++) {
        if (!visited[j] && connected(allSegments[idx], allSegments[j])) {
          stack.push(j);
        }
      }
    }
    if (component.length < 2) continue;

    const compSegments = component.map(i => allSegments[i]);
    const totalLength = compSegments.reduce((sum, s) => sum + s.length, 0);
    const entityIndices = [...new Set(compSegments.map(s => s.pathIndex))];

    // Collect unique points and compute node degrees
    const pointMap = new Map<string, { x: number; y: number }>();
    const degreeMap = new Map<string, number>();
    for (const s of compSegments) {
      const k1 = `${Math.round(s.p1.x)},${Math.round(s.p1.y)}`;
      const k2 = `${Math.round(s.p2.x)},${Math.round(s.p2.y)}`;
      if (!pointMap.has(k1)) pointMap.set(k1, s.p1);
      if (!pointMap.has(k2)) pointMap.set(k2, s.p2);
      degreeMap.set(k1, (degreeMap.get(k1) || 0) + 1);
      degreeMap.set(k2, (degreeMap.get(k2) || 0) + 1);
    }

    // Branch points: degree > 2 (junctions)
    const branchPoints: { x: number; y: number; degree: number }[] = [];
    const endpoints: { x: number; y: number }[] = [];
    for (const [key, degree] of degreeMap) {
      const pt = pointMap.get(key)!;
      if (degree > 2) branchPoints.push({ ...pt, degree });
      else if (degree === 1) endpoints.push(pt);
    }

    groups.push({
      id: `${groupId}_route_${++counter}`,
      entityIndices,
      totalLengthM: totalLength, // In px initially, converted later
      layer: groupId,
      points: [...pointMap.values()],
      branchPoints: branchPoints.length > 0 ? branchPoints : undefined,
      endpoints: endpoints.length > 0 ? endpoints : undefined,
      branchCount: branchPoints.length > 0 ? branchPoints.length : undefined,
    });
  }

  return groups.sort((a, b) => b.totalLengthM - a.totalLengthM);
}

// ==================== SYMBOL DETECTION ====================

/** Detect small paths that look like symbols */
export function detectSymbols(
  paths: PdfPath[],
  styleGroups: PdfStyleGroup[],
  texts: PdfExtractedText[] = [],
  maxSymbolSize: number = 30,
  textSearchRadius: number = 40,
): PdfDetectedSymbol[] {
  const symbols: PdfDetectedSymbol[] = [];
  const clusters = new Map<string, PdfDetectedSymbol[]>();

  // Build reverse index: path → style group
  const pathToGroup = new Map<number, string>();
  for (const sg of styleGroups) {
    for (const pi of sg.pathIndices) {
      pathToGroup.set(pi, sg.id);
    }
  }

  for (let i = 0; i < paths.length; i++) {
    const p = paths[i];
    const bw = p.bbox.maxX - p.bbox.minX;
    const bh = p.bbox.maxY - p.bbox.minY;
    if (bw > maxSymbolSize || bh > maxSymbolSize || bw < 2 || bh < 2) continue;

    const centerX = (p.bbox.minX + p.bbox.maxX) / 2;
    const centerY = (p.bbox.minY + p.bbox.maxY) / 2;
    const radius = Math.max(bw, bh) / 2;
    const shape = classifyShape(p, bw, bh);
    const groupId = pathToGroup.get(i);

    // Find nearest text within radius (for description only, not for classification)
    const nearbyText = findNearestText(centerX, centerY, texts, textSearchRadius);
    const description = nearbyText || undefined;

    // Cluster by shape + style + approximate size
    const sizeKey = Math.round(radius / 2) * 2; // Quantize size
    const colorKey = p.style.isStroked ? p.style.strokeColor : p.style.fillColor;
    const clusterKey = `${shape}-${colorKey}-${sizeKey}`;

    if (!clusters.has(clusterKey)) clusters.set(clusterKey, []);
    clusters.get(clusterKey)!.push({
      clusterId: clusterKey,
      shape,
      centerX,
      centerY,
      radius,
      styleGroupId: groupId,
      description,
    });
  }

  // Only keep clusters with 2+ instances (single symbols are likely noise)
  let clusterIdx = 0;
  for (const [key, items] of clusters) {
    if (items.length < 2) continue;
    const clusterId = `cluster_${++clusterIdx}`;
    // Infer cluster description from most common nearby text
    const textCounts = new Map<string, number>();
    for (const sym of items) {
      if (sym.description) {
        textCounts.set(sym.description, (textCounts.get(sym.description) || 0) + 1);
      }
    }
    let clusterDesc: string | undefined;
    if (textCounts.size > 0) {
      clusterDesc = [...textCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }

    // Compute confidence for the cluster
    const sizeConf = Math.min(items.length / 10, 1) * 0.4;
    const shapeParts = key.split('-');
    const shape = shapeParts[0];
    const shapeConf = (shape !== 'OTHER') ? 0.3 : 0.1;
    const textConf = clusterDesc ? 0.15 : 0;
    const clusterConfidence = Math.min(sizeConf + shapeConf + textConf, 1);

    for (const sym of items) {
      symbols.push({
        ...sym,
        clusterId,
        description: sym.description || clusterDesc,
        confidence: parseFloat(clusterConfidence.toFixed(2)),
      });
    }
  }

  return symbols;
}

/** Find the nearest text item within search radius of a point */
function findNearestText(
  x: number, y: number,
  texts: PdfExtractedText[],
  maxDist: number,
): string | null {
  let best: PdfExtractedText | null = null;
  let bestDist = maxDist;

  for (const t of texts) {
    if (t.text.trim().length < 1 || t.text.trim().length > 30) continue;
    const tx = t.x + (t.width || 0) / 2;
    const ty = t.y + (t.height || 0) / 2;
    const dist = Math.sqrt((tx - x) ** 2 + (ty - y) ** 2);
    if (dist < bestDist) {
      bestDist = dist;
      best = t;
    }
  }

  return best ? best.text.trim() : null;
}

/** Classify a small path as a shape type */
function classifyShape(
  path: PdfPath,
  width: number,
  height: number,
): PdfDetectedSymbol['shape'] {
  const aspect = Math.min(width, height) / Math.max(width, height);
  const segCount = path.segments.filter(s => s.type !== 'M' && s.type !== 'Z').length;
  const hasCurves = path.segments.some(s => s.type === 'C');
  const lineCount = path.segments.filter(s => s.type === 'L').length;

  // Circle: closed path with curves, roughly equal width/height
  if (hasCurves && path.isClosed && aspect > 0.7) return 'CIRCLE';

  // Cross: 2 lines intersecting (4 line segments from 2 crossed lines)
  if (lineCount >= 2 && lineCount <= 6 && !path.isClosed && segCount <= 6) return 'CROSS';

  // Square/Rectangle: 4 lines, closed, aspect ratio near 1
  if (lineCount === 4 && path.isClosed && aspect > 0.7) return 'SQUARE';

  // Triangle: 3 lines, closed
  if (lineCount === 3 && path.isClosed) return 'TRIANGLE';

  // Diamond: 4 lines, closed, rotated
  if (lineCount === 4 && path.isClosed) return 'DIAMOND';

  return 'OTHER';
}

// ==================== SCALE DETECTION ====================

/** Detect scale from extracted text */
export function detectScale(
  texts: PdfExtractedText[],
  calibrationScaleRatio?: number
): PdfScaleInfo {
  // Try to find scale text in extracted texts
  const scalePatterns = [
    /[Ss]kala\s*:?\s*1\s*:\s*(\d+)/,
    /[Ss]cale\s*:?\s*1\s*:\s*(\d+)/,
    /SKALA\s*:?\s*1\s*:\s*(\d+)/,
    /M\s*1\s*:\s*(\d+)/,
    /1\s*:\s*(\d{2,4})\b/,
  ];

  for (const text of texts) {
    for (const pattern of scalePatterns) {
      const match = text.text.match(pattern);
      if (match) {
        const ratio = parseInt(match[1]);
        if (ratio >= 10 && ratio <= 5000) {
          // 1 PDF point = 1/72 inch = 0.0003528 m
          // At 1:ratio, 1px on page = (ratio / 72 * 0.0254) meters
          const scaleFactor = (ratio * 0.0254) / 72;
          return {
            scaleText: `1:${ratio}`,
            scaleRatio: ratio,
            scaleFactor,
            source: 'text_detection',
          };
        }
      }
    }
  }

  // Fallback to calibration value
  if (calibrationScaleRatio && calibrationScaleRatio > 0) {
    const scaleFactor = (calibrationScaleRatio * 0.0254) / 72;
    return {
      scaleText: `1:${calibrationScaleRatio}`,
      scaleRatio: calibrationScaleRatio,
      scaleFactor,
      source: 'calibration',
    };
  }

  // Default: assume 1:100
  const defaultRatio = 100;
  return {
    scaleText: `1:${defaultRatio} (domyślna)`,
    scaleRatio: defaultRatio,
    scaleFactor: (defaultRatio * 0.0254) / 72,
    source: 'default',
  };
}

// ==================== LEGEND EXTRACTION ====================

/**
 * Create a normalized shape signature for a group of paths.
 * Normalizes coordinates to 0-100 range and encodes segment types.
 * Used for matching symbol templates from legend to instances on drawing.
 */
function computeShapeSignature(pathGroup: PdfPath[]): string {
  if (pathGroup.length === 0) return '';

  // Compute combined bbox
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pathGroup) {
    if (p.bbox.minX < minX) minX = p.bbox.minX;
    if (p.bbox.minY < minY) minY = p.bbox.minY;
    if (p.bbox.maxX > maxX) maxX = p.bbox.maxX;
    if (p.bbox.maxY > maxY) maxY = p.bbox.maxY;
  }
  const w = maxX - minX || 1;
  const h = maxY - minY || 1;

  // Normalize segments to 0-100 space, quantize to reduce noise
  const parts: string[] = [];
  for (const p of pathGroup) {
    const color = p.style.isStroked ? p.style.strokeColor : p.style.fillColor;
    let segStr = '';
    for (const seg of p.segments) {
      const type = seg.type;
      if (type === 'Z') { segStr += 'Z'; continue; }
      const pts = seg.points.map(pt => {
        const nx = Math.round(((pt.x - minX) / w) * 20);
        const ny = Math.round(((pt.y - minY) / h) * 20);
        return `${nx},${ny}`;
      });
      segStr += `${type}${pts.join(';')}|`;
    }
    parts.push(`${color}:${p.style.lineWidth.toFixed(0)}:${p.isClosed ? 'c' : 'o'}:${segStr}`);
  }
  parts.sort();
  return parts.join('##');
}

/**
 * Compute a simpler signature for fast matching — segment counts + shape type + aspect ratio
 */
function computeSimpleSignature(pathGroup: PdfPath[]): string {
  let totalSegs = 0, curves = 0, lines = 0, closedCount = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const colors = new Set<string>();

  for (const p of pathGroup) {
    if (p.bbox.minX < minX) minX = p.bbox.minX;
    if (p.bbox.minY < minY) minY = p.bbox.minY;
    if (p.bbox.maxX > maxX) maxX = p.bbox.maxX;
    if (p.bbox.maxY > maxY) maxY = p.bbox.maxY;
    if (p.isClosed) closedCount++;
    const c = p.style.isStroked ? p.style.strokeColor : p.style.fillColor;
    colors.add(c);
    for (const s of p.segments) {
      if (s.type === 'L') { lines++; totalSegs++; }
      else if (s.type === 'C') { curves++; totalSegs++; }
    }
  }

  const w = maxX - minX || 1;
  const h = maxY - minY || 1;
  const aspect = Math.round((Math.min(w, h) / Math.max(w, h)) * 10);

  return `p${pathGroup.length}:s${totalSegs}:l${lines}:c${curves}:cl${closedCount}:a${aspect}:col${colors.size}`;
}

/** Check if two shape signatures are similar enough to be the same symbol */
function signaturesMatch(sig1: string, sig2: string): boolean {
  if (sig1 === sig2) return true;

  // Parse simple signatures and compare
  const parse = (s: string) => {
    const m: Record<string, number> = {};
    for (const part of s.split(':')) {
      const key = part.replace(/\d+$/, '');
      const val = parseInt(part.replace(/^\D+/, ''));
      m[key] = val;
    }
    return m;
  };

  const a = parse(sig1);
  const b = parse(sig2);

  // Must have same number of sub-paths
  if (a['p'] !== b['p']) return false;
  // Segment count within 20%
  const segDiff = Math.abs((a['s'] || 0) - (b['s'] || 0));
  if (segDiff > Math.max(a['s'] || 1, b['s'] || 1) * 0.3) return false;
  // Similar aspect ratio
  if (Math.abs((a['a'] || 0) - (b['a'] || 0)) > 3) return false;
  // Same closed/open pattern
  if (a['cl'] !== b['cl']) return false;

  return true;
}

/** Detect legend region and extract entries with symbol templates */
export function detectLegend(
  paths: PdfPath[],
  texts: PdfExtractedText[],
  pageWidth: number,
  pageHeight: number,
  styleGroups?: PdfStyleGroup[],
): PdfLegend | null {
  // Strategy 1: Find "LEGENDA" text and look for enclosing rectangle
  const legendText = texts.find(t => /LEGENDA/i.test(t.text.trim()));
  let bestRect: PdfPath | null = null;

  if (legendText) {
    // Find the smallest enclosing closed rectangle around "LEGENDA" text
    let bestArea = Infinity;
    for (const p of paths) {
      if (!p.isClosed) continue;
      const w = p.bbox.maxX - p.bbox.minX;
      const h = p.bbox.maxY - p.bbox.minY;
      // Must be reasonably sized (not tiny decorations, not the whole page)
      if (w < 50 || h < 50) continue;
      const area = w * h;
      if (area > pageWidth * pageHeight * 0.8) continue;
      // Must contain the LEGENDA text
      if (legendText.x >= p.bbox.minX - 5 && legendText.x <= p.bbox.maxX + 5 &&
          legendText.y >= p.bbox.minY - 5 && legendText.y <= p.bbox.maxY + 5) {
        // Pick the smallest enclosing rect (closest to legend boundary)
        if (area < bestArea) {
          bestArea = area;
          bestRect = p;
        }
      }
    }
  }

  // Strategy 2 (fallback): Look for large rectangles with high text density
  if (!bestRect) {
    const candidateRects = paths.filter(p => {
      if (!p.isClosed) return false;
      const w = p.bbox.maxX - p.bbox.minX;
      const h = p.bbox.maxY - p.bbox.minY;
      return w > pageWidth * 0.05 && w < pageWidth * 0.7
        && h > pageHeight * 0.05 && h < pageHeight * 0.85;
    });

    let bestScore = 0;
    for (const rect of candidateRects) {
      const textsInside = texts.filter(t =>
        t.x >= rect.bbox.minX && t.x <= rect.bbox.maxX &&
        t.y >= rect.bbox.minY && t.y <= rect.bbox.maxY
      );
      let score = textsInside.length;
      if (textsInside.some(t => /LEGENDA/i.test(t.text))) score += 20;
      if (score > bestScore) {
        bestScore = score;
        bestRect = rect;
      }
    }
    if (bestScore < 3) bestRect = null;
  }

  if (!bestRect) return null;

  const lb = bestRect.bbox;

  // Index all paths inside legend
  const legendPathIndices: number[] = [];
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i];
    if (p.bbox.minX >= lb.minX - 5 && p.bbox.maxX <= lb.maxX + 5 &&
        p.bbox.minY >= lb.minY - 5 && p.bbox.maxY <= lb.maxY + 5) {
      legendPathIndices.push(i);
    }
  }

  // Get texts inside legend, sorted by Y (top to bottom)
  const legendTexts = texts.filter(t =>
    t.x >= lb.minX && t.x <= lb.maxX &&
    t.y >= lb.minY && t.y <= lb.maxY
  ).sort((a, b) => a.y - b.y);

  // Group texts into rows (entries)
  const ROW_TOL = 12;
  const textRows: PdfExtractedText[][] = [];
  for (const t of legendTexts) {
    if (t.text.trim().length < 2) continue;
    // Skip "LEGENDA" header
    if (/^LEGENDA$/i.test(t.text.trim())) continue;
    const lastRow = textRows[textRows.length - 1];
    if (lastRow && Math.abs(t.y - lastRow[0].y) < ROW_TOL) {
      lastRow.push(t);
    } else {
      textRows.push([t]);
    }
  }

  // For each text row, find symbol graphic to the left
  const entries: PdfLegendEntry[] = [];
  const usedPathIndices = new Set<number>();

  for (const row of textRows) {
    // Combine row texts into description
    const rowTexts = row.sort((a, b) => a.x - b.x);
    const description = rowTexts.map(t => t.text.trim()).join(' ');
    if (description.length < 3) continue;

    const rowCenterY = row[0].y + (row[0].height || 10) / 2;
    const rowMinX = Math.min(...row.map(t => t.x));

    // Find symbol paths to the left of text in this row
    const symbolPathIdxs: number[] = [];
    for (const pi of legendPathIndices) {
      if (usedPathIndices.has(pi)) continue;
      const p = paths[pi];
      const pCenterY = (p.bbox.minY + p.bbox.maxY) / 2;
      const pw = p.bbox.maxX - p.bbox.minX;
      const ph = p.bbox.maxY - p.bbox.minY;
      // Symbol is to the left of text, on same row, and not too big
      if (Math.abs(pCenterY - rowCenterY) < ROW_TOL + 5 &&
          p.bbox.maxX < rowMinX + 20 &&
          pw < 80 && ph < 40 && pw > 1 && ph > 1) {
        symbolPathIdxs.push(pi);
      }
    }

    // Mark paths as used
    for (const pi of symbolPathIdxs) usedPathIndices.add(pi);

    const symbolPaths = symbolPathIdxs.map(i => paths[i]);
    const sig = symbolPaths.length > 0 ? computeSimpleSignature(symbolPaths) : undefined;
    let symBbox: { w: number; h: number } | undefined;
    if (symbolPaths.length > 0) {
      let sMinX = Infinity, sMinY = Infinity, sMaxX = -Infinity, sMaxY = -Infinity;
      for (const sp of symbolPaths) {
        if (sp.bbox.minX < sMinX) sMinX = sp.bbox.minX;
        if (sp.bbox.minY < sMinY) sMinY = sp.bbox.minY;
        if (sp.bbox.maxX > sMaxX) sMaxX = sp.bbox.maxX;
        if (sp.bbox.maxY > sMaxY) sMaxY = sp.bbox.maxY;
      }
      symBbox = { w: sMaxX - sMinX, h: sMaxY - sMinY };
    }

    // Also capture color/line info for fallback matching
    const samplePath = symbolPaths[0];
    const sampleColor = samplePath
      ? (samplePath.style.isStroked ? samplePath.style.strokeColor : samplePath.style.fillColor)
      : undefined;

    entries.push({
      label: description.substring(0, 80),
      description,
      sampleColor,
      sampleLineWidth: samplePath?.style.lineWidth,
      symbolSignature: sig,
      symbolBbox: symBbox,
      symbolPathIndices: symbolPathIdxs.length > 0 ? symbolPathIdxs : undefined,
    });
  }

  return {
    boundingBox: {
      x: lb.minX, y: lb.minY,
      width: lb.maxX - lb.minX,
      height: lb.maxY - lb.minY,
    },
    entries,
  };
}

/**
 * Match symbols on the drawing to legend entries by shape similarity.
 * Returns symbols categorized by legend entry descriptions.
 * Excludes symbols inside the legend bounding box.
 */
export function matchSymbolsToLegend(
  paths: PdfPath[],
  legend: PdfLegend,
  maxSymbolSize: number = 50,
): PdfDetectedSymbol[] {
  const lb = legend.boundingBox;
  const results: PdfDetectedSymbol[] = [];

  // Get legend entries that have symbol signatures
  const entriesWithSigs = legend.entries.filter(e => e.symbolSignature && e.symbolBbox);
  if (entriesWithSigs.length === 0) return results;

  // Pre-compute size ranges for each legend entry (allow ±40% size variation)
  const entryMeta = entriesWithSigs.map(e => ({
    entry: e,
    minW: e.symbolBbox!.w * 0.5,
    maxW: e.symbolBbox!.w * 1.8,
    minH: e.symbolBbox!.h * 0.5,
    maxH: e.symbolBbox!.h * 1.8,
    templatePaths: (e.symbolPathIndices || []).map(i => paths[i]),
  }));

  // Scan all small paths on the drawing, group nearby ones, and match to legend
  // First: find all "small path clusters" — groups of nearby small paths
  const smallPaths: { idx: number; cx: number; cy: number; w: number; h: number }[] = [];
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i];
    const w = p.bbox.maxX - p.bbox.minX;
    const h = p.bbox.maxY - p.bbox.minY;
    if (w > maxSymbolSize || h > maxSymbolSize || w < 1 || h < 1) continue;
    // Skip paths inside legend
    const cx = (p.bbox.minX + p.bbox.maxX) / 2;
    const cy = (p.bbox.minY + p.bbox.maxY) / 2;
    if (cx >= lb.x && cx <= lb.x + lb.width && cy >= lb.y && cy <= lb.y + lb.height) continue;
    smallPaths.push({ idx: i, cx, cy, w, h });
  }

  // Cluster nearby small paths (within proximity)
  const CLUSTER_DIST = 15;
  const clustered = new Array(smallPaths.length).fill(false);
  const clusters: number[][] = []; // each cluster = array of smallPaths indices

  for (let i = 0; i < smallPaths.length; i++) {
    if (clustered[i]) continue;
    const cluster = [i];
    clustered[i] = true;
    // BFS to find nearby paths
    const queue = [i];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (let j = i + 1; j < smallPaths.length; j++) {
        if (clustered[j]) continue;
        const dx = smallPaths[cur].cx - smallPaths[j].cx;
        const dy = smallPaths[cur].cy - smallPaths[j].cy;
        if (Math.abs(dx) < CLUSTER_DIST && Math.abs(dy) < CLUSTER_DIST) {
          clustered[j] = true;
          cluster.push(j);
          queue.push(j);
        }
      }
    }
    clusters.push(cluster);
  }

  // For each cluster, compute signature and try to match to a legend entry
  let matchId = 0;
  for (const cluster of clusters) {
    const clusterPathIndices = cluster.map(ci => smallPaths[ci].idx);
    const clusterPaths = clusterPathIndices.map(i => paths[i]);

    // Compute cluster bbox
    let cMinX = Infinity, cMinY = Infinity, cMaxX = -Infinity, cMaxY = -Infinity;
    for (const ci of cluster) {
      const sp = smallPaths[ci];
      if (sp.cx - sp.w / 2 < cMinX) cMinX = sp.cx - sp.w / 2;
      if (sp.cy - sp.h / 2 < cMinY) cMinY = sp.cy - sp.h / 2;
      if (sp.cx + sp.w / 2 > cMaxX) cMaxX = sp.cx + sp.w / 2;
      if (sp.cy + sp.h / 2 > cMaxY) cMaxY = sp.cy + sp.h / 2;
    }
    const cw = cMaxX - cMinX;
    const ch = cMaxY - cMinY;

    // Skip if cluster is too big to be a symbol
    if (cw > maxSymbolSize * 2 || ch > maxSymbolSize * 2) continue;

    const clusterSig = computeSimpleSignature(clusterPaths);
    const cx = (cMinX + cMaxX) / 2;
    const cy = (cMinY + cMaxY) / 2;

    // Try to match to each legend entry
    let bestEntry: PdfLegendEntry | null = null;
    let bestConf = 0;

    for (const meta of entryMeta) {
      // Size check
      if (cw < meta.minW || cw > meta.maxW || ch < meta.minH || ch > meta.maxH) continue;

      // Signature match
      if (signaturesMatch(clusterSig, meta.entry.symbolSignature!)) {
        const conf = 0.8;
        if (conf > bestConf) {
          bestConf = conf;
          bestEntry = meta.entry;
        }
      }
    }

    if (bestEntry) {
      bestEntry.matchCount = (bestEntry.matchCount || 0) + 1;
      // Use legend label as clusterId so symbols group by category
      const legendClusterId = `legend:${bestEntry.label}`;
      results.push({
        clusterId: legendClusterId,
        shape: 'OTHER',
        centerX: cx,
        centerY: cy,
        radius: Math.max(cw, ch) / 2,
        category: bestEntry.label,
        description: bestEntry.description,
        confidence: bestConf,
      });
    }
  }

  return results;
}

// ==================== ROOM / ZONE DETECTION ====================

/** Room name patterns commonly found on Polish architectural/electrical plans */
const ROOM_PATTERNS = [
  /pok[oó]j/i, /łazienka/i, /kuchnia/i, /salon/i, /korytarz/i, /hol/i,
  /WC/i, /przedpok[oó]j/i, /sypialnia/i, /gabinet/i, /garderoba/i,
  /pralnia/i, /kotłownia/i, /garaż/i, /magazyn/i, /biuro/i, /serwerownia/i,
  /pomieszczenie/i, /pom\.\s*\d/i, /p\.\d/i, /piętro/i,
  /klatka/i, /schody/i, /taras/i, /balkon/i, /loggia/i,
];

/** Detect room boundaries from large closed rectangular/polygonal paths */
export function detectRooms(
  paths: PdfPath[],
  texts: PdfExtractedText[],
  pageWidth: number,
  pageHeight: number,
  minRoomSizePx: number = 60,
  legendBbox?: { minX: number; minY: number; maxX: number; maxY: number } | null,
): PdfDetectedRoom[] {
  const rooms: PdfDetectedRoom[] = [];
  const minArea = minRoomSizePx * minRoomSizePx;
  // Max room area = 70% of page (to skip page border)
  const maxArea = pageWidth * pageHeight * 0.7;

  for (let i = 0; i < paths.length; i++) {
    const p = paths[i];
    if (!p.isClosed) continue;

    const w = p.bbox.maxX - p.bbox.minX;
    const h = p.bbox.maxY - p.bbox.minY;
    if (w < minRoomSizePx || h < minRoomSizePx) continue;

    const area = w * h;
    if (area < minArea || area > maxArea) continue;

    // Skip paths that overlap with legend area
    if (legendBbox) {
      const cx = (p.bbox.minX + p.bbox.maxX) / 2;
      const cy = (p.bbox.minY + p.bbox.maxY) / 2;
      if (cx >= legendBbox.minX - 20 && cx <= legendBbox.maxX + 20 &&
          cy >= legendBbox.minY - 20 && cy <= legendBbox.maxY + 20) continue;
    }

    // Must have 3+ line segments (polygon)
    const lineSegs = p.segments.filter(s => s.type === 'L');
    if (lineSegs.length < 3) continue;

    // Extract polygon vertices
    const polygon: { x: number; y: number }[] = [];
    for (const seg of p.segments) {
      if (seg.type === 'M' || seg.type === 'L') {
        if (seg.points.length > 0) polygon.push(seg.points[0]);
      }
    }
    if (polygon.length < 3) continue;

    // Only create room if text inside matches a known room name pattern
    const name = findRoomName(p.bbox, texts);
    if (!name) continue; // Skip polygons without a recognizable room name

    rooms.push({
      id: `room_${rooms.length + 1}`,
      name,
      polygon,
      bbox: { ...p.bbox },
      area,
      symbolCount: 0,
      routeCount: 0,
    });
  }

  // Remove overlapping/duplicate rooms (keep larger ones)
  return deduplicateRooms(rooms);
}

/** Find room name from text items inside or near a bounding box.
 *  Only returns names matching known room-name patterns — no arbitrary text fallback. */
function findRoomName(
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
  texts: PdfExtractedText[],
): string | null {
  const margin = 10;

  // Texts inside the room
  const insideTexts = texts.filter(t =>
    t.x >= bbox.minX - margin && t.x <= bbox.maxX + margin &&
    t.y >= bbox.minY - margin && t.y <= bbox.maxY + margin
  );

  // Only return text that matches known room name patterns
  for (const t of insideTexts) {
    for (const pattern of ROOM_PATTERNS) {
      if (pattern.test(t.text)) return t.text.trim();
    }
  }

  return null;
}

/** Remove rooms that are largely overlapping, keeping the larger one */
function deduplicateRooms(rooms: PdfDetectedRoom[]): PdfDetectedRoom[] {
  // Sort by area descending
  rooms.sort((a, b) => b.area - a.area);
  const keep: PdfDetectedRoom[] = [];

  for (const room of rooms) {
    const isDuplicate = keep.some(existing => {
      // Check if >60% of smaller room's bbox is inside the larger one
      const overlapX = Math.max(0, Math.min(existing.bbox.maxX, room.bbox.maxX) - Math.max(existing.bbox.minX, room.bbox.minX));
      const overlapY = Math.max(0, Math.min(existing.bbox.maxY, room.bbox.maxY) - Math.max(existing.bbox.minY, room.bbox.minY));
      const overlapArea = overlapX * overlapY;
      return overlapArea > room.area * 0.6;
    });
    if (!isDuplicate) keep.push(room);
  }

  return keep;
}

/** Point-in-polygon test (ray casting algorithm) */
function pointInPolygon(px: number, py: number, polygon: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Assign symbols and routes to detected rooms */
function assignToRooms(
  rooms: PdfDetectedRoom[],
  symbols: PdfDetectedSymbol[],
  routes: LineGroup[],
): void {
  for (const sym of symbols) {
    for (const room of rooms) {
      // Quick bbox check first
      if (sym.centerX < room.bbox.minX || sym.centerX > room.bbox.maxX ||
          sym.centerY < room.bbox.minY || sym.centerY > room.bbox.maxY) continue;

      if (pointInPolygon(sym.centerX, sym.centerY, room.polygon)) {
        sym.room = room.name;
        room.symbolCount++;
        break;
      }
    }
  }

  for (const route of routes) {
    if (route.points.length === 0) continue;
    // Use the midpoint of the route for assignment
    const midIdx = Math.floor(route.points.length / 2);
    const midPt = route.points[midIdx];
    for (const room of rooms) {
      if (midPt.x < room.bbox.minX || midPt.x > room.bbox.maxX ||
          midPt.y < room.bbox.minY || midPt.y > room.bbox.maxY) continue;
      if (pointInPolygon(midPt.x, midPt.y, room.polygon)) {
        room.routeCount++;
        break;
      }
    }
  }
}

// ==================== MAIN ANALYZER ====================

export interface PdfAnalyzeOptions {
  calibrationScaleRatio?: number;
  maxSymbolSize?: number;
  routeTolerance?: number;
}

export interface PdfAnalysisExtra {
  styleGroups: PdfStyleGroup[];
  symbols: PdfDetectedSymbol[];
  rooms: PdfDetectedRoom[];
  legend: PdfLegend | null;
  scaleInfo: PdfScaleInfo;
  extraction: PdfPageExtraction;
}

/** Yield to UI thread */
function yieldUI(): Promise<void> { return new Promise(r => setTimeout(r, 0)); }

/** Main analysis pipeline: extraction → style groups → routes → symbols → scale → DxfAnalysis */
export async function analyzePdfPage(
  extraction: PdfPageExtraction,
  options: PdfAnalyzeOptions = {},
  onProgress?: (step: string) => void,
): Promise<{ analysis: DxfAnalysis; extra: PdfAnalysisExtra }> {
  const { calibrationScaleRatio, maxSymbolSize = 30, routeTolerance = 3 } = options;

  // 1. Style grouping
  onProgress?.('Grupowanie stylów...');
  const styleGroups = groupPathsByStyle(extraction.paths);
  await yieldUI();

  // 2. Scale detection
  const scaleInfo = detectScale(extraction.texts, calibrationScaleRatio);

  // 3. Apply scale to style groups
  for (const sg of styleGroups) {
    sg.totalLengthM = sg.totalLengthPx * scaleInfo.scaleFactor;
  }

  // 4. Route detection — only top 20 groups by path count (avoid O(n²) on huge groups)
  onProgress?.('Wykrywanie tras...');
  const allRoutes: LineGroup[] = [];
  const sortedGroups = [...styleGroups].sort((a, b) => b.pathCount - a.pathCount);
  const routeGroups = sortedGroups.filter(sg => sg.pathCount >= 2 && sg.pathCount <= 5000).slice(0, 20);
  for (const sg of routeGroups) {
    const routes = findConnectedRoutes(extraction.paths, sg.pathIndices, sg.id, routeTolerance);
    for (const r of routes) {
      r.totalLengthM = r.totalLengthM * scaleInfo.scaleFactor;
      // Use human-readable style group name instead of sg_XX ID
      r.layer = sg.category || sg.name;
    }
    allRoutes.push(...routes);
    await yieldUI();
  }

  // 5. Legend extraction (with symbol template matching)
  onProgress?.('Szukanie legendy...');
  const legend = detectLegend(extraction.paths, extraction.texts, extraction.pageWidth, extraction.pageHeight, styleGroups);
  await yieldUI();

  // 6. Legend-based symbol matching (primary) + fallback basic detection
  onProgress?.('Dopasowywanie symboli...');
  let symbols: PdfDetectedSymbol[];
  if (legend && legend.entries.some(e => e.symbolSignature)) {
    symbols = matchSymbolsToLegend(extraction.paths, legend, maxSymbolSize);
    applyLegendToGroups(legend, styleGroups);
  } else {
    symbols = detectSymbols(extraction.paths, styleGroups, extraction.texts, maxSymbolSize);
  }
  await yieldUI();

  // 7. Room detection disabled — unreliable without AI/OCR (room names are arbitrary codes like B2.2.D.8.3)
  const rooms: PdfDetectedRoom[] = [];

  // 7b. Legend-based route measurement — match legend line entries to drawing paths by style
  if (legend) {
    onProgress?.('Pomiar tras z legendy...');
    for (const entry of legend.entries) {
      if (!entry.styleKey && !entry.sampleColor) continue;
      // Find matching style group
      const matchedGroup = styleGroups.find(g => {
        if (entry.styleKey && g.styleKey === entry.styleKey) return true;
        if (entry.sampleColor && g.strokeColor === entry.sampleColor) {
          if (entry.sampleLineWidth && Math.abs(g.lineWidth - entry.sampleLineWidth) > 0.5) return false;
          return true;
        }
        return false;
      });
      if (matchedGroup) {
        entry.totalLengthM = matchedGroup.totalLengthM;
        entry.matchedPathCount = matchedGroup.pathCount;
      }
    }
  }

  // 8. Convert to DxfAnalysis format
  onProgress?.('Tworzenie wyników...');
  const analysis = toDxfAnalysis(extraction, styleGroups, symbols, allRoutes, scaleInfo, legend);
  await yieldUI();

  return {
    analysis,
    extra: { styleGroups, symbols, rooms, legend, scaleInfo, extraction },
  };
}

/** Apply legend entries to style groups — match by color sample from legend symbols */
function applyLegendToGroups(legend: PdfLegend, groups: PdfStyleGroup[]) {
  for (const entry of legend.entries) {
    entry.category = entry.label;

    // Match style groups by sample color + lineWidth from legend symbol
    if (entry.sampleColor) {
      const matchedGroup = groups.find(g =>
        g.strokeColor === entry.sampleColor &&
        (!entry.sampleLineWidth || Math.abs(g.lineWidth - entry.sampleLineWidth) < 0.5)
      );
      if (matchedGroup) {
        matchedGroup.category = entry.label;
        entry.styleKey = matchedGroup.styleKey;
      }
    }
  }
}

// ==================== AI LEGEND MATCHING ====================

/** CSS/hex color name to approximate hex for matching */
const COLOR_NAME_MAP: Record<string, string[]> = {
  red: ['#ff0000', '#cc0000', '#ee0000', '#dd0000', '#ff3333'],
  blue: ['#0000ff', '#0000cc', '#0000ee', '#3333ff', '#0066ff', '#0000dd'],
  green: ['#00ff00', '#00cc00', '#008000', '#00aa00', '#009900'],
  black: ['#000000', '#111111', '#222222', '#333333'],
  magenta: ['#ff00ff', '#cc00cc', '#ee00ee', '#ff33ff'],
  cyan: ['#00ffff', '#00cccc', '#00eeee'],
  yellow: ['#ffff00', '#cccc00'],
  orange: ['#ff6600', '#ff8800', '#ff9900'],
  pink: ['#ff00ff', '#ff66ff', '#ff33ff', '#cc00cc'],
  purple: ['#800080', '#660066', '#9900cc'],
  brown: ['#8b4513', '#a0522d', '#663300'],
  gray: ['#808080', '#999999', '#666666', '#aaaaaa'],
  grey: ['#808080', '#999999', '#666666', '#aaaaaa'],
  white: ['#ffffff', '#eeeeee'],
};

function colorDistance(hex1: string, hex2: string): number {
  const parse = (h: string) => {
    const c = h.replace('#', '');
    return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
  };
  try {
    const [r1, g1, b1] = parse(hex1);
    const [r2, g2, b2] = parse(hex2);
    return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
  } catch {
    return 999;
  }
}

function findClosestStyleGroup(
  aiColor: string,
  aiLineWidth: string | undefined,
  aiLineStyle: string | undefined,
  groups: PdfStyleGroup[],
  usedGroupIds: Set<string>,
): PdfStyleGroup | null {
  // Resolve AI color name to hex candidates
  let targetHexes: string[];
  const lowerColor = aiColor.toLowerCase().trim();
  if (lowerColor.startsWith('#') && lowerColor.length >= 7) {
    targetHexes = [lowerColor];
  } else {
    targetHexes = COLOR_NAME_MAP[lowerColor] || [];
    // Also try if it's a Polish color name
    const polishMap: Record<string, string> = {
      czerwony: 'red', niebieski: 'blue', zielony: 'green', czarny: 'black',
      fioletowy: 'purple', żółty: 'yellow', pomarańczowy: 'orange', różowy: 'pink',
      biały: 'white', szary: 'gray', brązowy: 'brown', magenta: 'magenta', cyjan: 'cyan',
    };
    if (polishMap[lowerColor]) {
      targetHexes = COLOR_NAME_MAP[polishMap[lowerColor]] || [];
    }
  }

  if (targetHexes.length === 0) return null;

  // Width filter
  let widthRange: [number, number] | null = null;
  if (aiLineWidth === 'thin') widthRange = [0, 1.0];
  else if (aiLineWidth === 'medium') widthRange = [0.8, 2.5];
  else if (aiLineWidth === 'thick') widthRange = [2.0, 20];

  // Dash filter
  const wantDashed = aiLineStyle === 'dashed' || aiLineStyle === 'dotted';

  let bestGroup: PdfStyleGroup | null = null;
  let bestDist = Infinity;

  for (const g of groups) {
    if (usedGroupIds.has(g.id)) continue;

    // Width check
    if (widthRange && (g.lineWidth < widthRange[0] || g.lineWidth > widthRange[1])) continue;

    // Dash check
    const isDashed = g.dashPattern && g.dashPattern.length > 0;
    if (wantDashed && !isDashed) continue;

    // Color distance — find minimum distance to any target hex
    let minDist = Infinity;
    for (const hex of targetHexes) {
      const d = colorDistance(g.strokeColor, hex);
      if (d < minDist) minDist = d;
    }

    // Threshold: allow some color variation (max ~80 distance)
    if (minDist < 80 && minDist < bestDist) {
      bestDist = minDist;
      bestGroup = g;
    }
  }

  return bestGroup;
}

/** Match AI-analyzed legend entries to geometric style groups and update legend in place.
 *  Exported for use from PdfAnalysisModal. */
export function matchAiLegendToGeometry(
  aiEntries: Array<{
    label: string;
    description: string;
    entryType: string;
    color: string;
    lineStyle?: string;
    lineWidth?: string;
    category: string;
  }>,
  legend: PdfLegend,
  styleGroups: PdfStyleGroup[],
  paths: PdfPath[],
): void {
  const usedGroupIds = new Set<string>();

  // Replace geometric legend entries with AI entries, preserving geometric measurements
  legend.entries = aiEntries.map(ai => {
    const matchedGroup = findClosestStyleGroup(ai.color, ai.lineWidth, ai.lineStyle, styleGroups, usedGroupIds);
    if (matchedGroup) usedGroupIds.add(matchedGroup.id);

    const entry: PdfLegendEntry = {
      label: ai.label,
      description: ai.description,
      category: ai.category,
      sampleColor: matchedGroup?.strokeColor || undefined,
      sampleLineWidth: matchedGroup?.lineWidth,
      styleKey: matchedGroup?.styleKey,
    };

    // For line-type entries — compute total length from matched style group
    if (ai.entryType === 'line' && matchedGroup) {
      entry.totalLengthM = matchedGroup.totalLengthM;
      entry.matchedPathCount = matchedGroup.pathCount;
      matchedGroup.category = ai.label;
    }

    // For symbol-type entries — count matching small paths (existing geometric logic)
    if (ai.entryType === 'symbol' && matchedGroup) {
      // Count small closed paths in this style group as symbols
      let symbolCount = 0;
      for (const pi of matchedGroup.pathIndices) {
        const p = paths[pi];
        const w = p.bbox.maxX - p.bbox.minX;
        const h = p.bbox.maxY - p.bbox.minY;
        if (w < 50 && h < 50 && w > 1 && h > 1) symbolCount++;
      }
      entry.matchCount = symbolCount > 0 ? symbolCount : matchedGroup.pathCount;
      matchedGroup.category = ai.label;
    }

    return entry;
  });
}

/** Convert PDF analysis results to DxfAnalysis-compatible format */
function toDxfAnalysis(
  extraction: PdfPageExtraction,
  styleGroups: PdfStyleGroup[],
  symbols: PdfDetectedSymbol[],
  routes: LineGroup[],
  scaleInfo: PdfScaleInfo,
  legend?: PdfLegend | null,
): DxfAnalysis {
  // Layers = style groups
  const layers: AnalyzedLayer[] = styleGroups.map(sg => ({
    name: sg.name,
    color: sg.strokeColor,
    entityCount: sg.pathCount,
    frozen: !sg.visible,
    entityTypes: { PDF_PATH: sg.pathCount },
  }));

  // Entities
  const entities: AnalyzedEntity[] = [];
  let entityIdx = 0;

  // Build reverse map: pathIndex → styleGroup
  const pathGroupMap = new Map<number, PdfStyleGroup>();
  for (const sg of styleGroups) {
    for (const pi of sg.pathIndices) {
      pathGroupMap.set(pi, sg);
    }
  }

  // Paths → entities
  for (let i = 0; i < extraction.paths.length; i++) {
    const p = extraction.paths[i];
    const sg = pathGroupMap.get(i);
    const points = p.segments
      .filter(s => s.points.length > 0)
      .flatMap(s => s.points);

    entities.push({
      index: entityIdx++,
      entityType: 'PDF_PATH',
      layerName: sg?.name || 'Bez grupy',
      geometry: {
        type: 'polyline',
        points,
      },
      lengthM: p.lengthPx * scaleInfo.scaleFactor,
      areaM2: 0,
      properties: {
        pathIndex: i,
        styleColor: sg?.strokeColor || p.style.strokeColor,
        lineWidth: p.style.lineWidth,
        dashPattern: p.style.dashPattern,
        isClosed: p.isClosed,
      },
    });
  }

  // Symbols → entities
  const symbolClusters = new Map<string, PdfDetectedSymbol[]>();
  for (const sym of symbols) {
    if (!symbolClusters.has(sym.clusterId)) symbolClusters.set(sym.clusterId, []);
    symbolClusters.get(sym.clusterId)!.push(sym);
  }

  for (const sym of symbols) {
    entities.push({
      index: entityIdx++,
      entityType: 'PDF_SYMBOL',
      layerName: sym.styleGroupId ? (styleGroups.find(sg => sg.id === sym.styleGroupId)?.name || 'Symbole') : 'Symbole',
      blockName: sym.clusterId,
      geometry: {
        type: 'point',
        center: { x: sym.centerX, y: sym.centerY },
        radius: sym.radius,
        points: [{ x: sym.centerX, y: sym.centerY }],
      },
      lengthM: 0,
      areaM2: 0,
      properties: {
        symbolShape: sym.shape,
        clusterId: sym.clusterId,
        styleColor: sym.styleGroupId
          ? (styleGroups.find(sg => sg.id === sym.styleGroupId)?.strokeColor || '#000000')
          : '#000000',
        nearbyText: sym.description,
        category: sym.category,
        confidence: sym.confidence,
        room: sym.room,
      },
    });
  }

  // Texts → entities
  for (const t of extraction.texts) {
    entities.push({
      index: entityIdx++,
      entityType: 'PDF_TEXT',
      layerName: 'Tekst',
      geometry: {
        type: 'text',
        text: t.text,
        points: [{ x: t.x, y: t.y }],
      },
      lengthM: 0,
      areaM2: 0,
      properties: {
        fontSize: t.fontSize,
        fontName: t.fontName,
      },
    });
  }

  // Blocks = legend categories (if legend-based) or symbol clusters (fallback)
  const blocks: AnalyzedBlock[] = [];
  if (legend && legend.entries.some(e => (e.matchCount || 0) > 0)) {
    // Legend-based blocks: one block per legend entry with matches
    for (const entry of legend.entries) {
      if ((entry.matchCount || 0) === 0) continue;
      blocks.push({
        name: entry.label,
        insertCount: entry.matchCount!,
        sampleLayer: entry.category || entry.label,
        entityCount: 1,
        containedTypes: ['PDF_SYMBOL'],
      });
    }
  } else {
    // Fallback: cluster-based blocks
    for (const [clusterId, clusterSyms] of symbolClusters) {
      const first = clusterSyms[0];
      blocks.push({
        name: clusterId,
        insertCount: clusterSyms.length,
        sampleLayer: first.styleGroupId
          ? (styleGroups.find(sg => sg.id === first.styleGroupId)?.name || 'Symbole')
          : 'Symbole',
        entityCount: 1,
        containedTypes: ['PDF_SYMBOL'],
      });
    }
  }

  // Update route entity indices to use analysis-level indices
  const routesWithAnalysisIndices = routes.map(r => ({
    ...r,
    entityIndices: r.entityIndices, // These are pathIndices, matching entity indices 0..N-1
  }));

  return {
    totalEntities: entities.length,
    totalBlocks: blocks.length,
    totalLayers: layers.length,
    unitSystem: scaleInfo.scaleText || 'px',
    insUnits: 6, // meters (output)
    layers,
    entities,
    blocks,
    lineGroups: routesWithAnalysisIndices,
  };
}
