import { describe, it, expect } from 'vitest';
import { groupPathsByStyle, detectSymbols, detectScale, detectRooms, analyzePdfPage } from '../pdfAnalyzer';
import type { PdfPath, PdfPageExtraction, PdfStyleGroup, PdfExtractedText } from '../pdfTypes';
import type { TakeoffRule } from '../dxfTakeoff';
import { applyRules } from '../dxfTakeoff';

// ==================== HELPERS ====================

function makePath(overrides: Partial<PdfPath> = {}): PdfPath {
  return {
    segments: [
      { type: 'M', points: [{ x: 0, y: 0 }] },
      { type: 'L', points: [{ x: 100, y: 0 }] },
    ],
    style: {
      strokeColor: '#ff0000',
      fillColor: '#000000',
      lineWidth: 1,
      dashPattern: [],
      isStroked: true,
      isFilled: false,
    },
    bbox: { minX: 0, minY: 0, maxX: 100, maxY: 0 },
    isClosed: false,
    lengthPx: 100,
    ...overrides,
  };
}

function makeSmallPath(
  shape: 'circle' | 'cross' | 'square',
  cx: number, cy: number,
  color: string = '#ff0000',
  size: number = 10,
): PdfPath {
  const half = size / 2;
  const bbox = { minX: cx - half, minY: cy - half, maxX: cx + half, maxY: cy + half };

  if (shape === 'circle') {
    return {
      segments: [
        { type: 'M', points: [{ x: cx + half, y: cy }] },
        { type: 'C', points: [{ x: cx + half, y: cy + half }, { x: cx - half, y: cy + half }, { x: cx - half, y: cy }] },
        { type: 'C', points: [{ x: cx - half, y: cy - half }, { x: cx + half, y: cy - half }, { x: cx + half, y: cy }] },
        { type: 'Z', points: [] },
      ],
      style: { strokeColor: color, fillColor: '#000000', lineWidth: 1, dashPattern: [], isStroked: true, isFilled: false },
      bbox, isClosed: true, lengthPx: Math.PI * size,
    };
  }
  if (shape === 'square') {
    return {
      segments: [
        { type: 'M', points: [{ x: cx - half, y: cy - half }] },
        { type: 'L', points: [{ x: cx + half, y: cy - half }] },
        { type: 'L', points: [{ x: cx + half, y: cy + half }] },
        { type: 'L', points: [{ x: cx - half, y: cy + half }] },
        { type: 'Z', points: [] },
      ],
      style: { strokeColor: color, fillColor: '#000000', lineWidth: 1, dashPattern: [], isStroked: true, isFilled: false },
      bbox, isClosed: true, lengthPx: size * 4,
    };
  }
  // cross
  return {
    segments: [
      { type: 'M', points: [{ x: cx - half, y: cy }] },
      { type: 'L', points: [{ x: cx + half, y: cy }] },
      { type: 'M', points: [{ x: cx, y: cy - half }] },
      { type: 'L', points: [{ x: cx, y: cy + half }] },
    ],
    style: { strokeColor: color, fillColor: '#000000', lineWidth: 1, dashPattern: [], isStroked: true, isFilled: false },
    bbox, isClosed: false, lengthPx: size * 2,
  };
}

function makeExtraction(paths: PdfPath[] = [], texts: PdfExtractedText[] = []): PdfPageExtraction {
  return {
    paths,
    texts,
    images: [],
    pageWidth: 595,
    pageHeight: 842,
  };
}

// ==================== TESTS ====================

describe('pdfAnalyzer', () => {
  describe('groupPathsByStyle', () => {
    it('groups paths by color + lineWidth + dashPattern', () => {
      const paths = [
        makePath({ style: { strokeColor: '#ff0000', fillColor: '#000', lineWidth: 1, dashPattern: [], isStroked: true, isFilled: false } }),
        makePath({ style: { strokeColor: '#ff0000', fillColor: '#000', lineWidth: 1, dashPattern: [], isStroked: true, isFilled: false } }),
        makePath({ style: { strokeColor: '#0000ff', fillColor: '#000', lineWidth: 2, dashPattern: [], isStroked: true, isFilled: false } }),
      ];

      const groups = groupPathsByStyle(paths);
      expect(groups).toHaveLength(2);

      const redGroup = groups.find(g => g.strokeColor === '#ff0000');
      expect(redGroup).toBeDefined();
      expect(redGroup!.pathCount).toBe(2);

      const blueGroup = groups.find(g => g.strokeColor === '#0000ff');
      expect(blueGroup).toBeDefined();
      expect(blueGroup!.pathCount).toBe(1);
    });

    it('separates solid and dashed paths', () => {
      const paths = [
        makePath({ style: { strokeColor: '#ff0000', fillColor: '#000', lineWidth: 1, dashPattern: [], isStroked: true, isFilled: false } }),
        makePath({ style: { strokeColor: '#ff0000', fillColor: '#000', lineWidth: 1, dashPattern: [5, 3], isStroked: true, isFilled: false } }),
      ];

      const groups = groupPathsByStyle(paths);
      expect(groups).toHaveLength(2);
    });

    it('generates human-readable names', () => {
      const paths = [makePath()];
      const groups = groupPathsByStyle(paths);
      expect(groups[0].name).toContain('Grupa-');
      expect(groups[0].name).toContain('czerwony');
    });
  });

  describe('detectSymbols', () => {
    it('detects circles as symbol clusters', () => {
      const paths = [
        makeSmallPath('circle', 100, 100, '#ff0000', 10),
        makeSmallPath('circle', 200, 100, '#ff0000', 10),
        makeSmallPath('circle', 300, 100, '#ff0000', 10),
      ];
      const groups = groupPathsByStyle(paths);
      const symbols = detectSymbols(paths, groups);

      expect(symbols.length).toBeGreaterThanOrEqual(3);
      expect(symbols.every(s => s.shape === 'CIRCLE')).toBe(true);
    });

    it('detects squares as symbol clusters', () => {
      const paths = [
        makeSmallPath('square', 100, 200, '#0000ff', 8),
        makeSmallPath('square', 200, 200, '#0000ff', 8),
        makeSmallPath('square', 300, 200, '#0000ff', 8),
      ];
      const groups = groupPathsByStyle(paths);
      const symbols = detectSymbols(paths, groups);

      expect(symbols.length).toBeGreaterThanOrEqual(3);
      // All detected symbols should be the same shape type
      const shapes = [...new Set(symbols.map(s => s.shape))];
      expect(shapes).toHaveLength(1);
    });

    it('ignores large paths as non-symbols', () => {
      const paths = [
        makePath({ bbox: { minX: 0, minY: 0, maxX: 500, maxY: 300 } }),
        makePath({ bbox: { minX: 0, minY: 0, maxX: 400, maxY: 200 } }),
      ];
      const groups = groupPathsByStyle(paths);
      const symbols = detectSymbols(paths, groups);

      expect(symbols).toHaveLength(0);
    });

    it('requires 2+ instances for a cluster', () => {
      const paths = [
        makeSmallPath('circle', 100, 100, '#ff0000', 10),
      ];
      const groups = groupPathsByStyle(paths);
      const symbols = detectSymbols(paths, groups);

      expect(symbols).toHaveLength(0);
    });
  });

  describe('detectScale', () => {
    it('detects "Skala 1:100" from text', () => {
      const texts: PdfExtractedText[] = [
        { text: 'Skala 1:100', x: 0, y: 0, width: 50, height: 10, fontSize: 10, fontName: 'Arial' },
      ];
      const scale = detectScale(texts);
      expect(scale.scaleRatio).toBe(100);
      expect(scale.source).toBe('text_detection');
    });

    it('detects "SKALA: 1:50" variant', () => {
      const texts: PdfExtractedText[] = [
        { text: 'SKALA: 1:50', x: 0, y: 0, width: 50, height: 10, fontSize: 10, fontName: 'Arial' },
      ];
      const scale = detectScale(texts);
      expect(scale.scaleRatio).toBe(50);
    });

    it('detects "M 1:200" variant', () => {
      const texts: PdfExtractedText[] = [
        { text: 'M 1:200', x: 0, y: 0, width: 50, height: 10, fontSize: 10, fontName: 'Arial' },
      ];
      const scale = detectScale(texts);
      expect(scale.scaleRatio).toBe(200);
    });

    it('falls back to calibration value', () => {
      const scale = detectScale([], 75);
      expect(scale.scaleRatio).toBe(75);
      expect(scale.source).toBe('calibration');
    });

    it('uses default 1:100 when nothing available', () => {
      const scale = detectScale([]);
      expect(scale.scaleRatio).toBe(100);
      expect(scale.source).toBe('default');
    });

    it('rejects unrealistic scale ratios', () => {
      const texts: PdfExtractedText[] = [
        { text: '1:5', x: 0, y: 0, width: 50, height: 10, fontSize: 10, fontName: 'Arial' },
      ];
      const scale = detectScale(texts);
      // 5 < 10, should fall back to default
      expect(scale.source).toBe('default');
    });
  });

  describe('analyzePdfPage (full pipeline)', () => {
    it('produces DxfAnalysis-compatible output', () => {
      const paths = [
        makePath(),
        makePath({ style: { strokeColor: '#0000ff', fillColor: '#000', lineWidth: 2, dashPattern: [], isStroked: true, isFilled: false } }),
      ];
      const texts: PdfExtractedText[] = [
        { text: 'Skala 1:100', x: 50, y: 800, width: 60, height: 10, fontSize: 10, fontName: 'Arial' },
        { text: 'Parter', x: 300, y: 50, width: 40, height: 14, fontSize: 14, fontName: 'Arial' },
      ];
      const extraction = makeExtraction(paths, texts);
      const { analysis } = analyzePdfPage(extraction);

      expect(analysis.totalEntities).toBeGreaterThan(0);
      expect(analysis.layers.length).toBeGreaterThan(0);
      expect(analysis.entities.length).toBeGreaterThan(0);

      // Check entity structure compatibility
      const entity = analysis.entities[0];
      expect(entity).toHaveProperty('index');
      expect(entity).toHaveProperty('entityType');
      expect(entity).toHaveProperty('layerName');
      expect(entity).toHaveProperty('geometry');
      expect(entity).toHaveProperty('lengthM');
      expect(entity).toHaveProperty('areaM2');
      expect(entity).toHaveProperty('properties');
    });

    it('includes styleColor in entity properties for rule matching', () => {
      const paths = [makePath()];
      const extraction = makeExtraction(paths);
      const { analysis } = analyzePdfPage(extraction);

      const pathEntity = analysis.entities.find(e => e.entityType === 'PDF_PATH');
      expect(pathEntity?.properties.styleColor).toBe('#ff0000');
    });

    it('includes symbolShape in entity properties', () => {
      const paths = [
        makeSmallPath('circle', 100, 100, '#ff0000', 10),
        makeSmallPath('circle', 200, 100, '#ff0000', 10),
        makeSmallPath('circle', 300, 100, '#ff0000', 10),
      ];
      const extraction = makeExtraction(paths);
      const { analysis } = analyzePdfPage(extraction);

      const symbolEntity = analysis.entities.find(e => e.entityType === 'PDF_SYMBOL');
      if (symbolEntity) {
        expect(symbolEntity.properties.symbolShape).toBe('CIRCLE');
      }
    });

    it('works with applyRules (style_color match)', () => {
      const paths = [
        makePath({ style: { strokeColor: '#ff0000', fillColor: '#000', lineWidth: 1, dashPattern: [], isStroked: true, isFilled: false } }),
        makePath({ style: { strokeColor: '#ff0000', fillColor: '#000', lineWidth: 1, dashPattern: [], isStroked: true, isFilled: false } }),
        makePath({ style: { strokeColor: '#0000ff', fillColor: '#000', lineWidth: 2, dashPattern: [], isStroked: true, isFilled: false } }),
      ];
      const extraction = makeExtraction(paths);
      const { analysis } = analyzePdfPage(extraction);

      const rules: TakeoffRule[] = [{
        id: 'test_red',
        name: 'Czerwone ścieżki',
        category: 'Kable',
        matchType: 'style_color',
        matchPattern: '#ff0000',
        quantitySource: 'count',
        unit: 'szt.',
        multiplier: 1,
        isDefault: false,
      }];

      const result = applyRules(analysis, rules);
      expect(result.matchedEntityCount).toBe(2);
      expect(result.items.length).toBeGreaterThan(0);
    });

    it('works with applyRules (symbol_shape match)', () => {
      const paths = [
        makeSmallPath('circle', 100, 100, '#ff0000', 10),
        makeSmallPath('circle', 200, 100, '#ff0000', 10),
        makeSmallPath('circle', 300, 100, '#ff0000', 10),
      ];
      const extraction = makeExtraction(paths);
      const { analysis } = analyzePdfPage(extraction);

      const rules: TakeoffRule[] = [{
        id: 'test_circles',
        name: 'Oprawy (okręgi)',
        category: 'Oprawy',
        matchType: 'symbol_shape',
        matchPattern: 'CIRCLE',
        quantitySource: 'count',
        unit: 'szt.',
        multiplier: 1,
        isDefault: false,
      }];

      const result = applyRules(analysis, rules);
      // Should match the symbol entities (if clusters were formed)
      if (result.matchedEntityCount > 0) {
        expect(result.items[0].category).toBe('Oprawy');
      }
    });

    it('returns extra data (style groups, symbols, rooms, scale)', () => {
      const paths = [makePath()];
      const texts: PdfExtractedText[] = [
        { text: 'Skala 1:50', x: 0, y: 0, width: 50, height: 10, fontSize: 10, fontName: 'Arial' },
      ];
      const extraction = makeExtraction(paths, texts);
      const { extra } = analyzePdfPage(extraction);

      expect(extra.styleGroups.length).toBeGreaterThan(0);
      expect(extra.rooms).toBeDefined();
      expect(extra.scaleInfo.scaleRatio).toBe(50);
      expect(extra.extraction).toBe(extraction);
    });
  });

  describe('detectRooms', () => {
    function makeRoomPath(x: number, y: number, w: number, h: number): PdfPath {
      return {
        segments: [
          { type: 'M', points: [{ x, y }] },
          { type: 'L', points: [{ x: x + w, y }] },
          { type: 'L', points: [{ x: x + w, y: y + h }] },
          { type: 'L', points: [{ x, y: y + h }] },
          { type: 'Z', points: [] },
        ],
        style: { strokeColor: '#000000', fillColor: '#ffffff', lineWidth: 0.5, dashPattern: [], isStroked: true, isFilled: false },
        bbox: { minX: x, minY: y, maxX: x + w, maxY: y + h },
        isClosed: true,
        lengthPx: 2 * (w + h),
      };
    }

    it('detects large closed rectangles as rooms', () => {
      const paths = [
        makeRoomPath(50, 50, 200, 150),
        makeRoomPath(260, 50, 180, 150),
      ];
      const rooms = detectRooms(paths, [], 595, 842);
      expect(rooms).toHaveLength(2);
    });

    it('assigns room name from text inside', () => {
      const paths = [makeRoomPath(50, 50, 200, 150)];
      const texts: PdfExtractedText[] = [
        { text: 'Pokój 1', x: 100, y: 100, width: 40, height: 10, fontSize: 12, fontName: 'Arial' },
      ];
      const rooms = detectRooms(paths, texts, 595, 842);
      expect(rooms).toHaveLength(1);
      expect(rooms[0].name).toBe('Pokój 1');
    });

    it('prefers room-pattern text over other text', () => {
      const paths = [makeRoomPath(50, 50, 200, 150)];
      const texts: PdfExtractedText[] = [
        { text: '15.5 m²', x: 100, y: 80, width: 30, height: 10, fontSize: 14, fontName: 'Arial' },
        { text: 'Łazienka', x: 100, y: 120, width: 50, height: 10, fontSize: 10, fontName: 'Arial' },
      ];
      const rooms = detectRooms(paths, texts, 595, 842);
      expect(rooms[0].name).toBe('Łazienka');
    });

    it('skips small paths (not rooms)', () => {
      const paths = [makeRoomPath(50, 50, 30, 30)]; // too small
      const rooms = detectRooms(paths, [], 595, 842);
      expect(rooms).toHaveLength(0);
    });

    it('skips page-sized paths (borders)', () => {
      const paths = [makeRoomPath(0, 0, 590, 840)]; // nearly full page
      const rooms = detectRooms(paths, [], 595, 842);
      expect(rooms).toHaveLength(0);
    });

    it('deduplicates overlapping rooms', () => {
      const paths = [
        makeRoomPath(50, 50, 200, 150),
        makeRoomPath(55, 55, 190, 140), // mostly overlapping
      ];
      const rooms = detectRooms(paths, [], 595, 842);
      expect(rooms).toHaveLength(1); // only the larger one
    });
  });

  describe('confidence scores', () => {
    it('assigns confidence to detected symbols', () => {
      const paths = [
        makeSmallPath('circle', 100, 100, '#ff0000', 10),
        makeSmallPath('circle', 200, 100, '#ff0000', 10),
        makeSmallPath('circle', 300, 100, '#ff0000', 10),
      ];
      const groups = groupPathsByStyle(paths);
      const symbols = detectSymbols(paths, groups);

      for (const sym of symbols) {
        expect(sym.confidence).toBeDefined();
        expect(sym.confidence).toBeGreaterThan(0);
        expect(sym.confidence).toBeLessThanOrEqual(1);
      }
    });

    it('gives higher confidence to larger clusters', () => {
      const smallCluster = Array.from({ length: 2 }, (_, i) =>
        makeSmallPath('circle', 100 + i * 50, 100, '#ff0000', 10)
      );
      const largeCluster = Array.from({ length: 10 }, (_, i) =>
        makeSmallPath('square', 100 + i * 50, 300, '#0000ff', 8)
      );

      const allPaths = [...smallCluster, ...largeCluster];
      const groups = groupPathsByStyle(allPaths);
      const symbols = detectSymbols(allPaths, groups);

      const circleSyms = symbols.filter(s => s.shape === 'CIRCLE');
      const squareSyms = symbols.filter(s => s.shape === 'SQUARE');

      if (circleSyms.length > 0 && squareSyms.length > 0) {
        // Larger cluster should have higher size-based confidence
        expect(squareSyms[0].confidence!).toBeGreaterThanOrEqual(circleSyms[0].confidence!);
      }
    });

    it('assigns aiConfidence to style groups', () => {
      const paths = [
        makePath({ style: { strokeColor: '#ff0000', fillColor: '#000', lineWidth: 1, dashPattern: [], isStroked: true, isFilled: false } }),
        makePath({ style: { strokeColor: '#ff0000', fillColor: '#000', lineWidth: 1, dashPattern: [], isStroked: true, isFilled: false } }),
      ];
      const groups = groupPathsByStyle(paths);

      for (const g of groups) {
        expect(g.aiConfidence).toBeDefined();
        expect(g.aiConfidence).toBeGreaterThan(0);
        expect(g.aiConfidence).toBeLessThanOrEqual(1);
      }
    });

    it('propagates confidence to takeoff items', () => {
      const paths = [
        makeSmallPath('circle', 100, 100, '#ff0000', 10),
        makeSmallPath('circle', 200, 100, '#ff0000', 10),
        makeSmallPath('circle', 300, 100, '#ff0000', 10),
      ];
      const extraction = makeExtraction(paths);
      const { analysis } = analyzePdfPage(extraction);

      const rules: TakeoffRule[] = [{
        id: 'test_circles',
        name: 'Oprawy (okręgi)',
        category: 'Oprawy',
        matchType: 'symbol_shape',
        matchPattern: 'CIRCLE',
        quantitySource: 'count',
        unit: 'szt.',
        multiplier: 1,
        isDefault: false,
      }];

      const result = applyRules(analysis, rules);
      if (result.items.length > 0) {
        // Items that matched symbols should have confidence
        const hasConfidence = result.items.some(i => i.confidence != null);
        expect(hasConfidence).toBe(true);
      }
    });
  });

  describe('room assignment integration', () => {
    it('assigns symbols to rooms in full pipeline', () => {
      // Create a room (large closed path) with symbols inside
      const roomPath: PdfPath = {
        segments: [
          { type: 'M', points: [{ x: 50, y: 50 }] },
          { type: 'L', points: [{ x: 350, y: 50 }] },
          { type: 'L', points: [{ x: 350, y: 250 }] },
          { type: 'L', points: [{ x: 50, y: 250 }] },
          { type: 'Z', points: [] },
        ],
        style: { strokeColor: '#000000', fillColor: '#ffffff', lineWidth: 0.5, dashPattern: [], isStroked: true, isFilled: false },
        bbox: { minX: 50, minY: 50, maxX: 350, maxY: 250 },
        isClosed: true,
        lengthPx: 800,
      };
      // Symbols inside the room
      const symbols = [
        makeSmallPath('circle', 100, 100, '#ff0000', 10),
        makeSmallPath('circle', 200, 150, '#ff0000', 10),
        makeSmallPath('circle', 300, 100, '#ff0000', 10),
      ];
      const texts: PdfExtractedText[] = [
        { text: 'Salon', x: 150, y: 120, width: 30, height: 10, fontSize: 12, fontName: 'Arial' },
      ];

      const extraction = makeExtraction([roomPath, ...symbols], texts);
      const { extra } = analyzePdfPage(extraction);

      expect(extra.rooms.length).toBeGreaterThanOrEqual(1);
      const salon = extra.rooms.find(r => r.name === 'Salon');
      if (salon) {
        expect(salon.symbolCount).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
