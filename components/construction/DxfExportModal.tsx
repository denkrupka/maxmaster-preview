import React, { useState } from 'react';
import { X, Printer, Loader2 } from 'lucide-react';
import { exportDxfToPdf, downloadBlob, type DxfExportOptions } from '../../lib/dxfExport';

interface DxfExportModalProps {
  svgContent: string;
  drawingName?: string;
  onClose: () => void;
}

export default function DxfExportModal({ svgContent, drawingName, onClose }: DxfExportModalProps) {
  const [options, setOptions] = useState<DxfExportOptions>({
    paperSize: 'A3',
    orientation: 'landscape',
    scale: 'fit',
    title: drawingName || '',
    margin: 10,
    showTitle: true,
  });
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  const handleExport = async () => {
    setExporting(true);
    setError('');
    try {
      const blob = await exportDxfToPdf(svgContent, options);
      const filename = `${drawingName || 'rysunek_dxf'}.pdf`;
      downloadBlob(blob, filename);
    } catch (err: any) {
      setError(err.message || 'Błąd eksportu');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-[400px]">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-2">
            <Printer size={18} className="text-blue-600" />
            <h3 className="font-semibold">Eksport do PDF</h3>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
        </div>

        <div className="p-4 space-y-3">
          {/* Paper size */}
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Rozmiar papieru</label>
            <div className="flex gap-1">
              {(['A4', 'A3', 'A2', 'A1', 'A0'] as const).map(size => (
                <button
                  key={size}
                  onClick={() => setOptions({ ...options, paperSize: size })}
                  className={`px-3 py-1 text-xs rounded border ${options.paperSize === size ? 'bg-blue-600 text-white border-blue-600' : 'hover:bg-gray-50'}`}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>

          {/* Orientation */}
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Orientacja</label>
            <div className="flex gap-1">
              <button
                onClick={() => setOptions({ ...options, orientation: 'landscape' })}
                className={`px-3 py-1 text-xs rounded border ${options.orientation === 'landscape' ? 'bg-blue-600 text-white border-blue-600' : 'hover:bg-gray-50'}`}
              >
                Pozioma
              </button>
              <button
                onClick={() => setOptions({ ...options, orientation: 'portrait' })}
                className={`px-3 py-1 text-xs rounded border ${options.orientation === 'portrait' ? 'bg-blue-600 text-white border-blue-600' : 'hover:bg-gray-50'}`}
              >
                Pionowa
              </button>
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="flex items-center gap-1 text-xs font-medium text-gray-600 mb-1">
              <input
                type="checkbox"
                checked={options.showTitle}
                onChange={e => setOptions({ ...options, showTitle: e.target.checked })}
                className="rounded"
              />
              Tytuł
            </label>
            {options.showTitle && (
              <input
                value={options.title || ''}
                onChange={e => setOptions({ ...options, title: e.target.value })}
                className="w-full text-xs border rounded px-2 py-1"
                placeholder="Tytuł rysunku"
              />
            )}
          </div>

          {/* Margin */}
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Margines (mm)</label>
            <input
              type="number"
              min={0}
              max={50}
              value={options.margin}
              onChange={e => setOptions({ ...options, margin: parseInt(e.target.value) || 10 })}
              className="w-20 text-xs border rounded px-2 py-1"
            />
          </div>

          {error && <div className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50">Anuluj</button>
          <button onClick={handleExport} disabled={exporting} className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
            {exporting ? 'Eksportowanie...' : 'Eksportuj PDF'}
          </button>
        </div>
      </div>
    </div>
  );
}
