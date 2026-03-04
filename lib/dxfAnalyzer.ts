/**
 * DXF Analyzer (Krok C) — Parse DXF → structured data model
 * Extracts layers, entities with geometry, blocks with counts
 * Groups connected LINEs into cable runs
 */
import type { IDxf } from 'dxf-parser';
import type { IPoint } from 'dxf-parser/dist/entities/geomtry';
import { getInsUnits, toMeters, type InsUnits } from './dxfUnits';

// ==================== DATA MODEL ====================

export interface AnalyzedLayer {
  name: string;
  color: string;
  entityCount: number;
  frozen: boolean;
  entityTypes: Record<string, number>;
}

export interface AnalyzedEntity {
  index: number;
  entityType: string;
  layerName: string;
  blockName?: string;
  geometry: EntityGeometry;
  lengthM: number;
  areaM2: number;
  properties: Record<string, any>;
  groupId?: string;
}

export interface EntityGeometry {
  type: 'point' | 'line' | 'polyline' | 'circle' | 'arc' | 'ellipse' | 'text' | 'insert' | 'other';
  points?: { x: number; y: number }[];
  center?: { x: number; y: number };
  radius?: number;
  text?: string;
  blockName?: string;
}

export interface AnalyzedBlock {
  name: string;
  insertCount: number;
  sampleLayer: string;
  entityCount: number;
  containedTypes: string[];
}

export interface LineGroup {
  id: string;
  entityIndices: number[];
  totalLengthM: number;
  layer: string;
  points: { x: number; y: number }[];
}

export interface DxfAnalysis {
  totalEntities: number;
  totalBlocks: number;
  totalLayers: number;
  unitSystem: string;
  insUnits: InsUnits;
  layers: AnalyzedLayer[];
  entities: AnalyzedEntity[];
  blocks: AnalyzedBlock[];
  lineGroups: LineGroup[];
}

// ==================== ANALYSIS ====================

function getLayerColor(layer: any): string {
  if (layer.color != null && layer.color !== 0) {
    return '#' + layer.color.toString(16).padStart(6, '0');
  }
  if (layer.colorIndex != null && layer.colorIndex > 0) {
    return '#808080'; // simplified
  }
  return '#808080';
}

function segmentLength(p1: { x: number; y: number }, p2: { x: number; y: number }): number {
  return Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
}

function extractGeometry(e: any): EntityGeometry {
  switch (e.type) {
    case 'LINE': {
      const v = e.vertices as IPoint[];
      if (!v || v.length < 2) return { type: 'line' };
      return { type: 'line', points: [{ x: v[0].x, y: v[0].y }, { x: v[1].x, y: v[1].y }] };
    }
    case 'CIRCLE':
      return { type: 'circle', center: e.center ? { x: e.center.x, y: e.center.y } : undefined, radius: e.radius };
    case 'ARC':
      return { type: 'arc', center: e.center ? { x: e.center.x, y: e.center.y } : undefined, radius: e.radius };
    case 'ELLIPSE':
      return { type: 'ellipse', center: e.center ? { x: e.center.x, y: e.center.y } : undefined };
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      const verts = (e.vertices || []) as IPoint[];
      return { type: 'polyline', points: verts.map(v => ({ x: v.x, y: v.y })) };
    }
    case 'TEXT':
      return { type: 'text', text: e.text, points: e.startPoint ? [{ x: e.startPoint.x, y: e.startPoint.y }] : undefined };
    case 'MTEXT': {
      const raw = e.text || '';
      const clean = raw.replace(/\\[A-Za-z][^;]*;/g, '').replace(/\{|\}/g, '').replace(/\\P/g, '\n');
      return { type: 'text', text: clean, points: e.position ? [{ x: e.position.x, y: e.position.y }] : undefined };
    }
    case 'INSERT':
      return { type: 'insert', blockName: e.name, points: e.position ? [{ x: e.position.x, y: e.position.y }] : undefined };
    default:
      return { type: 'other' };
  }
}

function calcLength(e: any, insUnits: InsUnits): number {
  switch (e.type) {
    case 'LINE': {
      const v = e.vertices as IPoint[];
      if (!v || v.length < 2) return 0;
      return toMeters(segmentLength(v[0], v[1]), insUnits);
    }
    case 'CIRCLE':
      return toMeters(2 * Math.PI * (e.radius || 0), insUnits);
    case 'ARC': {
      let sweep = (e.endAngle || 0) - (e.startAngle || 0);
      if (sweep < 0) sweep += 360;
      return toMeters((e.radius || 0) * sweep * Math.PI / 180, insUnits);
    }
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      const verts = (e.vertices || []) as IPoint[];
      if (verts.length < 2) return 0;
      let total = 0;
      for (let i = 0; i < verts.length - 1; i++) {
        total += segmentLength(verts[i], verts[i + 1]);
      }
      if (e.shape === true && verts.length >= 3) {
        total += segmentLength(verts[verts.length - 1], verts[0]);
      }
      return toMeters(total, insUnits);
    }
    default:
      return 0;
  }
}

function calcArea(e: any, insUnits: InsUnits): number {
  switch (e.type) {
    case 'CIRCLE':
      return toMeters(e.radius || 0, insUnits) ** 2 * Math.PI;
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      if (e.shape !== true) return 0;
      const verts = (e.vertices || []) as IPoint[];
      if (verts.length < 3) return 0;
      let area = 0;
      for (let i = 0; i < verts.length; i++) {
        const j = (i + 1) % verts.length;
        area += verts[i].x * verts[j].y - verts[j].x * verts[i].y;
      }
      const factor = toMeters(1, insUnits);
      return Math.abs(area) / 2 * factor * factor;
    }
    default:
      return 0;
  }
}

/** Main analysis function */
export function analyzeDxf(dxf: IDxf): DxfAnalysis {
  const insUnits = getInsUnits(dxf);
  const layers = dxf.tables?.layer?.layers;
  const blocks = dxf.blocks;

  // Analyze layers
  const layerCounts: Record<string, { count: number; types: Record<string, number> }> = {};
  for (const e of dxf.entities as any[]) {
    const ln = e.layer || '0';
    if (!layerCounts[ln]) layerCounts[ln] = { count: 0, types: {} };
    layerCounts[ln].count++;
    layerCounts[ln].types[e.type] = (layerCounts[ln].types[e.type] || 0) + 1;
  }

  const analyzedLayers: AnalyzedLayer[] = [];
  if (layers) {
    for (const layer of Object.values(layers)) {
      const info = layerCounts[layer.name] || { count: 0, types: {} };
      analyzedLayers.push({
        name: layer.name,
        color: getLayerColor(layer),
        entityCount: info.count,
        frozen: layer.frozen === true,
        entityTypes: info.types,
      });
    }
  }
  analyzedLayers.sort((a, b) => b.entityCount - a.entityCount);

  // Analyze entities
  const analyzedEntities: AnalyzedEntity[] = [];
  const entities = dxf.entities as any[];
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    analyzedEntities.push({
      index: i,
      entityType: e.type,
      layerName: e.layer || '0',
      blockName: e.type === 'INSERT' ? e.name : undefined,
      geometry: extractGeometry(e),
      lengthM: calcLength(e, insUnits),
      areaM2: calcArea(e, insUnits),
      properties: { handle: e.handle },
    });
  }

  // Analyze blocks
  const blockInsertCounts: Record<string, { count: number; sampleLayer: string }> = {};
  for (const e of entities) {
    if (e.type === 'INSERT' && e.name) {
      if (!blockInsertCounts[e.name]) {
        blockInsertCounts[e.name] = { count: 0, sampleLayer: e.layer || '0' };
      }
      blockInsertCounts[e.name].count++;
    }
  }

  const analyzedBlocks: AnalyzedBlock[] = [];
  if (blocks) {
    for (const [name, block] of Object.entries(blocks)) {
      if (name.startsWith('*')) continue; // skip internal blocks
      const insertInfo = blockInsertCounts[name];
      const blockEntities = block.entities || [];
      const containedTypes = [...new Set(blockEntities.map((be: any) => be.type))];
      analyzedBlocks.push({
        name,
        insertCount: insertInfo?.count || 0,
        sampleLayer: insertInfo?.sampleLayer || '0',
        entityCount: blockEntities.length,
        containedTypes,
      });
    }
  }
  analyzedBlocks.sort((a, b) => b.insertCount - a.insertCount);

  // Group connected lines
  const lineGroups = groupConnectedLines(entities, insUnits);

  // Unit system name
  const unitNames: Record<number, string> = { 0: 'unitless', 1: 'in', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm', 7: 'km' };

  return {
    totalEntities: entities.length,
    totalBlocks: analyzedBlocks.length,
    totalLayers: analyzedLayers.length,
    unitSystem: unitNames[insUnits] || 'mm',
    insUnits,
    layers: analyzedLayers,
    entities: analyzedEntities,
    blocks: analyzedBlocks,
    lineGroups,
  };
}

// ==================== CONNECTED LINE GROUPING ====================

/** Group connected LINE entities into components (cable runs etc.) */
export function groupConnectedLines(
  entities: any[],
  insUnits: InsUnits,
  tolerance: number = 0.5
): LineGroup[] {
  // Collect only LINE entities with their endpoints
  interface LineInfo {
    entityIndex: number;
    p1: { x: number; y: number };
    p2: { x: number; y: number };
    layer: string;
    length: number;
  }

  const lines: LineInfo[] = [];
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (e.type !== 'LINE') continue;
    const v = e.vertices as IPoint[];
    if (!v || v.length < 2) continue;
    lines.push({
      entityIndex: i,
      p1: { x: v[0].x, y: v[0].y },
      p2: { x: v[1].x, y: v[1].y },
      layer: e.layer || '0',
      length: segmentLength(v[0], v[1]),
    });
  }

  if (lines.length === 0) return [];

  // Group by layer for performance
  const byLayer: Record<string, LineInfo[]> = {};
  for (const line of lines) {
    if (!byLayer[line.layer]) byLayer[line.layer] = [];
    byLayer[line.layer].push(line);
  }

  const groups: LineGroup[] = [];
  let groupCounter = 0;

  for (const [layer, layerLines] of Object.entries(byLayer)) {
    // Build adjacency: two lines are connected if an endpoint of one is within tolerance of an endpoint of another
    const n = layerLines.length;
    const visited = new Array(n).fill(false);

    function pointsClose(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
      return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;
    }

    function areConnected(a: LineInfo, b: LineInfo): boolean {
      return pointsClose(a.p1, b.p1) || pointsClose(a.p1, b.p2) ||
             pointsClose(a.p2, b.p1) || pointsClose(a.p2, b.p2);
    }

    // DFS to find connected components
    for (let start = 0; start < n; start++) {
      if (visited[start]) continue;
      const component: number[] = [];
      const stack = [start];
      while (stack.length > 0) {
        const idx = stack.pop()!;
        if (visited[idx]) continue;
        visited[idx] = true;
        component.push(idx);
        // Find neighbors
        for (let j = 0; j < n; j++) {
          if (!visited[j] && areConnected(layerLines[idx], layerLines[j])) {
            stack.push(j);
          }
        }
      }

      if (component.length < 2) continue; // skip isolated lines

      const groupLines = component.map(i => layerLines[i]);
      const totalLength = groupLines.reduce((sum, l) => sum + l.length, 0);

      // Collect all unique points
      const pointSet = new Map<string, { x: number; y: number }>();
      for (const l of groupLines) {
        const k1 = `${Math.round(l.p1.x / tolerance) * tolerance},${Math.round(l.p1.y / tolerance) * tolerance}`;
        const k2 = `${Math.round(l.p2.x / tolerance) * tolerance},${Math.round(l.p2.y / tolerance) * tolerance}`;
        if (!pointSet.has(k1)) pointSet.set(k1, l.p1);
        if (!pointSet.has(k2)) pointSet.set(k2, l.p2);
      }

      groups.push({
        id: `group_${++groupCounter}`,
        entityIndices: groupLines.map(l => l.entityIndex),
        totalLengthM: toMeters(totalLength, insUnits),
        layer,
        points: [...pointSet.values()],
      });
    }
  }

  return groups.sort((a, b) => b.totalLengthM - a.totalLengthM);
}
