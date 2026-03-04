/**
 * DXF Export — Print/export DXF view to PDF via jsPDF
 */
import jsPDF from 'jspdf';

export interface DxfExportOptions {
  paperSize: 'A4' | 'A3' | 'A2' | 'A1' | 'A0';
  orientation: 'portrait' | 'landscape';
  scale: 'fit' | number; // 'fit' = auto-fit, or specific scale like 1:100
  title?: string;
  margin?: number; // mm
  showGrid?: boolean;
  showTitle?: boolean;
  backgroundColor?: string;
}

const PAPER_SIZES: Record<string, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A3: { w: 297, h: 420 },
  A2: { w: 420, h: 594 },
  A1: { w: 594, h: 841 },
  A0: { w: 841, h: 1189 },
};

/** Export an SVG element (DXF rendering) to PDF */
export async function exportDxfToPdf(
  svgContent: string,
  options: DxfExportOptions
): Promise<Blob> {
  const paper = PAPER_SIZES[options.paperSize] || PAPER_SIZES.A4;
  const isLandscape = options.orientation === 'landscape';
  const pageW = isLandscape ? paper.h : paper.w;
  const pageH = isLandscape ? paper.w : paper.h;
  const margin = options.margin ?? 10;

  const doc = new jsPDF({
    orientation: options.orientation,
    unit: 'mm',
    format: [pageW, pageH],
  });

  const drawW = pageW - margin * 2;
  const drawH = pageH - margin * 2 - (options.showTitle ? 10 : 0);

  // Add title
  if (options.showTitle && options.title) {
    doc.setFontSize(12);
    doc.text(options.title, pageW / 2, margin + 5, { align: 'center' });
  }

  const titleOffset = options.showTitle ? 12 : 0;

  // Convert SVG to image and add to PDF
  try {
    const imgData = await svgToDataUrl(svgContent, drawW * 4, drawH * 4, options.backgroundColor);
    doc.addImage(imgData, 'PNG', margin, margin + titleOffset, drawW, drawH);
  } catch {
    // Fallback: just add empty page with error text
    doc.setFontSize(10);
    doc.text('Nie udało się wyrenderować rysunku DXF', margin, margin + titleOffset + 10);
  }

  // Add border
  doc.setDrawColor(0);
  doc.setLineWidth(0.5);
  doc.rect(margin, margin + titleOffset, drawW, drawH);

  // Add footer
  doc.setFontSize(8);
  doc.setTextColor(128);
  const date = new Date().toLocaleDateString('pl-PL');
  doc.text(`Wygenerowano: ${date}`, margin, pageH - 3);
  if (options.scale !== 'fit') {
    doc.text(`Skala: 1:${options.scale}`, pageW - margin, pageH - 3, { align: 'right' });
  }

  return doc.output('blob');
}

/** Convert SVG string to data URL (PNG) using canvas */
async function svgToDataUrl(
  svgContent: string,
  width: number,
  height: number,
  bgColor?: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const svgBlob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('No canvas context')); return; }

      // Background
      ctx.fillStyle = bgColor || '#ffffff';
      ctx.fillRect(0, 0, width, height);

      // Draw SVG
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);

      resolve(canvas.toDataURL('image/png'));
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load SVG'));
    };

    img.src = url;
  });
}

/** Quick export with default settings */
export async function quickExportDxf(
  svgContent: string,
  title?: string
): Promise<Blob> {
  return exportDxfToPdf(svgContent, {
    paperSize: 'A3',
    orientation: 'landscape',
    scale: 'fit',
    title,
    showTitle: !!title,
    margin: 10,
  });
}

/** Download a blob as file */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
