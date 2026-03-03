import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  ArrowLeft, ChevronRight, ChevronDown, Calendar, Clock, Users,
  Plus, Settings, Download, Loader2, ZoomIn, ZoomOut, Filter,
  ChevronLeft, Link as LinkIcon, Milestone, Search, X, Save,
  Pencil, Trash2, Flag, Play, AlertCircle, Check, FileText,
  Briefcase, ListTree, ClipboardList, MoreVertical, GripVertical,
  Eye, EyeOff, Maximize2, Minimize2, Upload, FileDown, ChevronUp,
  MoreHorizontal, ArrowRight
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
    notes: '', priority: 'normal' as 'low' | 'normal' | 'high' | 'critical'
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
    taskId: string; mode: 'move' | 'resize-end';
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
  const autoSelectDone = useRef(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const [chartScrollLeft, setChartScrollLeft] = useState(0);
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);

  // Auto-dismiss notifications
  useEffect(() => {
    if (errorMsg) { const t = setTimeout(() => setErrorMsg(''), 5000); return () => clearTimeout(t); }
  }, [errorMsg]);
  useEffect(() => {
    if (successMsg) { const t = setTimeout(() => setSuccessMsg(''), 3000); return () => clearTimeout(t); }
  }, [successMsg]);

  const showError = (msg: string) => { setErrorMsg(msg); console.error(msg); };
  const showSuccess = (msg: string) => setSuccessMsg(msg);

  // Critical path calculation
  const criticalPathIds = useMemo(() => {
    if (!showCriticalPath || dependencies.length === 0) return new Set<string>();
    return findCriticalPath(tasks as GanttTaskNode[], dependencies as GanttDepRecord[]);
  }, [showCriticalPath, tasks, dependencies]);

  // Track chart scroll for smart Today button
  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const handler = () => setChartScrollLeft(el.scrollLeft);
    el.addEventListener('scroll', handler, { passive: true });
    return () => el.removeEventListener('scroll', handler);
  }, [selectedProject, loading]);

  // Close settings menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) setShowSettingsMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

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

  useEffect(() => { if (selectedProject) loadGanttData(); }, [selectedProject]);

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
    } catch (err: any) { showError('Błąd ładowania danych harmonogramu: ' + (err?.message || err)); }
    finally { setLoading(false); }
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
    // Pad: start from beginning of week, end at end of week + 2 weeks
    minDate.setDate(minDate.getDate() - minDate.getDay() - 7);
    maxDate.setDate(maxDate.getDate() + (6 - maxDate.getDay()) + 21);
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
  const totalDays = getDaysBetween(dateRange.start, dateRange.end);
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

  // Secondary headers (bottom row) — depends on zoom
  const secondaryHeaders = useMemo(() => {
    const headers: { label: string; days: number; startOffset: number }[] = [];
    const fmtShort = (d: Date) => `${d.getDate()}.${(d.getMonth() + 1).toString().padStart(2, '0')}`;
    if (zoomLevel === 'day') {
      // Each day individually
      let d = new Date(dateRange.start);
      while (d < dateRange.end) {
        const startOffset = getDaysBetween(dateRange.start, d);
        const dow = d.getDay();
        const dayLabel = DAY_LABELS[dow === 0 ? 6 : dow - 1];
        headers.push({ label: `${dayLabel} ${d.getDate()}`, days: 1, startOffset });
        d = new Date(d); d.setDate(d.getDate() + 1);
      }
    } else if (zoomLevel === 'week') {
      // Each week as date range
      let d = new Date(dateRange.start);
      while (d < dateRange.end) {
        const weekStart = new Date(d);
        const weekEnd = new Date(d); weekEnd.setDate(weekEnd.getDate() + 6);
        if (weekEnd > dateRange.end) weekEnd.setTime(dateRange.end.getTime());
        const days = getDaysBetween(weekStart, weekEnd) + 1;
        const startOffset = getDaysBetween(dateRange.start, weekStart);
        headers.push({ label: `${fmtShort(weekStart)} – ${fmtShort(weekEnd)}`, days, startOffset });
        d = new Date(weekEnd); d.setDate(d.getDate() + 1);
      }
    } else {
      // Month view — show week start dates
      let d = new Date(dateRange.start);
      while (d < dateRange.end) {
        const weekStart = new Date(d);
        const weekEnd = new Date(d); weekEnd.setDate(weekEnd.getDate() + 6);
        if (weekEnd > dateRange.end) weekEnd.setTime(dateRange.end.getTime());
        const days = getDaysBetween(weekStart, weekEnd) + 1;
        const startOffset = getDaysBetween(dateRange.start, weekStart);
        headers.push({ label: fmtShort(weekStart), days, startOffset });
        d = new Date(weekEnd); d.setDate(d.getDate() + 1);
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
      notes: '', priority: 'normal'
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
      priority: task.priority || 'normal'
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
      await loadGanttData();
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
      await loadGanttData();
    } catch (err: any) { showError('Błąd usuwania fazy: ' + (err?.message || err)); }
  };

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
      await loadGanttData();
    } catch (err: any) { showError('Błąd zapisu zależności: ' + (err?.message || err)); }
    finally { setSaving(false); }
  };

  const handleDeleteDep = async () => {
    if (!editingDep) return;
    try {
      await supabase.from('gantt_dependencies').delete().eq('id', editingDep.id);
      setShowDepModal(false);
      await loadGanttData();
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
      await loadGanttData();
    } catch (err: any) { showError('Błąd planowania: ' + (err?.message || err)); }
    finally { setSaving(false); }
  };

  // ========== IMPORT / EXPORT ==========
  const handleExportJSON = () => {
    const data = { tasks: allFlatTasks.map(t => ({
      id: t.id, title: t.title, parent_id: t.parent_id, wbs: t.wbs,
      start_date: t.start_date, end_date: t.end_date, duration: t.duration,
      progress: t.progress, is_milestone: t.is_milestone, sort_order: t.sort_order
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
    const rows = [['SPP', 'Nazwa', 'Faza nadrzędna', 'Data rozpoczęcia', 'Data zakończenia', 'Czas trwania', 'Postęp %', 'Kamień milowy'].join(';')];
    allFlatTasks.forEach(t => {
      rows.push([
        t.wbs || '', `"${(t.title || '').replace(/"/g, '""')}"`,
        t.parent_id || '', t.start_date?.split('T')[0] || '',
        t.end_date?.split('T')[0] || '', String(t.duration || ''),
        String(t.progress || 0), t.is_milestone ? 'Tak' : 'Nie'
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
            source: 'manual', color: '#3b82f6'
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

  // ========== DRAG HANDLERS FOR GANTT BARS ==========
  const handleBarMouseDown = (e: React.MouseEvent, task: GanttTaskWithChildren, mode: 'move' | 'resize-end') => {
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
        await loadGanttData();
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
        await loadGanttData();
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
  const filteredFlatTasks = search ? flatTasks.filter(t => getTaskTitle(t).toLowerCase().includes(search.toLowerCase())) : flatTasks;

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
        <button onClick={() => setSelectedProject(null)} className="p-1.5 hover:bg-slate-100 rounded-lg" title="Wróć do listy">
          <ArrowLeft className="w-4 h-4 text-slate-500" />
        </button>
        <div className="h-5 w-px bg-slate-200" />
        <button onClick={() => openCreatePhase()}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium">
          <Plus className="w-3.5 h-3.5" /> Utwórz fazę
        </button>
        <button onClick={() => openCreateDep()}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 text-sm font-medium">
          <LinkIcon className="w-3.5 h-3.5" /> Zależność
        </button>
        <button onClick={handleAutoSchedule} disabled={saving || allFlatTasks.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 text-sm font-medium">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />} Planuj
        </button>
        <div className="h-5 w-px bg-slate-200" />
        <span className="text-sm font-semibold text-slate-800 truncate">{selectedProject.name}</span>
        <span className="text-xs text-slate-400 ml-1">{allFlatTasks.length} faz</span>
        <div className="flex-1" />

        {/* Harmonogram start */}
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <span className="font-medium">Początek harmonogramu</span>
          <Calendar className="w-4 h-4 text-slate-400" />
          <input type="date" value={harmonogramStart} onChange={e => handleChangeHarmonogramStart(e.target.value)}
            className="px-2 py-1 border border-slate-200 rounded-lg text-sm" />
        </div>

        {/* Settings gear */}
        <div className="relative" ref={settingsRef}>
          <button onClick={() => setShowSettingsMenu(!showSettingsMenu)} className="p-1.5 hover:bg-slate-100 rounded-lg">
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
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${zoomLevel === z ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              {z === 'day' ? 'Dzień' : z === 'week' ? 'Tydzień' : 'Miesiąc'}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input type="text" placeholder="Szukaj..." value={search} onChange={e => setSearch(e.target.value)}
            className="pl-7 pr-3 py-1 text-xs border border-slate-200 rounded-lg w-44 focus:ring-1 focus:ring-blue-200" />
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* LEFT PANEL: task table */}
          <div className="flex-shrink-0 border-r border-slate-300 bg-white overflow-auto" style={{ width: leftPanelWidth }}>
            {/* Table header */}
            <div className="sticky top-0 z-20 bg-slate-100 border-b border-slate-300 flex items-center text-[10px] font-semibold text-slate-500 uppercase tracking-wide" style={{ height: 56 }}>
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
                return (
                  <div key={task.id}
                    className={`flex items-center border-b cursor-pointer group transition-colors ${isHovered ? 'bg-blue-50' : rowIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'} ${deadline === 'overdue' ? 'border-l-2 border-l-red-400' : deadline === 'due-soon' ? 'border-l-2 border-l-amber-400' : ''} border-b-slate-100 hover:bg-blue-50`}
                    style={{ height: ROW_HEIGHT }}
                    onClick={() => openEditPhase(task)}
                    onMouseEnter={() => setHoveredRowId(task.id)}
                    onMouseLeave={() => setHoveredRowId(null)}>
                    {/* Priority dot + WBS */}
                    <div className="w-14 flex items-center justify-center shrink-0 px-1 gap-1">
                      {task.priority && task.priority !== 'normal' && (
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: PRIORITY_COLORS[task.priority] }} />
                      )}
                      <span className="text-xs text-slate-500 font-medium">{task.wbs}</span>
                    </div>
                    {/* Name */}
                    <div className="flex-1 flex items-center gap-1.5 px-2 min-w-[120px]" style={{ paddingLeft: `${8 + (task.level || 0) * 18}px` }}>
                      {isParent ? (
                        <button onClick={(e) => { e.stopPropagation(); toggleTaskExpand(task.id); }}
                          className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 bg-blue-600 text-white hover:bg-blue-700 transition-colors">
                          {task.isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        </button>
                      ) : task.is_milestone ? (
                        <Milestone className="w-4 h-4 text-amber-500 flex-shrink-0" />
                      ) : (
                        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 ml-1.5" style={{ backgroundColor: task.color || '#93c5fd' }} />
                      )}
                      <span className={`text-sm truncate ${isParent ? 'font-semibold text-slate-800' : 'text-slate-700'}`}>{title}</span>
                      {/* Deadline warning icon */}
                      {deadline === 'overdue' && <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" title="Przekroczony termin!" />}
                      {deadline === 'due-soon' && <Clock className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" title="Termin wkrótce" />}
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
                    <div className="w-20 px-1 text-center text-xs text-slate-500">{task.duration ? `${task.duration} d.` : '–'}</div>
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
                      <button onClick={(e) => handleContextMenu(e, task)} className="p-1 hover:bg-slate-200 rounded opacity-0 group-hover:opacity-100 transition-opacity">
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
            onMouseDown={handleSplitterMouseDown} />

          {/* RIGHT PANEL: timeline chart */}
          <div className="flex-1 overflow-auto relative" ref={chartRef}>
            <div style={{ width: chartWidth, minHeight: '100%' }} className="relative">
              {/* Timeline header */}
              <div className="sticky top-0 z-10" style={{ height: 56 }}>
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
                      <div key={i} className={`border-r flex items-center justify-center text-[10px] font-medium overflow-hidden ${zoomLevel === 'day' ? 'border-slate-200' : 'border-slate-200'}`}
                        style={{ position: 'absolute', left: h.startOffset * dayWidth, width: w, top: 28 }}>
                        {w > 30 && <span className="text-slate-500 truncate px-0.5">{h.label}</span>}
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
                            {/* Resize handle (right edge) */}
                            <div className="absolute right-0 top-0 bottom-0 w-2 cursor-e-resize opacity-0 group-hover/bar:opacity-100 bg-white/30 hover:bg-white/60"
                              onMouseDown={(e) => { e.stopPropagation(); handleBarMouseDown(e, task, 'resize-end'); }} />
                            {/* Connection dots for drag-to-connect */}
                            <div className="absolute -left-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-blue-500 bg-white opacity-0 group-hover/bar:opacity-100 cursor-crosshair z-20 hover:bg-blue-100 hover:scale-125 transition-all"
                              onMouseDown={(e) => { e.stopPropagation(); handleConnectStart(e, task.id, 'start'); }} />
                            <div className="absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-blue-500 bg-white opacity-0 group-hover/bar:opacity-100 cursor-crosshair z-20 hover:bg-blue-100 hover:scale-125 transition-all"
                              onMouseDown={(e) => { e.stopPropagation(); handleConnectStart(e, task.id, 'end'); }} />
                          </div>
                        )}
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
                  return (
                    <g key={dep.id} className="cursor-pointer" style={{ pointerEvents: 'auto' }} onClick={() => openEditDep(dep)}>
                      <path d={path} fill="none" stroke="transparent" strokeWidth="12" />
                      <path d={path} fill="none" stroke="#475569" strokeWidth="1.5" markerEnd="url(#arrowhead)" />
                      <circle cx={x1} cy={y1} r="3" fill="#475569" />
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
              <div className="bg-slate-50 rounded-lg p-4">
                <h3 className="text-sm font-bold text-slate-800 mb-1">Kalendarz świąt państwowych</h3>
                <p className="text-xs text-slate-500">Wybierz kraj i region, aby automatycznie uzupełnić dni wolne od pracy w oparciu o lokalne święta.</p>
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
            { label: 'Pokaż na wykresie', icon: <ArrowRight className="w-4 h-4" />, onClick: () => {
              if (chartRef.current && contextMenu.task.start_date) {
                const daysFromStart = getDaysBetween(dateRange.start, new Date(contextMenu.task.start_date));
                chartRef.current.scrollLeft = daysFromStart * dayWidth - 100;
              }
            }},
            { label: 'Utwórz fazę podrzędną', icon: <Plus className="w-4 h-4" />, onClick: () => openCreatePhase(contextMenu.task.id) },
            { label: 'Dodaj zależność', icon: <LinkIcon className="w-4 h-4" />, onClick: () => openCreateDep(contextMenu.task.id) },
            { label: '', onClick: () => {}, divider: true },
            { label: 'Usuń fazę', icon: <Trash2 className="w-4 h-4" />, onClick: () => handleDeletePhase(contextMenu.task), danger: true },
          ]}
        />
      )}
    </div>
  );
};

export default GanttPage;
