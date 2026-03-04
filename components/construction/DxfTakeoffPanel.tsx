import React, { useState, useMemo } from 'react';
import { X, Download, Filter, ChevronDown, ChevronRight, Eye, CheckCircle, AlertCircle, AlertTriangle } from 'lucide-react';
import type { TakeoffItem, TakeoffResult } from '../../lib/dxfTakeoff';
import { takeoffToCsv, getUnassignedEntities } from '../../lib/dxfTakeoff';
import type { DxfAnalysis } from '../../lib/dxfAnalyzer';

interface DxfTakeoffPanelProps {
  result: TakeoffResult;
  analysis?: DxfAnalysis;
  sourceType?: 'DXF' | 'PDF';
  onItemClick: (item: TakeoffItem) => void;
  onClose: () => void;
  onOpenRules: () => void;
}

export default function DxfTakeoffPanel({ result, analysis, sourceType = 'DXF', onItemClick, onClose, onOpenRules }: DxfTakeoffPanelProps) {
  const [filterCategory, setFilterCategory] = useState<string>('');
  const [filterRoom, setFilterRoom] = useState<string>('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [showUnassigned, setShowUnassigned] = useState(false);

  const categories = useMemo(() => Object.keys(result.totalByCategory).sort(), [result]);

  const rooms = useMemo(() => {
    const roomSet = new Set<string>();
    for (const item of result.items) {
      if (item.room) roomSet.add(item.room);
    }
    return [...roomSet].sort();
  }, [result.items]);

  const filteredItems = useMemo(() => {
    let items = result.items;
    if (filterCategory) items = items.filter(i => i.category === filterCategory);
    if (filterRoom) items = items.filter(i => i.room === filterRoom);
    if (filterStatus) items = items.filter(i => i.status === filterStatus);
    return items;
  }, [result.items, filterCategory, filterRoom, filterStatus]);

  // Group by category
  const grouped = useMemo(() => {
    const map: Record<string, TakeoffItem[]> = {};
    for (const item of filteredItems) {
      if (!map[item.category]) map[item.category] = [];
      map[item.category].push(item);
    }
    return map;
  }, [filteredItems]);

  const toggleCategory = (cat: string) => {
    const next = new Set(expandedCategories);
    if (next.has(cat)) next.delete(cat); else next.add(cat);
    setExpandedCategories(next);
  };

  const handleExportCsv = () => {
    const csv = takeoffToCsv(filteredItems);
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `przedmiar_${sourceType.toLowerCase()}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Unassigned entities (styles/clusters not captured by any rule)
  const unassigned = useMemo(() => {
    if (!analysis) return [];
    return getUnassignedEntities(analysis, result.items);
  }, [analysis, result.items]);

  // Group unassigned by layer for display
  const unassignedByLayer = useMemo(() => {
    const map: Record<string, { count: number; types: Set<string>; color?: string }> = {};
    for (const e of unassigned) {
      const key = e.layerName;
      if (!map[key]) map[key] = { count: 0, types: new Set(), color: e.properties?.styleColor };
      map[key].count++;
      map[key].types.add(e.entityType);
    }
    return Object.entries(map).sort((a, b) => b[1].count - a[1].count);
  }, [unassigned]);

  const statusIcon = (status: string) => {
    switch (status) {
      case 'verified': return <CheckCircle size={12} className="text-green-500" />;
      case 'rejected': return <AlertCircle size={12} className="text-red-500" />;
      default: return null;
    }
  };

  return (
    <div className="absolute bottom-0 left-0 right-0 z-50 bg-white border-t shadow-xl max-h-[50vh] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-gray-50">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold">Przedmiar z {sourceType}</span>
          <span className="text-xs text-gray-500">
            {result.items.length} pozycji | {result.matchedEntityCount} dopasowanych | {result.unmatchedEntityCount} niedopasowanych
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onOpenRules} className="px-2 py-0.5 text-xs bg-gray-200 rounded hover:bg-gray-300">
            Reguły
          </button>
          <button onClick={handleExportCsv} className="p-1 hover:bg-gray-200 rounded" title="Eksport CSV">
            <Download size={14} />
          </button>
          <button onClick={onClose} className="p-1 hover:bg-gray-200 rounded">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 px-3 py-1 border-b text-xs">
        <Filter size={12} className="text-gray-400" />
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="text-xs border rounded px-1 py-0.5">
          <option value="">Wszystkie kategorie</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {rooms.length > 0 && (
          <select value={filterRoom} onChange={e => setFilterRoom(e.target.value)} className="text-xs border rounded px-1 py-0.5">
            <option value="">Wszystkie pomieszczenia</option>
            {rooms.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        )}
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="text-xs border rounded px-1 py-0.5">
          <option value="">Wszystkie statusy</option>
          <option value="auto">Automatyczny</option>
          <option value="manual">Ręczny</option>
          <option value="verified">Zweryfikowany</option>
          <option value="rejected">Odrzucony</option>
        </select>
      </div>

      {/* Items grouped by category */}
      <div className="overflow-y-auto flex-1">
        {Object.entries(grouped).map(([category, items]) => (
          <div key={category}>
            <button
              onClick={() => toggleCategory(category)}
              className="w-full flex items-center gap-1 px-3 py-1 bg-gray-50 hover:bg-gray-100 border-b text-xs font-medium"
            >
              {expandedCategories.has(category) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <span>{category}</span>
              <span className="text-gray-400 ml-1">({items.length})</span>
            </button>
            {expandedCategories.has(category) && (
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 text-gray-500">
                    <th className="text-left px-3 py-0.5 font-normal">Opis</th>
                    <th className="text-right px-2 py-0.5 font-normal w-20">Ilość</th>
                    <th className="text-left px-2 py-0.5 font-normal w-12">Jedn.</th>
                    <th className="text-left px-2 py-0.5 font-normal w-28">Warstwa</th>
                    <th className="text-center px-1 py-0.5 font-normal w-8"></th>
                    <th className="text-center px-1 py-0.5 font-normal w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => (
                    <tr key={item.id} className="hover:bg-blue-50 border-b border-gray-100 cursor-pointer" onClick={() => onItemClick(item)}>
                      <td className="px-3 py-1 truncate max-w-xs">
                        {item.description}
                        {item.confidence != null && (
                          <span className={`ml-1 text-[10px] ${item.confidence >= 0.6 ? 'text-green-500' : item.confidence >= 0.3 ? 'text-amber-500' : 'text-gray-400'}`}>
                            {Math.round(item.confidence * 100)}%
                          </span>
                        )}
                        {item.room && (
                          <span className="ml-1 text-[10px] text-amber-600 bg-amber-50 px-1 rounded" title={`Pomieszczenie: ${item.room}`}>
                            {item.room}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1 text-right font-mono">{item.quantity.toFixed(2)}</td>
                      <td className="px-2 py-1">{item.unit}</td>
                      <td className="px-2 py-1 text-gray-400 truncate">{item.sourceLayer}</td>
                      <td className="px-1 py-1 text-center">{statusIcon(item.status)}</td>
                      <td className="px-1 py-1 text-center">
                        <Eye size={12} className="text-gray-300 hover:text-blue-500" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
        {filteredItems.length === 0 && (
          <div className="p-8 text-center text-sm text-gray-400">
            Brak pozycji przedmiaru. Uruchom analizę i zastosuj reguły.
          </div>
        )}

        {/* Unassigned entities section */}
        {unassignedByLayer.length > 0 && (
          <div className="border-t">
            <button
              onClick={() => setShowUnassigned(!showUnassigned)}
              className="w-full flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-xs font-medium text-amber-700"
            >
              <AlertTriangle size={12} />
              {showUnassigned ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              Nieprzypisane ({unassigned.length} elementów w {unassignedByLayer.length} grupach)
            </button>
            {showUnassigned && (
              <div className="max-h-40 overflow-y-auto">
                {unassignedByLayer.map(([layer, info]) => (
                  <div key={layer} className="flex items-center gap-2 px-3 py-1 text-xs border-b border-gray-50 hover:bg-amber-50/50">
                    {info.color && (
                      <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: info.color }} />
                    )}
                    <span className="flex-1 truncate text-gray-600">{layer}</span>
                    <span className="text-gray-400">{[...info.types].join(', ')}</span>
                    <span className="font-mono text-amber-600">{info.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
