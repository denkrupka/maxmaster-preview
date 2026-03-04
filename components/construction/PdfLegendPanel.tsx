import React from 'react';
import { X, BookOpen } from 'lucide-react';
import type { PdfLegend, PdfStyleGroup } from '../../lib/pdfTypes';

interface PdfLegendPanelProps {
  legend: PdfLegend;
  styleGroups: PdfStyleGroup[];
  onApplyToGroups: (mappings: { entryLabel: string; category: string }[]) => void;
  onClose: () => void;
}

const CATEGORIES = [
  'Kable i przewody', 'Oprawy oświetleniowe', 'Osprzęt elektryczny',
  'Trasy kablowe', 'Tablice i rozdzielnice', 'Instalacja alarmowa',
  'Konstrukcja', 'Wymiarowanie', 'Inne',
];

export default function PdfLegendPanel({ legend, styleGroups, onApplyToGroups, onClose }: PdfLegendPanelProps) {
  const [mappings, setMappings] = React.useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const entry of legend.entries) {
      m[entry.label] = entry.category || '';
    }
    return m;
  });

  const handleApply = () => {
    const result = Object.entries(mappings)
      .filter(([_, cat]) => cat)
      .map(([label, category]) => ({ entryLabel: label, category }));
    onApplyToGroups(result);
  };

  return (
    <div className="fixed right-0 top-16 bottom-0 w-80 bg-white shadow-xl border-l z-50 flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b bg-gray-50">
        <div className="flex items-center gap-1.5">
          <BookOpen size={14} className="text-amber-600" />
          <h3 className="text-sm font-semibold">Legenda PDF</h3>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-gray-200 rounded"><X size={16} /></button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {legend.entries.length === 0 ? (
          <div className="p-4 text-center text-sm text-gray-400">Brak wpisów legendy</div>
        ) : (
          <div className="divide-y">
            {legend.entries.map((entry, idx) => (
              <div key={idx} className="p-2.5">
                <div className="flex items-center gap-2 mb-1">
                  {entry.sampleColor && (
                    <div className="w-3 h-3 rounded border" style={{ backgroundColor: entry.sampleColor }} />
                  )}
                  <span className="text-xs font-medium flex-1">{entry.label}</span>
                </div>
                {entry.description !== entry.label && (
                  <div className="text-[10px] text-gray-500 mb-1 ml-5">{entry.description}</div>
                )}
                <select
                  value={mappings[entry.label] || ''}
                  onChange={e => setMappings({ ...mappings, [entry.label]: e.target.value })}
                  className="text-[10px] border rounded px-1 py-0.5 w-full bg-white ml-5"
                  style={{ maxWidth: 'calc(100% - 20px)' }}
                >
                  <option value="">— przypisz kategorię —</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t bg-gray-50 flex justify-between items-center">
        <span className="text-[10px] text-gray-400">{legend.entries.length} wpisów</span>
        <button
          onClick={handleApply}
          className="px-2 py-1 text-xs bg-amber-600 text-white rounded hover:bg-amber-700"
        >
          Zastosuj do grup
        </button>
      </div>
    </div>
  );
}
