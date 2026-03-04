import React from 'react';
import { X, Eye, EyeOff, Crosshair } from 'lucide-react';
import type { PdfStyleGroup } from '../../lib/pdfTypes';

interface PdfStyleGroupsPanelProps {
  styleGroups: PdfStyleGroup[];
  onToggleVisibility: (groupId: string) => void;
  onSetCategory: (groupId: string, category: string) => void;
  onHighlightGroup?: (groupId: string) => void;
  onClose: () => void;
}

const CATEGORIES = [
  'Kable i przewody', 'Oprawy oświetleniowe', 'Osprzęt elektryczny',
  'Trasy kablowe', 'Tablice i rozdzielnice', 'Instalacja alarmowa',
  'Konstrukcja', 'Wymiarowanie', 'Inne',
];

export default function PdfStyleGroupsPanel({ styleGroups, onToggleVisibility, onSetCategory, onHighlightGroup, onClose }: PdfStyleGroupsPanelProps) {
  return (
    <div className="fixed right-0 top-16 bottom-0 w-80 bg-white shadow-xl border-l z-50 flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b bg-gray-50">
        <h3 className="text-sm font-semibold">Grupy stylów PDF</h3>
        <button onClick={onClose} className="p-1 hover:bg-gray-200 rounded"><X size={16} /></button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {styleGroups.length === 0 ? (
          <div className="p-4 text-center text-sm text-gray-400">Brak grup stylów</div>
        ) : (
          <div className="divide-y">
            {styleGroups.map(sg => (
              <div key={sg.id} className={`p-2.5 hover:bg-gray-50 ${!sg.visible ? 'opacity-40' : ''}`}>
                <div className="flex items-center gap-2 mb-1">
                  <button onClick={() => onToggleVisibility(sg.id)} className="p-0.5 hover:bg-gray-200 rounded" title={sg.visible ? 'Ukryj na rysunku' : 'Pokaż na rysunku'}>
                    {sg.visible ? <Eye size={14} className="text-gray-500" /> : <EyeOff size={14} className="text-gray-400" />}
                  </button>
                  <div
                    className="w-4 h-4 rounded border border-gray-300 flex-shrink-0 cursor-pointer"
                    style={{ backgroundColor: sg.strokeColor }}
                    title={`${sg.strokeColor} — kliknij aby podświetlić`}
                    onClick={() => onHighlightGroup?.(sg.id)}
                  />
                  {sg.dashPattern.length > 0 && (
                    <svg width="24" height="4" className="flex-shrink-0">
                      <line x1="0" y1="2" x2="24" y2="2" stroke={sg.strokeColor} strokeWidth={Math.min(sg.lineWidth, 3)} strokeDasharray={sg.dashPattern.slice(0, 4).join(',')} />
                    </svg>
                  )}
                  <span className="text-xs font-medium truncate flex-1">{sg.name}</span>
                  {onHighlightGroup && (
                    <button onClick={() => onHighlightGroup(sg.id)} className="p-0.5 hover:bg-blue-100 rounded" title="Podświetl na rysunku">
                      <Crosshair size={12} className="text-blue-500" />
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-6 text-[10px] text-gray-500">
                  <span>{sg.pathCount} ścieżek</span>
                  <span>|</span>
                  <span>{sg.totalLengthM > 0 ? `${sg.totalLengthM.toFixed(1)} m` : `${sg.totalLengthPx.toFixed(0)} px`}</span>
                  <span>|</span>
                  <span>{sg.lineWidth.toFixed(1)}px</span>
                  {sg.aiConfidence != null && (
                    <>
                      <span>|</span>
                      <span className={`font-medium ${sg.aiConfidence >= 0.6 ? 'text-green-600' : sg.aiConfidence >= 0.3 ? 'text-amber-600' : 'text-gray-400'}`}>
                        {Math.round(sg.aiConfidence * 100)}%
                      </span>
                    </>
                  )}
                </div>
                <div className="ml-6 mt-1">
                  <select
                    value={sg.category || ''}
                    onChange={e => onSetCategory(sg.id, e.target.value)}
                    className="text-[10px] border rounded px-1 py-0.5 w-full bg-white"
                  >
                    <option value="">— brak kategorii —</option>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t bg-gray-50 text-[10px] text-gray-400">
        {styleGroups.length} grup | {styleGroups.filter(g => g.visible).length} widocznych
      </div>
    </div>
  );
}
