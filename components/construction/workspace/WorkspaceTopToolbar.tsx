import React, { useState, useRef, useCallback } from 'react';
import {
  ZoomIn, ZoomOut, Maximize2, Minimize2, ChevronLeft, ChevronRight,
  RefreshCw, Sparkles, BookOpen, GitCompare, Download, BarChart3,
  Filter, Layers, Eye, EyeOff, Upload, History, Loader2,
  PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, ChevronDown,
  Pencil, Check,
} from 'lucide-react';
import type { ViewerMode, AsyncStatus, WorkspaceFilters } from './WorkspaceTypes';

interface WorkspaceTopToolbarProps {
  fileName: string;
  fileFormat: string;
  // Zoom
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onZoomFit: () => void;
  // Fullscreen
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  // PDF pages
  pdfPage?: number;
  pdfTotalPages?: number;
  onPdfPageChange?: (page: number) => void;
  // Panels
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  onToggleLeftPanel: () => void;
  onToggleRightPanel: () => void;
  // Mode
  viewerMode: ViewerMode;
  onSetMode: (mode: ViewerMode) => void;
  // Actions
  canConvert: boolean;
  canAnalyze: boolean;
  canAiRecognize: boolean;
  canGenerateBoq: boolean;
  canCompare: boolean;
  conversionStatus: AsyncStatus;
  analysisStatus: AsyncStatus;
  aiStatus: AsyncStatus;
  boqStatus: AsyncStatus;
  onConvert: () => void;
  onAnalyze: () => void;
  onAiRecognize: () => void;
  onGenerateBoq: () => void;
  onCompare: () => void;
  onExport: () => void;
  onUploadNewVersion: () => void;
  onHistory: () => void;
  onDownload: () => void;
  // Filters
  filters: WorkspaceFilters;
  availableLayers: string[];
  availableCategories: string[];
  availableLevels: string[];
  availableZones: string[];
  availableFamilyTypes: string[];
  onFiltersChange: (f: Partial<WorkspaceFilters>) => void;
  // File metadata
  fileCreatedAt?: string;
  fileUpdatedAt?: string;
  onRenameFile?: (newName: string) => void;
}

const MODE_OPTIONS: { mode: ViewerMode; label: string; icon: React.ReactNode }[] = [
  { mode: 'viewer', label: 'Podglad', icon: <Eye className="w-3.5 h-3.5" /> },
  { mode: 'objects', label: 'Obiekty', icon: <Layers className="w-3.5 h-3.5" /> },
  { mode: 'boq-overlay', label: 'BOQ', icon: <BookOpen className="w-3.5 h-3.5" /> },
  { mode: 'ai-overlay', label: 'AI', icon: <Sparkles className="w-3.5 h-3.5" /> },
  { mode: 'compare', label: 'Porownaj', icon: <GitCompare className="w-3.5 h-3.5" /> },
  { mode: 'manual-takeoff', label: 'Przedmiar reczny', icon: <BarChart3 className="w-3.5 h-3.5" /> },
];

export const WorkspaceTopToolbar: React.FC<WorkspaceTopToolbarProps> = (props) => {
  const [showFilters, setShowFilters] = useState(false);
  const [showModeMenu, setShowModeMenu] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editingNameValue, setEditingNameValue] = useState(props.fileName);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const handleStartEditing = useCallback(() => {
    if (!props.onRenameFile) return;
    setEditingNameValue(props.fileName);
    setIsEditingName(true);
    setTimeout(() => nameInputRef.current?.select(), 0);
  }, [props.fileName, props.onRenameFile]);

  const handleFinishEditing = useCallback(() => {
    setIsEditingName(false);
    const trimmed = editingNameValue.trim();
    if (trimmed && trimmed !== props.fileName) {
      props.onRenameFile?.(trimmed);
    }
  }, [editingNameValue, props.fileName, props.onRenameFile]);

  const handleNameKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleFinishEditing();
    } else if (e.key === 'Escape') {
      setIsEditingName(false);
    }
  }, [handleFinishEditing]);

  /** Toggle a value in a multi-select filter array */
  const toggleFilterItem = useCallback((key: 'levels' | 'zones' | 'layers' | 'categories' | 'familyTypes', value: string) => {
    const current = props.filters[key];
    const next = current.includes(value) ? current.filter(v => v !== value) : [...current, value];
    props.onFiltersChange({ [key]: next });
  }, [props.filters, props.onFiltersChange]);

  const ActionButton: React.FC<{
    onClick: () => void;
    disabled: boolean;
    loading: boolean;
    icon: React.ReactNode;
    label: string;
    color?: string;
  }> = ({ onClick, disabled, loading, icon, label, color = 'text-slate-700 hover:bg-slate-100' }) => (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition disabled:opacity-40 disabled:cursor-not-allowed ${color}`}
      title={label}
    >
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : icon}
      <span className="hidden xl:inline">{label}</span>
    </button>
  );

  return (
    <div className="px-3 py-1.5 border-b border-slate-200 flex items-center gap-1 flex-shrink-0 bg-white overflow-x-auto">
      {/* Left panel toggle */}
      <button onClick={props.onToggleLeftPanel} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500" title="Panel plikow">
        {props.leftPanelOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
      </button>

      <div className="w-px h-5 bg-slate-200 mx-1" />

      {/* File identity — inline editable */}
      <div className="flex flex-col min-w-0 max-w-[240px]">
        <div className="flex items-center gap-1">
          {isEditingName ? (
            <div className="flex items-center gap-1">
              <input
                ref={nameInputRef}
                value={editingNameValue}
                onChange={e => setEditingNameValue(e.target.value)}
                onBlur={handleFinishEditing}
                onKeyDown={handleNameKeyDown}
                className="text-xs text-slate-700 font-medium bg-white border border-blue-400 rounded px-1.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-500 w-[180px]"
                autoFocus
              />
              <button onClick={handleFinishEditing} className="p-0.5 text-green-600 hover:bg-green-50 rounded" title="Zapisz">
                <Check className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <span
              className={`text-xs text-slate-500 truncate font-medium ${props.onRenameFile ? 'cursor-pointer hover:text-slate-700' : ''}`}
              title={props.onRenameFile ? 'Kliknij dwukrotnie, aby zmienic nazwe' : props.fileName}
              onDoubleClick={handleStartEditing}
            >
              {props.fileName}
            </span>
          )}
          <span className="text-[10px] text-slate-400 uppercase font-mono flex-shrink-0">{props.fileFormat}</span>
        </div>
        {/* File metadata dates */}
        {(props.fileCreatedAt || props.fileUpdatedAt) && (
          <div className="flex items-center gap-2 text-[9px] text-slate-400 leading-tight mt-0.5">
            {props.fileCreatedAt && <span>Utworzono: {new Date(props.fileCreatedAt).toLocaleDateString('pl-PL')}</span>}
            {props.fileUpdatedAt && <span>Zmieniono: {new Date(props.fileUpdatedAt).toLocaleDateString('pl-PL')}</span>}
          </div>
        )}
      </div>

      {/* PDF pagination */}
      {props.pdfTotalPages && props.pdfTotalPages > 1 && (
        <div className="flex items-center gap-1 ml-2">
          <button onClick={() => props.onPdfPageChange?.(Math.max(1, (props.pdfPage || 1) - 1))}
            disabled={(props.pdfPage || 1) <= 1} className="p-0.5 hover:bg-slate-100 rounded disabled:opacity-30">
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <span className="text-[10px] text-slate-500 font-mono w-10 text-center">{props.pdfPage}/{props.pdfTotalPages}</span>
          <button onClick={() => props.onPdfPageChange?.(Math.min(props.pdfTotalPages!, (props.pdfPage || 1) + 1))}
            disabled={(props.pdfPage || 1) >= props.pdfTotalPages!} className="p-0.5 hover:bg-slate-100 rounded disabled:opacity-30">
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="w-px h-5 bg-slate-200 mx-1" />

      {/* Zoom controls */}
      <button onClick={props.onZoomOut} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600" title="Pomniejsz"><ZoomOut className="w-4 h-4" /></button>
      <span className="text-[10px] text-slate-500 w-8 text-center font-mono">{props.zoom}%</span>
      <button onClick={props.onZoomIn} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600" title="Powieksz"><ZoomIn className="w-4 h-4" /></button>
      <button onClick={props.onZoomReset} className="p-1 hover:bg-slate-100 rounded-lg text-slate-600 text-[10px] font-medium" title="1:1">1:1</button>
      <button onClick={props.onToggleFullscreen} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600" title="Pelny ekran">
        {props.isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
      </button>

      <div className="w-px h-5 bg-slate-200 mx-1" />

      {/* Action buttons */}
      <ActionButton onClick={props.onConvert} disabled={!props.canConvert}
        loading={props.conversionStatus === 'loading'} icon={<RefreshCw className="w-3.5 h-3.5" />} label="Konwertuj"
        color="text-blue-700 hover:bg-blue-50" />
      <ActionButton onClick={props.onAnalyze} disabled={!props.canAnalyze}
        loading={props.analysisStatus === 'loading'} icon={<BarChart3 className="w-3.5 h-3.5" />} label="Analizuj"
        color="text-indigo-700 hover:bg-indigo-50" />
      <ActionButton onClick={props.onAiRecognize} disabled={!props.canAiRecognize}
        loading={props.aiStatus === 'loading'} icon={<Sparkles className="w-3.5 h-3.5" />} label="AI"
        color="text-purple-700 hover:bg-purple-50" />
      <ActionButton onClick={props.onGenerateBoq} disabled={!props.canGenerateBoq}
        loading={props.boqStatus === 'loading'} icon={<BookOpen className="w-3.5 h-3.5" />} label="BOQ"
        color="text-green-700 hover:bg-green-50" />
      <ActionButton onClick={props.onCompare} disabled={!props.canCompare}
        loading={false} icon={<GitCompare className="w-3.5 h-3.5" />} label="Porownaj" />

      <div className="w-px h-5 bg-slate-200 mx-1" />

      {/* Mode switcher */}
      <div className="relative">
        <button
          onClick={() => setShowModeMenu(!showModeMenu)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 transition"
        >
          {MODE_OPTIONS.find(m => m.mode === props.viewerMode)?.icon}
          <span className="hidden lg:inline">{MODE_OPTIONS.find(m => m.mode === props.viewerMode)?.label}</span>
          <ChevronDown className="w-3 h-3 opacity-50" />
        </button>
        {showModeMenu && (
          <>
            <div className="fixed inset-0 z-[98]" onClick={() => setShowModeMenu(false)} />
            <div className="absolute top-full mt-1 left-0 w-48 bg-white border border-slate-200 rounded-xl shadow-xl z-[99] py-1">
              {MODE_OPTIONS.map(opt => (
                <button
                  key={opt.mode}
                  onClick={() => { props.onSetMode(opt.mode); setShowModeMenu(false); }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs ${
                    props.viewerMode === opt.mode ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {opt.icon} {opt.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Filters */}
      <button
        onClick={() => setShowFilters(!showFilters)}
        className={`p-1.5 rounded-lg transition ${showFilters ? 'bg-blue-100 text-blue-700' : 'hover:bg-slate-100 text-slate-500'}`}
        title="Filtry"
      >
        <Filter className="w-4 h-4" />
      </button>

      {showFilters && (
        <>
          <div className="fixed inset-0 z-[97]" onClick={() => setShowFilters(false)} />
          <div className="absolute top-full right-20 mt-1 w-80 bg-white border border-slate-200 rounded-xl shadow-xl z-[98] p-3 space-y-3 max-h-[70vh] overflow-y-auto">
            <h4 className="text-xs font-bold text-slate-700">Filtry wyswietlania</h4>

            {/* Search within objects */}
            <input
              type="text"
              value={props.filters.searchQuery}
              onChange={e => props.onFiltersChange({ searchQuery: e.target.value })}
              placeholder="Szukaj w obiektach..."
              className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
            />

            {/* Multi-select filter sections */}
            {([
              { key: 'levels' as const, label: 'Poziomy', items: props.availableLevels },
              { key: 'zones' as const, label: 'Strefy', items: props.availableZones },
              { key: 'layers' as const, label: 'Warstwy', items: props.availableLayers },
              { key: 'categories' as const, label: 'Kategorie', items: props.availableCategories },
              { key: 'familyTypes' as const, label: 'Rodziny / Typy', items: props.availableFamilyTypes },
            ] as const).map(section => (
              <div key={section.key}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide">{section.label}</span>
                  {section.items.length > 0 && (
                    <button
                      onClick={() => {
                        const allSelected = section.items.every(i => props.filters[section.key].includes(i));
                        props.onFiltersChange({ [section.key]: allSelected ? [] : [...section.items] });
                      }}
                      className="text-[9px] text-blue-600 hover:text-blue-800 font-medium"
                    >
                      {section.items.every(i => props.filters[section.key].includes(i)) ? 'Odznacz wszystko' : 'Zaznacz wszystko'}
                    </button>
                  )}
                </div>
                {section.items.length === 0 ? (
                  <span className="text-[10px] text-slate-400 italic">Brak dostepnych opcji</span>
                ) : (
                  <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                    {section.items.map(item => {
                      const isActive = props.filters[section.key].includes(item);
                      return (
                        <button
                          key={item}
                          onClick={() => toggleFilterItem(section.key, item)}
                          className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${
                            isActive
                              ? 'bg-blue-100 text-blue-700 border-blue-300'
                              : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                          }`}
                          title={item}
                        >
                          {item.length > 28 ? item.slice(0, 26) + '...' : item}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}

            <div className="w-full h-px bg-slate-200" />

            {/* Quick toggles */}
            {[
              { key: 'onlyAiRecognized', label: 'Tylko rozpoznane AI' },
              { key: 'onlyUnresolved', label: 'Tylko nierozwiazane' },
              { key: 'onlyBoqLinked', label: 'Tylko polaczone z BOQ' },
              { key: 'onlyChangedInCompare', label: 'Tylko zmienione' },
            ].map(toggle => (
              <label key={toggle.key} className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={(props.filters as any)[toggle.key]}
                  onChange={e => props.onFiltersChange({ [toggle.key]: e.target.checked })}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                {toggle.label}
              </label>
            ))}

            {/* Confidence threshold */}
            <div>
              <label className="text-[10px] text-slate-500 font-medium">Prog pewnosci AI: {props.filters.confidenceThreshold}%</label>
              <input type="range" min={0} max={100} step={5}
                value={props.filters.confidenceThreshold}
                onChange={e => props.onFiltersChange({ confidenceThreshold: Number(e.target.value) })}
                className="w-full h-1.5 accent-blue-600" />
            </div>
          </div>
        </>
      )}

      <div className="flex-1" />

      {/* Right side actions */}
      <button onClick={props.onHistory} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500" title="Historia wersji">
        <History className="w-4 h-4" />
      </button>
      <button onClick={props.onUploadNewVersion} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500" title="Przeslij nowa wersje">
        <Upload className="w-4 h-4" />
      </button>
      <button onClick={props.onDownload} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500" title="Pobierz">
        <Download className="w-4 h-4" />
      </button>
      <button onClick={props.onExport} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500" title="Eksportuj BOQ">
        <Download className="w-4 h-4" />
      </button>

      <div className="w-px h-5 bg-slate-200 mx-1" />

      {/* Right panel toggle */}
      <button onClick={props.onToggleRightPanel} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500" title="Panel prawy">
        {props.rightPanelOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
      </button>
    </div>
  );
};

export default WorkspaceTopToolbar;
