import React, { useState, useCallback } from 'react';
import { Search, X, ChevronDown, ChevronUp } from 'lucide-react';
import type { IDxf } from 'dxf-parser';
import { searchDxfText, type DxfSearchResult } from '../../lib/dxfSearch';

interface DxfSearchPanelProps {
  dxf: IDxf;
  hiddenLayers?: Set<string>;
  onResultClick: (result: DxfSearchResult) => void;
  onClose: () => void;
}

export default function DxfSearchPanel({ dxf, hiddenLayers, onResultClick, onClose }: DxfSearchPanelProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DxfSearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);

  const doSearch = useCallback(() => {
    if (!query.trim()) { setResults([]); setSearched(false); return; }
    const res = searchDxfText(dxf, query, { caseSensitive, hiddenLayers });
    setResults(res);
    setSearched(true);
    setSelectedIndex(-1);
  }, [dxf, query, caseSensitive, hiddenLayers]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') doSearch();
    if (e.key === 'Escape') onClose();
    if (e.key === 'ArrowDown' && results.length > 0) {
      e.preventDefault();
      const next = Math.min(selectedIndex + 1, results.length - 1);
      setSelectedIndex(next);
      onResultClick(results[next]);
    }
    if (e.key === 'ArrowUp' && results.length > 0) {
      e.preventDefault();
      const prev = Math.max(selectedIndex - 1, 0);
      setSelectedIndex(prev);
      onResultClick(results[prev]);
    }
  };

  return (
    <div className="absolute top-2 right-2 z-50 bg-white rounded-lg shadow-xl border w-80 max-h-96 flex flex-col">
      {/* Search header */}
      <div className="p-2 border-b">
        <div className="flex items-center gap-1">
          <Search size={16} className="text-gray-400 flex-shrink-0" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Szukaj tekst w DXF..."
            className="flex-1 text-sm border-none outline-none bg-transparent"
            autoFocus
          />
          <button onClick={() => setShowOptions(!showOptions)} className="p-1 hover:bg-gray-100 rounded" title="Opcje">
            {showOptions ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X size={14} />
          </button>
        </div>
        {showOptions && (
          <div className="mt-1 flex items-center gap-2 text-xs text-gray-600">
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="checkbox" checked={caseSensitive} onChange={e => setCaseSensitive(e.target.checked)} className="rounded" />
              Wielkość liter
            </label>
          </div>
        )}
        <div className="flex items-center gap-1 mt-1">
          <button onClick={doSearch} className="px-2 py-0.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700">
            Szukaj
          </button>
          {searched && (
            <span className="text-xs text-gray-500">
              {results.length} {results.length === 1 ? 'wynik' : results.length < 5 ? 'wyniki' : 'wyników'}
            </span>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="overflow-y-auto flex-1">
        {results.map((r, i) => (
          <button
            key={i}
            onClick={() => { setSelectedIndex(i); onResultClick(r); }}
            className={`w-full text-left px-3 py-1.5 text-xs border-b hover:bg-blue-50 ${i === selectedIndex ? 'bg-blue-100' : ''}`}
          >
            <div className="font-medium truncate">{r.matchedText}</div>
            <div className="text-gray-400 truncate">
              {r.entity.type} — warstwa: {r.layer} — ({r.position.x.toFixed(1)}, {r.position.y.toFixed(1)})
            </div>
          </button>
        ))}
        {searched && results.length === 0 && (
          <div className="p-4 text-center text-xs text-gray-400">Brak wyników</div>
        )}
      </div>
    </div>
  );
}
