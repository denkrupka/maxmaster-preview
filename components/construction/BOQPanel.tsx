import React, { useState, useMemo } from 'react';
import {
  Download, Sparkles, AlertTriangle, ChevronDown, ChevronRight,
  Eye, Filter, Search, Loader2, X, CheckCircle, Info, Edit3,
  BarChart3, Layers, Hash, ArrowUpDown, FileWarning
} from 'lucide-react';
import type { BOQSummary, BOQItem, BOQCategory, Anomaly, MappingRule, VersionDelta } from '../../lib/apsTakeoff';
import { CATEGORY_LABELS, exportBOQtoCSV } from '../../lib/apsTakeoff';

interface BOQPanelProps {
  summary: BOQSummary | null;
  anomalies: Anomaly[];
  delta?: VersionDelta | null;
  loading: boolean;
  onGenerateRuleBased: () => void;
  onGenerateAI: () => void;
  onHighlightElements: (dbIds: number[]) => void;
  onEditRule?: (ruleId: string) => void;
  onClose: () => void;
  fileName?: string;
}

type ViewMode = 'flat' | 'byCategory' | 'byLevel';
type SortField = 'position' | 'name' | 'quantity' | 'category' | 'confidence';

export default function BOQPanel({
  summary, anomalies, delta, loading,
  onGenerateRuleBased, onGenerateAI, onHighlightElements, onEditRule, onClose, fileName,
}: BOQPanelProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('byCategory');
  const [sortField, setSortField] = useState<SortField>('position');
  const [sortAsc, setSortAsc] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
  const [showAnomalies, setShowAnomalies] = useState(true);
  const [showDelta, setShowDelta] = useState(false);
  const [filterCategory, setFilterCategory] = useState<BOQCategory | 'all'>('all');
  const [filterReview, setFilterReview] = useState(false);

  // Filtered & sorted items
  const filteredItems = useMemo(() => {
    if (!summary) return [];
    let items = [...summary.items];

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      items = items.filter(i =>
        i.name.toLowerCase().includes(q) ||
        (i.blockName || '').toLowerCase().includes(q) ||
        (i.layer || '').toLowerCase().includes(q) ||
        (i.family || '').toLowerCase().includes(q)
      );
    }
    if (filterCategory !== 'all') {
      items = items.filter(i => i.category === filterCategory);
    }
    if (filterReview) {
      items = items.filter(i => i.needsReview);
    }

    items.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'position': cmp = a.position - b.position; break;
        case 'name': cmp = a.name.localeCompare(b.name); break;
        case 'quantity': cmp = a.quantity - b.quantity; break;
        case 'category': cmp = (CATEGORY_LABELS[a.category] || '').localeCompare(CATEGORY_LABELS[b.category] || ''); break;
        case 'confidence': cmp = a.confidence - b.confidence; break;
      }
      return sortAsc ? cmp : -cmp;
    });

    return items;
  }, [summary, searchQuery, filterCategory, filterReview, sortField, sortAsc]);

  // Group by category
  const groupedByCategory = useMemo(() => {
    const groups: Record<string, BOQItem[]> = {};
    for (const item of filteredItems) {
      const cat = item.category;
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(item);
    }
    return groups;
  }, [filteredItems]);

  // Group by level
  const groupedByLevel = useMemo(() => {
    const groups: Record<string, BOQItem[]> = {};
    for (const item of filteredItems) {
      const lvl = item.level || 'Brak poziomu';
      if (!groups[lvl]) groups[lvl] = [];
      groups[lvl].push(item);
    }
    return groups;
  }, [filteredItems]);

  const toggleCat = (cat: string) => {
    setExpandedCats(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(true); }
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-gradient-to-r from-blue-50 to-purple-50">
        <div>
          <h3 className="font-semibold text-gray-800 text-sm">Przedmiar / BOQ</h3>
          {summary && (
            <p className="text-[10px] text-gray-500">
              {summary.totalItems} pozycji, {summary.totalElements} elementow |
              Pewnosc: {Math.round(summary.confidence * 100)}%
              {summary.needsReview > 0 && <span className="text-amber-600 ml-1">({summary.needsReview} do sprawdzenia)</span>}
            </p>
          )}
        </div>
        <button onClick={onClose} className="p-1 hover:bg-gray-200 rounded"><X size={16} /></button>
      </div>

      {/* Actions */}
      {!summary && !loading && (
        <div className="p-4 space-y-3">
          <p className="text-xs text-gray-600">Wygeneruj przedmiar z modelu — automatycznie lub z pomoca AI.</p>
          <button onClick={onGenerateRuleBased}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
            <BarChart3 size={16} /> Generuj (reguly)
          </button>
          <button onClick={onGenerateAI}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg text-sm font-medium hover:from-purple-700 hover:to-blue-700">
            <Sparkles size={16} /> Generuj z AI (pelny przedmiar)
          </button>
        </div>
      )}

      {loading && (
        <div className="flex-1 flex flex-col items-center justify-center p-8">
          <Loader2 size={32} className="text-blue-500 animate-spin mb-3" />
          <p className="text-sm text-gray-600">Generowanie przedmiaru...</p>
          <p className="text-[10px] text-gray-400 mt-1">Analiza modelu, ekstrakcja wlasciwosci, klasyfikacja AI</p>
        </div>
      )}

      {summary && !loading && (
        <>
          {/* Toolbar */}
          <div className="px-3 py-2 border-b space-y-2">
            {/* Search */}
            <div className="flex gap-1.5">
              <div className="relative flex-1">
                <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Szukaj pozycji..."
                  className="w-full text-xs pl-7 pr-2 py-1.5 border rounded-lg focus:outline-none focus:border-blue-400" />
              </div>
              <button onClick={() => exportBOQtoCSV(summary, fileName)}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50" title="Eksport CSV">
                <Download size={12} /> CSV
              </button>
            </div>

            {/* View mode + filters */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <div className="flex bg-gray-100 rounded-lg p-0.5">
                {(['flat', 'byCategory', 'byLevel'] as ViewMode[]).map(mode => (
                  <button key={mode} onClick={() => setViewMode(mode)}
                    className={`px-2 py-0.5 text-[10px] rounded-md transition ${viewMode === mode ? 'bg-white shadow text-blue-700 font-medium' : 'text-gray-500 hover:text-gray-700'}`}>
                    {mode === 'flat' ? 'Lista' : mode === 'byCategory' ? 'Kategorie' : 'Poziomy'}
                  </button>
                ))}
              </div>
              <select value={filterCategory} onChange={e => setFilterCategory(e.target.value as any)}
                className="text-[10px] px-1.5 py-1 border rounded-lg bg-white">
                <option value="all">Wszystkie kategorie</option>
                {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              <button onClick={() => setFilterReview(!filterReview)}
                className={`flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-lg border ${filterReview ? 'bg-amber-50 border-amber-300 text-amber-700' : 'border-gray-200 text-gray-500'}`}>
                <AlertTriangle size={10} /> Do sprawdzenia
              </button>
            </div>
          </div>

          {/* Anomalies */}
          {anomalies.length > 0 && showAnomalies && (
            <div className="mx-3 mt-2 border border-amber-200 rounded-lg bg-amber-50 overflow-hidden">
              <button onClick={() => setShowAnomalies(false)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-amber-700 font-medium hover:bg-amber-100">
                <FileWarning size={14} /> Wykryto {anomalies.length} uwag
                <X size={12} className="ml-auto" />
              </button>
              <div className="px-3 pb-2 space-y-1">
                {anomalies.map((a, i) => (
                  <div key={i} className={`text-[10px] px-2 py-1 rounded ${
                    a.severity === 'error' ? 'bg-red-100 text-red-700' :
                    a.severity === 'warning' ? 'bg-amber-100 text-amber-700' :
                    'bg-blue-100 text-blue-700'
                  }`}>
                    {a.message}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Delta */}
          {delta && (
            <div className="mx-3 mt-2 border border-blue-200 rounded-lg bg-blue-50 p-2">
              <div className="text-xs font-medium text-blue-700 mb-1">Zmiany vs poprzednia wersja:</div>
              <div className="text-[10px] text-blue-600">{delta.summary}</div>
              {delta.added.length > 0 && (
                <div className="text-[10px] text-green-600 mt-1">+ {delta.added.map(i => `${i.name} (${i.quantity})`).join(', ')}</div>
              )}
              {delta.removed.length > 0 && (
                <div className="text-[10px] text-red-600 mt-1">- {delta.removed.map(i => `${i.name} (${i.quantity})`).join(', ')}</div>
              )}
              {delta.changed.length > 0 && (
                <div className="text-[10px] text-amber-600 mt-1">~ {delta.changed.map(c => `${c.item.name}: ${c.previousQuantity} -> ${c.item.quantity}`).join(', ')}</div>
              )}
            </div>
          )}

          {/* Items list */}
          <div className="flex-1 overflow-y-auto">
            {viewMode === 'flat' && (
              <table className="w-full text-[10px]">
                <thead className="sticky top-0 bg-gray-50 z-10">
                  <tr className="text-gray-500">
                    <th className="text-left px-3 py-1.5 cursor-pointer hover:text-gray-700" onClick={() => handleSort('position')}>
                      Lp. {sortField === 'position' && (sortAsc ? '↑' : '↓')}
                    </th>
                    <th className="text-left px-2 py-1.5 cursor-pointer hover:text-gray-700" onClick={() => handleSort('name')}>
                      Nazwa {sortField === 'name' && (sortAsc ? '↑' : '↓')}
                    </th>
                    <th className="text-center px-2 py-1.5 cursor-pointer hover:text-gray-700" onClick={() => handleSort('quantity')}>
                      Ilosc {sortField === 'quantity' && (sortAsc ? '↑' : '↓')}
                    </th>
                    <th className="text-center px-2 py-1.5">Jedn.</th>
                    <th className="text-center px-2 py-1.5 cursor-pointer hover:text-gray-700" onClick={() => handleSort('confidence')}>
                      % {sortField === 'confidence' && (sortAsc ? '↑' : '↓')}
                    </th>
                    <th className="px-2 py-1.5 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map(item => (
                    <ItemRow key={item.id} item={item} onHighlight={onHighlightElements} />
                  ))}
                </tbody>
              </table>
            )}

            {viewMode === 'byCategory' && (
              <div className="divide-y">
                {Object.entries(groupedByCategory).map(([cat, items]) => (
                  <div key={cat}>
                    <button onClick={() => toggleCat(cat)}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 text-left">
                      {expandedCats.has(cat) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      <span className="text-xs font-medium text-gray-700">
                        {CATEGORY_LABELS[cat as BOQCategory] || cat}
                      </span>
                      <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 rounded-full">
                        {items.length} poz. / {items.reduce((s, i) => s + i.quantity, 0)} el.
                      </span>
                    </button>
                    {expandedCats.has(cat) && (
                      <table className="w-full text-[10px]">
                        <tbody>
                          {items.map(item => (
                            <ItemRow key={item.id} item={item} onHighlight={onHighlightElements} indent />
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                ))}
              </div>
            )}

            {viewMode === 'byLevel' && (
              <div className="divide-y">
                {Object.entries(groupedByLevel).map(([level, items]) => (
                  <div key={level}>
                    <button onClick={() => toggleCat(level)}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 text-left">
                      {expandedCats.has(level) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      <Layers size={12} className="text-gray-400" />
                      <span className="text-xs font-medium text-gray-700">{level}</span>
                      <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 rounded-full">{items.length}</span>
                    </button>
                    {expandedCats.has(level) && (
                      <table className="w-full text-[10px]">
                        <tbody>
                          {items.map(item => (
                            <ItemRow key={item.id} item={item} onHighlight={onHighlightElements} indent />
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-3 py-2 border-t bg-gray-50 flex items-center justify-between">
            <div className="text-[10px] text-gray-400">
              Wygenerowano: {new Date(summary.generatedAt).toLocaleString('pl')}
            </div>
            <div className="flex gap-2">
              <button onClick={onGenerateRuleBased}
                className="text-[10px] text-blue-600 hover:underline">Przelicz (reguly)</button>
              <button onClick={onGenerateAI}
                className="text-[10px] text-purple-600 hover:underline">Przelicz (AI)</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ItemRow({ item, onHighlight, indent }: { item: BOQItem; onHighlight: (ids: number[]) => void; indent?: boolean }) {
  return (
    <tr className="border-t border-gray-50 hover:bg-blue-50/50 cursor-pointer group"
      onClick={() => onHighlight(item.dbIds)}>
      <td className={`px-3 py-1 text-gray-400 ${indent ? 'pl-8' : ''}`}>{item.position}</td>
      <td className="px-2 py-1">
        <div className="flex items-center gap-1">
          {item.needsReview && <AlertTriangle size={10} className="text-amber-500 flex-shrink-0" />}
          <span className="text-gray-700 truncate max-w-[180px]" title={item.name}>{item.name}</span>
        </div>
        {item.description && <div className="text-[9px] text-gray-400 truncate max-w-[180px]">{item.description}</div>}
        {(item.layer || item.family) && (
          <div className="text-[9px] text-gray-300 truncate max-w-[180px]">
            {item.layer && `W: ${item.layer}`}{item.layer && item.family && ' | '}{item.family && `R: ${item.family}`}
          </div>
        )}
      </td>
      <td className="px-2 py-1 text-center font-medium text-blue-700">{formatQty(item.quantity)}</td>
      <td className="px-2 py-1 text-center text-gray-500">{item.unit}</td>
      <td className="px-2 py-1 text-center">
        <span className={`inline-block px-1 py-0.5 rounded text-[9px] font-medium ${
          item.confidence >= 0.8 ? 'bg-green-100 text-green-700' :
          item.confidence >= 0.5 ? 'bg-amber-100 text-amber-700' :
          'bg-red-100 text-red-700'
        }`}>
          {Math.round(item.confidence * 100)}%
        </span>
      </td>
      <td className="px-2 py-1">
        <button onClick={e => { e.stopPropagation(); onHighlight(item.dbIds); }}
          className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-blue-100 rounded" title="Podswietl w modelu">
          <Eye size={12} className="text-blue-500" />
        </button>
      </td>
    </tr>
  );
}

function formatQty(v: number): string {
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(2);
}
