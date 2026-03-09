import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  Loader2, AlertTriangle, RefreshCw, Eye, EyeOff, Search, Layers,
  Hash, Ruler, BarChart3, Sparkles, Download, X, ChevronDown, ChevronRight,
  FileSearch, Table, Filter, Copy, ZoomIn, ZoomOut, Maximize2, Move
} from 'lucide-react';
import { supabase } from '../../lib/supabase';

declare global {
  interface Window {
    Autodesk: any;
  }
}

// ── Types ──────────────────────────────────────────────

export interface TakeoffItem {
  name: string;
  type: string;
  blockName?: string;
  count: number;
  symbol?: string;
  comment?: string;
  layer?: string;
  area?: number;
  length?: number;
}

interface LayerInfo {
  name: string;
  visible: boolean;
  color?: string;
  objectCount: number;
}

interface BlockInfo {
  name: string;
  count: number;
  dbIds: number[];
}

interface SearchResult {
  dbId: number;
  name: string;
  type: string;
  layer?: string;
  blockName?: string;
}

export interface SelectedObjectInfo {
  dbId: number;
  name: string;
  externalId?: string;
  properties: Record<string, any>;
}

interface AutodeskViewerProps {
  urn?: string;
  fileBase64?: string;
  fileName?: string;
  onUrnReady?: (urn: string) => void;
  onTakeoffGenerated?: (items: TakeoffItem[]) => void;
  onObjectSelected?: (obj: SelectedObjectInfo | null) => void;
  highlightDbIds?: number[];
  projectId?: string;
  planId?: string;
  className?: string;
}

type ViewerStatus = 'loading-script' | 'authenticating' | 'uploading' | 'translating' | 'loading-model' | 'ready' | 'error';
type ActivePanel = null | 'layers' | 'blocks' | 'search' | 'count' | 'measure' | 'takeoff';

// ── Script Loader ────────────────────────────────────

let scriptLoaded = false;
let scriptLoading = false;
const scriptCallbacks: (() => void)[] = [];

function loadViewerScript(): Promise<void> {
  if (scriptLoaded) return Promise.resolve();
  return new Promise((resolve) => {
    if (scriptLoading) { scriptCallbacks.push(resolve); return; }
    scriptLoading = true;
    if (!document.querySelector('link[href*="viewer3D.min.css"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://developer.api.autodesk.com/modelderivative/v2/viewers/7.*/style.min.css';
      document.head.appendChild(link);
    }
    const script = document.createElement('script');
    script.src = 'https://developer.api.autodesk.com/modelderivative/v2/viewers/7.*/viewer3D.min.js';
    script.onload = () => { scriptLoaded = true; scriptLoading = false; resolve(); scriptCallbacks.forEach(cb => cb()); scriptCallbacks.length = 0; };
    script.onerror = () => { scriptLoading = false; resolve(); };
    document.head.appendChild(script);
  });
}

// ── Helpers ───────────────────────────────────────────

function getAllDbIds(viewer: any): Promise<number[]> {
  return new Promise((resolve) => {
    const tree = viewer.model?.getInstanceTree();
    if (!tree) { resolve([]); return; }
    const ids: number[] = [];
    tree.enumNodeChildren(tree.getRootId(), (dbId: number) => { ids.push(dbId); }, true);
    resolve(ids);
  });
}

function getProperties(viewer: any, dbId: number): Promise<any> {
  return new Promise((resolve, reject) => {
    viewer.getProperties(dbId, (result: any) => resolve(result), (err: any) => reject(err));
  });
}

function getBulkProperties(viewer: any, dbIds: number[], propFilter?: string[]): Promise<any[]> {
  return new Promise((resolve, reject) => {
    viewer.model.getBulkProperties(dbIds, propFilter ? { propFilter } : {},
      (results: any[]) => resolve(results), (err: any) => reject(err));
  });
}

// ── Main Component ────────────────────────────────────

export default function AutodeskViewer({
  urn: initialUrn, fileBase64, fileName,
  onUrnReady, onTakeoffGenerated, onObjectSelected, highlightDbIds,
  projectId, planId, className = '',
}: AutodeskViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const [status, setStatus] = useState<ViewerStatus>('loading-script');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [urn, setUrn] = useState(initialUrn || '');

  // Panels
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [layers, setLayers] = useState<LayerInfo[]>([]);
  const [blocks, setBlocks] = useState<BlockInfo[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // Count mode
  const [countFilter, setCountFilter] = useState('');
  const [countResults, setCountResults] = useState<{ name: string; count: number; dbIds: number[] }[]>([]);

  // Takeoff
  const [takeoffItems, setTakeoffItems] = useState<TakeoffItem[]>([]);
  const [takeoffLoading, setTakeoffLoading] = useState(false);

  // Measurement info
  const [measureInfo, setMeasureInfo] = useState<string>('');

  // Cleanup
  useEffect(() => {
    return () => {
      if (viewerRef.current) { viewerRef.current.finish(); viewerRef.current = null; }
    };
  }, []);

  // ── APS Auth ──────────────────────────────────────

  const getAccessToken = useCallback(async (onSuccess: (token: string, expires: number) => void) => {
    try {
      const { data, error: fnError } = await supabase.functions.invoke('aps-proxy', { body: { action: 'getToken' } });
      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);
      onSuccess(data.access_token, 3600);
    } catch (err: any) {
      console.error('APS token error:', err);
      setError('Nie udalo sie uzyskac tokenu Autodesk');
      setStatus('error');
    }
  }, []);

  // ── Upload & Translate ────────────────────────────

  const uploadAndTranslate = useCallback(async (): Promise<string> => {
    if (!fileBase64 || !fileName) throw new Error('No file to upload');
    setStatus('uploading');
    setProgress('Przesylanie pliku do Autodesk...');

    const { data: uploadData, error: uploadErr } = await supabase.functions.invoke('aps-proxy', {
      body: { action: 'upload', fileBase64, fileName },
    });
    if (uploadErr) throw uploadErr;
    if (uploadData?.error) throw new Error(uploadData.error);

    const fileUrn = uploadData.urn;
    setProgress('Uruchamianie translacji...');
    setStatus('translating');

    const { data: translateData, error: translateErr } = await supabase.functions.invoke('aps-proxy', {
      body: { action: 'translate', urn: fileUrn },
    });
    if (translateErr) throw translateErr;
    if (translateData?.error) throw new Error(translateData.error);

    let attempts = 0;
    while (attempts < 120) {
      await new Promise(r => setTimeout(r, 2000));
      attempts++;
      const { data: statusData } = await supabase.functions.invoke('aps-proxy', {
        body: { action: 'status', urn: fileUrn },
      });
      if (statusData?.status === 'success') {
        setProgress('Translacja zakonczona!');
        onUrnReady?.(fileUrn);
        return fileUrn;
      } else if (statusData?.status === 'failed') {
        throw new Error('Translacja nie powiodla sie');
      }
      setProgress(`Translacja w toku: ${statusData?.progress || '0%'}`);
    }
    throw new Error('Translacja przekroczyla limit czasu');
  }, [fileBase64, fileName, onUrnReady]);

  // ── Extract Layers ──────────────────────────────────

  const extractLayers = useCallback(async () => {
    const viewer = viewerRef.current;
    if (!viewer || !viewer.model) return;

    try {
      const dbIds = await getAllDbIds(viewer);
      const layerMap = new Map<string, { visible: boolean; count: number }>();

      const props = await getBulkProperties(viewer, dbIds, ['Layer']);
      for (const p of props) {
        const layerProp = p.properties?.find((pr: any) => pr.displayName === 'Layer' || pr.attributeName === 'Layer');
        const layerName = layerProp?.displayValue || '0';
        if (!layerMap.has(layerName)) {
          layerMap.set(layerName, { visible: true, count: 0 });
        }
        layerMap.get(layerName)!.count++;
      }

      const layerList: LayerInfo[] = Array.from(layerMap.entries())
        .map(([name, info]) => ({ name, visible: info.visible, objectCount: info.count }))
        .sort((a, b) => b.objectCount - a.objectCount);

      setLayers(layerList);
    } catch (err) {
      console.error('extractLayers error:', err);
    }
  }, []);

  // ── Extract Blocks ──────────────────────────────────

  const extractBlocks = useCallback(async () => {
    const viewer = viewerRef.current;
    if (!viewer || !viewer.model) return;

    try {
      const dbIds = await getAllDbIds(viewer);
      const blockMap = new Map<string, number[]>();

      const props = await getBulkProperties(viewer, dbIds, ['Name', 'BlockName']);
      for (const p of props) {
        const blockProp = p.properties?.find((pr: any) =>
          pr.displayName === 'BlockName' || pr.displayName === 'Block Name' ||
          pr.attributeName === 'BlockName'
        );
        const blockName = blockProp?.displayValue;
        if (blockName && blockName !== '' && blockName !== 'Model_Space') {
          if (!blockMap.has(blockName)) blockMap.set(blockName, []);
          blockMap.get(blockName)!.push(p.dbId);
        }
      }

      const blockList: BlockInfo[] = Array.from(blockMap.entries())
        .map(([name, dbIds]) => ({ name, count: dbIds.length, dbIds }))
        .sort((a, b) => b.count - a.count);

      setBlocks(blockList);
    } catch (err) {
      console.error('extractBlocks error:', err);
    }
  }, []);

  // ── Toggle Layer ────────────────────────────────────

  const toggleLayer = useCallback((layerName: string) => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    setLayers(prev => prev.map(l => {
      if (l.name !== layerName) return l;
      const newVisible = !l.visible;

      // Use viewer's layer manager
      if (viewer.impl?.layers) {
        // For 2D sheets, layers work differently
        const layerNode = viewer.impl.layers.find((ln: any) => ln.name === layerName);
        if (layerNode) {
          viewer.impl.setLayerVisible(layerNode.index, newVisible);
        }
      }

      // Also try isolate/hide approach
      getAllDbIds(viewer).then(async (dbIds) => {
        const props = await getBulkProperties(viewer, dbIds, ['Layer']);
        const layerDbIds = props
          .filter(p => p.properties?.some((pr: any) =>
            (pr.displayName === 'Layer' || pr.attributeName === 'Layer') && pr.displayValue === layerName
          ))
          .map(p => p.dbId);

        if (newVisible) {
          viewer.show(layerDbIds);
        } else {
          viewer.hide(layerDbIds);
        }
      });

      return { ...l, visible: newVisible };
    }));
  }, []);

  // ── Search ──────────────────────────────────────────

  const performSearch = useCallback(async () => {
    const viewer = viewerRef.current;
    if (!viewer || !searchQuery.trim()) return;

    setSearchLoading(true);
    try {
      const dbIds = await getAllDbIds(viewer);
      const query = searchQuery.toLowerCase();
      const results: SearchResult[] = [];

      const props = await getBulkProperties(viewer, dbIds, ['Name', 'Layer', 'BlockName', 'Type']);
      for (const p of props) {
        const name = p.name || '';
        const getProp = (key: string) => p.properties?.find((pr: any) =>
          pr.displayName === key || pr.attributeName === key
        )?.displayValue || '';

        const layer = getProp('Layer');
        const blockName = getProp('BlockName');
        const type = getProp('Type');

        if (name.toLowerCase().includes(query) ||
            layer.toLowerCase().includes(query) ||
            blockName.toLowerCase().includes(query) ||
            type.toLowerCase().includes(query)) {
          results.push({ dbId: p.dbId, name, type, layer, blockName });
        }
      }

      setSearchResults(results.slice(0, 200));
    } catch (err) {
      console.error('Search error:', err);
    }
    setSearchLoading(false);
  }, [searchQuery]);

  // ── Count Elements ──────────────────────────────────

  const countElements = useCallback(async () => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    try {
      const dbIds = await getAllDbIds(viewer);
      const props = await getBulkProperties(viewer, dbIds, ['Name', 'BlockName', 'Layer', 'Type']);

      const groups = new Map<string, { count: number; dbIds: number[] }>();

      for (const p of props) {
        const blockProp = p.properties?.find((pr: any) =>
          pr.displayName === 'BlockName' || pr.attributeName === 'BlockName'
        );
        const blockName = blockProp?.displayValue;
        const key = blockName && blockName !== 'Model_Space'
          ? blockName
          : p.name || 'unknown';

        if (countFilter && !key.toLowerCase().includes(countFilter.toLowerCase())) continue;

        if (!groups.has(key)) groups.set(key, { count: 0, dbIds: [] });
        const g = groups.get(key)!;
        g.count++;
        g.dbIds.push(p.dbId);
      }

      const results = Array.from(groups.entries())
        .map(([name, { count, dbIds }]) => ({ name, count, dbIds }))
        .filter(r => r.count > 0)
        .sort((a, b) => b.count - a.count);

      setCountResults(results);
    } catch (err) {
      console.error('Count error:', err);
    }
  }, [countFilter]);

  // ── Highlight Elements ──────────────────────────────

  const highlightElements = useCallback((dbIds: number[]) => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    viewer.clearSelection();
    viewer.select(dbIds);
    if (dbIds.length > 0) {
      viewer.fitToView(dbIds);
    }
  }, []);

  // ── AI Takeoff (przedmiar) ──────────────────────────

  const generateTakeoff = useCallback(async () => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    setTakeoffLoading(true);
    try {
      const dbIds = await getAllDbIds(viewer);
      const allProps = await getBulkProperties(viewer, dbIds);

      // Group by block/type
      const groups = new Map<string, TakeoffItem>();

      for (const p of allProps) {
        const getProp = (key: string) => p.properties?.find((pr: any) =>
          pr.displayName === key || pr.attributeName === key
        )?.displayValue;

        const blockName = getProp('BlockName') || '';
        const layer = getProp('Layer') || '0';
        const type = getProp('Type') || p.name || 'Element';
        const name = blockName && blockName !== 'Model_Space' ? blockName : type;
        const length = parseFloat(getProp('Length') || '0') || 0;
        const area = parseFloat(getProp('Area') || '0') || 0;

        const key = `${name}__${layer}`;
        if (!groups.has(key)) {
          groups.set(key, {
            name,
            type: blockName ? 'block' : 'element',
            blockName: blockName || undefined,
            count: 0,
            layer,
            length: 0,
            area: 0,
            symbol: getProp('Symbol') || undefined,
          });
        }
        const item = groups.get(key)!;
        item.count++;
        if (length > 0) item.length = (item.length || 0) + length;
        if (area > 0) item.area = (item.area || 0) + area;
      }

      // Try AI classification via edge function
      const items = Array.from(groups.values())
        .filter(i => i.count > 0 && i.name !== 'Model_Space')
        .sort((a, b) => b.count - a.count);

      try {
        const { data: aiData } = await supabase.functions.invoke('aps-proxy', {
          body: {
            action: 'classifyTakeoff',
            items: items.slice(0, 100).map(i => ({
              name: i.name, type: i.type, count: i.count, layer: i.layer,
              blockName: i.blockName, length: i.length, area: i.area,
            })),
          },
        });
        if (aiData?.classifiedItems) {
          const classified = aiData.classifiedItems as TakeoffItem[];
          setTakeoffItems(classified);
          onTakeoffGenerated?.(classified);
          setTakeoffLoading(false);
          return;
        }
      } catch {
        // AI classification failed, use raw data
      }

      setTakeoffItems(items);
      onTakeoffGenerated?.(items);
    } catch (err) {
      console.error('Takeoff error:', err);
    }
    setTakeoffLoading(false);
  }, [onTakeoffGenerated]);

  // ── Export Takeoff ──────────────────────────────────

  const exportTakeoffCSV = useCallback(() => {
    if (takeoffItems.length === 0) return;
    const header = 'Lp.;Nazwa;Typ;Ilosc;Oznaczenie;Warstwa;Dlugosc (m);Powierzchnia (m2);Komentarz\n';
    const rows = takeoffItems.map((item, i) =>
      `${i + 1};${item.name};${item.type};${item.count};${item.symbol || ''};${item.layer || ''};${item.length ? item.length.toFixed(2) : ''};${item.area ? item.area.toFixed(2) : ''};${item.comment || ''}`
    ).join('\n');
    const csv = '\uFEFF' + header + rows;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `przedmiar_${fileName || 'project'}.csv`; a.click();
    URL.revokeObjectURL(url);
  }, [takeoffItems, fileName]);

  // ── Init Viewer ─────────────────────────────────────

  const initViewer = useCallback(async (docUrn: string) => {
    if (!containerRef.current || !window.Autodesk) return;

    setStatus('loading-model');
    setProgress('Ladowanie modelu...');

    const Av = window.Autodesk.Viewing;

    if (!Av.Private?.env) {
      await new Promise<void>((resolve) => {
        Av.Initializer({
          env: 'AutodeskProduction2',
          api: 'streamingV2',
          getAccessToken,
        }, () => resolve());
      });
    }

    if (viewerRef.current) viewerRef.current.finish();

    const viewer = new Av.GuiViewer3D(containerRef.current, {
      extensions: [
        'Autodesk.DocumentBrowser',
        'Autodesk.Measure',
        'Autodesk.LayerManager',
      ],
    });
    viewerRef.current = viewer;

    if (viewer.start() > 0) throw new Error('Viewer start failed');

    Av.Document.load(`urn:${docUrn}`,
      (doc: any) => {
        const viewables = doc.getRoot().search({ type: 'geometry' });
        const view2d = viewables.find((v: any) => v.data?.role === '2d');
        const defaultViewable = view2d || doc.getRoot().getDefaultGeometry();

        if (!defaultViewable) { setError('Brak widoku do wyswietlenia'); setStatus('error'); return; }

        viewer.loadDocumentNode(doc, defaultViewable).then(() => {
          setStatus('ready');
          setProgress('');
          viewer.setTheme('dark-theme');
          setTimeout(() => {
            viewer.fitToView();
            extractLayers();
            extractBlocks();
          }, 1000);

          // Selection event → onObjectSelected callback
          viewer.addEventListener(Av.SELECTION_CHANGED_EVENT, async (e: any) => {
            if (!onObjectSelected) return;
            const dbIds: number[] = e.dbIdArray || [];
            if (dbIds.length === 0) { onObjectSelected(null); return; }
            try {
              const props = await getProperties(viewer, dbIds[0]);
              const rawProps: Record<string, any> = {};
              for (const p of (props.properties || [])) {
                rawProps[p.displayName || p.attributeName] = p.displayValue;
              }
              onObjectSelected({
                dbId: dbIds[0],
                name: props.name || '',
                externalId: props.externalId,
                properties: rawProps,
              });
            } catch {
              onObjectSelected({ dbId: dbIds[0], name: '', properties: {} });
            }
          });
        });
      },
      (code: number, msg: string) => {
        setError(`Blad ladowania dokumentu: ${msg || code}`);
        setStatus('error');
      }
    );
  }, [getAccessToken, extractLayers, extractBlocks]);

  // ── Main Effect ─────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setStatus('loading-script');
        await loadViewerScript();
        if (cancelled) return;
        if (!window.Autodesk) throw new Error('Nie udalo sie zaladowac Autodesk Viewer');

        let docUrn = urn;
        if (!docUrn && fileBase64 && fileName) {
          docUrn = await uploadAndTranslate();
          if (cancelled) return;
          setUrn(docUrn);
        }
        if (!docUrn) throw new Error('Brak pliku do wyswietlenia');
        await initViewer(docUrn);
      } catch (err: any) {
        if (!cancelled) { setError(err.message || 'Nieznany blad'); setStatus('error'); }
      }
    })();
    return () => { cancelled = true; };
  }, [initialUrn, fileBase64, fileName]);

  // ── External highlight sync ─────────────────────────

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || status !== 'ready' || !highlightDbIds || highlightDbIds.length === 0) return;
    viewer.clearSelection();
    viewer.select(highlightDbIds);
    viewer.fitToView(highlightDbIds);
  }, [highlightDbIds, status]);

  // ── Toolbar Panel Toggle ────────────────────────────

  const togglePanel = (panel: ActivePanel) => {
    setActivePanel(prev => prev === panel ? null : panel);
  };

  // ── Render ──────────────────────────────────────────

  return (
    <div className={`relative w-full h-full flex ${className}`}>
      {/* Sidebar toolbar */}
      {status === 'ready' && (
        <div className="absolute top-2 left-2 z-20 flex flex-col gap-1 bg-gray-800/90 rounded-xl p-1.5 shadow-lg backdrop-blur-sm">
          <ToolbarBtn icon={<Layers size={16} />} label="Warstwy" active={activePanel === 'layers'} onClick={() => togglePanel('layers')} />
          <ToolbarBtn icon={<Hash size={16} />} label="Bloki" active={activePanel === 'blocks'} onClick={() => togglePanel('blocks')} />
          <ToolbarBtn icon={<Search size={16} />} label="Szukaj" active={activePanel === 'search'} onClick={() => togglePanel('search')} />
          <ToolbarBtn icon={<BarChart3 size={16} />} label="Licznik" active={activePanel === 'count'} onClick={() => togglePanel('count')} />
          <ToolbarBtn icon={<Ruler size={16} />} label="Pomiary" active={activePanel === 'measure'} onClick={() => togglePanel('measure')} />
          <div className="border-t border-gray-600 my-1" />
          <ToolbarBtn icon={<Sparkles size={16} />} label="Przedmiar AI" active={activePanel === 'takeoff'} onClick={() => togglePanel('takeoff')} />
        </div>
      )}

      {/* Panels */}
      {status === 'ready' && activePanel && (
        <div className="absolute top-2 left-14 z-20 w-80 max-h-[calc(100%-16px)] bg-white rounded-xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden">
          {/* Panel Header */}
          <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200">
            <span className="text-sm font-semibold text-gray-700">
              {activePanel === 'layers' && 'Warstwy'}
              {activePanel === 'blocks' && 'Bloki'}
              {activePanel === 'search' && 'Wyszukiwanie'}
              {activePanel === 'count' && 'Licznik elementow'}
              {activePanel === 'measure' && 'Pomiary'}
              {activePanel === 'takeoff' && 'Przedmiar (AI)'}
            </span>
            <button onClick={() => setActivePanel(null)} className="p-1 hover:bg-gray-200 rounded">
              <X size={14} />
            </button>
          </div>

          {/* Panel Content */}
          <div className="flex-1 overflow-y-auto">
            {activePanel === 'layers' && (
              <div className="p-2">
                {layers.length === 0 ? (
                  <div className="text-xs text-gray-400 p-4 text-center">
                    <Loader2 size={16} className="animate-spin mx-auto mb-2" />
                    Ladowanie warstw...
                  </div>
                ) : layers.map(layer => (
                  <div key={layer.name}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer text-xs"
                    onClick={() => toggleLayer(layer.name)}>
                    {layer.visible ? <Eye size={14} className="text-blue-500 flex-shrink-0" /> : <EyeOff size={14} className="text-gray-300 flex-shrink-0" />}
                    <span className={`flex-1 truncate ${layer.visible ? 'text-gray-700' : 'text-gray-400 line-through'}`}>{layer.name}</span>
                    <span className="text-gray-400 text-[10px]">{layer.objectCount}</span>
                  </div>
                ))}
              </div>
            )}

            {activePanel === 'blocks' && (
              <div className="p-2">
                {blocks.length === 0 ? (
                  <div className="text-xs text-gray-400 p-4 text-center">Brak blokow</div>
                ) : blocks.map(block => (
                  <div key={block.name}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-blue-50 cursor-pointer text-xs"
                    onClick={() => highlightElements(block.dbIds)}>
                    <Hash size={12} className="text-gray-400 flex-shrink-0" />
                    <span className="flex-1 truncate text-gray-700">{block.name}</span>
                    <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full text-[10px] font-medium">{block.count}</span>
                  </div>
                ))}
              </div>
            )}

            {activePanel === 'search' && (
              <div className="p-2">
                <div className="flex gap-1 mb-2">
                  <input
                    type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && performSearch()}
                    placeholder="Nazwa, typ, warstwa, blok..."
                    className="flex-1 text-xs px-2 py-1.5 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-400"
                  />
                  <button onClick={performSearch} disabled={searchLoading}
                    className="px-2.5 py-1.5 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700 disabled:opacity-50">
                    {searchLoading ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                  </button>
                </div>
                {searchResults.length > 0 && (
                  <div className="text-[10px] text-gray-400 mb-1">Wyniki: {searchResults.length}</div>
                )}
                {searchResults.map((r, i) => (
                  <div key={i}
                    className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-blue-50 cursor-pointer text-xs"
                    onClick={() => highlightElements([r.dbId])}>
                    <FileSearch size={12} className="text-gray-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-gray-700">{r.name || r.blockName || 'Element'}</div>
                      {r.layer && <div className="text-[10px] text-gray-400 truncate">Warstwa: {r.layer}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {activePanel === 'count' && (
              <div className="p-2">
                <div className="flex gap-1 mb-2">
                  <input
                    type="text" value={countFilter} onChange={e => setCountFilter(e.target.value)}
                    placeholder="Filtruj elementy..."
                    className="flex-1 text-xs px-2 py-1.5 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-400"
                  />
                  <button onClick={countElements}
                    className="px-2.5 py-1.5 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700">
                    <BarChart3 size={12} />
                  </button>
                </div>
                {countResults.length > 0 && (
                  <div className="text-[10px] text-gray-400 mb-1">
                    Razem typow: {countResults.length}, elementow: {countResults.reduce((s, r) => s + r.count, 0)}
                  </div>
                )}
                {countResults.map((r, i) => (
                  <div key={i}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-blue-50 cursor-pointer text-xs"
                    onClick={() => highlightElements(r.dbIds)}>
                    <span className="flex-1 truncate text-gray-700">{r.name}</span>
                    <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full text-[10px] font-bold">{r.count}</span>
                  </div>
                ))}
              </div>
            )}

            {activePanel === 'measure' && (
              <div className="p-3">
                <p className="text-xs text-gray-600 mb-3">
                  Uzyj narzedzi pomiarowych Autodesk Viewer:
                </p>
                <div className="space-y-2">
                  <MeasureBtn label="Odleglosc" desc="Zmierz dystans miedzy punktami"
                    onClick={() => {
                      const viewer = viewerRef.current;
                      if (viewer) {
                        const ext = viewer.getExtension('Autodesk.Measure');
                        if (ext) { ext.activate('distance'); }
                      }
                    }} />
                  <MeasureBtn label="Dlugosc" desc="Zmierz dlugosc elementu"
                    onClick={() => {
                      const viewer = viewerRef.current;
                      if (viewer) {
                        const ext = viewer.getExtension('Autodesk.Measure');
                        if (ext) { ext.activate('distance'); }
                      }
                    }} />
                  <MeasureBtn label="Powierzchnia" desc="Zmierz pole powierzchni"
                    onClick={() => {
                      const viewer = viewerRef.current;
                      if (viewer) {
                        const ext = viewer.getExtension('Autodesk.Measure');
                        if (ext) { ext.activate('area'); }
                      }
                    }} />
                  <MeasureBtn label="Kat" desc="Zmierz kat miedzy liniami"
                    onClick={() => {
                      const viewer = viewerRef.current;
                      if (viewer) {
                        const ext = viewer.getExtension('Autodesk.Measure');
                        if (ext) { ext.activate('angle'); }
                      }
                    }} />
                </div>
                <button onClick={() => {
                  const viewer = viewerRef.current;
                  if (viewer) {
                    const ext = viewer.getExtension('Autodesk.Measure');
                    if (ext) ext.deactivate();
                  }
                }} className="w-full mt-3 px-3 py-1.5 text-xs text-gray-500 border border-gray-300 rounded-lg hover:bg-gray-50">
                  Wyczysc pomiary
                </button>
              </div>
            )}

            {activePanel === 'takeoff' && (
              <div className="p-2">
                <p className="text-xs text-gray-600 mb-2">
                  Automatycznie wygeneruj przedmiar — zestawienie elementow z projektu.
                </p>
                <button onClick={generateTakeoff} disabled={takeoffLoading}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg text-xs font-medium hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 mb-3">
                  {takeoffLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  {takeoffLoading ? 'Generowanie...' : 'Generuj przedmiar'}
                </button>

                {takeoffItems.length > 0 && (
                  <>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] text-gray-400">Pozycji: {takeoffItems.length}</span>
                      <button onClick={exportTakeoffCSV}
                        className="flex items-center gap-1 text-[10px] text-blue-600 hover:text-blue-700">
                        <Download size={10} /> Eksport CSV
                      </button>
                    </div>

                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                      <table className="w-full text-[10px]">
                        <thead>
                          <tr className="bg-gray-50 text-gray-500">
                            <th className="text-left px-2 py-1">Nazwa</th>
                            <th className="text-center px-1 py-1">Ilosc</th>
                            <th className="text-left px-1 py-1">Warstwa</th>
                          </tr>
                        </thead>
                        <tbody>
                          {takeoffItems.slice(0, 50).map((item, i) => (
                            <tr key={i} className="border-t border-gray-100 hover:bg-blue-50">
                              <td className="px-2 py-1 truncate max-w-[120px]" title={item.name}>{item.name}</td>
                              <td className="text-center px-1 py-1 font-medium text-blue-700">{item.count}</td>
                              <td className="px-1 py-1 truncate max-w-[80px] text-gray-400">{item.layer}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {takeoffItems.length > 50 && (
                        <div className="px-2 py-1 bg-gray-50 text-[10px] text-gray-400 text-center">
                          ...i {takeoffItems.length - 50} wiecej (eksportuj CSV)
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Viewer container */}
      <div ref={containerRef} className="flex-1 h-full"
        style={{ visibility: status === 'ready' ? 'visible' : 'hidden' }} />

      {/* Loading overlay */}
      {status !== 'ready' && status !== 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900/90 z-10">
          <Loader2 size={40} className="text-blue-400 animate-spin mb-4" />
          <div className="text-white text-sm font-medium">{progress || 'Ladowanie...'}</div>
          <div className="text-gray-400 text-xs mt-1">
            {status === 'loading-script' && 'Ladowanie Autodesk Viewer...'}
            {status === 'authenticating' && 'Autoryzacja...'}
            {status === 'uploading' && 'Przesylanie pliku...'}
            {status === 'translating' && 'Konwersja formatu...'}
            {status === 'loading-model' && 'Ladowanie modelu...'}
          </div>
        </div>
      )}

      {/* Error overlay */}
      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900/90 z-10">
          <AlertTriangle size={40} className="text-red-400 mb-4" />
          <div className="text-white text-sm font-medium mb-2">Blad ladowania</div>
          <div className="text-red-300 text-xs mb-4 max-w-md text-center px-4">{error}</div>
          <button onClick={() => { setError(''); setStatus('loading-script'); setUrn(initialUrn || ''); }}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
            <RefreshCw size={14} /> Sprobuj ponownie
          </button>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────

function ToolbarBtn({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`p-2 rounded-lg transition-colors ${active ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white'}`}
    >
      {icon}
    </button>
  );
}

function MeasureBtn({ label, desc, onClick }: { label: string; desc: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="w-full text-left px-3 py-2 border border-gray-200 rounded-lg hover:bg-blue-50 hover:border-blue-200 transition">
      <div className="text-xs font-medium text-gray-700">{label}</div>
      <div className="text-[10px] text-gray-400">{desc}</div>
    </button>
  );
}
