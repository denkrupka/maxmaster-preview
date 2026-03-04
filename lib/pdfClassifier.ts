/**
 * PDF Classifier — Classify PDF pages as vector/raster/mixed
 * by scanning the OperatorList from pdf.js
 */
import { OPS } from 'pdfjs-dist';
import type { PDFPageProxy, PDFDocumentProxy } from 'pdfjs-dist';
import type { PdfClassification } from './pdfTypes';

const VECTOR_OPS = new Set([
  OPS.moveTo, OPS.lineTo, OPS.curveTo, OPS.curveTo2, OPS.curveTo3,
  OPS.closePath, OPS.rectangle,
  OPS.stroke, OPS.closeStroke, OPS.fill, OPS.eoFill,
  OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke,
  OPS.constructPath,
]);

const RASTER_OPS = new Set([
  OPS.paintImageXObject, OPS.paintImageMaskXObject,
  OPS.paintInlineImageXObject, OPS.paintImageXObjectRepeat,
  OPS.paintImageMaskXObjectRepeat, OPS.paintInlineImageXObjectGroup,
  OPS.paintImageMaskXObjectGroup,
]);

const TEXT_OPS = new Set([
  OPS.showText, OPS.showSpacedText,
  OPS.nextLineShowText, OPS.nextLineSetSpacingShowText,
]);

/** Classify a single PDF page */
export async function classifyPdfPage(page: PDFPageProxy): Promise<PdfClassification> {
  const opList = await page.getOperatorList();
  let vectorCount = 0;
  let rasterCount = 0;
  let textCount = 0;

  for (const fn of opList.fnArray) {
    if (VECTOR_OPS.has(fn)) vectorCount++;
    else if (RASTER_OPS.has(fn)) rasterCount++;
    else if (TEXT_OPS.has(fn)) textCount++;
  }

  let contentType: PdfClassification['contentType'];
  let confidence: number;

  if (rasterCount > 0 && vectorCount < 50) {
    contentType = 'raster';
    confidence = rasterCount > 5 ? 0.95 : 0.7;
  } else if (vectorCount > 100 && rasterCount === 0) {
    contentType = 'vector';
    confidence = vectorCount > 500 ? 0.95 : 0.8;
  } else if (vectorCount > 100 && rasterCount > 0) {
    contentType = 'mixed';
    confidence = 0.7;
  } else if (rasterCount > 0) {
    contentType = 'raster';
    confidence = 0.6;
  } else {
    contentType = 'vector';
    confidence = vectorCount > 20 ? 0.7 : 0.5;
  }

  return { contentType, vectorOpCount: vectorCount, rasterOpCount: rasterCount, textOpCount: textCount, confidence };
}

/** Classify entire PDF document (uses first page by default) */
export async function classifyPdf(
  pdfDoc: PDFDocumentProxy,
  samplePages?: number[]
): Promise<PdfClassification> {
  const pages = samplePages || [1];
  let totalVector = 0, totalRaster = 0, totalText = 0;

  for (const pageNum of pages) {
    if (pageNum < 1 || pageNum > pdfDoc.numPages) continue;
    const page = await pdfDoc.getPage(pageNum);
    const result = await classifyPdfPage(page);
    totalVector += result.vectorOpCount;
    totalRaster += result.rasterOpCount;
    totalText += result.textOpCount;
  }

  let contentType: PdfClassification['contentType'];
  let confidence: number;

  if (totalRaster > 0 && totalVector < 50) {
    contentType = 'raster';
    confidence = totalRaster > 5 ? 0.95 : 0.7;
  } else if (totalVector > 100 && totalRaster === 0) {
    contentType = 'vector';
    confidence = totalVector > 500 ? 0.95 : 0.8;
  } else if (totalVector > 100 && totalRaster > 0) {
    contentType = 'mixed';
    confidence = 0.7;
  } else if (totalRaster > 0) {
    contentType = 'raster';
    confidence = 0.6;
  } else {
    contentType = 'vector';
    confidence = totalVector > 20 ? 0.7 : 0.5;
  }

  return { contentType, vectorOpCount: totalVector, rasterOpCount: totalRaster, textOpCount: totalText, confidence };
}
