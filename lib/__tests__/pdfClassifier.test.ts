import { describe, it, expect, vi } from 'vitest';

// Mock pdfjs-dist OPS
vi.mock('pdfjs-dist', () => ({
  OPS: {
    moveTo: 13, lineTo: 14, curveTo: 15, curveTo2: 16, curveTo3: 17,
    closePath: 18, rectangle: 19,
    stroke: 20, closeStroke: 21, fill: 22, eoFill: 23,
    fillStroke: 24, eoFillStroke: 25, closeFillStroke: 26, closeEOFillStroke: 27,
    constructPath: 91,
    paintImageXObject: 85, paintImageMaskXObject: 83,
    paintInlineImageXObject: 86, paintImageXObjectRepeat: 88,
    paintImageMaskXObjectRepeat: 89, paintInlineImageXObjectGroup: 87,
    paintImageMaskXObjectGroup: 84,
    showText: 44, showSpacedText: 45, nextLineShowText: 46, nextLineSetSpacingShowText: 47,
  },
}));

import { classifyPdfPage, classifyPdf } from '../pdfClassifier';

function mockPage(fnArray: number[]) {
  return {
    getOperatorList: async () => ({
      fnArray,
      argsArray: fnArray.map(() => []),
    }),
  } as any;
}

function mockPdfDoc(pages: Record<number, number[]>) {
  return {
    numPages: Object.keys(pages).length,
    getPage: async (num: number) => mockPage(pages[num] || []),
  } as any;
}

describe('pdfClassifier', () => {
  describe('classifyPdfPage', () => {
    it('classifies pure vector page', async () => {
      // 200 vector ops, 0 raster
      const ops = Array(200).fill(13); // moveTo
      const result = await classifyPdfPage(mockPage(ops));
      expect(result.contentType).toBe('vector');
      expect(result.vectorOpCount).toBe(200);
      expect(result.rasterOpCount).toBe(0);
      expect(result.confidence).toBeGreaterThan(0.7);
    });

    it('classifies pure raster page', async () => {
      // 5 raster ops, 10 vector ops (< 50)
      const ops = [...Array(10).fill(13), ...Array(5).fill(85)];
      const result = await classifyPdfPage(mockPage(ops));
      expect(result.contentType).toBe('raster');
      expect(result.rasterOpCount).toBe(5);
    });

    it('classifies mixed page', async () => {
      // 200 vector ops + 3 raster ops
      const ops = [...Array(200).fill(14), ...Array(3).fill(85)];
      const result = await classifyPdfPage(mockPage(ops));
      expect(result.contentType).toBe('mixed');
    });

    it('counts text ops', async () => {
      const ops = [...Array(50).fill(13), ...Array(10).fill(44)];
      const result = await classifyPdfPage(mockPage(ops));
      expect(result.textOpCount).toBe(10);
    });

    it('handles empty OperatorList', async () => {
      const result = await classifyPdfPage(mockPage([]));
      expect(result.contentType).toBe('vector');
      expect(result.vectorOpCount).toBe(0);
      expect(result.confidence).toBeLessThanOrEqual(0.5);
    });
  });

  describe('classifyPdf', () => {
    it('classifies using first page by default', async () => {
      const doc = mockPdfDoc({ 1: Array(300).fill(14) });
      const result = await classifyPdf(doc);
      expect(result.contentType).toBe('vector');
      expect(result.vectorOpCount).toBe(300);
    });

    it('classifies using specified sample pages', async () => {
      const doc = mockPdfDoc({
        1: Array(200).fill(14),
        2: Array(100).fill(85),
      });
      const result = await classifyPdf(doc, [1, 2]);
      expect(result.contentType).toBe('mixed');
    });

    it('skips invalid page numbers', async () => {
      const doc = mockPdfDoc({ 1: Array(200).fill(14) });
      const result = await classifyPdf(doc, [1, 99]);
      expect(result.vectorOpCount).toBe(200);
    });
  });
});
