import DxfParser, { IDxf, IBlock, ILayer } from 'dxf-parser';
import { IEntity, IPoint } from 'dxf-parser/dist/entities/geomtry';

// Re-export IDxf for consumers
export type { IDxf };

// AutoCAD Color Index (ACI) — standard colors
export const ACI_COLORS: Record<number, string> = {
  0: '#000000', // BYBLOCK
  1: '#FF0000', 2: '#FFFF00', 3: '#00FF00', 4: '#00FFFF',
  5: '#0000FF', 6: '#FF00FF', 7: '#FFFFFF', 8: '#808080', 9: '#C0C0C0',
  10: '#FF0000', 11: '#FF7F7F', 12: '#CC0000', 13: '#CC6666', 14: '#990000',
  15: '#996666', 20: '#FF3F00', 21: '#FF9F7F', 22: '#CC3200', 23: '#CC7F66',
  30: '#FF7F00', 31: '#FFBF7F', 32: '#CC6500', 33: '#CC9966',
  40: '#FFBF00', 41: '#FFDF7F', 42: '#CC9900', 43: '#CCB266',
  50: '#FFFF00', 51: '#FFFF7F', 52: '#CCCC00', 53: '#CCCC66',
  60: '#BFFF00', 61: '#DFFF7F', 62: '#99CC00', 63: '#B2CC66',
  70: '#7FFF00', 71: '#BFFF7F', 72: '#66CC00', 73: '#99CC66',
  80: '#3FFF00', 81: '#9FFF7F', 82: '#33CC00', 83: '#7FCC66',
  90: '#00FF00', 91: '#7FFF7F', 92: '#00CC00', 93: '#66CC66',
  100: '#00FF3F', 101: '#7FFF9F', 102: '#00CC33', 103: '#66CC7F',
  110: '#00FF7F', 111: '#7FFFBF', 112: '#00CC66', 113: '#66CC99',
  120: '#00FFBF', 121: '#7FFFDF', 122: '#00CC99', 123: '#66CCB2',
  130: '#00FFFF', 131: '#7FFFFF', 132: '#00CCCC', 133: '#66CCCC',
  140: '#00BFFF', 141: '#7FDFFF', 142: '#0099CC', 143: '#66B2CC',
  150: '#007FFF', 151: '#7FBFFF', 152: '#0066CC', 153: '#6699CC',
  160: '#003FFF', 161: '#7F9FFF', 162: '#0033CC', 163: '#667FCC',
  170: '#0000FF', 171: '#7F7FFF', 172: '#0000CC', 173: '#6666CC',
  180: '#3F00FF', 181: '#9F7FFF', 182: '#3200CC', 183: '#7F66CC',
  190: '#7F00FF', 191: '#BF7FFF', 192: '#6600CC', 193: '#9966CC',
  200: '#BF00FF', 201: '#DF7FFF', 202: '#9900CC', 203: '#B266CC',
  210: '#FF00FF', 211: '#FF7FFF', 212: '#CC00CC', 213: '#CC66CC',
  220: '#FF00BF', 221: '#FF7FDF', 222: '#CC0099', 223: '#CC66B2',
  230: '#FF007F', 231: '#FF7FBF', 232: '#CC0066', 233: '#CC6699',
  240: '#FF003F', 241: '#FF7F9F', 242: '#CC0033', 243: '#CC667F',
  250: '#333333', 251: '#505050', 252: '#696969', 253: '#808080',
  254: '#BFBFBF', 255: '#FFFFFF',
};

function getColor(entity: IEntity, layers: Record<string, ILayer> | undefined): string {
  if (entity.color != null && entity.color !== 0 && entity.color !== 256) {
    return '#' + entity.color.toString(16).padStart(6, '0');
  }
  if (entity.colorIndex != null && entity.colorIndex > 0 && entity.colorIndex < 256) {
    return ACI_COLORS[entity.colorIndex] || '#000000';
  }
  if (layers && entity.layer) {
    const layer = layers[entity.layer];
    if (layer) {
      if (layer.color != null && layer.color !== 0) {
        return '#' + layer.color.toString(16).padStart(6, '0');
      }
      if (layer.colorIndex != null && layer.colorIndex > 0) {
        return ACI_COLORS[layer.colorIndex] || '#000000';
      }
    }
  }
  return '#000000';
}

function getLayerColor(layer: ILayer): string {
  if (layer.color != null && layer.color !== 0) {
    return '#' + layer.color.toString(16).padStart(6, '0');
  }
  if (layer.colorIndex != null && layer.colorIndex > 0) {
    return ACI_COLORS[layer.colorIndex] || '#808080';
  }
  return '#808080';
}

function isLayerVisible(entity: IEntity, layers: Record<string, ILayer> | undefined, hiddenLayers?: Set<string>): boolean {
  if (entity.visible === false) return false;
  if (hiddenLayers && entity.layer && hiddenLayers.has(entity.layer)) return false;
  if (!layers || !entity.layer) return true;
  const layer = layers[entity.layer];
  if (!layer) return true;
  return layer.visible !== false && layer.frozen !== true;
}

interface BBox {
  minX: number; minY: number; maxX: number; maxY: number;
}

function expandBBox(bb: BBox, x: number, y: number) {
  if (x < bb.minX) bb.minX = x;
  if (x > bb.maxX) bb.maxX = x;
  if (y < bb.minY) bb.minY = y;
  if (y > bb.maxY) bb.maxY = y;
}

function deg2rad(deg: number): number { return deg * Math.PI / 180; }

function renderEntity(
  e: any,
  layers: Record<string, ILayer> | undefined,
  blocks: Record<string, IBlock> | undefined,
  bb: BBox,
  depth: number = 0,
  hiddenLayers?: Set<string>
): string {
  if (depth > 10) return '';
  if (!isLayerVisible(e, layers, hiddenLayers)) return '';

  const color = getColor(e, layers);
  const lw = Math.max(e.lineweight > 0 ? e.lineweight / 100 : 0.5, 0.25);
  const stroke = `stroke="${color}" stroke-width="${lw}" fill="none"`;

  switch (e.type) {
    case 'LINE': {
      const v = e.vertices as IPoint[];
      if (!v || v.length < 2) return '';
      expandBBox(bb, v[0].x, v[0].y);
      expandBBox(bb, v[1].x, v[1].y);
      return `<line x1="${v[0].x}" y1="${v[0].y}" x2="${v[1].x}" y2="${v[1].y}" ${stroke}/>`;
    }

    case 'CIRCLE': {
      const cx = e.center.x, cy = e.center.y, r = e.radius;
      expandBBox(bb, cx - r, cy - r);
      expandBBox(bb, cx + r, cy + r);
      return `<circle cx="${cx}" cy="${cy}" r="${r}" ${stroke}/>`;
    }

    case 'ARC': {
      const cx = e.center.x, cy = e.center.y, r = e.radius;
      const sa = deg2rad(e.startAngle || 0);
      const ea = deg2rad(e.endAngle || 360);
      const x1 = cx + r * Math.cos(sa), y1 = cy + r * Math.sin(sa);
      const x2 = cx + r * Math.cos(ea), y2 = cy + r * Math.sin(ea);
      expandBBox(bb, cx - r, cy - r);
      expandBBox(bb, cx + r, cy + r);
      let sweep = ea - sa;
      if (sweep < 0) sweep += 2 * Math.PI;
      const largeArc = sweep > Math.PI ? 1 : 0;
      return `<path d="M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}" ${stroke}/>`;
    }

    case 'ELLIPSE': {
      const cx = e.center.x, cy = e.center.y;
      const mx = e.majorAxisEndPoint.x, my = e.majorAxisEndPoint.y;
      const ratio = e.axisRatio || 1;
      const majorR = Math.sqrt(mx * mx + my * my);
      const minorR = majorR * ratio;
      const rotation = Math.atan2(my, mx) * 180 / Math.PI;
      expandBBox(bb, cx - majorR, cy - majorR);
      expandBBox(bb, cx + majorR, cy + majorR);
      const sa = e.startAngle || 0;
      const ea = e.endAngle || 2 * Math.PI;
      if (Math.abs(ea - sa - 2 * Math.PI) < 0.01 || (sa === 0 && ea === 0)) {
        return `<ellipse cx="${cx}" cy="${cy}" rx="${majorR}" ry="${minorR}" transform="rotate(${rotation} ${cx} ${cy})" ${stroke}/>`;
      }
      const x1 = cx + majorR * Math.cos(sa) * Math.cos(deg2rad(rotation)) - minorR * Math.sin(sa) * Math.sin(deg2rad(rotation));
      const y1 = cy + majorR * Math.cos(sa) * Math.sin(deg2rad(rotation)) + minorR * Math.sin(sa) * Math.cos(deg2rad(rotation));
      const x2 = cx + majorR * Math.cos(ea) * Math.cos(deg2rad(rotation)) - minorR * Math.sin(ea) * Math.sin(deg2rad(rotation));
      const y2 = cy + majorR * Math.cos(ea) * Math.sin(deg2rad(rotation)) + minorR * Math.sin(ea) * Math.cos(deg2rad(rotation));
      let sweep = ea - sa;
      if (sweep < 0) sweep += 2 * Math.PI;
      const largeArc = sweep > Math.PI ? 1 : 0;
      return `<path d="M ${x1} ${y1} A ${majorR} ${minorR} ${rotation} ${largeArc} 1 ${x2} ${y2}" ${stroke}/>`;
    }

    case 'LWPOLYLINE':
    case 'POLYLINE': {
      const vertices: IPoint[] = e.vertices;
      if (!vertices || vertices.length < 2) return '';
      const closed = e.shape === true;
      const hasBulge = vertices.some((v: any) => v.bulge && v.bulge !== 0);
      if (!hasBulge) {
        const pts = vertices.map((v: IPoint) => {
          expandBBox(bb, v.x, v.y);
          return `${v.x},${v.y}`;
        }).join(' ');
        if (closed) return `<polygon points="${pts}" ${stroke}/>`;
        return `<polyline points="${pts}" ${stroke}/>`;
      }
      let d = `M ${vertices[0].x} ${vertices[0].y}`;
      expandBBox(bb, vertices[0].x, vertices[0].y);
      const len = closed ? vertices.length : vertices.length - 1;
      for (let i = 0; i < len; i++) {
        const curr = vertices[i];
        const next = vertices[(i + 1) % vertices.length];
        expandBBox(bb, next.x, next.y);
        const bulge = (curr as any).bulge || 0;
        if (bulge === 0) {
          d += ` L ${next.x} ${next.y}`;
        } else {
          const dx = next.x - curr.x, dy = next.y - curr.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const sagitta = Math.abs(bulge) * dist / 2;
          const r = (dist * dist / 4 + sagitta * sagitta) / (2 * sagitta);
          const largeArc = Math.abs(bulge) > 1 ? 1 : 0;
          const sweepFlag = bulge > 0 ? 0 : 1;
          d += ` A ${r} ${r} 0 ${largeArc} ${sweepFlag} ${next.x} ${next.y}`;
        }
      }
      if (closed) d += ' Z';
      return `<path d="${d}" ${stroke}/>`;
    }

    case 'SPLINE': {
      const cps: IPoint[] = e.controlPoints || e.fitPoints || [];
      if (cps.length < 2) return '';
      cps.forEach((p: IPoint) => expandBBox(bb, p.x, p.y));
      if (cps.length === 2) {
        return `<line x1="${cps[0].x}" y1="${cps[0].y}" x2="${cps[1].x}" y2="${cps[1].y}" ${stroke}/>`;
      }
      let d = `M ${cps[0].x} ${cps[0].y}`;
      if (cps.length === 3) {
        d += ` Q ${cps[1].x} ${cps[1].y} ${cps[2].x} ${cps[2].y}`;
      } else {
        for (let i = 0; i < cps.length - 1; i++) {
          const p0 = cps[Math.max(i - 1, 0)];
          const p1 = cps[i];
          const p2 = cps[i + 1];
          const p3 = cps[Math.min(i + 2, cps.length - 1)];
          const cp1x = p1.x + (p2.x - p0.x) / 6;
          const cp1y = p1.y + (p2.y - p0.y) / 6;
          const cp2x = p2.x - (p3.x - p1.x) / 6;
          const cp2y = p2.y - (p3.y - p1.y) / 6;
          d += ` C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2.x} ${p2.y}`;
        }
      }
      if (e.closed) d += ' Z';
      return `<path d="${d}" ${stroke}/>`;
    }

    case 'TEXT': {
      const x = e.startPoint?.x ?? 0, y = e.startPoint?.y ?? 0;
      const h = e.textHeight || 10;
      const text = e.text || '';
      const rot = e.rotation || 0;
      expandBBox(bb, x, y);
      expandBBox(bb, x + text.length * h * 0.6, y + h);
      const anchor = e.halign === 1 ? 'middle' : e.halign === 2 ? 'end' : 'start';
      return `<text x="${x}" y="${y}" font-size="${h}" fill="${color}" font-family="sans-serif" text-anchor="${anchor}"${rot ? ` transform="rotate(${-rot} ${x} ${y})"` : ''}>${escapeXml(text)}</text>`;
    }

    case 'MTEXT': {
      const x = e.position?.x ?? 0, y = e.position?.y ?? 0;
      const h = e.height || 10;
      const text = (e.text || '').replace(/\\[A-Za-z][^;]*;/g, '').replace(/\{|\}/g, '').replace(/\\P/g, '\n');
      const rot = e.rotation || 0;
      expandBBox(bb, x, y);
      expandBBox(bb, x + text.length * h * 0.6, y + h);
      const lines = text.split('\n');
      if (lines.length === 1) {
        return `<text x="${x}" y="${y}" font-size="${h}" fill="${color}" font-family="sans-serif"${rot ? ` transform="rotate(${-rot} ${x} ${y})"` : ''}>${escapeXml(text)}</text>`;
      }
      return `<text x="${x}" y="${y}" font-size="${h}" fill="${color}" font-family="sans-serif"${rot ? ` transform="rotate(${-rot} ${x} ${y})"` : ''}>${lines.map((line, i) =>
        `<tspan x="${x}" dy="${i === 0 ? 0 : h}">${escapeXml(line)}</tspan>`
      ).join('')}</text>`;
    }

    case 'INSERT': {
      if (!blocks || !e.name) return '';
      const block = blocks[e.name];
      if (!block || !block.entities) return '';
      const px = e.position?.x ?? 0, py = e.position?.y ?? 0;
      const sx = e.xScale ?? 1, sy = e.yScale ?? 1;
      const rot = e.rotation || 0;
      expandBBox(bb, px, py);
      let inner = '';
      for (const be of block.entities) {
        inner += renderEntity(be, layers, blocks, bb, depth + 1, hiddenLayers);
      }
      const transform = `translate(${px},${py}) scale(${sx},${sy})${rot ? ` rotate(${-rot})` : ''}`;
      return `<g transform="${transform}">${inner}</g>`;
    }

    case 'POINT': {
      const x = e.position?.x ?? 0, y = e.position?.y ?? 0;
      expandBBox(bb, x, y);
      return `<circle cx="${x}" cy="${y}" r="${lw * 2}" fill="${color}" stroke="none"/>`;
    }

    case 'SOLID':
    case '3DFACE': {
      const pts: IPoint[] = e.points || [];
      if (pts.length < 3) return '';
      pts.forEach((p: IPoint) => expandBBox(bb, p.x, p.y));
      const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z';
      return `<path d="${d}" fill="${color}" fill-opacity="0.3" stroke="${color}" stroke-width="${lw}"/>`;
    }

    case 'DIMENSION': {
      const parts: string[] = [];
      if (e.anchorPoint && e.middleOfText) {
        expandBBox(bb, e.anchorPoint.x, e.anchorPoint.y);
        expandBBox(bb, e.middleOfText.x, e.middleOfText.y);
        parts.push(`<line x1="${e.anchorPoint.x}" y1="${e.anchorPoint.y}" x2="${e.middleOfText.x}" y2="${e.middleOfText.y}" ${stroke}/>`);
      }
      if (e.text && e.middleOfText) {
        parts.push(`<text x="${e.middleOfText.x}" y="${e.middleOfText.y}" font-size="3" fill="${color}" font-family="sans-serif" text-anchor="middle">${escapeXml(e.text)}</text>`);
      }
      return parts.join('');
    }

    default:
      return '';
  }
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderTextEntitiesFlipped(
  entities: IEntity[],
  layers: Record<string, ILayer> | undefined,
  blocks: Record<string, IBlock> | undefined,
  bb: BBox,
  depth: number = 0,
  hiddenLayers?: Set<string>
): string {
  if (depth > 10) return '';
  const parts: string[] = [];
  const vbH = (bb.maxY - bb.minY) || 1;
  const pad = Math.max(bb.maxX - bb.minX, vbH) * 0.05;
  const totalH = vbH + pad * 2;
  const originY = bb.minY - pad;

  for (const e of entities as any[]) {
    if (!isLayerVisible(e, layers, hiddenLayers)) continue;
    const color = getColor(e, layers);

    if (e.type === 'TEXT') {
      const x = e.startPoint?.x ?? 0, y = e.startPoint?.y ?? 0;
      const h = e.textHeight || 10;
      const text = e.text || '';
      const rot = e.rotation || 0;
      const svgY = originY + totalH - (y - originY);
      const anchor = e.halign === 1 ? 'middle' : e.halign === 2 ? 'end' : 'start';
      parts.push(`<text x="${x}" y="${svgY}" font-size="${h}" fill="${color}" font-family="sans-serif" text-anchor="${anchor}" dominant-baseline="auto"${rot ? ` transform="rotate(${rot} ${x} ${svgY})"` : ''}>${escapeXml(text)}</text>`);
    } else if (e.type === 'MTEXT') {
      const x = e.position?.x ?? 0, y = e.position?.y ?? 0;
      const h = e.height || 10;
      const text = (e.text || '').replace(/\\[A-Za-z][^;]*;/g, '').replace(/\{|\}/g, '').replace(/\\P/g, '\n');
      const rot = e.rotation || 0;
      const svgY = originY + totalH - (y - originY);
      const lines = text.split('\n');
      parts.push(`<text x="${x}" y="${svgY}" font-size="${h}" fill="${color}" font-family="sans-serif"${rot ? ` transform="rotate(${rot} ${x} ${svgY})"` : ''}>${lines.map((line: string, i: number) =>
        `<tspan x="${x}" dy="${i === 0 ? 0 : h}">${escapeXml(line)}</tspan>`
      ).join('')}</text>`);
    } else if (e.type === 'DIMENSION' && e.text && e.middleOfText) {
      const x = e.middleOfText.x, y = e.middleOfText.y;
      const svgY = originY + totalH - (y - originY);
      parts.push(`<text x="${x}" y="${svgY}" font-size="3" fill="${color}" font-family="sans-serif" text-anchor="middle">${escapeXml(e.text)}</text>`);
    } else if (e.type === 'INSERT' && blocks && e.name) {
      const block = blocks[e.name];
      if (block?.entities) {
        // For block inserts with text, we'd need full transform — skip for simplicity
      }
    }
  }
  return parts.join('\n');
}

// ==================== PUBLIC API ====================

/** Parse DXF text content into IDxf object */
export function parseDxf(dxfText: string): IDxf {
  const parser = new DxfParser();
  const dxf = parser.parseSync(dxfText);
  if (!dxf) throw new Error('Failed to parse DXF file');
  return dxf;
}

/** Layer info for the UI panel */
export interface DxfLayerInfo {
  name: string;
  color: string;
  entityCount: number;
  visible: boolean;
  frozen: boolean;
}

/** Extract layer information from parsed DXF */
export function extractLayerInfo(dxf: IDxf): DxfLayerInfo[] {
  const layers = dxf.tables?.layer?.layers;
  if (!layers) return [];

  // Count entities per layer
  const counts: Record<string, number> = {};
  for (const e of dxf.entities) {
    const ln = (e as any).layer || '0';
    counts[ln] = (counts[ln] || 0) + 1;
  }

  return Object.values(layers).map((layer: ILayer) => ({
    name: layer.name,
    color: getLayerColor(layer),
    entityCount: counts[layer.name] || 0,
    visible: layer.visible !== false,
    frozen: layer.frozen === true,
  })).sort((a, b) => b.entityCount - a.entityCount);
}

/** ViewBox info returned alongside SVG */
export interface DxfViewBoxInfo {
  vbX: number; vbY: number; vbW: number; vbH: number;
  svgWidth: number; svgHeight: number;
}

/** Full render result */
export interface DxfRenderResult {
  svg: string;
  viewBox: DxfViewBoxInfo;
}

/** Render parsed IDxf to SVG string with optional hidden layers */
export function renderDxfFull(dxf: IDxf, hiddenLayers?: Set<string>): DxfRenderResult {
  const layers = dxf.tables?.layer?.layers;
  const blocks = dxf.blocks;

  const bb: BBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const svgParts: string[] = [];

  for (const entity of dxf.entities) {
    const svg = renderEntity(entity, layers, blocks, bb, 0, hiddenLayers);
    if (svg) svgParts.push(svg);
  }

  if (bb.minX === Infinity) {
    bb.minX = 0; bb.minY = 0; bb.maxX = 100; bb.maxY = 100;
  }

  const w = bb.maxX - bb.minX || 1;
  const h = bb.maxY - bb.minY || 1;
  const pad = Math.max(w, h) * 0.05;
  const vbX = bb.minX - pad;
  const vbY = bb.minY - pad;
  const vbW = w + pad * 2;
  const vbH = h + pad * 2;
  const svgWidth = Math.max(vbW * 2, 1600);
  const svgHeight = Math.max(vbH * 2, 1200);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="${svgWidth}" height="${svgHeight}" style="background:#ffffff">
<g transform="translate(0, ${vbY * 2 + vbH}) scale(1, -1)">
${svgParts.join('\n')}
</g>
<g>
${renderTextEntitiesFlipped(dxf.entities, layers, blocks, bb, 0, hiddenLayers)}
</g>
</svg>`;

  return { svg, viewBox: { vbX, vbY, vbW, vbH, svgWidth, svgHeight } };
}

/** Render parsed IDxf to blob URL + viewBox info */
export function renderDxfToBlobUrl(dxf: IDxf, hiddenLayers?: Set<string>): { url: string; viewBox: DxfViewBoxInfo } {
  const result = renderDxfFull(dxf, hiddenLayers);
  const blob = new Blob([result.svg], { type: 'image/svg+xml' });
  return { url: URL.createObjectURL(blob), viewBox: result.viewBox };
}

/** Backward-compatible: parse + render to SVG string */
export function renderDxfToSvg(dxfText: string): string {
  const dxf = parseDxf(dxfText);
  return renderDxfFull(dxf).svg;
}

/** Backward-compatible: parse + render to blob URL */
export function renderDxfToSvgBlobUrl(dxfText: string): string {
  const dxf = parseDxf(dxfText);
  return renderDxfToBlobUrl(dxf).url;
}

// ==================== COORDINATE MAPPING ====================

/** Convert overlay SVG screen coordinates to DXF model space */
export function screenToDxfCoords(
  svgPt: { x: number; y: number },
  planNatW: number, planNatH: number,
  viewBox: DxfViewBoxInfo
): { x: number; y: number } {
  // SVG overlay is 0..planNatW x 0..planNatH
  // DXF image has viewBox vbX..vbX+vbW x vbY..vbY+vbH, rendered at svgWidth x svgHeight
  // The image is displayed at planNatW x planNatH (natural size from <img>)
  const x = viewBox.vbX + (svgPt.x / planNatW) * viewBox.vbW;
  // DXF Y is flipped (Y-up in DXF, Y-down in SVG)
  const y = viewBox.vbY + viewBox.vbH - (svgPt.y / planNatH) * viewBox.vbH;
  return { x, y };
}

/** Convert DXF model space to overlay SVG screen coordinates */
export function dxfToScreenCoords(
  dxfPt: { x: number; y: number },
  planNatW: number, planNatH: number,
  viewBox: DxfViewBoxInfo
): { x: number; y: number } {
  const x = ((dxfPt.x - viewBox.vbX) / viewBox.vbW) * planNatW;
  // Flip Y
  const y = ((viewBox.vbY + viewBox.vbH - dxfPt.y) / viewBox.vbH) * planNatH;
  return { x, y };
}

// ==================== HIT-TESTING ====================

/** Distance from point to line segment */
function pointToSegmentDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * dx, projY = y1 + t * dy;
  return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
}

/** Distance from a DXF-space point to an entity */
function entityDistance(e: any, px: number, py: number): number {
  switch (e.type) {
    case 'LINE': {
      const v = e.vertices;
      if (!v || v.length < 2) return Infinity;
      return pointToSegmentDist(px, py, v[0].x, v[0].y, v[1].x, v[1].y);
    }
    case 'CIRCLE': {
      const cx = e.center?.x ?? 0, cy = e.center?.y ?? 0, r = e.radius ?? 0;
      return Math.abs(Math.sqrt((px - cx) ** 2 + (py - cy) ** 2) - r);
    }
    case 'ARC': {
      const cx = e.center?.x ?? 0, cy = e.center?.y ?? 0, r = e.radius ?? 0;
      return Math.abs(Math.sqrt((px - cx) ** 2 + (py - cy) ** 2) - r);
    }
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      const verts = e.vertices as IPoint[];
      if (!verts || verts.length < 2) return Infinity;
      let minD = Infinity;
      for (let i = 0; i < verts.length - 1; i++) {
        const d = pointToSegmentDist(px, py, verts[i].x, verts[i].y, verts[i + 1].x, verts[i + 1].y);
        if (d < minD) minD = d;
      }
      if (e.shape === true && verts.length >= 3) {
        const last = verts[verts.length - 1], first = verts[0];
        const d = pointToSegmentDist(px, py, last.x, last.y, first.x, first.y);
        if (d < minD) minD = d;
      }
      return minD;
    }
    case 'INSERT': {
      const pos = e.position;
      if (!pos) return Infinity;
      return Math.sqrt((px - pos.x) ** 2 + (py - pos.y) ** 2);
    }
    case 'TEXT': {
      const sp = e.startPoint;
      if (!sp) return Infinity;
      return Math.sqrt((px - sp.x) ** 2 + (py - sp.y) ** 2);
    }
    case 'MTEXT': {
      const pos = e.position;
      if (!pos) return Infinity;
      return Math.sqrt((px - pos.x) ** 2 + (py - pos.y) ** 2);
    }
    default: {
      const pos = e.position || e.center;
      if (!pos) return Infinity;
      return Math.sqrt((px - pos.x) ** 2 + (py - pos.y) ** 2);
    }
  }
}

/** Find nearest entity to a DXF-space point */
export function findNearestEntity(
  dxf: IDxf, clickPt: { x: number; y: number }, maxDist: number, hiddenLayers?: Set<string>
): IEntity | null {
  const layers = dxf.tables?.layer?.layers;
  let best: IEntity | null = null;
  let bestDist = maxDist;
  for (const e of dxf.entities) {
    if (!isLayerVisible(e, layers, hiddenLayers)) continue;
    const d = entityDistance(e, clickPt.x, clickPt.y);
    if (d < bestDist) {
      bestDist = d;
      best = e;
    }
  }
  return best;
}

/** Find all entities matching the given entity (same block name for INSERT, same type+layer for others) */
export function findMatchingEntities(dxf: IDxf, entity: IEntity, hiddenLayers?: Set<string>): IEntity[] {
  const layers = dxf.tables?.layer?.layers;
  const e = entity as any;
  return dxf.entities.filter(other => {
    if (!isLayerVisible(other, layers, hiddenLayers)) return false;
    const o = other as any;
    if (e.type === 'INSERT') {
      return o.type === 'INSERT' && o.name === e.name;
    }
    return o.type === e.type && o.layer === e.layer;
  });
}

/** Get the center/position of an entity (for placing markers) */
export function getEntityCenter(entity: IEntity): { x: number; y: number } | null {
  const e = entity as any;
  switch (e.type) {
    case 'LINE': {
      const v = e.vertices;
      if (!v || v.length < 2) return null;
      return { x: (v[0].x + v[1].x) / 2, y: (v[0].y + v[1].y) / 2 };
    }
    case 'CIRCLE':
    case 'ARC':
      return e.center ? { x: e.center.x, y: e.center.y } : null;
    case 'ELLIPSE':
      return e.center ? { x: e.center.x, y: e.center.y } : null;
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      const verts = e.vertices as IPoint[];
      if (!verts || verts.length === 0) return null;
      const cx = verts.reduce((s: number, v: IPoint) => s + v.x, 0) / verts.length;
      const cy = verts.reduce((s: number, v: IPoint) => s + v.y, 0) / verts.length;
      return { x: cx, y: cy };
    }
    case 'INSERT':
      return e.position ? { x: e.position.x, y: e.position.y } : null;
    case 'TEXT':
      return e.startPoint ? { x: e.startPoint.x, y: e.startPoint.y } : null;
    case 'MTEXT':
      return e.position ? { x: e.position.x, y: e.position.y } : null;
    default:
      return e.position ? { x: e.position.x, y: e.position.y } :
             e.center ? { x: e.center.x, y: e.center.y } : null;
  }
}
