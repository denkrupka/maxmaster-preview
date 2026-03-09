import React from 'react';
import {
  X, LayoutDashboard, Layers, FileText, Sparkles, BookOpen,
  GitCompare, MessageSquare, Ruler, Camera, AlertTriangle,
  StickyNote, ChevronDown, ChevronRight, CheckCircle2,
  Search, Eye, EyeOff, Link2, Copy, Filter, Download,
  Plus, Minus, Edit3, Trash2, ExternalLink, RefreshCw,
  BarChart3, Hash, ArrowUpDown, Loader2, Split, Merge,
  FileCode, Shield, Focus, Upload, RotateCcw, Terminal
} from 'lucide-react';
import type {
  RightTab, DrawingObject, BoqRow, AiSuggestion,
  MeasurementItem, AnnotationItem, CommentThread,
  VersionCompareResult, WorkspaceError, WorkspaceFilters, AsyncStatus
} from './WorkspaceTypes';

interface WorkspaceRightPanelProps {
  activeTab: RightTab;
  onSetTab: (tab: RightTab) => void;
  onClose: () => void;
  // Data
  objects: DrawingObject[];
  selectedObjectIds: string[];
  selectedBoqRowId: string | null;
  boqRows: BoqRow[];
  aiSuggestions: AiSuggestion[];
  measurements: MeasurementItem[];
  annotations: AnnotationItem[];
  comments: CommentThread[];
  compareResult: VersionCompareResult | null;
  errors: WorkspaceError[];
  // File info
  fileName: string;
  fileFormat: string;
  fileStatus: string;
  objectCount: number;
  // Status
  conversionStatus?: AsyncStatus;
  conversionProgress?: number;
  analysisStatus: AsyncStatus;
  analysisProgress?: number;
  aiStatus: AsyncStatus;
  boqStatus: AsyncStatus;
  // Callbacks
  onSelectObject: (id: string) => void;
  onSelectBoqRow: (rowId: string) => void;
  onHighlightObjects: (ids: string[]) => void;
  onIsolateObject: (id: string) => void;
  onAddToBoq: (objectIds: string[]) => void;
  onExcludeFromBoq: (objectId: string) => void;
  onApplyAiSuggestion: (suggestionId: string, mode: 'single' | 'similar') => void;
  onRejectAiSuggestion: (suggestionId: string) => void;
  onCreateRuleFromProperty: (objectId: string) => void;
  onApproveBoqRow: (rowId: string) => void;
  onRejectBoqRow: (rowId: string) => void;
  onEditBoqRow: (rowId: string, updates?: { name?: string; quantity?: number; unit?: string }) => void;
  onExportBoq: () => void;
  onGenerateBoq: () => void;
  onGenerateBoqAi: () => void;
  onAnalyze: () => void;
  onAiRecognize: () => void;
  onLinkMeasurementToBoq: (measurementId: string, boqRowId: string) => void;
  onDeleteMeasurement: (id: string) => void;
  onRetryError: (errorId: string) => void;
  // Photos
  photos?: { id: string; x: number; y: number; url: string; label?: string; linkedObjectId?: string; linkedBoqRowId?: string; linkedAnnotationId?: string }[];
  onDeletePhoto?: (id: string) => void;
  // Compare
  compareVersions?: { id: string; name: string; version: number }[];
  compareStatus?: AsyncStatus;
  onRunCompare?: (versionId: string) => void;

  // --- NEW optional callback props ---

  // Objects tab
  onExcludeObject?: (objectId: string) => void;
  onClassifyObject?: (objectId: string) => void;
  onMarkObjectReviewed?: (objectId: string) => void;
  onToggleObjectChecked?: (objectId: string, checked: boolean) => void;
  checkedObjectIds?: string[];

  // Properties tab
  onFindSimilar?: (objectId: string) => void;
  onLinkObjectToBoq?: (objectId: string) => void;
  sourceFile?: string;
  sourceVersion?: string;

  // AI tab
  onEditAiSuggestion?: (suggestionId: string) => void;
  onCreateRuleFromSuggestion?: (suggestionId: string) => void;

  // BOQ tab
  onSplitBoqRow?: (rowId: string) => void;
  onMergeBoqRows?: (rowIds: string[]) => void;
  onCompareBoqWithPrevious?: (rowId: string) => void;
  onAddBoqRowManually?: () => void;
  onRecalculateBoq?: () => void;
  onApproveAllBoq?: () => void;
  onRemoveBoqSource?: (rowId: string, sourceObjectId: string) => void;

  // Compare tab
  onAcceptCompareChanges?: () => void;
  onRejectCompareChanges?: () => void;
  onRecalculateDelta?: () => void;

  // Annotations tab
  onDeleteAnnotation?: (annotationId: string) => void;
  onEditAnnotation?: (annotationId: string) => void;
  onFocusAnnotation?: (annotationId: string) => void;
  onLinkAnnotationToBoq?: (annotationId: string) => void;

  // Measurements tab
  onRenameMeasurement?: (measurementId: string) => void;
  onExportMeasurements?: () => void;

  // Errors tab
  onIgnoreError?: (errorId: string) => void;
  onResolveError?: (errorId: string) => void;
  onOpenErrorLogs?: (errorId: string) => void;
}

const TABS: { id: RightTab; label: string; icon: React.FC<any>; shortLabel: string }[] = [
  { id: 'overview', label: 'Przeglad', icon: LayoutDashboard, shortLabel: 'Info' },
  { id: 'objects', label: 'Obiekty', icon: Layers, shortLabel: 'Obj' },
  { id: 'properties', label: 'Wlasciwosci', icon: FileText, shortLabel: 'Prop' },
  { id: 'ai', label: 'AI', icon: Sparkles, shortLabel: 'AI' },
  { id: 'boq', label: 'BOQ', icon: BookOpen, shortLabel: 'BOQ' },
  { id: 'compare', label: 'Porownanie', icon: GitCompare, shortLabel: 'Cmp' },
  { id: 'annotations', label: 'Adnotacje', icon: StickyNote, shortLabel: 'Ann' },
  { id: 'measurements', label: 'Pomiary', icon: Ruler, shortLabel: 'Meas' },
  { id: 'comments', label: 'Komentarze', icon: MessageSquare, shortLabel: 'Cmnt' },
  { id: 'photos', label: 'Zdjecia', icon: Camera, shortLabel: 'Foto' },
  { id: 'errors', label: 'Bledy', icon: AlertTriangle, shortLabel: 'Err' },
];

export const WorkspaceRightPanel: React.FC<WorkspaceRightPanelProps> = (props) => {
  const { activeTab, onSetTab, onClose } = props;

  return (
    <div className="flex flex-col h-full bg-white border-l border-slate-200 w-[360px] flex-shrink-0">
      {/* Tab bar */}
      <div className="flex items-center border-b border-slate-200 bg-slate-50 flex-shrink-0 overflow-x-auto">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          const hasData = tab.id === 'errors' ? props.errors.length > 0
            : tab.id === 'ai' ? props.aiSuggestions.length > 0
            : tab.id === 'boq' ? props.boqRows.length > 0
            : tab.id === 'compare' ? props.compareResult !== null
            : false;
          return (
            <button
              key={tab.id}
              onClick={() => onSetTab(tab.id)}
              className={`flex flex-col items-center px-2 py-1.5 min-w-[40px] border-b-2 transition text-[10px] ${
                isActive
                  ? 'border-blue-600 text-blue-700 bg-white'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-100'
              }`}
              title={tab.label}
            >
              <div className="relative">
                <Icon className="w-3.5 h-3.5" />
                {hasData && <div className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-blue-500 rounded-full" />}
              </div>
              <span className="mt-0.5">{tab.shortLabel}</span>
            </button>
          );
        })}
        <div className="flex-1" />
        <button onClick={onClose} className="p-1.5 hover:bg-slate-200 rounded text-slate-400 mr-1">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'overview' && <OverviewTab {...props} />}
        {activeTab === 'objects' && <ObjectsTab {...props} />}
        {activeTab === 'properties' && <PropertiesTab {...props} />}
        {activeTab === 'ai' && <AiTab {...props} />}
        {activeTab === 'boq' && <BoqTab {...props} />}
        {activeTab === 'compare' && <CompareTab {...props} />}
        {activeTab === 'annotations' && <AnnotationsTab {...props} />}
        {activeTab === 'measurements' && <MeasurementsTab {...props} />}
        {activeTab === 'comments' && <CommentsTab {...props} />}
        {activeTab === 'photos' && <PhotosTab {...props} />}
        {activeTab === 'errors' && <ErrorsTab {...props} />}
      </div>
    </div>
  );
};

// ---- Overview Tab ----
const OverviewTab: React.FC<WorkspaceRightPanelProps> = (props) => {
  const conversionProgress = props.conversionProgress ?? 0;
  const analysisProgress = props.analysisProgress ?? 0;
  const conversionStatus = props.conversionStatus ?? 'idle';

  const stats = [
    { label: 'Status pliku', value: props.fileStatus, color: 'text-blue-700' },
    { label: 'Obiekty', value: `${props.objectCount}` },
    { label: 'AI rozpoznane', value: `${props.aiSuggestions.filter(s => s.confidence > 0.7).length}` },
    { label: 'AI do przejrzenia', value: `${props.aiSuggestions.filter(s => s.status === 'pending' && s.confidence <= 0.7).length}` },
    { label: 'Pozycje BOQ', value: `${props.boqRows.length}` },
    { label: 'Pomiary', value: `${props.measurements.length}` },
    { label: 'Adnotacje', value: `${props.annotations.length}` },
    { label: 'Komentarze', value: `${props.comments.length}` },
    { label: 'Bledy', value: `${props.errors.length}`, color: props.errors.length > 0 ? 'text-red-600 font-bold' : '' },
  ];

  return (
    <div className="p-4 space-y-4">
      <div>
        <h4 className="text-xs font-bold text-slate-700 mb-1">{props.fileName}</h4>
        <p className="text-[10px] text-slate-400 uppercase">{props.fileFormat}</p>
      </div>

      {/* Conversion status indicator */}
      {conversionStatus !== 'idle' && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500 font-medium">Konwersja</span>
            <span className={`text-[10px] font-bold ${
              conversionStatus === 'success' ? 'text-green-600'
              : conversionStatus === 'error' ? 'text-red-600'
              : conversionStatus === 'loading' ? 'text-blue-600'
              : 'text-slate-500'
            }`}>
              {conversionStatus === 'loading' ? `${conversionProgress}%` : conversionStatus === 'success' ? 'Gotowe' : conversionStatus === 'error' ? 'Blad' : 'Idle'}
            </span>
          </div>
          {conversionStatus === 'loading' && (
            <div className="w-full bg-slate-200 rounded-full h-1.5">
              <div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${conversionProgress}%` }} />
            </div>
          )}
        </div>
      )}

      {/* Analysis status indicator */}
      {props.analysisStatus !== 'idle' && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500 font-medium">Analiza</span>
            <span className={`text-[10px] font-bold ${
              props.analysisStatus === 'success' ? 'text-green-600'
              : props.analysisStatus === 'error' ? 'text-red-600'
              : props.analysisStatus === 'loading' ? 'text-indigo-600'
              : 'text-slate-500'
            }`}>
              {props.analysisStatus === 'loading' ? `${analysisProgress}%` : props.analysisStatus === 'success' ? 'Gotowe' : props.analysisStatus === 'error' ? 'Blad' : 'Idle'}
            </span>
          </div>
          {props.analysisStatus === 'loading' && (
            <div className="w-full bg-slate-200 rounded-full h-1.5">
              <div className="bg-indigo-500 h-1.5 rounded-full transition-all" style={{ width: `${analysisProgress}%` }} />
            </div>
          )}
        </div>
      )}

      <div className="space-y-1.5">
        {stats.map(s => (
          <div key={s.label} className="flex items-center justify-between">
            <span className="text-xs text-slate-500">{s.label}</span>
            <span className={`text-xs font-medium ${s.color || 'text-slate-800'}`}>{s.value}</span>
          </div>
        ))}
      </div>

      {/* Compare summary */}
      {props.compareResult && (
        <div className="space-y-1.5 pt-2 border-t border-slate-100">
          <h4 className="text-[10px] font-bold text-slate-500 uppercase">Podsumowanie porownania</h4>
          <div className="flex items-center justify-between">
            <span className="text-xs text-green-700">Dodane</span>
            <span className="text-xs font-bold text-green-700">{props.compareResult.addedObjects.length}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-red-600">Usuniete</span>
            <span className="text-xs font-bold text-red-600">{props.compareResult.removedObjects.length}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-amber-600">Zmienione</span>
            <span className="text-xs font-bold text-amber-600">{props.compareResult.changedObjects.length}</span>
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div className="space-y-2 pt-2 border-t border-slate-100">
        <h4 className="text-[10px] font-bold text-slate-500 uppercase">Szybkie akcje</h4>
        <button onClick={props.onAnalyze} disabled={props.analysisStatus === 'loading'}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition disabled:opacity-50">
          {props.analysisStatus === 'loading' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BarChart3 className="w-3.5 h-3.5" />} Analizuj plik
        </button>
        <button onClick={props.onAiRecognize} disabled={props.aiStatus === 'loading' || props.objectCount === 0}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-purple-50 text-purple-700 hover:bg-purple-100 transition disabled:opacity-50">
          {props.aiStatus === 'loading' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Rozpoznanie AI
        </button>
        <button onClick={props.onGenerateBoq} disabled={props.boqStatus === 'loading' || props.objectCount === 0}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-green-50 text-green-700 hover:bg-green-100 transition disabled:opacity-50">
          {props.boqStatus === 'loading' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BookOpen className="w-3.5 h-3.5" />} Generuj BOQ
        </button>
        {props.boqRows.length > 0 && (
          <button onClick={props.onExportBoq}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-slate-50 text-slate-700 hover:bg-slate-100 transition">
            <Download className="w-3.5 h-3.5" /> Eksportuj BOQ (CSV)
          </button>
        )}
      </div>
    </div>
  );
};

// ---- Objects Tab ----
const ObjectsTab: React.FC<WorkspaceRightPanelProps> = (props) => {
  const [viewMode, setViewMode] = React.useState<'list' | 'tree' | 'category' | 'level' | 'zone' | 'boqRow'>('list');
  const [searchQuery, setSearchQuery] = React.useState('');
  const [sortField, setSortField] = React.useState<'name' | 'category' | 'type' | 'layer'>('name');
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  const checkedIds = props.checkedObjectIds ?? [];

  const filtered = props.objects.filter(o => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (o.name || '').toLowerCase().includes(q) ||
        (o.category || '').toLowerCase().includes(q) ||
        (o.type || '').toLowerCase().includes(q) ||
        (o.layer || '').toLowerCase().includes(q);
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const av = (a as any)[sortField] || '';
    const bv = (b as any)[sortField] || '';
    return av.localeCompare(bv);
  });

  const groupByKey = (key: string) =>
    sorted.reduce((acc, o) => {
      const val = (o as any)[key] || 'Inne';
      if (!acc[val]) acc[val] = [];
      acc[val].push(o);
      return acc;
    }, {} as Record<string, DrawingObject[]>);

  const grouped = viewMode === 'category' ? groupByKey('category')
    : viewMode === 'level' ? groupByKey('level')
    : viewMode === 'zone' ? groupByKey('zone')
    : viewMode === 'boqRow' ? sorted.reduce((acc, o) => {
        const key = o.boqRowId ? (props.boqRows.find(r => r.id === o.boqRowId)?.name || o.boqRowId) : 'Niepowiazane';
        if (!acc[key]) acc[key] = [];
        acc[key].push(o);
        return acc;
      }, {} as Record<string, DrawingObject[]>)
    : null;

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="p-2 border-b border-slate-100 space-y-1.5 flex-shrink-0">
        <div className="flex items-center gap-1">
          <div className="relative flex-1">
            <Search className="w-3 h-3 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
            <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              placeholder="Szukaj obiektow..." className="w-full pl-7 pr-2 py-1 text-[11px] border border-slate-200 rounded-lg" />
          </div>
          <select value={viewMode} onChange={e => setViewMode(e.target.value as any)}
            className="px-2 py-1 text-[10px] border border-slate-200 rounded-lg">
            <option value="list">Lista</option>
            <option value="category">Kategorie</option>
            <option value="level">Poziomy</option>
            <option value="zone">Strefy</option>
            <option value="boqRow">Pozycje BOQ</option>
          </select>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-slate-500">
          <span>{filtered.length} obiektow</span>
          <span className="mx-1">|</span>
          <span>Sortuj:</span>
          {(['name', 'category', 'type', 'layer'] as const).map(f => (
            <button key={f} onClick={() => setSortField(f)}
              className={`px-1.5 py-0.5 rounded ${sortField === f ? 'bg-blue-100 text-blue-700 font-medium' : 'hover:bg-slate-100'}`}>
              {f === 'name' ? 'Nazwa' : f === 'category' ? 'Kat.' : f === 'type' ? 'Typ' : 'Warstwa'}
            </button>
          ))}
        </div>
      </div>

      {/* Object list */}
      <div className="flex-1 overflow-y-auto">
        {grouped ? (
          Object.entries(grouped).map(([cat, objs]) => (
            <div key={cat}>
              <button
                onClick={() => setExpanded(prev => { const next = new Set(prev); next.has(cat) ? next.delete(cat) : next.add(cat); return next; })}
                className="w-full flex items-center gap-2 px-3 py-1.5 bg-slate-50 text-xs font-medium text-slate-700 hover:bg-slate-100 border-b border-slate-100"
              >
                {expanded.has(cat) ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                <span>{cat}</span>
                <span className="ml-auto text-[10px] text-slate-400">{objs.length}</span>
              </button>
              {expanded.has(cat) && objs.map(o => (
                <ObjectRow key={o.id} object={o} isSelected={props.selectedObjectIds.includes(o.id)}
                  isChecked={checkedIds.includes(o.id)}
                  onToggleChecked={props.onToggleObjectChecked ? (ch) => props.onToggleObjectChecked!(o.id, ch) : undefined}
                  onSelect={() => props.onSelectObject(o.id)} onHighlight={() => props.onHighlightObjects([o.id])}
                  onExclude={props.onExcludeObject ? () => props.onExcludeObject!(o.id) : undefined}
                  onClassify={props.onClassifyObject ? () => props.onClassifyObject!(o.id) : undefined}
                  onMarkReviewed={props.onMarkObjectReviewed ? () => props.onMarkObjectReviewed!(o.id) : undefined}
                />
              ))}
            </div>
          ))
        ) : (
          sorted.map(o => (
            <ObjectRow key={o.id} object={o} isSelected={props.selectedObjectIds.includes(o.id)}
              isChecked={checkedIds.includes(o.id)}
              onToggleChecked={props.onToggleObjectChecked ? (ch) => props.onToggleObjectChecked!(o.id, ch) : undefined}
              onSelect={() => props.onSelectObject(o.id)} onHighlight={() => props.onHighlightObjects([o.id])}
              onExclude={props.onExcludeObject ? () => props.onExcludeObject!(o.id) : undefined}
              onClassify={props.onClassifyObject ? () => props.onClassifyObject!(o.id) : undefined}
              onMarkReviewed={props.onMarkObjectReviewed ? () => props.onMarkObjectReviewed!(o.id) : undefined}
            />
          ))
        )}
      </div>
    </div>
  );
};

const ObjectRow: React.FC<{
  object: DrawingObject;
  isSelected: boolean;
  isChecked?: boolean;
  onToggleChecked?: (checked: boolean) => void;
  onSelect: () => void;
  onHighlight: () => void;
  onExclude?: () => void;
  onClassify?: () => void;
  onMarkReviewed?: () => void;
}> = ({ object, isSelected, isChecked, onToggleChecked, onSelect, onHighlight, onExclude, onClassify, onMarkReviewed }) => (
  <div
    className={`flex items-center gap-2 px-3 py-1.5 border-b border-slate-50 cursor-pointer transition-colors text-xs ${
      isSelected ? 'bg-blue-50 border-l-2 border-l-blue-500' : 'hover:bg-slate-50'
    }`}
    onClick={onSelect}
    onDoubleClick={onHighlight}
  >
    {/* Checkbox */}
    {onToggleChecked && (
      <input
        type="checkbox"
        checked={isChecked ?? false}
        onChange={e => { e.stopPropagation(); onToggleChecked(e.target.checked); }}
        onClick={e => e.stopPropagation()}
        className="w-3 h-3 flex-shrink-0 accent-blue-600"
      />
    )}
    <div className="flex-1 min-w-0">
      <p className="text-slate-800 font-medium truncate">{object.name}</p>
      <p className="text-[10px] text-slate-400 truncate">
        {[object.category, object.type, object.layer].filter(Boolean).join(' / ')}
      </p>
      {/* Quantity basis & confidence */}
      <div className="flex items-center gap-2 mt-0.5">
        {object.quantityBasis && (
          <span className="text-[9px] px-1 py-0.5 bg-slate-100 text-slate-500 rounded">{object.quantityBasis}</span>
        )}
        {object.aiConfidence !== undefined && (
          <span className={`text-[9px] font-medium ${
            object.aiConfidence >= 0.8 ? 'text-green-600' : object.aiConfidence >= 0.4 ? 'text-amber-600' : 'text-red-600'
          }`}>
            {(object.aiConfidence * 100).toFixed(0)}%
          </span>
        )}
      </div>
    </div>
    {object.aiStatus && (
      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
        object.aiStatus === 'recognized' ? 'bg-green-400'
        : object.aiStatus === 'needs_review' ? 'bg-amber-400'
        : 'bg-red-400'
      }`} />
    )}
    {object.boqRowId && <Link2 className="w-3 h-3 text-green-500 flex-shrink-0" />}
    {/* Actions row */}
    <div className="flex items-center gap-0.5 flex-shrink-0">
      <button onClick={e => { e.stopPropagation(); onHighlight(); }}
        className="p-0.5 hover:bg-blue-100 rounded text-slate-400 hover:text-blue-600" title="Pokaz">
        <Eye className="w-3 h-3" />
      </button>
      {onExclude && (
        <button onClick={e => { e.stopPropagation(); onExclude(); }}
          className="p-0.5 hover:bg-red-100 rounded text-slate-400 hover:text-red-600" title="Wyklucz">
          <Minus className="w-3 h-3" />
        </button>
      )}
      {onClassify && (
        <button onClick={e => { e.stopPropagation(); onClassify(); }}
          className="p-0.5 hover:bg-purple-100 rounded text-slate-400 hover:text-purple-600" title="Klasyfikuj AI">
          <Sparkles className="w-3 h-3" />
        </button>
      )}
      {onMarkReviewed && (
        <button onClick={e => { e.stopPropagation(); onMarkReviewed(); }}
          className="p-0.5 hover:bg-green-100 rounded text-slate-400 hover:text-green-600" title="Oznacz jako przejrzany">
          <CheckCircle2 className="w-3 h-3" />
        </button>
      )}
    </div>
  </div>
);

// ---- Properties Tab ----
const PropertiesTab: React.FC<WorkspaceRightPanelProps> = (props) => {
  const selected = props.objects.find(o => props.selectedObjectIds.includes(o.id));

  if (!selected) {
    return (
      <div className="p-6 text-center">
        <FileText className="w-8 h-8 text-slate-300 mx-auto mb-2" />
        <p className="text-xs text-slate-400">Kliknij obiekt na rysunku lub na liscie, aby zobaczyc wlasciwosci.</p>
      </div>
    );
  }

  const properties = [
    { label: 'ID', value: selected.id },
    { label: 'dbId', value: selected.dbId?.toString() },
    { label: 'External ID', value: selected.externalId },
    { label: 'Nazwa', value: selected.name },
    { label: 'Kategoria', value: selected.category },
    { label: 'Rodzina', value: selected.family },
    { label: 'Typ', value: selected.type },
    { label: 'Poziom', value: selected.level },
    { label: 'Strefa', value: selected.zone },
    { label: 'Warstwa', value: selected.layer },
    { label: 'System', value: selected.system },
    { label: 'Typ geometrii', value: selected.geometryType },
    { label: 'Dlugosc', value: selected.length?.toFixed(2) },
    { label: 'Powierzchnia', value: selected.area?.toFixed(2) },
    { label: 'Objetosc', value: selected.volume?.toFixed(2) },
    { label: 'Podstawa ilosci', value: selected.quantityBasis },
    { label: 'Status AI', value: selected.aiStatus },
    { label: 'Pewnosc AI', value: selected.aiConfidence ? `${(selected.aiConfidence * 100).toFixed(0)}%` : undefined },
    { label: 'Pozycja BOQ', value: selected.boqRowId },
    { label: 'Plik zrodlowy', value: props.sourceFile },
    { label: 'Wersja', value: props.sourceVersion },
  ].filter(p => p.value);

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold text-slate-700 truncate">{selected.name}</h4>
      </div>

      <div className="space-y-1">
        {properties.map(p => (
          <div key={p.label} className="flex items-start justify-between gap-2">
            <span className="text-[10px] text-slate-500 flex-shrink-0">{p.label}</span>
            <span className="text-[11px] text-slate-800 text-right truncate flex-1 font-mono">{p.value}</span>
            <button onClick={() => navigator.clipboard.writeText(p.value || '')}
              className="p-0.5 hover:bg-slate-100 rounded text-slate-300 hover:text-slate-500 flex-shrink-0" title="Kopiuj wartosc">
              <Copy className="w-2.5 h-2.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Raw properties */}
      {selected.rawProperties && Object.keys(selected.rawProperties).length > 0 && (
        <details className="border border-slate-200 rounded-lg">
          <summary className="px-3 py-1.5 text-[10px] font-medium text-slate-500 cursor-pointer hover:bg-slate-50">
            Surowe wlasciwosci ({Object.keys(selected.rawProperties).length})
          </summary>
          <div className="px-3 py-2 max-h-40 overflow-y-auto">
            {Object.entries(selected.rawProperties).map(([k, v]) => (
              <div key={k} className="flex items-start justify-between gap-2 py-0.5">
                <span className="text-[9px] text-slate-400 truncate">{k}</span>
                <span className="text-[9px] text-slate-600 text-right truncate font-mono">{String(v)}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Actions */}
      <div className="space-y-1.5 pt-2 border-t border-slate-100">
        <button onClick={() => props.onHighlightObjects([selected.id])}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-slate-700 hover:bg-slate-50 rounded-lg">
          <Eye className="w-3.5 h-3.5" /> Pokaz na rysunku
        </button>
        <button onClick={() => props.onIsolateObject(selected.id)}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-slate-700 hover:bg-slate-50 rounded-lg">
          <Filter className="w-3.5 h-3.5" /> Izoluj
        </button>
        <button onClick={() => props.onAddToBoq([selected.id])}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-green-700 hover:bg-green-50 rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Dodaj do BOQ
        </button>
        {props.onFindSimilar && (
          <button onClick={() => props.onFindSimilar!(selected.id)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-blue-700 hover:bg-blue-50 rounded-lg">
            <Search className="w-3.5 h-3.5" /> Znajdz podobne
          </button>
        )}
        {props.onLinkObjectToBoq && (
          <button onClick={() => props.onLinkObjectToBoq!(selected.id)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-green-700 hover:bg-green-50 rounded-lg">
            <Link2 className="w-3.5 h-3.5" /> Polacz z BOQ
          </button>
        )}
        <button onClick={() => props.onCreateRuleFromProperty(selected.id)}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-indigo-700 hover:bg-indigo-50 rounded-lg">
          <Edit3 className="w-3.5 h-3.5" /> Utwarz regule z wlasciwosci
        </button>
        <button onClick={() => props.onExcludeFromBoq(selected.id)}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-red-600 hover:bg-red-50 rounded-lg">
          <Minus className="w-3.5 h-3.5" /> Wyklucz z BOQ
        </button>
      </div>
    </div>
  );
};

// ---- AI Tab ----
const AiTab: React.FC<WorkspaceRightPanelProps> = (props) => {
  const confident = props.aiSuggestions.filter(s => s.confidence >= 0.8);
  const needsReview = props.aiSuggestions.filter(s => s.confidence >= 0.4 && s.confidence < 0.8);
  const lowConfidence = props.aiSuggestions.filter(s => s.confidence < 0.4);

  const SuggestionRow: React.FC<{ suggestion: AiSuggestion }> = ({ suggestion }) => {
    const obj = props.objects.find(o => o.id === suggestion.objectId);
    return (
      <div className="px-3 py-2 border-b border-slate-50 hover:bg-slate-50">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] font-medium text-slate-800 truncate">{obj?.name || suggestion.objectId}</span>
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
            suggestion.confidence >= 0.8 ? 'bg-green-100 text-green-700'
            : suggestion.confidence >= 0.4 ? 'bg-amber-100 text-amber-700'
            : 'bg-red-100 text-red-700'
          }`}>
            {(suggestion.confidence * 100).toFixed(0)}%
          </span>
        </div>
        <p className="text-[10px] text-slate-600 mb-1">
          Klasa: <span className="font-medium">{suggestion.suggestedClass}</span>
          {suggestion.suggestedBoqItem && <> | BOQ: <span className="font-medium">{suggestion.suggestedBoqItem}</span></>}
        </p>
        {suggestion.reasoning && (
          <p className="text-[9px] text-slate-400 italic mb-1">{suggestion.reasoning}</p>
        )}
        {suggestion.status === 'pending' && (
          <div className="flex items-center gap-1 flex-wrap">
            <button onClick={() => props.onApplyAiSuggestion(suggestion.id, 'single')}
              className="px-2 py-0.5 text-[10px] bg-green-50 text-green-700 rounded hover:bg-green-100">Zastosuj</button>
            <button onClick={() => props.onApplyAiSuggestion(suggestion.id, 'similar')}
              className="px-2 py-0.5 text-[10px] bg-blue-50 text-blue-700 rounded hover:bg-blue-100">Do podobnych</button>
            <button onClick={() => props.onRejectAiSuggestion(suggestion.id)}
              className="px-2 py-0.5 text-[10px] bg-red-50 text-red-600 rounded hover:bg-red-100">Odrzuc</button>
            {props.onEditAiSuggestion && (
              <button onClick={() => props.onEditAiSuggestion!(suggestion.id)}
                className="px-2 py-0.5 text-[10px] bg-slate-50 text-slate-600 rounded hover:bg-slate-100">Edytuj recznie</button>
            )}
            {props.onCreateRuleFromSuggestion && (
              <button onClick={() => props.onCreateRuleFromSuggestion!(suggestion.id)}
                className="px-2 py-0.5 text-[10px] bg-indigo-50 text-indigo-700 rounded hover:bg-indigo-100">Utwarz regule</button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      {props.aiSuggestions.length === 0 ? (
        <div className="p-6 text-center">
          <Sparkles className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-xs text-slate-400 mb-3">Brak rozpoznan AI. Uruchom analize i rozpoznanie.</p>
          <button onClick={props.onAiRecognize} disabled={props.aiStatus === 'loading' || props.objectCount === 0}
            className="px-4 py-2 bg-purple-600 text-white text-xs font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50">
            {props.aiStatus === 'loading' ? 'Przetwarzanie...' : 'Uruchom AI'}
          </button>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {confident.length > 0 && (
            <div>
              <div className="px-3 py-1.5 bg-green-50 text-[10px] font-bold text-green-700 sticky top-0">
                Pewnie rozpoznane ({confident.length})
              </div>
              {confident.map(s => <SuggestionRow key={s.id} suggestion={s} />)}
            </div>
          )}
          {needsReview.length > 0 && (
            <div>
              <div className="px-3 py-1.5 bg-amber-50 text-[10px] font-bold text-amber-700 sticky top-0">
                Do przejrzenia ({needsReview.length})
              </div>
              {needsReview.map(s => <SuggestionRow key={s.id} suggestion={s} />)}
            </div>
          )}
          {lowConfidence.length > 0 && (
            <div>
              <div className="px-3 py-1.5 bg-red-50 text-[10px] font-bold text-red-700 sticky top-0">
                Niska pewnosc ({lowConfidence.length})
              </div>
              {lowConfidence.map(s => <SuggestionRow key={s.id} suggestion={s} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ---- BOQ Tab ----
const BoqTab: React.FC<WorkspaceRightPanelProps> = (props) => {
  const [viewMode, setViewMode] = React.useState<'flat' | 'category' | 'level'>('flat');
  const [expandedRows, setExpandedRows] = React.useState<Set<string>>(new Set());
  const [editingRowId, setEditingRowId] = React.useState<string | null>(null);
  const [editForm, setEditForm] = React.useState<{ name: string; quantity: string; unit: string }>({ name: '', quantity: '', unit: '' });
  const [selectedRowIds, setSelectedRowIds] = React.useState<Set<string>>(new Set());

  const rows = props.boqRows;

  const grouped = viewMode === 'category'
    ? rows.reduce((acc, r) => {
        const key = r.category || 'Inne';
        if (!acc[key]) acc[key] = [];
        acc[key].push(r);
        return acc;
      }, {} as Record<string, BoqRow[]>)
    : viewMode === 'level'
    ? rows.reduce((acc, r) => {
        const key = r.level || 'Brak poziomu';
        if (!acc[key]) acc[key] = [];
        acc[key].push(r);
        return acc;
      }, {} as Record<string, BoqRow[]>)
    : null;

  const startEdit = (row: BoqRow) => {
    setEditingRowId(row.id);
    setEditForm({ name: row.name, quantity: String(row.quantity), unit: row.unit });
  };

  const saveEdit = () => {
    if (!editingRowId) return;
    const qty = parseFloat(editForm.quantity);
    props.onEditBoqRow(editingRowId, {
      name: editForm.name,
      quantity: isNaN(qty) ? undefined : qty,
      unit: editForm.unit,
    });
    setEditingRowId(null);
  };

  const cancelEdit = () => setEditingRowId(null);

  const toggleRowSelection = (rowId: string) => {
    setSelectedRowIds(prev => {
      const next = new Set(prev);
      next.has(rowId) ? next.delete(rowId) : next.add(rowId);
      return next;
    });
  };

  const BoqRowItem: React.FC<{ row: BoqRow }> = ({ row }) => {
    const isSelected = props.selectedBoqRowId === row.id;
    const isExpanded = expandedRows.has(row.id);
    const isEditing = editingRowId === row.id;
    const isRowChecked = selectedRowIds.has(row.id);

    if (isEditing) {
      return (
        <div className="px-3 py-2 border-b border-slate-100 bg-amber-50">
          <div className="space-y-1.5">
            <div>
              <label className="text-[9px] text-slate-500 font-medium">Nazwa</label>
              <input
                value={editForm.name}
                onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                className="w-full px-2 py-1 text-[11px] border border-slate-200 rounded bg-white"
                autoFocus
              />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-[9px] text-slate-500 font-medium">Ilosc</label>
                <input
                  value={editForm.quantity}
                  onChange={e => setEditForm(prev => ({ ...prev, quantity: e.target.value }))}
                  className="w-full px-2 py-1 text-[11px] border border-slate-200 rounded bg-white"
                  type="number"
                  step="any"
                />
              </div>
              <div className="w-20">
                <label className="text-[9px] text-slate-500 font-medium">Jedn.</label>
                <input
                  value={editForm.unit}
                  onChange={e => setEditForm(prev => ({ ...prev, unit: e.target.value }))}
                  className="w-full px-2 py-1 text-[11px] border border-slate-200 rounded bg-white"
                />
              </div>
            </div>
            <div className="flex items-center gap-1.5 pt-1">
              <button onClick={saveEdit} className="px-2 py-0.5 text-[10px] bg-blue-600 text-white rounded hover:bg-blue-700">Zapisz</button>
              <button onClick={cancelEdit} className="px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-200 rounded">Anuluj</button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div>
        <div
          className={`px-3 py-2 border-b border-slate-50 cursor-pointer transition-colors ${
            isSelected ? 'bg-blue-50 border-l-2 border-l-blue-500' : 'hover:bg-slate-50'
          }`}
          onClick={() => props.onSelectBoqRow(row.id)}
        >
          <div className="flex items-center justify-between mb-0.5">
            <div className="flex items-center gap-1.5">
              {/* Selection checkbox for merge */}
              <input
                type="checkbox"
                checked={isRowChecked}
                onChange={e => { e.stopPropagation(); toggleRowSelection(row.id); }}
                onClick={e => e.stopPropagation()}
                className="w-3 h-3 flex-shrink-0 accent-blue-600"
              />
              {row.sourceObjectIds.length > 0 && (
                <button onClick={e => { e.stopPropagation(); setExpandedRows(prev => { const next = new Set(prev); next.has(row.id) ? next.delete(row.id) : next.add(row.id); return next; }); }}
                  className="p-0.5 hover:bg-slate-200 rounded">
                  {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                </button>
              )}
              <span className="text-[10px] text-slate-400 font-mono">{row.code}</span>
              <span className="text-[11px] font-medium text-slate-800 truncate">{row.name}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold text-slate-700">{row.quantity}</span>
              <span className="text-[10px] text-slate-500">{row.unit}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 ml-6">
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
              row.status === 'approved' ? 'bg-green-100 text-green-700'
              : row.status === 'needs-review' ? 'bg-amber-100 text-amber-700'
              : row.status === 'rejected' ? 'bg-red-100 text-red-700'
              : 'bg-slate-100 text-slate-600'
            }`}>
              {row.status === 'approved' ? 'Zatwierdzony' : row.status === 'needs-review' ? 'Do przejrzenia' : row.status === 'rejected' ? 'Odrzucony' : row.status}
            </span>
            {row.confidence !== undefined && (
              <span className={`text-[9px] font-medium ${row.confidence >= 0.8 ? 'text-green-600' : row.confidence >= 0.5 ? 'text-amber-600' : 'text-red-600'}`}>
                {(row.confidence * 100).toFixed(0)}%
              </span>
            )}
            <span className="text-[9px] text-slate-400">{row.sourceType}</span>
          </div>
          {/* Row actions */}
          <div className="flex items-center gap-1 mt-1 ml-6 flex-wrap">
            <button onClick={e => { e.stopPropagation(); props.onHighlightObjects(row.sourceObjectIds); }}
              className="px-1.5 py-0.5 text-[9px] text-blue-600 hover:bg-blue-50 rounded">Pokaz</button>
            <button onClick={e => { e.stopPropagation(); props.onApproveBoqRow(row.id); }}
              className="px-1.5 py-0.5 text-[9px] text-green-600 hover:bg-green-50 rounded">Zatwierdz</button>
            <button onClick={e => { e.stopPropagation(); startEdit(row); }}
              className="px-1.5 py-0.5 text-[9px] text-slate-600 hover:bg-slate-50 rounded">Edytuj</button>
            <button onClick={e => { e.stopPropagation(); props.onRejectBoqRow(row.id); }}
              className="px-1.5 py-0.5 text-[9px] text-red-600 hover:bg-red-50 rounded">Odrzuc</button>
            {props.onSplitBoqRow && (
              <button onClick={e => { e.stopPropagation(); props.onSplitBoqRow!(row.id); }}
                className="px-1.5 py-0.5 text-[9px] text-indigo-600 hover:bg-indigo-50 rounded">Podziel</button>
            )}
            {props.onCompareBoqWithPrevious && (
              <button onClick={e => { e.stopPropagation(); props.onCompareBoqWithPrevious!(row.id); }}
                className="px-1.5 py-0.5 text-[9px] text-purple-600 hover:bg-purple-50 rounded">Porownaj</button>
            )}
          </div>
        </div>
        {/* Expanded sources */}
        {isExpanded && (
          <div className="pl-8 pr-3 py-1 bg-slate-50 border-b border-slate-100">
            <p className="text-[9px] text-slate-500 mb-1">Zrodla ({row.sourceObjectIds.length}):</p>
            {row.sourceObjectIds.slice(0, 20).map(id => {
              const obj = props.objects.find(o => o.id === id);
              return (
                <div key={id} className="flex items-center gap-1 py-0.5 text-[10px]">
                  <button onClick={() => props.onSelectObject(id)} className="text-blue-600 hover:underline truncate flex-1">
                    {obj?.name || id}
                  </button>
                  {props.onRemoveBoqSource && (
                    <button onClick={() => props.onRemoveBoqSource!(row.id, id)}
                      className="p-0.5 hover:bg-red-100 rounded text-slate-400 hover:text-red-500 flex-shrink-0" title="Usun zrodlo">
                      <Minus className="w-2.5 h-2.5" />
                    </button>
                  )}
                </div>
              );
            })}
            {row.sourceObjectIds.length > 20 && (
              <p className="text-[9px] text-slate-400 mt-1">...i jeszcze {row.sourceObjectIds.length - 20}</p>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="p-2 border-b border-slate-100 flex-shrink-0">
        <div className="flex items-center gap-1 mb-1.5">
          <select value={viewMode} onChange={e => setViewMode(e.target.value as any)}
            className="px-2 py-1 text-[10px] border border-slate-200 rounded-lg flex-1">
            <option value="flat">Lista</option>
            <option value="category">Kategorie</option>
            <option value="level">Poziomy</option>
          </select>
          <button onClick={props.onGenerateBoq} disabled={props.boqStatus === 'loading'}
            className="px-2 py-1 text-[10px] font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
            {props.boqStatus === 'loading' ? 'Generuje...' : 'Generuj'}
          </button>
          <button onClick={props.onGenerateBoqAi} disabled={props.boqStatus === 'loading'}
            className="px-2 py-1 text-[10px] font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50">
            AI BOQ
          </button>
          {rows.length > 0 && (
            <button onClick={props.onExportBoq}
              className="px-2 py-1 text-[10px] font-medium bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200">
              <Download className="w-3 h-3" />
            </button>
          )}
        </div>
        {/* Top actions: Add row manually, Recalculate, Approve all */}
        <div className="flex items-center gap-1 mb-1.5">
          {props.onAddBoqRowManually && (
            <button onClick={props.onAddBoqRowManually}
              className="px-2 py-1 text-[10px] font-medium bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 flex items-center gap-1">
              <Plus className="w-3 h-3" /> Dodaj recznie
            </button>
          )}
          {props.onRecalculateBoq && (
            <button onClick={props.onRecalculateBoq}
              className="px-2 py-1 text-[10px] font-medium bg-slate-50 text-slate-700 rounded-lg hover:bg-slate-100 flex items-center gap-1">
              <RefreshCw className="w-3 h-3" /> Przelicz
            </button>
          )}
          {props.onApproveAllBoq && rows.length > 0 && (
            <button onClick={props.onApproveAllBoq}
              className="px-2 py-1 text-[10px] font-medium bg-green-50 text-green-700 rounded-lg hover:bg-green-100 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Zatwierdz wszystko
            </button>
          )}
        </div>
        {/* Merge action when multiple rows selected */}
        {selectedRowIds.size >= 2 && props.onMergeBoqRows && (
          <div className="mb-1.5">
            <button onClick={() => { props.onMergeBoqRows!(Array.from(selectedRowIds)); setSelectedRowIds(new Set()); }}
              className="px-2 py-1 text-[10px] font-medium bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100 flex items-center gap-1">
              <ArrowUpDown className="w-3 h-3" /> Polacz zaznaczone ({selectedRowIds.size})
            </button>
          </div>
        )}
        <div className="text-[10px] text-slate-500">
          {rows.length} pozycji | Suma: {rows.reduce((s, r) => s + r.quantity, 0).toFixed(1)}
        </div>
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <div className="p-6 text-center">
            <BookOpen className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-xs text-slate-400">Brak pozycji BOQ. Uruchom generowanie.</p>
          </div>
        ) : grouped ? (
          Object.entries(grouped).map(([group, groupRows]) => (
            <div key={group}>
              <div className="px-3 py-1.5 bg-slate-50 text-[10px] font-bold text-slate-700 sticky top-0 border-b border-slate-200">
                {group} ({groupRows.length})
              </div>
              {groupRows.map(r => <BoqRowItem key={r.id} row={r} />)}
            </div>
          ))
        ) : (
          rows.map(r => <BoqRowItem key={r.id} row={r} />)
        )}
      </div>
    </div>
  );
};

// ---- Compare Tab ----
const CompareTab: React.FC<WorkspaceRightPanelProps> = (props) => {
  const versions = props.compareVersions || [];
  const isLoading = props.compareStatus === 'loading';

  return (
    <div className="p-3 space-y-3">
      {/* Version selector */}
      <div>
        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Porownaj z wersja:</label>
        {versions.length === 0 ? (
          <p className="text-xs text-slate-400 mt-1">Brak innych wersji do porownania.</p>
        ) : (
          <div className="mt-1 space-y-1">
            {versions.map(v => (
              <button
                key={v.id}
                disabled={isLoading}
                onClick={() => props.onRunCompare?.(v.id)}
                className="w-full text-left px-3 py-2 text-xs border border-slate-200 rounded-lg hover:bg-blue-50 hover:border-blue-300 transition disabled:opacity-50"
              >
                <span className="font-medium text-slate-700">{v.name}</span>
                <span className="ml-2 text-slate-400">v{v.version}</span>
              </button>
            ))}
          </div>
        )}
        {isLoading && (
          <div className="flex items-center gap-2 mt-2 text-xs text-blue-600">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Porownywanie...
          </div>
        )}
      </div>

      {/* Results */}
      {props.compareResult && (
        <>
          <div className="border-t pt-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-green-700 font-medium">Dodane</span>
              <span className="text-xs font-bold text-green-700">{props.compareResult.addedObjects.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-red-600 font-medium">Usuniete</span>
              <span className="text-xs font-bold text-red-600">{props.compareResult.removedObjects.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-amber-600 font-medium">Zmienione</span>
              <span className="text-xs font-bold text-amber-600">{props.compareResult.changedObjects.length}</span>
            </div>
          </div>

          {/* Actions: Accept / Reject / Recalculate */}
          <div className="flex items-center gap-1.5 pt-2 border-t border-slate-100">
            {props.onAcceptCompareChanges && (
              <button onClick={props.onAcceptCompareChanges}
                className="px-3 py-1.5 text-[10px] font-medium bg-green-50 text-green-700 rounded-lg hover:bg-green-100 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Akceptuj zmiany
              </button>
            )}
            {props.onRejectCompareChanges && (
              <button onClick={props.onRejectCompareChanges}
                className="px-3 py-1.5 text-[10px] font-medium bg-red-50 text-red-600 rounded-lg hover:bg-red-100 flex items-center gap-1">
                <X className="w-3 h-3" /> Odrzuc zmiany
              </button>
            )}
            {props.onRecalculateDelta && (
              <button onClick={props.onRecalculateDelta}
                className="px-3 py-1.5 text-[10px] font-medium bg-slate-50 text-slate-700 rounded-lg hover:bg-slate-100 flex items-center gap-1">
                <RefreshCw className="w-3 h-3" /> Przelicz delta
              </button>
            )}
          </div>

          {props.compareResult.addedObjects.length > 0 && (
            <div>
              <h5 className="text-[10px] font-bold text-green-700 mb-1">Dodane obiekty</h5>
              {props.compareResult.addedObjects.slice(0, 20).map(o => (
                <div key={o.id} className="text-[10px] text-slate-600 py-0.5 flex items-center gap-1">
                  <div className="w-1.5 h-1.5 bg-green-400 rounded-full" />
                  <button onClick={() => props.onHighlightObjects([o.id])} className="hover:text-blue-600 truncate">{o.name}</button>
                </div>
              ))}
            </div>
          )}

          {props.compareResult.removedObjects.length > 0 && (
            <div>
              <h5 className="text-[10px] font-bold text-red-600 mb-1">Usuniete obiekty</h5>
              {props.compareResult.removedObjects.slice(0, 20).map(o => (
                <div key={o.id} className="text-[10px] text-slate-600 py-0.5 flex items-center gap-1">
                  <div className="w-1.5 h-1.5 bg-red-400 rounded-full" />
                  <span className="truncate line-through">{o.name}</span>
                </div>
              ))}
            </div>
          )}

          {props.compareResult.changedObjects.length > 0 && (
            <div>
              <h5 className="text-[10px] font-bold text-amber-600 mb-1">Zmienione obiekty</h5>
              {props.compareResult.changedObjects.slice(0, 20).map(({ before, after }) => (
                <div key={after.id} className="text-[10px] text-slate-600 py-0.5 flex items-center gap-1">
                  <div className="w-1.5 h-1.5 bg-amber-400 rounded-full" />
                  <button onClick={() => props.onHighlightObjects([after.id])} className="hover:text-blue-600 truncate">{after.name}</button>
                </div>
              ))}
            </div>
          )}

          {/* Delta BOQ rows */}
          {props.compareResult.deltaBoqRows.length > 0 && (
            <div className="border-t pt-3">
              <h5 className="text-[10px] font-bold text-slate-700 mb-1">Delta BOQ ({props.compareResult.deltaBoqRows.length})</h5>
              {props.compareResult.deltaBoqRows.map(row => (
                <div key={row.id} className={`flex items-center justify-between py-1 px-2 rounded text-[10px] mb-0.5 ${
                  row.status === 'delta-added' ? 'bg-green-50 text-green-700'
                  : row.status === 'delta-removed' ? 'bg-red-50 text-red-600 line-through'
                  : row.status === 'delta-changed' ? 'bg-amber-50 text-amber-700'
                  : 'bg-slate-50 text-slate-600'
                }`}>
                  <span className="truncate flex-1">{row.code ? `${row.code} - ` : ''}{row.name}</span>
                  <span className="font-bold ml-2">{row.quantity} {row.unit}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {!props.compareResult && versions.length > 0 && !isLoading && (
        <div className="text-center py-4">
          <GitCompare className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-xs text-slate-400">Wybierz wersje powyzej, aby porownac.</p>
        </div>
      )}
    </div>
  );
};

// ---- Annotations Tab ----
const AnnotationsTab: React.FC<WorkspaceRightPanelProps> = (props) => (
  <div className="p-3 space-y-2">
    {props.annotations.length === 0 ? (
      <div className="text-center py-6">
        <StickyNote className="w-8 h-8 text-slate-300 mx-auto mb-2" />
        <p className="text-xs text-slate-400">Brak adnotacji. Uzyj narzedzi rysowania ponizej.</p>
      </div>
    ) : props.annotations.map(ann => (
      <div key={ann.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 text-xs border border-slate-100">
        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: ann.strokeColor }} />
        <span className="flex-1 truncate text-slate-700">{ann.type}{ann.text ? `: ${ann.text}` : ''}</span>
        {ann.linkedBoqRowId && <Link2 className="w-3 h-3 text-green-500 flex-shrink-0" />}
        {/* Action buttons */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {props.onEditAnnotation && (
            <button onClick={() => props.onEditAnnotation!(ann.id)}
              className="p-0.5 hover:bg-blue-100 rounded text-slate-400 hover:text-blue-600" title="Edytuj">
              <Edit3 className="w-3 h-3" />
            </button>
          )}
          {props.onFocusAnnotation && (
            <button onClick={() => props.onFocusAnnotation!(ann.id)}
              className="p-0.5 hover:bg-indigo-100 rounded text-slate-400 hover:text-indigo-600" title="Pokaz na rysunku">
              <Eye className="w-3 h-3" />
            </button>
          )}
          {props.onLinkAnnotationToBoq && (
            <button onClick={() => props.onLinkAnnotationToBoq!(ann.id)}
              className="p-0.5 hover:bg-green-100 rounded text-slate-400 hover:text-green-600" title="Polacz z BOQ">
              <Link2 className="w-3 h-3" />
            </button>
          )}
          {props.onDeleteAnnotation && (
            <button onClick={() => props.onDeleteAnnotation!(ann.id)}
              className="p-0.5 hover:bg-red-100 rounded text-slate-400 hover:text-red-500" title="Usun">
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    ))}
  </div>
);

// ---- Measurements Tab ----
const MeasurementsTab: React.FC<WorkspaceRightPanelProps> = (props) => {
  const [linkingMeasurementId, setLinkingMeasurementId] = React.useState<string | null>(null);

  return (
    <div className="p-3 space-y-2">
      {/* Top actions */}
      {props.measurements.length > 0 && props.onExportMeasurements && (
        <div className="flex items-center gap-1 mb-2">
          <button onClick={props.onExportMeasurements}
            className="px-2 py-1 text-[10px] font-medium bg-slate-50 text-slate-700 rounded-lg hover:bg-slate-100 flex items-center gap-1">
            <Download className="w-3 h-3" /> Eksportuj pomiary
          </button>
        </div>
      )}
      {props.measurements.length === 0 ? (
        <div className="text-center py-6">
          <Ruler className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-xs text-slate-400">Brak pomiarow. Uzyj narzedzia pomiaru.</p>
        </div>
      ) : props.measurements.map(m => (
        <div key={m.id} className="px-2 py-1.5 rounded-lg hover:bg-slate-50 text-xs border border-slate-100">
          <div className="flex items-center gap-2">
            <Hash className="w-3 h-3 text-slate-400 flex-shrink-0" />
            <span className="flex-1 truncate text-slate-700">
              {m.label || m.type}: <span className="font-bold">{m.value.toFixed(2)} {m.unit}</span>
            </span>
            {m.linkedBoqRowId && <Link2 className="w-3 h-3 text-green-500 flex-shrink-0" />}
            {/* Action buttons */}
            <div className="flex items-center gap-0.5 flex-shrink-0">
              {props.onRenameMeasurement && (
                <button onClick={() => props.onRenameMeasurement!(m.id)}
                  className="p-0.5 hover:bg-blue-100 rounded text-slate-400 hover:text-blue-600" title="Zmien nazwe">
                  <Edit3 className="w-3 h-3" />
                </button>
              )}
              <button onClick={() => setLinkingMeasurementId(linkingMeasurementId === m.id ? null : m.id)}
                className="p-0.5 hover:bg-green-100 rounded text-slate-400 hover:text-green-600" title="Polacz z BOQ">
                <Link2 className="w-3 h-3" />
              </button>
              <button onClick={() => props.onDeleteMeasurement(m.id)}
                className="p-0.5 hover:bg-red-50 rounded text-slate-300 hover:text-red-500" title="Usun">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
          {/* Created by / created at */}
          <div className="flex items-center gap-2 mt-0.5 ml-5 text-[9px] text-slate-400">
            <span>Autor: {m.createdBy}</span>
            <span>{new Date(m.createdAt).toLocaleDateString('pl')}</span>
          </div>
          {/* Link to BOQ dropdown */}
          {linkingMeasurementId === m.id && props.boqRows.length > 0 && (
            <div className="mt-1.5 ml-5 p-1.5 bg-slate-50 rounded border border-slate-200 max-h-32 overflow-y-auto">
              <p className="text-[9px] text-slate-500 mb-1">Wybierz pozycje BOQ:</p>
              {props.boqRows.map(row => (
                <button key={row.id}
                  onClick={() => { props.onLinkMeasurementToBoq(m.id, row.id); setLinkingMeasurementId(null); }}
                  className="w-full text-left px-2 py-0.5 text-[10px] text-slate-700 hover:bg-blue-50 rounded truncate">
                  {row.code ? `${row.code} - ` : ''}{row.name}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

// ---- Comments Tab ----
const CommentsTab: React.FC<WorkspaceRightPanelProps> = (props) => (
  <div className="p-3 space-y-2">
    {props.comments.length === 0 ? (
      <div className="text-center py-6">
        <MessageSquare className="w-8 h-8 text-slate-300 mx-auto mb-2" />
        <p className="text-xs text-slate-400">Brak komentarzy. Uzyj narzedzia komentarza.</p>
      </div>
    ) : props.comments.map(c => {
      const scope = c.objectId ? 'obiekt' : c.boqRowId ? 'BOQ' : c.annotationId ? 'adnotacja' : 'plik';
      const scopeColor = c.objectId ? 'bg-blue-100 text-blue-700'
        : c.boqRowId ? 'bg-green-100 text-green-700'
        : c.annotationId ? 'bg-purple-100 text-purple-700'
        : 'bg-slate-100 text-slate-600';
      return (
        <div key={c.id} className={`px-3 py-2 rounded-lg border ${c.isResolved ? 'border-green-200 bg-green-50' : 'border-slate-200'}`}>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-medium text-slate-700">{c.authorName}</span>
              <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-medium ${scopeColor}`}>{scope}</span>
            </div>
            <span className="text-[9px] text-slate-400">{new Date(c.createdAt).toLocaleDateString('pl')}</span>
          </div>
          <p className="text-xs text-slate-600">{c.content}</p>
          {c.replies.length > 0 && (
            <div className="mt-1.5 pl-3 border-l-2 border-slate-200 space-y-1">
              {c.replies.map(r => (
                <div key={r.id}>
                  <span className="text-[9px] font-medium text-slate-600">{r.authorName}: </span>
                  <span className="text-[10px] text-slate-500">{r.content}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    })}
  </div>
);

// ---- Photos Tab ----
const PhotosTab: React.FC<WorkspaceRightPanelProps> = (props) => {
  const photos = props.photos || [];
  if (photos.length === 0) {
    return (
      <div className="p-6 text-center">
        <Camera className="w-8 h-8 text-slate-300 mx-auto mb-2" />
        <p className="text-xs text-slate-400">Brak zdjec. Przypnij zdjecie do planu uzywajac narzedzia aparatu.</p>
      </div>
    );
  }

  const getLinkedEntityLabel = (photo: typeof photos[0]): string | null => {
    if (photo.linkedObjectId) {
      const obj = props.objects.find(o => o.id === photo.linkedObjectId);
      return `Obiekt: ${obj?.name || photo.linkedObjectId}`;
    }
    if (photo.linkedBoqRowId) {
      const row = props.boqRows.find(r => r.id === photo.linkedBoqRowId);
      return `BOQ: ${row?.name || photo.linkedBoqRowId}`;
    }
    if (photo.linkedAnnotationId) {
      return `Adnotacja: ${photo.linkedAnnotationId}`;
    }
    return null;
  };

  return (
    <div className="p-2 space-y-2">
      <p className="text-[10px] text-slate-500 px-1">{photos.length} zdjec przypiętych do planu</p>
      {photos.map(photo => {
        const linkedLabel = getLinkedEntityLabel(photo);
        return (
          <div key={photo.id} className="border border-slate-200 rounded-lg overflow-hidden bg-white">
            <img src={photo.url} alt={photo.label || 'Zdjecie'} className="w-full h-32 object-cover" />
            <div className="px-2 py-1.5">
              <div className="flex items-center justify-between">
                <div>
                  {photo.label && <span className="text-[11px] font-medium text-slate-700 block">{photo.label}</span>}
                  <span className="text-[9px] text-slate-400">x:{Math.round(photo.x)} y:{Math.round(photo.y)}</span>
                </div>
                <div className="flex items-center gap-1">
                  <a href={photo.url} target="_blank" rel="noopener noreferrer"
                    className="px-1.5 py-0.5 text-[9px] text-blue-600 hover:bg-blue-50 rounded">
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  {props.onDeletePhoto && (
                    <button onClick={() => props.onDeletePhoto!(photo.id)}
                      className="px-1.5 py-0.5 text-[9px] text-red-600 hover:bg-red-50 rounded">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
              {/* Linked entity indicator */}
              {linkedLabel && (
                <div className="mt-1 flex items-center gap-1">
                  <Link2 className="w-2.5 h-2.5 text-green-500" />
                  <span className="text-[9px] text-green-700 truncate">{linkedLabel}</span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ---- Errors Tab ----
const ErrorsTab: React.FC<WorkspaceRightPanelProps> = (props) => (
  <div className="p-3 space-y-2">
    {props.errors.length === 0 ? (
      <div className="text-center py-6">
        <CheckCircle2 className="w-8 h-8 text-green-300 mx-auto mb-2" />
        <p className="text-xs text-slate-400">Brak bledow. Wszystko dziala poprawnie.</p>
      </div>
    ) : props.errors.map(err => (
      <div key={err.id} className={`px-3 py-2 rounded-lg border ${
        err.severity === 'error' ? 'border-red-200 bg-red-50'
        : err.severity === 'warning' ? 'border-amber-200 bg-amber-50'
        : 'border-blue-200 bg-blue-50'
      }`}>
        <div className="flex items-center justify-between mb-1">
          <span className={`text-[10px] font-bold ${
            err.severity === 'error' ? 'text-red-700' : err.severity === 'warning' ? 'text-amber-700' : 'text-blue-700'
          }`}>
            {err.type}
          </span>
          <span className="text-[9px] text-slate-400">{new Date(err.timestamp).toLocaleTimeString('pl')}</span>
        </div>
        <p className="text-xs text-slate-700 mb-1">{err.message}</p>
        <div className="flex items-center gap-1 flex-wrap">
          {err.retryable && (
            <button onClick={() => props.onRetryError(err.id)}
              className="flex items-center gap-1 text-[10px] text-blue-600 hover:text-blue-800 hover:bg-blue-100 px-1.5 py-0.5 rounded">
              <RefreshCw className="w-3 h-3" /> Ponow
            </button>
          )}
          {props.onOpenErrorLogs && (
            <button onClick={() => props.onOpenErrorLogs!(err.id)}
              className="flex items-center gap-1 text-[10px] text-slate-600 hover:text-slate-800 hover:bg-slate-100 px-1.5 py-0.5 rounded">
              <Terminal className="w-3 h-3" /> Logi
            </button>
          )}
          {props.onIgnoreError && (
            <button onClick={() => props.onIgnoreError!(err.id)}
              className="flex items-center gap-1 text-[10px] text-amber-600 hover:text-amber-800 hover:bg-amber-100 px-1.5 py-0.5 rounded">
              <EyeOff className="w-3 h-3" /> Ignoruj
            </button>
          )}
          {props.onResolveError && (
            <button onClick={() => props.onResolveError!(err.id)}
              className="flex items-center gap-1 text-[10px] text-green-600 hover:text-green-800 hover:bg-green-100 px-1.5 py-0.5 rounded">
              <CheckCircle2 className="w-3 h-3" /> Rozwiaz recznie
            </button>
          )}
        </div>
      </div>
    ))}
  </div>
);

export default WorkspaceRightPanel;
