/**
 * DXF Search — find TEXT/MTEXT entities by content, filter entities by type/layer/block
 */
import type { IDxf } from 'dxf-parser';
import type { IEntity } from 'dxf-parser/dist/entities/geomtry';

export interface DxfSearchResult {
  entity: any;
  entityIndex: number;
  matchedText: string;
  layer: string;
  position: { x: number; y: number };
}

export interface DxfEntityFilter {
  type?: string | string[];
  layer?: string | string[];
  blockName?: string | string[];
}

function getTextContent(e: any): string | null {
  if (e.type === 'TEXT') {
    return e.text || null;
  }
  if (e.type === 'MTEXT') {
    const raw = e.text || '';
    // Strip MTEXT formatting codes
    return raw.replace(/\\[A-Za-z][^;]*;/g, '').replace(/\{|\}/g, '').replace(/\\P/g, '\n');
  }
  return null;
}

function getEntityPosition(e: any): { x: number; y: number } {
  if (e.type === 'TEXT' && e.startPoint) return { x: e.startPoint.x, y: e.startPoint.y };
  if (e.type === 'MTEXT' && e.position) return { x: e.position.x, y: e.position.y };
  if (e.type === 'INSERT' && e.position) return { x: e.position.x, y: e.position.y };
  if (e.position) return { x: e.position.x, y: e.position.y };
  if (e.center) return { x: e.center.x, y: e.center.y };
  if (e.vertices && e.vertices.length > 0) return { x: e.vertices[0].x, y: e.vertices[0].y };
  return { x: 0, y: 0 };
}

/** Search TEXT/MTEXT entities by content. Also searches INSERT block names. */
export function searchDxfText(
  dxf: IDxf,
  query: string,
  options?: { caseSensitive?: boolean; wholeWord?: boolean; includeBlocks?: boolean; hiddenLayers?: Set<string> }
): DxfSearchResult[] {
  if (!query.trim()) return [];

  const caseSensitive = options?.caseSensitive ?? false;
  const wholeWord = options?.wholeWord ?? false;
  const includeBlocks = options?.includeBlocks ?? true;
  const hiddenLayers = options?.hiddenLayers;
  const layers = dxf.tables?.layer?.layers;
  const results: DxfSearchResult[] = [];

  const normalizedQuery = caseSensitive ? query : query.toLowerCase();

  function matches(text: string): boolean {
    const normalized = caseSensitive ? text : text.toLowerCase();
    if (wholeWord) {
      const regex = new RegExp(`\\b${escapeRegex(normalizedQuery)}\\b`, caseSensitive ? '' : 'i');
      return regex.test(text);
    }
    return normalized.includes(normalizedQuery);
  }

  const entities = dxf.entities as any[];
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];

    // Skip hidden layers
    if (hiddenLayers && e.layer && hiddenLayers.has(e.layer)) continue;
    if (layers && e.layer) {
      const layer = layers[e.layer];
      if (layer && (layer.visible === false || layer.frozen === true)) continue;
    }

    // Search text content
    const textContent = getTextContent(e);
    if (textContent && matches(textContent)) {
      results.push({
        entity: e,
        entityIndex: i,
        matchedText: textContent,
        layer: e.layer || '0',
        position: getEntityPosition(e),
      });
      continue;
    }

    // Search INSERT block names
    if (includeBlocks && e.type === 'INSERT' && e.name && matches(e.name)) {
      results.push({
        entity: e,
        entityIndex: i,
        matchedText: e.name,
        layer: e.layer || '0',
        position: getEntityPosition(e),
      });
    }
  }

  return results;
}

/** Filter entities by type, layer, and/or block name */
export function searchDxfEntities(
  dxf: IDxf,
  filter: DxfEntityFilter,
  hiddenLayers?: Set<string>
): { entity: any; entityIndex: number }[] {
  const layers = dxf.tables?.layer?.layers;
  const results: { entity: any; entityIndex: number }[] = [];

  const typeSet = filter.type
    ? new Set(Array.isArray(filter.type) ? filter.type : [filter.type])
    : null;
  const layerSet = filter.layer
    ? new Set(Array.isArray(filter.layer) ? filter.layer : [filter.layer])
    : null;
  const blockSet = filter.blockName
    ? new Set(Array.isArray(filter.blockName) ? filter.blockName : [filter.blockName])
    : null;

  const entities = dxf.entities as any[];
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];

    if (hiddenLayers && e.layer && hiddenLayers.has(e.layer)) continue;
    if (layers && e.layer) {
      const layer = layers[e.layer];
      if (layer && (layer.visible === false || layer.frozen === true)) continue;
    }

    if (typeSet && !typeSet.has(e.type)) continue;
    if (layerSet && !layerSet.has(e.layer || '0')) continue;
    if (blockSet && (e.type !== 'INSERT' || !blockSet.has(e.name))) continue;

    results.push({ entity: e, entityIndex: i });
  }

  return results;
}

/** Count entities by type */
export function countEntitiesByType(dxf: IDxf): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of dxf.entities) {
    const type = (e as any).type || 'UNKNOWN';
    counts[type] = (counts[type] || 0) + 1;
  }
  return counts;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
