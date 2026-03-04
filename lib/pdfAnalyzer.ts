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

    // Find nearest text within radius
    const nearbyText = findNearestText(centerX, centerY, texts, textSearchRadius);
    const category = nearbyText ? classifyByNearbyText(nearbyText) : undefined;
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
      category,
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
    let clusterCategory: string | undefined;
    if (textCounts.size > 0) {
      clusterDesc = [...textCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      clusterCategory = classifyByNearbyText(clusterDesc);
    }

    // Compute confidence for the cluster:
    // - Cluster size (more = higher confidence, up to 0.4)
    // - Shape consistency: all same shape type (up to 0.3)
    // - Text association: has nearby text matching a known pattern (up to 0.3)
    const sizeConf = Math.min(items.length / 10, 1) * 0.4;
    const shapeParts = key.split('-');
    const shape = shapeParts[0];
    const shapeConf = (shape !== 'OTHER') ? 0.3 : 0.1;
    const textConf = clusterCategory ? 0.3 : (clusterDesc ? 0.15 : 0);
    const clusterConfidence = Math.min(sizeConf + shapeConf + textConf, 1);

    for (const sym of items) {
      symbols.push({
        ...sym,
        clusterId,
        category: sym.category || clusterCategory,
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

/** Classify symbol category based on nearby text label */
export function classifyByNearbyText(text: string): string | undefined {
  const t = text.toUpperCase();

  // Access Point / WiFi
  if (/\bAP\b/.test(t) || /ACCESS\s*POINT/i.test(t) || /WI-?FI/i.test(t)) return 'Teletechnika';

  // Lighting fixtures
  if (/\bOP\d*\b/.test(t) || /OPRAWA/i.test(t) || /LAMP/i.test(t) || /LED/i.test(t)) return 'Oprawy oświetleniowe';

  // Outlets
  if (/\bG\d*\b/.test(t) || /GNIAZD/i.test(t) || /GNIAZDKO/i.test(t)) return 'Osprzęt elektryczny';

  // Switches
  if (/\bW\d*\b/.test(t) || /WYL/i.test(t) || /LACZNIK/i.test(t) || /ŁĄCZNIK/i.test(t)) return 'Osprzęt elektryczny';

  // Sensors / detectors
  if (/\bCZ\d*\b/.test(t) || /CZUJ/i.test(t) || /DETECT/i.test(t) || /Ø\s*\d/.test(t)) return 'Instalacja alarmowa';

  // Distribution boards
  if (/\bTB\d*\b/.test(t) || /TABL/i.test(t) || /ROZDZ/i.test(t) || /RG\b/.test(t)) return 'Tablice i rozdzielnice';

  // Data / network
  if (/\bRJ\d+\b/.test(t) || /\bDATA\b/.test(t) || /\bLAN\b/.test(t) || /\bUTP\b/.test(t)) return 'Teletechnika';

  // Camera / CCTV
  if (/\bKAM\b/.test(t) || /CCTV/i.test(t) || /KAMERA/i.test(t)) return 'Instalacja alarmowa';

  return undefined;
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

/** Detect legend region and entries, matching nearby line samples to style groups */
export function detectLegend(
  paths: PdfPath[],
  texts: PdfExtractedText[],
  pageWidth: number,
  pageHeight: number,
  styleGroups?: PdfStyleGroup[],
): PdfLegend | null {
  // Look for large rectangles in corners (typically bottom-right)
  const candidateRects = paths.filter(p => {
    if (!p.isClosed) return false;
    const w = p.bbox.maxX - p.bbox.minX;
    const h = p.bbox.maxY - p.bbox.minY;
    // Legend is typically 15-40% of page width, 20-60% of page height
    return w > pageWidth * 0.1 && w < pageWidth * 0.5
      && h > pageHeight * 0.1 && h < pageHeight * 0.7;
  });

  if (candidateRects.length === 0) return null;

  // Score rectangles by text density inside
  let bestRect: PdfPath | null = null;
  let bestScore = 0;

  for (const rect of candidateRects) {
    const textsInside = texts.filter(t =>
      t.x >= rect.bbox.minX && t.x <= rect.bbox.maxX &&
      t.y >= rect.bbox.minY && t.y <= rect.bbox.maxY
    );
    const score = textsInside.length;
    if (score > bestScore) {
      bestScore = score;
      bestRect = rect;
    }
  }

  if (!bestRect || bestScore < 3) return null;

  // Get all paths inside the legend bounding box (for style sample matching)
  const legendPaths = paths.filter(p =>
    p.bbox.minX >= bestRect!.bbox.minX && p.bbox.maxX <= bestRect!.bbox.maxX &&
    p.bbox.minY >= bestRect!.bbox.minY && p.bbox.maxY <= bestRect!.bbox.maxY
  );

  // Extract entries from texts inside the legend
  const legendTexts = texts.filter(t =>
    t.x >= bestRect!.bbox.minX && t.x <= bestRect!.bbox.maxX &&
    t.y >= bestRect!.bbox.minY && t.y <= bestRect!.bbox.maxY
  ).sort((a, b) => a.y - b.y);

  const entries: PdfLegendEntry[] = [];
  const rowTolerance = 8; // px tolerance for "same row"

  for (const t of legendTexts) {
    if (t.text.trim().length < 2) continue;

    const entry: PdfLegendEntry = {
      label: t.text.trim(),
      description: t.text.trim(),
    };

    // Find nearby line/path sample on the same row (to the left of text, typically)
    const nearbyLineSample = legendPaths.find(p => {
      const pCenterY = (p.bbox.minY + p.bbox.maxY) / 2;
      const tCenterY = t.y + (t.height || 0) / 2;
      const sameRow = Math.abs(pCenterY - tCenterY) < rowTolerance;
      const toTheLeft = p.bbox.maxX < t.x + 10;
      const isShortLine = (p.bbox.maxX - p.bbox.minX) > 10 && (p.bbox.maxY - p.bbox.minY) < 15;
      return sameRow && toTheLeft && isShortLine;
    });

    if (nearbyLineSample) {
      entry.sampleColor = nearbyLineSample.style.isStroked
        ? nearbyLineSample.style.strokeColor
        : nearbyLineSample.style.fillColor;
      entry.sampleLineWidth = nearbyLineSample.style.lineWidth;

      // Match to a style group if available
      if (styleGroups) {
        const matchedGroup = styleGroups.find(sg =>
          sg.strokeColor === entry.sampleColor &&
          Math.abs(sg.lineWidth - (entry.sampleLineWidth || 0)) < 0.5
        );
        if (matchedGroup) {
          entry.styleKey = matchedGroup.styleKey;
        }
      }
    }

    entries.push(entry);
  }

  return {
    boundingBox: {
      x: bestRect.bbox.minX,
      y: bestRect.bbox.minY,
      width: bestRect.bbox.maxX - bestRect.bbox.minX,
      height: bestRect.bbox.maxY - bestRect.bbox.minY,
    },
    entries,
  };
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

    // Find room name from text inside the bounding box
    const name = findRoomName(p.bbox, texts);

    rooms.push({
      id: `room_${rooms.length + 1}`,
      name: name || `Pomieszczenie ${rooms.length + 1}`,
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

/** Find room name from text items inside or near a bounding box */
function findRoomName(
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
  texts: PdfExtractedText[],
): string | null {
  const cx = (bbox.minX + bbox.maxX) / 2;
  const cy = (bbox.minY + bbox.maxY) / 2;
  const margin = 10;

  // Texts inside the room
  const insideTexts = texts.filter(t =>
    t.x >= bbox.minX - margin && t.x <= bbox.maxX + margin &&
    t.y >= bbox.minY - margin && t.y <= bbox.maxY + margin
  );

  // Prefer text matching room name patterns
  for (const t of insideTexts) {
    for (const pattern of ROOM_PATTERNS) {
      if (pattern.test(t.text)) return t.text.trim();
    }
  }

  // Fallback: largest font text inside the room (likely the room label)
  if (insideTexts.length > 0) {
    const sorted = [...insideTexts].sort((a, b) => b.fontSize - a.fontSize);
    const candidate = sorted[0];
    // Only use if it's a short label (not a long description)
    if (candidate.text.trim().length <= 30 && candidate.text.trim().length >= 2) {
      return candidate.text.trim();
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

/** Main analysis pipeline: extraction → style groups → routes → symbols → scale → DxfAnalysis */
export function analyzePdfPage(
  extraction: PdfPageExtraction,
  options: PdfAnalyzeOptions = {},
): { analysis: DxfAnalysis; extra: PdfAnalysisExtra } {
  const { calibrationScaleRatio, maxSymbolSize = 30, routeTolerance = 3 } = options;

  // 1. Style grouping
  const styleGroups = groupPathsByStyle(extraction.paths);

  // 2. Scale detection
  const scaleInfo = detectScale(extraction.texts, calibrationScaleRatio);

  // 3. Apply scale to style groups
  for (const sg of styleGroups) {
    sg.totalLengthM = sg.totalLengthPx * scaleInfo.scaleFactor;
  }

  // 4. Route detection (per style group)
  const allRoutes: LineGroup[] = [];
  for (const sg of styleGroups) {
    if (sg.pathCount < 2) continue;
    const routes = findConnectedRoutes(extraction.paths, sg.pathIndices, sg.id, routeTolerance);
    // Convert lengths from px to meters
    for (const r of routes) {
      r.totalLengthM = r.totalLengthM * scaleInfo.scaleFactor;
    }
    allRoutes.push(...routes);
  }

  // 5. Symbol detection (with text proximity)
  const symbols = detectSymbols(extraction.paths, styleGroups, extraction.texts, maxSymbolSize);

  // 6. Legend extraction (with style group matching)
  const legend = detectLegend(extraction.paths, extraction.texts, extraction.pageWidth, extraction.pageHeight, styleGroups);

  // 7. Apply legend if found
  if (legend) {
    applyLegendToGroups(legend, styleGroups);
  }

  // 8. Room/zone detection
  const rooms = detectRooms(extraction.paths, extraction.texts, extraction.pageWidth, extraction.pageHeight);
  assignToRooms(rooms, symbols, allRoutes);

  // 9. Convert to DxfAnalysis format
  const analysis = toDxfAnalysis(extraction, styleGroups, symbols, allRoutes, scaleInfo);

  return {
    analysis,
    extra: { styleGroups, symbols, rooms, legend, scaleInfo, extraction },
  };
}

/** Apply legend entries to style groups — match by style key (best), color sample, or text mention */
function applyLegendToGroups(legend: PdfLegend, groups: PdfStyleGroup[]) {
  for (const entry of legend.entries) {
    // Priority 1: direct styleKey match from line sample detection
    if (entry.styleKey) {
      const matchedGroup = groups.find(g => g.styleKey === entry.styleKey);
      if (matchedGroup) {
        matchedGroup.category = entry.label;
        entry.category = entry.label;
        continue;
      }
    }

    // Priority 2: match by sample color + lineWidth
    if (entry.sampleColor) {
      const matchedGroup = groups.find(g =>
        g.strokeColor === entry.sampleColor &&
        Math.abs(g.lineWidth - (entry.sampleLineWidth || 0)) < 0.5
      );
      if (matchedGroup) {
        matchedGroup.category = entry.label;
        entry.category = entry.label;
        entry.styleKey = matchedGroup.styleKey;
        continue;
      }
    }

    // Priority 3: text-based fallback — match by color name mention
    const text = entry.label.toLowerCase();
    for (const group of groups) {
      if (group.category) continue; // Already assigned
      const colorName = getColorName(group.strokeColor).toLowerCase();
      if (text.includes(colorName) || text.includes(group.strokeColor.toLowerCase())) {
        group.category = entry.label;
        entry.category = entry.label;
        entry.styleKey = group.styleKey;
        entry.sampleColor = group.strokeColor;
        entry.sampleLineWidth = group.lineWidth;
        break;
      }
    }
  }
}

/** Convert PDF analysis results to DxfAnalysis-compatible format */
function toDxfAnalysis(
  extraction: PdfPageExtraction,
  styleGroups: PdfStyleGroup[],
  symbols: PdfDetectedSymbol[],
  routes: LineGroup[],
  scaleInfo: PdfScaleInfo,
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

  // Blocks = symbol clusters
  const blocks: AnalyzedBlock[] = [];
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
