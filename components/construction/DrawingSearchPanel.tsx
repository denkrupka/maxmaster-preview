import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Search, X, ChevronDown, ChevronUp } from 'lucide-react';
import type { IDxf } from 'dxf-parser';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { searchDxfText, type DxfSearchResult } from '../../lib/dxfSearch';

export interface DrawingSearchResult {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  page?: number;
  dxfResult?: DxfSearchResult;
}

interface DrawingSearchPanelProps {
  mode: 'pdf' | 'dxf';
  pdfDoc?: PDFDocumentProxy | null;
  pdfPage?: number;
  pdfPageWidth?: number;
  pdfPageHeight?: number;
  dxfData?: IDxf | null;
  dxfHiddenLayers?: Set<string>;
  onResultSelect: (result: DrawingSearchResult) => void;
  onHighlightResults: (results: DrawingSearchResult[]) => void;
  onClose: () => void;
}

export default function DrawingSearchPanel({
  mode, pdfDoc, pdfPage,
  dxfData, dxfHiddenLayers,
  onResultSelect, onHighlightResults, onClose,
}: DrawingSearchPanelProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DrawingSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Cache PDF text content to avoid re-fetching on each keystroke
  const pdfTextCacheRef = useRef<{ pageNum: number; items: { str: string; tx: number; ty: number; w: number; h: number; vpH: number }[] }[]>([]);
  const pdfCacheDocRef = useRef<PDFDocumentProxy | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Pre-load PDF text content for all pages
  useEffect(() => {
    if (mode !== 'pdf' || !pdfDoc || pdfCacheDocRef.current === pdfDoc) return;
    pdfCacheDocRef.current = pdfDoc;
    (async () => {
      const cache: typeof pdfTextCacheRef.current = [];
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        try {
          const page = await pdfDoc.getPage(i);
          const textContent = await page.getTextContent();
          const viewport = page.getViewport({ scale: 1 });
          const items = (textContent.items as any[])
            .filter(item => item.str && item.str.trim())
            .map(item => ({
              str: item.str,
              tx: item.transform[4],
              ty: item.transform[5],
              w: item.width || 0,
              h: item.height || Math.abs(item.transform[3]) || 10,
              vpH: viewport.height,
            }));
          cache.push({ pageNum: i, items });
        } catch {}
      }
      pdfTextCacheRef.current = cache;
    })();
  }, [mode, pdfDoc]);

  const doSearch = useCallback((q: string) => {
    if (!q.trim()) {
      setResults([]);
      setSelectedIndex(-1);
      onHighlightResults([]);
      return;
    }

    if (mode === 'dxf') {
      if (!dxfData) return;
      const dxfResults = searchDxfText(dxfData, q, { caseSensitive, hiddenLayers: dxfHiddenLayers });
      const found = dxfResults.map(r => ({
        text: r.matchedText,
        x: r.position.x,
        y: r.position.y,
        width: 0,
        height: 0,
        dxfResult: r,
      }));
      setResults(found);
      setSelectedIndex(found.length > 0 ? 0 : -1);
      onHighlightResults(found);
      if (found.length > 0) onResultSelect(found[0]);
      return;
    }

    // PDF: search from cache (current page first)
    const needle = caseSensitive ? q : q.toLowerCase();
    const found: DrawingSearchResult[] = [];

    // Sort: current page first
    const sorted = [...pdfTextCacheRef.current].sort((a, b) => {
      if (a.pageNum === (pdfPage || 1)) return -1;
      if (b.pageNum === (pdfPage || 1)) return 1;
      return a.pageNum - b.pageNum;
    });

    for (const pageData of sorted) {
      for (const item of pageData.items) {
        const hay = caseSensitive ? item.str : item.str.toLowerCase();
        if (!hay.includes(needle)) continue;
        found.push({
          text: item.str,
          x: item.tx,
          y: item.vpH - item.ty - item.h,
          width: item.w,
          height: Math.abs(item.h),
          page: pageData.pageNum,
        });
      }
    }

    setResults(found);
    setSelectedIndex(found.length > 0 ? 0 : -1);
    onHighlightResults(found);
    if (found.length > 0) onResultSelect(found[0]);
  }, [mode, dxfData, dxfHiddenLayers, caseSensitive, pdfPage, onHighlightResults, onResultSelect]);

  // Live search with debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      setSelectedIndex(-1);
      onHighlightResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => doSearch(query), 200);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, doSearch]);

  const navigateTo = (index: number) => {
    if (index < 0 || index >= results.length) return;
    setSelectedIndex(index);
    onResultSelect(results[index]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && results.length > 0) {
      e.preventDefault();
      navigateTo(selectedIndex >= 0 ? (selectedIndex + 1) % results.length : 0);
    }
    if (e.key === 'Escape') { onHighlightResults([]); onClose(); }
    if (e.key === 'ArrowDown' && results.length > 0) {
      e.preventDefault();
      navigateTo(Math.min(selectedIndex + 1, results.length - 1));
    }
    if (e.key === 'ArrowUp' && results.length > 0) {
      e.preventDefault();
      navigateTo(Math.max(selectedIndex - 1, 0));
    }
  };

  const handleClose = () => { onHighlightResults([]); onClose(); };

  const currentPageCount = mode === 'pdf'
    ? results.filter(r => r.page === (pdfPage || 1)).length
    : results.length;

  return (
    <div className="absolute top-2 right-2 z-50 bg-white rounded-lg shadow-xl border w-80 max-h-96 flex flex-col">
      <div className="p-2 border-b">
        <div className="flex items-center gap-1">
          <Search size={16} className="text-gray-400 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={mode === 'pdf' ? 'Szukaj tekst w PDF...' : 'Szukaj tekst w DXF...'}
            className="flex-1 text-sm border-none outline-none bg-transparent min-w-0"
          />
          {results.length > 0 && (
            <div className="flex items-center gap-0.5 flex-shrink-0">
              <button onClick={() => navigateTo(Math.max(selectedIndex - 1, 0))} className="p-0.5 hover:bg-gray-100 rounded">
                <ChevronUp size={14} />
              </button>
              <span className="text-[10px] text-gray-500 min-w-[28px] text-center whitespace-nowrap">
                {selectedIndex >= 0 ? selectedIndex + 1 : 0}/{results.length}
              </span>
              <button onClick={() => navigateTo(Math.min(selectedIndex + 1, results.length - 1))} className="p-0.5 hover:bg-gray-100 rounded">
                <ChevronDown size={14} />
              </button>
            </div>
          )}
          <button onClick={handleClose} className="p-1 hover:bg-gray-100 rounded flex-shrink-0" title="Zamknij (Esc)">
            <X size={14} />
          </button>
        </div>
        {query.trim() && (
          <div className="mt-1 text-xs text-gray-500">
            {results.length === 0
              ? 'Brak wyników'
              : mode === 'pdf' && results.length > currentPageCount
                ? `${currentPageCount} na stronie, ${results.length} łącznie`
                : `${results.length} ${results.length === 1 ? 'wynik' : results.length < 5 ? 'wyniki' : 'wyników'}`
            }
          </div>
        )}
      </div>

      {/* Results list */}
      {results.length > 0 && (
        <div className="overflow-y-auto flex-1 max-h-60">
          {results.map((r, i) => (
            <button
              key={i}
              onClick={() => navigateTo(i)}
              className={`w-full text-left px-3 py-1.5 text-xs border-b hover:bg-blue-50 ${i === selectedIndex ? 'bg-blue-100' : ''}`}
            >
              <div className="font-medium truncate">{r.text}</div>
              <div className="text-gray-400 truncate">
                {mode === 'pdf'
                  ? `str. ${r.page} — (${r.x.toFixed(0)}, ${r.y.toFixed(0)})`
                  : `${r.dxfResult?.entity?.type || ''} — warstwa: ${r.dxfResult?.layer || ''}`
                }
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
