import { describe, it, expect } from 'vitest';
import { findSnapPoints, getBestSnap, findIntersections, getEntitySnapPoints } from '../dxfSnap';
import { parseDxf } from '../dxfRenderer';

// Reuse makeDxf helpers from dxfRenderer.test.ts
const dxfHeader = `0\nSECTION\n2\nHEADER\n0\nENDSEC`;
const dxfTables = `0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n0\nLAYER\n2\n0\n70\n0\n62\n7\n6\nCONTINUOUS\n0\nENDTAB\n0\nENDSEC`;
const dxfBlocks = `0\nSECTION\n2\nBLOCKS\n0\nENDSEC`;

function makeDxf(entities: string): string {
  return `${dxfHeader}\n${dxfTables}\n${dxfBlocks}\n0\nSECTION\n2\nENTITIES\n${entities}\n0\nENDSEC\n0\nEOF`;
}

function lineEntity(x1: number, y1: number, x2: number, y2: number): string {
  return `0\nLINE\n8\n0\n10\n${x1}\n20\n${y1}\n30\n0\n11\n${x2}\n21\n${y2}\n31\n0`;
}

function circleEntity(cx: number, cy: number, r: number): string {
  return `0\nCIRCLE\n8\n0\n10\n${cx}\n20\n${cy}\n30\n0\n40\n${r}`;
}

describe('dxfSnap', () => {
  describe('findSnapPoints', () => {
    it('finds endpoint snaps on a LINE', () => {
      const dxf = parseDxf(makeDxf(lineEntity(0, 0, 100, 0)));
      const snaps = findSnapPoints(dxf, { x: 1, y: 0 }, 5);
      const endpoints = snaps.filter(s => s.type === 'endpoint');
      expect(endpoints.length).toBeGreaterThanOrEqual(1);
      expect(endpoints.some(s => s.x === 0 && s.y === 0)).toBe(true);
    });

    it('finds midpoint snap on a LINE', () => {
      const dxf = parseDxf(makeDxf(lineEntity(0, 0, 100, 0)));
      const snaps = findSnapPoints(dxf, { x: 50, y: 0 }, 5);
      const midpoints = snaps.filter(s => s.type === 'midpoint');
      expect(midpoints.length).toBeGreaterThanOrEqual(1);
      expect(midpoints[0].x).toBe(50);
      expect(midpoints[0].y).toBe(0);
    });

    it('finds center snap on a CIRCLE', () => {
      const dxf = parseDxf(makeDxf(circleEntity(50, 50, 25)));
      const snaps = findSnapPoints(dxf, { x: 50, y: 50 }, 5);
      const centers = snaps.filter(s => s.type === 'center');
      expect(centers.length).toBe(1);
      expect(centers[0].x).toBe(50);
      expect(centers[0].y).toBe(50);
    });

    it('finds nearest snap on a LINE', () => {
      const dxf = parseDxf(makeDxf(lineEntity(0, 0, 100, 0)));
      // Point near middle of line but offset in Y
      const snaps = findSnapPoints(dxf, { x: 30, y: 2 }, 5);
      const nearest = snaps.filter(s => s.type === 'nearest');
      expect(nearest.length).toBeGreaterThanOrEqual(1);
      // Nearest point should be on the line at y=0
      expect(nearest[0].y).toBe(0);
      expect(nearest[0].x).toBeCloseTo(30, 0);
    });

    it('respects hidden layers', () => {
      const dxf = parseDxf(makeDxf(lineEntity(0, 0, 100, 0)));
      const hiddenLayers = new Set(['0']);
      const snaps = findSnapPoints(dxf, { x: 0, y: 0 }, 10, hiddenLayers);
      expect(snaps).toHaveLength(0);
    });

    it('returns empty array when no entities are near', () => {
      const dxf = parseDxf(makeDxf(lineEntity(0, 0, 100, 0)));
      const snaps = findSnapPoints(dxf, { x: 1000, y: 1000 }, 5);
      expect(snaps).toHaveLength(0);
    });
  });

  describe('getBestSnap', () => {
    it('returns null for empty array', () => {
      expect(getBestSnap([])).toBeNull();
    });

    it('prioritizes endpoint over midpoint', () => {
      const snaps = [
        { x: 10, y: 0, type: 'midpoint' as const },
        { x: 0, y: 0, type: 'endpoint' as const },
      ];
      const best = getBestSnap(snaps);
      expect(best?.type).toBe('endpoint');
    });

    it('prioritizes center over nearest', () => {
      const snaps = [
        { x: 10, y: 0, type: 'nearest' as const },
        { x: 50, y: 50, type: 'center' as const },
      ];
      const best = getBestSnap(snaps);
      expect(best?.type).toBe('center');
    });
  });

  describe('findIntersections', () => {
    it('finds intersection of two crossing lines', () => {
      const entities = [lineEntity(0, 0, 100, 100), lineEntity(100, 0, 0, 100)].join('\n');
      const dxf = parseDxf(makeDxf(entities));
      const intersections = findIntersections(dxf, { x: 50, y: 50 }, 10);
      expect(intersections.length).toBe(1);
      expect(intersections[0].x).toBeCloseTo(50, 0);
      expect(intersections[0].y).toBeCloseTo(50, 0);
    });

    it('returns empty for parallel lines', () => {
      const entities = [lineEntity(0, 0, 100, 0), lineEntity(0, 10, 100, 10)].join('\n');
      const dxf = parseDxf(makeDxf(entities));
      const intersections = findIntersections(dxf, { x: 50, y: 5 }, 20);
      expect(intersections).toHaveLength(0);
    });
  });

  describe('getEntitySnapPoints', () => {
    it('returns snap points for a circle entity', () => {
      const entity = { type: 'CIRCLE', center: { x: 10, y: 20 }, radius: 5, layer: '0' };
      const snaps = getEntitySnapPoints(entity, 0);
      // Should have center + 4 quadrant points
      expect(snaps.length).toBe(5);
      expect(snaps.some(s => s.type === 'center')).toBe(true);
      expect(snaps.filter(s => s.type === 'endpoint').length).toBe(4);
    });
  });
});
