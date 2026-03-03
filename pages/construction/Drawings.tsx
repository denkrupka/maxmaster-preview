import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Plus, Search, FileImage, ChevronRight, Loader2,
  Upload, Eye, EyeOff, Download, Trash2, ZoomIn, ZoomOut,
  Move, Type, Circle, Square, ArrowUpRight, Ruler,
  X, MoreVertical, ArrowLeft, Maximize2, Minimize2,
  GripVertical, BookOpen, ArrowUpDown, Pencil, Eraser,
  Lock, Unlock, PenTool, Hexagon, Minus,
  ChevronDown, FolderPlus, ChevronLeft,
  CloudUpload, RotateCcw, Palette, MousePointer,
  FileDown, AlertTriangle
} from 'lucide-react';
import { useAppContext } from '../../context/AppContext';
import { supabase } from '../../lib/supabase';
import { Project } from '../../types';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs';

// ==================== TYPES ====================

interface PlanFolder {
  id: string; project_id: string; parent_id?: string | null;
  name: string; code?: string; description?: string;
  sort_order: number; created_by_id: string;
  created_at: string; updated_at: string; deleted_at?: string | null;
}

interface PlanRecord {
  id: string; component_id: string; project_id: string;
  name: string; description?: string; file_url: string;
  thumbnail_url?: string; original_filename?: string;
  mime_type?: string; file_size?: number;
  width?: number; height?: number;
  calibration_enabled?: boolean; calibration_length?: number;
  calibration_pixels?: number; scale_ratio?: number;
  version: number; is_current_version: boolean;
  parent_plan_id?: string | null; sort_order: number;
  is_active?: boolean; created_by_id: string;
  created_at: string; updated_at: string; deleted_at?: string | null;
}

interface PlanVersion {
  id: string; file_url: string; original_filename?: string;
  version: number; is_current_version: boolean;
  created_at: string; created_by_id?: string;
}

interface FolderWithPlans extends PlanFolder {
  plans: PlanRecord[];
  isExpanded: boolean;
}

interface Annotation {
  id?: string;
  type: 'freehand' | 'line' | 'arrow' | 'rectangle' | 'ellipse' | 'text' | 'measurement';
  geometry: any;
  strokeColor: string;
  strokeWidth: number;
  fillColor?: string;
  fillOpacity?: number;
  textContent?: string;
  measurementValue?: number;
  measurementUnit?: string;
}

type AnnotationTool = 'pointer' | 'pen' | 'highlighter' | 'rectangle' | 'ellipse' | 'arrow' | 'line' | 'text' | 'eraser' | 'ruler';

// ==================== HELPERS ====================

const sanitizeFileName = (name: string): string =>
  name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l').replace(/Ł/g, 'L')
    .replace(/[^a-zA-Z0-9._-]/g, '_');

const formatFileSize = (bytes?: number): string => {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(2)} MB`;
};

const getFileType = (plan: PlanRecord): 'pdf' | 'image' | 'dwg' | 'other' => {
  const ext = (plan.original_filename || plan.file_url || '').toLowerCase();
  if (plan.mime_type === 'application/pdf' || ext.endsWith('.pdf')) return 'pdf';
  if (ext.match(/\.(dwg|dxf)$/)) return 'dwg';
  if (plan.mime_type?.startsWith('image/') || ext.match(/\.(png|jpg|jpeg|gif|bmp|webp|svg|tiff?)$/)) return 'image';
  return 'other';
};

const hasValidFile = (plan: PlanRecord): boolean =>
  !!(plan.file_url && plan.file_url !== 'placeholder' && plan.file_url.startsWith('http'));

const COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#8b5cf6','#ec4899','#000000','#ffffff'];
const STROKE_WIDTHS = [1, 2, 4, 6, 10];

// ==================== ANNOTATION SVG RENDERER ====================

const renderAnnotationSvg = (ann: Annotation, idx: number, isActive: boolean, onSelect?: () => void) => {
  const baseProps = {
    stroke: ann.strokeColor,
    strokeWidth: ann.strokeWidth,
    fill: ann.fillColor || 'none',
    fillOpacity: ann.fillOpacity ?? 0.15,
    cursor: 'pointer',
    onClick: onSelect,
    className: isActive ? 'annotation-active' : '',
  };

  switch (ann.type) {
    case 'freehand': {
      const pts = ann.geometry.points || [];
      if (pts.length < 2) return null;
      const d = pts.map((p: number[], i: number) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
      return <path key={idx} d={d} {...baseProps} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
    }
    case 'line':
    case 'ruler':
      return <line key={idx} x1={ann.geometry.x1} y1={ann.geometry.y1} x2={ann.geometry.x2} y2={ann.geometry.y2}
        {...baseProps} fill="none" />;
    case 'arrow': {
      const { x1, y1, x2, y2 } = ann.geometry;
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const hl = Math.max(ann.strokeWidth * 4, 12);
      const ax1 = x2 - hl * Math.cos(angle - Math.PI / 6);
      const ay1 = y2 - hl * Math.sin(angle - Math.PI / 6);
      const ax2 = x2 - hl * Math.cos(angle + Math.PI / 6);
      const ay2 = y2 - hl * Math.sin(angle + Math.PI / 6);
      return <g key={idx} onClick={onSelect} style={{ cursor: 'pointer' }}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={ann.strokeColor} strokeWidth={ann.strokeWidth} />
        <polygon points={`${x2},${y2} ${ax1},${ay1} ${ax2},${ay2}`} fill={ann.strokeColor} />
      </g>;
    }
    case 'rectangle':
      return <rect key={idx} x={ann.geometry.x} y={ann.geometry.y}
        width={ann.geometry.w} height={ann.geometry.h} {...baseProps} />;
    case 'ellipse':
      return <ellipse key={idx} cx={ann.geometry.cx} cy={ann.geometry.cy}
        rx={ann.geometry.rx} ry={ann.geometry.ry} {...baseProps} />;
    case 'text':
      return <text key={idx} x={ann.geometry.x} y={ann.geometry.y}
        fill={ann.strokeColor} fontSize={Math.max(ann.strokeWidth * 5, 14)}
        fontFamily="Arial, sans-serif" onClick={onSelect} style={{ cursor: 'pointer', userSelect: 'none' }}>
        {ann.textContent || ''}
      </text>;
    case 'measurement': {
      const { x1, y1, x2, y2 } = ann.geometry;
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      const label = ann.measurementValue != null ? `${ann.measurementValue.toFixed(2)} ${ann.measurementUnit || 'm'}` : '';
      return <g key={idx} onClick={onSelect} style={{ cursor: 'pointer' }}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={ann.strokeColor} strokeWidth={ann.strokeWidth} strokeDasharray="6 3" />
        <circle cx={x1} cy={y1} r={4} fill={ann.strokeColor} />
        <circle cx={x2} cy={y2} r={4} fill={ann.strokeColor} />
        {label && <text x={mx} y={my - 8} fill={ann.strokeColor} fontSize="13" textAnchor="middle" fontFamily="Arial">{label}</text>}
      </g>;
    }
    default: return null;
  }
};

// ==================== MAIN COMPONENT ====================

export const DrawingsPage: React.FC = () => {
  const { state } = useAppContext();
  const { currentUser } = state;

  // Data
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [folders, setFolders] = useState<FolderWithPlans[]>([]);
  const [allPlans, setAllPlans] = useState<PlanRecord[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<FolderWithPlans | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<PlanRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [projectSearch, setProjectSearch] = useState('');

  // Viewer
  const [zoom, setZoom] = useState(100);
  const [activeTool, setActiveTool] = useState<AnnotationTool>('pointer');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [annColor, setAnnColor] = useState('#ef4444');
  const [annWidth, setAnnWidth] = useState(2);

  // PDF
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfTotalPages, setPdfTotalPages] = useState(0);
  const [planNatW, setPlanNatW] = useState(800);
  const [planNatH, setPlanNatH] = useState(600);

  // Annotations
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [currentDrawing, setCurrentDrawing] = useState<Annotation | null>(null);
  const [selectedAnnotation, setSelectedAnnotation] = useState<number>(-1);
  const [isDrawing, setIsDrawing] = useState(false);
  const [textInputPos, setTextInputPos] = useState<{ x: number; y: number } | null>(null);
  const [textInputValue, setTextInputValue] = useState('');

  // Popups/Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showSortModal, setShowSortModal] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showVersionModal, setShowVersionModal] = useState(false);
  const [showScaleModal, setShowScaleModal] = useState(false);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showUploadDropdown, setShowUploadDropdown] = useState(false);
  const [showUpdateDropdown, setShowUpdateDropdown] = useState(false);
  const [showPenDropdown, setShowPenDropdown] = useState(false);
  const [showShapeDropdown, setShowShapeDropdown] = useState(false);
  const [notification, setNotification] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  // Edit
  const [editName, setEditName] = useState('');
  const [editParentPlan, setEditParentPlan] = useState('');
  const [saving, setSaving] = useState(false);

  // Create modal
  const [createName, setCreateName] = useState('');
  const [createFolderId, setCreateFolderId] = useState('');
  const [createFile, setCreateFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  // Folder
  const [newFolderName, setNewFolderName] = useState('');

  // Scale calibration
  const [scaleDistance, setScaleDistance] = useState('');
  const [scaleUnit, setScaleUnit] = useState('m');
  const [calibrationMode, setCalibrationMode] = useState(false);
  const [calibrationPoints, setCalibrationPoints] = useState<{ x: number; y: number }[]>([]);

  // Versions
  const [planVersions, setPlanVersions] = useState<PlanVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState('');

  // Drag
  const [dragOverPlanId, setDragOverPlanId] = useState<string | null>(null);
  const [draggedPlanId, setDraggedPlanId] = useState<string | null>(null);

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const createFileInputRef = useRef<HTMLInputElement>(null);
  const updateFileInputRef = useRef<HTMLInputElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const renderTaskRef = useRef<any>(null);
  const pdfRenderTimeout = useRef<ReturnType<typeof setTimeout>>();
  const expandedFolders = useRef<Set<string>>(new Set());
  const textInputRef = useRef<HTMLInputElement>(null);

  const MAX_PLANS = 500;
  const notifyTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  // ==================== NOTIFICATIONS ====================

  const notify = (msg: string, type: 'success' | 'error' = 'success') => {
    if (notifyTimeoutRef.current) clearTimeout(notifyTimeoutRef.current);
    setNotification({ msg, type });
    notifyTimeoutRef.current = setTimeout(() => setNotification(null), 3500);
  };

  // Cleanup PDF on unmount
  useEffect(() => {
    return () => {
      if (pdfDoc) { try { pdfDoc.destroy(); } catch {} }
    };
  }, []);

  // Escape key for fullscreen
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && isFullscreen) setIsFullscreen(false); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isFullscreen]);

  // ==================== SVG COORDINATE HELPER ====================

  const getSvgPoint = useCallback((e: React.MouseEvent): { x: number; y: number } => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const svgPt = pt.matrixTransform(ctm.inverse());
    return { x: svgPt.x, y: svgPt.y };
  }, []);

  // ==================== PDF RENDERING ====================

  const renderPdfToCanvas = useCallback(async (pdf: pdfjsLib.PDFDocumentProxy, pageNum: number, zoomLevel: number) => {
    const canvas = pdfCanvasRef.current;
    if (!canvas) return;
    try {
      if (renderTaskRef.current) {
        try { renderTaskRef.current.cancel(); } catch {}
      }
      const page = await pdf.getPage(pageNum);
      const baseViewport = page.getViewport({ scale: 1 });
      const dpr = window.devicePixelRatio || 1;
      const renderScale = Math.max(zoomLevel / 100, 1) * dpr;
      const viewport = page.getViewport({ scale: renderScale });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${baseViewport.width}px`;
      canvas.style.height = `${baseViewport.height}px`;
      setPlanNatW(baseViewport.width);
      setPlanNatH(baseViewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const task = page.render({ canvasContext: ctx, viewport });
      renderTaskRef.current = task;
      await task.promise;
    } catch (err: any) {
      if (err?.name !== 'RenderingCancelledException') console.error('PDF render error:', err);
    }
  }, []);

  const loadPdf = useCallback(async (url: string) => {
    try {
      // Destroy previous PDF document to prevent memory leak
      if (pdfDoc) { try { pdfDoc.destroy(); } catch {} }
      const loadingTask = pdfjsLib.getDocument({ url, cMapUrl: 'https://unpkg.com/pdfjs-dist@4.0.379/cmaps/', cMapPacked: true });
      const pdf = await loadingTask.promise;
      setPdfDoc(pdf);
      setPdfTotalPages(pdf.numPages);
      setPdfPage(1);
      await renderPdfToCanvas(pdf, 1, 100);
    } catch (err) {
      console.error('PDF load error:', err);
      notify('Błąd ładowania PDF', 'error');
    }
  }, [renderPdfToCanvas]);

  // Re-render PDF on zoom/page change (debounced)
  useEffect(() => {
    if (!pdfDoc) return;
    if (pdfRenderTimeout.current) clearTimeout(pdfRenderTimeout.current);
    pdfRenderTimeout.current = setTimeout(() => {
      renderPdfToCanvas(pdfDoc, pdfPage, zoom);
    }, 150);
    return () => { if (pdfRenderTimeout.current) clearTimeout(pdfRenderTimeout.current); };
  }, [pdfDoc, pdfPage, zoom, renderPdfToCanvas]);

  // ==================== DATA LOADING ====================

  useEffect(() => { if (currentUser) loadProjects(); }, [currentUser]);
  useEffect(() => { if (selectedProject) loadPlansData(); }, [selectedProject]);

  useEffect(() => {
    if (selectedPlan) {
      setEditName(selectedPlan.name);
      setEditParentPlan(selectedPlan.parent_plan_id || '');
      lastSavedRef.current = { name: selectedPlan.name, parent: selectedPlan.parent_plan_id || '' };
      // Load file
      if (hasValidFile(selectedPlan)) {
        const ft = getFileType(selectedPlan);
        if (ft === 'pdf') {
          loadPdf(selectedPlan.file_url);
        } else {
          setPdfDoc(null);
          setPdfTotalPages(0);
        }
      }
      loadAnnotations(selectedPlan.id);
    } else {
      setPdfDoc(null);
      setAnnotations([]);
      if (selectedFolder) {
        setEditName(selectedFolder.name);
        setEditParentPlan('');
      }
    }
  }, [selectedPlan?.id]);

  const loadProjects = async () => {
    if (!currentUser) return;
    try {
      const { data } = await supabase.from('projects').select('*')
        .eq('company_id', currentUser.company_id).order('created_at', { ascending: false });
      if (data) setProjects(data);
    } catch (err) { console.error('Error loading projects:', err); }
    finally { setLoading(false); }
  };

  const loadPlansData = async () => {
    if (!selectedProject) return;
    setLoading(true);
    try {
      const [foldersRes, plansRes] = await Promise.all([
        supabase.from('plan_components').select('*').eq('project_id', selectedProject.id)
          .is('deleted_at', null).order('sort_order'),
        supabase.from('plans').select('*').eq('project_id', selectedProject.id)
          .is('deleted_at', null).eq('is_current_version', true).order('sort_order')
      ]);
      const fData: PlanFolder[] = foldersRes.data || [];
      const pData: PlanRecord[] = plansRes.data || [];
      setAllPlans(pData);
      // Preserve expanded state
      if (expandedFolders.current.size === 0) fData.forEach(f => expandedFolders.current.add(f.id));
      const fwp: FolderWithPlans[] = fData.map(f => ({
        ...f, plans: pData.filter(p => p.component_id === f.id),
        isExpanded: expandedFolders.current.has(f.id)
      }));
      setFolders(fwp);
      if (!selectedFolder && fwp.length > 0) { setSelectedFolder(fwp[0]); setEditName(fwp[0].name); }
      else if (selectedFolder) {
        const u = fwp.find(f => f.id === selectedFolder.id);
        if (u) setSelectedFolder(u);
      }
      if (selectedPlan) {
        const up = pData.find(p => p.id === selectedPlan.id);
        if (up) setSelectedPlan(up);
      }
    } catch (err) { console.error('Error loading plans:', err); }
    finally { setLoading(false); }
  };

  const loadVersions = async (planId: string) => {
    try {
      const plan = allPlans.find(p => p.id === planId);
      const rootId = plan?.parent_plan_id || planId;
      const { data } = await supabase.from('plans')
        .select('id, file_url, original_filename, version, is_current_version, created_at, created_by_id')
        .or(`id.eq.${rootId},parent_plan_id.eq.${rootId}`)
        .is('deleted_at', null).order('version', { ascending: false });
      if (data && data.length > 0) {
        setPlanVersions(data);
        const cur = data.find(v => v.is_current_version);
        if (cur) setSelectedVersionId(cur.id);
      } else {
        setPlanVersions([{ id: planId, file_url: plan?.file_url || '', original_filename: plan?.original_filename,
          version: plan?.version || 1, is_current_version: true, created_at: plan?.created_at || '' }]);
        setSelectedVersionId(planId);
      }
    } catch (err) { console.error('Error loading versions:', err); }
  };

  // ==================== ANNOTATIONS CRUD ====================

  const loadAnnotations = async (planId: string) => {
    try {
      const { data } = await supabase.from('plan_markups').select('*')
        .eq('plan_id', planId).is('deleted_at', null).order('z_index');
      if (data) {
        setAnnotations(data.map((m: any) => ({
          id: m.id, type: m.markup_type,
          geometry: m.geometry, strokeColor: m.stroke_color || '#ef4444',
          strokeWidth: m.stroke_width || 2, fillColor: m.fill_color,
          fillOpacity: m.fill_opacity ?? 0.15, textContent: m.text_content,
          measurementValue: m.measurement_value, measurementUnit: m.measurement_unit,
        })));
      } else { setAnnotations([]); }
    } catch { setAnnotations([]); }
  };

  const saveAnnotation = async (ann: Annotation) => {
    if (!selectedPlan || !currentUser) return;
    try {
      const row = {
        plan_id: selectedPlan.id, author_id: currentUser.id,
        markup_type: ann.type, geometry: ann.geometry,
        stroke_color: ann.strokeColor, stroke_width: ann.strokeWidth,
        fill_color: ann.fillColor || null, fill_opacity: ann.fillOpacity ?? 0.15,
        text_content: ann.textContent || null,
        measurement_value: ann.measurementValue ?? null,
        measurement_unit: ann.measurementUnit || null,
        z_index: annotations.length,
      };
      const { data, error } = await supabase.from('plan_markups').insert(row).select().single();
      if (error) { notify('Błąd zapisu oznaczenia: ' + error.message, 'error'); return; }
      if (data) {
        setAnnotations(prev => [...prev, { ...ann, id: data.id }]);
      }
    } catch (err: any) { notify('Błąd: ' + err.message, 'error'); }
  };

  const deleteAnnotation = async (idx: number) => {
    const ann = annotations[idx];
    if (!ann) return;
    if (ann.id) {
      const { error } = await supabase.from('plan_markups').update({ deleted_at: new Date().toISOString() }).eq('id', ann.id);
      if (error) { notify('Błąd usuwania oznaczenia: ' + error.message, 'error'); return; }
    }
    setAnnotations(prev => prev.filter((_, i) => i !== idx));
    setSelectedAnnotation(-1);
  };

  const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

  // ==================== FILE UPLOAD ====================

  const uploadFileToStorage = async (file: File, projectId: string): Promise<{ url: string; error?: string } | null> => {
    try {
      const safeName = sanitizeFileName(file.name);
      const filePath = `${projectId}/${Date.now()}_${safeName}`;
      const { error: uploadError } = await supabase.storage.from('plans')
        .upload(filePath, file, { cacheControl: '3600', upsert: false, contentType: file.type || 'application/octet-stream' });
      if (uploadError) return { url: '', error: uploadError.message };
      const { data: urlData } = supabase.storage.from('plans').getPublicUrl(filePath);
      return { url: urlData?.publicUrl || '' };
    } catch (err: any) { return { url: '', error: err.message }; }
  };

  // ==================== PLAN CRUD ====================

  const handleCreatePlan = async () => {
    if (!currentUser || !selectedProject || !createName.trim()) return;
    setUploading(true);
    try {
      let folderId = createFolderId;
      if (!folderId) {
        if (folders.length > 0) { folderId = folders[0].id; }
        else {
          const { data: nf, error: fe } = await supabase.from('plan_components')
            .insert({ project_id: selectedProject.id, name: 'DOKUMENTY BUDOWLANE', sort_order: 0, created_by_id: currentUser.id })
            .select().single();
          if (fe) { notify('Błąd tworzenia folderu: ' + fe.message, 'error'); return; }
          folderId = nf.id;
        }
      }
      let fileUrl = '', origName = '', mimeType = '', fileSize = 0;
      if (createFile) {
        const res = await uploadFileToStorage(createFile, selectedProject.id);
        if (!res || res.error) { notify('Błąd przesyłania: ' + (res?.error || 'Nieznany'), 'error'); return; }
        fileUrl = res.url; origName = createFile.name; mimeType = createFile.type; fileSize = createFile.size;
      }
      const { error: ie } = await supabase.from('plans').insert({
        project_id: selectedProject.id, component_id: folderId, name: createName.trim(),
        file_url: fileUrl || 'placeholder', original_filename: origName || null,
        mime_type: mimeType || null, file_size: fileSize || null,
        version: 1, is_current_version: true, created_by_id: currentUser.id, sort_order: allPlans.length
      });
      if (ie) { notify('Błąd zapisu: ' + ie.message, 'error'); return; }
      notify('Rzut został utworzony');
      setShowCreateModal(false); setCreateName(''); setCreateFolderId(''); setCreateFile(null);
      await loadPlansData();
    } catch (err: any) { notify('Błąd: ' + err.message, 'error'); }
    finally { setUploading(false); }
  };

  const handleUploadToFolder = async (file: File, folder?: FolderWithPlans | null) => {
    if (!currentUser || !selectedProject) return;
    if (file.size > MAX_FILE_SIZE) { notify('Plik jest za duży (max 50 MB)', 'error'); return; }
    const tf = folder || selectedFolder;
    if (!tf) { notify('Wybierz folder docelowy', 'error'); return; }
    setUploading(true);
    try {
      const res = await uploadFileToStorage(file, selectedProject.id);
      if (!res || res.error) { notify('Błąd przesyłania: ' + (res?.error || 'Nieznany'), 'error'); return; }
      const { error } = await supabase.from('plans').insert({
        project_id: selectedProject.id, component_id: tf.id,
        name: file.name.replace(/\.[^/.]+$/, ''), file_url: res.url,
        original_filename: file.name, mime_type: file.type, file_size: file.size,
        version: 1, is_current_version: true, created_by_id: currentUser.id, sort_order: allPlans.length
      });
      if (error) { notify('Błąd zapisu: ' + error.message, 'error'); return; }
      notify('Plik został przesłany');
      await loadPlansData();
    } catch (err: any) { notify('Błąd: ' + err.message, 'error'); }
    finally { setUploading(false); }
  };

  const handleUpdatePlanFile = async (file: File) => {
    if (!currentUser || !selectedProject || !selectedPlan) return;
    if (file.size > MAX_FILE_SIZE) { notify('Plik jest za duży (max 50 MB)', 'error'); return; }
    setUploading(true);
    try {
      const res = await uploadFileToStorage(file, selectedProject.id);
      if (!res || res.error) { notify('Błąd przesyłania: ' + (res?.error || 'Nieznany'), 'error'); return; }
      await supabase.from('plans').update({ is_current_version: false }).eq('id', selectedPlan.id);
      const { data: np, error } = await supabase.from('plans').insert({
        project_id: selectedProject.id, component_id: selectedPlan.component_id,
        name: selectedPlan.name, file_url: res.url, original_filename: file.name,
        mime_type: file.type, file_size: file.size, version: (selectedPlan.version || 1) + 1,
        is_current_version: true, parent_plan_id: selectedPlan.parent_plan_id || selectedPlan.id,
        created_by_id: currentUser.id, sort_order: selectedPlan.sort_order
      }).select().single();
      if (error) { notify('Błąd zapisu wersji: ' + error.message, 'error'); return; }
      if (np) setSelectedPlan(np);
      notify('Nowa wersja została przesłana');
      await loadPlansData();
    } catch (err: any) { notify('Błąd: ' + err.message, 'error'); }
    finally { setUploading(false); }
  };

  const handleDeletePlan = async () => {
    if (!selectedPlan || !confirm('Czy na pewno chcesz usunąć ten rzut?')) return;
    try {
      await supabase.from('plans').update({ deleted_at: new Date().toISOString() }).eq('id', selectedPlan.id);
      setSelectedPlan(null); notify('Rzut został usunięty');
      await loadPlansData();
    } catch (err: any) { notify('Błąd usuwania: ' + err.message, 'error'); }
  };

  const handleDeleteOldVersions = async () => {
    if (!selectedProject || !confirm('Czy na pewno chcesz usunąć stare wersje wszystkich planów?')) return;
    try {
      const { error } = await supabase.from('plans').update({ deleted_at: new Date().toISOString() })
        .eq('project_id', selectedProject.id).eq('is_current_version', false).is('deleted_at', null);
      if (error) { notify('Błąd: ' + error.message, 'error'); return; }
      notify('Stare wersje zostały usunięte');
      await loadPlansData();
    } catch (err: any) { notify('Błąd: ' + err.message, 'error'); }
  };

  const lastSavedRef = useRef<{ name: string; parent: string }>({ name: '', parent: '' });

  const handleSaveName = async () => {
    if (!editName.trim() || saving) return;
    // Skip if nothing changed
    if (editName.trim() === lastSavedRef.current.name && editParentPlan === lastSavedRef.current.parent) return;
    setSaving(true);
    try {
      if (selectedPlan) {
        const { error } = await supabase.from('plans')
          .update({ name: editName.trim(), parent_plan_id: editParentPlan || null }).eq('id', selectedPlan.id);
        if (error) { notify('Błąd: ' + error.message, 'error'); return; }
        setSelectedPlan({ ...selectedPlan, name: editName.trim(), parent_plan_id: editParentPlan || null });
      } else if (selectedFolder) {
        const { error } = await supabase.from('plan_components').update({ name: editName.trim() }).eq('id', selectedFolder.id);
        if (error) { notify('Błąd: ' + error.message, 'error'); return; }
      }
      lastSavedRef.current = { name: editName.trim(), parent: editParentPlan };
      await loadPlansData();
    } catch (err: any) { notify('Błąd: ' + err.message, 'error'); }
    finally { setSaving(false); }
  };

  const handleCreateFolder = async () => {
    if (!currentUser || !selectedProject || !newFolderName.trim()) return;
    try {
      const { error } = await supabase.from('plan_components').insert({
        project_id: selectedProject.id, name: newFolderName.trim().toUpperCase(),
        sort_order: folders.length, created_by_id: currentUser.id
      });
      if (error) { notify('Błąd: ' + error.message, 'error'); return; }
      notify('Grupa została utworzona');
      setNewFolderName(''); setShowNewFolderInput(false);
      await loadPlansData();
    } catch (err: any) { notify('Błąd: ' + err.message, 'error'); }
  };

  // ==================== SORT ====================

  const handleSort = async (dir: 'asc' | 'desc') => {
    try {
      const sorted = folders.map(f => ({
        ...f, plans: [...f.plans].sort((a, b) => dir === 'asc' ? a.name.localeCompare(b.name, 'pl') : b.name.localeCompare(a.name, 'pl'))
      }));
      sorted.sort((a, b) => dir === 'asc' ? a.name.localeCompare(b.name, 'pl') : b.name.localeCompare(a.name, 'pl'));
      const ups: Promise<any>[] = [];
      sorted.forEach((f, i) => {
        ups.push(supabase.from('plan_components').update({ sort_order: i }).eq('id', f.id));
        f.plans.forEach((p, j) => ups.push(supabase.from('plans').update({ sort_order: j }).eq('id', p.id)));
      });
      await Promise.all(ups);
      setFolders(sorted); setShowSortModal(false); notify('Posortowano');
    } catch (err: any) { notify('Błąd: ' + err.message, 'error'); }
  };

  // ==================== SCALE CALIBRATION ====================

  const handleScaleCalibration = async () => {
    if (!selectedPlan || !scaleDistance || calibrationPoints.length < 2) return;
    const p1 = calibrationPoints[0], p2 = calibrationPoints[1];
    const pixelDist = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
    const realDist = parseFloat(scaleDistance);
    if (!realDist || !pixelDist) { notify('Wprowadź prawidłową odległość', 'error'); return; }
    const ratio = realDist / pixelDist;
    try {
      const { error } = await supabase.from('plans').update({
        calibration_enabled: true, calibration_length: realDist,
        calibration_pixels: pixelDist, scale_ratio: ratio
      }).eq('id', selectedPlan.id);
      if (error) { notify('Błąd: ' + error.message, 'error'); return; }
      setSelectedPlan({ ...selectedPlan, calibration_enabled: true, calibration_length: realDist, calibration_pixels: pixelDist, scale_ratio: ratio });
      notify('Skala została skalibrowana');
      setShowScaleModal(false); setScaleDistance(''); setCalibrationMode(false); setCalibrationPoints([]);
    } catch (err: any) { notify('Błąd: ' + err.message, 'error'); }
  };

  // ==================== ANNOTATION TOOL HANDLERS ====================

  const handleSvgMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (activeTool === 'pointer') return;
    if (calibrationMode) {
      const pt = getSvgPoint(e);
      setCalibrationPoints(prev => prev.length >= 2 ? [pt] : [...prev, pt]);
      return;
    }
    if (activeTool === 'eraser') return;
    if (activeTool === 'text') {
      const pt = getSvgPoint(e);
      setTextInputPos(pt);
      setTextInputValue('');
      setTimeout(() => textInputRef.current?.focus(), 50);
      return;
    }
    const pt = getSvgPoint(e);
    setIsDrawing(true);
    if (activeTool === 'pen' || activeTool === 'highlighter') {
      setCurrentDrawing({
        type: 'freehand', geometry: { points: [[pt.x, pt.y]] },
        strokeColor: activeTool === 'highlighter' ? '#eab308' : annColor,
        strokeWidth: activeTool === 'highlighter' ? annWidth * 4 : annWidth,
        fillOpacity: activeTool === 'highlighter' ? 0.4 : 0,
      });
    } else if (activeTool === 'rectangle') {
      setCurrentDrawing({
        type: 'rectangle', geometry: { x: pt.x, y: pt.y, w: 0, h: 0, startX: pt.x, startY: pt.y },
        strokeColor: annColor, strokeWidth: annWidth, fillColor: annColor, fillOpacity: 0.1,
      });
    } else if (activeTool === 'ellipse') {
      setCurrentDrawing({
        type: 'ellipse', geometry: { cx: pt.x, cy: pt.y, rx: 0, ry: 0, startX: pt.x, startY: pt.y },
        strokeColor: annColor, strokeWidth: annWidth, fillColor: annColor, fillOpacity: 0.1,
      });
    } else if (activeTool === 'line' || activeTool === 'arrow' || activeTool === 'ruler') {
      const type = activeTool === 'ruler' ? 'measurement' : activeTool;
      setCurrentDrawing({
        type: type as any, geometry: { x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y },
        strokeColor: annColor, strokeWidth: annWidth,
      });
    }
  }, [activeTool, annColor, annWidth, getSvgPoint, calibrationMode]);

  const handleSvgMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!isDrawing || !currentDrawing) return;
    const pt = getSvgPoint(e);
    setCurrentDrawing(prev => {
      if (!prev) return null;
      if (prev.type === 'freehand') {
        return { ...prev, geometry: { ...prev.geometry, points: [...prev.geometry.points, [pt.x, pt.y]] } };
      } else if (prev.type === 'rectangle') {
        const sx = prev.geometry.startX, sy = prev.geometry.startY;
        return { ...prev, geometry: { ...prev.geometry, x: Math.min(sx, pt.x), y: Math.min(sy, pt.y), w: Math.abs(pt.x - sx), h: Math.abs(pt.y - sy) } };
      } else if (prev.type === 'ellipse') {
        const sx = prev.geometry.startX, sy = prev.geometry.startY;
        return { ...prev, geometry: { ...prev.geometry, cx: (sx + pt.x) / 2, cy: (sy + pt.y) / 2, rx: Math.abs(pt.x - sx) / 2, ry: Math.abs(pt.y - sy) / 2 } };
      } else if (['line', 'arrow', 'measurement'].includes(prev.type)) {
        return { ...prev, geometry: { ...prev.geometry, x2: pt.x, y2: pt.y } };
      }
      return prev;
    });
  }, [isDrawing, currentDrawing, getSvgPoint]);

  const handleSvgMouseUp = useCallback(() => {
    if (!isDrawing || !currentDrawing) return;
    setIsDrawing(false);
    // Add measurement value if ruler
    let ann = { ...currentDrawing };
    if (ann.type === 'measurement' && selectedPlan?.scale_ratio) {
      const { x1, y1, x2, y2 } = ann.geometry;
      const pxDist = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
      ann.measurementValue = pxDist * selectedPlan.scale_ratio;
      ann.measurementUnit = scaleUnit || 'm';
    }
    // Don't save tiny accidental clicks
    if (ann.type === 'freehand' && ann.geometry.points.length < 3) { setCurrentDrawing(null); return; }
    if (ann.type === 'rectangle' && ann.geometry.w < 3 && ann.geometry.h < 3) { setCurrentDrawing(null); return; }
    if (ann.type === 'ellipse' && ann.geometry.rx < 3 && ann.geometry.ry < 3) { setCurrentDrawing(null); return; }
    // Clean geometry
    if (ann.type === 'rectangle') { const { startX, startY, ...rest } = ann.geometry; ann.geometry = rest; }
    if (ann.type === 'ellipse') { const { startX, startY, ...rest } = ann.geometry; ann.geometry = rest; }
    saveAnnotation(ann);
    setCurrentDrawing(null);
  }, [isDrawing, currentDrawing, selectedPlan, scaleUnit]);

  const handleTextSubmit = () => {
    if (!textInputValue.trim() || !textInputPos) return;
    const ann: Annotation = {
      type: 'text', geometry: { x: textInputPos.x, y: textInputPos.y },
      strokeColor: annColor, strokeWidth: annWidth, textContent: textInputValue.trim(),
    };
    saveAnnotation(ann);
    setTextInputPos(null); setTextInputValue('');
  };

  // ==================== ZOOM ====================

  const handleWheel = useCallback((e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = Math.sign(e.deltaY) * -Math.min(Math.abs(e.deltaY) * 0.5, 25);
      setZoom(z => Math.max(25, Math.min(500, Math.round(z + delta))));
    }
  }, []);

  useEffect(() => {
    const el = viewerRef.current;
    if (el) { el.addEventListener('wheel', handleWheel, { passive: false }); }
    return () => { if (el) el.removeEventListener('wheel', handleWheel); };
  }, [handleWheel]);

  // ==================== DRAG & DROP ====================

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0 && files[0]) {
      if (selectedPlan && hasValidFile(selectedPlan)) handleUpdatePlanFile(files[0]);
      else if (selectedFolder) handleUploadToFolder(files[0]);
    }
  }, [selectedPlan, selectedFolder, selectedProject, currentUser]);

  const handlePlanDrop = async (targetId: string) => {
    if (!draggedPlanId || draggedPlanId === targetId) { setDraggedPlanId(null); setDragOverPlanId(null); return; }
    try {
      const allFP = folders.flatMap(f => f.plans);
      const di = allFP.findIndex(p => p.id === draggedPlanId);
      const ti = allFP.findIndex(p => p.id === targetId);
      if (di !== -1 && ti !== -1) {
        const re = [...allFP]; const [m] = re.splice(di, 1); re.splice(ti, 0, m);
        await Promise.all(re.map((p, i) => supabase.from('plans').update({ sort_order: i }).eq('id', p.id)));
        await loadPlansData();
      }
    } catch (err) { console.error('Drag reorder error:', err); }
    setDraggedPlanId(null); setDragOverPlanId(null);
  };

  const toggleFolder = (folderId: string) => {
    if (expandedFolders.current.has(folderId)) expandedFolders.current.delete(folderId);
    else expandedFolders.current.add(folderId);
    setFolders(prev => prev.map(f => f.id === folderId ? { ...f, isExpanded: !f.isExpanded } : f));
  };

  const closeAllPopups = () => {
    setShowMoreMenu(false); setShowUploadDropdown(false); setShowUpdateDropdown(false);
    setShowPenDropdown(false); setShowShapeDropdown(false); setShowColorPicker(false);
  };

  // ==================== COMPUTED ====================

  const totalPlans = allPlans.length;
  const filteredFolders = useMemo(() => {
    if (!search.trim()) return folders;
    const s = search.toLowerCase();
    return folders.map(f => ({ ...f, plans: f.plans.filter(p => p.name.toLowerCase().includes(s) || (p.original_filename || '').toLowerCase().includes(s)) }))
      .filter(f => f.name.toLowerCase().includes(s) || f.plans.length > 0);
  }, [folders, search]);

  const viewingPlan = selectedPlan && hasValidFile(selectedPlan);
  const fileType = selectedPlan ? getFileType(selectedPlan) : 'other';

  // ==================== RENDER: PROJECT SELECTION ====================

  if (!selectedProject) {
    return (
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Plany i rzuty</h1>
          <p className="text-slate-500 mb-4">Wybierz projekt, aby zarządzać planami i rzutami.</p>
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input type="text" placeholder="Szukaj projektu..." value={projectSearch}
              onChange={e => setProjectSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white" />
          </div>
        </div>
        {loading ? (
          <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>
        ) : projects.length === 0 ? (
          <div className="text-center py-16">
            <FileImage className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            <p className="text-lg text-slate-500">Brak projektów</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {projects.filter(p => p.name.toLowerCase().includes(projectSearch.toLowerCase())).map(project => (
              <button key={project.id} onClick={() => { setSelectedProject(project); setLoading(true); }}
                className="text-left p-4 bg-white rounded-xl border border-slate-200 hover:border-blue-300 hover:shadow-lg transition group">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: (project.color || '#3b82f6') + '20' }}>
                    <FileImage className="w-6 h-6" style={{ color: project.color || '#3b82f6' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-slate-900 truncate group-hover:text-blue-600">{project.name}</h3>
                    <p className="text-sm text-slate-500">{project.code || 'Brak kodu'}</p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-blue-500" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ==================== RENDER: MAIN LAYOUT ====================

  return (
    <div className="h-full flex flex-col bg-slate-50" onClick={closeAllPopups}>
      {/* Notification */}
      {notification && (
        <div className={`fixed top-4 right-4 z-[100] px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium ${notification.type === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
          {notification.msg}
        </div>
      )}

      {/* Loading overlay */}
      {uploading && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[90]">
          <div className="bg-white rounded-xl p-6 shadow-2xl flex items-center gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
            <span className="text-slate-700 font-medium">Przesyłanie pliku...</span>
          </div>
        </div>
      )}

      {/* TOP BAR */}
      <div className="bg-white border-b-[3px] border-blue-600 px-4 py-2 flex items-center gap-3 flex-shrink-0">
        <button onClick={() => { setSelectedProject(null); setSelectedPlan(null); setSelectedFolder(null); setFolders([]); setAllPlans([]); setPdfDoc(null); }}
          className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500" title="Powrót">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <button onClick={e => { e.stopPropagation(); setCreateName(''); setCreateFolderId(selectedFolder?.id || ''); setCreateFile(null); setShowCreateModal(true); }}
          className="px-5 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 text-sm shadow-sm">
          Utwórz rzuty
        </button>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="w-28 h-2 bg-slate-200 rounded-full overflow-hidden">
            <div className="h-full bg-blue-600 rounded-full transition-all" style={{ width: `${Math.min(100, (totalPlans / MAX_PLANS) * 100)}%` }} />
          </div>
          <span className="text-xs text-slate-500 whitespace-nowrap">{totalPlans}/{MAX_PLANS}</span>
        </div>
        <div className="flex-1 max-w-xs">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input type="text" placeholder="Szukaj..." value={search} onChange={e => setSearch(e.target.value)}
              onClick={e => e.stopPropagation()}
              className="w-full pl-8 pr-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
        <div className="flex-1" />
        <span className="text-sm text-slate-600 font-medium truncate max-w-[200px]">{selectedProject.name}</span>
        <button onClick={handleDeleteOldVersions}
          className="flex items-center gap-2 px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-700 shadow-sm">
          <Trash2 className="w-3.5 h-3.5" /> Usuń stare wersje
        </button>
      </div>

      {/* SPLIT PANEL */}
      <div className="flex-1 flex overflow-hidden">

        {/* LEFT PANEL */}
        <div className="w-[340px] min-w-[280px] border-r border-slate-200 bg-white flex flex-col overflow-hidden flex-shrink-0">
          <div className="px-3 py-2.5 border-b border-slate-200 flex items-center justify-between flex-shrink-0 bg-slate-50">
            <span className="font-semibold text-slate-700 text-sm">Plany i rzuty</span>
            <div className="flex items-center gap-0.5">
              <button onClick={e => { e.stopPropagation(); setShowNewFolderInput(!showNewFolderInput); }}
                className="p-1.5 hover:bg-slate-200 rounded text-slate-500" title="Nowa grupa"><FolderPlus className="w-4 h-4" /></button>
              <button onClick={e => { e.stopPropagation(); setShowSortModal(true); }}
                className="p-1.5 hover:bg-slate-200 rounded text-slate-500" title="Sortuj"><ArrowUpDown className="w-4 h-4" /></button>
            </div>
          </div>

          {showNewFolderInput && (
            <div className="px-3 py-2 border-b border-slate-200 bg-blue-50 flex items-center gap-2">
              <input type="text" value={newFolderName} onChange={e => setNewFolderName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreateFolder()} placeholder="Nazwa grupy..."
                className="flex-1 px-2 py-1.5 border border-slate-300 rounded text-sm" autoFocus onClick={e => e.stopPropagation()} />
              <button onClick={handleCreateFolder} disabled={!newFolderName.trim()}
                className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50">Dodaj</button>
              <button onClick={() => { setShowNewFolderInput(false); setNewFolderName(''); }} className="p-1 text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {loading && folders.length === 0 ? (
              <div className="flex items-center justify-center h-32"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>
            ) : filteredFolders.length === 0 ? (
              <div className="text-center py-10 px-4">
                <FileImage className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                <p className="text-sm text-slate-400">Brak planów. Kliknij "Utwórz rzuty" aby dodać.</p>
              </div>
            ) : filteredFolders.map(folder => (
              <div key={folder.id}>
                <div className={`flex items-center gap-2 px-3 py-2.5 cursor-pointer border-b border-slate-100 transition-colors ${
                  selectedFolder?.id === folder.id && !selectedPlan ? 'bg-slate-800 text-white' : 'bg-slate-50 hover:bg-slate-100 text-slate-800'
                }`} onClick={e => { e.stopPropagation(); setSelectedFolder(folder); setSelectedPlan(null); setEditName(folder.name); setEditParentPlan(''); }}>
                  <button onClick={e => { e.stopPropagation(); toggleFolder(folder.id); }}
                    className={`p-0.5 rounded transition ${selectedFolder?.id === folder.id && !selectedPlan ? 'hover:bg-white/10' : 'hover:bg-slate-200'}`}>
                    <ChevronRight className={`w-3.5 h-3.5 transition-transform ${folder.isExpanded ? 'rotate-90' : ''}`} />
                  </button>
                  <span className="font-bold text-xs uppercase tracking-wider flex-1 truncate">{folder.name}</span>
                  <span className="text-xs opacity-50">{folder.plans.length}</span>
                </div>
                {folder.isExpanded && folder.plans.map(plan => (
                  <div key={plan.id} draggable onDragStart={() => setDraggedPlanId(plan.id)}
                    onDragOver={e => { e.preventDefault(); setDragOverPlanId(plan.id); }}
                    onDragLeave={() => setDragOverPlanId(null)}
                    onDragEnd={() => { setDraggedPlanId(null); setDragOverPlanId(null); }}
                    onDrop={() => handlePlanDrop(plan.id)}
                    className={`flex items-center gap-2 px-3 py-2.5 cursor-pointer border-b border-slate-50 transition-colors ${
                      selectedPlan?.id === plan.id ? 'bg-slate-800 text-white'
                      : dragOverPlanId === plan.id ? 'bg-blue-50 border-l-4 border-l-blue-400'
                      : 'hover:bg-slate-50 bg-white'
                    }`}
                    onClick={e => { e.stopPropagation(); setSelectedPlan(plan); setSelectedFolder(folder); setZoom(100); }}>
                    <GripVertical className={`w-3.5 h-3.5 cursor-grab flex-shrink-0 ${selectedPlan?.id === plan.id ? 'opacity-50' : 'opacity-25'}`} />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate ${selectedPlan?.id === plan.id ? 'text-white' : 'text-slate-900'}`}>{plan.name}</p>
                      <p className={`text-xs truncate ${selectedPlan?.id === plan.id ? 'text-slate-300' : 'text-slate-400'}`}>
                        {plan.original_filename || `${plan.name}.pdf`}
                      </p>
                    </div>
                    <BookOpen className={`w-4 h-4 flex-shrink-0 ${selectedPlan?.id === plan.id ? 'text-white/60' : 'text-slate-300'}`} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT PANEL */}
        <div className="flex-1 flex flex-col overflow-hidden bg-white" onClick={e => e.stopPropagation()}>
          {/* Right header */}
          <div className="px-4 py-2 border-b border-slate-200 flex items-center gap-3 flex-shrink-0 bg-white">
            <span className="text-xs text-slate-400 font-medium">Nazwa</span>
            <input type="text" value={editName} onChange={e => setEditName(e.target.value)}
              onBlur={handleSaveName} onKeyDown={e => { if (e.key === 'Enter') { handleSaveName(); (e.target as HTMLInputElement).blur(); }}}
              className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm w-44 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder={selectedPlan ? 'Nazwa planu' : 'Nazwa grupy'} />
            <span className="text-xs text-slate-400 font-medium">Nadrzędny</span>
            <select value={editParentPlan} onChange={e => setEditParentPlan(e.target.value)} onBlur={handleSaveName}
              className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm flex-1 max-w-[180px] focus:ring-2 focus:ring-blue-500">
              <option value="">— brak —</option>
              {allPlans.filter(p => p.id !== selectedPlan?.id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <div className="flex-1" />
            <div className="relative" onClick={e => e.stopPropagation()}>
              <button onClick={() => setShowMoreMenu(!showMoreMenu)} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400">
                <MoreVertical className="w-5 h-5" />
              </button>
              {showMoreMenu && (
                <div className="absolute right-0 top-full mt-1 w-52 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-1">
                  {selectedPlan && (
                    <>
                      <button className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
                        onClick={() => { setShowMoreMenu(false); setCalibrationMode(true); setCalibrationPoints([]); setShowScaleModal(true); }}>
                        <Ruler className="w-4 h-4 text-slate-400" /> Skalibruj skalę
                      </button>
                      <button className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50"
                        onClick={() => { setShowMoreMenu(false); handleDeletePlan(); }}>
                        <Trash2 className="w-4 h-4" /> Usuń rzut
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* VIEWER */}
          {viewingPlan ? (
            <div className={`flex-1 flex flex-col overflow-hidden ${isFullscreen ? 'fixed inset-0 z-[80] bg-white' : ''}`}>
              {/* Viewer toolbar */}
              <div className="px-3 py-1.5 border-b border-slate-200 flex items-center gap-1 flex-shrink-0 bg-slate-50" onClick={e => e.stopPropagation()}>
                <button onClick={() => setZoom(z => Math.min(z + 25, 500))} className="p-1.5 hover:bg-white rounded-lg text-slate-600" title="Powiększ"><ZoomIn className="w-4 h-4" /></button>
                <span className="text-xs text-slate-500 w-10 text-center font-mono">{zoom}%</span>
                <button onClick={() => setZoom(z => Math.max(z - 25, 25))} className="p-1.5 hover:bg-white rounded-lg text-slate-600" title="Pomniejsz"><ZoomOut className="w-4 h-4" /></button>
                <button onClick={() => setZoom(100)} className="p-1.5 hover:bg-white rounded-lg text-slate-600 text-xs font-medium" title="100%">1:1</button>
                <div className="w-px h-5 bg-slate-200 mx-1" />
                <button onClick={() => setIsFullscreen(!isFullscreen)} className="p-1.5 hover:bg-white rounded-lg text-slate-600" title="Pełny ekran">
                  {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                </button>
                <div className="w-px h-5 bg-slate-200 mx-1" />
                <span className="text-xs text-slate-400 truncate max-w-[180px]">{selectedPlan!.original_filename || selectedPlan!.name}</span>
                {fileType === 'pdf' && pdfTotalPages > 1 && (
                  <div className="flex items-center gap-1 ml-2">
                    <button onClick={() => setPdfPage(p => Math.max(1, p - 1))} disabled={pdfPage <= 1} className="p-1 hover:bg-white rounded disabled:opacity-30"><ChevronLeft className="w-3.5 h-3.5" /></button>
                    <span className="text-xs text-slate-500 font-mono min-w-[40px] text-center">{pdfPage}/{pdfTotalPages}</span>
                    <button onClick={() => setPdfPage(p => Math.min(pdfTotalPages, p + 1))} disabled={pdfPage >= pdfTotalPages} className="p-1 hover:bg-white rounded disabled:opacity-30"><ChevronRight className="w-3.5 h-3.5" /></button>
                  </div>
                )}
                <div className="flex-1" />
                <button onClick={() => { loadVersions(selectedPlan!.id); setShowVersionModal(true); }}
                  className="p-1.5 hover:bg-white rounded-lg text-slate-600" title="Historia wersji"><RotateCcw className="w-4 h-4" /></button>
                <div className="relative">
                  <button onClick={e => { e.stopPropagation(); setShowUpdateDropdown(!showUpdateDropdown); }}
                    className="p-1.5 hover:bg-white rounded-lg text-slate-600" title="Zaktualizuj"><Upload className="w-4 h-4" /></button>
                  {showUpdateDropdown && (
                    <div className="absolute right-0 top-full mt-1 w-52 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-1" onClick={e => e.stopPropagation()}>
                      <button className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
                        onClick={() => { setShowUpdateDropdown(false); updateFileInputRef.current?.click(); }}>
                        <CloudUpload className="w-4 h-4 text-slate-400" /> Prześlij nową wersję
                      </button>
                    </div>
                  )}
                </div>
                <a href={selectedPlan!.file_url} download={selectedPlan!.original_filename || selectedPlan!.name}
                  className="p-1.5 hover:bg-white rounded-lg text-slate-600" title="Pobierz" target="_blank" rel="noopener noreferrer">
                  <Download className="w-4 h-4" />
                </a>
                <button onClick={handleDeletePlan} className="p-1.5 hover:bg-red-50 rounded-lg text-red-400 hover:text-red-600" title="Usuń">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {/* Plan viewer area */}
              <div ref={viewerRef} className="flex-1 overflow-auto bg-slate-100 relative"
                onDrop={handleFileDrop} onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}>
                {fileType === 'dwg' ? (
                  <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
                    <AlertTriangle className="w-16 h-16 text-amber-400 mb-4" />
                    <h3 className="text-lg font-semibold text-slate-700 mb-2">Format DWG/DXF</h3>
                    <p className="text-sm text-slate-500 mb-6 max-w-md">
                      Podgląd plików DWG/DXF nie jest dostępny w przeglądarce. Pobierz plik i otwórz w programie AutoCAD, LibreCAD lub skonwertuj do PDF.
                    </p>
                    <a href={selectedPlan!.file_url} download className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 shadow-sm">
                      <FileDown className="w-5 h-5" /> Pobierz plik {selectedPlan!.original_filename?.split('.').pop()?.toUpperCase()}
                    </a>
                  </div>
                ) : (
                  <div className="min-h-full flex items-start justify-center p-4">
                    <div className="relative" style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center' }}>
                      {/* PDF Canvas */}
                      {fileType === 'pdf' && <canvas ref={pdfCanvasRef} className="bg-white shadow-lg" />}
                      {/* Image */}
                      {fileType === 'image' && (
                        <img src={selectedPlan!.file_url} alt={selectedPlan!.name}
                          className="shadow-lg bg-white" style={{ imageRendering: zoom > 200 ? 'pixelated' : 'auto' }}
                          onLoad={e => { const img = e.target as HTMLImageElement; setPlanNatW(img.naturalWidth); setPlanNatH(img.naturalHeight); }}
                          onError={() => notify('Nie można załadować obrazu', 'error')} />
                      )}
                      {/* SVG Annotation Overlay */}
                      <svg ref={svgRef} viewBox={`0 0 ${planNatW} ${planNatH}`}
                        className="absolute top-0 left-0 w-full h-full"
                        style={{ cursor: activeTool === 'pointer' ? 'default' : activeTool === 'eraser' ? 'crosshair' : 'crosshair' }}
                        onMouseDown={handleSvgMouseDown} onMouseMove={handleSvgMouseMove} onMouseUp={handleSvgMouseUp}
                        onMouseLeave={handleSvgMouseUp}>
                        {/* Saved annotations */}
                        {annotations.map((ann, i) => renderAnnotationSvg(ann, i, selectedAnnotation === i,
                          () => { if (activeTool === 'eraser') deleteAnnotation(i); else setSelectedAnnotation(i); }))}
                        {/* Current drawing */}
                        {currentDrawing && renderAnnotationSvg(currentDrawing, -1, false)}
                        {/* Calibration points */}
                        {calibrationMode && calibrationPoints.map((pt, i) => (
                          <g key={`cal-${i}`}>
                            <circle cx={pt.x} cy={pt.y} r={8} fill="#3b82f6" fillOpacity={0.3} stroke="#3b82f6" strokeWidth={2} />
                            <circle cx={pt.x} cy={pt.y} r={3} fill="#3b82f6" />
                          </g>
                        ))}
                        {calibrationMode && calibrationPoints.length === 2 && (
                          <line x1={calibrationPoints[0].x} y1={calibrationPoints[0].y}
                            x2={calibrationPoints[1].x} y2={calibrationPoints[1].y}
                            stroke="#3b82f6" strokeWidth={2} strokeDasharray="6 4" />
                        )}
                        {/* Text input */}
                        {textInputPos && (
                          <foreignObject x={textInputPos.x} y={textInputPos.y - 16} width="200" height="32">
                            <input ref={textInputRef} type="text" value={textInputValue} onChange={e => setTextInputValue(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') handleTextSubmit(); if (e.key === 'Escape') setTextInputPos(null); }}
                              onBlur={handleTextSubmit}
                              className="w-full px-1 py-0.5 border border-blue-400 rounded text-sm bg-white/90 focus:outline-none"
                              style={{ color: annColor, fontSize: `${Math.max(annWidth * 5, 14)}px` }}
                              autoFocus />
                          </foreignObject>
                        )}
                      </svg>
                    </div>
                  </div>
                )}
              </div>

              {/* Bottom annotation toolbar */}
              <div className="px-3 py-1.5 border-t border-slate-200 bg-white flex items-center gap-0.5 flex-shrink-0" onClick={e => e.stopPropagation()}>
                {/* Pointer */}
                <button onClick={() => setActiveTool('pointer')}
                  className={`p-2 rounded-lg transition ${activeTool === 'pointer' ? 'bg-blue-100 text-blue-700 shadow-inner' : 'hover:bg-slate-100 text-slate-600'}`} title="Zaznacz">
                  <MousePointer className="w-5 h-5" />
                </button>

                <div className="w-px h-6 bg-slate-200 mx-1" />

                {/* Pen dropdown */}
                <div className="relative">
                  <button onClick={e => { e.stopPropagation(); setShowPenDropdown(!showPenDropdown); }}
                    className={`p-2 rounded-lg flex items-center gap-0.5 transition ${['pen', 'highlighter'].includes(activeTool) ? 'bg-blue-100 text-blue-700 shadow-inner' : 'hover:bg-slate-100 text-slate-600'}`}>
                    <PenTool className="w-5 h-5" /><ChevronDown className="w-3 h-3 opacity-50" />
                  </button>
                  {showPenDropdown && (
                    <div className="absolute left-0 bottom-full mb-1 w-44 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-1" onClick={e => e.stopPropagation()}>
                      <button className={`w-full flex items-center gap-3 px-3 py-2 text-sm ${activeTool === 'pen' ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'}`}
                        onClick={() => { setActiveTool('pen'); setShowPenDropdown(false); }}>
                        <PenTool className="w-4 h-4" /> Pióro
                      </button>
                      <button className={`w-full flex items-center gap-3 px-3 py-2 text-sm ${activeTool === 'highlighter' ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'}`}
                        onClick={() => { setActiveTool('highlighter'); setShowPenDropdown(false); }}>
                        <Pencil className="w-4 h-4" /> Zakreślacz
                      </button>
                    </div>
                  )}
                </div>

                {/* Shape dropdown */}
                <div className="relative">
                  <button onClick={e => { e.stopPropagation(); setShowShapeDropdown(!showShapeDropdown); }}
                    className={`p-2 rounded-lg flex items-center gap-0.5 transition ${['rectangle', 'ellipse', 'arrow', 'line'].includes(activeTool) ? 'bg-blue-100 text-blue-700 shadow-inner' : 'hover:bg-slate-100 text-slate-600'}`}>
                    <Square className="w-5 h-5" /><ChevronDown className="w-3 h-3 opacity-50" />
                  </button>
                  {showShapeDropdown && (
                    <div className="absolute left-0 bottom-full mb-1 w-48 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-1" onClick={e => e.stopPropagation()}>
                      {([
                        { tool: 'rectangle' as const, label: 'Prostokąt', icon: Square },
                        { tool: 'ellipse' as const, label: 'Elipsa', icon: Circle },
                        { tool: 'arrow' as const, label: 'Strzałka', icon: ArrowUpRight },
                        { tool: 'line' as const, label: 'Linia', icon: Minus },
                      ]).map(item => (
                        <button key={item.tool}
                          className={`w-full flex items-center gap-3 px-3 py-2 text-sm ${activeTool === item.tool ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'}`}
                          onClick={() => { setActiveTool(item.tool); setShowShapeDropdown(false); }}>
                          <item.icon className="w-4 h-4" /> {item.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Text */}
                <button onClick={() => setActiveTool('text')}
                  className={`p-2 rounded-lg transition ${activeTool === 'text' ? 'bg-blue-100 text-blue-700 shadow-inner' : 'hover:bg-slate-100 text-slate-600'}`} title="Tekst">
                  <Type className="w-5 h-5" />
                </button>

                {/* Ruler */}
                <button onClick={() => setActiveTool('ruler')}
                  className={`p-2 rounded-lg transition ${activeTool === 'ruler' ? 'bg-blue-100 text-blue-700 shadow-inner' : 'hover:bg-slate-100 text-slate-600'}`}
                  title={selectedPlan?.scale_ratio ? 'Pomiar' : 'Pomiar (skalibruj skalę)'}>
                  <Ruler className="w-5 h-5" />
                </button>

                {/* Eraser */}
                <button onClick={() => setActiveTool('eraser')}
                  className={`p-2 rounded-lg transition ${activeTool === 'eraser' ? 'bg-red-100 text-red-600 shadow-inner' : 'hover:bg-slate-100 text-slate-600'}`} title="Gumka">
                  <Eraser className="w-5 h-5" />
                </button>

                <div className="w-px h-6 bg-slate-200 mx-1" />

                {/* Color picker */}
                <div className="relative">
                  <button onClick={e => { e.stopPropagation(); setShowColorPicker(!showColorPicker); }}
                    className="p-2 hover:bg-slate-100 rounded-lg flex items-center gap-1.5" title="Kolor">
                    <div className="w-5 h-5 rounded-full border-2 border-slate-300" style={{ backgroundColor: annColor }} />
                    <ChevronDown className="w-3 h-3 text-slate-400" />
                  </button>
                  {showColorPicker && (
                    <div className="absolute left-0 bottom-full mb-1 bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-3" onClick={e => e.stopPropagation()}>
                      <p className="text-xs font-medium text-slate-500 mb-2">Kolor</p>
                      <div className="flex gap-1.5 mb-3">
                        {COLORS.map(c => (
                          <button key={c} onClick={() => { setAnnColor(c); setShowColorPicker(false); }}
                            className={`w-7 h-7 rounded-full border-2 transition ${annColor === c ? 'border-blue-500 scale-110' : 'border-slate-200 hover:border-slate-400'}`}
                            style={{ backgroundColor: c }} />
                        ))}
                      </div>
                      <p className="text-xs font-medium text-slate-500 mb-2">Grubość</p>
                      <div className="flex gap-1.5">
                        {STROKE_WIDTHS.map(w => (
                          <button key={w} onClick={() => { setAnnWidth(w); setShowColorPicker(false); }}
                            className={`w-8 h-8 rounded-lg border flex items-center justify-center transition ${annWidth === w ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-400'}`}>
                            <div className="rounded-full bg-slate-800" style={{ width: `${Math.min(w * 2, 16)}px`, height: `${Math.min(w * 2, 16)}px` }} />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex-1" />

                {/* Annotations count & clear */}
                {annotations.length > 0 && (
                  <span className="text-xs text-slate-400">{annotations.length} oznaczeń</span>
                )}
                {selectedAnnotation >= 0 && (
                  <button onClick={() => { deleteAnnotation(selectedAnnotation); }}
                    className="p-1.5 hover:bg-red-50 rounded-lg text-red-400 hover:text-red-600 ml-1" title="Usuń zaznaczenie">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ) : (
            /* Drop zone */
            <div className="flex-1 flex flex-col items-center justify-center p-8" onDrop={handleFileDrop} onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}>
              <div className="border-2 border-dashed border-slate-300 rounded-2xl p-16 w-full max-w-xl text-center hover:border-blue-400 hover:bg-blue-50/30 transition-colors">
                <CloudUpload className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                <p className="text-lg text-slate-400 leading-relaxed">Przeciągnij i upuść plik planu tutaj</p>
                <div className="relative inline-block mt-6" onClick={e => e.stopPropagation()}>
                  <button onClick={() => setShowUploadDropdown(!showUploadDropdown)}
                    className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 shadow-sm">
                    Wybierz plik <ChevronDown className="w-4 h-4" />
                  </button>
                  {showUploadDropdown && (
                    <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 w-56 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-1">
                      <button className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
                        onClick={() => { setShowUploadDropdown(false); fileInputRef.current?.click(); }}>
                        <CloudUpload className="w-4 h-4 text-slate-400" /> Wybierz z komputera
                      </button>
                    </div>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-4">PDF, PNG, JPG, DWG, DXF — max 50 MB</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* HIDDEN FILE INPUTS */}
      <input ref={fileInputRef} type="file" className="hidden" accept="image/*,.pdf,.dwg,.dxf"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleUploadToFolder(f); e.target.value = ''; }} />
      <input ref={updateFileInputRef} type="file" className="hidden" accept="image/*,.pdf,.dwg,.dxf"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleUpdatePlanFile(f); e.target.value = ''; }} />
      <input ref={createFileInputRef} type="file" className="hidden" accept="image/*,.pdf,.dwg,.dxf"
        onChange={e => { const f = e.target.files?.[0]; if (f) setCreateFile(f); e.target.value = ''; }} />

      {/* ==================== MODALS ==================== */}

      {/* Sort Modal */}
      {showSortModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" onClick={() => setShowSortModal(false)}>
          <div className="bg-white rounded-xl w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="p-5 flex justify-between items-center border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-800">Sortowanie</h2>
              <button onClick={() => setShowSortModal(false)} className="p-1.5 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5 text-slate-500" /></button>
            </div>
            <div className="p-5">
              <p className="text-sm text-slate-600">Posortuj rzuty i grupy alfabetycznie. Hierarchia zostanie zachowana.</p>
            </div>
            <div className="px-5 pb-5 flex gap-3">
              <button onClick={() => handleSort('asc')} className="px-4 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 text-sm">A → Z</button>
              <button onClick={() => handleSort('desc')} className="px-4 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 text-sm">Z → A</button>
              <button onClick={() => setShowSortModal(false)} className="px-4 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-700 hover:bg-slate-50">Anuluj</button>
            </div>
          </div>
        </div>
      )}

      {/* Create Plan Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" onClick={() => setShowCreateModal(false)}>
          <div className="bg-white rounded-xl w-full max-w-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="p-5 flex justify-between items-center border-b border-slate-100">
              <h2 className="text-lg font-bold text-blue-600">Utwórz rzuty</h2>
              <button onClick={() => setShowCreateModal(false)} className="w-8 h-8 flex items-center justify-center bg-slate-700 text-white rounded-full hover:bg-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6">
              <div className={`border-2 border-dashed rounded-xl p-8 mb-5 text-center transition-colors ${createFile ? 'border-blue-400 bg-blue-50/50' : 'border-slate-300 hover:border-blue-400'}`}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setCreateFile(f); }} onDragOver={e => e.preventDefault()}>
                {createFile ? (
                  <div className="flex items-center justify-center gap-4">
                    <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center"><FileImage className="w-6 h-6 text-blue-600" /></div>
                    <div className="text-left">
                      <p className="font-semibold text-slate-800">{createFile.name}</p>
                      <p className="text-sm text-slate-500">{formatFileSize(createFile.size)}</p>
                    </div>
                    <button onClick={() => setCreateFile(null)} className="p-1.5 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5 text-slate-400" /></button>
                  </div>
                ) : (
                  <><Plus className="w-12 h-12 text-slate-300 mx-auto mb-2" /><p className="text-sm text-slate-400">Przeciągnij plik tutaj</p></>
                )}
              </div>
              <div className="flex gap-2 mb-5 flex-wrap">
                <button onClick={() => createFileInputRef.current?.click()} className="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600">Wybierz plik</button>
                <button onClick={() => setCreateFile(null)} className="px-4 py-2 bg-slate-700 text-white rounded-lg text-sm font-medium hover:bg-slate-800">Bez pliku</button>
              </div>
              <div className="flex gap-3">
                <input type="text" value={createName} onChange={e => setCreateName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createName.trim() && handleCreatePlan()} placeholder="Nazwa rzutu"
                  className="flex-1 px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
                <select value={createFolderId} onChange={e => setCreateFolderId(e.target.value)}
                  className="px-3 py-2.5 border border-slate-300 rounded-lg text-sm flex-1">
                  <option value="">— Folder —</option>
                  {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3 bg-slate-50 rounded-b-xl">
              <button onClick={handleCreatePlan} disabled={!createName.trim() || uploading}
                className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 text-sm disabled:opacity-50 flex items-center gap-2">
                {uploading && <Loader2 className="w-4 h-4 animate-spin" />} Zapisz
              </button>
              <button onClick={() => setShowCreateModal(false)} className="px-6 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-700 hover:bg-white">Anuluj</button>
            </div>
          </div>
        </div>
      )}

      {/* Version History Modal */}
      {showVersionModal && selectedPlan && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" onClick={() => setShowVersionModal(false)}>
          <div className="bg-white rounded-xl w-full max-w-6xl max-h-[90vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="p-4 flex items-center justify-between border-b border-slate-200 flex-shrink-0">
              <h2 className="text-lg font-semibold text-slate-800">Historia wersji</h2>
              <div className="flex items-center gap-3">
                <button onClick={() => { setShowVersionModal(false); setShowCompareModal(true); }}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">Porównaj wersje</button>
                <button onClick={() => setShowVersionModal(false)} className="p-1.5 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5 text-slate-500" /></button>
              </div>
            </div>
            <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-3 flex-shrink-0">
              <span className="text-sm font-medium text-slate-600">Wersja</span>
              <select value={selectedVersionId} onChange={e => setSelectedVersionId(e.target.value)}
                className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm flex-1 max-w-xl">
                {planVersions.map(v => (
                  <option key={v.id} value={v.id}>
                    {v.original_filename || 'plan'} (V{v.version}{v.is_current_version ? ' — aktualna' : ''})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1 overflow-auto bg-slate-100 p-4 flex items-center justify-center">
              {(() => {
                const v = planVersions.find(v => v.id === selectedVersionId);
                if (!v || !v.file_url) return <p className="text-slate-400">Wybierz wersję</p>;
                const isVPdf = (v.original_filename || '').toLowerCase().endsWith('.pdf');
                return isVPdf
                  ? <iframe src={v.file_url + '#toolbar=0'} className="bg-white shadow-lg border rounded-lg" style={{ width: '100%', height: '70vh', minWidth: '600px' }} title="version" />
                  : <img src={v.file_url} alt="" className="max-w-full shadow-lg bg-white border rounded-lg" />;
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Compare Versions Modal */}
      {showCompareModal && selectedPlan && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" onClick={() => setShowCompareModal(false)}>
          <div className="bg-white rounded-xl w-full max-w-3xl shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="p-5 flex justify-between items-center border-b border-slate-100">
              <h2 className="text-lg font-semibold text-slate-800">Porównanie wersji</h2>
              <button onClick={() => setShowCompareModal(false)} className="p-1.5 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5 text-slate-500" /></button>
            </div>
            <div className="p-5 overflow-auto max-h-[60vh]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-slate-200 text-left">
                    <th className="py-2.5 px-3 font-semibold text-slate-700">Plik</th>
                    <th className="py-2.5 px-3 font-semibold text-slate-700">Data</th>
                    <th className="py-2.5 px-3 font-semibold text-slate-700">Wersja</th>
                    <th className="py-2.5 px-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {planVersions.map(v => (
                    <tr key={v.id} className="border-b border-slate-100 hover:bg-blue-50 cursor-pointer">
                      <td className="py-2.5 px-3 text-slate-700">{v.original_filename || 'plan'}</td>
                      <td className="py-2.5 px-3 text-slate-500">
                        {v.created_at ? new Date(v.created_at).toLocaleDateString('pl-PL') + ' ' + new Date(v.created_at).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) : '-'}
                      </td>
                      <td className="py-2.5 px-3">V{v.version} {v.is_current_version ? <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">aktualna</span> : ''}</td>
                      <td className="py-2.5 px-3">
                        {v.id === selectedVersionId && <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">wyświetlona</span>}
                      </td>
                    </tr>
                  ))}
                  {planVersions.length === 0 && <tr><td colSpan={4} className="text-center py-8 text-slate-400">Brak wersji</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Scale Calibration - floating card (non-blocking so user can click on plan) */}
      {showScaleModal && selectedPlan && (
        <div className="fixed bottom-20 right-4 z-[60] w-80 bg-white rounded-xl shadow-2xl border border-slate-200" onClick={e => e.stopPropagation()}>
          <div className="p-4 flex justify-between items-center border-b border-slate-100">
            <h2 className="text-sm font-bold text-slate-800">Skalibruj skalę</h2>
            <button onClick={() => { setShowScaleModal(false); setCalibrationMode(false); setCalibrationPoints([]); }} className="p-1 hover:bg-slate-100 rounded-lg"><X className="w-4 h-4 text-slate-500" /></button>
          </div>
          <div className="p-4">
            <p className="text-xs text-slate-500 mb-3">Kliknij dwa punkty na planie, których odległość znasz, a następnie wpisz odległość.</p>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-medium text-slate-600">Punkty:</span>
              {calibrationPoints.length >= 2
                ? <span className="text-xs text-green-600 font-medium">2/2 zaznaczone</span>
                : <span className="text-xs text-amber-600">{calibrationPoints.length}/2</span>
              }
            </div>
            <div className="flex items-center gap-2 mb-3">
              <input type="number" value={scaleDistance} onChange={e => setScaleDistance(e.target.value)}
                placeholder="Odległość" className="px-2.5 py-2 border border-slate-300 rounded-lg text-sm w-28 focus:ring-2 focus:ring-blue-500" />
              <select value={scaleUnit} onChange={e => setScaleUnit(e.target.value)}
                className="px-2.5 py-2 border border-slate-300 rounded-lg text-sm">
                <option value="mm">mm</option><option value="cm">cm</option><option value="m">m</option>
              </select>
            </div>
            {selectedPlan.scale_ratio && (
              <p className="text-[10px] text-slate-400 mb-3">Aktualna skala: 1px = {selectedPlan.scale_ratio.toFixed(4)} {scaleUnit}</p>
            )}
            <div className="flex gap-2">
              <button onClick={handleScaleCalibration} disabled={!scaleDistance || calibrationPoints.length < 2}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 text-xs disabled:opacity-50">Zapisz</button>
              <button onClick={() => { setShowScaleModal(false); setCalibrationMode(false); setCalibrationPoints([]); }}
                className="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-xs text-slate-700 hover:bg-slate-50">Anuluj</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DrawingsPage;
