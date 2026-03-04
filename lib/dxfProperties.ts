/**
 * DXF Properties — extract entity properties for the properties panel
 */
import type { IDxf } from 'dxf-parser';
import type { IPoint } from 'dxf-parser/dist/entities/geomtry';

export interface PropertyEntry {
  label: string;
  value: string;
  category?: string;
}

function fmt(n: number | undefined | null, decimals = 4): string {
  if (n == null) return '—';
  return Number(n).toFixed(decimals);
}

function ptStr(p: IPoint | undefined | null): string {
  if (!p) return '—';
  return `(${fmt(p.x)}, ${fmt(p.y)}${p.z ? `, ${fmt(p.z)}` : ''})`;
}

function lineLength(v: IPoint[]): number {
  if (!v || v.length < 2) return 0;
  const dx = v[1].x - v[0].x, dy = v[1].y - v[0].y;
  const dz = (v[1] as any).z ? ((v[1] as any).z - (v[0] as any).z) : 0;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function polylineLength(vertices: IPoint[], closed: boolean): number {
  if (!vertices || vertices.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < vertices.length - 1; i++) {
    const dx = vertices[i + 1].x - vertices[i].x;
    const dy = vertices[i + 1].y - vertices[i].y;
    total += Math.sqrt(dx * dx + dy * dy);
  }
  if (closed && vertices.length >= 3) {
    const first = vertices[0], last = vertices[vertices.length - 1];
    total += Math.sqrt((first.x - last.x) ** 2 + (first.y - last.y) ** 2);
  }
  return total;
}

/** Get display properties for any DXF entity */
export function getEntityProperties(entity: any, dxf?: IDxf): PropertyEntry[] {
  const props: PropertyEntry[] = [];

  // Common properties
  props.push({ label: 'Typ', value: entity.type || 'UNKNOWN', category: 'Ogólne' });
  props.push({ label: 'Warstwa', value: entity.layer || '0', category: 'Ogólne' });

  if (entity.handle) {
    props.push({ label: 'Handle', value: entity.handle, category: 'Ogólne' });
  }

  if (entity.colorIndex != null && entity.colorIndex > 0) {
    props.push({ label: 'Indeks koloru', value: String(entity.colorIndex), category: 'Ogólne' });
  } else if (entity.color != null && entity.color !== 0 && entity.color !== 256) {
    props.push({ label: 'Kolor', value: '#' + entity.color.toString(16).padStart(6, '0'), category: 'Ogólne' });
  } else {
    props.push({ label: 'Kolor', value: 'BYLAYER', category: 'Ogólne' });
  }

  if (entity.lineweight != null && entity.lineweight > 0) {
    props.push({ label: 'Grubość linii', value: `${entity.lineweight / 100} mm`, category: 'Ogólne' });
  }

  if (entity.lineType) {
    props.push({ label: 'Typ linii', value: entity.lineType, category: 'Ogólne' });
  }

  // Type-specific properties
  switch (entity.type) {
    case 'LINE': {
      const v = entity.vertices as IPoint[];
      if (v && v.length >= 2) {
        props.push({ label: 'Punkt początkowy', value: ptStr(v[0]), category: 'Geometria' });
        props.push({ label: 'Punkt końcowy', value: ptStr(v[1]), category: 'Geometria' });
        props.push({ label: 'Długość', value: fmt(lineLength(v)), category: 'Geometria' });
        props.push({ label: 'ΔX', value: fmt(v[1].x - v[0].x), category: 'Geometria' });
        props.push({ label: 'ΔY', value: fmt(v[1].y - v[0].y), category: 'Geometria' });
        const angle = Math.atan2(v[1].y - v[0].y, v[1].x - v[0].x) * 180 / Math.PI;
        props.push({ label: 'Kąt', value: `${fmt(angle, 2)}°`, category: 'Geometria' });
      }
      break;
    }
    case 'CIRCLE': {
      props.push({ label: 'Środek', value: ptStr(entity.center), category: 'Geometria' });
      props.push({ label: 'Promień', value: fmt(entity.radius), category: 'Geometria' });
      props.push({ label: 'Średnica', value: fmt((entity.radius || 0) * 2), category: 'Geometria' });
      props.push({ label: 'Obwód', value: fmt(2 * Math.PI * (entity.radius || 0)), category: 'Geometria' });
      props.push({ label: 'Pole', value: fmt(Math.PI * (entity.radius || 0) ** 2), category: 'Geometria' });
      break;
    }
    case 'ARC': {
      props.push({ label: 'Środek', value: ptStr(entity.center), category: 'Geometria' });
      props.push({ label: 'Promień', value: fmt(entity.radius), category: 'Geometria' });
      props.push({ label: 'Kąt początkowy', value: `${fmt(entity.startAngle, 2)}°`, category: 'Geometria' });
      props.push({ label: 'Kąt końcowy', value: `${fmt(entity.endAngle, 2)}°`, category: 'Geometria' });
      let sweep = (entity.endAngle || 0) - (entity.startAngle || 0);
      if (sweep < 0) sweep += 360;
      props.push({ label: 'Kąt łuku', value: `${fmt(sweep, 2)}°`, category: 'Geometria' });
      props.push({ label: 'Długość łuku', value: fmt((entity.radius || 0) * sweep * Math.PI / 180), category: 'Geometria' });
      break;
    }
    case 'ELLIPSE': {
      props.push({ label: 'Środek', value: ptStr(entity.center), category: 'Geometria' });
      if (entity.majorAxisEndPoint) {
        const mx = entity.majorAxisEndPoint.x, my = entity.majorAxisEndPoint.y;
        const majorR = Math.sqrt(mx * mx + my * my);
        const minorR = majorR * (entity.axisRatio || 1);
        props.push({ label: 'Oś główna', value: fmt(majorR * 2), category: 'Geometria' });
        props.push({ label: 'Oś poboczna', value: fmt(minorR * 2), category: 'Geometria' });
        props.push({ label: 'Proporcja osi', value: fmt(entity.axisRatio, 4), category: 'Geometria' });
        const rotation = Math.atan2(my, mx) * 180 / Math.PI;
        props.push({ label: 'Obrót', value: `${fmt(rotation, 2)}°`, category: 'Geometria' });
      }
      break;
    }
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      const verts = entity.vertices as IPoint[];
      if (verts) {
        const closed = entity.shape === true;
        props.push({ label: 'Wierzchołki', value: String(verts.length), category: 'Geometria' });
        props.push({ label: 'Zamknięta', value: closed ? 'Tak' : 'Nie', category: 'Geometria' });
        props.push({ label: 'Długość', value: fmt(polylineLength(verts, closed)), category: 'Geometria' });
        if (closed && verts.length >= 3) {
          // Shoelace formula for area
          let area = 0;
          for (let i = 0; i < verts.length; i++) {
            const j = (i + 1) % verts.length;
            area += verts[i].x * verts[j].y - verts[j].x * verts[i].y;
          }
          props.push({ label: 'Pole', value: fmt(Math.abs(area) / 2), category: 'Geometria' });
        }
      }
      break;
    }
    case 'SPLINE': {
      const cps = entity.controlPoints || entity.fitPoints || [];
      props.push({ label: 'Punkty kontrolne', value: String(cps.length), category: 'Geometria' });
      props.push({ label: 'Stopień', value: String(entity.degreeOfSplineCurve || 3), category: 'Geometria' });
      props.push({ label: 'Zamknięta', value: entity.closed ? 'Tak' : 'Nie', category: 'Geometria' });
      break;
    }
    case 'TEXT': {
      props.push({ label: 'Tekst', value: entity.text || '', category: 'Tekst' });
      props.push({ label: 'Pozycja', value: ptStr(entity.startPoint), category: 'Geometria' });
      props.push({ label: 'Wysokość', value: fmt(entity.textHeight), category: 'Tekst' });
      if (entity.rotation) props.push({ label: 'Obrót', value: `${fmt(entity.rotation, 2)}°`, category: 'Tekst' });
      if (entity.styleName) props.push({ label: 'Styl', value: entity.styleName, category: 'Tekst' });
      break;
    }
    case 'MTEXT': {
      const rawText = entity.text || '';
      const cleanText = rawText.replace(/\\[A-Za-z][^;]*;/g, '').replace(/\{|\}/g, '').replace(/\\P/g, '\n');
      props.push({ label: 'Tekst', value: cleanText, category: 'Tekst' });
      props.push({ label: 'Pozycja', value: ptStr(entity.position), category: 'Geometria' });
      props.push({ label: 'Wysokość', value: fmt(entity.height), category: 'Tekst' });
      if (entity.width) props.push({ label: 'Szerokość', value: fmt(entity.width), category: 'Tekst' });
      if (entity.rotation) props.push({ label: 'Obrót', value: `${fmt(entity.rotation, 2)}°`, category: 'Tekst' });
      break;
    }
    case 'INSERT': {
      props.push({ label: 'Nazwa bloku', value: entity.name || '—', category: 'Blok' });
      props.push({ label: 'Pozycja', value: ptStr(entity.position), category: 'Geometria' });
      if (entity.xScale != null) props.push({ label: 'Skala X', value: fmt(entity.xScale), category: 'Blok' });
      if (entity.yScale != null) props.push({ label: 'Skala Y', value: fmt(entity.yScale), category: 'Blok' });
      if (entity.rotation) props.push({ label: 'Obrót', value: `${fmt(entity.rotation, 2)}°`, category: 'Blok' });

      // Block entity count
      if (dxf?.blocks && entity.name) {
        const block = dxf.blocks[entity.name];
        if (block?.entities) {
          props.push({ label: 'Elementy bloku', value: String(block.entities.length), category: 'Blok' });
        }
      }

      // Attributes
      if (entity.attributes && entity.attributes.length > 0) {
        for (const attr of entity.attributes) {
          props.push({ label: `Atrybut: ${attr.tag || '?'}`, value: attr.text || '', category: 'Atrybuty' });
        }
      }
      break;
    }
    case 'DIMENSION': {
      if (entity.text) props.push({ label: 'Tekst', value: entity.text, category: 'Wymiar' });
      if (entity.anchorPoint) props.push({ label: 'Punkt kotwiczenia', value: ptStr(entity.anchorPoint), category: 'Geometria' });
      if (entity.middleOfText) props.push({ label: 'Pozycja tekstu', value: ptStr(entity.middleOfText), category: 'Geometria' });
      break;
    }
    case 'POINT': {
      props.push({ label: 'Pozycja', value: ptStr(entity.position), category: 'Geometria' });
      break;
    }
    case 'SOLID':
    case '3DFACE': {
      const pts = entity.points || [];
      for (let i = 0; i < pts.length; i++) {
        props.push({ label: `Punkt ${i + 1}`, value: ptStr(pts[i]), category: 'Geometria' });
      }
      break;
    }
  }

  return props;
}

/** Get a short description of an entity (for lists) */
export function getEntityDescription(entity: any): string {
  switch (entity.type) {
    case 'LINE': return `Linia [${entity.layer || '0'}]`;
    case 'CIRCLE': return `Okrąg R=${fmt(entity.radius, 2)} [${entity.layer || '0'}]`;
    case 'ARC': return `Łuk R=${fmt(entity.radius, 2)} [${entity.layer || '0'}]`;
    case 'ELLIPSE': return `Elipsa [${entity.layer || '0'}]`;
    case 'LWPOLYLINE':
    case 'POLYLINE': return `Polilinia ${entity.vertices?.length || 0}v [${entity.layer || '0'}]`;
    case 'TEXT': return `Tekst: "${(entity.text || '').substring(0, 30)}" [${entity.layer || '0'}]`;
    case 'MTEXT': return `MText: "${(entity.text || '').substring(0, 30)}" [${entity.layer || '0'}]`;
    case 'INSERT': return `Blok: ${entity.name || '?'} [${entity.layer || '0'}]`;
    case 'DIMENSION': return `Wymiar [${entity.layer || '0'}]`;
    case 'SPLINE': return `Splajn [${entity.layer || '0'}]`;
    default: return `${entity.type} [${entity.layer || '0'}]`;
  }
}
