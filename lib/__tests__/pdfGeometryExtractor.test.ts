import { describe, it, expect, vi } from 'vitest';

// Mock pdfjs-dist with OPS constants
vi.mock('pdfjs-dist', () => ({
  OPS: {
    save: 10, restore: 11, transform: 12,
    moveTo: 13, lineTo: 14, curveTo: 15, curveTo2: 16, curveTo3: 17,
    closePath: 18, rectangle: 19,
    stroke: 20, closeStroke: 21, fill: 22, eoFill: 23,
    fillStroke: 24, eoFillStroke: 25, closeFillStroke: 26, closeEOFillStroke: 27,
    endPath: 28,
    setStrokeRGBColor: 58, setFillRGBColor: 59,
    setStrokeGray: 56, setFillGray: 57,
    setStrokeCMYKColor: 60, setFillCMYKColor: 61,
    setLineWidth: 1, setDash: 5,
    constructPath: 91,
    paintImageXObject: 85, paintImageMaskXObject: 83, paintInlineImageXObject: 86,
  },
}));

import { extractPageGeometry } from '../pdfGeometryExtractor';

function mockPage(fnArray: number[], argsArray: any[][], texts: any[] = []) {
  return {
    getViewport: () => ({
      width: 595,
      height: 842,
      transform: [1, 0, 0, -1, 0, 842], // standard A4 viewport transform
    }),
    getOperatorList: async () => ({ fnArray, argsArray }),
    getTextContent: async () => ({
      items: texts.map(t => ({
        str: t.text,
        transform: [t.fontSize || 12, 0, 0, t.fontSize || 12, t.x || 0, t.y || 0],
        width: t.width || 50,
        height: t.height || 12,
        fontName: t.fontName || 'Arial',
      })),
    }),
  } as any;
}

describe('pdfGeometryExtractor', () => {
  const OPS = {
    save: 10, restore: 11, transform: 12,
    moveTo: 13, lineTo: 14, curveTo: 15,
    closePath: 18, rectangle: 19,
    stroke: 20, fill: 22, fillStroke: 24, endPath: 28,
    setStrokeRGBColor: 58, setFillRGBColor: 59,
    setStrokeGray: 56, setFillGray: 57,
    setStrokeCMYKColor: 60, setFillCMYKColor: 61,
    setLineWidth: 1, setDash: 5,
    constructPath: 91,
    paintImageXObject: 85,
  };

  it('extracts a simple line path', async () => {
    const fns = [OPS.moveTo, OPS.lineTo, OPS.stroke];
    const args = [[10, 20], [100, 20], []];
    const result = await extractPageGeometry(mockPage(fns, args));

    expect(result.paths).toHaveLength(1);
    expect(result.paths[0].segments).toHaveLength(2); // M + L
    expect(result.paths[0].style.isStroked).toBe(true);
    expect(result.paths[0].style.isFilled).toBe(false);
  });

  it('tracks graphics state save/restore', async () => {
    const fns = [
      OPS.setStrokeRGBColor,
      OPS.save,
      OPS.setStrokeRGBColor,
      OPS.moveTo, OPS.lineTo, OPS.stroke,
      OPS.restore,
      OPS.moveTo, OPS.lineTo, OPS.stroke,
    ];
    const args = [
      [1, 0, 0],       // red
      [],
      [0, 0, 1],       // blue
      [10, 10], [50, 10], [],
      [],
      [60, 10], [100, 10], [],
    ];
    const result = await extractPageGeometry(mockPage(fns, args));

    expect(result.paths).toHaveLength(2);
    expect(result.paths[0].style.strokeColor).toBe('#0000ff'); // blue (inside save)
    expect(result.paths[1].style.strokeColor).toBe('#ff0000'); // red (after restore)
  });

  it('normalizes RGB colors to hex', async () => {
    const fns = [OPS.setStrokeRGBColor, OPS.moveTo, OPS.lineTo, OPS.stroke];
    const args = [[0.5, 0.25, 0.75], [0, 0], [10, 0], []];
    const result = await extractPageGeometry(mockPage(fns, args));

    expect(result.paths[0].style.strokeColor).toBe('#8040bf');
  });

  it('normalizes gray to hex', async () => {
    const fns = [OPS.setStrokeGray, OPS.moveTo, OPS.lineTo, OPS.stroke];
    const args = [[0.5], [0, 0], [10, 0], []];
    const result = await extractPageGeometry(mockPage(fns, args));

    expect(result.paths[0].style.strokeColor).toBe('#808080');
  });

  it('normalizes CMYK to hex', async () => {
    // CMYK (0,0,0,0) = white
    const fns = [OPS.setStrokeCMYKColor, OPS.moveTo, OPS.lineTo, OPS.stroke];
    const args = [[0, 0, 0, 0], [0, 0], [10, 0], []];
    const result = await extractPageGeometry(mockPage(fns, args));

    expect(result.paths[0].style.strokeColor).toBe('#ffffff');
  });

  it('handles fill operations', async () => {
    const fns = [OPS.moveTo, OPS.lineTo, OPS.lineTo, OPS.closePath, OPS.fill];
    const args = [[0, 0], [10, 0], [5, 10], [], []];
    const result = await extractPageGeometry(mockPage(fns, args));

    expect(result.paths).toHaveLength(1);
    expect(result.paths[0].style.isFilled).toBe(true);
    expect(result.paths[0].style.isStroked).toBe(false);
    expect(result.paths[0].isClosed).toBe(true);
  });

  it('handles rectangle operator', async () => {
    const fns = [OPS.rectangle, OPS.stroke];
    const args = [[10, 20, 100, 50], []];
    const result = await extractPageGeometry(mockPage(fns, args));

    expect(result.paths).toHaveLength(1);
    // Rectangle creates M + L + L + L + Z = 5 segments
    expect(result.paths[0].segments).toHaveLength(5);
    expect(result.paths[0].isClosed).toBe(true);
  });

  it('handles constructPath batch operations', async () => {
    // constructPath packs multiple ops and coords
    const subOps = [13, 14, 14, 18]; // moveTo, lineTo, lineTo, closePath
    const coords = [0, 0, 10, 0, 10, 10];
    const fns = [OPS.constructPath, OPS.stroke];
    const args = [[subOps, coords], []];
    const result = await extractPageGeometry(mockPage(fns, args));

    expect(result.paths).toHaveLength(1);
    expect(result.paths[0].segments.length).toBeGreaterThanOrEqual(3);
  });

  it('tracks line width and dash pattern', async () => {
    const fns = [OPS.setLineWidth, OPS.setDash, OPS.moveTo, OPS.lineTo, OPS.stroke];
    const args = [[2.5], [[5, 3], 0], [0, 0], [100, 0], []];
    const result = await extractPageGeometry(mockPage(fns, args));

    expect(result.paths[0].style.lineWidth).toBe(2.5);
    expect(result.paths[0].style.dashPattern).toEqual([5, 3]);
  });

  it('discards path on endPath', async () => {
    const fns = [OPS.moveTo, OPS.lineTo, OPS.endPath];
    const args = [[0, 0], [100, 0], []];
    const result = await extractPageGeometry(mockPage(fns, args));

    expect(result.paths).toHaveLength(0);
  });

  it('extracts text items', async () => {
    const texts = [
      { text: 'Skala 1:100', x: 50, y: 800, fontSize: 12 },
      { text: 'Parter', x: 300, y: 50, fontSize: 18 },
    ];
    const result = await extractPageGeometry(mockPage([], [], texts));

    expect(result.texts).toHaveLength(2);
    expect(result.texts[0].text).toBe('Skala 1:100');
    expect(result.texts[1].text).toBe('Parter');
  });

  it('records image placements', async () => {
    const fns = [OPS.paintImageXObject];
    const args = [['img_001']];
    const result = await extractPageGeometry(mockPage(fns, args));

    expect(result.images).toHaveLength(1);
    expect(result.images[0].objectName).toBe('img_001');
  });

  it('returns page dimensions', async () => {
    const result = await extractPageGeometry(mockPage([], []));
    expect(result.pageWidth).toBe(595);
    expect(result.pageHeight).toBe(842);
  });

  it('computes path length', async () => {
    const fns = [OPS.moveTo, OPS.lineTo, OPS.stroke];
    const args = [[0, 0], [100, 0], []]; // 100px horizontal line
    const result = await extractPageGeometry(mockPage(fns, args));

    expect(result.paths[0].lengthPx).toBeGreaterThan(0);
  });
});
