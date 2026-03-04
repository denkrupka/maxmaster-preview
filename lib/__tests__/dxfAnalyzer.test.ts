import { describe, it, expect } from 'vitest';
import { analyzeDxf, groupConnectedLines } from '../dxfAnalyzer';
import { InsUnits } from '../dxfUnits';
import { parseDxf } from '../dxfRenderer';

const dxfHeader = `0\nSECTION\n2\nHEADER\n0\nENDSEC`;
const dxfTables = `0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n0\nLAYER\n2\n0\n70\n0\n62\n7\n6\nCONTINUOUS\n0\nENDTAB\n0\nENDSEC`;
const dxfBlocks = `0\nSECTION\n2\nBLOCKS\n0\nENDSEC`;

function makeDxf(entities: string): string {
  return `${dxfHeader}\n${dxfTables}\n${dxfBlocks}\n0\nSECTION\n2\nENTITIES\n${entities}\n0\nENDSEC\n0\nEOF`;
}

function lineEntity(x1: number, y1: number, x2: number, y2: number, layer = '0'): string {
  return `0\nLINE\n8\n${layer}\n10\n${x1}\n20\n${y1}\n30\n0\n11\n${x2}\n21\n${y2}\n31\n0`;
}

function circleEntity(cx: number, cy: number, r: number, layer = '0'): string {
  return `0\nCIRCLE\n8\n${layer}\n10\n${cx}\n20\n${cy}\n30\n0\n40\n${r}`;
}

function textEntity(x: number, y: number, text: string): string {
  return `0\nTEXT\n8\n0\n10\n${x}\n20\n${y}\n30\n0\n40\n5\n1\n${text}`;
}

describe('dxfAnalyzer', () => {
  describe('analyzeDxf', () => {
    it('counts entities and layers', () => {
      const entities = [
        lineEntity(0, 0, 100, 0),
        lineEntity(100, 0, 100, 100),
        circleEntity(50, 50, 25),
      ].join('\n');
      const dxf = parseDxf(makeDxf(entities));
      const analysis = analyzeDxf(dxf);

      expect(analysis.totalEntities).toBe(3);
      expect(analysis.totalLayers).toBeGreaterThanOrEqual(1);
      expect(analysis.entities).toHaveLength(3);
    });

    it('calculates entity lengths', () => {
      const dxf = parseDxf(makeDxf(lineEntity(0, 0, 100, 0)));
      const analysis = analyzeDxf(dxf);

      // Default units are unitless (factor = 1), so 100 units = 100 meters
      expect(analysis.entities[0].lengthM).toBeCloseTo(100, 0);
    });

    it('classifies entity types', () => {
      const entities = [
        lineEntity(0, 0, 10, 10),
        circleEntity(5, 5, 3),
        textEntity(0, 0, 'Hello'),
      ].join('\n');
      const dxf = parseDxf(makeDxf(entities));
      const analysis = analyzeDxf(dxf);

      expect(analysis.entities.find(e => e.entityType === 'LINE')).toBeDefined();
      expect(analysis.entities.find(e => e.entityType === 'CIRCLE')).toBeDefined();
      expect(analysis.entities.find(e => e.entityType === 'TEXT')).toBeDefined();
    });

    it('extracts geometry for LINE entities', () => {
      const dxf = parseDxf(makeDxf(lineEntity(10, 20, 30, 40)));
      const analysis = analyzeDxf(dxf);
      const lineEnt = analysis.entities[0];

      expect(lineEnt.geometry.type).toBe('line');
      expect(lineEnt.geometry.points).toHaveLength(2);
      expect(lineEnt.geometry.points![0]).toEqual({ x: 10, y: 20 });
      expect(lineEnt.geometry.points![1]).toEqual({ x: 30, y: 40 });
    });

    it('calculates circle area', () => {
      const dxf = parseDxf(makeDxf(circleEntity(0, 0, 10)));
      const analysis = analyzeDxf(dxf);
      const circle = analysis.entities[0];

      // Area = π * r² = π * 100 ≈ 314.16 (unitless → meters)
      expect(circle.areaM2).toBeCloseTo(Math.PI * 100, 0);
    });
  });

  describe('groupConnectedLines', () => {
    it('groups connected lines', () => {
      // Three connected lines forming an L-shape
      const entities = [
        { type: 'LINE', vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }], layer: '0' },
        { type: 'LINE', vertices: [{ x: 100, y: 0 }, { x: 100, y: 50 }], layer: '0' },
        // Isolated line
        { type: 'LINE', vertices: [{ x: 500, y: 500 }, { x: 600, y: 500 }], layer: '0' },
      ];

      const groups = groupConnectedLines(entities as any, InsUnits.Unitless, 0.5);

      // Should have one group of 2 connected lines (isolated line with count=1 is skipped)
      expect(groups.length).toBe(1);
      expect(groups[0].entityIndices).toHaveLength(2);
      expect(groups[0].entityIndices).toContain(0);
      expect(groups[0].entityIndices).toContain(1);
    });

    it('separates lines on different layers', () => {
      const entities = [
        { type: 'LINE', vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }], layer: 'A' },
        { type: 'LINE', vertices: [{ x: 100, y: 0 }, { x: 200, y: 0 }], layer: 'A' },
        { type: 'LINE', vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }], layer: 'B' },
        { type: 'LINE', vertices: [{ x: 100, y: 0 }, { x: 200, y: 0 }], layer: 'B' },
      ];

      const groups = groupConnectedLines(entities as any, InsUnits.Unitless, 0.5);
      expect(groups.length).toBe(2);
    });

    it('returns empty for non-LINE entities', () => {
      const entities = [
        { type: 'CIRCLE', center: { x: 0, y: 0 }, radius: 10, layer: '0' },
      ];

      const groups = groupConnectedLines(entities as any, InsUnits.Unitless, 0.5);
      expect(groups).toHaveLength(0);
    });

    it('calculates total length of grouped lines', () => {
      const entities = [
        { type: 'LINE', vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }], layer: '0' },
        { type: 'LINE', vertices: [{ x: 100, y: 0 }, { x: 100, y: 50 }], layer: '0' },
      ];

      const groups = groupConnectedLines(entities as any, InsUnits.Unitless, 0.5);
      expect(groups[0].totalLengthM).toBeCloseTo(150, 0);
    });
  });
});
