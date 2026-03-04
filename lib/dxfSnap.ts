/**
 * DXF SNAP system — endpoint, midpoint, center, nearest, intersection snap types
 */
import type { IDxf } from 'dxf-parser';
import type { IEntity, IPoint } from 'dxf-parser/dist/entities/geomtry';

export type SnapType = 'endpoint' | 'midpoint' | 'center' | 'nearest' | 'intersection';

export interface SnapPoint {
  x: number;
  y: number;
  type: SnapType;
  entityIndex?: number;
}

// Priority: endpoint > midpoint > center > intersection > nearest
const SNAP_PRIORITY: Record<SnapType, number> = {
  endpoint: 0,
  midpoint: 1,
  center: 2,
  intersection: 3,
  nearest: 4,
};

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
}

function isLayerVisible(entity: any, layers: any, hiddenLayers?: Set<string>): boolean {
  if (entity.visible === false) return false;
  if (hiddenLayers && entity.layer && hiddenLayers.has(entity.layer)) return false;
  if (!layers || !entity.layer) return true;
  const layer = layers[entity.layer];
  if (!layer) return true;
  return layer.visible !== false && layer.frozen !== true;
}

/** Extract snap points from a single entity */
function entitySnapPoints(e: any, entityIndex: number): SnapPoint[] {
  const snaps: SnapPoint[] = [];

  switch (e.type) {
    case 'LINE': {
      const v = e.vertices as IPoint[];
      if (!v || v.length < 2) break;
      // Endpoints
      snaps.push({ x: v[0].x, y: v[0].y, type: 'endpoint', entityIndex });
      snaps.push({ x: v[1].x, y: v[1].y, type: 'endpoint', entityIndex });
      // Midpoint
      snaps.push({ x: (v[0].x + v[1].x) / 2, y: (v[0].y + v[1].y) / 2, type: 'midpoint', entityIndex });
      break;
    }
    case 'CIRCLE': {
      const cx = e.center?.x ?? 0, cy = e.center?.y ?? 0, r = e.radius ?? 0;
      // Center
      snaps.push({ x: cx, y: cy, type: 'center', entityIndex });
      // Quadrant points (endpoints of circle)
      snaps.push({ x: cx + r, y: cy, type: 'endpoint', entityIndex });
      snaps.push({ x: cx - r, y: cy, type: 'endpoint', entityIndex });
      snaps.push({ x: cx, y: cy + r, type: 'endpoint', entityIndex });
      snaps.push({ x: cx, y: cy - r, type: 'endpoint', entityIndex });
      break;
    }
    case 'ARC': {
      const cx = e.center?.x ?? 0, cy = e.center?.y ?? 0, r = e.radius ?? 0;
      const sa = (e.startAngle || 0) * Math.PI / 180;
      const ea = (e.endAngle || 360) * Math.PI / 180;
      // Center
      snaps.push({ x: cx, y: cy, type: 'center', entityIndex });
      // Arc endpoints
      snaps.push({ x: cx + r * Math.cos(sa), y: cy + r * Math.sin(sa), type: 'endpoint', entityIndex });
      snaps.push({ x: cx + r * Math.cos(ea), y: cy + r * Math.sin(ea), type: 'endpoint', entityIndex });
      // Arc midpoint
      let midAngle = (sa + ea) / 2;
      if (ea < sa) midAngle += Math.PI;
      snaps.push({ x: cx + r * Math.cos(midAngle), y: cy + r * Math.sin(midAngle), type: 'midpoint', entityIndex });
      break;
    }
    case 'ELLIPSE': {
      const cx = e.center?.x ?? 0, cy = e.center?.y ?? 0;
      snaps.push({ x: cx, y: cy, type: 'center', entityIndex });
      if (e.majorAxisEndPoint) {
        snaps.push({ x: cx + e.majorAxisEndPoint.x, y: cy + e.majorAxisEndPoint.y, type: 'endpoint', entityIndex });
        snaps.push({ x: cx - e.majorAxisEndPoint.x, y: cy - e.majorAxisEndPoint.y, type: 'endpoint', entityIndex });
      }
      break;
    }
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      const verts = e.vertices as IPoint[];
      if (!verts || verts.length < 2) break;
      for (let i = 0; i < verts.length; i++) {
        snaps.push({ x: verts[i].x, y: verts[i].y, type: 'endpoint', entityIndex });
        if (i < verts.length - 1) {
          snaps.push({
            x: (verts[i].x + verts[i + 1].x) / 2,
            y: (verts[i].y + verts[i + 1].y) / 2,
            type: 'midpoint',
            entityIndex,
          });
        }
      }
      // Closing segment midpoint
      if (e.shape === true && verts.length >= 3) {
        const first = verts[0], last = verts[verts.length - 1];
        snaps.push({
          x: (first.x + last.x) / 2,
          y: (first.y + last.y) / 2,
          type: 'midpoint',
          entityIndex,
        });
      }
      break;
    }
    case 'INSERT': {
      const pos = e.position;
      if (pos) {
        snaps.push({ x: pos.x, y: pos.y, type: 'endpoint', entityIndex });
      }
      break;
    }
    case 'TEXT': {
      const sp = e.startPoint;
      if (sp) {
        snaps.push({ x: sp.x, y: sp.y, type: 'endpoint', entityIndex });
      }
      break;
    }
    case 'MTEXT': {
      const pos = e.position;
      if (pos) {
        snaps.push({ x: pos.x, y: pos.y, type: 'endpoint', entityIndex });
      }
      break;
    }
    case 'POINT': {
      const pos = e.position;
      if (pos) {
        snaps.push({ x: pos.x, y: pos.y, type: 'endpoint', entityIndex });
      }
      break;
    }
  }

  return snaps;
}

/** Nearest point on a line segment to a given point */
function nearestOnSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): { x: number; y: number } {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { x: x1, y: y1 };
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return { x: x1 + t * dx, y: y1 + t * dy };
}

/** Find nearest point on entity to cursor (for 'nearest' snap) */
function nearestPointOnEntity(e: any, px: number, py: number): { x: number; y: number } | null {
  switch (e.type) {
    case 'LINE': {
      const v = e.vertices as IPoint[];
      if (!v || v.length < 2) return null;
      return nearestOnSegment(px, py, v[0].x, v[0].y, v[1].x, v[1].y);
    }
    case 'CIRCLE': {
      const cx = e.center?.x ?? 0, cy = e.center?.y ?? 0, r = e.radius ?? 0;
      const d = dist(px, py, cx, cy);
      if (d === 0) return { x: cx + r, y: cy };
      return { x: cx + (px - cx) / d * r, y: cy + (py - cy) / d * r };
    }
    case 'ARC': {
      const cx = e.center?.x ?? 0, cy = e.center?.y ?? 0, r = e.radius ?? 0;
      const d = dist(px, py, cx, cy);
      if (d === 0) return { x: cx + r, y: cy };
      return { x: cx + (px - cx) / d * r, y: cy + (py - cy) / d * r };
    }
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      const verts = e.vertices as IPoint[];
      if (!verts || verts.length < 2) return null;
      let bestPt: { x: number; y: number } | null = null;
      let bestD = Infinity;
      const len = e.shape === true ? verts.length : verts.length - 1;
      for (let i = 0; i < len; i++) {
        const next = verts[(i + 1) % verts.length];
        const pt = nearestOnSegment(px, py, verts[i].x, verts[i].y, next.x, next.y);
        const d = dist(px, py, pt.x, pt.y);
        if (d < bestD) { bestD = d; bestPt = pt; }
      }
      return bestPt;
    }
    default:
      return null;
  }
}

/** Find all snap points near cursor position in DXF space */
export function findSnapPoints(
  dxf: IDxf,
  cursorDxf: { x: number; y: number },
  radius: number,
  hiddenLayers?: Set<string>,
  enabledTypes?: Set<SnapType>
): SnapPoint[] {
  const layers = dxf.tables?.layer?.layers;
  const snaps: SnapPoint[] = [];
  const entities = dxf.entities as any[];

  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (!isLayerVisible(e, layers, hiddenLayers)) continue;

    // Get defined snap points (endpoint, midpoint, center)
    const pts = entitySnapPoints(e, i);
    for (const pt of pts) {
      if (enabledTypes && !enabledTypes.has(pt.type)) continue;
      if (dist(cursorDxf.x, cursorDxf.y, pt.x, pt.y) <= radius) {
        snaps.push(pt);
      }
    }

    // Add nearest snap
    if (!enabledTypes || enabledTypes.has('nearest')) {
      const nearest = nearestPointOnEntity(e, cursorDxf.x, cursorDxf.y);
      if (nearest && dist(cursorDxf.x, cursorDxf.y, nearest.x, nearest.y) <= radius) {
        snaps.push({ x: nearest.x, y: nearest.y, type: 'nearest', entityIndex: i });
      }
    }
  }

  return snaps;
}

/** Get the best (highest priority) snap from a list */
export function getBestSnap(snaps: SnapPoint[]): SnapPoint | null {
  if (snaps.length === 0) return null;
  return snaps.reduce((best, snap) =>
    SNAP_PRIORITY[snap.type] < SNAP_PRIORITY[best.type] ? snap : best
  );
}

/** Find line-line intersection points within radius */
export function findIntersections(
  dxf: IDxf,
  cursorDxf: { x: number; y: number },
  radius: number,
  hiddenLayers?: Set<string>
): SnapPoint[] {
  const layers = dxf.tables?.layer?.layers;
  const lines: { x1: number; y1: number; x2: number; y2: number; idx: number }[] = [];
  const entities = dxf.entities as any[];

  // Collect line segments
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (!isLayerVisible(e, layers, hiddenLayers)) continue;
    if (e.type === 'LINE') {
      const v = e.vertices as IPoint[];
      if (v && v.length >= 2) {
        lines.push({ x1: v[0].x, y1: v[0].y, x2: v[1].x, y2: v[1].y, idx: i });
      }
    } else if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') {
      const verts = e.vertices as IPoint[];
      if (!verts) continue;
      const len = e.shape === true ? verts.length : verts.length - 1;
      for (let j = 0; j < len; j++) {
        const next = verts[(j + 1) % verts.length];
        lines.push({ x1: verts[j].x, y1: verts[j].y, x2: next.x, y2: next.y, idx: i });
      }
    }
  }

  const snaps: SnapPoint[] = [];

  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i], b = lines[j];
      const pt = segmentIntersection(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1, b.x2, b.y2);
      if (pt && dist(cursorDxf.x, cursorDxf.y, pt.x, pt.y) <= radius) {
        snaps.push({ x: pt.x, y: pt.y, type: 'intersection' });
      }
    }
  }

  return snaps;
}

function segmentIntersection(
  x1: number, y1: number, x2: number, y2: number,
  x3: number, y3: number, x4: number, y4: number
): { x: number; y: number } | null {
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
}

/** Get all snap points from an entity (for rendering snap markers on hover) */
export function getEntitySnapPoints(entity: any, entityIndex: number): SnapPoint[] {
  return entitySnapPoints(entity, entityIndex);
}
