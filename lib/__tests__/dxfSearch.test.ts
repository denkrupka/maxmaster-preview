import { describe, it, expect } from 'vitest';
import { searchDxfText, searchDxfEntities, countEntitiesByType } from '../dxfSearch';
import { parseDxf } from '../dxfRenderer';

const dxfHeader = `0\nSECTION\n2\nHEADER\n0\nENDSEC`;
const dxfTables = `0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n0\nLAYER\n2\n0\n70\n0\n62\n7\n6\nCONTINUOUS\n0\nENDTAB\n0\nENDSEC`;
const dxfBlocks = `0\nSECTION\n2\nBLOCKS\n0\nENDSEC`;

function makeDxf(entities: string): string {
  return `${dxfHeader}\n${dxfTables}\n${dxfBlocks}\n0\nSECTION\n2\nENTITIES\n${entities}\n0\nENDSEC\n0\nEOF`;
}

function textEntity(x: number, y: number, height: number, text: string, layer = '0'): string {
  return `0\nTEXT\n8\n${layer}\n10\n${x}\n20\n${y}\n30\n0\n40\n${height}\n1\n${text}`;
}

function lineEntity(x1: number, y1: number, x2: number, y2: number, layer = '0'): string {
  return `0\nLINE\n8\n${layer}\n10\n${x1}\n20\n${y1}\n30\n0\n11\n${x2}\n21\n${y2}\n31\n0`;
}

function circleEntity(cx: number, cy: number, r: number, layer = '0'): string {
  return `0\nCIRCLE\n8\n${layer}\n10\n${cx}\n20\n${cy}\n30\n0\n40\n${r}`;
}

describe('dxfSearch', () => {
  describe('searchDxfText', () => {
    it('finds TEXT entity by content', () => {
      const dxf = parseDxf(makeDxf(textEntity(10, 20, 5, 'Hello World')));
      const results = searchDxfText(dxf, 'Hello');
      expect(results).toHaveLength(1);
      expect(results[0].matchedText).toBe('Hello World');
      expect(results[0].position.x).toBe(10);
      expect(results[0].position.y).toBe(20);
    });

    it('search is case-insensitive by default', () => {
      const dxf = parseDxf(makeDxf(textEntity(0, 0, 5, 'UPPERCASE text')));
      const results = searchDxfText(dxf, 'uppercase');
      expect(results).toHaveLength(1);
    });

    it('case-sensitive option works', () => {
      const dxf = parseDxf(makeDxf(textEntity(0, 0, 5, 'UPPERCASE text')));
      const results = searchDxfText(dxf, 'uppercase', { caseSensitive: true });
      expect(results).toHaveLength(0);
    });

    it('returns empty for no matches', () => {
      const dxf = parseDxf(makeDxf(textEntity(0, 0, 5, 'Hello')));
      const results = searchDxfText(dxf, 'xyz');
      expect(results).toHaveLength(0);
    });

    it('returns empty for empty query', () => {
      const dxf = parseDxf(makeDxf(textEntity(0, 0, 5, 'Hello')));
      const results = searchDxfText(dxf, '');
      expect(results).toHaveLength(0);
    });

    it('finds multiple text entities', () => {
      const entities = [
        textEntity(0, 0, 5, 'Cable A'),
        textEntity(10, 10, 5, 'Cable B'),
        textEntity(20, 20, 5, 'Switch'),
      ].join('\n');
      const dxf = parseDxf(makeDxf(entities));
      const results = searchDxfText(dxf, 'Cable');
      expect(results).toHaveLength(2);
    });

    it('respects hiddenLayers', () => {
      const entities = [
        textEntity(0, 0, 5, 'Visible', '0'),
        textEntity(10, 10, 5, 'Hidden', 'HIDDEN'),
      ].join('\n');
      const dxf = parseDxf(makeDxf(entities));
      const results = searchDxfText(dxf, 'Visible', { hiddenLayers: new Set(['HIDDEN']) });
      expect(results).toHaveLength(1);
      expect(results[0].matchedText).toBe('Visible');
    });
  });

  describe('searchDxfEntities', () => {
    it('filters by entity type', () => {
      const entities = [
        lineEntity(0, 0, 10, 10),
        circleEntity(5, 5, 3),
        lineEntity(10, 10, 20, 20),
      ].join('\n');
      const dxf = parseDxf(makeDxf(entities));
      const results = searchDxfEntities(dxf, { type: 'LINE' });
      expect(results).toHaveLength(2);
    });

    it('filters by multiple types', () => {
      const entities = [
        lineEntity(0, 0, 10, 10),
        circleEntity(5, 5, 3),
        textEntity(0, 0, 5, 'Test'),
      ].join('\n');
      const dxf = parseDxf(makeDxf(entities));
      const results = searchDxfEntities(dxf, { type: ['LINE', 'CIRCLE'] });
      expect(results).toHaveLength(2);
    });

    it('filters by layer', () => {
      const entities = [
        lineEntity(0, 0, 10, 10, '0'),
        lineEntity(10, 10, 20, 20, 'CABLES'),
      ].join('\n');
      const dxf = parseDxf(makeDxf(entities));
      const results = searchDxfEntities(dxf, { layer: '0' });
      // Layer '0' includes all entities since CABLES layer doesn't exist in our simple table def
      // Actually the entities still have their layer attribute
      expect(results.every(r => r.entity.layer === '0')).toBe(true);
    });
  });

  describe('countEntitiesByType', () => {
    it('counts entities correctly', () => {
      const entities = [
        lineEntity(0, 0, 10, 10),
        lineEntity(10, 10, 20, 20),
        circleEntity(5, 5, 3),
      ].join('\n');
      const dxf = parseDxf(makeDxf(entities));
      const counts = countEntitiesByType(dxf);
      expect(counts['LINE']).toBe(2);
      expect(counts['CIRCLE']).toBe(1);
    });
  });
});
