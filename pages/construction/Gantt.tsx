import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  ArrowLeft, ChevronRight, ChevronDown, Calendar, Clock, Users,
  Plus, Settings, Download, Loader2, ZoomIn, ZoomOut, Filter,
  ChevronLeft, Link as LinkIcon, Milestone, Search, X, Save,
  Pencil, Trash2, Flag, Play, AlertCircle, Check, FileText,
  Briefcase, ListTree, ClipboardList, MoreVertical, GripVertical,
  Eye, EyeOff, Maximize2, Minimize2, Upload, FileDown, ChevronUp,
  MoreHorizontal, ArrowRight, Undo2, Redo2, Copy, ClipboardPaste,
  HelpCircle, MoveRight, MoveLeft, CheckCircle2, Diamond,
  Shield, Map, Wrench, Package, FileQuestion, Camera, Layers,
  TrendingUp, Target, BarChart3, Activity, Bookmark, BookmarkCheck
} from 'lucide-react';
import { useAppContext } from '../../context/AppContext';
import { supabase } from '../../lib/supabase';
import { Project, GanttTask, GanttDependency, GanttDependencyType, Offer, KosztorysEstimate } from '../../types';
import { GANTT_DEPENDENCY_LABELS, GANTT_DEPENDENCY_SHORT_LABELS } from '../../constants';
import {
  buildTaskTree as buildTree, flattenTasks as flattenUtil, flattenAll,
  getDaysBetween, isWorkingDay, getNextWorkingDay, addWorkingDays as addWD,
  countWorkingDays, workingDaysFromMask, maskFromWorkingDays,
  formatDuration as fmtDuration, formatDatePL,
  calcParentStartDate, calcParentEndDate, calcParentDuration, calcParentProgress,
  recalcParents, hasCircularDependency, validateDependency, validatePhaseForm,
  findCriticalPath, autoSchedule,
  GanttTaskNode, GanttDepRecord
} from '../../lib/ganttUtils';
import {
  GanttZone, GanttNorm, GanttConditionFactor, GanttMaterial, GanttRFI,
  GanttWorkOrder, GanttEvidence, GanttAcceptedAct, GanttBaseline, GanttScenario,
  LPSStatus, LPS_STATUS_LABELS, LPS_STATUS_COLORS,
  DEFAULT_NORMS, DEFAULT_CONDITION_FACTORS, DECOMPOSITION_TEMPLATES,
  calculateDurationFromNorm, filterLookaheadTasks, calculateRiskBuffer,
  generateWorkOrderNumber, generatePredictiveInsights, whatIfAddCrew, whatIfMaterialDelay,
  calculateEVM, type PredictiveInsight, BaselineTaskSnapshot
} from '../../lib/ganttAdvanced';

type ZoomLevel = 'day' | 'week' | 'month';

interface GanttTaskWithChildren extends GanttTask {
  children?: GanttTaskWithChildren[];
  isExpanded?: boolean;
  level?: number;
  wbs?: string;
}

type WizardStep = 'project' | 'time' | 'tasks' | 'resources';
type TaskImportMode = 'empty' | 'general' | 'detailed';
type ResourcePriority = 'slowest' | 'labor' | 'equipment';

interface HistoryEntry {
  type: 'update' | 'delete' | 'create';
  taskId?: string;
  depId?: string;
  before?: any;
  after?: any;
  children?: any[];
  deps?: any[];
}

interface InlineEditState {
  taskId: string;
  field: 'title' | 'duration';
  value: string;
}

interface FilterState {
  priorities: string[];
  statuses: string[];
  criticalOnly: boolean;
}

interface WizardFormData {
  project_id: string;
  estimate_id: string;
  offer_id: string;
  start_date: string;
  deadline: string;
  working_days: boolean[];
  day_start: string;
  work_hours: number;
  task_mode: TaskImportMode;
  resource_priority: ResourcePriority;
}

const WIZARD_STEPS: { key: WizardStep; label: string; icon: React.ReactNode }[] = [
  { key: 'project', label: 'Wybierz projekt', icon: <Briefcase className="w-4 h-4" /> },
  { key: 'time', label: 'Czas i kalendarz', icon: <Calendar className="w-4 h-4" /> },
  { key: 'tasks', label: 'Zadania', icon: <ListTree className="w-4 h-4" /> },
  { key: 'resources', label: 'Zasoby', icon: <Users className="w-4 h-4" /> },
];

const DAY_LABELS = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb', 'Nd'];
const DAY_NAMES_FULL = ['Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota', 'Niedziela'];
const TIME_OPTIONS = Array.from({ length: 24 }, (_, i) => `${i.toString().padStart(2, '0')}:00`);

const DEFAULT_WIZARD_FORM: WizardFormData = {
  project_id: '', estimate_id: '', offer_id: '',
  start_date: new Date().toISOString().split('T')[0], deadline: '',
  working_days: [true, true, true, true, true, false, false],
  day_start: '07:00', work_hours: 8, task_mode: 'detailed', resource_priority: 'slowest',
};

const TASK_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#ef4444', '#ec4899'];
const PARENT_COLOR = '#3b82f6';
const DEP_TYPES: GanttDependencyType[] = ['FS', 'SS', 'FF', 'SF'];

const POLISH_MONTHS = ['styczeń','luty','marzec','kwiecień','maj','czerwiec','lipiec','sierpień','wrzesień','październik','listopad','grudzień'];

const SearchableSelect: React.FC<{
  label: string; placeholder: string; value: string;
  onChange: (id: string) => void;
  options: { id: string; label: string; sublabel?: string }[];
  loading?: boolean; icon?: React.ReactNode;
}> = ({ label, placeholder, value, onChange, options, loading, icon }) => {
  const [open, setOpen] = useState(false);
  const [searchVal, setSearchVal] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);
  const filtered = options.filter(o => o.label.toLowerCase().includes(searchVal.toLowerCase()) || (o.sublabel && o.sublabel.toLowerCase().includes(searchVal.toLowerCase())));
  const selectedOption = options.find(o => o.id === value);
  return (
    <div ref={ref} className="relative">
      <label className="block text-sm font-medium text-slate-600 mb-1.5">{label}</label>
      <button type="button" onClick={() => setOpen(!open)}
        className={`w-full flex items-center gap-2 px-3 py-2.5 border rounded-xl text-left transition-all ${open ? 'border-blue-500 ring-2 ring-blue-100' : value ? 'border-blue-300' : 'border-slate-200 hover:border-slate-300'} ${value ? 'text-slate-900' : 'text-slate-400'}`}>
        {icon && <span className={value ? 'text-blue-600' : 'text-slate-400'}>{icon}</span>}
        <span className="flex-1 truncate">{selectedOption ? selectedOption.label : placeholder}</span>
        {value && <button type="button" onClick={e => { e.stopPropagation(); onChange(''); }} className="p-0.5 hover:bg-slate-100 rounded"><X className="w-3.5 h-3.5 text-slate-400" /></button>}
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
          <div className="p-2 border-b border-slate-100">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input type="text" value={searchVal} onChange={e => setSearchVal(e.target.value)} placeholder="Szukaj..." autoFocus
                className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-100 focus:border-blue-400" />
            </div>
          </div>
          <div className="max-h-52 overflow-y-auto">
            {loading ? <div className="flex items-center justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
            : filtered.length === 0 ? <div className="py-4 text-center text-sm text-slate-400">Brak wyników</div>
            : filtered.map(opt => (
              <button key={opt.id} type="button" onClick={() => { onChange(opt.id); setOpen(false); setSearchVal(''); }}
                className={`w-full text-left px-3 py-2.5 hover:bg-blue-50 transition-colors flex items-center gap-2 ${value === opt.id ? 'bg-blue-50' : ''}`}>
                {value === opt.id ? <Check className="w-4 h-4 text-blue-600 flex-shrink-0" /> : <span className="w-4 flex-shrink-0" />}
                <div>
                  <div className={`text-sm font-medium ${value === opt.id ? 'text-blue-700' : 'text-slate-700'}`}>{opt.label}</div>
                  {opt.sublabel && <div className="text-xs text-slate-400">{opt.sublabel}</div>}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// Context menu component
const ContextMenu: React.FC<{
  items: { label: string; icon?: React.ReactNode; onClick: () => void; danger?: boolean; divider?: boolean }[];
  onClose: () => void;
  position: { x: number; y: number };
}> = ({ items, onClose, position }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);
  return (
    <div ref={ref} className="fixed z-[100] bg-white rounded-lg shadow-xl border border-slate-200 py-1 min-w-[220px]"
      style={{ top: position.y, left: position.x }}>
      {items.map((item, i) => item.divider ? <div key={i} className="border-t border-slate-100 my-1" /> : (
        <button key={i} onClick={() => { item.onClick(); onClose(); }}
          className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2.5 hover:bg-slate-50 ${item.danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700'}`}>
          {item.icon}{item.label}
        </button>
      ))}
    </div>
  );
};

export const GanttPage: React.FC = () => {
  const { state } = useAppContext();
  const { currentUser, users } = state;
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<GanttTaskWithChildren[]>([]);
  const [dependencies, setDependencies] = useState<GanttDependency[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>('week');
  const [showDependencies, setShowDependencies] = useState(true);
  const [showCriticalPath, setShowCriticalPath] = useState(false);
  const [hideClosedTasks, setHideClosedTasks] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [depValidationError, setDepValidationError] = useState('');

  // Modals
  const [showPhaseModal, setShowPhaseModal] = useState(false);
  const [editingPhase, setEditingPhase] = useState<GanttTask | null>(null);
  const [showDepModal, setShowDepModal] = useState(false);
  const [editingDep, setEditingDep] = useState<GanttDependency | null>(null);
  const [showWorkingDaysModal, setShowWorkingDaysModal] = useState(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ task: GanttTaskWithChildren; x: number; y: number } | null>(null);

  // Project list modals
  const [showProjectEditModal, setShowProjectEditModal] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [projectForm, setProjectForm] = useState({ name: '', status: 'active', start_date: '', end_date: '' });

  // Wizard
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState<WizardStep>('project');
  const [wizardForm, setWizardForm] = useState<WizardFormData>({ ...DEFAULT_WIZARD_FORM });
  const [wizardSaving, setWizardSaving] = useState(false);
  const [allEstimates, setAllEstimates] = useState<any[]>([]);
  const [allOffers, setAllOffers] = useState<any[]>([]);
  const [estimateStages, setEstimateStages] = useState<any[]>([]);
  const [estimateItems, setEstimateItems] = useState<any[]>([]);
  const [estimateDataLoading, setEstimateDataLoading] = useState(false);

  // Phase form
  const [phaseForm, setPhaseForm] = useState({
    title: '', parent_id: '', planning_mode: 'auto' as 'auto' | 'manual',
    duration: 0, start_date: '', end_date: '', progress: 0,
    has_custom_progress: false, is_milestone: false, color: '#3b82f6',
    assigned_to_id: '', supervisor_id: '', approver_id: '',
    notes: '', priority: 'normal' as 'low' | 'normal' | 'high' | 'critical',
    zone_id: '', norm_id: '', quantity: 0, quantity_unit: '', selectedConditions: [] as string[]
  });

  // Dependency form
  const [depForm, setDepForm] = useState({
    predecessor_id: '', successor_id: '', dependency_type: 'FS' as GanttDependencyType, lag: 0
  });

  // Working days
  const [workingDays, setWorkingDays] = useState<boolean[]>([true, true, true, true, true, false, false]);
  const [harmonogramStart, setHarmonogramStart] = useState('');

  // Drag state for Gantt bars
  const [dragState, setDragState] = useState<{
    taskId: string; mode: 'move' | 'resize-start' | 'resize-end';
    startX: number; origLeft: number; origWidth: number;
    origStartDate: string; origEndDate: string;
  } | null>(null);
  const dragRef = useRef<typeof dragState>(null);
  const [dragPreview, setDragPreview] = useState<{ taskId: string; left: number; width: number } | null>(null);

  // Drag-to-connect dependency state
  const [connectDrag, setConnectDrag] = useState<{
    fromTaskId: string; fromSide: 'start' | 'end'; startX: number; startY: number; currentX: number; currentY: number;
  } | null>(null);
  const connectDragRef = useRef<typeof connectDrag>(null);

  // Splitter
  const [leftPanelWidth, setLeftPanelWidth] = useState(680);
  const splitterRef = useRef<boolean>(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const autoSelectDone = useRef(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const pendingScrollRef = useRef<{ left: number; top: number } | null>(null);
  const [chartScrollLeft, setChartScrollLeft] = useState(0);
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);

  // Undo/Redo
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);

  // Selection & clipboard
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [clipboardTask, setClipboardTask] = useState<any | null>(null);

  // Inline editing
  const [inlineEdit, setInlineEdit] = useState<InlineEditState | null>(null);

  // Filters
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [filters, setFilters] = useState<FilterState>({ priorities: [], statuses: [], criticalOnly: false });

  // Help overlay
  const [showHelp, setShowHelp] = useState(false);

  // Dependency hover
  const [hoveredDepId, setHoveredDepId] = useState<string | null>(null);

  // ========== ADVANCED FEATURES STATE ==========
  // Baseline
  const [baselines, setBaselines] = useState<GanttBaseline[]>([]);
  const [activeBaseline, setActiveBaseline] = useState<GanttBaseline | null>(null);
  const [showBaselineModal, setShowBaselineModal] = useState(false);
  const [baselineName, setBaselineName] = useState('');

  // Lookahead
  const [lookaheadMode, setLookaheadMode] = useState(false);
  const [lookaheadWeeks, setLookaheadWeeks] = useState(3);

  // Zones
  const [zones, setZones] = useState<GanttZone[]>([]);
  const [zoneForm, setZoneForm] = useState({ name: '', zone_type: 'floor' as string, floor_number: 0, color: '#3b82f6' });

  // Norms & Condition Factors
  const [norms, setNorms] = useState<GanttNorm[]>([]);
  const [conditionFactors, setConditionFactors] = useState<GanttConditionFactor[]>([]);

  // Materials
  const [materials, setMaterials] = useState<GanttMaterial[]>([]);

  // RFIs
  const [rfis, setRFIs] = useState<GanttRFI[]>([]);
  const [showRFIModal, setShowRFIModal] = useState(false);
  const [rfiForm, setRfiForm] = useState({ subject: '', question: '', assigned_to_id: '', due_date: '', priority: 'normal', gantt_task_id: '' });

  // Accepted Acts
  const [acceptedActs, setAcceptedActs] = useState<GanttAcceptedAct[]>([]);
  const [showActForm, setShowActForm] = useState(false);
  const [actForm, setActForm] = useState({ description: '', total_amount: 0, zone_id: '' });

  // Evidence
  const [showEvidenceModal, setShowEvidenceModal] = useState(false);
  const [evidenceTaskId, setEvidenceTaskId] = useState<string | null>(null);
  const [taskEvidence, setTaskEvidence] = useState<GanttEvidence[]>([]);
  const [evidenceForm, setEvidenceForm] = useState({ evidence_type: 'photo' as string, description: '', file_url: '' });

  // Work Orders
  const [workOrders, setWorkOrders] = useState<GanttWorkOrder[]>([]);

  // Material form
  const [showAddMaterial, setShowAddMaterial] = useState(false);
  const [materialForm, setMaterialForm] = useState({ gantt_task_id: '', name: '', quantity: 0, unit: 'szt', unit_price: 0, supplier: '', delivery_date: '' });

  // Predictive Insights
  const [showInsights, setShowInsights] = useState(false);
  const [insights, setInsights] = useState<PredictiveInsight[]>([]);

  // Advanced panel toggle
  const [showAdvancedPanel, setShowAdvancedPanel] = useState<string | null>(null); // 'baseline' | 'lookahead' | 'zones' | 'materials' | 'rfis' | 'insights'

  // Load evidence when evidence modal opens for a task
  useEffect(() => {
    if (!evidenceTaskId) { setTaskEvidence([]); return; }
    (async () => {
      try {
        const { data, error } = await supabase.from('gantt_evidence').select('*').eq('gantt_task_id', evidenceTaskId).order('created_at', { ascending: false });
        if (error) { showError('Błąd ładowania dowodów: ' + error.message); return; }
        if (data) setTaskEvidence(data as any);
      } catch (err: any) { showError('Błąd ładowania dowodów: ' + (err?.message || err)); }
    })();
  }, [evidenceTaskId]);

  // Auto-dismiss notifications
  useEffect(() => {
    if (errorMsg) { const t = setTimeout(() => setErrorMsg(''), 5000); return () => clearTimeout(t); }
  }, [errorMsg]);
  useEffect(() => {
    if (successMsg) { const t = setTimeout(() => setSuccessMsg(''), 3000); return () => clearTimeout(t); }
  }, [successMsg]);

  const showError = (msg: string) => { setErrorMsg(msg); console.error(msg); };
  const showSuccess = (msg: string) => setSuccessMsg(msg);

  // Undo/Redo system
  const pushHistory = useCallback((entry: HistoryEntry) => {
    setUndoStack(prev => [...prev.slice(-49), entry]);
    setRedoStack([]);
  }, []);

  const handleUndo = useCallback(async () => {
    if (undoStack.length === 0) return;
    const entry = undoStack[undoStack.length - 1];
    setUndoStack(prev => prev.slice(0, -1));
    setRedoStack(prev => [...prev, entry]);
    try {
      if (entry.type === 'update' && entry.taskId && entry.before) {
        await supabase.from('gantt_tasks').update(entry.before).eq('id', entry.taskId);
      } else if (entry.type === 'delete' && entry.before) {
        await supabase.from('gantt_tasks').insert(entry.before);
        if (entry.children) for (const c of entry.children) await supabase.from('gantt_tasks').insert(c);
        if (entry.deps) for (const d of entry.deps) await supabase.from('gantt_dependencies').insert(d);
      } else if (entry.type === 'create' && entry.taskId) {
        await supabase.from('gantt_dependencies').delete().or(`predecessor_id.eq.${entry.taskId},successor_id.eq.${entry.taskId}`);
        await supabase.from('gantt_tasks').delete().eq('id', entry.taskId);
      }
      await loadGanttDataKeepScroll();
      showSuccess('Cofnięto.');
    } catch (err: any) { showError('Błąd cofania: ' + (err?.message || err)); }
  }, [undoStack, selectedProject]);

  const handleRedo = useCallback(async () => {
    if (redoStack.length === 0) return;
    const entry = redoStack[redoStack.length - 1];
    setRedoStack(prev => prev.slice(0, -1));
    setUndoStack(prev => [...prev, entry]);
    try {
      if (entry.type === 'update' && entry.taskId && entry.after) {
        await supabase.from('gantt_tasks').update(entry.after).eq('id', entry.taskId);
      } else if (entry.type === 'delete' && entry.taskId) {
        if (entry.children) for (const c of entry.children) await supabase.from('gantt_tasks').delete().eq('id', c.id);
        if (entry.deps) for (const d of entry.deps) await supabase.from('gantt_dependencies').delete().eq('id', d.id);
        await supabase.from('gantt_tasks').delete().eq('id', entry.taskId);
      } else if (entry.type === 'create' && entry.after) {
        await supabase.from('gantt_tasks').insert(entry.after);
      }
      await loadGanttDataKeepScroll();
      showSuccess('Ponowiono.');
    } catch (err: any) { showError('Błąd ponowienia: ' + (err?.message || err)); }
  }, [redoStack, selectedProject]);

  // Critical path calculation
  const criticalPathIds = useMemo(() => {
    if (!showCriticalPath || dependencies.length === 0) return new Set<string>();
    return findCriticalPath(tasks as GanttTaskNode[], dependencies as GanttDepRecord[]);
  }, [showCriticalPath, tasks, dependencies]);

  // Track chart scroll for smart Today button + sync vertical scroll between panels
  useEffect(() => {
    const el = chartRef.current;
    const lp = leftPanelRef.current;
    if (!el) return;
    let syncing = false;
    const handler = () => {
      setChartScrollLeft(el.scrollLeft);
      if (!syncing && lp) { syncing = true; lp.scrollTop = el.scrollTop; syncing = false; }
    };
    const leftHandler = () => {
      if (!syncing && el && lp) { syncing = true; el.scrollTop = lp.scrollTop; syncing = false; }
    };
    el.addEventListener('scroll', handler, { passive: true });
    if (lp) lp.addEventListener('scroll', leftHandler, { passive: true });
    return () => {
      el.removeEventListener('scroll', handler);
      if (lp) lp.removeEventListener('scroll', leftHandler);
    };
  }, [selectedProject, loading]);

  // Restore scroll position after data reload (drag operations)
  useEffect(() => {
    if (pendingScrollRef.current && chartRef.current && !loading) {
      chartRef.current.scrollLeft = pendingScrollRef.current.left;
      chartRef.current.scrollTop = pendingScrollRef.current.top;
      pendingScrollRef.current = null;
    }
  }, [loading, tasks]);

  // Close settings menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) setShowSettingsMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!selectedProject) return;
      const target = e.target as HTMLElement;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      // Escape — close modals/menus
      if (e.key === 'Escape') {
        if (showHelp) { setShowHelp(false); return; }
        if (contextMenu) { setContextMenu(null); return; }
        if (showEvidenceModal) { setShowEvidenceModal(false); setEvidenceTaskId(null); return; }
        if (showRFIModal) { setShowRFIModal(false); return; }
        if (showBaselineModal) { setShowBaselineModal(false); return; }
        if (showPhaseModal) { setShowPhaseModal(false); return; }
        if (showDepModal) { setShowDepModal(false); return; }
        if (showInsights) { setShowInsights(false); return; }
        if (showAdvancedPanel) { setShowAdvancedPanel(null); return; }
        if (showFilterPanel) { setShowFilterPanel(false); return; }
        if (inlineEdit) { setInlineEdit(null); return; }
        if (showSettingsMenu) { setShowSettingsMenu(false); return; }
        setSelectedTaskId(null);
        return;
      }

      // Ctrl+Z — undo
      if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault(); handleUndo(); return;
      }
      // Ctrl+Y or Ctrl+Shift+Z — redo
      if ((e.key === 'y' && (e.ctrlKey || e.metaKey)) || (e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey)) {
        e.preventDefault(); handleRedo(); return;
      }
      // Ctrl+D — duplicate selected task
      if (e.key === 'd' && (e.ctrlKey || e.metaKey) && selectedTaskId) {
        e.preventDefault();
        const task = allFlatTasks.find(t => t.id === selectedTaskId);
        if (task) handleDuplicateTask(task);
        return;
      }
      // Delete — delete hovered/selected task
      if (e.key === 'Delete' && (selectedTaskId || hoveredRowId)) {
        const taskId = selectedTaskId || hoveredRowId;
        const task = allFlatTasks.find(t => t.id === taskId);
        if (task) handleDeletePhase(task);
        return;
      }
      // T — scroll to today
      if (e.key === 't' || e.key === 'T') { scrollToToday(); return; }
      // + / = — zoom in
      if (e.key === '+' || e.key === '=') {
        setZoomLevel(prev => prev === 'month' ? 'week' : prev === 'week' ? 'day' : 'day');
        return;
      }
      // - — zoom out
      if (e.key === '-') {
        setZoomLevel(prev => prev === 'day' ? 'week' : prev === 'week' ? 'month' : 'month');
        return;
      }
      // ? — toggle help
      if (e.key === '?' || (e.key === '/' && e.shiftKey)) { setShowHelp(prev => !prev); return; }
      // F — toggle filters
      if (e.key === 'f' && !e.ctrlKey && !e.metaKey) { setShowFilterPanel(prev => !prev); return; }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [selectedProject, showHelp, contextMenu, showPhaseModal, showDepModal, showFilterPanel, inlineEdit, showSettingsMenu, selectedTaskId, hoveredRowId, undoStack, redoStack, showEvidenceModal, showRFIModal, showBaselineModal, showInsights, showAdvancedPanel]);

  useEffect(() => { if (currentUser) loadProjects(); }, [currentUser]);

  useEffect(() => {
    if (loading || autoSelectDone.current || !projects.length) return;
    const hash = window.location.hash;
    const qIndex = hash.indexOf('?');
    const params = qIndex >= 0 ? new URLSearchParams(hash.substring(qIndex)) : new URLSearchParams();
    const projectId = params.get('projectId');
    if (projectId) {
      const project = projects.find(p => p.id === projectId);
      if (project) setSelectedProject(project);
      const hashPath = qIndex >= 0 ? hash.substring(0, qIndex) : hash;
      window.history.replaceState({}, '', window.location.pathname + hashPath);
      autoSelectDone.current = true;
    }
  }, [loading, projects]);

  useEffect(() => { if (selectedProject) { loadGanttData(); } }, [selectedProject]);

  // Auto-scroll to today or first task when project loads
  useEffect(() => {
    if (!loading && selectedProject && allFlatTasks.length > 0 && chartRef.current) {
      const today = new Date();
      const todayOffset = getDaysBetween(dateRange.start, today) * dayWidth;
      if (todayOffset > 0 && todayOffset < chartWidth) {
        chartRef.current.scrollLeft = Math.max(0, todayOffset - chartRef.current.clientWidth / 2);
      } else {
        // Scroll to first task
        const firstWithDate = allFlatTasks.find(t => t.start_date);
        if (firstWithDate) {
          const offset = getDaysBetween(dateRange.start, new Date(firstWithDate.start_date!)) * dayWidth;
          chartRef.current.scrollLeft = Math.max(0, offset - 100);
        }
      }
    }
  }, [loading, selectedProject?.id]);

  const loadProjects = async () => {
    if (!currentUser) return;
    try {
      const { data } = await supabase.from('projects').select('*')
        .eq('company_id', currentUser.company_id).order('created_at', { ascending: false });
      if (data) setProjects(data);
    } catch (err: any) { showError('Błąd ładowania projektów: ' + (err?.message || err)); }
    finally { setLoading(false); }
  };

  const loadGanttData = async () => {
    if (!selectedProject) return;
    setLoading(true);
    try {
      const [tasksRes, depsRes, wdRes] = await Promise.all([
        supabase.from('gantt_tasks').select('*, assigned_to:users!gantt_tasks_assigned_to_id_fkey(*), supervisor:users!gantt_tasks_supervisor_id_fkey(*), approver:users!gantt_tasks_approver_id_fkey(*)').eq('project_id', selectedProject.id).order('sort_order'),
        supabase.from('gantt_dependencies').select('*').eq('project_id', selectedProject.id),
        supabase.from('project_working_days').select('*').eq('project_id', selectedProject.id).maybeSingle()
      ]);
      if (tasksRes.error) throw tasksRes.error;
      if (depsRes.error) throw depsRes.error;
      // Build tree and auto-recalculate parents
      const rawTree = buildTree(tasksRes.data || []) as GanttTaskWithChildren[];
      const recalced = recalcParents(rawTree) as GanttTaskWithChildren[];
      setTasks(recalced);
      setDependencies(depsRes.data || []);
      if (wdRes.data) {
        setWorkingDays(workingDaysFromMask(wdRes.data.working_days_mask || 31));
      }
      setHarmonogramStart(selectedProject.start_date?.split('T')[0] || new Date().toISOString().split('T')[0]);
      // Load advanced data with fresh task IDs (allFlatTasks hasn't re-rendered yet)
      const freshIds = (tasksRes.data || []).map((t: any) => t.id);
      loadAdvancedData(freshIds);
    } catch (err: any) { showError('Błąd ładowania danych harmonogramu: ' + (err?.message || err)); }
    finally { setLoading(false); }
  };

  const loadAdvancedData = async (freshTaskIds?: string[]) => {
    if (!selectedProject) return;
    const pid = selectedProject.id;
    const taskIds = freshTaskIds || allFlatTasks.map(t => t.id);
    try {
      const queries: Promise<any>[] = [
        supabase.from('gantt_baselines').select('*').eq('project_id', pid).order('created_at', { ascending: false }),
        supabase.from('gantt_zones').select('*').eq('project_id', pid).order('sort_order'),
        supabase.from('gantt_norms').select('*').eq('company_id', currentUser?.company_id || ''),
        supabase.from('gantt_condition_factors').select('*').eq('company_id', currentUser?.company_id || '').order('sort_order'),
        taskIds.length > 0
          ? supabase.from('gantt_materials').select('*').in('gantt_task_id', taskIds.slice(0, 200))
          : Promise.resolve({ data: [] }),
        supabase.from('gantt_rfis').select('*').eq('project_id', pid).order('created_at', { ascending: false }),
        supabase.from('gantt_accepted_acts').select('*').eq('project_id', pid).order('act_date', { ascending: false })
      ];
      const [baselinesRes, zonesRes, normsRes, cfRes, matsRes, rfisRes, actsRes] = await Promise.all(queries);
      if (baselinesRes.data) setBaselines(baselinesRes.data);
      if (zonesRes.data) setZones(zonesRes.data);
      if (normsRes.data) setNorms(normsRes.data);
      if (cfRes.data) setConditionFactors(cfRes.data);
      if (matsRes.data) setMaterials(matsRes.data as any);
      if (rfisRes.data) setRFIs(rfisRes.data as any);
      if (actsRes.data) setAcceptedActs(actsRes.data as any);
      // Load work orders separately
      const woRes = await supabase.from('gantt_work_orders').select('*, items:gantt_work_order_items(*)').eq('project_id', pid).order('order_date', { ascending: false }).limit(20);
      if (woRes.data) setWorkOrders(woRes.data as any);
    } catch (err) { console.warn('Advanced data load partial failure:', err); }
  };

  // ========== ADVANCED FEATURE HANDLERS ==========

  // Save baseline
  const handleSaveBaseline = async () => {
    if (!selectedProject || !currentUser || !baselineName.trim()) return;
    try {
      const snapshot: BaselineTaskSnapshot[] = allFlatTasks.map(t => ({
        task_id: t.id,
        start_date: t.start_date || '',
        end_date: t.end_date || '',
        duration: t.duration || 0,
        progress: t.progress || 0
      }));
      await supabase.from('gantt_baselines').insert({
        project_id: selectedProject.id,
        name: baselineName.trim(),
        tasks_snapshot: snapshot,
        created_by_id: currentUser.id
      });
      // Also save baseline dates on tasks
      for (const t of allFlatTasks) {
        if (t.start_date || t.end_date) {
          await supabase.from('gantt_tasks').update({
            baseline_start: t.start_date || null,
            baseline_end: t.end_date || null,
            baseline_duration: t.duration || null
          }).eq('id', t.id);
        }
      }
      setShowBaselineModal(false);
      setBaselineName('');
      showSuccess('Baseline zapisany.');
      loadAdvancedData();
    } catch (err: any) { showError('Błąd zapisu baseline: ' + (err?.message || err)); }
  };

  // Save zone
  const handleSaveZone = async () => {
    if (!selectedProject || !zoneForm.name.trim()) return;
    try {
      await supabase.from('gantt_zones').insert({
        project_id: selectedProject.id,
        name: zoneForm.name.trim(),
        zone_type: zoneForm.zone_type,
        floor_number: zoneForm.floor_number,
        color: zoneForm.color,
        sort_order: zones.length
      });
      setZoneForm({ name: '', zone_type: 'floor', floor_number: 0, color: '#3b82f6' });
      showSuccess('Strefa zapisana.');
      loadAdvancedData();
    } catch (err: any) { showError('Błąd: ' + (err?.message || err)); }
  };

  // Initialize default norms (with duplicate guard)
  const handleInitDefaultNorms = async () => {
    if (!currentUser) return;
    try {
      const existing = await supabase.from('gantt_norms').select('id').eq('company_id', currentUser.company_id).limit(1);
      if (existing.data && existing.data.length > 0) {
        showError('Normy zostały już zainicjowane. Usuń istniejące normy przed ponowną inicjalizacją.');
        return;
      }
      for (const norm of DEFAULT_NORMS) {
        await supabase.from('gantt_norms').insert({ ...norm, company_id: currentUser.company_id });
      }
      for (const cf of DEFAULT_CONDITION_FACTORS) {
        await supabase.from('gantt_condition_factors').insert({ ...cf, company_id: currentUser.company_id });
      }
      showSuccess('Domyślne normy i współczynniki zainicjowane.');
      if (selectedProject) loadAdvancedData();
    } catch (err: any) { showError('Błąd: ' + (err?.message || err)); }
  };

  // Create RFI
  const handleCreateRFI = async () => {
    if (!selectedProject || !currentUser || !rfiForm.subject.trim()) return;
    try {
      const rfiNumber = `RFI-${rfis.length + 1}`;
      await supabase.from('gantt_rfis').insert({
        project_id: selectedProject.id,
        rfi_number: rfiNumber,
        subject: rfiForm.subject.trim(),
        question: rfiForm.question.trim(),
        assigned_to_id: rfiForm.assigned_to_id || null,
        due_date: rfiForm.due_date || null,
        priority: rfiForm.priority,
        gantt_task_id: rfiForm.gantt_task_id || null,
        created_by_id: currentUser.id,
        status: 'open'
      });
      setShowRFIModal(false);
      setRfiForm({ subject: '', question: '', assigned_to_id: '', due_date: '', priority: 'normal', gantt_task_id: '' });
      showSuccess('RFI utworzone.');
      loadAdvancedData();
    } catch (err: any) { showError('Błąd: ' + (err?.message || err)); }
  };

  // Update LPS status
  const handleUpdateLPSStatus = async (taskId: string, status: LPSStatus, blockerReason?: string) => {
    try {
      const updates: any = { lps_status: status };
      if (blockerReason !== undefined) updates.blocker_reason = blockerReason;
      if (status === 'done') { updates.progress = 100; updates.has_custom_progress = true; updates.actual_end = new Date().toISOString().split('T')[0]; }
      if (status === 'in_progress' && !(allFlatTasks.find(t => t.id === taskId) as any)?.actual_start) {
        updates.actual_start = new Date().toISOString().split('T')[0];
      }
      await supabase.from('gantt_tasks').update(updates).eq('id', taskId);
      await loadGanttDataKeepScroll();
    } catch (err: any) { showError('Błąd: ' + (err?.message || err)); }
  };

  // Generate work orders for today/this week
  const handleGenerateWorkOrders = async () => {
    if (!selectedProject || !currentUser) return;
    try {
      const today = new Date();
      const weekEnd = new Date(today); weekEnd.setDate(weekEnd.getDate() + 7);
      const weekTasks = allFlatTasks.filter(t => {
        if (!t.start_date || t.progress >= 100) return false;
        const start = new Date(t.start_date);
        const end = t.end_date ? new Date(t.end_date) : start;
        return start <= weekEnd && end >= today;
      });
      if (weekTasks.length === 0) { showError('Brak zadań na ten tydzień.'); return; }
      const orderNumber = generateWorkOrderNumber(selectedProject.name, today, 0);
      const { data: wo } = await supabase.from('gantt_work_orders').insert({
        project_id: selectedProject.id,
        order_number: orderNumber,
        order_date: today.toISOString().split('T')[0],
        status: 'draft',
        created_by_id: currentUser.id
      }).select('id').single();
      if (wo) {
        for (let i = 0; i < weekTasks.length; i++) {
          await supabase.from('gantt_work_order_items').insert({
            work_order_id: wo.id,
            gantt_task_id: weekTasks[i].id,
            description: weekTasks[i].title || '',
            sort_order: i
          });
        }
      }
      showSuccess(`Naryk ${orderNumber} utworzony z ${weekTasks.length} zadaniami.`);
      loadAdvancedData();
    } catch (err: any) { showError('Błąd: ' + (err?.message || err)); }
  };

  // Create accepted act
  const handleCreateAct = async () => {
    if (!selectedProject || !actForm.description.trim()) return;
    try {
      const actNumber = `AKT-${selectedProject.name.slice(0, 3).toUpperCase()}-${String(acceptedActs.length + 1).padStart(3, '0')}`;
      await supabase.from('gantt_accepted_acts').insert({
        project_id: selectedProject.id,
        act_number: actNumber,
        act_date: new Date().toISOString().split('T')[0],
        description: actForm.description.trim(),
        total_amount: actForm.total_amount || 0,
        zone_id: actForm.zone_id || null,
        status: 'draft'
      });
      setActForm({ description: '', total_amount: 0, zone_id: '' });
      setShowActForm(false);
      showSuccess(`Akt ${actNumber} utworzony.`);
      loadAdvancedData();
    } catch (err: any) { showError('Błąd: ' + (err?.message || err)); }
  };

  // Generate predictive insights
  const handleGenerateInsights = () => {
    const newInsights = generatePredictiveInsights(
      allFlatTasks as any,
      dependencies as any,
      materials,
      criticalPathIds
    );
    setInsights(newInsights);
    setShowInsights(true);
  };

  const flattenTasksFiltered = (items: GanttTaskWithChildren[], result: GanttTaskWithChildren[] = []): GanttTaskWithChildren[] => {
    items.forEach(task => {
      if (hideClosedTasks && task.progress >= 100) return;
      result.push(task);
      if (task.isExpanded && task.children && task.children.length > 0) flattenTasksFiltered(task.children, result);
    });
    return result;
  };

  const flatTasks = useMemo(() => flattenTasksFiltered(tasks), [tasks, hideClosedTasks]);
  const allFlatTasks = useMemo(() => {
    const flatten = (items: GanttTaskWithChildren[], result: GanttTaskWithChildren[] = []): GanttTaskWithChildren[] => {
      items.forEach(t => { result.push(t); if (t.children?.length) flatten(t.children, result); });
      return result;
    };
    return flatten(tasks);
  }, [tasks]);

  const dateRange = useMemo(() => {
    const allTasks = allFlatTasks.filter(t => t.start_date);
    if (allTasks.length === 0) {
      const today = new Date();
      return { start: new Date(today.getFullYear(), today.getMonth(), 1), end: new Date(today.getFullYear(), today.getMonth() + 3, 0) };
    }
    const starts = allTasks.map(t => new Date(t.start_date!));
    const ends = allTasks.filter(t => t.end_date).map(t => new Date(t.end_date!));
    const minDate = new Date(Math.min(...starts.map(d => d.getTime())));
    const maxDate = ends.length > 0 ? new Date(Math.max(...ends.map(d => d.getTime()))) : new Date(minDate.getTime() + 90 * 86400000);
    // Pad: start from Monday of previous week, end at Sunday + 3 weeks
    const minDay = minDate.getDay(); // 0=Sun..6=Sat
    const diffToMonday = minDay === 0 ? 6 : minDay - 1; // days back to Monday
    minDate.setDate(minDate.getDate() - diffToMonday - 7);
    const maxDay = maxDate.getDay();
    const diffToSunday = maxDay === 0 ? 0 : 7 - maxDay; // days forward to Sunday
    maxDate.setDate(maxDate.getDate() + diffToSunday + 21);
    return { start: minDate, end: maxDate };
  }, [allFlatTasks]);

  const toggleTaskExpand = (taskId: string) => {
    const toggle = (items: GanttTaskWithChildren[]): GanttTaskWithChildren[] =>
      items.map(item => ({ ...item, isExpanded: item.id === taskId ? !item.isExpanded : item.isExpanded, children: item.children ? toggle(item.children) : undefined }));
    setTasks(toggle(tasks));
  };

  const expandAll = () => {
    const expand = (items: GanttTaskWithChildren[]): GanttTaskWithChildren[] =>
      items.map(item => ({ ...item, isExpanded: true, children: item.children ? expand(item.children) : undefined }));
    setTasks(expand(tasks));
  };

  const collapseAll = () => {
    const collapse = (items: GanttTaskWithChildren[]): GanttTaskWithChildren[] =>
      items.map(item => ({ ...item, isExpanded: false, children: item.children ? collapse(item.children) : undefined }));
    setTasks(collapse(tasks));
  };

  const getTaskTitle = (task: GanttTaskWithChildren): string => task.title || 'Bez nazwy';
  const isParentTask = (task: GanttTaskWithChildren) => task.children && task.children.length > 0;
  const formatDuration = fmtDuration;

  // Deadline status helper
  const getDeadlineStatus = (task: GanttTaskWithChildren): 'overdue' | 'due-soon' | 'ok' | null => {
    if (!task.end_date || task.progress >= 100) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const end = new Date(task.end_date); end.setHours(0, 0, 0, 0);
    const daysLeft = Math.ceil((end.getTime() - today.getTime()) / 86400000);
    if (daysLeft < 0) return 'overdue';
    if (daysLeft <= 3) return 'due-soon';
    return 'ok';
  };

  const getUserInitials = (user: any): string => {
    if (!user) return '';
    const f = (user.first_name || '')[0] || '';
    const l = (user.last_name || '')[0] || '';
    return (f + l).toUpperCase();
  };

  const PRIORITY_COLORS: Record<string, string> = {
    low: '#94a3b8', normal: '#3b82f6', high: '#f59e0b', critical: '#ef4444'
  };

  const ROW_HEIGHT = 40;
  const dayWidth = zoomLevel === 'day' ? 40 : zoomLevel === 'week' ? 20 : 6;
  const totalDays = getDaysBetween(dateRange.start, dateRange.end) + 1;
  const chartWidth = totalDays * dayWidth;

  const getTaskPosition = (task: GanttTaskWithChildren) => {
    if (!task.start_date) return { left: 0, width: 0 };
    const startDays = getDaysBetween(dateRange.start, new Date(task.start_date));
    const endDate = task.end_date ? new Date(task.end_date) : new Date(task.start_date);
    const duration = Math.max(getDaysBetween(new Date(task.start_date), endDate), 1);
    return { left: startDays * dayWidth, width: Math.max(duration * dayWidth, dayWidth) };
  };

  // Primary headers (top row) — always months
  const primaryHeaders = useMemo(() => {
    const headers: { label: string; days: number; startOffset: number }[] = [];
    let d = new Date(dateRange.start);
    while (d < dateRange.end) {
      const monthStart = new Date(d);
      const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const effEnd = monthEnd > dateRange.end ? dateRange.end : monthEnd;
      const days = getDaysBetween(monthStart, effEnd) + 1;
      const startOffset = getDaysBetween(dateRange.start, monthStart);
      headers.push({ label: `${POLISH_MONTHS[d.getMonth()]} ${d.getFullYear()}`, days, startOffset });
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }
    return headers;
  }, [dateRange]);

  // Helper: get Monday of the week for a given date
  const getMonday = (d: Date): Date => {
    const result = new Date(d);
    const day = result.getDay(); // 0=Sun, 1=Mon...6=Sat
    const diff = day === 0 ? -6 : 1 - day; // shift to Monday
    result.setDate(result.getDate() + diff);
    return result;
  };

  // Secondary headers (bottom row) — depends on zoom
  const secondaryHeaders = useMemo(() => {
    const headers: { label: string; days: number; startOffset: number; isWeekend?: boolean }[] = [];
    const fmtShort = (d: Date) => `${d.getDate()}.${(d.getMonth() + 1).toString().padStart(2, '0')}`;

    if (zoomLevel === 'day') {
      // Each day individually
      let d = new Date(dateRange.start);
      while (d < dateRange.end) {
        const startOffset = getDaysBetween(dateRange.start, d);
        const dow = d.getDay();
        const dayLabel = DAY_LABELS[dow === 0 ? 6 : dow - 1];
        const isWeekend = dow === 0 || dow === 6;
        headers.push({ label: `${dayLabel} ${d.getDate()}`, days: 1, startOffset, isWeekend });
        d = new Date(d); d.setDate(d.getDate() + 1);
      }
    } else if (zoomLevel === 'week') {
      // Monday-aligned weeks showing date range
      let monday = getMonday(new Date(dateRange.start));
      if (monday > dateRange.start) { monday.setDate(monday.getDate() - 7); }
      while (monday < dateRange.end) {
        const weekStart = new Date(Math.max(monday.getTime(), dateRange.start.getTime()));
        const sunday = new Date(monday); sunday.setDate(sunday.getDate() + 6);
        const weekEnd = new Date(Math.min(sunday.getTime(), dateRange.end.getTime()));
        const days = getDaysBetween(weekStart, weekEnd) + 1;
        const startOffset = getDaysBetween(dateRange.start, weekStart);
        headers.push({ label: `${fmtShort(monday)} – ${fmtShort(sunday)}`, days, startOffset });
        monday = new Date(monday); monday.setDate(monday.getDate() + 7);
      }
    } else {
      // Month view — Monday-aligned weeks, compact labels
      let monday = getMonday(new Date(dateRange.start));
      if (monday > dateRange.start) { monday.setDate(monday.getDate() - 7); }
      while (monday < dateRange.end) {
        const weekStart = new Date(Math.max(monday.getTime(), dateRange.start.getTime()));
        const sunday = new Date(monday); sunday.setDate(sunday.getDate() + 6);
        const weekEnd = new Date(Math.min(sunday.getTime(), dateRange.end.getTime()));
        const days = getDaysBetween(weekStart, weekEnd) + 1;
        const startOffset = getDaysBetween(dateRange.start, weekStart);
        headers.push({ label: `${fmtShort(monday)}`, days, startOffset });
        monday = new Date(monday); monday.setDate(monday.getDate() + 7);
      }
    }
    return headers;
  }, [dateRange, zoomLevel]);

  const scrollToToday = () => {
    if (!chartRef.current) return;
    const today = new Date();
    const daysFromStart = getDaysBetween(dateRange.start, today);
    const scrollPos = daysFromStart * dayWidth - chartRef.current.clientWidth / 2;
    chartRef.current.scrollLeft = Math.max(0, scrollPos);
  };

  // ========== CRUD ==========

  const openCreatePhase = (parentId?: string) => {
    setEditingPhase(null);
    const startDate = harmonogramStart || new Date().toISOString().split('T')[0];
    setPhaseForm({
      title: '', parent_id: parentId || '', planning_mode: 'auto',
      duration: 0, start_date: startDate, end_date: '', progress: 0,
      has_custom_progress: false, is_milestone: false, color: '#3b82f6',
      assigned_to_id: '', supervisor_id: '', approver_id: '',
      notes: '', priority: 'normal',
      zone_id: '', norm_id: '', quantity: 0, quantity_unit: '', selectedConditions: []
    });
    setShowPhaseModal(true);
  };

  const openEditPhase = (task: GanttTask) => {
    setEditingPhase(task);
    setPhaseForm({
      title: task.title || '', parent_id: task.parent_id || '',
      planning_mode: task.is_auto ? 'auto' : 'manual',
      duration: task.duration || 0,
      start_date: task.start_date?.split('T')[0] || '',
      end_date: task.end_date?.split('T')[0] || '',
      progress: task.progress || 0,
      has_custom_progress: task.has_custom_progress || false,
      is_milestone: task.is_milestone || false,
      color: task.color || '#3b82f6',
      assigned_to_id: task.assigned_to_id || '',
      supervisor_id: task.supervisor_id || '',
      approver_id: task.approver_id || '',
      notes: task.notes || '',
      priority: task.priority || 'normal',
      zone_id: (task as any).zone_id || '',
      norm_id: (task as any).norm_id || '',
      quantity: (task as any).quantity || 0,
      quantity_unit: (task as any).quantity_unit || '',
      selectedConditions: []
    });
    setShowPhaseModal(true);
  };

  const handleSavePhase = async () => {
    if (!currentUser || !selectedProject) return;
    // Validate
    const parentTask = phaseForm.parent_id ? allFlatTasks.find(t => t.id === phaseForm.parent_id) : null;
    const currentLevel = parentTask ? (parentTask.level || 0) + 1 : 0;
    const validation = validatePhaseForm(phaseForm, 8, currentLevel);
    if (!validation.valid) { showError(validation.errors.join(' ')); return; }
    setSaving(true);
    try {
      let endDate = phaseForm.end_date;
      if (!endDate && phaseForm.start_date && phaseForm.duration > 0) {
        const s = addWD(new Date(phaseForm.start_date), phaseForm.duration, workingDays);
        endDate = s.toISOString().split('T')[0];
      }
      const data: any = {
        project_id: selectedProject.id,
        title: phaseForm.title.trim(),
        parent_id: phaseForm.parent_id || null,
        start_date: phaseForm.start_date || null,
        end_date: endDate || null,
        duration: phaseForm.duration || null,
        progress: phaseForm.progress,
        has_custom_progress: phaseForm.has_custom_progress,
        is_auto: phaseForm.planning_mode === 'auto',
        is_milestone: phaseForm.is_milestone,
        color: phaseForm.color,
        assigned_to_id: phaseForm.assigned_to_id || null,
        supervisor_id: phaseForm.supervisor_id || null,
        approver_id: phaseForm.approver_id || null,
        notes: phaseForm.notes || null,
        priority: phaseForm.priority || 'normal',
        zone_id: phaseForm.zone_id || null,
        norm_id: phaseForm.norm_id || null,
        quantity: phaseForm.quantity || null,
        quantity_unit: phaseForm.quantity_unit || null,
        source: 'manual' as const,
        sort_order: editingPhase ? editingPhase.sort_order : allFlatTasks.length
      };
      if (editingPhase) {
        const { error } = await supabase.from('gantt_tasks').update(data).eq('id', editingPhase.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('gantt_tasks').insert(data);
        if (error) throw error;
      }
      // Auto-update parent dates/progress if parent exists
      if (phaseForm.parent_id) {
        await recalcAndSaveParent(phaseForm.parent_id);
      }
      setShowPhaseModal(false);
      setEditingPhase(null);
      showSuccess(editingPhase ? 'Faza zapisana.' : 'Faza utworzona.');
      await loadGanttDataKeepScroll();
    } catch (err: any) { showError('Błąd zapisu fazy: ' + (err?.message || err)); }
    finally { setSaving(false); }
  };

  /** Recalculate and save parent task dates/progress from its children */
  const recalcAndSaveParent = async (parentId: string) => {
    try {
      const { data: children } = await supabase.from('gantt_tasks').select('*').eq('parent_id', parentId);
      if (!children || children.length === 0) return;
      const { data: parent } = await supabase.from('gantt_tasks').select('*').eq('id', parentId).single();
      if (!parent) return;
      const updates: any = {};
      if (parent.is_auto) {
        const start = calcParentStartDate(children as GanttTaskNode[]);
        const end = calcParentEndDate(children as GanttTaskNode[]);
        if (start) updates.start_date = start;
        if (end) updates.end_date = end;
        updates.duration = calcParentDuration(start, end);
      }
      if (!parent.has_custom_progress) {
        updates.progress = calcParentProgress(children as GanttTaskNode[]);
      }
      if (Object.keys(updates).length > 0) {
        await supabase.from('gantt_tasks').update(updates).eq('id', parentId);
      }
      // Recurse upward
      if (parent.parent_id) await recalcAndSaveParent(parent.parent_id);
    } catch (err) { console.error('Error recalculating parent:', err); }
  };

  const handleDeletePhase = async (task: GanttTask) => {
    if (!confirm(`Czy na pewno chcesz usunąć fazę "${task.title}"?`)) return;
    try {
      const parentId = task.parent_id;
      // Delete children first
      const deleteChildren = async (parentId: string) => {
        const { data: children } = await supabase.from('gantt_tasks').select('id').eq('parent_id', parentId);
        if (children) for (const c of children) { await deleteChildren(c.id); }
        await supabase.from('gantt_dependencies').delete().or(`predecessor_id.eq.${parentId},successor_id.eq.${parentId}`);
        await supabase.from('gantt_tasks').delete().eq('id', parentId);
      };
      await deleteChildren(task.id);
      // Recalc parent if exists
      if (parentId) await recalcAndSaveParent(parentId);
      showSuccess('Faza usunięta.');
      await loadGanttDataKeepScroll();
    } catch (err: any) { showError('Błąd usuwania fazy: ' + (err?.message || err)); }
  };

  // ========== NEW HANDLERS ==========

  const handleDuplicateTask = async (task: GanttTaskWithChildren) => {
    if (!selectedProject || !currentUser) return;
    try {
      const { data: inserted } = await supabase.from('gantt_tasks').insert({
        project_id: selectedProject.id, title: (task.title || '') + ' (kopia)',
        parent_id: task.parent_id || null, start_date: task.start_date || null,
        end_date: task.end_date || null, duration: task.duration || null,
        progress: 0, is_milestone: task.is_milestone, is_auto: task.is_auto,
        has_custom_progress: false, color: task.color || '#3b82f6',
        priority: task.priority || 'normal', notes: task.notes || null,
        sort_order: task.sort_order + 1, source: 'manual'
      }).select('id').single();
      if (inserted) pushHistory({ type: 'create', taskId: inserted.id, after: { ...task, id: inserted.id } });
      showSuccess('Zduplikowano fazę.');
      await loadGanttDataKeepScroll();
    } catch (err: any) { showError('Błąd duplikacji: ' + (err?.message || err)); }
  };

  const handleDuplicateTaskWithChildren = async (task: GanttTaskWithChildren) => {
    if (!selectedProject || !currentUser) return;
    try {
      const duplicateRecursive = async (src: GanttTaskWithChildren, parentId: string | null) => {
        const { data: inserted } = await supabase.from('gantt_tasks').insert({
          project_id: selectedProject!.id, title: parentId ? src.title : (src.title || '') + ' (kopia)',
          parent_id: parentId, start_date: src.start_date || null,
          end_date: src.end_date || null, duration: src.duration || null,
          progress: 0, is_milestone: src.is_milestone, is_auto: src.is_auto,
          has_custom_progress: false, color: src.color || '#3b82f6',
          priority: src.priority || 'normal', notes: src.notes || null,
          sort_order: src.sort_order, source: 'manual'
        }).select('id').single();
        if (inserted && src.children) {
          for (const child of src.children) await duplicateRecursive(child, inserted.id);
        }
      };
      await duplicateRecursive(task, task.parent_id || null);
      showSuccess('Zduplikowano fazę z podfazami.');
      await loadGanttDataKeepScroll();
    } catch (err: any) { showError('Błąd duplikacji: ' + (err?.message || err)); }
  };

  const handleIndent = async (task: GanttTaskWithChildren) => {
    // Make this task a child of its previous sibling
    const siblings = task.parent_id
      ? (allFlatTasks.find(t => t.id === task.parent_id)?.children || [])
      : tasks;
    const idx = (siblings as GanttTaskWithChildren[]).findIndex(t => t.id === task.id);
    if (idx <= 0) { showError('Brak poprzedniego rodzeństwa.'); return; }
    const newParent = (siblings as GanttTaskWithChildren[])[idx - 1];
    const before = { parent_id: task.parent_id };
    try {
      await supabase.from('gantt_tasks').update({ parent_id: newParent.id }).eq('id', task.id);
      pushHistory({ type: 'update', taskId: task.id, before, after: { parent_id: newParent.id } });
      if (task.parent_id) await recalcAndSaveParent(task.parent_id);
      await recalcAndSaveParent(newParent.id);
      await loadGanttDataKeepScroll();
    } catch (err: any) { showError('Błąd wcięcia: ' + (err?.message || err)); }
  };

  const handleOutdent = async (task: GanttTaskWithChildren) => {
    if (!task.parent_id) { showError('Faza jest już na najwyższym poziomie.'); return; }
    const parent = allFlatTasks.find(t => t.id === task.parent_id);
    const newParentId = parent?.parent_id || null;
    const before = { parent_id: task.parent_id };
    try {
      await supabase.from('gantt_tasks').update({ parent_id: newParentId }).eq('id', task.id);
      pushHistory({ type: 'update', taskId: task.id, before, after: { parent_id: newParentId } });
      await recalcAndSaveParent(task.parent_id);
      if (newParentId) await recalcAndSaveParent(newParentId);
      await loadGanttDataKeepScroll();
    } catch (err: any) { showError('Błąd cofnięcia wcięcia: ' + (err?.message || err)); }
  };

  const handleToggleMilestone = async (task: GanttTaskWithChildren) => {
    const before = { is_milestone: task.is_milestone };
    try {
      await supabase.from('gantt_tasks').update({ is_milestone: !task.is_milestone }).eq('id', task.id);
      pushHistory({ type: 'update', taskId: task.id, before, after: { is_milestone: !task.is_milestone } });
      showSuccess(task.is_milestone ? 'Kamień milowy usunięty.' : 'Oznaczono jako kamień milowy.');
      await loadGanttDataKeepScroll();
    } catch (err: any) { showError('Błąd: ' + (err?.message || err)); }
  };

  const handleMarkComplete = async (task: GanttTaskWithChildren) => {
    const before = { progress: task.progress, has_custom_progress: task.has_custom_progress };
    try {
      await supabase.from('gantt_tasks').update({ progress: 100, has_custom_progress: true }).eq('id', task.id);
      pushHistory({ type: 'update', taskId: task.id, before, after: { progress: 100, has_custom_progress: true } });
      if (task.parent_id) await recalcAndSaveParent(task.parent_id);
      showSuccess('Oznaczono jako ukończone.');
      await loadGanttDataKeepScroll();
    } catch (err: any) { showError('Błąd: ' + (err?.message || err)); }
  };

  const handleCopyTask = (task: GanttTaskWithChildren) => {
    setClipboardTask(task);
    showSuccess('Skopiowano do schowka.');
  };

  const handlePasteTask = async (parentId?: string) => {
    if (!clipboardTask || !selectedProject) return;
    try {
      const { data: inserted } = await supabase.from('gantt_tasks').insert({
        project_id: selectedProject.id, title: (clipboardTask.title || '') + ' (wklejone)',
        parent_id: parentId || clipboardTask.parent_id || null,
        start_date: clipboardTask.start_date || null, end_date: clipboardTask.end_date || null,
        duration: clipboardTask.duration || null, progress: 0,
        is_milestone: clipboardTask.is_milestone, is_auto: clipboardTask.is_auto,
        has_custom_progress: false, color: clipboardTask.color || '#3b82f6',
        priority: clipboardTask.priority || 'normal', sort_order: allFlatTasks.length,
        source: 'manual'
      }).select('id').single();
      if (inserted) pushHistory({ type: 'create', taskId: inserted.id });
      showSuccess('Wklejono fazę.');
      await loadGanttDataKeepScroll();
    } catch (err: any) { showError('Błąd wklejania: ' + (err?.message || err)); }
  };

  const handleSetPriority = async (task: GanttTaskWithChildren, priority: string) => {
    const before = { priority: task.priority };
    try {
      await supabase.from('gantt_tasks').update({ priority }).eq('id', task.id);
      pushHistory({ type: 'update', taskId: task.id, before, after: { priority } });
      await loadGanttDataKeepScroll();
    } catch (err: any) { showError('Błąd: ' + (err?.message || err)); }
  };

  const handleInlineSave = async () => {
    if (!inlineEdit) return;
    const task = allFlatTasks.find(t => t.id === inlineEdit.taskId);
    if (!task) { setInlineEdit(null); return; }
    const field = inlineEdit.field;
    const value = inlineEdit.value;
    const before: any = {};
    const after: any = {};
    if (field === 'title') {
      if (!value.trim()) { setInlineEdit(null); return; }
      before.title = task.title;
      after.title = value.trim();
    } else if (field === 'duration') {
      const dur = parseInt(value) || 0;
      before.duration = task.duration;
      after.duration = dur;
      if (task.start_date && dur > 0) {
        const endDate = addWD(new Date(task.start_date), dur, workingDays);
        after.end_date = endDate.toISOString().split('T')[0];
      }
    }
    try {
      await supabase.from('gantt_tasks').update(after).eq('id', inlineEdit.taskId);
      pushHistory({ type: 'update', taskId: inlineEdit.taskId, before, after });
      if (task.parent_id) await recalcAndSaveParent(task.parent_id);
      setInlineEdit(null);
      await loadGanttDataKeepScroll();
    } catch (err: any) { showError('Błąd zapisu: ' + (err?.message || err)); }
  };

  // Active filter count
  const activeFilterCount = filters.priorities.length + filters.statuses.length + (filters.criticalOnly ? 1 : 0);

  // Dependencies
  const openCreateDep = (predecessorId?: string, successorId?: string) => {
    setEditingDep(null);
    setDepForm({ predecessor_id: predecessorId || '', successor_id: successorId || '', dependency_type: 'FS', lag: 0 });
    setDepValidationError('');
    setShowDepModal(true);
  };

  const openEditDep = (dep: GanttDependency) => {
    setEditingDep(dep);
    setDepForm({ predecessor_id: dep.predecessor_id, successor_id: dep.successor_id, dependency_type: dep.dependency_type, lag: dep.lag });
    setDepValidationError('');
    setShowDepModal(true);
  };

  const handleSaveDep = async () => {
    if (!selectedProject || !depForm.predecessor_id || !depForm.successor_id) return;
    // Validate: no self-ref, no duplicate, no circular
    const depValidation = validateDependency(
      dependencies as GanttDepRecord[],
      depForm.predecessor_id, depForm.successor_id,
      editingDep?.id
    );
    if (!depValidation.valid) { setDepValidationError(depValidation.error!); return; }
    setSaving(true);
    try {
      const data = {
        project_id: selectedProject.id,
        predecessor_id: depForm.predecessor_id,
        successor_id: depForm.successor_id,
        dependency_type: depForm.dependency_type,
        lag: depForm.lag
      };
      if (editingDep) {
        const { error } = await supabase.from('gantt_dependencies').update(data).eq('id', editingDep.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('gantt_dependencies').insert(data);
        if (error) throw error;
      }
      setShowDepModal(false);
      setDepValidationError('');
      showSuccess('Zależność zapisana.');
      await loadGanttDataKeepScroll();
    } catch (err: any) { showError('Błąd zapisu zależności: ' + (err?.message || err)); }
    finally { setSaving(false); }
  };

  const handleDeleteDep = async () => {
    if (!editingDep) return;
    try {
      await supabase.from('gantt_dependencies').delete().eq('id', editingDep.id);
      setShowDepModal(false);
      await loadGanttDataKeepScroll();
    } catch (err) { console.error('Error deleting dependency:', err); }
  };

  // Working days
  const handleSaveWorkingDays = async () => {
    if (!selectedProject) return;
    const mask = workingDays.reduce((acc, v, i) => acc | (v ? (1 << i) : 0), 0);
    try {
      await supabase.from('project_working_days').upsert({ project_id: selectedProject.id, working_days_mask: mask }, { onConflict: 'project_id' });
      setShowWorkingDaysModal(false);
    } catch (err) { console.error('Error saving working days:', err); }
  };

  // Harmonogram start date
  const handleChangeHarmonogramStart = async (date: string) => {
    setHarmonogramStart(date);
    if (selectedProject) {
      await supabase.from('projects').update({ start_date: date }).eq('id', selectedProject.id);
    }
  };

  // Context menu handler
  const handleContextMenu = (e: React.MouseEvent, task: GanttTaskWithChildren) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ task, x: Math.min(e.clientX, window.innerWidth - 250), y: Math.min(e.clientY, window.innerHeight - 300) });
  };

  // Splitter drag
  const handleSplitterMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    splitterRef.current = true;
    const startX = e.clientX;
    const startWidth = leftPanelWidth;
    const onMove = (ev: MouseEvent) => {
      if (!splitterRef.current) return;
      setLeftPanelWidth(Math.max(400, Math.min(900, startWidth + ev.clientX - startX)));
    };
    const onUp = () => { splitterRef.current = false; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // ========== AUTO-SCHEDULE ==========
  const handleAutoSchedule = async () => {
    if (!selectedProject || allFlatTasks.length === 0) return;
    if (!confirm('Automatyczne planowanie przeliczy daty wszystkich zadań na podstawie zależności. Kontynuować?')) return;
    setSaving(true);
    try {
      const result = autoSchedule(
        tasks as GanttTaskNode[],
        dependencies as GanttDepRecord[],
        workingDays,
        harmonogramStart || new Date().toISOString().split('T')[0]
      );
      for (const [taskId, dates] of result) {
        const task = allFlatTasks.find(t => t.id === taskId);
        if (!task || isParentTask(task)) continue;
        const duration = getDaysBetween(new Date(dates.start_date), new Date(dates.end_date));
        await supabase.from('gantt_tasks').update({
          start_date: dates.start_date,
          end_date: dates.end_date,
          duration: Math.max(duration, 1)
        }).eq('id', taskId);
      }
      showSuccess('Harmonogram przeliczony automatycznie.');
      await loadGanttDataKeepScroll();
    } catch (err: any) { showError('Błąd planowania: ' + (err?.message || err)); }
    finally { setSaving(false); }
  };

  // ========== IMPORT / EXPORT ==========
  const handleExportJSON = () => {
    const data = { tasks: allFlatTasks.map(t => ({
      id: t.id, title: t.title, parent_id: t.parent_id, wbs: t.wbs,
      start_date: t.start_date, end_date: t.end_date, duration: t.duration,
      progress: t.progress, is_milestone: t.is_milestone, sort_order: t.sort_order,
      color: t.color, priority: t.priority, notes: t.notes,
      assigned_to_id: t.assigned_to_id, supervisor_id: t.supervisor_id, approver_id: t.approver_id,
      zone_id: (t as any).zone_id, norm_id: (t as any).norm_id,
      quantity: (t as any).quantity, quantity_unit: (t as any).quantity_unit,
      lps_status: (t as any).lps_status
    })), dependencies: dependencies.map(d => ({
      predecessor_id: d.predecessor_id, successor_id: d.successor_id,
      dependency_type: d.dependency_type, lag: d.lag
    })) };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `harmonogram_${selectedProject?.name || 'export'}_${new Date().toISOString().split('T')[0]}.json`;
    a.click(); URL.revokeObjectURL(url);
  };

  const handleExportCSV = () => {
    const rows = [['SPP', 'Nazwa', 'Faza nadrzędna', 'Data rozpoczęcia', 'Data zakończenia', 'Czas trwania', 'Postęp %', 'Kamień milowy', 'Priorytet', 'LPS Status'].join(';')];
    allFlatTasks.forEach(t => {
      rows.push([
        t.wbs || '', `"${(t.title || '').replace(/"/g, '""')}"`,
        t.parent_id || '', t.start_date?.split('T')[0] || '',
        t.end_date?.split('T')[0] || '', String(t.duration || ''),
        String(t.progress || 0), t.is_milestone ? 'Tak' : 'Nie',
        t.priority || 'normal', (t as any).lps_status || ''
      ].join(';'));
    });
    const blob = new Blob(['\uFEFF' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `harmonogram_${selectedProject?.name || 'export'}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const handleImportJSON = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json';
    input.onchange = async (e: any) => {
      const file = e.target?.files?.[0];
      if (!file || !selectedProject) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!data.tasks?.length) { showError('Plik nie zawiera zadań.'); return; }
        if (!confirm(`Importować ${data.tasks.length} zadań? Istniejące zadania zostaną usunięte.`)) return;
        setSaving(true);
        await supabase.from('gantt_dependencies').delete().eq('project_id', selectedProject.id);
        await supabase.from('gantt_tasks').delete().eq('project_id', selectedProject.id);
        const idMap = new Map<string, string>();
        for (const t of data.tasks) {
          const { data: inserted } = await supabase.from('gantt_tasks').insert({
            project_id: selectedProject.id, title: t.title, parent_id: null,
            start_date: t.start_date || null, end_date: t.end_date || null,
            duration: t.duration || null, progress: t.progress || 0,
            is_milestone: t.is_milestone || false, sort_order: t.sort_order || 0,
            source: 'manual', color: t.color || '#3b82f6',
            priority: t.priority || 'normal', notes: t.notes || null,
            assigned_to_id: t.assigned_to_id || null, supervisor_id: t.supervisor_id || null,
            approver_id: t.approver_id || null, lps_status: t.lps_status || null,
            zone_id: t.zone_id || null, norm_id: t.norm_id || null,
            quantity: t.quantity || null, quantity_unit: t.quantity_unit || null
          }).select('id').single();
          if (inserted) idMap.set(t.id, inserted.id);
        }
        // Update parent references
        for (const t of data.tasks) {
          if (t.parent_id && idMap.has(t.id) && idMap.has(t.parent_id)) {
            await supabase.from('gantt_tasks').update({ parent_id: idMap.get(t.parent_id) }).eq('id', idMap.get(t.id));
          }
        }
        // Import dependencies
        if (data.dependencies?.length) {
          for (const d of data.dependencies) {
            if (idMap.has(d.predecessor_id) && idMap.has(d.successor_id)) {
              await supabase.from('gantt_dependencies').insert({
                project_id: selectedProject.id,
                predecessor_id: idMap.get(d.predecessor_id),
                successor_id: idMap.get(d.successor_id),
                dependency_type: d.dependency_type || 'FS',
                lag: d.lag || 0
              });
            }
          }
        }
        showSuccess(`Zaimportowano ${data.tasks.length} zadań.`);
        await loadGanttData();
      } catch (err: any) { showError('Błąd importu: ' + (err?.message || err)); }
      finally { setSaving(false); }
    };
    input.click();
  };

  // Helper: reload data but preserve scroll position
  const loadGanttDataKeepScroll = async () => {
    if (chartRef.current) {
      pendingScrollRef.current = { left: chartRef.current.scrollLeft, top: chartRef.current.scrollTop };
    }
    await loadGanttData();
  };

  // ========== DRAG HANDLERS FOR GANTT BARS ==========
  const handleBarMouseDown = (e: React.MouseEvent, task: GanttTaskWithChildren, mode: 'move' | 'resize-start' | 'resize-end') => {
    e.preventDefault();
    e.stopPropagation();
    if (!task.start_date || isParentTask(task)) return;
    const pos = getTaskPosition(task);
    const state = {
      taskId: task.id, mode, startX: e.clientX,
      origLeft: pos.left, origWidth: pos.width,
      origStartDate: task.start_date!.split('T')[0],
      origEndDate: (task.end_date || task.start_date)!.split('T')[0]
    };
    dragRef.current = state;
    setDragState(state);

    const onMove = (ev: MouseEvent) => {
      const ds = dragRef.current;
      if (!ds) return;
      const dx = ev.clientX - ds.startX;
      if (ds.mode === 'move') {
        setDragPreview({ taskId: ds.taskId, left: ds.origLeft + dx, width: ds.origWidth });
      } else if (ds.mode === 'resize-start') {
        const newLeft = ds.origLeft + dx;
        const newWidth = Math.max(dayWidth, ds.origWidth - dx);
        setDragPreview({ taskId: ds.taskId, left: newLeft, width: newWidth });
      } else {
        const newWidth = Math.max(dayWidth, ds.origWidth + dx);
        setDragPreview({ taskId: ds.taskId, left: ds.origLeft, width: newWidth });
      }
    };

    const onUp = async (ev: MouseEvent) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const ds = dragRef.current;
      dragRef.current = null;
      setDragState(null);
      setDragPreview(null);
      if (!ds || !selectedProject) return;
      const dx = ev.clientX - ds.startX;
      if (Math.abs(dx) < 3) return; // threshold

      try {
        if (ds.mode === 'move') {
          const daysDelta = Math.round(dx / dayWidth);
          if (daysDelta === 0) return;
          const newStart = new Date(ds.origStartDate);
          newStart.setDate(newStart.getDate() + daysDelta);
          const newEnd = new Date(ds.origEndDate);
          newEnd.setDate(newEnd.getDate() + daysDelta);
          await supabase.from('gantt_tasks').update({
            start_date: newStart.toISOString().split('T')[0],
            end_date: newEnd.toISOString().split('T')[0]
          }).eq('id', ds.taskId);
        } else if (ds.mode === 'resize-start') {
          const daysDelta = Math.round(dx / dayWidth);
          if (daysDelta === 0) return;
          const newStart = new Date(ds.origStartDate);
          newStart.setDate(newStart.getDate() + daysDelta);
          if (newStart > new Date(ds.origEndDate)) return;
          const duration = getDaysBetween(newStart, new Date(ds.origEndDate));
          await supabase.from('gantt_tasks').update({
            start_date: newStart.toISOString().split('T')[0],
            duration: Math.max(duration, 1)
          }).eq('id', ds.taskId);
        } else {
          const daysDelta = Math.round(dx / dayWidth);
          if (daysDelta === 0) return;
          const newEnd = new Date(ds.origEndDate);
          newEnd.setDate(newEnd.getDate() + daysDelta);
          if (newEnd < new Date(ds.origStartDate)) return;
          const duration = getDaysBetween(new Date(ds.origStartDate), newEnd);
          await supabase.from('gantt_tasks').update({
            end_date: newEnd.toISOString().split('T')[0],
            duration: Math.max(duration, 1)
          }).eq('id', ds.taskId);
        }
        // Recalc parent
        const task = allFlatTasks.find(t => t.id === ds.taskId);
        if (task?.parent_id) await recalcAndSaveParent(task.parent_id);
        await loadGanttDataKeepScroll();
      } catch (err: any) { showError('Błąd aktualizacji: ' + (err?.message || err)); }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // ========== DRAG-TO-CONNECT DEPENDENCY ==========
  const handleConnectStart = (e: React.MouseEvent, taskId: string, side: 'start' | 'end') => {
    e.preventDefault();
    e.stopPropagation();
    const chartEl = chartRef.current;
    if (!chartEl) return;
    const rect = chartEl.getBoundingClientRect();
    const state = {
      fromTaskId: taskId, fromSide: side,
      startX: e.clientX - rect.left + chartEl.scrollLeft,
      startY: e.clientY - rect.top + chartEl.scrollTop,
      currentX: e.clientX - rect.left + chartEl.scrollLeft,
      currentY: e.clientY - rect.top + chartEl.scrollTop
    };
    connectDragRef.current = state;
    setConnectDrag(state);

    const onMove = (ev: MouseEvent) => {
      const cd = connectDragRef.current;
      if (!cd || !chartEl) return;
      const r = chartEl.getBoundingClientRect();
      const updated = { ...cd, currentX: ev.clientX - r.left + chartEl.scrollLeft, currentY: ev.clientY - r.top + chartEl.scrollTop };
      connectDragRef.current = updated;
      setConnectDrag(updated);
    };

    const onUp = async (ev: MouseEvent) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const cd = connectDragRef.current;
      connectDragRef.current = null;
      setConnectDrag(null);
      if (!cd || !chartEl || !selectedProject) return;
      // Find which task row the mouse landed on
      const r = chartEl.getBoundingClientRect();
      const relY = ev.clientY - r.top + chartEl.scrollTop - 56; // minus header height
      const rowIdx = Math.floor(relY / ROW_HEIGHT);
      if (rowIdx < 0 || rowIdx >= filteredFlatTasks.length) return;
      const targetTask = filteredFlatTasks[rowIdx];
      if (targetTask.id === cd.fromTaskId) return;
      // Determine relX to decide which side
      const relX = ev.clientX - r.left + chartEl.scrollLeft;
      const targetPos = getTaskPosition(targetTask);
      const targetMid = targetPos.left + targetPos.width / 2;
      const toSide: 'start' | 'end' = relX < targetMid ? 'start' : 'end';
      // Map sides to dependency type
      let depType: GanttDependencyType = 'FS';
      if (cd.fromSide === 'end' && toSide === 'start') depType = 'FS';
      else if (cd.fromSide === 'start' && toSide === 'start') depType = 'SS';
      else if (cd.fromSide === 'end' && toSide === 'end') depType = 'FF';
      else if (cd.fromSide === 'start' && toSide === 'end') depType = 'SF';
      // Validate
      const validation = validateDependency(dependencies as GanttDepRecord[], cd.fromTaskId, targetTask.id);
      if (!validation.valid) { showError(validation.error!); return; }
      // Create dependency
      try {
        const { error } = await supabase.from('gantt_dependencies').insert({
          project_id: selectedProject.id,
          predecessor_id: cd.fromTaskId, successor_id: targetTask.id,
          dependency_type: depType, lag: 0
        });
        if (error) throw error;
        showSuccess(`Zależność ${GANTT_DEPENDENCY_SHORT_LABELS[depType]} utworzona.`);
        await loadGanttDataKeepScroll();
      } catch (err: any) { showError('Błąd tworzenia zależności: ' + (err?.message || err)); }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // ========== WIZARD (kept from original) ==========
  const loadWizardData = useCallback(async () => {
    if (!currentUser) return;
    try {
      const [estRes, offRes] = await Promise.all([
        supabase.from('kosztorys_estimates').select('*, request:kosztorys_requests(*), items:kosztorys_estimate_items(count)')
          .eq('company_id', currentUser.company_id).order('created_at', { ascending: false }),
        supabase.from('offers').select('*, project:projects(*), sections:offer_sections(*, items:offer_items(*))')
          .eq('company_id', currentUser.company_id).is('deleted_at', null).order('created_at', { ascending: false })
      ]);
      if (estRes.data) setAllEstimates(estRes.data);
      if (offRes.data) setAllOffers(offRes.data);
    } catch (err) { console.error('Error loading wizard data:', err); }
  }, [currentUser]);

  useEffect(() => { if (showWizard && currentUser) loadWizardData(); }, [showWizard, currentUser]);

  const loadEstimateDataFromProject = useCallback(async (projectId: string) => {
    if (!projectId) return;
    setEstimateDataLoading(true);
    try {
      const [stagesRes, tasksRes] = await Promise.all([
        supabase.from('estimate_stages').select('*').eq('project_id', projectId).order('sort_order'),
        supabase.from('estimate_tasks').select('*, resources:estimate_resources(*)').eq('project_id', projectId).order('sort_order')
      ]);
      if (stagesRes.data?.length) setEstimateStages(stagesRes.data);
      if (tasksRes.data?.length) setEstimateItems(tasksRes.data);
    } catch (err) { console.error(err); }
    finally { setEstimateDataLoading(false); }
  }, []);

  const loadKosztorysData = useCallback(async (estimateId: string) => {
    if (!estimateId) return;
    setEstimateDataLoading(true);
    try {
      const { data: items } = await supabase.from('kosztorys_estimate_items').select('*')
        .eq('estimate_id', estimateId).eq('is_deleted', false).order('position_number');
      if (items?.length) {
        const groupMap = new Map<string, any[]>();
        items.forEach(item => { const g = item.room_group || 'Ogólne'; if (!groupMap.has(g)) groupMap.set(g, []); groupMap.get(g)!.push(item); });
        const stages = Array.from(groupMap.keys()).map((name, i) => ({ id: `kgrp_${i}`, name, sort_order: i }));
        const taskItems = items.map((item: any, i: number) => ({
          id: item.id, stage_id: stages.find(s => s.name === (item.room_group || 'Ogólne'))?.id,
          name: item.task_description || item.installation_element || `Pozycja ${item.position_number}`, duration: 1, sort_order: item.position_number || i
        }));
        setEstimateStages(stages);
        setEstimateItems(taskItems);
      }
    } catch (err) { console.error(err); }
    finally { setEstimateDataLoading(false); }
  }, []);

  const loadOfferData = useCallback((offer: any) => {
    if (!offer?.sections?.length) return;
    const stages = offer.sections.map((s: any, i: number) => ({ id: `osec_${s.id}`, name: s.name, sort_order: s.sort_order ?? i }));
    const taskItems: any[] = [];
    offer.sections.forEach((sec: any) => {
      (sec.items || []).forEach((item: any, i: number) => {
        taskItems.push({ id: item.id, stage_id: `osec_${sec.id}`, name: item.name || `Pozycja ${i + 1}`, duration: 1, sort_order: item.sort_order ?? i });
      });
    });
    if (stages.length) setEstimateStages(stages);
    if (taskItems.length) setEstimateItems(taskItems);
  }, []);

  const handleWizardProjectChange = useCallback((projectId: string) => {
    setWizardForm(prev => {
      const update = { ...prev, project_id: projectId };
      if (projectId) {
        const relatedOffer = allOffers.find(o => o.project_id === projectId);
        if (relatedOffer && !prev.offer_id) update.offer_id = relatedOffer.id;
        const proj = projects.find(p => p.id === projectId);
        if (proj?.start_date) update.start_date = proj.start_date.split('T')[0];
        if (proj?.end_date) update.deadline = proj.end_date.split('T')[0];
      } else { setEstimateStages([]); setEstimateItems([]); }
      return update;
    });
    if (projectId) loadEstimateDataFromProject(projectId);
  }, [allOffers, projects, loadEstimateDataFromProject]);

  const handleWizardEstimateChange = useCallback((estimateId: string) => {
    let relatedProjectId: string | null = null;
    setWizardForm(prev => {
      const update = { ...prev, estimate_id: estimateId };
      if (estimateId) {
        const est = allEstimates.find(e => e.id === estimateId);
        if (est?.request) {
          const rp = projects.find(p => p.name.toLowerCase() === est.request.investment_name?.toLowerCase());
          if (rp && !prev.project_id) { update.project_id = rp.id; relatedProjectId = rp.id; }
        }
      } else { setEstimateStages([]); setEstimateItems([]); }
      return update;
    });
    if (estimateId) { if (relatedProjectId) loadEstimateDataFromProject(relatedProjectId); loadKosztorysData(estimateId); }
  }, [allEstimates, projects, loadEstimateDataFromProject, loadKosztorysData]);

  const handleWizardOfferChange = useCallback((offerId: string) => {
    const offer = offerId ? allOffers.find(o => o.id === offerId) : null;
    setWizardForm(prev => {
      const update = { ...prev, offer_id: offerId };
      if (offerId && offer) {
        if (offer.project_id && !prev.project_id) {
          update.project_id = offer.project_id;
          const proj = projects.find(p => p.id === offer.project_id);
          if (proj?.start_date) update.start_date = proj.start_date.split('T')[0];
          if (proj?.end_date) update.deadline = proj.end_date.split('T')[0];
        }
      } else { setEstimateStages([]); setEstimateItems([]); }
      return update;
    });
    if (offerId && offer) { if (offer.project_id) loadEstimateDataFromProject(offer.project_id); loadOfferData(offer); }
  }, [allOffers, projects, loadEstimateDataFromProject, loadOfferData]);

  const openWizard = () => {
    setWizardForm({ ...DEFAULT_WIZARD_FORM }); setWizardStep('project');
    setEstimateStages([]); setEstimateItems([]); setEstimateDataLoading(false); setShowWizard(true);
  };

  const wizardStepIndex = WIZARD_STEPS.findIndex(s => s.key === wizardStep);
  const hasAnySelection = !!wizardForm.project_id || !!wizardForm.estimate_id || !!wizardForm.offer_id;
  const canGoNext = (): boolean => {
    switch (wizardStep) {
      case 'project': return hasAnySelection;
      case 'time': return !!wizardForm.start_date && wizardForm.working_days.some(d => d);
      default: return true;
    }
  };

  const handleCreateHarmonogram = async () => {
    if (!currentUser || !hasAnySelection) return;
    setWizardSaving(true);
    try {
      let projectId = wizardForm.project_id;
      if (!projectId) {
        let projectName = 'Nowy harmonogram';
        if (wizardForm.estimate_id) { const est = allEstimates.find(e => e.id === wizardForm.estimate_id); projectName = est?.request?.investment_name || est?.estimate_number || projectName; }
        else if (wizardForm.offer_id) { const off = allOffers.find(o => o.id === wizardForm.offer_id); projectName = off?.name || off?.number || projectName; }
        const { data: newProj } = await supabase.from('projects').insert({
          company_id: currentUser.company_id, name: projectName, status: 'active',
          start_date: wizardForm.start_date || null, end_date: wizardForm.deadline || null, color: '#3b82f6'
        }).select('*').single();
        if (!newProj) throw new Error('Failed to create project');
        projectId = newProj.id;
      } else {
        const updates: any = {};
        if (wizardForm.start_date) updates.start_date = wizardForm.start_date;
        if (wizardForm.deadline) updates.end_date = wizardForm.deadline;
        if (Object.keys(updates).length) await supabase.from('projects').update(updates).eq('id', projectId);
      }
      const mask = wizardForm.working_days.reduce((acc, v, i) => acc | (v ? (1 << i) : 0), 0);
      await supabase.from('project_working_days').upsert({ project_id: projectId, working_days_mask: mask }, { onConflict: 'project_id' });
      await supabase.from('gantt_dependencies').delete().eq('project_id', projectId);
      await supabase.from('gantt_tasks').delete().eq('project_id', projectId);
      const wd = wizardForm.working_days;

      if (wizardForm.task_mode === 'general' && estimateStages.length > 0) {
        let currentDate = new Date(wizardForm.start_date);
        for (let i = 0; i < estimateStages.length; i++) {
          const stage = estimateStages[i];
          const stageTasks = estimateItems.filter((t: any) => t.stage_id === stage.id);
          const duration = Math.max(stageTasks.length * 2, 5);
          const stageStart = getNextWorkingDay(currentDate, wd);
          const stageEnd = addWD(stageStart, duration, wd);
          await supabase.from('gantt_tasks').insert({
            project_id: projectId, title: stage.name, start_date: stageStart.toISOString().split('T')[0],
            end_date: stageEnd.toISOString().split('T')[0], duration, progress: 0, is_milestone: false,
            sort_order: i, source: 'manual', color: TASK_COLORS[i % TASK_COLORS.length]
          });
          currentDate = new Date(stageEnd); currentDate.setDate(currentDate.getDate() + 1);
        }
      } else if (wizardForm.task_mode === 'detailed' && (estimateStages.length > 0 || estimateItems.length > 0)) {
        let currentDate = new Date(wizardForm.start_date); let sortOrder = 0;
        for (let si = 0; si < estimateStages.length; si++) {
          const stage = estimateStages[si];
          const stageTasks = estimateItems.filter((t: any) => t.stage_id === stage.id);
          const stageStart = getNextWorkingDay(new Date(currentDate), wd);
          let stageEnd = new Date(stageStart);
          const { data: parentData } = await supabase.from('gantt_tasks').insert({
            project_id: projectId, title: stage.name, start_date: stageStart.toISOString().split('T')[0],
            end_date: stageStart.toISOString().split('T')[0], duration: 0, progress: 0, is_milestone: false,
            sort_order: sortOrder++, source: 'manual', color: PARENT_COLOR
          }).select('id').single();
          const parentId = parentData?.id; let childDate = new Date(stageStart);
          for (const task of stageTasks) {
            const taskDuration = Math.max(task.duration || 1, 1);
            const taskStart = getNextWorkingDay(childDate, wd);
            const taskEnd = addWD(taskStart, taskDuration, wd);
            await supabase.from('gantt_tasks').insert({
              project_id: projectId, title: task.name, parent_id: parentId,
              start_date: taskStart.toISOString().split('T')[0], end_date: taskEnd.toISOString().split('T')[0],
              duration: taskDuration, progress: 0, is_milestone: false, sort_order: sortOrder++,
              source: 'estimate', color: TASK_COLORS[si % TASK_COLORS.length]
            });
            if (taskEnd > stageEnd) stageEnd = taskEnd;
            childDate = new Date(taskEnd); childDate.setDate(childDate.getDate() + 1);
          }
          if (parentId && stageTasks.length > 0) {
            await supabase.from('gantt_tasks').update({
              end_date: stageEnd.toISOString().split('T')[0],
              duration: Math.ceil((stageEnd.getTime() - stageStart.getTime()) / 86400000)
            }).eq('id', parentId);
          }
          currentDate = new Date(stageEnd); currentDate.setDate(currentDate.getDate() + 1);
        }
      }

      await loadProjects();
      const { data: freshProj } = await supabase.from('projects').select('*').eq('id', projectId).single();
      if (freshProj) setSelectedProject(freshProj);
      setShowWizard(false);
    } catch (err) { console.error('Error creating harmonogram:', err); }
    finally { setWizardSaving(false); }
  };

  // Project CRUD
  const handleOpenEditProject = (project: Project) => {
    setEditingProject(project);
    setProjectForm({ name: project.name || '', status: project.status || 'active', start_date: project.start_date ? project.start_date.split('T')[0] : '', end_date: project.end_date ? project.end_date.split('T')[0] : '' });
    setShowProjectEditModal(true);
  };
  const handleSaveProject = async () => {
    if (!editingProject || !currentUser) return; setSaving(true);
    try {
      await supabase.from('projects').update({ name: projectForm.name.trim(), status: projectForm.status, start_date: projectForm.start_date || null, end_date: projectForm.end_date || null }).eq('id', editingProject.id);
      await loadProjects(); setShowProjectEditModal(false); setEditingProject(null);
    } catch (err) { console.error(err); } finally { setSaving(false); }
  };
  const handleDeleteProject = async (project: Project) => {
    if (!confirm(`Czy na pewno chcesz usunąć projekt "${project.name}"?`)) return;
    try {
      await supabase.from('gantt_dependencies').delete().eq('project_id', project.id);
      await supabase.from('gantt_tasks').delete().eq('project_id', project.id);
      await supabase.from('projects').delete().eq('id', project.id);
      await loadProjects();
    } catch (err) { console.error(err); }
  };

  // Duration auto-calc
  useEffect(() => {
    if (phaseForm.start_date && phaseForm.duration > 0 && phaseForm.planning_mode === 'auto') {
      const s = new Date(phaseForm.start_date);
      s.setDate(s.getDate() + phaseForm.duration);
      setPhaseForm(prev => ({ ...prev, end_date: s.toISOString().split('T')[0] }));
    }
  }, [phaseForm.start_date, phaseForm.duration]);

  const filteredFlatTasks = useMemo(() => {
    let result = flatTasks;
    if (search) result = result.filter(t => getTaskTitle(t).toLowerCase().includes(search.toLowerCase()));
    if (filters.priorities.length > 0) result = result.filter(t => filters.priorities.includes(t.priority || 'normal'));
    if (filters.statuses.length > 0) result = result.filter(t => {
      const status = getDeadlineStatus(t);
      if (filters.statuses.includes('overdue') && status === 'overdue') return true;
      if (filters.statuses.includes('due-soon') && status === 'due-soon') return true;
      if (filters.statuses.includes('ok') && (status === 'ok' || status === null)) return true;
      return false;
    });
    if (filters.criticalOnly) result = result.filter(t => criticalPathIds.has(t.id));
    // Lookahead mode — only show tasks within N weeks window
    if (lookaheadMode) {
      result = filterLookaheadTasks(result, { weeks: lookaheadWeeks, startDate: new Date() });
    }
    return result;
  }, [flatTasks, search, filters, criticalPathIds, lookaheadMode, lookaheadWeeks]);

  // ========== RENDER: PROJECT SELECTION VIEW ==========
  if (!selectedProject) {
    const filteredProjects = projects.filter(p => p.name.toLowerCase().includes(search.toLowerCase()));
    return (
      <div className="p-6">
        <div className="mb-4 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[250px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input type="text" placeholder="Szukaj projektu..." value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-200 focus:border-blue-400" />
          </div>
          <button onClick={openWizard}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium shadow-sm">
            <Plus className="w-5 h-5" /> Utwórz Harmonogram
          </button>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>
        ) : filteredProjects.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
            <Calendar className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <p className="text-slate-500">{projects.length === 0 ? 'Brak projektów. Utwórz harmonogram, aby rozpocząć.' : 'Brak projektów pasujących do wyszukiwania.'}</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Projekt</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Data rozpoczęcia</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Data zakończenia</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-slate-500 uppercase">Akcje</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredProjects.map(project => (
                  <tr key={project.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setSelectedProject(project)}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: (project.color || '#3b82f6') + '20' }}>
                          <Calendar className="w-4 h-4" style={{ color: project.color || '#3b82f6' }} />
                        </div>
                        <span className="font-medium text-slate-900">{project.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${project.status === 'completed' ? 'bg-green-100 text-green-700' : project.status === 'active' ? 'bg-blue-100 text-blue-700' : project.status === 'on_hold' ? 'bg-yellow-100 text-yellow-700' : 'bg-slate-100 text-slate-600'}`}>
                        {project.status === 'active' ? 'Aktywny' : project.status === 'completed' ? 'Zakończony' : project.status === 'on_hold' ? 'Wstrzymany' : project.status || '-'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">{project.start_date ? new Date(project.start_date).toLocaleDateString('pl-PL') : '–'}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{project.end_date ? new Date(project.end_date).toLocaleDateString('pl-PL') : '–'}</td>
                    <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => handleOpenEditProject(project)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded" title="Edytuj"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => handleDeleteProject(project)} className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded" title="Usuń"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* WIZARD MODAL */}
        {showWizard && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowWizard(false)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
              <div className="p-6 pb-4 flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0"><Settings className="w-6 h-6 text-slate-600" /></div>
                <div className="flex-1">
                  <h2 className="text-xl font-bold text-slate-900">Konfiguracja harmonogramu</h2>
                  <p className="text-sm text-slate-400 mt-0.5">Dostosuj parametry czasu i zasobów</p>
                </div>
                <button onClick={() => setShowWizard(false)} className="p-2 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5 text-slate-400" /></button>
              </div>
              <div className="px-6 flex gap-0 border-b border-slate-200">
                {WIZARD_STEPS.map((step, idx) => {
                  const isActive = step.key === wizardStep;
                  const isPast = idx < wizardStepIndex;
                  return (
                    <button key={step.key} onClick={() => { if (isPast) setWizardStep(step.key); }}
                      className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-all ${isActive ? 'border-blue-500 text-blue-600' : isPast ? 'border-transparent text-slate-500 hover:text-slate-700 cursor-pointer' : 'border-transparent text-slate-300 cursor-default'}`}
                      disabled={idx > wizardStepIndex}>{step.icon}{step.label}</button>
                  );
                })}
              </div>
              <div className="flex-1 overflow-y-auto p-6">
                {wizardStep === 'project' && (
                  <div className="space-y-5">
                    <SearchableSelect label="Wybierz projekt" placeholder="Szukaj po nazwie..." value={wizardForm.project_id}
                      onChange={handleWizardProjectChange} icon={<Briefcase className="w-4 h-4" />}
                      options={projects.map(p => ({ id: p.id, label: p.name, sublabel: p.status === 'active' ? 'Aktywny' : p.status }))} />
                    <SearchableSelect label="Wybierz kosztorys" placeholder="Szukaj kosztorysu..." value={wizardForm.estimate_id}
                      onChange={handleWizardEstimateChange} icon={<FileText className="w-4 h-4" />}
                      options={allEstimates.map(e => ({ id: e.id, label: e.estimate_number || `Kosztorys #${e.id.substring(0, 8)}`, sublabel: e.request?.investment_name }))} />
                    <SearchableSelect label="Wybierz ofertę" placeholder="Szukaj oferty..." value={wizardForm.offer_id}
                      onChange={handleWizardOfferChange} icon={<ClipboardList className="w-4 h-4" />}
                      options={allOffers.map(o => ({ id: o.id, label: o.name || o.number || `Oferta #${o.id.substring(0, 8)}`, sublabel: o.project?.name }))} />
                    {!hasAnySelection && (
                      <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
                        <AlertCircle className="w-4 h-4 flex-shrink-0" /> Wybierz co najmniej jedno pole, aby kontynuować.
                      </div>
                    )}
                  </div>
                )}
                {wizardStep === 'time' && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm text-slate-500 mb-1.5">Start projektu</label>
                        <input type="date" value={wizardForm.start_date} onChange={e => setWizardForm({ ...wizardForm, start_date: e.target.value })}
                          className="w-full px-3 py-2.5 border border-slate-200 rounded-xl" />
                      </div>
                      <div>
                        <label className="block text-sm text-slate-500 mb-1.5">Deadline</label>
                        <input type="date" value={wizardForm.deadline} onChange={e => setWizardForm({ ...wizardForm, deadline: e.target.value })}
                          className="w-full px-3 py-2.5 border border-slate-200 rounded-xl" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm text-slate-500 mb-2">Dni robocze</label>
                      <div className="flex gap-2">
                        {DAY_LABELS.map((day, i) => (
                          <button key={day} type="button" onClick={() => { const nd = [...wizardForm.working_days]; nd[i] = !nd[i]; setWizardForm({ ...wizardForm, working_days: nd }); }}
                            className={`w-10 h-10 rounded-full text-sm font-medium transition-all ${wizardForm.working_days[i] ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}>{day}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                {wizardStep === 'tasks' && (
                  <div className="space-y-3">
                    <label className="block text-sm text-slate-500 mb-2">Tryb importu</label>
                    {(['empty', 'general', 'detailed'] as const).map(mode => {
                      const labels = { empty: 'Utwórz pusty harmonogram', general: 'Ogólny (Działy)', detailed: 'Szczegółowy (Pozycje)' };
                      const descs = { empty: 'Zacznij od zera — dodasz zadania ręcznie.',
                        general: estimateStages.length > 0 ? `Importuje ${estimateStages.length} działów` : 'Brak sekcji w wybranym źródle.',
                        detailed: estimateItems.length > 0 ? `Przenosi ${estimateItems.length} pozycji` : 'Brak pozycji w wybranym źródle.' };
                      const disabled = mode !== 'empty' && (estimateDataLoading || (mode === 'general' ? estimateStages.length === 0 : estimateItems.length === 0));
                      return (
                        <label key={mode} className={`flex items-start gap-4 p-4 rounded-xl border-2 transition-all ${disabled ? 'border-slate-100 bg-slate-50 cursor-not-allowed opacity-60' : wizardForm.task_mode === mode ? 'border-blue-400 bg-blue-50/50 cursor-pointer' : 'border-slate-200 hover:border-slate-300 cursor-pointer'}`}>
                          <input type="radio" name="task_mode" checked={wizardForm.task_mode === mode} onChange={() => setWizardForm({ ...wizardForm, task_mode: mode })} disabled={disabled}
                            className="mt-0.5 w-4 h-4 text-blue-600" />
                          <div><div className="font-medium text-slate-800">{labels[mode]}</div><div className="text-sm text-slate-400 mt-0.5">{descs[mode]}</div></div>
                        </label>
                      );
                    })}
                  </div>
                )}
                {wizardStep === 'resources' && (
                  <div className="space-y-4">
                    <div className="bg-slate-50 rounded-xl p-5">
                      <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Jak wyliczać czas trwania zadań?</h4>
                      {([
                        { val: 'slowest' as const, label: 'Decyduje najwolniejszy zasób', badge: 'Zalecane' },
                        { val: 'labor' as const, label: 'Priorytetyzuj robociznę', badge: '' },
                        { val: 'equipment' as const, label: 'Priorytetyzuj sprzęt', badge: '' },
                      ]).map(opt => (
                        <label key={opt.val} className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-all ${wizardForm.resource_priority === opt.val ? 'bg-white shadow-sm ring-1 ring-blue-200' : 'hover:bg-white/50'}`}>
                          <input type="radio" name="rp" checked={wizardForm.resource_priority === opt.val}
                            onChange={() => setWizardForm({ ...wizardForm, resource_priority: opt.val })} className="mt-0.5 w-4 h-4 text-blue-600" />
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-slate-800">{opt.label}</span>
                            {opt.badge && <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded-full">{opt.badge}</span>}
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between">
                <div className="text-xs text-slate-400">{wizardSaving && <span className="flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Tworzenie...</span>}</div>
                <div className="flex items-center gap-3">
                  {wizardStepIndex > 0 ? <button onClick={() => setWizardStep(WIZARD_STEPS[wizardStepIndex - 1].key)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg">Wstecz</button>
                  : <button onClick={() => setShowWizard(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg">Anuluj</button>}
                  {wizardStepIndex < WIZARD_STEPS.length - 1 ? (
                    <button onClick={() => setWizardStep(WIZARD_STEPS[wizardStepIndex + 1].key)} disabled={!canGoNext()}
                      className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium">
                      Dalej <ChevronRight className="w-4 h-4" />
                    </button>
                  ) : (
                    <button onClick={handleCreateHarmonogram} disabled={wizardSaving}
                      className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium">
                      {wizardSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Utwórz Harmonogram
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Project Edit Modal */}
        {showProjectEditModal && editingProject && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
              <div className="p-6 border-b border-slate-200 flex justify-between items-center">
                <h2 className="text-xl font-bold text-slate-900">Edytuj projekt</h2>
                <button onClick={() => { setShowProjectEditModal(false); setEditingProject(null); }} className="p-2 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-6 space-y-4">
                <div><label className="block text-sm font-medium text-slate-700 mb-1">Nazwa projektu *</label>
                  <input type="text" value={projectForm.name} onChange={e => setProjectForm({ ...projectForm, name: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg" /></div>
                <div><label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                  <select value={projectForm.status} onChange={e => setProjectForm({ ...projectForm, status: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg">
                    <option value="active">Aktywny</option><option value="on_hold">Wstrzymany</option><option value="completed">Zakończony</option>
                  </select></div>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="block text-sm font-medium text-slate-700 mb-1">Data rozpoczęcia</label>
                    <input type="date" value={projectForm.start_date} onChange={e => setProjectForm({ ...projectForm, start_date: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg" /></div>
                  <div><label className="block text-sm font-medium text-slate-700 mb-1">Data zakończenia</label>
                    <input type="date" value={projectForm.end_date} onChange={e => setProjectForm({ ...projectForm, end_date: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg" /></div>
                </div>
              </div>
              <div className="p-6 border-t border-slate-200 flex justify-end gap-3">
                <button onClick={() => { setShowProjectEditModal(false); setEditingProject(null); }} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg">Anuluj</button>
                <button onClick={handleSaveProject} disabled={saving || !projectForm.name.trim()}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />} Zapisz zmiany
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ========== RENDER: GANTT VIEW ==========
  return (
    <div className="h-full flex flex-col bg-white">
      {/* Toast notifications */}
      {errorMsg && (
        <div className="fixed top-4 right-4 z-[200] bg-red-600 text-white px-4 py-3 rounded-lg shadow-xl flex items-center gap-2 max-w-md animate-[slideIn_0.3s_ease]">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm">{errorMsg}</span>
          <button onClick={() => setErrorMsg('')} className="ml-2 p-0.5 hover:bg-red-500 rounded"><X className="w-4 h-4" /></button>
        </div>
      )}
      {successMsg && (
        <div className="fixed top-4 right-4 z-[200] bg-green-600 text-white px-4 py-3 rounded-lg shadow-xl flex items-center gap-2 max-w-md">
          <Check className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm">{successMsg}</span>
        </div>
      )}
      {/* Top toolbar */}
      <div className="px-3 py-2 bg-white border-b border-slate-200 flex items-center gap-2 flex-shrink-0">
        {/* Group: Navigation & Tasks */}
        <button onClick={() => setSelectedProject(null)} className="p-1.5 hover:bg-slate-100 rounded-lg" title="Wróć do listy (Esc)">
          <ArrowLeft className="w-4 h-4 text-slate-500" />
        </button>
        <div className="h-5 w-px bg-slate-200" />
        <button onClick={() => openCreatePhase()} title="Utwórz nową fazę"
          className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium">
          <Plus className="w-3.5 h-3.5" /> Utwórz fazę
        </button>
        <button onClick={() => openCreateDep()} title="Dodaj zależność między fazami"
          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 text-sm font-medium">
          <LinkIcon className="w-3.5 h-3.5" /> Zależność
        </button>
        <button onClick={handleAutoSchedule} disabled={saving || allFlatTasks.length === 0} title="Automatyczne planowanie (przelicz daty wg zależności)"
          className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 text-sm font-medium">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />} Planuj
        </button>

        {/* Group: Undo/Redo */}
        <div className="h-5 w-px bg-slate-200" />
        <button onClick={handleUndo} disabled={undoStack.length === 0} title={`Cofnij (Ctrl+Z)${undoStack.length > 0 ? ` — ${undoStack.length}` : ''}`}
          className="p-1.5 hover:bg-slate-100 rounded-lg disabled:opacity-30 relative">
          <Undo2 className="w-4 h-4 text-slate-500" />
          {undoStack.length > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 bg-blue-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">{undoStack.length}</span>}
        </button>
        <button onClick={handleRedo} disabled={redoStack.length === 0} title={`Ponów (Ctrl+Y)${redoStack.length > 0 ? ` — ${redoStack.length}` : ''}`}
          className="p-1.5 hover:bg-slate-100 rounded-lg disabled:opacity-30 relative">
          <Redo2 className="w-4 h-4 text-slate-500" />
          {redoStack.length > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 bg-blue-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">{redoStack.length}</span>}
        </button>

        <div className="h-5 w-px bg-slate-200" />
        <span className="text-sm font-semibold text-slate-800 truncate">{selectedProject.name}</span>
        <span className="text-xs text-slate-400 ml-1">{allFlatTasks.length} faz</span>
        <div className="flex-1" />

        {/* Group: View — Filter toggle */}
        <button onClick={() => setShowFilterPanel(prev => !prev)} title="Filtry (F)"
          className={`p-1.5 rounded-lg relative ${showFilterPanel ? 'bg-blue-100 text-blue-600' : 'hover:bg-slate-100 text-slate-500'}`}>
          <Filter className="w-4 h-4" />
          {activeFilterCount > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 bg-orange-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">{activeFilterCount}</span>}
        </button>
        {/* Help */}
        <button onClick={() => setShowHelp(prev => !prev)} title="Pomoc i legenda (?)"
          className={`p-1.5 rounded-lg ${showHelp ? 'bg-blue-100 text-blue-600' : 'hover:bg-slate-100 text-slate-500'}`}>
          <HelpCircle className="w-4 h-4" />
        </button>

        <div className="h-5 w-px bg-slate-200" />

        {/* Harmonogram start */}
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <span className="font-medium">Początek harmonogramu</span>
          <Calendar className="w-4 h-4 text-slate-400" />
          <input type="date" value={harmonogramStart} onChange={e => handleChangeHarmonogramStart(e.target.value)}
            className="px-2 py-1 border border-slate-200 rounded-lg text-sm" />
        </div>

        {/* Settings gear */}
        <div className="relative" ref={settingsRef}>
          <button onClick={() => setShowSettingsMenu(!showSettingsMenu)} className="p-1.5 hover:bg-slate-100 rounded-lg" title="Ustawienia">
            <MoreVertical className="w-4 h-4 text-slate-500" />
          </button>
          {showSettingsMenu && (
            <div className="absolute right-0 top-full mt-1 z-50 bg-white rounded-lg shadow-xl border border-slate-200 py-2 w-72">
              <div className="px-4 py-1.5 text-xs font-semibold text-slate-400 uppercase">Zobacz opcje</div>
              <label className="flex items-center gap-3 px-4 py-2 hover:bg-slate-50 cursor-pointer">
                <input type="checkbox" checked={hideClosedTasks} onChange={e => setHideClosedTasks(e.target.checked)} className="w-4 h-4 rounded text-blue-600" />
                <span className="text-sm text-slate-700">Ukryj zamknięte zadania</span>
              </label>
              <label className="flex items-center gap-3 px-4 py-2 hover:bg-slate-50 cursor-pointer">
                <input type="checkbox" checked={showDependencies} onChange={e => setShowDependencies(e.target.checked)} className="w-4 h-4 rounded text-blue-600" />
                <span className="text-sm text-slate-700">Pokaż zależności</span>
              </label>
              <label className="flex items-center gap-3 px-4 py-2 hover:bg-slate-50 cursor-pointer">
                <input type="checkbox" checked={showCriticalPath} onChange={e => setShowCriticalPath(e.target.checked)} className="w-4 h-4 rounded text-blue-600" />
                <span className="text-sm text-slate-700">Pokaż ścieżkę krytyczną</span>
              </label>
              <button onClick={() => { expandAll(); setShowSettingsMenu(false); }} className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                <Maximize2 className="w-4 h-4" /> Rozwiń wszystko
              </button>
              <button onClick={() => { collapseAll(); setShowSettingsMenu(false); }} className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                <Minimize2 className="w-4 h-4" /> Zwiń wszystko
              </button>
              <div className="border-t border-slate-100 my-1" />
              <div className="px-4 py-1.5 text-xs font-semibold text-slate-400 uppercase">Ustawienia projektu</div>
              <button onClick={() => { setShowWorkingDaysModal(true); setShowSettingsMenu(false); }}
                className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                <Calendar className="w-4 h-4" /> Edytuj dni robocze
              </button>
              <div className="border-t border-slate-100 my-1" />
              <div className="px-4 py-1.5 text-xs font-semibold text-slate-400 uppercase">Zaawansowane</div>
              <button onClick={() => { handleInitDefaultNorms(); setShowSettingsMenu(false); }}
                className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                <Wrench className="w-4 h-4" /> Zainicjuj normy produkcyjne
              </button>
              <button onClick={() => { handleGenerateWorkOrders(); setShowSettingsMenu(false); }}
                className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                <ClipboardList className="w-4 h-4" /> Generuj naryk pracy
              </button>
              <div className="border-t border-slate-100 my-1" />
              <div className="px-4 py-1.5 text-xs font-semibold text-slate-400 uppercase">Import / Eksport</div>
              <button onClick={() => { handleExportJSON(); setShowSettingsMenu(false); }}
                className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                <FileDown className="w-4 h-4" /> Eksportuj JSON
              </button>
              <button onClick={() => { handleExportCSV(); setShowSettingsMenu(false); }}
                className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                <Download className="w-4 h-4" /> Eksportuj CSV
              </button>
              <button onClick={() => { handleImportJSON(); setShowSettingsMenu(false); }}
                className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                <Upload className="w-4 h-4" /> Importuj z JSON
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Zoom bar */}
      <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-200 flex items-center gap-2 flex-shrink-0">
        <div className="flex items-center bg-white rounded-lg border border-slate-200 p-0.5">
          {(['day', 'week', 'month'] as ZoomLevel[]).map(z => (
            <button key={z} onClick={() => setZoomLevel(z)}
              title={z === 'day' ? 'Widok dzienny (+)' : z === 'week' ? 'Widok tygodniowy' : 'Widok miesięczny (-)'}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${zoomLevel === z ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              {z === 'day' ? 'Dzień' : z === 'week' ? 'Tydzień' : 'Miesiąc'}
            </button>
          ))}
        </div>
        <button onClick={scrollToToday} title="Dzisiaj (T)" className="px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 rounded-md">
          Dzisiaj
        </button>
        <div className="flex-1" />
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input type="text" placeholder="Szukaj..." value={search} onChange={e => setSearch(e.target.value)}
            className="pl-7 pr-3 py-1 text-xs border border-slate-200 rounded-lg w-44 focus:ring-1 focus:ring-blue-200" />
        </div>
      </div>

      {/* Advanced features toolbar */}
      <div className="px-3 py-1 bg-white border-b border-slate-100 flex items-center gap-1 flex-shrink-0 overflow-x-auto">
        <span className="text-[10px] font-semibold text-slate-400 uppercase mr-1">Zaawansowane:</span>
        <button onClick={() => { setShowBaselineModal(true); setBaselineName(`Baseline ${new Date().toLocaleDateString('pl-PL')}`); }}
          title="Zapisz/Przywróć baseline"
          className={`flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-all ${activeBaseline ? 'bg-purple-100 text-purple-700' : 'hover:bg-slate-100 text-slate-600'}`}>
          <Bookmark className="w-3 h-3" /> Baseline
        </button>
        <button onClick={() => setLookaheadMode(!lookaheadMode)}
          title="Tryb Lookahead (Last Planner)"
          className={`flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-all ${lookaheadMode ? 'bg-green-100 text-green-700' : 'hover:bg-slate-100 text-slate-600'}`}>
          <Target className="w-3 h-3" /> Lookahead
        </button>
        {lookaheadMode && (
          <select value={lookaheadWeeks} onChange={e => setLookaheadWeeks(Number(e.target.value))}
            className="text-xs border border-slate-200 rounded px-1 py-0.5">
            {[2,3,4,5,6].map(w => <option key={w} value={w}>{w} tyg.</option>)}
          </select>
        )}
        <button onClick={() => setShowAdvancedPanel(showAdvancedPanel === 'zones' ? null : 'zones')}
          title="Strefy / Piętra"
          className={`flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-all ${showAdvancedPanel === 'zones' ? 'bg-blue-100 text-blue-700' : 'hover:bg-slate-100 text-slate-600'}`}>
          <Map className="w-3 h-3" /> Strefy
        </button>
        <button onClick={() => setShowAdvancedPanel(showAdvancedPanel === 'materials' ? null : 'materials')}
          title="Materiały / Logistyka"
          className={`flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-all ${showAdvancedPanel === 'materials' ? 'bg-orange-100 text-orange-700' : 'hover:bg-slate-100 text-slate-600'}`}>
          <Package className="w-3 h-3" /> Materiały
        </button>
        <button onClick={() => setShowAdvancedPanel(showAdvancedPanel === 'rfis' ? null : 'rfis')}
          title="RFI — zapytania"
          className={`flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-all ${showAdvancedPanel === 'rfis' ? 'bg-indigo-100 text-indigo-700' : 'hover:bg-slate-100 text-slate-600'}`}>
          <FileQuestion className="w-3 h-3" /> RFI{rfis.length > 0 && <span className="ml-0.5 px-1 py-0 bg-indigo-200 text-indigo-700 rounded-full text-[9px]">{rfis.length}</span>}
        </button>
        <button onClick={handleGenerateInsights}
          title="Analityka predykcyjna"
          className={`flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-all ${showInsights ? 'bg-emerald-100 text-emerald-700' : 'hover:bg-slate-100 text-slate-600'}`}>
          <TrendingUp className="w-3 h-3" /> Insights
        </button>
        <button onClick={() => setShowAdvancedPanel(showAdvancedPanel === 'workorders' ? null : 'workorders')}
          title="Narydy pracy"
          className={`flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-all ${showAdvancedPanel === 'workorders' ? 'bg-teal-100 text-teal-700' : 'hover:bg-slate-100 text-slate-600'}`}>
          <Wrench className="w-3 h-3" /> Narydy{workOrders.length > 0 && <span className="ml-0.5 px-1 py-0 bg-teal-200 text-teal-700 rounded-full text-[9px]">{workOrders.length}</span>}
        </button>
        <button onClick={() => setShowAdvancedPanel(showAdvancedPanel === 'acts' ? null : 'acts')}
          title="Akty odbioru"
          className={`flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-all ${showAdvancedPanel === 'acts' ? 'bg-violet-100 text-violet-700' : 'hover:bg-slate-100 text-slate-600'}`}>
          <BookmarkCheck className="w-3 h-3" /> Odbiory{acceptedActs.length > 0 && <span className="ml-0.5 px-1 py-0 bg-violet-200 text-violet-700 rounded-full text-[9px]">{acceptedActs.length}</span>}
        </button>
        <div className="flex-1" />
        {activeBaseline && (
          <span className="flex items-center gap-1 text-[10px] text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full">
            <BookmarkCheck className="w-3 h-3" /> {activeBaseline.name}
            <button onClick={() => setActiveBaseline(null)} className="ml-1 hover:text-purple-800"><X className="w-3 h-3" /></button>
          </span>
        )}
      </div>

      {/* Filter panel */}
      {showFilterPanel && (
        <div className="px-3 py-2 bg-blue-50/50 border-b border-slate-200 flex items-center gap-3 flex-shrink-0 flex-wrap">
          <span className="text-xs font-semibold text-slate-500 uppercase">Priorytet:</span>
          {([
            { val: 'low', label: 'Niski', color: 'bg-slate-200 text-slate-700' },
            { val: 'normal', label: 'Normalny', color: 'bg-blue-200 text-blue-700' },
            { val: 'high', label: 'Wysoki', color: 'bg-amber-200 text-amber-700' },
            { val: 'critical', label: 'Krytyczny', color: 'bg-red-200 text-red-700' },
          ] as const).map(p => (
            <button key={p.val} onClick={() => setFilters(prev => ({
              ...prev, priorities: prev.priorities.includes(p.val) ? prev.priorities.filter(x => x !== p.val) : [...prev.priorities, p.val]
            }))}
              className={`px-2 py-0.5 text-xs rounded-full font-medium transition-all ${filters.priorities.includes(p.val) ? p.color + ' ring-2 ring-offset-1 ring-current' : 'bg-white text-slate-400 border border-slate-200'}`}>
              {p.label}
            </button>
          ))}
          <div className="h-4 w-px bg-slate-300" />
          <span className="text-xs font-semibold text-slate-500 uppercase">Status:</span>
          {([
            { val: 'overdue', label: 'Spóźnione', color: 'bg-red-200 text-red-700' },
            { val: 'due-soon', label: 'Wkrótce', color: 'bg-amber-200 text-amber-700' },
            { val: 'ok', label: 'W terminie', color: 'bg-green-200 text-green-700' },
          ] as const).map(s => (
            <button key={s.val} onClick={() => setFilters(prev => ({
              ...prev, statuses: prev.statuses.includes(s.val) ? prev.statuses.filter(x => x !== s.val) : [...prev.statuses, s.val]
            }))}
              className={`px-2 py-0.5 text-xs rounded-full font-medium transition-all ${filters.statuses.includes(s.val) ? s.color + ' ring-2 ring-offset-1 ring-current' : 'bg-white text-slate-400 border border-slate-200'}`}>
              {s.label}
            </button>
          ))}
          <div className="h-4 w-px bg-slate-300" />
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={filters.criticalOnly} onChange={e => setFilters(prev => ({ ...prev, criticalOnly: e.target.checked }))}
              className="w-3.5 h-3.5 rounded text-blue-600" />
            <span className="text-xs text-slate-600">Tylko ścieżka krytyczna</span>
          </label>
          {activeFilterCount > 0 && (
            <button onClick={() => setFilters({ priorities: [], statuses: [], criticalOnly: false })}
              className="px-2 py-0.5 text-xs text-red-600 hover:bg-red-50 rounded-full font-medium">
              Wyczyść ({activeFilterCount})
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex-1 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* LEFT PANEL: task table */}
          <div ref={leftPanelRef} className="flex-shrink-0 border-r border-slate-300 bg-white overflow-auto" style={{ width: leftPanelWidth }}>
            {/* Table header */}
            <div className="sticky top-0 z-30 bg-slate-100 border-b border-slate-300 flex items-center text-[10px] font-semibold text-slate-500 uppercase tracking-wide" style={{ height: 56 }}>
              <div className="w-14 text-center shrink-0 px-1">SPP</div>
              <div className="flex-1 px-2 min-w-[120px]">Nazwa</div>
              <div className="w-8 text-center" title="Przypisany"><Users className="w-3 h-3 mx-auto text-slate-400" /></div>
              <div className="w-20 px-1 text-center">Czas</div>
              <div className="w-24 px-1 text-center">Rozpocz.</div>
              <div className="w-24 px-1 text-center">Zakończ.</div>
              <div className="w-20 px-1 text-center">Postęp</div>
              <div className="w-8 flex items-center justify-center">
                <button onClick={() => setShowSettingsMenu(!showSettingsMenu)} className="p-1 hover:bg-slate-200 rounded">
                  <Settings className="w-3 h-3 text-slate-400" />
                </button>
              </div>
            </div>

            {filteredFlatTasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12">
                <Calendar className="w-10 h-10 text-slate-300 mb-3" />
                <p className="text-sm text-slate-400">Brak faz w harmonogramie</p>
                <button onClick={() => openCreatePhase()} className="mt-3 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm">
                  <Plus className="w-4 h-4 inline mr-1" /> Utwórz fazę
                </button>
              </div>
            ) : (
              filteredFlatTasks.map((task, rowIdx) => {
                const title = getTaskTitle(task);
                const isParent = isParentTask(task);
                const progress = task.progress || 0;
                const deadline = getDeadlineStatus(task);
                const isHovered = hoveredRowId === task.id;
                const isSelected = selectedTaskId === task.id;
                return (
                  <div key={task.id}
                    className={`flex items-center border-b cursor-pointer group transition-colors ${isSelected ? 'bg-blue-100' : isHovered ? 'bg-blue-50' : rowIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'} ${deadline === 'overdue' ? 'border-l-2 border-l-red-400' : deadline === 'due-soon' ? 'border-l-2 border-l-amber-400' : ''} border-b-slate-100 hover:bg-blue-50`}
                    style={{ height: ROW_HEIGHT }}
                    onClick={() => { setSelectedTaskId(task.id); openEditPhase(task); }}
                    onContextMenu={(e) => handleContextMenu(e, task)}
                    onMouseEnter={() => setHoveredRowId(task.id)}
                    onMouseLeave={() => setHoveredRowId(null)}>
                    {/* Priority dot + WBS */}
                    <div className="w-14 flex items-center justify-center shrink-0 px-1 gap-1">
                      {task.priority && task.priority !== 'normal' && (
                        <div className="w-2 h-2 rounded-full flex-shrink-0" title={`Priorytet: ${task.priority === 'low' ? 'Niski' : task.priority === 'high' ? 'Wysoki' : 'Krytyczny'}`} style={{ backgroundColor: PRIORITY_COLORS[task.priority] }} />
                      )}
                      <span className="text-xs text-slate-500 font-medium">{task.wbs}</span>
                    </div>
                    {/* Name — with inline editing */}
                    <div className="flex-1 flex items-center gap-1.5 px-2 min-w-[120px]" style={{ paddingLeft: `${8 + (task.level || 0) * 18}px` }}>
                      {isParent ? (
                        <button onClick={(e) => { e.stopPropagation(); toggleTaskExpand(task.id); }}
                          title={task.isExpanded ? 'Zwiń' : 'Rozwiń'}
                          className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 bg-blue-600 text-white hover:bg-blue-700 transition-colors">
                          {task.isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        </button>
                      ) : task.is_milestone ? (
                        <Milestone className="w-4 h-4 text-amber-500 flex-shrink-0" />
                      ) : (
                        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 ml-1.5" style={{ backgroundColor: task.color || '#93c5fd' }} />
                      )}
                      {inlineEdit?.taskId === task.id && inlineEdit.field === 'title' ? (
                        <input type="text" autoFocus value={inlineEdit.value}
                          onClick={e => e.stopPropagation()}
                          onChange={e => setInlineEdit({ ...inlineEdit, value: e.target.value })}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleInlineSave();
                            if (e.key === 'Escape') setInlineEdit(null);
                            if (e.key === 'Tab') { e.preventDefault(); handleInlineSave(); setInlineEdit({ taskId: task.id, field: 'duration', value: String(task.duration || '') }); }
                          }}
                          onBlur={handleInlineSave}
                          className="text-sm flex-1 min-w-0 px-1 py-0.5 border border-blue-400 rounded focus:ring-1 focus:ring-blue-300 outline-none" />
                      ) : (
                        <span className={`text-sm truncate ${isParent ? 'font-semibold text-slate-800' : 'text-slate-700'}`}
                          onDoubleClick={(e) => { e.stopPropagation(); setInlineEdit({ taskId: task.id, field: 'title', value: task.title || '' }); }}>
                          {title}
                        </span>
                      )}
                      {/* Deadline warning icon */}
                      {deadline === 'overdue' && <span title="Przekroczony termin!"><AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" /></span>}
                      {deadline === 'due-soon' && <span title="Termin wkrótce"><Clock className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" /></span>}
                      {(task as any).lps_status && LPS_STATUS_LABELS[(task as any).lps_status as LPSStatus] && (
                        <span className="px-1 py-0 text-[9px] font-medium rounded flex-shrink-0"
                          style={{ backgroundColor: LPS_STATUS_COLORS[(task as any).lps_status as LPSStatus] + '30', color: LPS_STATUS_COLORS[(task as any).lps_status as LPSStatus] }}
                          title={`LPS: ${LPS_STATUS_LABELS[(task as any).lps_status as LPSStatus]}`}>
                          {LPS_STATUS_LABELS[(task as any).lps_status as LPSStatus]}
                        </span>
                      )}
                    </div>
                    {/* Assigned user avatar */}
                    <div className="w-8 flex items-center justify-center flex-shrink-0" onClick={e => e.stopPropagation()}>
                      {task.assigned_to && (
                        <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[9px] font-bold"
                          title={`${task.assigned_to.first_name || ''} ${task.assigned_to.last_name || ''}`}>
                          {getUserInitials(task.assigned_to)}
                        </div>
                      )}
                    </div>
                    {/* Duration — with inline editing */}
                    <div className="w-20 px-1 text-center text-xs text-slate-500" onClick={e => e.stopPropagation()}>
                      {inlineEdit?.taskId === task.id && inlineEdit.field === 'duration' ? (
                        <input type="number" autoFocus value={inlineEdit.value} min="0"
                          onChange={e => setInlineEdit({ ...inlineEdit, value: e.target.value })}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleInlineSave();
                            if (e.key === 'Escape') setInlineEdit(null);
                          }}
                          onBlur={handleInlineSave}
                          className="w-full text-center text-xs px-1 py-0.5 border border-blue-400 rounded focus:ring-1 focus:ring-blue-300 outline-none" />
                      ) : (
                        <span onDoubleClick={() => setInlineEdit({ taskId: task.id, field: 'duration', value: String(task.duration || '') })}>
                          {task.duration ? `${task.duration} d.` : '–'}
                        </span>
                      )}
                    </div>
                    <div className="w-24 px-1 text-center text-xs text-slate-500">{task.start_date ? new Date(task.start_date).toLocaleDateString('pl-PL') : '–'}</div>
                    <div className={`w-24 px-1 text-center text-xs ${deadline === 'overdue' ? 'text-red-600 font-medium' : deadline === 'due-soon' ? 'text-amber-600' : 'text-slate-500'}`}>
                      {task.end_date ? new Date(task.end_date).toLocaleDateString('pl-PL') : '–'}
                    </div>
                    <div className="w-20 px-1" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${progress >= 100 ? 'bg-green-500' : progress > 0 ? 'bg-blue-500' : ''}`}
                            style={{ width: `${Math.min(progress, 100)}%` }} />
                        </div>
                        <span className="text-[10px] text-slate-400 w-7 text-right">{progress}%</span>
                      </div>
                    </div>
                    <div className="w-8 flex items-center justify-center" onClick={e => e.stopPropagation()}>
                      <button onClick={(e) => handleContextMenu(e, task)} title="Więcej opcji" className="p-1 hover:bg-slate-200 rounded opacity-30 group-hover:opacity-100 transition-opacity">
                        <MoreVertical className="w-3.5 h-3.5 text-slate-400" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Splitter */}
          <div className="w-1.5 bg-slate-200 hover:bg-blue-400 cursor-col-resize flex-shrink-0 transition-colors"
            title="Przeciągnij, aby zmienić szerokość panelu"
            onMouseDown={handleSplitterMouseDown} />

          {/* RIGHT PANEL: timeline chart */}
          <div className="flex-1 overflow-auto relative" ref={chartRef}>
            <div style={{ width: chartWidth, minHeight: '100%' }} className="relative">
              {/* Timeline header */}
              <div className="sticky top-0 z-30 bg-white" style={{ height: 56 }}>
                {/* Row 1: months / primary */}
                <div className="flex h-7 bg-slate-100 border-b border-slate-200">
                  {primaryHeaders.map((m, i) => (
                    <div key={i} className="border-r border-slate-200 flex items-center justify-center text-xs font-semibold overflow-hidden"
                      style={{ position: 'absolute', left: m.startOffset * dayWidth, width: m.days * dayWidth }}>
                      <span className="text-slate-700 capitalize">{m.label}</span>
                    </div>
                  ))}
                </div>
                {/* Row 2: dates / secondary */}
                <div className="flex h-7 bg-slate-50 border-b border-slate-300" style={{ marginTop: 0 }}>
                  {secondaryHeaders.map((h, i) => {
                    const w = h.days * dayWidth;
                    return (
                      <div key={i} className={`border-r flex items-center justify-center text-[10px] font-medium overflow-hidden border-slate-200 ${(h as any).isWeekend ? 'bg-slate-100 text-slate-400' : ''}`}
                        style={{ position: 'absolute', left: h.startOffset * dayWidth, width: w, top: 28 }}>
                        {w > 20 && <span className={`truncate px-0.5 ${(h as any).isWeekend ? 'text-slate-400' : 'text-slate-600'}`}>{h.label}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Smart Today button — only shows when today is scrolled out of view */}
              {(() => {
                const today = new Date();
                if (today < dateRange.start || today > dateRange.end) return null;
                const todayOffset = getDaysBetween(dateRange.start, today) * dayWidth;
                const cr = chartRef.current;
                const scrollLeft = chartScrollLeft;
                const viewWidth = cr?.clientWidth || 800;
                const todayVisible = todayOffset >= scrollLeft && todayOffset <= scrollLeft + viewWidth;
                if (todayVisible) return null;
                const isLeft = todayOffset < scrollLeft;
                return (
                  <button onClick={scrollToToday}
                    className={`sticky z-30 ${isLeft ? 'left-2' : 'left-[calc(100%-100px)]'} top-16 bg-red-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium shadow-lg hover:bg-red-600 flex items-center gap-1.5 transition-all`}>
                    {isLeft ? <ArrowLeft className="w-3 h-3" /> : null}
                    Dzisiaj
                    {!isLeft ? <ArrowRight className="w-3 h-3" /> : null}
                  </button>
                );
              })()}

              {/* Today line */}
              {(() => {
                const today = new Date();
                if (today >= dateRange.start && today <= dateRange.end) {
                  const daysFromStart = getDaysBetween(dateRange.start, today);
                  return (
                    <div className="absolute z-20 pointer-events-none" style={{ left: daysFromStart * dayWidth - 1, top: 0, bottom: 0, width: 2, background: '#ef4444' }}>
                      <div className="absolute -top-0 -left-1.5 w-4 h-4 bg-red-500 rounded-full border-2 border-white shadow" style={{ top: 48 }} />
                    </div>
                  );
                }
                return null;
              })()}

              {/* Task rows + bars */}
              {filteredFlatTasks.map((task, rowIdx) => {
                const pos = getTaskPosition(task);
                const isParent = isParentTask(task);
                const title = getTaskTitle(task);
                return (
                  <div key={task.id}
                    className={`relative border-b transition-colors ${hoveredRowId === task.id ? 'bg-blue-50/40' : rowIdx % 2 === 0 ? '' : 'bg-slate-50/30'} border-slate-50`}
                    style={{ height: ROW_HEIGHT }}
                    onMouseEnter={() => setHoveredRowId(task.id)}
                    onMouseLeave={() => setHoveredRowId(null)}>
                    {/* Weekend shading */}
                    {zoomLevel !== 'month' && Array.from({ length: totalDays }).map((_, i) => {
                      const date = new Date(dateRange.start); date.setDate(date.getDate() + i);
                      if (date.getDay() !== 0 && date.getDay() !== 6) return null;
                      return <div key={i} className="absolute top-0 bottom-0 bg-slate-50/70" style={{ left: i * dayWidth, width: dayWidth }} />;
                    })}

                    {task.start_date && (
                      <>
                        {task.is_milestone ? (
                          <div className="absolute w-4 h-4 rotate-45 bg-amber-500 border-2 border-amber-600 z-10"
                            style={{ left: pos.left - 8, top: (ROW_HEIGHT - 16) / 2 }}
                            title={`${title}: ${new Date(task.start_date).toLocaleDateString('pl-PL')}`} />
                        ) : isParent ? (
                          <div className="absolute z-10 flex items-end" style={{ left: pos.left, width: Math.max(pos.width, 4), top: (ROW_HEIGHT - 12) / 2, height: 12 }}>
                            <div className="w-full h-2 rounded-sm" style={{ backgroundColor: PARENT_COLOR }} />
                            <div className="absolute left-0 bottom-0 w-2.5 h-3" style={{ backgroundColor: PARENT_COLOR, clipPath: 'polygon(0 0, 100% 0, 50% 100%)' }} />
                            <div className="absolute right-0 bottom-0 w-2.5 h-3" style={{ backgroundColor: PARENT_COLOR, clipPath: 'polygon(0 0, 100% 0, 50% 100%)' }} />
                          </div>
                        ) : (
                          <div className="absolute z-10 rounded overflow-hidden shadow-sm hover:shadow-md transition-shadow group/bar"
                            style={{
                              left: dragPreview?.taskId === task.id ? dragPreview.left : pos.left,
                              width: Math.max(dragPreview?.taskId === task.id ? dragPreview.width : pos.width, 4),
                              top: (ROW_HEIGHT - 20) / 2, height: 20,
                              backgroundColor: criticalPathIds.has(task.id) ? '#fca5a5' : (task.color || '#93c5fd'),
                              cursor: dragState?.taskId === task.id ? 'grabbing' : 'grab',
                              opacity: dragPreview?.taskId === task.id ? 0.85 : 1
                            }}
                            onMouseDown={(e) => handleBarMouseDown(e, task, 'move')}
                            title={`${title}\n${task.start_date ? new Date(task.start_date).toLocaleDateString('pl-PL') : ''} → ${task.end_date ? new Date(task.end_date).toLocaleDateString('pl-PL') : ''}\nCzas trwania: ${task.duration || '–'} d.\nPostęp: ${task.progress || 0}%`}>
                            {task.progress > 0 && (
                              <div className="absolute left-0 top-0 bottom-0 rounded" style={{ width: `${Math.min(task.progress, 100)}%`, backgroundColor: criticalPathIds.has(task.id) ? '#ef4444' : '#3b82f6' }} />
                            )}
                            {/* Progress text on wider bars */}
                            {(dragPreview?.taskId === task.id ? dragPreview.width : pos.width) > 60 && (
                              <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-white drop-shadow-sm pointer-events-none z-10">
                                {task.progress > 0 ? `${task.progress}%` : ''}
                              </span>
                            )}
                            {/* Resize handle (left edge) */}
                            <div className="absolute left-0 top-0 bottom-0 w-2 cursor-w-resize opacity-0 group-hover/bar:opacity-100 bg-white/30 hover:bg-white/60"
                              title="Przeciągnij, aby zmienić datę rozpoczęcia"
                              onMouseDown={(e) => { e.stopPropagation(); handleBarMouseDown(e, task, 'resize-start'); }} />
                            {/* Resize handle (right edge) */}
                            <div className="absolute right-0 top-0 bottom-0 w-2 cursor-e-resize opacity-0 group-hover/bar:opacity-100 bg-white/30 hover:bg-white/60"
                              title="Przeciągnij, aby zmienić czas trwania"
                              onMouseDown={(e) => { e.stopPropagation(); handleBarMouseDown(e, task, 'resize-end'); }} />
                            {/* Connection dots for drag-to-connect */}
                            <div className="absolute -left-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-blue-500 bg-white opacity-0 group-hover/bar:opacity-100 cursor-crosshair z-20 hover:bg-blue-100 hover:scale-125 transition-all"
                              title="Przeciągnij, aby utworzyć zależność (od początku)"
                              onMouseDown={(e) => { e.stopPropagation(); handleConnectStart(e, task.id, 'start'); }} />
                            <div className="absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-blue-500 bg-white opacity-0 group-hover/bar:opacity-100 cursor-crosshair z-20 hover:bg-blue-100 hover:scale-125 transition-all"
                              title="Przeciągnij, aby utworzyć zależność (od końca)"
                              onMouseDown={(e) => { e.stopPropagation(); handleConnectStart(e, task.id, 'end'); }} />
                          </div>
                        )}
                        {/* Baseline ghost bar */}
                        {activeBaseline && (() => {
                          const snap = (activeBaseline.tasks_snapshot)?.find((s: BaselineTaskSnapshot) => s.task_id === task.id);
                          if (!snap?.start_date) return null;
                          const bStart = getDaysBetween(dateRange.start, new Date(snap.start_date));
                          const bEnd = snap.end_date ? new Date(snap.end_date) : new Date(snap.start_date);
                          const bDur = Math.max(getDaysBetween(new Date(snap.start_date), bEnd), 1);
                          return (
                            <div className="absolute z-[9] pointer-events-none rounded border-2 border-dashed border-purple-400 opacity-50"
                              style={{ left: bStart * dayWidth, width: bDur * dayWidth, top: (ROW_HEIGHT - 24) / 2, height: 24 }}
                              title={`Baseline: ${new Date(snap.start_date).toLocaleDateString('pl-PL')} → ${snap.end_date ? new Date(snap.end_date).toLocaleDateString('pl-PL') : '–'}`} />
                          );
                        })()}
                        {/* Label next to bar */}
                        {!task.is_milestone && pos.width > 0 && (
                          <span className="absolute z-10 text-[11px] text-slate-600 whitespace-nowrap pointer-events-none font-medium"
                            style={{ left: pos.left + pos.width + 6, top: (ROW_HEIGHT - 16) / 2, lineHeight: '16px' }}>
                            {title}{task.progress > 0 ? ` - ${task.progress}%` : ''}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                );
              })}

              {/* Dependency arrows + drag-to-connect line (SVG) */}
              <svg className="absolute top-14 left-0 w-full h-full pointer-events-none" style={{ overflow: 'visible', zIndex: 15 }}>
                <defs>
                  <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                    <polygon points="0 0, 8 3, 0 6" fill="#475569" />
                  </marker>
                  <marker id="arrowhead-blue" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                    <polygon points="0 0, 8 3, 0 6" fill="#3b82f6" />
                  </marker>
                  <marker id="arrowhead-highlight" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                    <polygon points="0 0, 8 3, 0 6" fill="#2563eb" />
                  </marker>
                </defs>
                {/* Existing dependencies */}
                {showDependencies && dependencies.map(dep => {
                  const predIdx = filteredFlatTasks.findIndex(t => t.id === dep.predecessor_id);
                  const succIdx = filteredFlatTasks.findIndex(t => t.id === dep.successor_id);
                  if (predIdx < 0 || succIdx < 0) return null;
                  const pred = filteredFlatTasks[predIdx];
                  const succ = filteredFlatTasks[succIdx];
                  const predPos = getTaskPosition(pred);
                  const succPos = getTaskPosition(succ);
                  let x1 = predPos.left + predPos.width;
                  let y1 = predIdx * ROW_HEIGHT + ROW_HEIGHT / 2;
                  let x2 = succPos.left;
                  let y2 = succIdx * ROW_HEIGHT + ROW_HEIGHT / 2;
                  if (dep.dependency_type === 'SS') { x1 = predPos.left; x2 = succPos.left; }
                  else if (dep.dependency_type === 'FF') { x1 = predPos.left + predPos.width; x2 = succPos.left + succPos.width; }
                  else if (dep.dependency_type === 'SF') { x1 = predPos.left; x2 = succPos.left + succPos.width; }
                  // L-shaped routing for cleaner lines
                  const gapX = 12;
                  const exitX = dep.dependency_type === 'FS' || dep.dependency_type === 'FF' ? x1 + gapX : x1 - gapX;
                  const enterX = dep.dependency_type === 'FS' || dep.dependency_type === 'SS' ? x2 - gapX : x2 + gapX;
                  const path = y1 === y2
                    ? `M ${x1} ${y1} L ${x2} ${y2}`
                    : `M ${x1} ${y1} L ${exitX} ${y1} L ${exitX} ${y2} L ${x2} ${y2}`;
                  // Stroke pattern per dependency type
                  const isHovDep = hoveredDepId === dep.id;
                  const strokeDash = dep.dependency_type === 'FS' ? 'none'
                    : dep.dependency_type === 'SS' ? '6 3'
                    : dep.dependency_type === 'FF' ? '2 2'
                    : '8 3 2 3'; // SF
                  const strokeColor = isHovDep ? '#2563eb' : '#475569';
                  const strokeW = isHovDep ? 2.5 : 1.5;
                  return (
                    <g key={dep.id} className="cursor-pointer" style={{ pointerEvents: 'auto' }}
                      onClick={() => openEditDep(dep)}
                      onMouseEnter={() => setHoveredDepId(dep.id)}
                      onMouseLeave={() => setHoveredDepId(null)}>
                      <path d={path} fill="none" stroke="transparent" strokeWidth="12" />
                      <path d={path} fill="none" stroke={strokeColor} strokeWidth={strokeW} strokeDasharray={strokeDash}
                        markerEnd={isHovDep ? 'url(#arrowhead-highlight)' : 'url(#arrowhead)'} />
                      <circle cx={x1} cy={y1} r="3" fill={strokeColor} />
                      {isHovDep && (
                        <text x={(x1 + x2) / 2} y={Math.min(y1, y2) - 6} textAnchor="middle"
                          className="text-[10px] font-medium fill-blue-700 pointer-events-none">
                          {GANTT_DEPENDENCY_SHORT_LABELS[dep.dependency_type]}{dep.lag > 0 ? ` +${dep.lag}d` : ''}
                        </text>
                      )}
                    </g>
                  );
                })}
                {/* Drag-to-connect preview line */}
                {connectDrag && (
                  <line x1={connectDrag.startX} y1={connectDrag.startY - 56}
                    x2={connectDrag.currentX} y2={connectDrag.currentY - 56}
                    stroke="#3b82f6" strokeWidth="2" strokeDasharray="6 3" markerEnd="url(#arrowhead-blue)" />
                )}
              </svg>
            </div>
          </div>
        </div>
      )}

      {/* ========== PHASE MODAL ========== */}
      {showPhaseModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowPhaseModal(false)}>
          <div className="bg-white rounded-xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-slate-200 flex justify-between items-center">
              <h2 className="text-lg font-bold text-slate-900">{editingPhase ? editingPhase.title || 'Edytuj fazę' : 'Utwórz nową fazę'}</h2>
              <button onClick={() => setShowPhaseModal(false)} className="p-1.5 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              <div>
                <label className="block text-sm font-bold text-slate-800 mb-1.5">* Nazwa</label>
                <input type="text" value={phaseForm.title} onChange={e => setPhaseForm({ ...phaseForm, title: e.target.value })}
                  placeholder="Podaj nazwę (wymagane)" className="w-full px-3 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-400" />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-800 mb-1.5">Faza nadrzędna</label>
                <select value={phaseForm.parent_id} onChange={e => setPhaseForm({ ...phaseForm, parent_id: e.target.value })}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg">
                  <option value="">Wybierz...</option>
                  {allFlatTasks.filter(t => t.id !== editingPhase?.id && (t.level || 0) < 7).map(t => (
                    <option key={t.id} value={t.id}>{'  '.repeat(t.level || 0)}{t.wbs} {getTaskTitle(t)}</option>
                  ))}
                </select>
                <p className="text-xs text-blue-500 mt-1">Maksymalny limit poziomów to 8</p>
              </div>

              <div className="bg-slate-50 rounded-lg p-4 space-y-4">
                <div>
                  <label className="block text-sm font-bold text-slate-800 mb-1.5">Tryb planowania</label>
                  <select value={phaseForm.planning_mode} onChange={e => setPhaseForm({ ...phaseForm, planning_mode: e.target.value as any })}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg">
                    <option value="auto">Tryb automatyczny</option>
                    <option value="manual">Tryb ręczny</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-bold text-slate-800 mb-1.5">Czas trwania</label>
                  <div className="flex items-center gap-2">
                    <input type="number" value={phaseForm.duration || ''} onChange={e => setPhaseForm({ ...phaseForm, duration: parseInt(e.target.value) || 0 })}
                      placeholder="Podaj czas trwan" min="0"
                      className="w-32 px-3 py-2.5 border border-slate-200 rounded-lg" />
                    <span className="text-sm text-slate-600">Dni</span>
                    {phaseForm.duration > 0 && <span className="text-sm text-slate-400">({formatDuration(phaseForm.duration)})</span>}
                  </div>
                  <p className="text-xs text-blue-500 mt-2 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    W przypadku nieustawienia dat zadanie wyświetli się na diagramie Gantta w formie etykiety tekstowej przy dacie rozpoczęcia fazy nadrzędnej.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-slate-800 mb-1.5">Data rozpoczęcia</label>
                    <div className="text-sm text-slate-700">{phaseForm.start_date ? new Date(phaseForm.start_date).toLocaleDateString('pl-PL') : '–'}</div>
                    <input type="date" value={phaseForm.start_date} onChange={e => setPhaseForm({ ...phaseForm, start_date: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm mt-1" />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-800 mb-1.5">Data zakończenia</label>
                    <div className="text-sm text-slate-700">{phaseForm.end_date ? new Date(phaseForm.end_date).toLocaleDateString('pl-PL') : '–'}</div>
                    <input type="date" value={phaseForm.end_date} onChange={e => setPhaseForm({ ...phaseForm, end_date: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm mt-1" />
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 rounded-lg p-4">
                <label className="block text-sm font-bold text-slate-800 mb-2">Postęp</label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={phaseForm.has_custom_progress} onChange={e => setPhaseForm({ ...phaseForm, has_custom_progress: e.target.checked })}
                    className="w-4 h-4 rounded text-blue-600" />
                  <span className="text-sm text-slate-700">Ustaw ręcznie</span>
                </label>
                {phaseForm.has_custom_progress && (
                  <div className="flex items-center gap-2 mt-2">
                    <input type="range" min="0" max="100" value={phaseForm.progress}
                      onChange={e => setPhaseForm({ ...phaseForm, progress: parseInt(e.target.value) })} className="flex-1" />
                    <span className="text-sm font-medium text-slate-700 w-10 text-right">{phaseForm.progress}%</span>
                  </div>
                )}
              </div>

              {/* Priority */}
              <div className="bg-slate-50 rounded-lg p-4">
                <label className="block text-sm font-bold text-slate-800 mb-2">Priorytet</label>
                <div className="flex gap-2">
                  {([
                    { val: 'low' as const, label: 'Niski', color: 'bg-slate-100 text-slate-600 border-slate-200' },
                    { val: 'normal' as const, label: 'Normalny', color: 'bg-blue-50 text-blue-700 border-blue-200' },
                    { val: 'high' as const, label: 'Wysoki', color: 'bg-amber-50 text-amber-700 border-amber-200' },
                    { val: 'critical' as const, label: 'Krytyczny', color: 'bg-red-50 text-red-700 border-red-200' },
                  ]).map(p => (
                    <button key={p.val} type="button"
                      onClick={() => setPhaseForm({ ...phaseForm, priority: p.val })}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${phaseForm.priority === p.val ? p.color + ' ring-2 ring-offset-1 ring-current' : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'}`}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Roles: Responsible / Supervisor / Approver */}
              <div className="bg-slate-50 rounded-lg p-4 space-y-3">
                <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                  <Users className="w-4 h-4" /> Osoby odpowiedzialne
                </h4>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Odpowiedzialny (wykonawca)</label>
                  <select value={phaseForm.assigned_to_id} onChange={e => setPhaseForm({ ...phaseForm, assigned_to_id: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm">
                    <option value="">Nie przypisano</option>
                    {users.map(u => <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Nadzorujący (starszy)</label>
                  <select value={phaseForm.supervisor_id} onChange={e => setPhaseForm({ ...phaseForm, supervisor_id: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm">
                    <option value="">Nie przypisano</option>
                    {users.map(u => <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Zatwierdzający (odbiór)</label>
                  <select value={phaseForm.approver_id} onChange={e => setPhaseForm({ ...phaseForm, approver_id: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm">
                    <option value="">Nie przypisano</option>
                    {users.map(u => <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>)}
                  </select>
                </div>
              </div>

              {/* Zone assignment */}
              {zones.length > 0 && (
                <div className="bg-slate-50 rounded-lg p-4">
                  <label className="block text-sm font-bold text-slate-800 mb-1.5 flex items-center gap-2">
                    <Map className="w-4 h-4" /> Strefa / Piętro
                  </label>
                  <select value={phaseForm.zone_id} onChange={e => setPhaseForm({ ...phaseForm, zone_id: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm">
                    <option value="">Nie przypisano</option>
                    {zones.map(z => <option key={z.id} value={z.id}>{z.name} ({z.zone_type}{z.floor_number !== undefined ? `, p. ${z.floor_number}` : ''})</option>)}
                  </select>
                </div>
              )}

              {/* Norm-based duration calculator */}
              {norms.length > 0 && (
                <div className="bg-blue-50/50 rounded-lg p-4 space-y-3">
                  <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                    <Wrench className="w-4 h-4" /> Kalkulacja z normy produkcyjnej
                  </h4>
                  <select value={phaseForm.norm_id} onChange={e => setPhaseForm({ ...phaseForm, norm_id: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm">
                    <option value="">Wybierz normę...</option>
                    {norms.map(n => <option key={n.id} value={n.id}>{n.name} ({n.output_per_day_avg} {n.unit}/dzień, brygada {n.crew_size})</option>)}
                  </select>
                  {phaseForm.norm_id && (() => {
                    const selectedNorm = norms.find(n => n.id === phaseForm.norm_id);
                    if (!selectedNorm) return null;
                    return (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <input type="number" placeholder="Ilość" value={phaseForm.quantity || ''} min="0"
                            onChange={e => setPhaseForm({ ...phaseForm, quantity: parseFloat(e.target.value) || 0 })}
                            className="w-24 px-2 py-1.5 border border-slate-200 rounded-lg text-sm" />
                          <span className="text-sm text-slate-500">{selectedNorm.unit}</span>
                          <span className="text-xs text-slate-400">Brygada: {selectedNorm.crew_size} os.</span>
                        </div>
                        {phaseForm.quantity > 0 && (() => {
                          const factors = phaseForm.selectedConditions
                            .map(cfId => conditionFactors.find(c => c.id === cfId)?.factor)
                            .filter((f): f is number => f !== undefined);
                          const calc = calculateDurationFromNorm(selectedNorm, phaseForm.quantity, selectedNorm.crew_size, factors);
                          return (
                            <div className="flex items-center gap-3 flex-wrap">
                              <div className="bg-white rounded px-2 py-1 text-xs border border-slate-200">
                                <span className="text-slate-400">Min:</span> <strong className="text-green-600">{calc.minDays}d</strong>
                              </div>
                              <div className="bg-white rounded px-2 py-1 text-xs border border-blue-200">
                                <span className="text-slate-400">Śr:</span> <strong className="text-blue-600">{calc.avgDays}d</strong>
                              </div>
                              <div className="bg-white rounded px-2 py-1 text-xs border border-slate-200">
                                <span className="text-slate-400">Max:</span> <strong className="text-orange-600">{calc.maxDays}d</strong>
                              </div>
                              <button type="button" onClick={() => setPhaseForm({ ...phaseForm, duration: calc.avgDays })}
                                className="px-2 py-1 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                                Użyj śr. ({calc.avgDays}d)
                              </button>
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Condition factors */}
              {conditionFactors.length > 0 && (
                <div className="bg-slate-50 rounded-lg p-4">
                  <h4 className="text-sm font-bold text-slate-800 mb-2 flex items-center gap-2">
                    <Activity className="w-4 h-4" /> Czynniki warunkowe
                  </h4>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {conditionFactors.map(cf => (
                      <label key={cf.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-white cursor-pointer text-xs">
                        <input type="checkbox"
                          checked={phaseForm.selectedConditions.includes(cf.id)}
                          onChange={e => {
                            const newConds = e.target.checked
                              ? [...phaseForm.selectedConditions, cf.id]
                              : phaseForm.selectedConditions.filter(id => id !== cf.id);
                            setPhaseForm({ ...phaseForm, selectedConditions: newConds });
                          }}
                          className="w-3.5 h-3.5 rounded text-blue-600" />
                        <span className="text-slate-700">{cf.name}</span>
                        <span className="text-slate-400 ml-auto">+{Math.round((cf.factor - 1) * 100)}%</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Notes */}
              <div>
                <label className="block text-sm font-bold text-slate-800 mb-1.5">Notatki</label>
                <textarea value={phaseForm.notes} onChange={e => setPhaseForm({ ...phaseForm, notes: e.target.value })}
                  placeholder="Dodatkowe uwagi..." rows={2}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm resize-none" />
              </div>
            </div>
            <div className="p-5 border-t border-slate-200 flex items-center justify-between">
              {editingPhase ? (
                <button onClick={() => { setShowPhaseModal(false); handleDeletePhase(editingPhase); }}
                  className="p-2 bg-red-100 text-red-600 rounded-lg hover:bg-red-200"><Trash2 className="w-5 h-5" /></button>
              ) : <div />}
              <div className="flex items-center gap-3">
                <button onClick={() => setShowPhaseModal(false)} className="px-4 py-2.5 border border-slate-200 rounded-lg hover:bg-slate-50 text-sm">Anuluj</button>
                <button onClick={handleSavePhase} disabled={!phaseForm.title.trim() || saving}
                  className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium flex items-center gap-2">
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  {editingPhase ? 'Zapisz' : 'Utwórz'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========== DEPENDENCY MODAL ========== */}
      {showDepModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowDepModal(false)}>
          <div className="bg-white rounded-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-slate-200 flex justify-between items-center">
              <h2 className="text-lg font-bold text-slate-900">Zależność</h2>
              <button onClick={() => setShowDepModal(false)} className="p-1.5 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              {depForm.predecessor_id && depForm.successor_id && (
                <div className="text-sm text-slate-700">
                  <div><span className="font-medium">Z:</span> {allFlatTasks.find(t => t.id === depForm.predecessor_id)?.wbs} {getTaskTitle(allFlatTasks.find(t => t.id === depForm.predecessor_id)!)}</div>
                  <div><span className="font-medium">Do:</span> {allFlatTasks.find(t => t.id === depForm.successor_id)?.wbs} {getTaskTitle(allFlatTasks.find(t => t.id === depForm.successor_id)!)}</div>
                </div>
              )}
              {!depForm.predecessor_id && (
                <div>
                  <label className="block text-sm font-bold text-slate-800 mb-1">Z (poprzednik)</label>
                  <select value={depForm.predecessor_id} onChange={e => setDepForm({ ...depForm, predecessor_id: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg">
                    <option value="">Wybierz...</option>
                    {allFlatTasks.map(t => <option key={t.id} value={t.id}>{t.wbs} {getTaskTitle(t)}</option>)}
                  </select>
                </div>
              )}
              {!depForm.successor_id && (
                <div>
                  <label className="block text-sm font-bold text-slate-800 mb-1">Do (następnik)</label>
                  <select value={depForm.successor_id} onChange={e => setDepForm({ ...depForm, successor_id: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg">
                    <option value="">Wybierz...</option>
                    {allFlatTasks.filter(t => t.id !== depForm.predecessor_id).map(t => <option key={t.id} value={t.id}>{t.wbs} {getTaskTitle(t)}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm font-bold text-slate-800 mb-1">Typ</label>
                <select value={depForm.dependency_type} onChange={e => setDepForm({ ...depForm, dependency_type: e.target.value as GanttDependencyType })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg">
                  {DEP_TYPES.map(dt => <option key={dt} value={dt}>{GANTT_DEPENDENCY_LABELS[dt]}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-800 mb-1">Opóźnienie</label>
                <div className="flex items-center gap-2">
                  <input type="number" value={depForm.lag} onChange={e => setDepForm({ ...depForm, lag: parseInt(e.target.value) || 0 })}
                    className="w-24 px-3 py-2 border border-slate-200 rounded-lg" min="0" />
                  <span className="text-sm text-slate-600">Dni</span>
                </div>
              </div>
              {depValidationError && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" /> {depValidationError}
                </div>
              )}
              {depForm.predecessor_id && depForm.successor_id && !depValidationError && depForm.dependency_type === 'FS' && (
                <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  Nie można rozpocząć <strong>{getTaskTitle(allFlatTasks.find(t => t.id === depForm.successor_id)!)}</strong> przed zakończeniem <strong>{getTaskTitle(allFlatTasks.find(t => t.id === depForm.predecessor_id)!)}</strong>.
                </div>
              )}
            </div>
            <div className="p-5 border-t border-slate-200 flex items-center justify-between">
              {editingDep ? <button onClick={handleDeleteDep} className="p-2 bg-red-100 text-red-600 rounded-lg hover:bg-red-200"><Trash2 className="w-5 h-5" /></button> : <div />}
              <div className="flex items-center gap-3">
                <button onClick={() => setShowDepModal(false)} className="px-4 py-2 border border-slate-200 rounded-lg hover:bg-slate-50">Anuluj</button>
                <button onClick={handleSaveDep} disabled={!depForm.predecessor_id || !depForm.successor_id || saving}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium flex items-center gap-2">
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />} Zapisz
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========== WORKING DAYS MODAL ========== */}
      {showWorkingDaysModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowWorkingDaysModal(false)}>
          <div className="bg-white rounded-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-slate-200 flex justify-between items-center">
              <h2 className="text-lg font-bold text-slate-900">Edytuj dni robocze</h2>
              <button onClick={() => setShowWorkingDaysModal(false)} className="p-1.5 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="bg-slate-50 rounded-lg p-4">
                <h3 className="text-sm font-bold text-slate-800 mb-1">Dni robocze tygodnia</h3>
                <p className="text-xs text-slate-500 mb-3">Wybierz dni, w których zazwyczaj prowadzone są prace związane z projektem.</p>
                <div className="space-y-1">
                  {DAY_NAMES_FULL.map((day, i) => (
                    <label key={i} className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer hover:bg-white ${workingDays[i] ? 'bg-blue-50' : ''}`}>
                      <input type="checkbox" checked={workingDays[i]} onChange={() => { const nd = [...workingDays]; nd[i] = !nd[i]; setWorkingDays(nd); }}
                        className="w-4 h-4 rounded text-blue-600" />
                      <span className="text-sm text-slate-700">{day}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="p-5 border-t border-slate-200 flex justify-end gap-3">
              <button onClick={() => setShowWorkingDaysModal(false)} className="px-4 py-2 border border-slate-200 rounded-lg hover:bg-slate-50">Anuluj</button>
              <button onClick={handleSaveWorkingDays} className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">Zapisz</button>
            </div>
          </div>
        </div>
      )}

      {/* ========== CONTEXT MENU ========== */}
      {contextMenu && (
        <ContextMenu
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={() => setContextMenu(null)}
          items={[
            // View
            { label: 'Pokaż na wykresie', icon: <ArrowRight className="w-4 h-4" />, onClick: () => {
              if (chartRef.current && contextMenu.task.start_date) {
                const daysFromStart = getDaysBetween(dateRange.start, new Date(contextMenu.task.start_date));
                chartRef.current.scrollLeft = daysFromStart * dayWidth - 100;
              }
            }},
            { label: 'Edytuj fazę', icon: <Pencil className="w-4 h-4" />, onClick: () => openEditPhase(contextMenu.task) },
            { label: '', onClick: () => {}, divider: true },
            // Create
            { label: 'Utwórz fazę podrzędną', icon: <Plus className="w-4 h-4" />, onClick: () => openCreatePhase(contextMenu.task.id) },
            { label: 'Duplikuj', icon: <Copy className="w-4 h-4" />, onClick: () => handleDuplicateTask(contextMenu.task) },
            { label: 'Duplikuj z podfazami', icon: <Copy className="w-4 h-4" />, onClick: () => handleDuplicateTaskWithChildren(contextMenu.task) },
            { label: 'Kopiuj', icon: <Copy className="w-4 h-4" />, onClick: () => handleCopyTask(contextMenu.task) },
            { label: 'Wklej jako podfazę', icon: <ClipboardPaste className="w-4 h-4" />, onClick: () => handlePasteTask(contextMenu.task.id) },
            { label: '', onClick: () => {}, divider: true },
            // Hierarchy
            { label: 'Wcięcie (uczyń podfazą)', icon: <MoveRight className="w-4 h-4" />, onClick: () => handleIndent(contextMenu.task) },
            { label: 'Cofnij wcięcie', icon: <MoveLeft className="w-4 h-4" />, onClick: () => handleOutdent(contextMenu.task) },
            { label: '', onClick: () => {}, divider: true },
            // Status
            { label: contextMenu.task.is_milestone ? 'Usuń kamień milowy' : 'Oznacz jako kamień milowy', icon: <Diamond className="w-4 h-4" />, onClick: () => handleToggleMilestone(contextMenu.task) },
            { label: 'Oznacz jako ukończone (100%)', icon: <CheckCircle2 className="w-4 h-4" />, onClick: () => handleMarkComplete(contextMenu.task) },
            { label: 'Dodaj zależność', icon: <LinkIcon className="w-4 h-4" />, onClick: () => openCreateDep(contextMenu.task.id) },
            { label: '', onClick: () => {}, divider: true },
            // Priority
            { label: 'Priorytet: Niski', icon: <div className="w-3 h-3 rounded-full bg-slate-400" />, onClick: () => handleSetPriority(contextMenu.task, 'low') },
            { label: 'Priorytet: Normalny', icon: <div className="w-3 h-3 rounded-full bg-blue-500" />, onClick: () => handleSetPriority(contextMenu.task, 'normal') },
            { label: 'Priorytet: Wysoki', icon: <div className="w-3 h-3 rounded-full bg-amber-500" />, onClick: () => handleSetPriority(contextMenu.task, 'high') },
            { label: 'Priorytet: Krytyczny', icon: <div className="w-3 h-3 rounded-full bg-red-500" />, onClick: () => handleSetPriority(contextMenu.task, 'critical') },
            { label: '', onClick: () => {}, divider: true },
            // LPS Status
            { label: 'LPS: Gotowe', icon: <CheckCircle2 className="w-4 h-4 text-green-500" />, onClick: () => handleUpdateLPSStatus(contextMenu.task.id, 'ready') },
            { label: 'LPS: Zablokowane', icon: <Shield className="w-4 h-4 text-red-500" />, onClick: () => handleUpdateLPSStatus(contextMenu.task.id, 'blocked', 'Powód do uzupełnienia') },
            { label: 'LPS: W trakcie', icon: <Activity className="w-4 h-4 text-blue-500" />, onClick: () => handleUpdateLPSStatus(contextMenu.task.id, 'in_progress') },
            { label: 'LPS: Zrobione', icon: <Check className="w-4 h-4 text-emerald-500" />, onClick: () => handleUpdateLPSStatus(contextMenu.task.id, 'done') },
            { label: '', onClick: () => {}, divider: true },
            // Evidence
            { label: 'Dodaj dowód (zdjęcie/protokół)', icon: <Camera className="w-4 h-4" />, onClick: () => { setEvidenceTaskId(contextMenu.task.id); setShowEvidenceModal(true); } },
            // Decomposition
            ...DECOMPOSITION_TEMPLATES.map(tmpl => ({
              label: `Dekompozycja: ${tmpl.name}`,
              icon: <Layers className="w-4 h-4" />,
              onClick: async () => {
                if (!selectedProject || !currentUser) return;
                try {
                  const parentId = contextMenu.task.id;
                  const startDate = contextMenu.task.start_date || new Date().toISOString().split('T')[0];
                  let prevId: string | null = null;
                  for (let i = 0; i < tmpl.tasks.length; i++) {
                    const t = tmpl.tasks[i];
                    const { data: ins } = await supabase.from('gantt_tasks').insert({
                      project_id: selectedProject.id, title: t.title, parent_id: parentId,
                      start_date: startDate, duration: 3, progress: 0, is_milestone: false,
                      is_auto: true, sort_order: i, source: 'template', color: contextMenu.task.color || '#93c5fd'
                    }).select('id').single();
                    if (ins && prevId) {
                      await supabase.from('gantt_dependencies').insert({
                        project_id: selectedProject.id, predecessor_id: prevId, successor_id: ins.id,
                        dependency_type: t.depType, lag: t.lag
                      });
                    }
                    if (ins) prevId = ins.id;
                  }
                  showSuccess(`Dekompozycja "${tmpl.name}" — ${tmpl.tasks.length} podzadań utworzonych.`);
                  await loadGanttDataKeepScroll();
                } catch (err: any) { showError('Błąd dekompozycji: ' + (err?.message || err)); }
              }
            })),
            { label: '', onClick: () => {}, divider: true },
            // Delete
            { label: 'Usuń fazę (Del)', icon: <Trash2 className="w-4 h-4" />, onClick: () => handleDeletePhase(contextMenu.task), danger: true },
          ]}
        />
      )}
      {/* ========== BASELINE MODAL ========== */}
      {showBaselineModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowBaselineModal(false)}>
          <div className="bg-white rounded-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-slate-200 flex justify-between items-center">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2"><Bookmark className="w-5 h-5 text-purple-500" /> Baseline</h2>
              <button onClick={() => setShowBaselineModal(false)} className="p-1.5 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-800 mb-1.5">Nazwa baseline</label>
                <input type="text" value={baselineName} onChange={e => setBaselineName(e.target.value)}
                  placeholder="np. Plan v1.0" className="w-full px-3 py-2 border border-slate-200 rounded-lg" />
              </div>
              <button onClick={() => { handleSaveBaseline(); setShowBaselineModal(false); }}
                disabled={!baselineName.trim() || saving}
                className="w-full px-4 py-2.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 font-medium flex items-center justify-center gap-2">
                <Save className="w-4 h-4" /> Zapisz obecny plan jako baseline
              </button>
              {baselines.length > 0 && (
                <div>
                  <h4 className="text-sm font-bold text-slate-700 mb-2">Zapisane baseline ({baselines.length})</h4>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {baselines.map(bl => (
                      <div key={bl.id} className={`flex items-center justify-between p-2.5 rounded-lg border transition-all cursor-pointer ${activeBaseline?.id === bl.id ? 'border-purple-400 bg-purple-50' : 'border-slate-200 hover:border-purple-200 hover:bg-purple-50/30'}`}
                        onClick={() => { setActiveBaseline(activeBaseline?.id === bl.id ? null : bl); }}>
                        <div>
                          <div className="text-sm font-medium text-slate-800">{bl.name}</div>
                          <div className="text-[10px] text-slate-400">{new Date(bl.created_at).toLocaleString('pl-PL')} — {bl.tasks_snapshot?.length || 0} zadań</div>
                        </div>
                        {activeBaseline?.id === bl.id && <BookmarkCheck className="w-4 h-4 text-purple-600" />}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========== ZONE MANAGEMENT MODAL ========== */}
      {showAdvancedPanel === 'zones' && (
        <div className="fixed bottom-4 left-4 z-[100] bg-white rounded-xl shadow-2xl border border-slate-200 w-80 max-h-[60vh] overflow-hidden flex flex-col">
          <div className="p-3 border-b border-slate-200 flex justify-between items-center">
            <h3 className="font-bold text-slate-800 flex items-center gap-2 text-sm"><Map className="w-4 h-4 text-blue-500" /> Strefy / Piętra</h3>
            <button onClick={() => setShowAdvancedPanel(null)} className="p-1 hover:bg-slate-100 rounded"><X className="w-4 h-4 text-slate-400" /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {zones.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4">Brak stref. Dodaj pierwszą poniżej.</p>
            ) : zones.map(z => (
              <div key={z.id} className="flex items-center gap-2 p-2 rounded-lg border border-slate-100 hover:border-blue-200">
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: z.color }} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-700 truncate">{z.name}</div>
                  <div className="text-[10px] text-slate-400">{z.zone_type}{z.floor_number !== undefined ? ` — piętro ${z.floor_number}` : ''}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="p-3 border-t border-slate-200 space-y-2">
            <div className="flex gap-1.5">
              <input type="text" placeholder="Nazwa strefy..." value={zoneForm.name} onChange={e => setZoneForm({...zoneForm, name: e.target.value})}
                className="flex-1 px-2 py-1.5 text-xs border border-slate-200 rounded-lg" />
              <select value={zoneForm.zone_type} onChange={e => setZoneForm({...zoneForm, zone_type: e.target.value})}
                className="px-1.5 py-1.5 text-xs border border-slate-200 rounded-lg">
                <option value="floor">Piętro</option>
                <option value="sector">Sektor</option>
                <option value="building">Budynek</option>
                <option value="area">Obszar</option>
                <option value="room">Pomieszczenie</option>
              </select>
            </div>
            <div className="flex gap-1.5">
              <input type="number" placeholder="Nr piętra" value={zoneForm.floor_number || ''} onChange={e => setZoneForm({...zoneForm, floor_number: parseInt(e.target.value) || 0})}
                className="w-20 px-2 py-1.5 text-xs border border-slate-200 rounded-lg" />
              <input type="color" value={zoneForm.color} onChange={e => setZoneForm({...zoneForm, color: e.target.value})}
                className="w-8 h-7 rounded border border-slate-200 cursor-pointer" />
              <button onClick={() => handleSaveZone()}
                disabled={!zoneForm.name.trim()}
                className="flex-1 px-2 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium">
                <Plus className="w-3 h-3 inline mr-1" />Dodaj
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== MATERIALS PANEL ========== */}
      {showAdvancedPanel === 'materials' && (
        <div className="fixed bottom-4 left-4 z-[100] bg-white rounded-xl shadow-2xl border border-slate-200 w-96 max-h-[60vh] overflow-hidden flex flex-col">
          <div className="p-3 border-b border-slate-200 flex justify-between items-center">
            <h3 className="font-bold text-slate-800 flex items-center gap-2 text-sm"><Package className="w-4 h-4 text-orange-500" /> Materiały ({materials.length})</h3>
            <div className="flex items-center gap-1">
              <button onClick={() => setShowAddMaterial(!showAddMaterial)} className="p-1 hover:bg-orange-100 rounded text-orange-600" title="Dodaj materiał"><Plus className="w-4 h-4" /></button>
              <button onClick={() => setShowAdvancedPanel(null)} className="p-1 hover:bg-slate-100 rounded"><X className="w-4 h-4 text-slate-400" /></button>
            </div>
          </div>
          {showAddMaterial && (
            <div className="p-3 border-b border-slate-100 space-y-2 bg-orange-50/50">
              <select value={materialForm.gantt_task_id} onChange={e => setMaterialForm({...materialForm, gantt_task_id: e.target.value})}
                className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-lg">
                <option value="">Przypisz do zadania...</option>
                {allFlatTasks.map(t => <option key={t.id} value={t.id}>{t.wbs} {getTaskTitle(t)}</option>)}
              </select>
              <div className="flex gap-1.5">
                <input type="text" placeholder="Nazwa materiału" value={materialForm.name} onChange={e => setMaterialForm({...materialForm, name: e.target.value})}
                  className="flex-1 px-2 py-1.5 text-xs border border-slate-200 rounded-lg" />
              </div>
              <div className="flex gap-1.5">
                <input type="number" placeholder="Ilość" value={materialForm.quantity || ''} onChange={e => setMaterialForm({...materialForm, quantity: parseFloat(e.target.value) || 0})}
                  className="w-16 px-2 py-1.5 text-xs border border-slate-200 rounded-lg" />
                <input type="text" placeholder="Jedn." value={materialForm.unit} onChange={e => setMaterialForm({...materialForm, unit: e.target.value})}
                  className="w-14 px-2 py-1.5 text-xs border border-slate-200 rounded-lg" />
                <input type="number" placeholder="Cena/jedn." value={materialForm.unit_price || ''} onChange={e => setMaterialForm({...materialForm, unit_price: parseFloat(e.target.value) || 0})}
                  className="w-20 px-2 py-1.5 text-xs border border-slate-200 rounded-lg" />
                <input type="text" placeholder="Dostawca" value={materialForm.supplier} onChange={e => setMaterialForm({...materialForm, supplier: e.target.value})}
                  className="flex-1 px-2 py-1.5 text-xs border border-slate-200 rounded-lg" />
              </div>
              <div className="flex gap-1.5 items-center">
                <input type="date" value={materialForm.delivery_date} onChange={e => setMaterialForm({...materialForm, delivery_date: e.target.value})}
                  className="flex-1 px-2 py-1.5 text-xs border border-slate-200 rounded-lg" />
                <button onClick={async () => {
                  if (!materialForm.gantt_task_id || !materialForm.name) { showError('Podaj zadanie i nazwę materiału.'); return; }
                  try {
                    await supabase.from('gantt_materials').insert({
                      gantt_task_id: materialForm.gantt_task_id, name: materialForm.name,
                      quantity: materialForm.quantity, unit: materialForm.unit, unit_price: materialForm.unit_price || 0,
                      supplier: materialForm.supplier || null, delivery_date: materialForm.delivery_date || null, delivered: false
                    });
                    showSuccess('Materiał dodany.');
                    setMaterialForm({ gantt_task_id: '', name: '', quantity: 0, unit: 'szt', unit_price: 0, supplier: '', delivery_date: '' });
                    setShowAddMaterial(false);
                    loadAdvancedData();
                  } catch (err: any) { showError('Błąd: ' + (err?.message || err)); }
                }}
                  disabled={!materialForm.gantt_task_id || !materialForm.name}
                  className="px-3 py-1.5 bg-orange-600 text-white text-xs rounded-lg hover:bg-orange-700 disabled:opacity-50 font-medium">
                  Dodaj
                </button>
              </div>
            </div>
          )}
          <div className="flex-1 overflow-y-auto p-3">
            {materials.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-6">Brak materiałów. Kliknij + aby dodać.</p>
            ) : (
              <div className="space-y-1.5">
                {materials.map(m => {
                  const isLate = m.delivery_date && !m.delivered && new Date(m.delivery_date) < new Date();
                  return (
                    <div key={m.id} className={`p-2 rounded-lg border text-xs ${isLate ? 'border-red-200 bg-red-50' : m.delivered ? 'border-green-200 bg-green-50' : 'border-slate-100'}`}>
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-slate-700">{m.name}</span>
                        <div className="flex items-center gap-1">
                          <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-medium ${m.delivered ? 'bg-green-200 text-green-700' : isLate ? 'bg-red-200 text-red-700' : 'bg-slate-200 text-slate-600'}`}>
                            {m.delivered ? 'Dostarczony' : isLate ? 'Spóźniony!' : 'Oczekuje'}
                          </span>
                          {!m.delivered && (
                            <button onClick={async () => {
                              await supabase.from('gantt_materials').update({ delivered: true }).eq('id', m.id);
                              loadAdvancedData();
                            }} className="p-0.5 hover:bg-green-100 rounded text-green-600" title="Oznacz jako dostarczony"><Check className="w-3 h-3" /></button>
                          )}
                        </div>
                      </div>
                      <div className="text-slate-400 mt-0.5">
                        {m.quantity} {m.unit}{m.unit_price > 0 ? ` × ${m.unit_price.toLocaleString('pl-PL')} PLN` : ''} {m.supplier ? `• ${m.supplier}` : ''} {m.delivery_date ? `• Dostawa: ${new Date(m.delivery_date).toLocaleDateString('pl-PL')}` : ''}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========== WORK ORDERS PANEL ========== */}
      {showAdvancedPanel === 'workorders' && (
        <div className="fixed bottom-4 left-4 z-[100] bg-white rounded-xl shadow-2xl border border-slate-200 w-96 max-h-[60vh] overflow-hidden flex flex-col">
          <div className="p-3 border-b border-slate-200 flex justify-between items-center">
            <h3 className="font-bold text-slate-800 flex items-center gap-2 text-sm"><Wrench className="w-4 h-4 text-teal-500" /> Narydy pracy ({workOrders.length})</h3>
            <div className="flex items-center gap-1">
              <button onClick={() => handleGenerateWorkOrders()}
                className="p-1 hover:bg-teal-100 rounded text-teal-600" title="Generuj naryk na ten tydzień"><Plus className="w-4 h-4" /></button>
              <button onClick={() => setShowAdvancedPanel(null)} className="p-1 hover:bg-slate-100 rounded"><X className="w-4 h-4 text-slate-400" /></button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {workOrders.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-6">Brak narydów. Kliknij + aby wygenerować naryk na bieżący tydzień.</p>
            ) : (
              <div className="space-y-2">
                {workOrders.map(wo => {
                  const statusColors: Record<string, string> = { draft: 'bg-slate-200 text-slate-600', issued: 'bg-blue-200 text-blue-700', in_progress: 'bg-amber-200 text-amber-700', completed: 'bg-green-200 text-green-700', cancelled: 'bg-red-200 text-red-700' };
                  const statusLabels: Record<string, string> = { draft: 'Szkic', issued: 'Wydany', in_progress: 'W trakcie', completed: 'Zakończony', cancelled: 'Anulowany' };
                  return (
                    <div key={wo.id} className="p-2.5 rounded-lg border border-slate-100 hover:border-teal-200">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold text-slate-700">{wo.order_number}</span>
                        <span className={`px-1.5 py-0 text-[9px] font-medium rounded-full ${statusColors[wo.status] || ''}`}>{statusLabels[wo.status] || wo.status}</span>
                      </div>
                      <div className="text-[10px] text-slate-400">Data: {new Date(wo.order_date).toLocaleDateString('pl-PL')}</div>
                      {wo.items && wo.items.length > 0 && (
                        <div className="mt-1 text-[10px] text-slate-500">{wo.items.length} zadań przypisanych</div>
                      )}
                      {wo.notes && <div className="mt-1 text-[10px] text-slate-400 line-clamp-2">{wo.notes}</div>}
                      <div className="flex items-center gap-1 mt-1.5">
                        {wo.status === 'draft' && (
                          <button onClick={async () => {
                            await supabase.from('gantt_work_orders').update({ status: 'issued' }).eq('id', wo.id);
                            loadAdvancedData(); showSuccess('Naryk wydany.');
                          }} className="px-1.5 py-0.5 text-[9px] bg-blue-100 text-blue-700 rounded hover:bg-blue-200 font-medium">Wydaj</button>
                        )}
                        {wo.status === 'issued' && (
                          <button onClick={async () => {
                            await supabase.from('gantt_work_orders').update({ status: 'in_progress' }).eq('id', wo.id);
                            loadAdvancedData(); showSuccess('Naryk w trakcie realizacji.');
                          }} className="px-1.5 py-0.5 text-[9px] bg-amber-100 text-amber-700 rounded hover:bg-amber-200 font-medium">Rozpocznij</button>
                        )}
                        {wo.status === 'in_progress' && (
                          <button onClick={async () => {
                            await supabase.from('gantt_work_orders').update({ status: 'completed' }).eq('id', wo.id);
                            loadAdvancedData(); showSuccess('Naryk zakończony.');
                          }} className="px-1.5 py-0.5 text-[9px] bg-green-100 text-green-700 rounded hover:bg-green-200 font-medium">Zakończ</button>
                        )}
                        {wo.status !== 'cancelled' && wo.status !== 'completed' && (
                          <button onClick={async () => {
                            if (!confirm('Anulować naryk?')) return;
                            await supabase.from('gantt_work_orders').update({ status: 'cancelled' }).eq('id', wo.id);
                            loadAdvancedData();
                          }} className="px-1.5 py-0.5 text-[9px] text-red-500 hover:bg-red-50 rounded">Anuluj</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========== ACCEPTED ACTS PANEL ========== */}
      {showAdvancedPanel === 'acts' && (
        <div className="fixed bottom-4 left-4 z-[100] bg-white rounded-xl shadow-2xl border border-slate-200 w-96 max-h-[60vh] overflow-hidden flex flex-col">
          <div className="p-3 border-b border-slate-200 flex justify-between items-center">
            <h3 className="font-bold text-slate-800 flex items-center gap-2 text-sm"><BookmarkCheck className="w-4 h-4 text-violet-500" /> Akty odbioru ({acceptedActs.length})</h3>
            <div className="flex items-center gap-1">
              <button onClick={() => setShowActForm(!showActForm)} className="p-1 hover:bg-violet-100 rounded" title="Nowy akt"><Plus className="w-4 h-4 text-violet-500" /></button>
              <button onClick={() => setShowAdvancedPanel(null)} className="p-1 hover:bg-slate-100 rounded"><X className="w-4 h-4 text-slate-400" /></button>
            </div>
          </div>
          {showActForm && (
            <div className="p-3 border-b border-slate-100 bg-violet-50/50 space-y-2">
              <input value={actForm.description} onChange={e => setActForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Opis aktu odbioru" className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-lg" />
              <div className="flex gap-2">
                <input type="number" value={actForm.total_amount || ''} onChange={e => setActForm(f => ({ ...f, total_amount: Number(e.target.value) }))}
                  placeholder="Kwota PLN" className="flex-1 px-2 py-1.5 text-xs border border-slate-200 rounded-lg" />
                {zones.length > 0 && (
                  <select value={actForm.zone_id} onChange={e => setActForm(f => ({ ...f, zone_id: e.target.value }))}
                    className="flex-1 px-2 py-1.5 text-xs border border-slate-200 rounded-lg">
                    <option value="">— Strefa —</option>
                    {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
                  </select>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={handleCreateAct} disabled={!actForm.description.trim()}
                  className="flex-1 px-3 py-1.5 bg-violet-600 text-white text-xs rounded-lg hover:bg-violet-700 disabled:opacity-50">
                  <Plus className="w-3 h-3 inline mr-1" />Utwórz akt
                </button>
                <button onClick={() => setShowActForm(false)} className="px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 rounded-lg">Anuluj</button>
              </div>
            </div>
          )}
          <div className="flex-1 overflow-y-auto p-3">
            {acceptedActs.length === 0 && !showActForm ? (
              <div className="text-center py-6">
                <p className="text-xs text-slate-400 mb-2">Brak aktów odbioru.</p>
                <button onClick={() => setShowActForm(true)} className="px-3 py-1.5 bg-violet-600 text-white text-xs rounded-lg hover:bg-violet-700">
                  <Plus className="w-3 h-3 inline mr-1" />Utwórz pierwszy akt
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {acceptedActs.map(act => (
                  <div key={act.id} className="p-2.5 rounded-lg border border-slate-100 hover:border-violet-200">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-slate-700">{act.act_number}</span>
                      <div className="flex items-center gap-1">
                        <span className={`px-1.5 py-0 text-[9px] font-medium rounded-full ${act.status === 'accepted' ? 'bg-green-200 text-green-700' : act.status === 'rejected' ? 'bg-red-200 text-red-700' : act.status === 'draft' ? 'bg-slate-200 text-slate-600' : 'bg-amber-200 text-amber-700'}`}>
                          {act.status === 'accepted' ? 'Przyjęty' : act.status === 'rejected' ? 'Odrzucony' : act.status === 'draft' ? 'Szkic' : 'Złożony'}
                        </span>
                        {act.status === 'draft' && (
                          <>
                            <button onClick={async () => {
                              await supabase.from('gantt_accepted_acts').update({ status: 'submitted' }).eq('id', act.id);
                              loadAdvancedData();
                              showSuccess('Akt złożony do akceptacji.');
                            }} className="p-0.5 hover:bg-violet-100 rounded" title="Złóż do akceptacji">
                              <ArrowRight className="w-3 h-3 text-violet-500" />
                            </button>
                            <button onClick={async () => {
                              if (!confirm('Usunąć szkic aktu?')) return;
                              await supabase.from('gantt_accepted_acts').delete().eq('id', act.id);
                              loadAdvancedData();
                            }} className="p-0.5 hover:bg-red-100 rounded" title="Usuń szkic">
                              <X className="w-3 h-3 text-red-400" />
                            </button>
                          </>
                        )}
                        {act.status === 'submitted' && (
                          <>
                            <button onClick={async () => {
                              await supabase.from('gantt_accepted_acts').update({ status: 'accepted', accepted_by: user?.id, accepted_at: new Date().toISOString() }).eq('id', act.id);
                              loadAdvancedData();
                              showSuccess('Akt przyjęty.');
                            }} className="px-1.5 py-0.5 text-[9px] bg-green-100 text-green-700 rounded hover:bg-green-200 font-medium">Przyjmij</button>
                            <button onClick={async () => {
                              const reason = prompt('Powód odrzucenia:');
                              if (!reason) return;
                              await supabase.from('gantt_accepted_acts').update({ status: 'rejected', notes: reason }).eq('id', act.id);
                              loadAdvancedData();
                              showSuccess('Akt odrzucony.');
                            }} className="px-1.5 py-0.5 text-[9px] bg-red-100 text-red-700 rounded hover:bg-red-200 font-medium">Odrzuć</button>
                          </>
                        )}
                        {act.status === 'rejected' && (
                          <button onClick={async () => {
                            await supabase.from('gantt_accepted_acts').update({ status: 'draft', notes: null }).eq('id', act.id);
                            loadAdvancedData();
                            showSuccess('Akt przywrócony do szkicu.');
                          }} className="px-1.5 py-0.5 text-[9px] bg-slate-100 text-slate-600 rounded hover:bg-slate-200 font-medium">Do szkicu</button>
                        )}
                      </div>
                    </div>
                    {act.description && <div className="text-[10px] text-slate-500 mb-0.5">{act.description}</div>}
                    <div className="text-[10px] text-slate-400">Data: {new Date(act.act_date).toLocaleDateString('pl-PL')}</div>
                    {act.total_amount > 0 && <div className="text-[10px] text-slate-600 font-medium mt-0.5">{act.total_amount.toLocaleString('pl-PL')} PLN</div>}
                    {act.status === 'rejected' && act.notes && <div className="text-[10px] text-red-500 mt-1 bg-red-50 rounded p-1">Powód: {act.notes}</div>}
                    {act.status === 'accepted' && act.accepted_at && <div className="text-[10px] text-green-600 mt-1">Przyjęto: {new Date(act.accepted_at).toLocaleDateString('pl-PL')}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========== RFI PANEL ========== */}
      {showAdvancedPanel === 'rfis' && (
        <div className="fixed bottom-4 left-4 z-[100] bg-white rounded-xl shadow-2xl border border-slate-200 w-96 max-h-[60vh] overflow-hidden flex flex-col">
          <div className="p-3 border-b border-slate-200 flex justify-between items-center">
            <h3 className="font-bold text-slate-800 flex items-center gap-2 text-sm"><FileQuestion className="w-4 h-4 text-indigo-500" /> RFI ({rfis.length})</h3>
            <div className="flex items-center gap-1">
              <button onClick={() => { setRfiForm({ subject: '', question: '', assigned_to_id: '', due_date: '', priority: 'normal', gantt_task_id: '' }); setShowRFIModal(true); }}
                className="p-1 hover:bg-indigo-100 rounded text-indigo-600" title="Nowe RFI"><Plus className="w-4 h-4" /></button>
              <button onClick={() => setShowAdvancedPanel(null)} className="p-1 hover:bg-slate-100 rounded"><X className="w-4 h-4 text-slate-400" /></button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {rfis.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-6">Brak zapytań RFI.</p>
            ) : (
              <div className="space-y-1.5">
                {rfis.map(rfi => {
                  const priorityColors: Record<string, string> = { low: 'bg-slate-100 text-slate-600', normal: 'bg-blue-100 text-blue-700', high: 'bg-amber-100 text-amber-700', critical: 'bg-red-100 text-red-700' };
                  const statusColors: Record<string, string> = { open: 'bg-red-100 text-red-700', pending: 'bg-amber-100 text-amber-700', answered: 'bg-green-100 text-green-700', closed: 'bg-slate-100 text-slate-600' };
                  return (
                    <div key={rfi.id} className="p-2.5 rounded-lg border border-slate-100 hover:border-indigo-200">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold text-slate-700">{rfi.rfi_number}</span>
                        <div className="flex items-center gap-1">
                          <span className={`px-1.5 py-0 text-[9px] font-medium rounded-full ${priorityColors[rfi.priority]}`}>{rfi.priority}</span>
                          <span className={`px-1.5 py-0 text-[9px] font-medium rounded-full ${statusColors[rfi.status]}`}>{rfi.status}</span>
                        </div>
                      </div>
                      <div className="text-xs font-medium text-slate-700">{rfi.subject}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5 line-clamp-2">{rfi.question}</div>
                      {(rfi as any).answer && <div className="text-[10px] text-green-700 mt-1 bg-green-50 p-1.5 rounded"><strong>Odpowiedź:</strong> {(rfi as any).answer}</div>}
                      {rfi.due_date && <div className="text-[10px] text-slate-400 mt-1">Termin: {new Date(rfi.due_date).toLocaleDateString('pl-PL')}</div>}
                      {rfi.impact_days && <div className="text-[10px] text-red-500 mt-0.5">Wpływ: +{rfi.impact_days} dni opóźnienia</div>}
                      <div className="flex items-center gap-1 mt-1.5">
                        {rfi.status === 'open' && (
                          <>
                            <button onClick={async () => {
                              const answer = prompt('Odpowiedź na RFI:');
                              if (!answer?.trim()) return;
                              await supabase.from('gantt_rfis').update({ status: 'answered', answer: answer.trim(), answered_at: new Date().toISOString(), answered_by_id: currentUser?.id }).eq('id', rfi.id);
                              loadAdvancedData(); showSuccess('RFI odpowiedzone.');
                            }} className="px-1.5 py-0.5 text-[9px] bg-green-100 text-green-700 rounded hover:bg-green-200 font-medium">Odpowiedz</button>
                            <button onClick={async () => {
                              await supabase.from('gantt_rfis').update({ status: 'pending' }).eq('id', rfi.id);
                              loadAdvancedData();
                            }} className="px-1.5 py-0.5 text-[9px] text-amber-600 hover:bg-amber-50 rounded">Oczekujące</button>
                          </>
                        )}
                        {rfi.status === 'pending' && (
                          <button onClick={async () => {
                            const answer = prompt('Odpowiedź na RFI:');
                            if (!answer?.trim()) return;
                            await supabase.from('gantt_rfis').update({ status: 'answered', answer: answer.trim(), answered_at: new Date().toISOString(), answered_by_id: currentUser?.id }).eq('id', rfi.id);
                            loadAdvancedData(); showSuccess('RFI odpowiedzone.');
                          }} className="px-1.5 py-0.5 text-[9px] bg-green-100 text-green-700 rounded hover:bg-green-200 font-medium">Odpowiedz</button>
                        )}
                        {rfi.status === 'answered' && (
                          <button onClick={async () => {
                            await supabase.from('gantt_rfis').update({ status: 'closed' }).eq('id', rfi.id);
                            loadAdvancedData(); showSuccess('RFI zamknięte.');
                          }} className="px-1.5 py-0.5 text-[9px] bg-slate-100 text-slate-700 rounded hover:bg-slate-200 font-medium">Zamknij</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========== RFI CREATE MODAL ========== */}
      {showRFIModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4" onClick={() => setShowRFIModal(false)}>
          <div className="bg-white rounded-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-slate-200 flex justify-between items-center">
              <h2 className="text-lg font-bold text-slate-900">Nowe RFI</h2>
              <button onClick={() => setShowRFIModal(false)} className="p-1.5 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-800 mb-1">Temat *</label>
                <input type="text" value={rfiForm.subject} onChange={e => setRfiForm({...rfiForm, subject: e.target.value})}
                  placeholder="Krótki opis problemu" className="w-full px-3 py-2 border border-slate-200 rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-800 mb-1">Pytanie *</label>
                <textarea value={rfiForm.question} onChange={e => setRfiForm({...rfiForm, question: e.target.value})}
                  placeholder="Szczegółowe pytanie..." rows={3} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm resize-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Termin odpowiedzi</label>
                  <input type="date" value={rfiForm.due_date} onChange={e => setRfiForm({...rfiForm, due_date: e.target.value})}
                    className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Priorytet</label>
                  <select value={rfiForm.priority} onChange={e => setRfiForm({...rfiForm, priority: e.target.value})}
                    className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm">
                    <option value="low">Niski</option>
                    <option value="normal">Normalny</option>
                    <option value="high">Wysoki</option>
                    <option value="critical">Krytyczny</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Powiązane zadanie</label>
                <select value={rfiForm.gantt_task_id} onChange={e => setRfiForm({...rfiForm, gantt_task_id: e.target.value})}
                  className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm">
                  <option value="">Brak</option>
                  {allFlatTasks.map(t => <option key={t.id} value={t.id}>{t.wbs} {getTaskTitle(t)}</option>)}
                </select>
              </div>
            </div>
            <div className="p-5 border-t border-slate-200 flex justify-end gap-3">
              <button onClick={() => setShowRFIModal(false)} className="px-4 py-2 border border-slate-200 rounded-lg hover:bg-slate-50 text-sm">Anuluj</button>
              <button onClick={() => { handleCreateRFI(); setShowRFIModal(false); }}
                disabled={!rfiForm.subject.trim() || !rfiForm.question.trim()}
                className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm font-medium">
                Utwórz RFI
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== EVIDENCE UPLOAD MODAL ========== */}
      {showEvidenceModal && evidenceTaskId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4" onClick={() => { setShowEvidenceModal(false); setEvidenceTaskId(null); }}>
          <div className="bg-white rounded-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-slate-200 flex justify-between items-center">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2"><Camera className="w-5 h-5 text-blue-500" /> Dowody realizacji</h2>
              <button onClick={() => { setShowEvidenceModal(false); setEvidenceTaskId(null); }} className="p-1.5 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="text-sm text-slate-600">
                Zadanie: <strong>{getTaskTitle(allFlatTasks.find(t => t.id === evidenceTaskId) as GanttTaskWithChildren)}</strong>
              </div>
              {taskEvidence.length > 0 && (
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {taskEvidence.map(ev => (
                    <div key={ev.id} className="flex items-center gap-2 p-2 rounded-lg border border-slate-100 text-xs">
                      <Camera className="w-4 h-4 text-slate-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-slate-700">{ev.evidence_type} — {ev.description || 'Bez opisu'}</div>
                        {ev.file_url && <a href={ev.file_url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline truncate block">{ev.file_url}</a>}
                        <div className="text-slate-400">{new Date(ev.created_at).toLocaleString('pl-PL')}</div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {ev.verified ? <Check className="w-4 h-4 text-green-500" title="Zweryfikowano" /> : (
                          <button onClick={async () => {
                            await supabase.from('gantt_evidence').update({ verified: true }).eq('id', ev.id);
                            const { data: evData } = await supabase.from('gantt_evidence').select('*').eq('gantt_task_id', evidenceTaskId!).order('created_at', { ascending: false });
                            if (evData) setTaskEvidence(evData as any);
                            showSuccess('Dowód zweryfikowany.');
                          }} className="p-0.5 hover:bg-green-100 rounded text-green-600" title="Zweryfikuj"><CheckCircle2 className="w-3.5 h-3.5" /></button>
                        )}
                        <button onClick={async () => {
                          if (!confirm('Usunąć ten dowód?')) return;
                          await supabase.from('gantt_evidence').delete().eq('id', ev.id);
                          const { data: evData } = await supabase.from('gantt_evidence').select('*').eq('gantt_task_id', evidenceTaskId!).order('created_at', { ascending: false });
                          if (evData) setTaskEvidence(evData as any);
                        }} className="p-0.5 hover:bg-red-100 rounded text-red-400" title="Usuń"><Trash2 className="w-3 h-3" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="bg-slate-50 rounded-lg p-4 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Typ dowodu</label>
                  <select value={evidenceForm.evidence_type} onChange={e => setEvidenceForm({...evidenceForm, evidence_type: e.target.value})}
                    className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-lg">
                    <option value="photo">Zdjęcie</option>
                    <option value="protocol">Protokół</option>
                    <option value="signature">Podpis</option>
                    <option value="report">Raport</option>
                    <option value="other">Inny</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Opis *</label>
                  <input type="text" value={evidenceForm.description} onChange={e => setEvidenceForm({...evidenceForm, description: e.target.value})}
                    placeholder="np. Zdjęcie stanu po malowaniu ścian" className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-lg" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Link do pliku (Google Drive, Dropbox, itp.)</label>
                  <input type="url" value={evidenceForm.file_url} onChange={e => setEvidenceForm({...evidenceForm, file_url: e.target.value})}
                    placeholder="https://drive.google.com/..." className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-lg" />
                </div>
                <button onClick={async () => {
                  if (!evidenceForm.description.trim()) { showError('Podaj opis dowodu.'); return; }
                  try {
                    const { error: evErr } = await supabase.from('gantt_evidence').insert({
                      gantt_task_id: evidenceTaskId,
                      evidence_type: evidenceForm.evidence_type,
                      description: evidenceForm.description.trim(),
                      file_url: evidenceForm.file_url.trim() || null,
                      uploaded_by_id: currentUser?.id
                    });
                    if (evErr) throw evErr;
                    showSuccess('Dowód dodany.');
                    setEvidenceForm({ evidence_type: 'photo', description: '', file_url: '' });
                    const { data: evData } = await supabase.from('gantt_evidence').select('*').eq('gantt_task_id', evidenceTaskId!).order('created_at', { ascending: false });
                    if (evData) setTaskEvidence(evData as any);
                  } catch (err: any) { showError('Błąd: ' + (err?.message || err)); }
                }}
                  disabled={!evidenceForm.description.trim()}
                  className="w-full px-4 py-2 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium flex items-center justify-center gap-1.5">
                  <Plus className="w-3.5 h-3.5" /> Dodaj dowód
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========== PREDICTIVE INSIGHTS PANEL ========== */}
      {showInsights && insights.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[100] bg-white rounded-xl shadow-2xl border border-slate-200 w-96 max-h-[60vh] overflow-hidden flex flex-col">
          <div className="p-3 border-b border-slate-200 flex justify-between items-center">
            <h3 className="font-bold text-slate-800 flex items-center gap-2 text-sm"><TrendingUp className="w-4 h-4 text-emerald-500" /> Analityka ({insights.length})</h3>
            <button onClick={() => setShowInsights(false)} className="p-1 hover:bg-slate-100 rounded"><X className="w-4 h-4 text-slate-400" /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
            {insights.map((ins, i) => {
              const severityColors: Record<string, string> = { low: 'border-l-slate-300 bg-slate-50', medium: 'border-l-amber-400 bg-amber-50', high: 'border-l-red-400 bg-red-50' };
              return (
                <div key={i} className={`p-2.5 rounded-lg border-l-4 ${severityColors[ins.severity] || 'border-l-slate-300 bg-slate-50'}`}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-bold text-slate-700">{ins.type.replace('_', ' ').toUpperCase()}</span>
                    <span className={`px-1.5 py-0 text-[9px] font-medium rounded-full ${ins.severity === 'high' ? 'bg-red-200 text-red-700' : ins.severity === 'medium' ? 'bg-amber-200 text-amber-700' : 'bg-slate-200 text-slate-600'}`}>
                      {ins.severity}
                    </span>
                  </div>
                  <div className="text-xs text-slate-700">{ins.message}</div>
                  {ins.recommendation && <div className="text-[10px] text-blue-600 mt-1">{ins.recommendation}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ========== EVM / STATISTICS PANEL (shows with insights) ========== */}
      {showInsights && (() => {
        // Compute simplified EVM: totalBudget = total planned days, planned% from baseline or schedule, actual% from progress
        const totalDuration = allFlatTasks.reduce((s, t) => s + (t.duration || 0), 0) || 1;
        const actualProgress = allFlatTasks.length > 0 ? allFlatTasks.reduce((s, t) => s + (t.progress || 0), 0) / allFlatTasks.length : 0;
        const plannedProgress = (() => {
          const today = new Date();
          const starts = allFlatTasks.filter(t => t.start_date).map(t => new Date(t.start_date!).getTime());
          const ends = allFlatTasks.filter(t => t.end_date).map(t => new Date(t.end_date!).getTime());
          if (starts.length === 0 || ends.length === 0) return 50;
          const projStart = Math.min(...starts);
          const projEnd = Math.max(...ends);
          const elapsed = today.getTime() - projStart;
          const total = projEnd - projStart;
          return total > 0 ? Math.min(100, Math.max(0, (elapsed / total) * 100)) : 50;
        })();
        const evm = calculateEVM(totalDuration, plannedProgress, actualProgress, totalDuration * (actualProgress / 100));
        const spiPct = evm.spi * 100;
        const cpiPct = evm.cpi * 100;
        return (
          <div className="fixed top-20 right-4 z-[100] bg-white rounded-xl shadow-2xl border border-slate-200 w-72">
            <div className="p-3 border-b border-slate-200">
              <h3 className="font-bold text-slate-800 flex items-center gap-2 text-sm"><BarChart3 className="w-4 h-4 text-blue-500" /> EVM Earned Value</h3>
            </div>
            <div className="p-3 grid grid-cols-2 gap-2">
              <div className="bg-slate-50 rounded-lg p-2 text-center">
                <div className="text-[10px] text-slate-400 uppercase">SPI</div>
                <div className={`text-lg font-bold ${spiPct >= 100 ? 'text-green-600' : spiPct >= 80 ? 'text-amber-600' : 'text-red-600'}`}>{spiPct.toFixed(0)}%</div>
              </div>
              <div className="bg-slate-50 rounded-lg p-2 text-center">
                <div className="text-[10px] text-slate-400 uppercase">CPI</div>
                <div className={`text-lg font-bold ${cpiPct >= 100 ? 'text-green-600' : cpiPct >= 80 ? 'text-amber-600' : 'text-red-600'}`}>{cpiPct.toFixed(0)}%</div>
              </div>
              <div className="bg-slate-50 rounded-lg p-2 text-center">
                <div className="text-[10px] text-slate-400 uppercase">PV</div>
                <div className="text-sm font-bold text-slate-700">{evm.pv.toFixed(0)}</div>
              </div>
              <div className="bg-slate-50 rounded-lg p-2 text-center">
                <div className="text-[10px] text-slate-400 uppercase">EV</div>
                <div className="text-sm font-bold text-slate-700">{evm.ev.toFixed(0)}</div>
              </div>
              <div className="col-span-2 bg-slate-50 rounded-lg p-2 text-center">
                <div className="text-[10px] text-slate-400 uppercase">EAC (prognoza)</div>
                <div className="text-sm font-bold text-slate-700">{evm.eac.toFixed(0)} dni</div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ========== HELP / LEGEND OVERLAY ========== */}
      {showHelp && (
        <div className="fixed bottom-4 right-4 z-[100] bg-white rounded-xl shadow-2xl border border-slate-200 w-96 max-h-[70vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
          <div className="p-4 border-b border-slate-200 flex justify-between items-center sticky top-0 bg-white rounded-t-xl">
            <h3 className="font-bold text-slate-800 flex items-center gap-2"><HelpCircle className="w-4 h-4" /> Pomoc i legenda</h3>
            <button onClick={() => setShowHelp(false)} className="p-1 hover:bg-slate-100 rounded"><X className="w-4 h-4 text-slate-400" /></button>
          </div>
          <div className="p-4 space-y-4">
            {/* Priority colors */}
            <div>
              <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2">Priorytet</h4>
              <div className="grid grid-cols-2 gap-1.5 text-xs">
                <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-slate-400" /> Niski</div>
                <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-blue-500" /> Normalny</div>
                <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-amber-500" /> Wysoki</div>
                <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-red-500" /> Krytyczny</div>
              </div>
            </div>
            {/* Dependency types */}
            <div>
              <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2">Typy zależności</h4>
              <div className="space-y-1 text-xs">
                <div className="flex items-center gap-2"><div className="w-8 h-0.5 bg-slate-600" /> FS — Koniec-Początek (solid)</div>
                <div className="flex items-center gap-2"><div className="w-8 h-0.5 bg-slate-600" style={{ borderTop: '2px dashed #475569', height: 0 }} /> SS — Początek-Początek (dashed)</div>
                <div className="flex items-center gap-2"><div className="w-8 h-0.5 bg-slate-600" style={{ borderTop: '2px dotted #475569', height: 0 }} /> FF — Koniec-Koniec (dotted)</div>
                <div className="flex items-center gap-2"><div className="w-8 h-0.5 bg-slate-600" style={{ borderTop: '2px dashed #475569', height: 0 }} /> SF — Początek-Koniec (dash-dot)</div>
              </div>
            </div>
            {/* Symbols */}
            <div>
              <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2">Symbole</h4>
              <div className="space-y-1 text-xs">
                <div className="flex items-center gap-2"><div className="w-3 h-3 rotate-45 bg-amber-500" /> Kamień milowy</div>
                <div className="flex items-center gap-2"><div className="w-6 h-1.5 bg-blue-600 rounded-sm" /> Faza nadrzędna</div>
                <div className="flex items-center gap-2"><div className="w-6 h-3 bg-blue-400 rounded" /> Zadanie</div>
                <div className="flex items-center gap-2"><div className="w-0.5 h-4 bg-red-500" /> Dzisiaj</div>
                <div className="flex items-center gap-2"><AlertCircle className="w-3.5 h-3.5 text-red-500" /> Przekroczony termin</div>
                <div className="flex items-center gap-2"><Clock className="w-3.5 h-3.5 text-amber-500" /> Termin wkrótce (&le;3 dni)</div>
              </div>
            </div>
            {/* Critical path */}
            <div>
              <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2">Ścieżka krytyczna</h4>
              <p className="text-xs text-slate-600">Najdłuższa ścieżka przez sieć zależności. Opóźnienie zadania na ścieżce krytycznej opóźnia cały projekt. Włącz w ustawieniach.</p>
            </div>
            {/* Keyboard shortcuts */}
            <div>
              <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2">Skróty klawiszowe</h4>
              <div className="grid grid-cols-2 gap-y-1 text-xs">
                <span className="text-slate-500">Ctrl+Z</span><span>Cofnij</span>
                <span className="text-slate-500">Ctrl+Y</span><span>Ponów</span>
                <span className="text-slate-500">Ctrl+D</span><span>Duplikuj zaznaczone</span>
                <span className="text-slate-500">Delete</span><span>Usuń zaznaczone</span>
                <span className="text-slate-500">T</span><span>Przewiń do dzisiaj</span>
                <span className="text-slate-500">+ / -</span><span>Powiększ / pomniejsz</span>
                <span className="text-slate-500">F</span><span>Pokaż filtry</span>
                <span className="text-slate-500">?</span><span>Pomoc</span>
                <span className="text-slate-500">Esc</span><span>Zamknij / anuluj</span>
                <span className="text-slate-500">Dbl-click</span><span>Edycja inline</span>
                <span className="text-slate-500">Tab</span><span>Następne pole inline</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GanttPage;
