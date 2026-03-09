import React, { useReducer, useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Loader2, X, Search, ChevronDown, Trash2, ArrowUpDown, FolderOpen, Plus, Building2, Settings, Download, ArrowLeft, Camera, Upload } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import { useAppContext } from '../../../context/AppContext';
import { supabase } from '../../../lib/supabase';
import type { Project, ProjectStatus, ProjectBillingType, ProjectNameMode } from '../../../types';
import {
  workspaceReducer, INITIAL_WORKSPACE_STATE,
  type WorkspaceState, type DrawingObject, type BoqRow, type AiSuggestion,
  type MeasurementItem, type AnnotationItem, type CommentThread,
  type VersionCompareResult, type WorkspaceError, type MappingRule,
  type FileStatus, type ViewerMode, type RightTab, type BottomTool,
  type WorkspaceFilters
} from './WorkspaceTypes';

import PlansSidebar from './PlansSidebar';
import WorkspaceTopToolbar from './WorkspaceTopToolbar';
import WorkspaceRightPanel from './WorkspaceRightPanel';
import ViewerBottomToolbar from './ViewerBottomToolbar';
import RuleEditorDrawer from './RuleEditorDrawer';
import AutodeskViewer, { type SelectedObjectInfo } from '../AutodeskViewer';
import PdfAnalysisModal from '../PdfAnalysisModal';
import DxfAnalysisModal from '../DxfAnalysisModal';
import { parseDxf, renderDxfToBlobUrl, type IDxf, type DxfViewBoxInfo, screenToDxfCoords, findNearestEntity } from '../../../lib/dxfRenderer';
import type { DxfAnalysis } from '../../../lib/dxfAnalyzer';

import * as api from './workspaceApi';

// PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs`;

// ---- Helpers ----

const CAD_EXTENSIONS = /\.(dwg|dxf|dwf|dwfx|rvt|rfa|ifc|nwd|nwc|stp|step|iges|igs|3dm|sat|sab|f3d|fbx|obj)$/i;

function getFileFormat(filename: string, mimeType?: string): string {
  const ext = filename.toLowerCase();
  if (mimeType === 'application/pdf' || ext.endsWith('.pdf')) return 'pdf';
  if (ext.endsWith('.dxf')) return 'dxf';
  if (ext.endsWith('.dwg')) return 'dwg';
  if (ext.endsWith('.ifc')) return 'ifc';
  if (ext.endsWith('.rvt')) return 'rvt';
  if (ext.match(/\.(png|jpg|jpeg|gif|bmp|webp|svg|tiff?)$/)) return 'image';
  if (CAD_EXTENSIONS.test(ext)) return 'cad';
  return 'other';
}

function sanitizeFileName(name: string): string {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l').replace(/Ł/g, 'L')
    .replace(/[^a-zA-Z0-9._-]/g, '_');
}

// ---- Plan/Folder types (DB schema) ----

interface PlanRecord {
  id: string; component_id: string; project_id: string;
  name: string; description?: string; file_url: string;
  thumbnail_url?: string; original_filename?: string;
  mime_type?: string; file_size?: number;
  version: number; is_current_version: boolean;
  parent_plan_id?: string | null; sort_order: number;
  is_active?: boolean; created_by_id: string;
  created_at: string; updated_at: string;
  aps_urn?: string | null;
  scale_ratio?: number;
}

interface PlanFolder {
  id: string; project_id: string; parent_id?: string | null;
  name: string; sort_order: number;
  created_at: string;
}

interface FolderWithPlans extends PlanFolder {
  plans: PlanRecord[];
  isExpanded: boolean;
}

// ---- Annotation drawing point ----
interface DrawPoint { x: number; y: number }

// ============================================================
// MAIN WORKSPACE COMPONENT
// ============================================================

export const PlansWorkspace: React.FC = () => {
  const { state: appState } = useAppContext();
  const { currentUser } = appState;

  // ---- Core workspace state ----
  const [ws, dispatch] = useReducer(workspaceReducer, INITIAL_WORKSPACE_STATE);

  // ---- Data state ----
  const [projects, setProjects] = useState<Project[]>([]);
  const [customers, setCustomers] = useState<{ id: string; name: string; nip?: string; address_city?: string }[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string; kod_obiektu?: string; rodzaj?: string; typ?: string; address_street?: string; address_city?: string; address_postal_code?: string; client_id?: string }[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [folders, setFolders] = useState<FolderWithPlans[]>([]);
  const [allPlans, setAllPlans] = useState<PlanRecord[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<PlanRecord | null>(null);
  const [projectSearch, setProjectSearch] = useState('');
  const [projectStatusFilter, setProjectStatusFilter] = useState<string>('all');
  const [projectSort, setProjectSort] = useState<{ key: string; asc: boolean }>({ key: 'created_at', asc: false });
  const [fileSearch, setFileSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // ---- Project create modal state ----
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [savingProject, setSavingProject] = useState(false);
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [clientSearchTerm, setClientSearchTerm] = useState('');
  const emptyProjectForm = {
    name: '', description: '', customer_id: '', department_id: '',
    name_mode: 'custom' as ProjectNameMode, status: 'active' as ProjectStatus,
    color: '#3B82F6', billing_type: 'ryczalt' as ProjectBillingType,
    budget_hours: '', budget_amount: '', hourly_rate: '',
    start_date: '', end_date: '',
  };
  const [projectForm, setProjectForm] = useState(emptyProjectForm);

  // ---- Viewer state ----
  const [zoom, setZoom] = useState(100);
  const [apsFileBase64, setApsFileBase64] = useState<string | null>(null);
  const [viewerReady, setViewerReady] = useState(false);

  // ---- PDF state ----
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfTotalPages, setPdfTotalPages] = useState(0);
  const [pdfNaturalSize, setPdfNaturalSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  // ---- DXF state ----
  const [dxfData, setDxfData] = useState<IDxf | null>(null);
  const [dxfBlobUrl, setDxfBlobUrl] = useState<string | null>(null);
  const [dxfViewBox, setDxfViewBox] = useState<DxfViewBoxInfo | null>(null);
  const [dxfNaturalSize, setDxfNaturalSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [dxfHiddenLayers, setDxfHiddenLayers] = useState<Set<string>>(new Set());

  // ---- Image state ----
  const imgRef = useRef<HTMLImageElement>(null);
  const [imgNaturalSize, setImgNaturalSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  // ---- Workspace data ----
  const [objects, setObjects] = useState<DrawingObject[]>([]);
  const [boqRows, setBoqRows] = useState<BoqRow[]>([]);
  const [aiSuggestions, setAiSuggestions] = useState<AiSuggestion[]>([]);
  const [measurements, setMeasurements] = useState<MeasurementItem[]>([]);
  const [annotations, setAnnotations] = useState<AnnotationItem[]>([]);
  const [comments, setComments] = useState<CommentThread[]>([]);
  const [compareResult, setCompareResult] = useState<VersionCompareResult | null>(null);
  const [errors, setErrors] = useState<WorkspaceError[]>([]);
  const [rules, setRules] = useState<MappingRule[]>(() => api.getDefaultRules());

  // ---- Annotation drawing state ----
  const [strokeColor, setStrokeColor] = useState('#ef4444');
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawPoints, setDrawPoints] = useState<DrawPoint[]>([]);
  const [textInput, setTextInput] = useState<{ x: number; y: number; text: string; toolType: 'text' | 'callout' } | null>(null);
  const [countMarkers, setCountMarkers] = useState<DrawPoint[]>([]);

  // ---- SVG overlay ref ----
  const svgOverlayRef = useRef<SVGSVGElement>(null);
  const viewerContainerRef = useRef<HTMLDivElement>(null);

  // ---- APS highlight sync ----
  const [apsHighlightDbIds, setApsHighlightDbIds] = useState<number[]>([]);

  // ---- Analysis modals ----
  const [showPdfAnalysis, setShowPdfAnalysis] = useState(false);
  const [showDxfAnalysis, setShowDxfAnalysis] = useState(false);

  // ---- Scale calibration ----
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationPoints, setCalibrationPoints] = useState<DrawPoint[]>([]);
  const [calibrationInput, setCalibrationInput] = useState<{ pixelDist: number; show: boolean }>({ pixelDist: 0, show: false });

  // ---- Photo pins (each pin can have multiple photos) ----
  type PhotoItem = { id: string; url: string; label?: string; authorName?: string; createdAt?: string };
  type PhotoPin = { id: string; x: number; y: number; photos: PhotoItem[] };
  const [photoPins, setPhotoPins] = useState<PhotoPin[]>([]);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [pendingPhotoPoint, setPendingPhotoPoint] = useState<DrawPoint | null>(null);
  const [pendingPhotoPinId, setPendingPhotoPinId] = useState<string | null>(null); // for adding more photos to existing pin
  const [showPhotoModal, setShowPhotoModal] = useState(false);
  const [showPhotoGallery, setShowPhotoGallery] = useState<{ pinId: string } | null>(null);
  const [galleryIndex, setGalleryIndex] = useState(0);

  // ---- Comment modal ----
  const [commentModal, setCommentModal] = useState<{ mode: 'create'; x: number; y: number } | { mode: 'view'; commentId: string } | null>(null);
  const [commentText, setCommentText] = useState('');
  const [replyText, setReplyText] = useState('');
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState('');

  // ---- Eraser hover highlight ----
  const [eraserHoverId, setEraserHoverId] = useState<string | null>(null);

  // ---- Hover tooltip ----
  const [hoverTooltip, setHoverTooltip] = useState<{ x: number; y: number; obj: DrawingObject } | null>(null);

  // ---- Box selection ----
  const [boxSelectStart, setBoxSelectStart] = useState<{ x: number; y: number } | null>(null);
  const [boxSelectEnd, setBoxSelectEnd] = useState<{ x: number; y: number } | null>(null);

  // ---- Pan state ----
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null);

  // ---- Screenshot area selection ----
  const [isSelectingScreenshotArea, setIsSelectingScreenshotArea] = useState(false);
  const [screenshotStart, setScreenshotStart] = useState<{ x: number; y: number } | null>(null);
  const [screenshotEnd, setScreenshotEnd] = useState<{ x: number; y: number } | null>(null);

  // ---- Version history ----
  const [versionHistory, setVersionHistory] = useState<PlanRecord[]>([]);
  const [showVersionHistory, setShowVersionHistory] = useState(false);

  // ---- Version comparison ----
  const [compareVersionList, setCompareVersionList] = useState<PlanRecord[]>([]);
  const [selectedCompareVersion, setSelectedCompareVersion] = useState<string | null>(null);

  // ---- Notification ----
  const [notification, setNotification] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const notifyTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const notify = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    if (notifyTimeoutRef.current) clearTimeout(notifyTimeoutRef.current);
    setNotification({ msg, type });
    notifyTimeoutRef.current = setTimeout(() => setNotification(null), 3500);
  }, []);

  // ---- Derived ----

  const activeFile = selectedPlan;
  const fileFormat = activeFile ? getFileFormat(activeFile.original_filename || activeFile.name, activeFile.mime_type) : '';
  const isViewable = ['pdf', 'dxf', 'dwg', 'cad', 'ifc', 'rvt', 'image'].includes(fileFormat);
  const hasUrn = !!(activeFile?.aps_urn);
  const needsConversion = ['dwg', 'dxf', 'cad', 'ifc', 'rvt'].includes(fileFormat) && !hasUrn;
  const fileStatus: FileStatus = hasUrn
    ? (objects.length > 0 ? (aiSuggestions.length > 0 ? (boqRows.length > 0 ? 'boq_ready' : 'ai_ready') : 'analysis_ready') : 'converted')
    : needsConversion ? 'uploaded' : 'uploaded';

  // ---- Filtered objects (apply workspace filters) ----
  const filteredObjects = React.useMemo(() => {
    let result = objects;
    const f = ws.filters;
    if (f.searchQuery) {
      const q = f.searchQuery.toLowerCase();
      result = result.filter(o => o.name.toLowerCase().includes(q) || o.category?.toLowerCase().includes(q) || o.layer?.toLowerCase().includes(q));
    }
    if (f.layers && f.layers.length > 0) {
      result = result.filter(o => o.layer && f.layers!.includes(o.layer));
    }
    if (f.categories && f.categories.length > 0) {
      result = result.filter(o => o.category && f.categories!.includes(o.category));
    }
    if (f.levels && f.levels.length > 0) {
      result = result.filter(o => o.level && f.levels!.includes(o.level));
    }
    if (f.onlyAiRecognized) {
      result = result.filter(o => o.aiStatus === 'recognized');
    }
    if (f.onlyUnresolved) {
      result = result.filter(o => o.aiStatus === 'needs_review' || o.aiStatus === 'unknown');
    }
    if (f.onlyBoqLinked) {
      result = result.filter(o => !!o.boqRowId);
    }
    if (f.onlyChangedInCompare && compareResult) {
      const changedIds = new Set([
        ...compareResult.addedObjects.map(o => o.id),
        ...compareResult.removedObjects.map(o => o.id),
        ...compareResult.changedObjects.map(c => c.before.id),
      ]);
      result = result.filter(o => changedIds.has(o.id));
    }
    if (f.confidenceThreshold !== undefined && f.confidenceThreshold > 0) {
      result = result.filter(o => (o.aiConfidence ?? 0) >= f.confidenceThreshold!);
    }
    return result;
  }, [objects, ws.filters, compareResult]);

  // ---- Data Loading ----

  useEffect(() => {
    if (currentUser) loadProjects();
  }, [currentUser]);

  useEffect(() => {
    if (selectedProject) {
      loadPlansData();
      // Auto-collapse portal sidebar when entering project workspace
      window.dispatchEvent(new Event('sidebar-collapse'));
    }
  }, [selectedProject]);

  const loadProjects = async () => {
    if (!currentUser?.company_id) return;
    try {
      const [projRes, custRes, deptRes] = await Promise.all([
        supabase.from('projects').select('*').eq('company_id', currentUser.company_id).order('created_at', { ascending: false }),
        supabase.from('contractors_clients').select('id, name, nip, address_city').eq('company_id', currentUser.company_id).eq('is_archived', false),
        supabase.from('departments').select('id, name, kod_obiektu, rodzaj, typ, address_street, address_city, address_postal_code, client_id').eq('company_id', currentUser.company_id).eq('is_archived', false),
      ]);
      if (projRes.data) setProjects(projRes.data);
      if (custRes.data) setCustomers(custRes.data);
      if (deptRes.data) setDepartments(deptRes.data);
    } catch (err) {
      console.error('Load projects error:', err);
    } finally {
      setLoading(false);
    }
  };

  const saveNewProject = async () => {
    if (!currentUser?.company_id) return;
    const nameToUse = projectForm.name_mode === 'object'
      ? departments.find(d => d.id === projectForm.department_id)?.name || projectForm.name
      : projectForm.name;
    if (!nameToUse.trim()) return;
    setSavingProject(true);
    try {
      const payload: any = {
        company_id: currentUser.company_id,
        name: nameToUse.trim(),
        description: projectForm.description.trim() || null,
        status: projectForm.status,
        color: projectForm.color,
        start_date: projectForm.start_date || null,
        end_date: projectForm.end_date || null,
        updated_at: new Date().toISOString(),
        name_mode: projectForm.name_mode,
        department_id: projectForm.department_id || null,
        billing_type: projectForm.billing_type,
        contractor_client_id: projectForm.customer_id || null,
      };
      if (projectForm.billing_type === 'ryczalt') {
        payload.budget_hours = projectForm.budget_hours ? parseFloat(projectForm.budget_hours) : null;
        payload.budget_amount = projectForm.budget_amount ? parseFloat(projectForm.budget_amount) : null;
      } else {
        payload.hourly_rate = projectForm.hourly_rate ? parseFloat(projectForm.hourly_rate) : null;
      }

      let resultData: any = null;
      for (let attempt = 0; attempt < 10; attempt++) {
        const { data, error } = await supabase.from('projects').insert(payload).select().single();
        if (!error && data) { resultData = data; break; }
        const colMatch = error?.message?.match(/Could not find the '(\w+)' column/);
        const fkMatch = error?.message?.match(/violates foreign key constraint/);
        if (colMatch) { delete payload[colMatch[1]]; }
        else if (fkMatch && payload.contractor_client_id) { payload.contractor_client_id = null; }
        else { console.error('Save project error:', error); break; }
      }

      if (resultData) {
        setProjects(prev => [resultData, ...prev]);
        setShowProjectModal(false);
        setProjectForm(emptyProjectForm);
        notify('Projekt utworzony');
      } else {
        notify('Nie udalo sie utworzyc projektu', 'error');
      }
    } catch (err: any) {
      notify(err.message || 'Blad tworzenia projektu', 'error');
    } finally {
      setSavingProject(false);
    }
  };

  const loadPlansData = async () => {
    if (!selectedProject || !currentUser?.company_id) return;
    setLoading(true);
    try {
      const { data: foldersData } = await supabase.from('plan_folders').select('*')
        .eq('project_id', selectedProject.id).is('deleted_at', null).order('sort_order');
      const { data: plansData } = await supabase.from('plans').select('*')
        .eq('project_id', selectedProject.id).eq('is_current_version', true)
        .is('deleted_at', null).order('sort_order').limit(500);

      const plans: PlanRecord[] = plansData || [];
      setAllPlans(plans);

      const folderList: FolderWithPlans[] = [];
      const folderMap = new Map<string, FolderWithPlans>();

      for (const f of (foldersData || [])) {
        const fw: FolderWithPlans = { ...f, plans: [], isExpanded: true };
        folderMap.set(f.id, fw);
        folderList.push(fw);
      }

      const defaultFolder: FolderWithPlans = {
        id: '__default__', project_id: selectedProject.id, name: 'Plany',
        sort_order: 0, created_at: '', plans: [], isExpanded: true,
      };

      for (const plan of plans) {
        const folder = folderMap.get((plan as any).folder_id) || defaultFolder;
        folder.plans.push(plan);
      }

      if (defaultFolder.plans.length > 0 || folderList.length === 0) {
        folderList.unshift(defaultFolder);
      }

      setFolders(folderList);
    } catch (err) {
      console.error('Load plans error:', err);
    } finally {
      setLoading(false);
    }
  };

  // ---- PDF Rendering ----

  const renderPdfPage = useCallback(async (doc: pdfjsLib.PDFDocumentProxy, pageNum: number, scale: number) => {
    const canvas = pdfCanvasRef.current;
    if (!canvas) return;
    try {
      const page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale: scale / 100 * 2 }); // 2x for retina
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width / 2}px`;
      canvas.style.height = `${viewport.height / 2}px`;
      const ctx = canvas.getContext('2d')!;
      await page.render({ canvasContext: ctx, viewport }).promise;
      setPdfNaturalSize({ w: viewport.width / 2, h: viewport.height / 2 });
    } catch (err) {
      console.error('PDF render error:', err);
    }
  }, []);

  // Load PDF when file changes
  useEffect(() => {
    if (!activeFile || fileFormat !== 'pdf') { setPdfDoc(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const loadingTask = pdfjsLib.getDocument(activeFile.file_url);
        const doc = await loadingTask.promise;
        if (cancelled) return;
        setPdfDoc(doc);
        setPdfTotalPages(doc.numPages);
        setPdfPage(1);
        renderPdfPage(doc, 1, zoom);
      } catch (err) {
        console.error('PDF load error:', err);
        if (!cancelled) notify('Blad ladowania PDF', 'error');
      }
    })();
    return () => { cancelled = true; };
  }, [activeFile?.id, fileFormat]);

  // Re-render PDF on page/zoom change
  useEffect(() => {
    if (pdfDoc && fileFormat === 'pdf') renderPdfPage(pdfDoc, pdfPage, zoom);
  }, [pdfDoc, pdfPage, zoom, fileFormat]);

  // ---- DXF Rendering ----

  useEffect(() => {
    if (!activeFile || fileFormat !== 'dxf' || hasUrn) {
      setDxfData(null);
      if (dxfBlobUrl) { URL.revokeObjectURL(dxfBlobUrl); setDxfBlobUrl(null); }
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(activeFile.file_url);
        if (!response.ok) throw new Error('Cannot fetch DXF');
        const text = await response.text();
        if (cancelled) return;
        const dxf = parseDxf(text);
        setDxfData(dxf);
        setDxfHiddenLayers(new Set());
        const { url, viewBox } = renderDxfToBlobUrl(dxf);
        if (cancelled) { URL.revokeObjectURL(url); return; }
        if (dxfBlobUrl) URL.revokeObjectURL(dxfBlobUrl);
        setDxfBlobUrl(url);
        setDxfViewBox(viewBox);
        setDxfNaturalSize({ w: viewBox.svgWidth, h: viewBox.svgHeight });
      } catch (err: any) {
        if (!cancelled) notify(err.message || 'Blad ladowania DXF', 'error');
      }
    })();
    return () => { cancelled = true; };
  }, [activeFile?.id, fileFormat, hasUrn]);

  // Re-render DXF when hidden layers change
  useEffect(() => {
    if (!dxfData || fileFormat !== 'dxf' || hasUrn) return;
    const { url, viewBox } = renderDxfToBlobUrl(dxfData, dxfHiddenLayers.size > 0 ? dxfHiddenLayers : undefined);
    if (dxfBlobUrl) URL.revokeObjectURL(dxfBlobUrl);
    setDxfBlobUrl(url);
    setDxfViewBox(viewBox);
  }, [dxfHiddenLayers]);

  // ---- File Selection ----

  const handleSelectFile = useCallback((fileId: string) => {
    const plan = allPlans.find(p => p.id === fileId);
    if (!plan) return;
    setSelectedPlan(plan);
    dispatch({ type: 'SET_ACTIVE_FILE', fileId });

    // Reset workspace data
    setObjects([]);
    setBoqRows([]);
    setAiSuggestions([]);
    setCompareResult(null);
    setErrors([]);
    setApsFileBase64(null);
    setViewerReady(false);
    setZoom(100);
    setAnnotations([]);
    setMeasurements([]);
    setComments([]);
    setCountMarkers([]);
    setDrawPoints([]);
    setIsDrawing(false);
    setTextInput(null);
    setApsHighlightDbIds([]);
    setPhotoPins([]);
    setShowPdfAnalysis(false);
    setShowDxfAnalysis(false);
    setIsCalibrating(false);
    setCalibrationPoints([]);

    // Load persisted annotations, measurements, comments for this file
    loadPersistedData(fileId);
  }, [allPlans]);

  const loadPersistedData = async (planId: string) => {
    try {
      // Load comments
      const { data: commentsData } = await supabase.from('plan_comments').select('*')
        .eq('plan_id', planId).order('created_at');
      if (commentsData) {
        setComments(commentsData.map((c: any) => ({
          id: c.id,
          fileId: c.plan_id,
          positionX: c.position_x,
          positionY: c.position_y,
          authorId: c.author_id,
          authorName: c.author_name || 'User',
          content: c.content,
          isResolved: c.is_resolved,
          replies: [],
          createdAt: c.created_at,
        })));
      }
    } catch {
      // Tables may not exist yet
    }
    try {
      // Load annotations
      const { data: annData } = await supabase.from('plan_annotations').select('*')
        .eq('plan_id', planId).order('created_at');
      if (annData) {
        setAnnotations(annData.map((a: any) => ({
          id: a.id,
          type: a.type,
          geometry: a.geometry,
          text: a.text,
          strokeColor: a.stroke_color || '#ef4444',
          strokeWidth: a.stroke_width || 2,
          linkedBoqRowId: a.linked_boq_row_id,
          createdBy: a.created_by,
          createdAt: a.created_at,
        })));
      }
    } catch {
      // Tables may not exist yet
    }
    try {
      // Load measurements
      const { data: measData } = await supabase.from('plan_measurements').select('*')
        .eq('plan_id', planId).order('created_at');
      if (measData) {
        setMeasurements(measData.map((m: any) => ({
          id: m.id,
          type: m.type,
          value: m.value,
          unit: m.unit,
          label: m.label,
          points: m.points,
          linkedBoqRowId: m.linked_boq_row_id,
          createdBy: m.created_by,
          createdAt: m.created_at,
        })));
      }
    } catch {
      // Tables may not exist yet
    }
    try {
      // Load photo pins
      const { data: photoData } = await supabase.from('plan_photos').select('*')
        .eq('plan_id', planId).order('created_at');
      if (photoData) {
        // Group photos by position (same x,y = same pin)
        const pinMap = new Map<string, PhotoPin>();
        for (const p of photoData as any[]) {
          const key = `${Math.round(p.position_x)},${Math.round(p.position_y)}`;
          if (!pinMap.has(key)) {
            pinMap.set(key, { id: `pin-${p.id}`, x: p.position_x, y: p.position_y, photos: [] });
          }
          pinMap.get(key)!.photos.push({
            id: p.id,
            url: p.photo_url,
            label: p.label,
            authorName: p.author_name,
            createdAt: p.created_at,
          });
        }
        setPhotoPins(Array.from(pinMap.values()));
      }
    } catch {
      // Tables may not exist yet
    }
  };

  // ---- Import ----

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImport = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedProject || !currentUser) return;

    try {
      const safeName = sanitizeFileName(file.name);
      const path = `plans/${selectedProject.id}/${Date.now()}_${safeName}`;
      const { error: uploadErr } = await supabase.storage.from('plan-files').upload(path, file);
      if (uploadErr) throw uploadErr;

      const { data: urlData } = supabase.storage.from('plan-files').getPublicUrl(path);

      // Ensure a plan_component exists for this project
      let componentId: string;
      const { data: existingComp } = await supabase.from('plan_components').select('id')
        .eq('project_id', selectedProject.id).limit(1).single();
      if (existingComp) {
        componentId = existingComp.id;
      } else {
        const { data: newComp, error: compErr } = await supabase.from('plan_components').insert({
          project_id: selectedProject.id,
          name: 'Glowny',
          sort_order: 0,
          created_by_id: currentUser.id,
        }).select('id').single();
        if (compErr || !newComp) throw compErr || new Error('Nie udalo sie utworzyc komponentu');
        componentId = newComp.id;
      }

      const { error: insertErr } = await supabase.from('plans').insert({
        project_id: selectedProject.id,
        component_id: componentId,
        name: file.name.replace(/\.[^.]+$/, ''),
        file_url: urlData.publicUrl,
        original_filename: file.name,
        mime_type: file.type,
        file_size: file.size,
        version: 1,
        is_current_version: true,
        sort_order: allPlans.length,
        created_by_id: currentUser.id,
      });
      if (insertErr) throw insertErr;

      notify('Plik zostal przeslany');
      loadPlansData();
    } catch (err: any) {
      notify(err.message || 'Blad przesylania pliku', 'error');
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [selectedProject, currentUser, allPlans.length, notify]);

  // ---- Convert ----

  const handleConvert = useCallback(async () => {
    if (!selectedPlan) return;
    dispatch({ type: 'SET_STATUS', key: 'conversionStatus', status: 'loading' });
    try {
      const response = await fetch(selectedPlan.file_url);
      if (!response.ok) throw new Error('Nie udalo sie pobrac pliku');
      const ab = await response.arrayBuffer();
      const bytes = new Uint8Array(ab);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      }
      const base64 = btoa(binary);

      const { urn } = await api.convertFile(
        selectedPlan.id,
        base64,
        selectedPlan.original_filename || selectedPlan.name
      );

      await supabase.from('plans').update({ aps_urn: urn }).eq('id', selectedPlan.id);
      setSelectedPlan({ ...selectedPlan, aps_urn: urn });

      dispatch({ type: 'SET_STATUS', key: 'conversionStatus', status: 'success' });
      notify('Plik zostal skonwertowany');
    } catch (err: any) {
      dispatch({ type: 'SET_STATUS', key: 'conversionStatus', status: 'error' });
      setErrors(prev => [...prev, {
        id: `err-${Date.now()}`, type: 'conversion', message: err.message,
        severity: 'error', retryable: true, timestamp: new Date().toISOString(),
      }]);
      notify(err.message || 'Blad konwersji', 'error');
    }
  }, [selectedPlan, notify]);

  // ---- Analyze ----

  const handleAnalyze = useCallback(async () => {
    if (!selectedPlan?.aps_urn) return;
    dispatch({ type: 'SET_STATUS', key: 'analysisStatus', status: 'loading' });
    try {
      const result = await api.analyzeFile(selectedPlan.aps_urn);
      setObjects(result.objects);
      dispatch({ type: 'SET_STATUS', key: 'analysisStatus', status: 'success' });
      dispatch({ type: 'SET_RIGHT_TAB', tab: 'objects' });
      notify(`Znaleziono ${result.objects.length} obiektow`);
    } catch (err: any) {
      dispatch({ type: 'SET_STATUS', key: 'analysisStatus', status: 'error' });
      setErrors(prev => [...prev, {
        id: `err-${Date.now()}`, type: 'analysis', message: err.message,
        severity: 'error', retryable: true, timestamp: new Date().toISOString(),
      }]);
      notify(err.message || 'Blad analizy', 'error');
    }
  }, [selectedPlan, notify]);

  // ---- AI Recognition ----

  const handleAiRecognize = useCallback(async () => {
    if (!selectedPlan?.aps_urn || objects.length === 0) return;
    dispatch({ type: 'SET_STATUS', key: 'aiStatus', status: 'loading' });
    try {
      const suggestions = await api.runAiRecognition(selectedPlan.aps_urn, objects);
      setAiSuggestions(suggestions);

      const suggestionMap = new Map(suggestions.map(s => [s.objectId, s]));
      setObjects(prev => prev.map(o => {
        const s = suggestionMap.get(o.id);
        if (s) {
          return {
            ...o,
            aiStatus: s.confidence >= 0.7 ? 'recognized' as const : s.confidence >= 0.4 ? 'needs_review' as const : 'unknown' as const,
            aiConfidence: s.confidence,
            aiSuggestedClass: s.suggestedClass,
            aiSuggestedBoqName: s.suggestedBoqItem,
          };
        }
        return o;
      }));

      dispatch({ type: 'SET_STATUS', key: 'aiStatus', status: 'success' });
      dispatch({ type: 'SET_RIGHT_TAB', tab: 'ai' });
      notify(`AI rozpoznalo ${suggestions.length} obiektow`);
    } catch (err: any) {
      dispatch({ type: 'SET_STATUS', key: 'aiStatus', status: 'error' });
      setErrors(prev => [...prev, {
        id: `err-${Date.now()}`, type: 'ai_failure', message: err.message,
        severity: 'error', retryable: true, timestamp: new Date().toISOString(),
      }]);
      notify(err.message || 'Blad AI', 'error');
    }
  }, [selectedPlan, objects, notify]);

  // ---- Generate BOQ ----

  const handleGenerateBoq = useCallback(async () => {
    if (objects.length === 0) return;
    dispatch({ type: 'SET_STATUS', key: 'boqStatus', status: 'loading' });
    try {
      const rows = await api.generateBoq(objects, rules, aiSuggestions);
      setBoqRows(rows);

      const objBoqMap = new Map<string, string>();
      for (const row of rows) {
        for (const oid of row.sourceObjectIds) {
          objBoqMap.set(oid, row.id);
        }
      }
      setObjects(prev => prev.map(o => ({
        ...o,
        boqRowId: objBoqMap.get(o.id) || o.boqRowId,
      })));

      dispatch({ type: 'SET_STATUS', key: 'boqStatus', status: 'success' });
      dispatch({ type: 'SET_RIGHT_TAB', tab: 'boq' });
      notify(`Wygenerowano ${rows.length} pozycji BOQ`);
    } catch (err: any) {
      dispatch({ type: 'SET_STATUS', key: 'boqStatus', status: 'error' });
      notify(err.message || 'Blad generowania BOQ', 'error');
    }
  }, [objects, rules, aiSuggestions, notify]);

  const handleGenerateBoqAi = useCallback(async () => {
    if (!selectedPlan?.aps_urn || objects.length === 0) return;
    dispatch({ type: 'SET_STATUS', key: 'boqStatus', status: 'loading' });
    try {
      const rows = await api.generateBoqAi(selectedPlan.aps_urn, objects);
      setBoqRows(rows);
      dispatch({ type: 'SET_STATUS', key: 'boqStatus', status: 'success' });
      dispatch({ type: 'SET_RIGHT_TAB', tab: 'boq' });
      notify(`AI wygenerowalo ${rows.length} pozycji BOQ`);
    } catch (err: any) {
      dispatch({ type: 'SET_STATUS', key: 'boqStatus', status: 'error' });
      notify(err.message || 'Blad AI BOQ', 'error');
    }
  }, [selectedPlan, objects, notify]);

  // ---- Object/BOQ Selection Sync ----

  const handleSelectObject = useCallback((id: string) => {
    dispatch({ type: 'SELECT_OBJECT_AND_SHOW_PROPS', id });
    // Highlight in APS viewer
    const obj = objects.find(o => o.id === id);
    if (obj?.dbId) setApsHighlightDbIds([obj.dbId]);
  }, [objects]);

  const handleSelectBoqRow = useCallback((rowId: string) => {
    const row = boqRows.find(r => r.id === rowId);
    if (row) {
      dispatch({ type: 'SELECT_BOQ_ROW_AND_HIGHLIGHT', rowId, sourceObjectIds: row.sourceObjectIds });
      // Highlight source objects in APS viewer
      const dbIds = row.sourceObjectIds
        .map(oid => objects.find(o => o.id === oid)?.dbId)
        .filter((d): d is number => d != null);
      if (dbIds.length > 0) setApsHighlightDbIds(dbIds);
    }
  }, [boqRows, objects]);

  const handleHighlightObjects = useCallback((ids: string[]) => {
    dispatch({ type: 'SET_SELECTED_OBJECTS', ids });
    const dbIds = ids
      .map(id => objects.find(o => o.id === id)?.dbId)
      .filter((d): d is number => d != null);
    if (dbIds.length > 0) setApsHighlightDbIds(dbIds);
  }, [objects]);

  // ---- APS Viewer selection → workspace ----

  const handleApsObjectSelected = useCallback((obj: SelectedObjectInfo | null) => {
    if (!obj) {
      dispatch({ type: 'SET_SELECTED_OBJECTS', ids: [] });
      return;
    }
    // Find matching workspace object by dbId
    const wsObj = objects.find(o => o.dbId === obj.dbId);
    if (wsObj) {
      dispatch({ type: 'SELECT_OBJECT_AND_SHOW_PROPS', id: wsObj.id });
    } else {
      // Create a temporary display in properties panel
      dispatch({ type: 'SET_RIGHT_TAB', tab: 'properties' });
    }
  }, [objects]);

  // ---- Rules ----

  const handleSaveRule = useCallback((rule: MappingRule) => {
    setRules(prev => {
      const idx = prev.findIndex(r => r.id === rule.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = rule; return next; }
      return [...prev, rule];
    });
    dispatch({ type: 'CLOSE_RULE_EDITOR' });
  }, []);

  const handleDeleteRule = useCallback((ruleId: string) => {
    setRules(prev => prev.filter(r => r.id !== ruleId));
  }, []);

  const handleToggleRule = useCallback((ruleId: string) => {
    setRules(prev => prev.map(r => r.id === ruleId ? { ...r, active: !r.active } : r));
  }, []);

  // ---- BOQ actions ----

  const handleApproveBoqRow = useCallback((rowId: string) => {
    setBoqRows(prev => prev.map(r => r.id === rowId ? { ...r, status: 'approved' } : r));
  }, []);

  const handleRejectBoqRow = useCallback((rowId: string) => {
    setBoqRows(prev => prev.map(r => r.id === rowId ? { ...r, status: 'rejected' } : r));
  }, []);

  // ---- AI actions ----

  const handleApplyAiSuggestion = useCallback((suggestionId: string, mode: 'single' | 'similar') => {
    setAiSuggestions(prev => prev.map(s =>
      s.id === suggestionId ? { ...s, status: 'accepted' as const } : s
    ));
    api.applyAiSuggestion(suggestionId, mode);
  }, []);

  const handleRejectAiSuggestion = useCallback((suggestionId: string) => {
    setAiSuggestions(prev => prev.map(s =>
      s.id === suggestionId ? { ...s, status: 'rejected' as const } : s
    ));
  }, []);

  // ---- Compare ----

  const handleCompare = useCallback(async () => {
    if (!selectedPlan) return;
    dispatch({ type: 'OPEN_COMPARE' });
    dispatch({ type: 'SET_RIGHT_TAB', tab: 'compare' });

    // Load other versions of this file for comparison
    try {
      const { data } = await supabase.from('plans').select('*')
        .eq('project_id', selectedPlan.project_id)
        .eq('component_id', selectedPlan.component_id)
        .neq('id', selectedPlan.id)
        .order('version', { ascending: false })
        .limit(20);
      if (data) setCompareVersionList(data);
    } catch {
      // ok
    }

    if (objects.length === 0) {
      notify('Najpierw wykonaj analize pliku, potem porownaj');
      return;
    }
    notify('Wybierz wersje do porownania w panelu po prawej');
  }, [selectedPlan, objects, notify]);

  const handleRunCompare = useCallback(async (versionId: string) => {
    if (!selectedPlan?.aps_urn) return;
    const otherPlan = compareVersionList.find(p => p.id === versionId);
    if (!otherPlan?.aps_urn) { notify('Druga wersja nie jest skonwertowana', 'error'); return; }

    dispatch({ type: 'SET_STATUS', key: 'compareStatus', status: 'loading' });
    try {
      const otherResult = await api.analyzeFile(otherPlan.aps_urn);
      const result = await api.compareVersions(objects, otherResult.objects);
      setCompareResult(result);
      dispatch({ type: 'SET_STATUS', key: 'compareStatus', status: 'success' });
      dispatch({ type: 'SET_RIGHT_TAB', tab: 'compare' });
      notify(`Porownanie: +${result.addedObjects.length} -${result.removedObjects.length} ~${result.changedObjects.length}`);
    } catch (err: any) {
      dispatch({ type: 'SET_STATUS', key: 'compareStatus', status: 'error' });
      notify(err.message || 'Blad porownania', 'error');
    }
  }, [selectedPlan, objects, compareVersionList, notify]);

  // ---- Version History ----

  const handleHistory = useCallback(async () => {
    if (!selectedPlan) return;
    try {
      const { data } = await supabase.from('plans').select('*')
        .eq('project_id', selectedPlan.project_id)
        .eq('component_id', selectedPlan.component_id)
        .order('version', { ascending: false })
        .limit(50);
      if (data) setVersionHistory(data);
    } catch {
      // ignore
    }
    setShowVersionHistory(true);
  }, [selectedPlan]);

  const handleSwitchVersion = useCallback((plan: PlanRecord) => {
    setSelectedPlan(plan);
    setShowVersionHistory(false);
    notify(`Przelaczono na wersje ${plan.version}`);
  }, [notify]);

  // ---- Export ----

  const handleExport = useCallback(() => {
    if (boqRows.length > 0) api.exportBoqCsv(boqRows);
  }, [boqRows]);

  // ---- Back to projects ----

  const handleBackToProjects = useCallback(() => {
    setSelectedProject(null);
    setSelectedPlan(null);
    setFolders([]);
    setAllPlans([]);
    dispatch({ type: 'RESET_WORKSPACE' });
    // Re-expand portal sidebar
    window.dispatchEvent(new Event('sidebar-expand'));
  }, []);

  // ---- Snapshot ----

  const handleSnapshot = useCallback(() => {
    // Start area selection mode instead of capturing full screen
    setIsSelectingScreenshotArea(true);
    setScreenshotStart(null);
    setScreenshotEnd(null);
    notify('Zaznacz obszar do zrzutu ekranu');
  }, [notify]);

  const captureScreenshotArea = useCallback(() => {
    if (!screenshotStart || !screenshotEnd) return;
    const x = Math.min(screenshotStart.x, screenshotEnd.x);
    const y = Math.min(screenshotStart.y, screenshotEnd.y);
    const w = Math.abs(screenshotEnd.x - screenshotStart.x);
    const h = Math.abs(screenshotEnd.y - screenshotStart.y);
    if (w < 10 || h < 10) { setIsSelectingScreenshotArea(false); return; }

    // Create a canvas to capture the selected area
    const canvas = document.createElement('canvas');
    canvas.width = w * 2; // retina
    canvas.height = h * 2;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(2, 2);

    // Try PDF canvas first
    const srcCanvas = pdfCanvasRef.current;
    if (srcCanvas && fileFormat === 'pdf') {
      const scaleX = srcCanvas.width / (parseFloat(srcCanvas.style.width) || srcCanvas.width);
      const scaleY = srcCanvas.height / (parseFloat(srcCanvas.style.height) || srcCanvas.height);
      ctx.drawImage(srcCanvas, x * scaleX, y * scaleY, w * scaleX, h * scaleY, 0, 0, w, h);
    }

    // Draw SVG annotations on top
    const svg = svgOverlayRef.current;
    if (svg) {
      const svgClone = svg.cloneNode(true) as SVGSVGElement;
      svgClone.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
      svgClone.setAttribute('width', String(w));
      svgClone.setAttribute('height', String(h));
      const svgStr = new XMLSerializer().serializeToString(svgClone);
      const img = new Image();
      const blob = new Blob([svgStr], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        const link = document.createElement('a');
        link.download = `screenshot_${activeFile?.name || 'plan'}_${Date.now()}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
        notify('Zrzut ekranu zapisany');
      };
      img.src = url;
    } else {
      const link = document.createElement('a');
      link.download = `screenshot_${activeFile?.name || 'plan'}_${Date.now()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      notify('Zrzut ekranu zapisany');
    }

    setIsSelectingScreenshotArea(false);
    setScreenshotStart(null);
    setScreenshotEnd(null);
  }, [screenshotStart, screenshotEnd, fileFormat, activeFile, notify]);

  // ---- Scale Calibration ----

  const handleCalibrateScale = useCallback(() => {
    setIsCalibrating(true);
    setCalibrationPoints([]);
    notify('Kliknij dwa punkty o znanej odleglosci na rysunku');
  }, [notify]);

  const handleCalibrationClick = useCallback((pt: DrawPoint) => {
    if (!isCalibrating) return;
    const pts = [...calibrationPoints, pt];
    setCalibrationPoints(pts);
    if (pts.length === 2) {
      const pixelDist = Math.sqrt((pts[1].x - pts[0].x) ** 2 + (pts[1].y - pts[0].y) ** 2);
      setCalibrationInput({ pixelDist, show: true });
    }
  }, [isCalibrating, calibrationPoints]);

  const handleCalibrationSubmit = useCallback((realMm: number) => {
    if (calibrationInput.pixelDist <= 0 || realMm <= 0) return;
    const scaleRatio = realMm / calibrationInput.pixelDist;
    if (selectedPlan) {
      supabase.from('plans').update({ scale_ratio: scaleRatio }).eq('id', selectedPlan.id)
        .then(() => {
          setSelectedPlan(prev => prev ? { ...prev, scale_ratio: scaleRatio } : prev);
          notify(`Skala skalibrowana: 1px = ${scaleRatio.toFixed(3)} mm`);
        });
    }
    setIsCalibrating(false);
    setCalibrationPoints([]);
    setCalibrationInput({ pixelDist: 0, show: false });
  }, [calibrationInput, selectedPlan, notify]);

  // ---- Photo Upload Handler ----

  const handlePhotoUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !selectedPlan || !selectedProject) return;
    if (!pendingPhotoPoint && !pendingPhotoPinId) return;

    const authorName = `${currentUser?.first_name || ''} ${currentUser?.last_name || ''}`.trim() || 'User';

    try {
      const newPhotos: PhotoItem[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const safeName = sanitizeFileName(file.name);
        const path = `plan-photos/${selectedProject.id}/${Date.now()}_${i}_${safeName}`;
        const { error: uploadErr } = await supabase.storage.from('plan-files').upload(path, file);
        if (uploadErr) throw uploadErr;
        const { data: urlData } = supabase.storage.from('plan-files').getPublicUrl(path);

        const photoItem: PhotoItem = {
          id: `ph-${Date.now()}-${i}`,
          url: urlData.publicUrl,
          label: file.name,
          authorName,
          createdAt: new Date().toISOString(),
        };
        newPhotos.push(photoItem);

        // Persist
        await supabase.from('plan_photos').insert({
          plan_id: selectedPlan.id,
          position_x: pendingPhotoPoint?.x ?? 0,
          position_y: pendingPhotoPoint?.y ?? 0,
          photo_url: urlData.publicUrl,
          label: file.name,
          created_by: currentUser?.id,
        });
      }

      if (pendingPhotoPinId) {
        // Add photos to existing pin
        setPhotoPins(prev => prev.map(pin =>
          pin.id === pendingPhotoPinId
            ? { ...pin, photos: [...pin.photos, ...newPhotos] }
            : pin
        ));
      } else if (pendingPhotoPoint) {
        // Create new pin
        const newPin: PhotoPin = {
          id: `pin-${Date.now()}`,
          x: pendingPhotoPoint.x,
          y: pendingPhotoPoint.y,
          photos: newPhotos,
        };
        setPhotoPins(prev => [...prev, newPin]);
      }

      dispatch({ type: 'SET_ACTIVE_TOOL', tool: 'select' });
      notify(`${newPhotos.length > 1 ? newPhotos.length + ' zdjec dodanych' : 'Zdjecie dodane'}`);
    } catch (err: any) {
      notify(err.message || 'Blad przesylania zdjecia', 'error');
    }

    setPendingPhotoPoint(null);
    setPendingPhotoPinId(null);
    if (photoInputRef.current) photoInputRef.current.value = '';
  }, [pendingPhotoPoint, pendingPhotoPinId, selectedPlan, selectedProject, currentUser, notify]);

  // ---- Analysis Modal Handlers ----

  const handlePdfAnalysisComplete = useCallback((analysis: DxfAnalysis) => {
    setShowPdfAnalysis(false);
    notify(`Analiza PDF zakonczona: ${analysis.totalBlocks} blokow, ${analysis.totalEntities} elementow`);
  }, [notify]);

  const handleDxfAnalysisComplete = useCallback((analysis: DxfAnalysis) => {
    setShowDxfAnalysis(false);
    notify(`Analiza DXF zakonczona: ${analysis.totalBlocks} blokow, ${analysis.totalEntities} elementow`);
  }, [notify]);

  // ---- Sidebar conversion ----

  const sidebarFolders = folders.map(f => ({
    id: f.id,
    name: f.name,
    files: f.plans.map(p => ({
      id: p.id,
      name: p.name,
      originalFilename: p.original_filename,
      format: getFileFormat(p.original_filename || p.name, p.mime_type),
      status: (p.aps_urn ? 'converted' : 'uploaded') as FileStatus,
      version: p.version,
      folderId: f.id,
      hasAnalysis: false,
      hasAi: false,
      hasBoq: false,
      fileUrl: p.file_url,
      fileSize: p.file_size,
      apsUrn: p.aps_urn,
    })),
    isExpanded: f.isExpanded,
  }));

  // ---- File actions ----

  const handleFileAction = useCallback(async (fileId: string, action: string) => {
    const plan = allPlans.find(p => p.id === fileId);
    if (!plan) return;

    switch (action) {
      case 'open':
        handleSelectFile(fileId);
        break;
      case 'delete':
        if (confirm('Czy na pewno chcesz usunac ten plik?')) {
          await supabase.from('plans').update({ deleted_at: new Date().toISOString() }).eq('id', fileId);
          loadPlansData();
          if (selectedPlan?.id === fileId) {
            setSelectedPlan(null);
            dispatch({ type: 'RESET_WORKSPACE' });
          }
          notify('Plik zostal usuniety');
        }
        break;
      case 'compare':
        dispatch({ type: 'OPEN_COMPARE' });
        break;
      case 'reanalyze':
        handleSelectFile(fileId);
        setTimeout(() => handleAnalyze(), 500);
        break;
    }
  }, [allPlans, selectedPlan, handleSelectFile, handleAnalyze, notify]);

  const handleToggleFolder = useCallback((folderId: string) => {
    setFolders(prev => prev.map(f =>
      f.id === folderId ? { ...f, isExpanded: !f.isExpanded } : f
    ));
  }, []);

  const handleCreateFolder = useCallback(async (name: string) => {
    if (!selectedProject || !currentUser) return;
    await supabase.from('plan_folders').insert({
      project_id: selectedProject.id,
      name,
      sort_order: folders.length,
      created_by_id: currentUser.id,
    });
    loadPlansData();
  }, [selectedProject, currentUser, folders.length]);

  const handleRenameFolder = useCallback(async (folderId: string, newName: string) => {
    if (folderId === '__default__') return;
    await supabase.from('plan_folders').update({ name: newName }).eq('id', folderId);
    setFolders(prev => prev.map(f => f.id === folderId ? { ...f, name: newName } : f));
  }, []);

  const handleDeleteFolder = useCallback(async (folderId: string) => {
    if (folderId === '__default__') return;
    // Move files from this folder to default, then soft-delete the folder
    await supabase.from('plans').update({ folder_id: null }).eq('folder_id', folderId);
    await supabase.from('plan_folders').update({ deleted_at: new Date().toISOString() }).eq('id', folderId);
    loadPlansData();
    notify('Folder usuniety');
  }, [notify]);

  const handleCreateSubfolder = useCallback(async (parentFolderId: string, name: string) => {
    if (!selectedProject || !currentUser) return;
    await supabase.from('plan_folders').insert({
      project_id: selectedProject.id,
      parent_id: parentFolderId === '__default__' ? null : parentFolderId,
      name,
      sort_order: folders.length,
      created_by_id: currentUser.id,
    });
    loadPlansData();
  }, [selectedProject, currentUser, folders.length]);

  const handleMoveFileToFolder = useCallback(async (fileId: string, folderId: string) => {
    const realFolderId = folderId === '__default__' ? null : folderId;
    await supabase.from('plans').update({ folder_id: realFolderId }).eq('id', fileId);
    loadPlansData();
    notify('Plik przeniesiony');
  }, [notify]);

  const handleReorderFile = useCallback(async (fileId: string, targetFileId: string, position: 'before' | 'after') => {
    // Get current folder files, find positions, reorder
    const folder = sidebarFolders.find(f => f.files.some(fl => fl.id === fileId));
    if (!folder) return;
    const files = [...folder.files];
    const fromIdx = files.findIndex(f => f.id === fileId);
    const toIdx = files.findIndex(f => f.id === targetFileId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = files.splice(fromIdx, 1);
    const insertIdx = position === 'before' ? (toIdx > fromIdx ? toIdx - 1 : toIdx) : (toIdx > fromIdx ? toIdx : toIdx + 1);
    files.splice(insertIdx, 0, moved);
    // Update sort_order in DB
    for (let i = 0; i < files.length; i++) {
      await supabase.from('plans').update({ sort_order: i }).eq('id', files[i].id);
    }
    loadPlansData();
    notify('Kolejnosc zmieniona');
  }, [sidebarFolders, notify]);

  // ---- URN ready (from APS viewer) ----

  const handleUrnReady = useCallback(async (urn: string) => {
    if (!selectedPlan) return;
    await supabase.from('plans').update({ aps_urn: urn }).eq('id', selectedPlan.id);
    setSelectedPlan(prev => prev ? { ...prev, aps_urn: urn } : prev);
    dispatch({ type: 'SET_STATUS', key: 'conversionStatus', status: 'success' });
    notify('Plik skonwertowany i gotowy');
  }, [selectedPlan, notify]);

  // ---- Open in APS viewer ----

  const handleOpenInAps = useCallback(async () => {
    if (!selectedPlan) return;
    if (selectedPlan.aps_urn) return;

    try {
      const response = await fetch(selectedPlan.file_url);
      if (!response.ok) throw new Error('Nie udalo sie pobrac pliku');
      const ab = await response.arrayBuffer();
      const bytes = new Uint8Array(ab);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      }
      setApsFileBase64(btoa(binary));
    } catch (err: any) {
      notify(err.message, 'error');
    }
  }, [selectedPlan, notify]);

  // ========== SVG ANNOTATION DRAWING ==========

  const getOverlayCoords = useCallback((e: React.MouseEvent<SVGSVGElement>): DrawPoint | null => {
    const svg = svgOverlayRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }, []);

  const isAnnotationTool = (tool: BottomTool): boolean => {
    return ['pen', 'highlighter', 'rectangle', 'ellipse', 'arrow', 'line',
      'text-annotation', 'issue-cloud', 'callout', 'measure-length',
      'measure-area', 'measure-polyline', 'count-marker', 'erase', 'comment'].includes(tool);
  };

  // Helper: find nearest element at point for eraser
  const findNearestElement = useCallback((pt: DrawPoint, threshold: number = 30): { type: 'annotation' | 'measurement' | 'comment' | 'photo' | 'count'; id: string } | null => {
    let bestDist = threshold;
    let best: { type: 'annotation' | 'measurement' | 'comment' | 'photo' | 'count'; id: string } | null = null;

    // Check annotations
    for (const ann of annotations) {
      const geom = ann.geometry;
      if (!geom?.points?.length) continue;
      for (const p of geom.points) {
        const d = Math.sqrt((p.x - pt.x) ** 2 + (p.y - pt.y) ** 2);
        if (d < bestDist) { bestDist = d; best = { type: 'annotation', id: ann.id }; }
      }
      // For shapes (rect, ellipse, cloud), also check edges
      if (['rectangle', 'ellipse', 'issue-cloud'].includes(ann.type) && geom.points.length >= 2) {
        const [p0, p1] = geom.points;
        const cx = (p0.x + p1.x) / 2, cy = (p0.y + p1.y) / 2;
        const hw = Math.abs(p1.x - p0.x) / 2, hh = Math.abs(p1.y - p0.y) / 2;
        // Check if near any edge
        const dx = Math.abs(pt.x - cx), dy = Math.abs(pt.y - cy);
        if ((Math.abs(dx - hw) < threshold && dy <= hh + threshold) || (Math.abs(dy - hh) < threshold && dx <= hw + threshold)) {
          const d = Math.min(Math.abs(dx - hw), Math.abs(dy - hh));
          if (d < bestDist) { bestDist = d; best = { type: 'annotation', id: ann.id }; }
        }
      }
      // For lines with many points, check segments
      if (geom.points.length >= 2 && ['freehand', 'line', 'arrow'].includes(ann.type)) {
        for (let i = 0; i < geom.points.length - 1; i++) {
          const a = geom.points[i], b = geom.points[i + 1];
          const d = distToSegment(pt, a, b);
          if (d < bestDist) { bestDist = d; best = { type: 'annotation', id: ann.id }; }
        }
      }
    }
    // Check measurements
    for (const m of measurements) {
      if (!m.points?.length) continue;
      for (let i = 0; i < m.points.length - 1; i++) {
        const d = distToSegment(pt, m.points[i], m.points[i + 1]);
        if (d < bestDist) { bestDist = d; best = { type: 'measurement', id: m.id }; }
      }
      for (const p of m.points) {
        const d = Math.sqrt((p.x - pt.x) ** 2 + (p.y - pt.y) ** 2);
        if (d < bestDist) { bestDist = d; best = { type: 'measurement', id: m.id }; }
      }
    }
    // Check comments
    for (const c of comments) {
      if (c.positionX == null || c.positionY == null) continue;
      const d = Math.sqrt((c.positionX - pt.x) ** 2 + (c.positionY - pt.y) ** 2);
      if (d < bestDist) { bestDist = d; best = { type: 'comment', id: c.id }; }
    }
    // Check photo pins
    for (const pin of photoPins) {
      const d = Math.sqrt((pin.x - pt.x) ** 2 + (pin.y - pt.y) ** 2);
      if (d < bestDist) { bestDist = d; best = { type: 'photo', id: pin.id }; }
    }
    // Check count markers
    for (let i = 0; i < countMarkers.length; i++) {
      const p = countMarkers[i];
      const d = Math.sqrt((p.x - pt.x) ** 2 + (p.y - pt.y) ** 2);
      if (d < bestDist) { bestDist = d; best = { type: 'count', id: `count-${i}` }; }
    }
    return best;
  }, [annotations, measurements, comments, photoPins, countMarkers]);

  // Distance from point to line segment
  const distToSegment = (pt: DrawPoint, a: DrawPoint, b: DrawPoint): number => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.sqrt((pt.x - a.x) ** 2 + (pt.y - a.y) ** 2);
    let t = ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return Math.sqrt((pt.x - (a.x + t * dx)) ** 2 + (pt.y - (a.y + t * dy)) ** 2);
  };

  const handleSvgMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const pt = getOverlayCoords(e);
    if (!pt) return;

    // Screenshot area selection mode
    if (isSelectingScreenshotArea) {
      setScreenshotStart({ x: pt.x, y: pt.y });
      setScreenshotEnd(null);
      return;
    }

    // Scale calibration mode intercepts clicks
    if (isCalibrating) {
      handleCalibrationClick(pt);
      return;
    }

    // Pan tool: start panning by scrolling the scrollable parent
    if (ws.activeTool === 'pan') {
      // Find the actual scrollable parent of the SVG
      let scrollEl: HTMLElement | null = svgOverlayRef.current?.parentElement?.parentElement || viewerContainerRef.current;
      while (scrollEl && scrollEl.scrollHeight <= scrollEl.clientHeight && scrollEl.scrollWidth <= scrollEl.clientWidth) {
        scrollEl = scrollEl.parentElement;
      }
      if (!scrollEl) scrollEl = viewerContainerRef.current;
      if (scrollEl) {
        setIsPanning(true);
        setPanStart({ x: e.clientX, y: e.clientY, scrollLeft: scrollEl.scrollLeft, scrollTop: scrollEl.scrollTop });
        (svgOverlayRef.current as any).__panScrollEl = scrollEl;
      }
      e.preventDefault();
      return;
    }

    // Select tool: start box selection
    if (ws.activeTool === 'select') {
      // First check if clicking on a comment pin or photo pin
      const clickedComment = comments.find(c =>
        c.positionX != null && c.positionY != null &&
        Math.sqrt((c.positionX! - pt.x) ** 2 + (c.positionY! - pt.y) ** 2) < 20
      );
      if (clickedComment) {
        setCommentModal({ mode: 'view', commentId: clickedComment.id });
        return;
      }
      const clickedPin = photoPins.find(p => Math.sqrt((p.x - pt.x) ** 2 + (p.y - pt.y) ** 2) < 20);
      if (clickedPin) {
        setShowPhotoGallery({ pinId: clickedPin.id });
        setGalleryIndex(0);
        return;
      }
      setBoxSelectStart({ x: pt.x, y: pt.y });
      setBoxSelectEnd(null);
      return;
    }

    if (!isAnnotationTool(ws.activeTool) && ws.activeTool !== 'snapshot' && ws.activeTool !== 'camera') return;

    if (ws.activeTool === 'snapshot') {
      handleSnapshot();
      return;
    }

    if (ws.activeTool === 'text-annotation' || ws.activeTool === 'callout') {
      setTextInput({ x: pt.x, y: pt.y, text: '', toolType: ws.activeTool === 'callout' ? 'callout' : 'text' });
      return;
    }

    if (ws.activeTool === 'count-marker') {
      setCountMarkers(prev => [...prev, pt]);
      return;
    }

    if (ws.activeTool === 'comment') {
      // Check if clicking on existing comment pin
      const clickedComment = comments.find(c =>
        c.positionX != null && c.positionY != null &&
        Math.sqrt((c.positionX! - pt.x) ** 2 + (c.positionY! - pt.y) ** 2) < 20
      );
      if (clickedComment) {
        setCommentModal({ mode: 'view', commentId: clickedComment.id });
      } else {
        setCommentModal({ mode: 'create', x: pt.x, y: pt.y });
        setCommentText('');
      }
      return;
    }

    if (ws.activeTool === 'camera') {
      // Check if clicking on existing photo pin
      const clickedPin = photoPins.find(p =>
        Math.sqrt((p.x - pt.x) ** 2 + (p.y - pt.y) ** 2) < 20
      );
      if (clickedPin) {
        setShowPhotoGallery({ pinId: clickedPin.id });
        setGalleryIndex(0);
      } else {
        setPendingPhotoPoint(pt);
        setPendingPhotoPinId(null);
        setShowPhotoModal(true);
      }
      return;
    }

    if (ws.activeTool === 'erase') {
      const target = findNearestElement(pt);
      if (!target) return;
      if (target.type === 'annotation') {
        setAnnotations(prev => prev.filter(a => a.id !== target.id));
      } else if (target.type === 'measurement') {
        setMeasurements(prev => prev.filter(m => m.id !== target.id));
      } else if (target.type === 'comment') {
        setComments(prev => prev.filter(c => c.id !== target.id));
        if (activeFile?.id) supabase.from('plan_comments').delete().eq('id', target.id).then(() => {});
      } else if (target.type === 'photo') {
        setPhotoPins(prev => prev.filter(p => p.id !== target.id));
      } else if (target.type === 'count') {
        const idx = parseInt(target.id.replace('count-', ''));
        setCountMarkers(prev => prev.filter((_, i) => i !== idx));
      }
      setEraserHoverId(null);
      return;
    }

    // Polyline / Area measurement — click-by-click mode
    if (ws.activeTool === 'measure-length' || ws.activeTool === 'measure-area') {
      if (isDrawing) {
        // Add next point
        setDrawPoints(prev => [...prev, pt]);
      } else {
        // Start new polyline
        setIsDrawing(true);
        setDrawPoints([pt]);
      }
      return;
    }

    // Issue-cloud: drag-based (start + end)
    setIsDrawing(true);
    setDrawPoints([pt]);
  }, [ws.activeTool, getOverlayCoords, currentUser, activeFile, comments, photoPins, findNearestElement, isDrawing, isSelectingScreenshotArea, isCalibrating]);

  // Track current mouse position for polyline cursor line
  const [cursorPt, setCursorPt] = useState<DrawPoint | null>(null);

  const handleSvgMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    // Screenshot area selection
    if (isSelectingScreenshotArea && screenshotStart) {
      const pt = getOverlayCoords(e);
      if (pt) setScreenshotEnd({ x: pt.x, y: pt.y });
      return;
    }

    // Pan tool: scroll container
    if (isPanning && panStart) {
      const scrollEl = (svgOverlayRef.current as any)?.__panScrollEl || viewerContainerRef.current;
      if (scrollEl) {
        scrollEl.scrollLeft = panStart.scrollLeft - (e.clientX - panStart.x);
        scrollEl.scrollTop = panStart.scrollTop - (e.clientY - panStart.y);
      }
      e.preventDefault();
      return;
    }

    const pt = getOverlayCoords(e);
    if (!pt) return;

    // Eraser hover highlight
    if (ws.activeTool === 'erase') {
      const target = findNearestElement(pt);
      setEraserHoverId(target ? target.id : null);
      return;
    }

    // Track cursor for polyline preview
    if ((ws.activeTool === 'measure-length' || ws.activeTool === 'measure-area') && isDrawing) {
      setCursorPt(pt);
      return;
    }

    // Box selection drag
    if (ws.activeTool === 'select' && boxSelectStart) {
      setBoxSelectEnd({ x: pt.x, y: pt.y });
      return;
    }

    if (!isDrawing) return;

    if (ws.activeTool === 'pen' || ws.activeTool === 'highlighter') {
      // Freehand tools — accumulate points
      setDrawPoints(prev => [...prev, pt]);
    } else {
      // For shapes, only track start + current
      setDrawPoints(prev => [prev[0], pt]);
    }
  }, [isDrawing, ws.activeTool, getOverlayCoords, boxSelectStart, isPanning, panStart, isSelectingScreenshotArea, screenshotStart, findNearestElement]);

  // Finalize polyline/area measurement (called from Enter key or double-click)
  const finalizeMeasurement = useCallback(() => {
    if (drawPoints.length < 2) { setIsDrawing(false); setDrawPoints([]); setCursorPt(null); return; }
    const tool = ws.activeTool;
    const scaleFactor = activeFile?.scale_ratio || 1;
    let realValue: number;
    let unit: string;
    let measureType: 'length' | 'area';
    const pts = [...drawPoints];

    if (tool === 'measure-area') {
      if (pts.length >= 3) pts.push(pts[0]);
      let pixelArea = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        pixelArea += pts[i].x * pts[i + 1].y - pts[i + 1].x * pts[i].y;
      }
      pixelArea = Math.abs(pixelArea) / 2;
      realValue = Math.round(pixelArea * scaleFactor * scaleFactor) / 100;
      unit = 'm²';
      measureType = 'area';
    } else {
      let totalPixelDist = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        totalPixelDist += Math.sqrt((pts[i + 1].x - pts[i].x) ** 2 + (pts[i + 1].y - pts[i].y) ** 2);
      }
      realValue = Math.round(totalPixelDist * scaleFactor * 100) / 100;
      unit = 'mm';
      measureType = 'length';
    }

    const measurement: MeasurementItem = {
      id: `meas-${Date.now()}`,
      type: measureType,
      value: realValue,
      unit,
      points: pts,
      createdBy: currentUser?.id || '',
      createdAt: new Date().toISOString(),
    };
    setMeasurements(prev => [...prev, measurement]);
    if (activeFile?.id) api.saveMeasurement(measurement, activeFile.id);
    setIsDrawing(false);
    setDrawPoints([]);
    setCursorPt(null);
  }, [drawPoints, ws.activeTool, activeFile, currentUser]);

  const handleSvgMouseUp = useCallback(() => {
    // Complete screenshot area selection
    if (isSelectingScreenshotArea && screenshotStart && screenshotEnd) {
      captureScreenshotArea();
      return;
    }
    if (isSelectingScreenshotArea) {
      setIsSelectingScreenshotArea(false);
      return;
    }

    // Complete pan
    if (isPanning) {
      setIsPanning(false);
      setPanStart(null);
      return;
    }

    // Complete box selection
    if (ws.activeTool === 'select' && boxSelectStart && boxSelectEnd) {
      const minX = Math.min(boxSelectStart.x, boxSelectEnd.x);
      const maxX = Math.max(boxSelectStart.x, boxSelectEnd.x);
      const minY = Math.min(boxSelectStart.y, boxSelectEnd.y);
      const maxY = Math.max(boxSelectStart.y, boxSelectEnd.y);
      const selectedIds = annotations
        .filter(a => {
          const pts = a.geometry?.points || [];
          return pts.some((p: DrawPoint) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY);
        })
        .map(a => a.id);
      if (selectedIds.length > 0) {
        dispatch({ type: 'SET_SELECTED_OBJECTS', ids: selectedIds });
      }
      setBoxSelectStart(null);
      setBoxSelectEnd(null);
      return;
    }
    setBoxSelectStart(null);
    setBoxSelectEnd(null);

    // Polyline/area measurement: don't finalize on mouseUp (they use click-by-click)
    if (ws.activeTool === 'measure-length' || ws.activeTool === 'measure-area') {
      return;
    }

    if (!isDrawing || drawPoints.length < 2) {
      setIsDrawing(false);
      setDrawPoints([]);
      return;
    }

    const tool = ws.activeTool;
    let annotationType: AnnotationItem['type'] = 'freehand';
    if (tool === 'rectangle') annotationType = 'rectangle';
    else if (tool === 'ellipse') annotationType = 'ellipse';
    else if (tool === 'arrow') annotationType = 'arrow';
    else if (tool === 'line') annotationType = 'line';
    else if (tool === 'highlighter') annotationType = 'freehand';
    else if (tool === 'issue-cloud') annotationType = 'issue-cloud';

    const annotation: AnnotationItem = {
      id: `ann-${Date.now()}`,
      type: annotationType,
      geometry: { points: [...drawPoints] },
      strokeColor: tool === 'highlighter' ? '#fbbf24' : strokeColor,
      strokeWidth: tool === 'highlighter' ? 12 : strokeWidth,
      createdBy: currentUser?.id || '',
      createdAt: new Date().toISOString(),
    };
    setAnnotations(prev => [...prev, annotation]);
    if (activeFile?.id) api.saveAnnotation(annotation, activeFile.id);

    setIsDrawing(false);
    setDrawPoints([]);
  }, [isDrawing, drawPoints, ws.activeTool, strokeColor, strokeWidth, currentUser, activeFile, boxSelectStart, boxSelectEnd, annotations, isPanning, isSelectingScreenshotArea, screenshotStart, screenshotEnd, captureScreenshotArea]);

  // ---- Text annotation submit ----
  const handleTextAnnotationSubmit = useCallback(() => {
    if (!textInput || !textInput.text.trim()) { setTextInput(null); return; }
    const annotation: AnnotationItem = {
      id: `ann-${Date.now()}`,
      type: textInput.toolType,
      geometry: { points: [{ x: textInput.x, y: textInput.y }] },
      text: textInput.text,
      strokeColor,
      strokeWidth,
      createdBy: currentUser?.id || '',
      createdAt: new Date().toISOString(),
    };
    setAnnotations(prev => [...prev, annotation]);
    setTextInput(null);
  }, [textInput, strokeColor, strokeWidth, currentUser]);

  // ---- Keyboard shortcuts ----

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      // Enter finalizes polyline/area measurement
      if (e.key === 'Enter' && isDrawing && (ws.activeTool === 'measure-length' || ws.activeTool === 'measure-area')) {
        finalizeMeasurement();
        return;
      }

      if (e.key === 'Escape') {
        // Cancel polyline drawing
        if (isDrawing && (ws.activeTool === 'measure-length' || ws.activeTool === 'measure-area')) {
          setIsDrawing(false);
          setDrawPoints([]);
          setCursorPt(null);
          return;
        }
        if (textInput) { setTextInput(null); return; }
        if (ws.isFullscreen) { dispatch({ type: 'TOGGLE_FULLSCREEN' }); return; }
        dispatch({ type: 'SET_ACTIVE_TOOL', tool: 'select' });
        return;
      }

      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        switch (e.key.toLowerCase()) {
          case 'v': dispatch({ type: 'SET_ACTIVE_TOOL', tool: 'select' }); break;
          case 'g': dispatch({ type: 'SET_ACTIVE_TOOL', tool: 'pan' }); break;
          case 'p': dispatch({ type: 'SET_ACTIVE_TOOL', tool: 'pen' }); break;
          case 'h': dispatch({ type: 'SET_ACTIVE_TOOL', tool: 'highlighter' }); break;
          case 'r': dispatch({ type: 'SET_ACTIVE_TOOL', tool: 'rectangle' }); break;
          case 'o': dispatch({ type: 'SET_ACTIVE_TOOL', tool: 'ellipse' }); break;
          case 'a': dispatch({ type: 'SET_ACTIVE_TOOL', tool: 'arrow' }); break;
          case 'l': dispatch({ type: 'SET_ACTIVE_TOOL', tool: 'line' }); break;
          case 't': dispatch({ type: 'SET_ACTIVE_TOOL', tool: 'text-annotation' }); break;
          case 'm': dispatch({ type: 'SET_ACTIVE_TOOL', tool: 'measure-length' }); break;
          case 'n': dispatch({ type: 'SET_ACTIVE_TOOL', tool: 'count-marker' }); break;
          case 'k': dispatch({ type: 'SET_ACTIVE_TOOL', tool: 'issue-cloud' }); break;
          case 'b': dispatch({ type: 'SET_ACTIVE_TOOL', tool: 'callout' }); break;
          case 'e': dispatch({ type: 'SET_ACTIVE_TOOL', tool: 'erase' }); break;
          case 'c': dispatch({ type: 'SET_ACTIVE_TOOL', tool: 'comment' }); break;
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [ws.isFullscreen, textInput, isDrawing, ws.activeTool, finalizeMeasurement]);

  // ---- SVG Overlay Rendering ----

  const renderSvgAnnotations = () => {
    const parts: React.ReactNode[] = [];

    // Existing annotations
    // Eraser highlight helper
    const isEraseHovered = (id: string) => ws.activeTool === 'erase' && eraserHoverId === id;

    for (const ann of annotations) {
      const pts = ann.geometry?.points as DrawPoint[] | undefined;
      if (!pts || pts.length === 0) continue;

      const key = ann.id;
      const sc = ann.strokeColor;
      const sw = ann.strokeWidth;
      const hovered = isEraseHovered(ann.id);
      const hoverFilter = hovered ? 'drop-shadow(0 0 6px rgba(239,68,68,0.8))' : undefined;
      const hoverOpacity = hovered ? 0.5 : undefined;

      switch (ann.type) {
        case 'freehand': {
          if (pts.length < 2) break;
          const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
          parts.push(
            <path key={key} d={d} stroke={hovered ? '#ef4444' : sc} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round"
              opacity={hoverOpacity ?? (sw > 8 ? 0.4 : 1)} style={{ filter: hoverFilter }} />
          );
          break;
        }
        case 'rectangle': {
          if (pts.length < 2) break;
          const x = Math.min(pts[0].x, pts[1].x);
          const y = Math.min(pts[0].y, pts[1].y);
          const w = Math.abs(pts[1].x - pts[0].x);
          const h = Math.abs(pts[1].y - pts[0].y);
          parts.push(<rect key={key} x={x} y={y} width={w} height={h} stroke={hovered ? '#ef4444' : sc} strokeWidth={sw} fill="none" opacity={hoverOpacity} style={{ filter: hoverFilter }} />);
          break;
        }
        case 'ellipse': {
          if (pts.length < 2) break;
          const cx = (pts[0].x + pts[1].x) / 2;
          const cy = (pts[0].y + pts[1].y) / 2;
          const rx = Math.abs(pts[1].x - pts[0].x) / 2;
          const ry = Math.abs(pts[1].y - pts[0].y) / 2;
          parts.push(<ellipse key={key} cx={cx} cy={cy} rx={rx} ry={ry} stroke={hovered ? '#ef4444' : sc} strokeWidth={sw} fill="none" opacity={hoverOpacity} style={{ filter: hoverFilter }} />);
          break;
        }
        case 'arrow':
        case 'line': {
          if (pts.length < 2) break;
          parts.push(
            <line key={key} x1={pts[0].x} y1={pts[0].y} x2={pts[1].x} y2={pts[1].y}
              stroke={hovered ? '#ef4444' : sc} strokeWidth={sw}
              markerEnd={ann.type === 'arrow' ? 'url(#arrowhead)' : undefined} opacity={hoverOpacity} style={{ filter: hoverFilter }} />
          );
          break;
        }
        case 'text':
        case 'callout': {
          parts.push(
            <g key={key} opacity={hoverOpacity} style={{ filter: hoverFilter }}>
              {ann.type === 'callout' && (
                <rect x={pts[0].x - 4} y={pts[0].y - 16} width={(ann.text?.length || 1) * 8 + 8} height={22}
                  rx={4} fill="white" stroke={hovered ? '#ef4444' : sc} strokeWidth={1} />
              )}
              <text x={pts[0].x} y={pts[0].y} fill={hovered ? '#ef4444' : sc} fontSize={14} fontFamily="sans-serif">
                {ann.text}
              </text>
            </g>
          );
          break;
        }
        case 'issue-cloud': {
          if (pts.length < 2) break;
          const x = Math.min(pts[0].x, pts[1].x);
          const y = Math.min(pts[0].y, pts[1].y);
          const w = Math.abs(pts[1].x - pts[0].x);
          const h = Math.abs(pts[1].y - pts[0].y);
          if (w < 5 || h < 5) break;
          // Cloud shape with scalloped edges — proper SVG path
          const numTop = Math.max(3, Math.round(w / 25));
          const numSide = Math.max(2, Math.round(h / 25));
          let d = `M ${x} ${y}`;
          // Top edge (left to right)
          const segW = w / numTop;
          for (let i = 0; i < numTop; i++) {
            const sx = x + segW * i;
            const ex = x + segW * (i + 1);
            const midX = (sx + ex) / 2;
            d += ` Q ${midX} ${y - segW * 0.4} ${ex} ${y}`;
          }
          // Right edge (top to bottom)
          const segH = h / numSide;
          for (let i = 0; i < numSide; i++) {
            const sy = y + segH * i;
            const ey = y + segH * (i + 1);
            const midY = (sy + ey) / 2;
            d += ` Q ${x + w + segH * 0.4} ${midY} ${x + w} ${ey}`;
          }
          // Bottom edge (right to left)
          for (let i = numTop - 1; i >= 0; i--) {
            const sx = x + segW * (i + 1);
            const ex = x + segW * i;
            const midX = (sx + ex) / 2;
            d += ` Q ${midX} ${y + h + segW * 0.4} ${ex} ${y + h}`;
          }
          // Left edge (bottom to top)
          for (let i = numSide - 1; i >= 0; i--) {
            const sy = y + segH * (i + 1);
            const ey = y + segH * i;
            const midY = (sy + ey) / 2;
            d += ` Q ${x - segH * 0.4} ${midY} ${x} ${ey}`;
          }
          d += ' Z';
          parts.push(<path key={key} d={d} stroke={hovered ? '#ef4444' : sc} strokeWidth={sw} fill="rgba(239,68,68,0.06)" opacity={hoverOpacity} style={{ filter: hoverFilter }} />);
          break;
        }
      }
    }

    // Measurements
    for (const m of measurements) {
      if (!m.points || m.points.length < 2) continue;
      const mHovered = isEraseHovered(m.id);
      const mColor = mHovered ? '#ef4444' : '#2563eb';
      const mFilter = mHovered ? 'drop-shadow(0 0 6px rgba(239,68,68,0.8))' : undefined;
      const pointStr = m.points.map(p => `${p.x},${p.y}`).join(' ');
      // Label at midpoint of first and last
      const p0 = m.points[0];
      const pLast = m.points[m.points.length - 1];
      const midX = (p0.x + pLast.x) / 2;
      const midY = (p0.y + pLast.y) / 2;
      // For area, show closing line
      const isClosed = m.type === 'area';
      parts.push(
        <g key={m.id} style={{ filter: mFilter }} opacity={mHovered ? 0.5 : 1}>
          <polyline points={pointStr} stroke={mColor} strokeWidth={2} fill={isClosed ? 'rgba(37,99,235,0.08)' : 'none'} strokeDasharray="6 3" />
          {m.points.map((p, i) => (
            <circle key={`${m.id}-pt${i}`} cx={p.x} cy={p.y} r={3} fill={mColor} />
          ))}
          <rect x={midX - 35} y={midY - 14} width={70} height={20} rx={4} fill="white" stroke={mColor} strokeWidth={1} />
          <text x={midX} y={midY + 2} textAnchor="middle" fontSize={11} fill={mColor} fontFamily="sans-serif" fontWeight="bold">
            {m.value} {m.unit}
          </text>
        </g>
      );
    }

    // Count markers
    countMarkers.forEach((pt, i) => {
      parts.push(
        <g key={`count-${i}`}>
          <circle cx={pt.x} cy={pt.y} r={12} fill="#2563eb" stroke="white" strokeWidth={2} />
          <text x={pt.x} y={pt.y + 4} textAnchor="middle" fontSize={10} fill="white" fontFamily="sans-serif" fontWeight="bold">
            {i + 1}
          </text>
        </g>
      );
    });

    // Comment pins
    for (const c of comments) {
      if (c.positionX == null || c.positionY == null) continue;
      const cHovered = isEraseHovered(c.id);
      parts.push(
        <g key={`cpin-${c.id}`} style={{ cursor: 'pointer', filter: cHovered ? 'drop-shadow(0 0 6px rgba(239,68,68,0.8))' : undefined }}
          opacity={cHovered ? 0.5 : 1}>
          <circle cx={c.positionX} cy={c.positionY} r={14}
            fill={cHovered ? '#ef4444' : c.isResolved ? '#22c55e' : '#f59e0b'} stroke="white" strokeWidth={2} />
          <text x={c.positionX} y={c.positionY + 5} textAnchor="middle" fontSize={12} fill="white" fontFamily="sans-serif" fontWeight="bold">
            💬
          </text>
        </g>
      );
    }

    // Photo pins — no onClick here, handled by mouseDown handler
    for (const pin of photoPins) {
      const phHovered = isEraseHovered(pin.id);
      const photoCount = pin.photos.length;
      parts.push(
        <g key={`photo-${pin.id}`} style={{ cursor: 'pointer', filter: phHovered ? 'drop-shadow(0 0 6px rgba(239,68,68,0.8))' : undefined }}
          opacity={phHovered ? 0.5 : 1}>
          <circle cx={pin.x} cy={pin.y} r={14} fill={phHovered ? '#ef4444' : '#3b82f6'} stroke="white" strokeWidth={2} />
          <text x={pin.x} y={pin.y + 5} textAnchor="middle" fontSize={12} fill="white" fontFamily="sans-serif">📷</text>
          {photoCount > 1 && (
            <g>
              <circle cx={pin.x + 10} cy={pin.y - 10} r={8} fill="#ef4444" stroke="white" strokeWidth={1.5} />
              <text x={pin.x + 10} y={pin.y - 6} textAnchor="middle" fontSize={9} fill="white" fontWeight="bold" fontFamily="sans-serif">{photoCount}</text>
            </g>
          )}
        </g>
      );
    }

    // Calibration line in progress
    if (isCalibrating && calibrationPoints.length > 0) {
      parts.push(
        <circle key="cal-p0" cx={calibrationPoints[0].x} cy={calibrationPoints[0].y} r={6}
          fill="#f59e0b" stroke="white" strokeWidth={2} />
      );
      if (calibrationPoints.length === 2) {
        parts.push(
          <g key="cal-line">
            <line x1={calibrationPoints[0].x} y1={calibrationPoints[0].y}
              x2={calibrationPoints[1].x} y2={calibrationPoints[1].y}
              stroke="#f59e0b" strokeWidth={3} strokeDasharray="6 3" />
            <circle cx={calibrationPoints[1].x} cy={calibrationPoints[1].y} r={6}
              fill="#f59e0b" stroke="white" strokeWidth={2} />
          </g>
        );
      }
    }

    // Current drawing in progress (drag-based tools)
    if (isDrawing && drawPoints.length >= 2 && !['measure-length', 'measure-area'].includes(ws.activeTool)) {
      const tool = ws.activeTool;
      if (tool === 'pen' || tool === 'highlighter') {
        const d = drawPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
        parts.push(
          <path key="drawing-preview" d={d}
            stroke={tool === 'highlighter' ? '#fbbf24' : strokeColor}
            strokeWidth={tool === 'highlighter' ? 12 : strokeWidth}
            fill="none" strokeLinecap="round" strokeLinejoin="round"
            opacity={tool === 'highlighter' ? 0.4 : 1} />
        );
      } else if (tool === 'rectangle') {
        const x = Math.min(drawPoints[0].x, drawPoints[1].x);
        const y = Math.min(drawPoints[0].y, drawPoints[1].y);
        const w = Math.abs(drawPoints[1].x - drawPoints[0].x);
        const h = Math.abs(drawPoints[1].y - drawPoints[0].y);
        parts.push(<rect key="drawing-preview" x={x} y={y} width={w} height={h}
          stroke={strokeColor} strokeWidth={strokeWidth} fill="none" strokeDasharray="4 2" />);
      } else if (tool === 'ellipse') {
        const cx = (drawPoints[0].x + drawPoints[1].x) / 2;
        const cy = (drawPoints[0].y + drawPoints[1].y) / 2;
        const rx = Math.abs(drawPoints[1].x - drawPoints[0].x) / 2;
        const ry = Math.abs(drawPoints[1].y - drawPoints[0].y) / 2;
        parts.push(<ellipse key="drawing-preview" cx={cx} cy={cy} rx={rx} ry={ry}
          stroke={strokeColor} strokeWidth={strokeWidth} fill="none" strokeDasharray="4 2" />);
      } else if (tool === 'issue-cloud') {
        // Preview as dashed rectangle outline (no fill)
        const x = Math.min(drawPoints[0].x, drawPoints[1].x);
        const y = Math.min(drawPoints[0].y, drawPoints[1].y);
        const w = Math.abs(drawPoints[1].x - drawPoints[0].x);
        const h = Math.abs(drawPoints[1].y - drawPoints[0].y);
        parts.push(<rect key="drawing-preview" x={x} y={y} width={w} height={h}
          stroke="#ef4444" strokeWidth={1} fill="none" strokeDasharray="6 3" rx={4} />);
      } else if (tool === 'arrow' || tool === 'line') {
        parts.push(
          <line key="drawing-preview" x1={drawPoints[0].x} y1={drawPoints[0].y}
            x2={drawPoints[1].x} y2={drawPoints[1].y}
            stroke={strokeColor} strokeWidth={strokeWidth} strokeDasharray="4 2"
            markerEnd={tool === 'arrow' ? 'url(#arrowhead)' : undefined} />
        );
      }
    }

    // Click-by-click polyline/area measurement preview
    if (isDrawing && drawPoints.length >= 1 && (ws.activeTool === 'measure-length' || ws.activeTool === 'measure-area')) {
      // Draw placed points and segments
      const allPts = [...drawPoints];
      // Draw segments between placed points
      if (allPts.length >= 2) {
        const pointStr = allPts.map(p => `${p.x},${p.y}`).join(' ');
        parts.push(
          <polyline key="measure-placed" points={pointStr}
            stroke="#2563eb" strokeWidth={2} fill="none" />
        );
      }
      // Draw cursor tracking line from last point
      if (cursorPt && allPts.length >= 1) {
        const last = allPts[allPts.length - 1];
        parts.push(
          <line key="measure-cursor" x1={last.x} y1={last.y} x2={cursorPt.x} y2={cursorPt.y}
            stroke="#2563eb" strokeWidth={1.5} strokeDasharray="4 2" />
        );
      }
      // For area, show closing dashed line
      if (ws.activeTool === 'measure-area' && allPts.length >= 2) {
        const lastPt = cursorPt || allPts[allPts.length - 1];
        parts.push(
          <line key="measure-close" x1={lastPt.x} y1={lastPt.y} x2={allPts[0].x} y2={allPts[0].y}
            stroke="#2563eb" strokeWidth={1} strokeDasharray="3 3" opacity={0.4} />
        );
      }
      // Draw point markers
      for (let i = 0; i < allPts.length; i++) {
        parts.push(
          <circle key={`measure-pt-${i}`} cx={allPts[i].x} cy={allPts[i].y} r={4}
            fill="#2563eb" stroke="white" strokeWidth={1.5} />
        );
      }
      // Show live total distance
      let totalDist = 0;
      for (let i = 0; i < allPts.length - 1; i++) {
        totalDist += Math.sqrt((allPts[i + 1].x - allPts[i].x) ** 2 + (allPts[i + 1].y - allPts[i].y) ** 2);
      }
      if (cursorPt && allPts.length >= 1) {
        const last = allPts[allPts.length - 1];
        totalDist += Math.sqrt((cursorPt.x - last.x) ** 2 + (cursorPt.y - last.y) ** 2);
      }
      const scale = activeFile?.scale_ratio || 1;
      const labelPt = cursorPt || allPts[allPts.length - 1];
      parts.push(
        <g key="measure-label">
          <rect x={labelPt.x + 12} y={labelPt.y - 20} width={80} height={18} rx={4} fill="white" stroke="#2563eb" strokeWidth={1} />
          <text x={labelPt.x + 52} y={labelPt.y - 7} textAnchor="middle"
            fontSize={11} fill="#2563eb" fontWeight="bold" fontFamily="sans-serif">
            {(totalDist * scale).toFixed(1)} mm
          </text>
        </g>
      );
      // Hint text
      parts.push(
        <text key="measure-hint" x={allPts[0].x} y={allPts[0].y - 12}
          fontSize={10} fill="#64748b" fontFamily="sans-serif">
          Kliknij aby dodac punkt · Enter aby zakonczyc
        </text>
      );
    }

    return parts;
  };

  // ---- SVG Overlay Component ----

  const renderOverlaySvg = (naturalW: number, naturalH: number) => {
    if (naturalW === 0 || naturalH === 0) return null;
    const cursorStyle = isSelectingScreenshotArea ? 'crosshair'
      : ws.activeTool === 'erase' ? 'not-allowed'
      : isAnnotationTool(ws.activeTool) || ws.activeTool === 'camera' ? 'crosshair'
      : ws.activeTool === 'select' ? 'default'
      : ws.activeTool === 'pan' ? (isPanning ? 'grabbing' : 'grab')
      : 'default';

    return (
      <svg
        ref={svgOverlayRef}
        className="absolute top-0 left-0 pointer-events-auto"
        width={naturalW}
        height={naturalH}
        style={{ cursor: cursorStyle }}
        onMouseDown={handleSvgMouseDown}
        onMouseMove={handleSvgMouseMove}
        onMouseUp={handleSvgMouseUp}
        onMouseLeave={() => { if (isDrawing && !['measure-length', 'measure-area'].includes(ws.activeTool)) handleSvgMouseUp(); setEraserHoverId(null); }}
        onDoubleClick={() => {
          // Double-click finalizes polyline/area measurement
          if (isDrawing && (ws.activeTool === 'measure-length' || ws.activeTool === 'measure-area')) {
            finalizeMeasurement();
          }
        }}
      >
        {/* Arrow marker definition */}
        <defs>
          <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill={strokeColor} />
          </marker>
        </defs>
        {renderSvgAnnotations()}

        {/* Text input marker */}
        {textInput && (
          <circle cx={textInput.x} cy={textInput.y} r={4} fill="#3b82f6" stroke="white" strokeWidth={2} />
        )}

        {/* Box selection rectangle */}
        {boxSelectStart && boxSelectEnd && (
          <rect
            x={Math.min(boxSelectStart.x, boxSelectEnd.x)}
            y={Math.min(boxSelectStart.y, boxSelectEnd.y)}
            width={Math.abs(boxSelectEnd.x - boxSelectStart.x)}
            height={Math.abs(boxSelectEnd.y - boxSelectStart.y)}
            fill="rgba(59, 130, 246, 0.1)"
            stroke="#3b82f6"
            strokeWidth={1}
            strokeDasharray="4 2"
          />
        )}
        {/* Screenshot area selection */}
        {isSelectingScreenshotArea && screenshotStart && screenshotEnd && (
          <rect
            x={Math.min(screenshotStart.x, screenshotEnd.x)}
            y={Math.min(screenshotStart.y, screenshotEnd.y)}
            width={Math.abs(screenshotEnd.x - screenshotStart.x)}
            height={Math.abs(screenshotEnd.y - screenshotStart.y)}
            fill="rgba(239, 68, 68, 0.08)"
            stroke="#ef4444"
            strokeWidth={2}
            strokeDasharray="6 3"
          />
        )}
      </svg>
    );
  };

  // ---- Project selector ----

  if (loading && projects.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (!selectedProject) {
    const q = projectSearch.toLowerCase();
    const filtered = projects.filter(p => {
      if (projectStatusFilter !== 'all' && p.status !== projectStatusFilter) return false;
      if (!q) return true;
      const customerName = customers.find(c => c.id === p.customer_id)?.name || '';
      const deptName = departments.find(d => d.id === p.department_id)?.name || '';
      return p.name.toLowerCase().includes(q)
        || customerName.toLowerCase().includes(q)
        || deptName.toLowerCase().includes(q)
        || (p.description || '').toLowerCase().includes(q)
        || ((p as any).project_type || '').toLowerCase().includes(q);
    });

    const sorted = [...filtered].sort((a, b) => {
      const k = projectSort.key;
      let va: any = (a as any)[k] || '';
      let vb: any = (b as any)[k] || '';
      if (k === 'customer') {
        va = customers.find(c => c.id === a.customer_id)?.name || '';
        vb = customers.find(c => c.id === b.customer_id)?.name || '';
      }
      if (k === 'department') {
        va = departments.find(d => d.id === a.department_id)?.name || '';
        vb = departments.find(d => d.id === b.department_id)?.name || '';
      }
      const cmp = typeof va === 'string' ? va.localeCompare(vb) : (va > vb ? 1 : va < vb ? -1 : 0);
      return projectSort.asc ? cmp : -cmp;
    });

    const handleDeleteProject = async (e: React.MouseEvent, projectId: string) => {
      e.stopPropagation();
      if (!confirm('Czy na pewno chcesz usunac ten projekt z widoku planow?')) return;
      setProjects(prev => prev.filter(p => p.id !== projectId));
    };

    const SortHeader: React.FC<{ label: string; sortKey: string; className?: string }> = ({ label, sortKey, className }) => (
      <th
        className={`px-3 py-2.5 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-700 select-none ${className || ''}`}
        onClick={() => setProjectSort(prev => ({ key: sortKey, asc: prev.key === sortKey ? !prev.asc : true }))}
      >
        <div className="flex items-center gap-1">
          {label}
          <ArrowUpDown className={`w-3 h-3 ${projectSort.key === sortKey ? 'text-blue-500' : 'text-slate-300'}`} />
        </div>
      </th>
    );

    const STATUS_LABELS: Record<string, { label: string; color: string }> = {
      active: { label: 'Aktywny', color: 'bg-green-100 text-green-700' },
      completed: { label: 'Zakonczony', color: 'bg-blue-100 text-blue-700' },
      archived: { label: 'Archiwum', color: 'bg-slate-100 text-slate-500' },
      on_hold: { label: 'Wstrzymany', color: 'bg-amber-100 text-amber-700' },
    };

    return (
      <div className="flex flex-col h-full bg-slate-50">
        {/* Header */}
        <div className="px-6 py-4 bg-white border-b border-slate-200">
          <h2 className="text-lg font-bold text-slate-800 mb-3">Plany i rzuty — wybierz projekt</h2>
          <div className="flex items-center gap-3 flex-wrap">
            {/* Search */}
            <div className="relative flex-1 min-w-[250px] max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={projectSearch}
                onChange={e => setProjectSearch(e.target.value)}
                placeholder="Szukaj projektu, klienta, dzial..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              {projectSearch && (
                <button onClick={() => setProjectSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {/* Status filter */}
            <div className="relative">
              <select
                value={projectStatusFilter}
                onChange={e => setProjectStatusFilter(e.target.value)}
                className="appearance-none pl-3 pr-8 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 cursor-pointer"
              >
                <option value="all">Wszystkie statusy</option>
                <option value="active">Aktywne</option>
                <option value="completed">Zakonczone</option>
                <option value="on_hold">Wstrzymane</option>
                <option value="archived">Archiwum</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
            {/* Count */}
            <span className="text-xs text-slate-400">{sorted.length} z {projects.length} projektow</span>
            {/* New project button */}
            <button
              onClick={() => { setProjectForm(emptyProjectForm); setShowProjectModal(true); }}
              className="ml-auto flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition shadow-sm"
            >
              <Plus className="w-4 h-4" /> Nowy projekt
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto px-6 py-4">
          {sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <FolderOpen className="w-12 h-12 text-slate-300 mb-3" />
              <p className="text-sm text-slate-500 font-medium mb-1">
                {projects.length === 0 ? 'Brak projektow' : 'Nie znaleziono projektow'}
              </p>
              <p className="text-xs text-slate-400">
                {projects.length === 0 ? 'Utworz projekt w zakladce Projekty, aby rozpoczac prace z planami.' : 'Zmien kryteria wyszukiwania.'}
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <SortHeader label="Projekt" sortKey="name" />
                    <SortHeader label="Klient" sortKey="customer" />
                    <SortHeader label="Dzial" sortKey="department" />
                    <SortHeader label="Typ" sortKey="project_type" />
                    <SortHeader label="Status" sortKey="status" />
                    <SortHeader label="Utworzony" sortKey="created_at" />
                    <SortHeader label="Aktualizacja" sortKey="updated_at" />
                    <th className="px-3 py-2.5 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sorted.map(p => {
                    const customer = customers.find(c => c.id === p.customer_id);
                    const dept = departments.find(d => d.id === p.department_id);
                    const st = STATUS_LABELS[p.status] || { label: p.status, color: 'bg-slate-100 text-slate-500' };
                    return (
                      <tr
                        key={p.id}
                        className="hover:bg-blue-50/50 cursor-pointer transition-colors group"
                        onClick={() => setSelectedProject(p)}
                      >
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: p.color || '#94a3b8' }} />
                            <div>
                              <p className="text-sm font-medium text-slate-800 group-hover:text-blue-600 transition-colors">{p.name}</p>
                              {p.description && <p className="text-[11px] text-slate-400 truncate max-w-[300px]">{p.description}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          {customer ? (
                            <div>
                              <p className="text-xs text-slate-700">{customer.name}</p>
                              {customer.address_city && <p className="text-[10px] text-slate-400">{customer.address_city}</p>}
                            </div>
                          ) : <span className="text-[10px] text-slate-300">—</span>}
                        </td>
                        <td className="px-3 py-3">
                          <span className="text-xs text-slate-600">{dept?.name || <span className="text-slate-300">—</span>}</span>
                        </td>
                        <td className="px-3 py-3">
                          <span className="text-xs text-slate-600">{(p as any).project_type || <span className="text-slate-300">—</span>}</span>
                        </td>
                        <td className="px-3 py-3">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium ${st.color}`}>{st.label}</span>
                        </td>
                        <td className="px-3 py-3">
                          <span className="text-xs text-slate-500">{new Date(p.created_at).toLocaleDateString('pl-PL')}</span>
                        </td>
                        <td className="px-3 py-3">
                          <span className="text-xs text-slate-500">{new Date(p.updated_at).toLocaleDateString('pl-PL')}</span>
                        </td>
                        <td className="px-3 py-3">
                          <button
                            onClick={(e) => handleDeleteProject(e, p.id)}
                            className="p-1 rounded hover:bg-red-50 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition"
                            title="Usun z widoku"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ===== NEW PROJECT MODAL (matches "Nowy kosztorys" design) ===== */}
        {showProjectModal && (() => {
          const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm';
          const labelCls = 'block text-sm font-medium text-slate-700 mb-1';
          const COLOR_OPTIONS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#F97316', '#6366F1', '#14B8A6'];
          const STATUS_CFG: Record<string, string> = { active: 'Aktywny', completed: 'Zakonczony', archived: 'Zarchiwizowany', on_hold: 'Wstrzymany' };

          const selectedClient = customers.find(c => c.id === projectForm.customer_id);
          const filteredClients = customers.filter(c => {
            if (!clientSearchTerm) return true;
            const q = clientSearchTerm.toLowerCase();
            return c.name.toLowerCase().includes(q) || ((c as any).nip || '').includes(q);
          });
          const filteredDepts = departments.filter(d => {
            if (!projectForm.customer_id) return true;
            return (d as any).client_id === projectForm.customer_id || !(d as any).client_id;
          });

          return (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
              <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="p-6 border-b border-slate-200 flex justify-between items-center">
                  <h2 className="text-xl font-bold text-slate-900">Nowy projekt</h2>
                  <button onClick={() => setShowProjectModal(false)} className="p-2 hover:bg-slate-100 rounded-lg">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Form body */}
                <div className="p-6 overflow-y-auto flex-1 space-y-6">

                  {/* 1. Dane klienta */}
                  <div className="space-y-4">
                    <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                      <Building2 className="w-5 h-5 text-slate-400" />
                      Dane klienta
                    </h3>

                    {/* NIP with GUS lookup */}
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className={labelCls}>NIP</label>
                        <input
                          type="text"
                          value={(projectForm as any).nip || ''}
                          onChange={e => setProjectForm(prev => ({ ...prev, nip: e.target.value } as any))}
                          className={inputCls}
                          placeholder="XXX-XXX-XX-XX"
                        />
                      </div>
                      <div className="flex items-end">
                        <button
                          type="button"
                          onClick={async () => {
                            const nip = ((projectForm as any).nip || '').replace(/[^0-9]/g, '');
                            if (nip.length !== 10) { notify('Podaj prawidlowy NIP (10 cyfr)', 'error'); return; }
                            try {
                              const res = await fetch(`https://wl-api.mf.gov.pl/api/search/nip/${nip}?date=${new Date().toISOString().split('T')[0]}`);
                              const data = await res.json();
                              if (data.result?.subject) {
                                const s = data.result.subject;
                                setClientSearchTerm(s.name || '');
                                // Try to match existing client
                                const match = customers.find(c => (c as any).nip?.replace(/[^0-9]/g, '') === nip);
                                if (match) {
                                  setProjectForm(prev => ({ ...prev, customer_id: match.id } as any));
                                }
                                notify('Dane pobrane z GUS');
                              } else {
                                notify('Nie znaleziono danych w GUS', 'error');
                              }
                            } catch {
                              notify('Blad pobierania z GUS', 'error');
                            }
                          }}
                          disabled={!((projectForm as any).nip || '').trim()}
                          className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2 text-sm"
                        >
                          <Download className="w-4 h-4" />
                          Pobierz z GUS
                        </button>
                      </div>
                    </div>

                    {/* Client name (with autocomplete) */}
                    <div className="relative">
                      <label className={labelCls}>Nazwa firmy *</label>
                      {selectedClient ? (
                        <div className="flex items-center gap-2 border border-slate-200 rounded-lg px-3 py-2 bg-blue-50/50">
                          <Building2 className="w-4 h-4 text-blue-500 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-900 truncate">{selectedClient.name}</p>
                            {(selectedClient as any).nip && <p className="text-xs text-slate-400 font-mono">{(selectedClient as any).nip}</p>}
                            {selectedClient.address_city && <p className="text-xs text-slate-400">{selectedClient.address_city}</p>}
                          </div>
                          <button onClick={() => { setProjectForm(prev => ({ ...prev, customer_id: '', department_id: '' })); setClientSearchTerm(''); }} className="p-0.5 text-slate-400 hover:text-red-500">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <input
                            type="text" value={clientSearchTerm}
                            onChange={e => { setClientSearchTerm(e.target.value); setShowClientDropdown(true); }}
                            onFocus={() => setShowClientDropdown(true)}
                            onBlur={() => setTimeout(() => setShowClientDropdown(false), 200)}
                            placeholder="Wyszukaj istniejacego lub wpisz nowa nazwe..."
                            className={inputCls}
                          />
                          {showClientDropdown && (
                            <div className="absolute z-20 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                              {filteredClients.length > 0 && (
                                <div className="px-3 py-2 text-xs font-bold text-slate-700 bg-slate-50 border-b">Kontrahenci z bazy</div>
                              )}
                              {filteredClients.map(client => (
                                <button key={client.id} type="button"
                                  onClick={() => { setProjectForm(prev => ({ ...prev, customer_id: client.id })); setShowClientDropdown(false); setClientSearchTerm(''); }}
                                  className="w-full px-3 py-2 text-left hover:bg-blue-50 border-b border-slate-100 last:border-0">
                                  <div className="font-medium text-slate-900 text-sm">{client.name}</div>
                                  <div className="text-xs text-slate-500 flex gap-2">
                                    {(client as any).nip && <span>NIP: {(client as any).nip}</span>}
                                    {client.address_city && <span>{client.address_city}</span>}
                                  </div>
                                </button>
                              ))}
                              {filteredClients.length === 0 && clientSearchTerm.length >= 2 && (
                                <div className="px-3 py-3 text-sm text-slate-500 text-center">
                                  Nie znaleziono klienta. Mozesz wyszukac w GUS.
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* 2. Obiekt */}
                  <div className="space-y-4">
                    <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                      <Building2 className="w-5 h-5 text-slate-400" />
                      Obiekt
                    </h3>

                    <div className="grid grid-cols-2 gap-4">
                      {/* Name mode toggle */}
                      <div className="col-span-2">
                        <label className={labelCls}>Zrodlo nazwy</label>
                        <div className="flex items-center bg-slate-100 rounded-lg p-0.5 w-fit">
                          <button onClick={() => setProjectForm(prev => ({ ...prev, name_mode: 'custom' }))}
                            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${projectForm.name_mode === 'custom' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>Nazwa wlasna</button>
                          <button onClick={() => setProjectForm(prev => ({ ...prev, name_mode: 'object' }))}
                            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${projectForm.name_mode === 'object' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>Wybrac obiekt</button>
                        </div>
                      </div>

                      {projectForm.name_mode === 'custom' ? (
                        <div className="col-span-2">
                          <label className={labelCls}>Nazwa projektu *</label>
                          <input type="text" value={projectForm.name} onChange={e => setProjectForm(prev => ({ ...prev, name: e.target.value }))} className={inputCls} placeholder="np. Osiedle Sloneczne — Etap II" />
                        </div>
                      ) : (
                        <div className="col-span-2">
                          <label className={labelCls}>Obiekt *</label>
                          <div className="flex gap-2">
                            <select value={projectForm.department_id} onChange={e => {
                              const dept = departments.find(d => d.id === e.target.value);
                              setProjectForm(prev => ({
                                ...prev,
                                department_id: e.target.value,
                                customer_id: (dept as any)?.client_id || prev.customer_id,
                              }));
                            }} className={`flex-1 ${inputCls}`}>
                              <option value="">-- Wybierz --</option>
                              {filteredDepts.map(d => <option key={d.id} value={d.id}>{d.name} {d.kod_obiektu ? `(${d.kod_obiektu})` : ''}</option>)}
                            </select>
                            <a href="#/company/departments" className="inline-flex items-center gap-1 px-3 py-2 text-sm text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 whitespace-nowrap">
                              <Plus className="w-4 h-4" /> Nowy
                            </a>
                          </div>
                          {projectForm.department_id && (() => {
                            const dept = departments.find(d => d.id === projectForm.department_id);
                            if (!dept) return null;
                            return (
                              <div className="mt-2 px-3 py-2 bg-slate-50 rounded-lg text-xs text-slate-500 leading-relaxed">
                                {dept.kod_obiektu && <span className="mr-3"><b>Kod:</b> {dept.kod_obiektu}</span>}
                                {dept.rodzaj && <span className="mr-3"><b>Rodzaj:</b> {dept.rodzaj}</span>}
                                {dept.typ && <span className="mr-3"><b>Typ:</b> {dept.typ}</span>}
                                {(dept.address_street || dept.address_city) && <><br /><b>Adres:</b> {[dept.address_street, dept.address_postal_code, dept.address_city].filter(Boolean).join(', ')}</>}
                              </div>
                            );
                          })()}
                        </div>
                      )}

                      <div className="col-span-2">
                        <label className={labelCls}>Opis projektu</label>
                        <textarea value={projectForm.description} onChange={e => setProjectForm(prev => ({ ...prev, description: e.target.value }))} rows={2} className={inputCls} placeholder="Opis projektu..." />
                      </div>
                    </div>
                  </div>

                  {/* 3. Parametry projektu */}
                  <div className="space-y-4">
                    <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                      <Settings className="w-5 h-5 text-slate-400" />
                      Parametry projektu
                    </h3>

                    <div className="grid grid-cols-4 gap-4">
                      <div className="col-span-2">
                        <label className={labelCls}>Status</label>
                        <select value={projectForm.status} onChange={e => setProjectForm(prev => ({ ...prev, status: e.target.value as ProjectStatus }))} className={inputCls}>
                          {Object.entries(STATUS_CFG).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                        </select>
                      </div>
                      <div className="col-span-2">
                        <label className={labelCls}>Kolor</label>
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {COLOR_OPTIONS.map(color => (
                            <button key={color} onClick={() => setProjectForm(prev => ({ ...prev, color }))}
                              className={`w-6 h-6 rounded-full border-2 transition-transform ${projectForm.color === color ? 'border-slate-700 scale-110' : 'border-transparent hover:scale-105'}`}
                              style={{ backgroundColor: color }} />
                          ))}
                        </div>
                      </div>

                      <div className="col-span-4">
                        <label className={labelCls}>Forma wynagrodzenia</label>
                        <div className="flex items-center bg-slate-100 rounded-lg p-0.5 w-fit">
                          <button onClick={() => setProjectForm(prev => ({ ...prev, billing_type: 'ryczalt' }))}
                            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${projectForm.billing_type === 'ryczalt' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>Ryczalt</button>
                          <button onClick={() => setProjectForm(prev => ({ ...prev, billing_type: 'hourly' }))}
                            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${projectForm.billing_type === 'hourly' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>Roboczogodziny</button>
                        </div>
                      </div>

                      {projectForm.billing_type === 'ryczalt' ? (
                        <>
                          <div className="col-span-2">
                            <label className={labelCls}>Budzet godzin</label>
                            <input type="number" value={projectForm.budget_hours} onChange={e => setProjectForm(prev => ({ ...prev, budget_hours: e.target.value }))} className={inputCls} placeholder="np. 100" />
                          </div>
                          <div className="col-span-2">
                            <label className={labelCls}>Budzet netto (PLN)</label>
                            <input type="number" value={projectForm.budget_amount} onChange={e => setProjectForm(prev => ({ ...prev, budget_amount: e.target.value }))} className={inputCls} placeholder="np. 50000" />
                          </div>
                        </>
                      ) : (
                        <div className="col-span-2">
                          <label className={labelCls}>Stawka netto (PLN/godz.)</label>
                          <input type="number" value={projectForm.hourly_rate} onChange={e => setProjectForm(prev => ({ ...prev, hourly_rate: e.target.value }))} className={inputCls} placeholder="np. 65" />
                        </div>
                      )}

                      <div className="col-span-2">
                        <label className={labelCls}>Data rozpoczecia</label>
                        <input type="date" value={projectForm.start_date} onChange={e => setProjectForm(prev => ({ ...prev, start_date: e.target.value }))} className={inputCls} />
                      </div>
                      <div className="col-span-2">
                        <label className={labelCls}>Data zakonczenia</label>
                        <input type="date" value={projectForm.end_date} onChange={e => setProjectForm(prev => ({ ...prev, end_date: e.target.value }))} className={inputCls} />
                      </div>
                    </div>
                  </div>

                </div>

                {/* Footer */}
                <div className="p-6 border-t border-slate-200 flex justify-end gap-3">
                  <button onClick={() => setShowProjectModal(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg">
                    Anuluj
                  </button>
                  <button
                    onClick={saveNewProject}
                    disabled={savingProject || (projectForm.name_mode === 'custom' ? !projectForm.name.trim() : !projectForm.department_id)}
                    className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                  >
                    {savingProject && <Loader2 className="w-4 h-4 animate-spin" />}
                    Utworz projekt
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    );
  }

  // ---- Does active file need APS viewer? ----
  const showApsViewer = activeFile && (
    activeFile.aps_urn ||
    apsFileBase64 ||
    ['dwg', 'cad', 'ifc', 'rvt'].includes(fileFormat)
  );
  // DXF without URN renders natively
  const showDxfViewer = activeFile && fileFormat === 'dxf' && !hasUrn && dxfBlobUrl;
  const showPdfViewer = activeFile && fileFormat === 'pdf';
  const showImageViewer = activeFile && fileFormat === 'image';

  // ---- Render ----

  return (
    <div className={`flex h-full bg-slate-100 relative ${ws.isFullscreen ? 'fixed inset-0 z-[80]' : ''}`}>
      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" className="hidden"
        accept=".dwg,.dxf,.pdf,.ifc,.rvt,.png,.jpg,.jpeg,.gif,.bmp,.webp,.svg"
        onChange={handleFileUpload} />

      {/* Left Sidebar */}
      {ws.leftPanelOpen && (
        <div className="w-64 flex-shrink-0">
          <PlansSidebar
            folders={sidebarFolders}
            activeFileId={ws.activeFileId}
            searchQuery={fileSearch}
            onSearchChange={setFileSearch}
            onSelectFile={handleSelectFile}
            onImport={handleImport}
            onCreateFolder={handleCreateFolder}
            onFileAction={handleFileAction}
            onToggleFolder={handleToggleFolder}
            onRenameFolder={handleRenameFolder}
            onDeleteFolder={handleDeleteFolder}
            onCreateSubfolder={handleCreateSubfolder}
            onMoveFileToFolder={handleMoveFileToFolder}
            onReorderFile={handleReorderFile}
          />
        </div>
      )}

      {/* Center workspace */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Project header bar when no file selected */}
        {!activeFile && (
          <div className="px-3 py-1.5 border-b border-slate-200 flex items-center gap-2 bg-white flex-shrink-0">
            <button onClick={handleBackToProjects} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500" title="Powrot do listy projektow">
              <ArrowLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-medium text-slate-600 truncate">{selectedProject?.name}</span>
          </div>
        )}
        {/* Top Toolbar */}
        {activeFile && (
          <WorkspaceTopToolbar
            onBackToProjects={handleBackToProjects}
            canOpenInAutodesk={!!(activeFile && !activeFile.aps_urn && ['pdf', 'dxf', 'dwg', 'cad', 'ifc', 'rvt'].includes(fileFormat))}
            onOpenInAutodesk={handleOpenInAps}
            fileName={activeFile.original_filename || activeFile.name}
            fileFormat={fileFormat}
            zoom={zoom}
            onZoomIn={() => setZoom(z => Math.min(z + 25, 500))}
            onZoomOut={() => setZoom(z => Math.max(z - 25, 25))}
            onZoomReset={() => setZoom(100)}
            onZoomFit={() => setZoom(100)}
            isFullscreen={ws.isFullscreen}
            onToggleFullscreen={() => dispatch({ type: 'TOGGLE_FULLSCREEN' })}
            leftPanelOpen={ws.leftPanelOpen}
            rightPanelOpen={ws.rightPanelOpen}
            onToggleLeftPanel={() => dispatch({ type: 'TOGGLE_LEFT_PANEL' })}
            onToggleRightPanel={() => dispatch({ type: 'TOGGLE_RIGHT_PANEL' })}
            viewerMode={ws.viewerMode}
            onSetMode={(mode) => dispatch({ type: 'SET_VIEWER_MODE', mode })}
            canConvert={!!activeFile && needsConversion && ws.conversionStatus !== 'loading'}
            canAnalyze={!!activeFile?.aps_urn && ws.analysisStatus !== 'loading'}
            canAiRecognize={objects.length > 0 && ws.aiStatus !== 'loading'}
            canGenerateBoq={objects.length > 0 && ws.boqStatus !== 'loading'}
            canCompare={!!activeFile?.aps_urn}
            conversionStatus={ws.conversionStatus}
            analysisStatus={ws.analysisStatus}
            aiStatus={ws.aiStatus}
            boqStatus={ws.boqStatus}
            onConvert={handleConvert}
            onAnalyze={handleAnalyze}
            onAiRecognize={handleAiRecognize}
            onGenerateBoq={handleGenerateBoq}
            onCompare={handleCompare}
            onExport={handleExport}
            onUploadNewVersion={handleImport}
            onHistory={handleHistory}
            onDownload={() => { if (activeFile) window.open(activeFile.file_url, '_blank'); }}
            filters={ws.filters}
            availableLayers={[...new Set(objects.map(o => o.layer).filter(Boolean) as string[])]}
            availableCategories={[...new Set(objects.map(o => o.category).filter(Boolean) as string[])]}
            availableLevels={[...new Set(objects.map(o => o.level).filter(Boolean) as string[])]}
            availableZones={[...new Set(objects.map(o => o.zone).filter(Boolean) as string[])]}
            availableFamilyTypes={[...new Set(objects.map(o => o.family ? `${o.family}/${o.type || ''}` : o.type).filter(Boolean) as string[])]}
            fileCreatedAt={activeFile.created_at}
            fileUpdatedAt={activeFile.updated_at}
            onRenameFile={async (newName) => {
              await supabase.from('plans').update({ name: newName }).eq('id', activeFile.id);
              setSelectedPlan(prev => prev ? { ...prev, name: newName } : prev);
              notify('Nazwa zmieniona');
            }}
            onFiltersChange={(f) => dispatch({ type: 'SET_FILTERS', filters: f })}
            pdfPage={showPdfViewer ? pdfPage : undefined}
            pdfTotalPages={showPdfViewer ? pdfTotalPages : undefined}
            onPdfPageChange={showPdfViewer ? setPdfPage : undefined}
          />
        )}

        {/* Version History Dropdown */}
        {showVersionHistory && (
          <div className="absolute top-12 right-4 z-50 w-80 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-200">
              <span className="text-xs font-bold text-slate-700">Historia wersji</span>
              <button onClick={() => setShowVersionHistory(false)} className="p-1 hover:bg-slate-200 rounded">
                <X className="w-3.5 h-3.5 text-slate-500" />
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto">
              {versionHistory.length === 0 ? (
                <p className="px-4 py-6 text-xs text-slate-400 text-center">Brak historii wersji</p>
              ) : versionHistory.map(v => (
                <div
                  key={v.id}
                  className={`px-4 py-2.5 border-b border-slate-50 cursor-pointer transition-colors hover:bg-blue-50 ${
                    v.id === selectedPlan?.id ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''
                  }`}
                  onClick={() => handleSwitchVersion(v)}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-slate-800">
                      v{v.version} — {v.name}
                    </span>
                    {v.is_current_version && (
                      <span className="text-[9px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded-full">aktualna</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-slate-400">
                      {new Date(v.created_at).toLocaleDateString('pl-PL')} {new Date(v.created_at).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {v.file_size && (
                      <span className="text-[10px] text-slate-400">{(v.file_size / 1024 / 1024).toFixed(1)} MB</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Viewer Area */}
        <div ref={viewerContainerRef} className="flex-1 overflow-auto relative bg-slate-200"
          style={{ cursor: ws.activeTool === 'pan' ? (isPanning ? 'grabbing' : 'grab') : undefined }}
          onMouseDown={e => {
            if (ws.activeTool === 'pan') {
              const container = viewerContainerRef.current;
              if (container) {
                setIsPanning(true);
                setPanStart({ x: e.clientX, y: e.clientY, scrollLeft: container.scrollLeft, scrollTop: container.scrollTop });
              }
              e.preventDefault();
            }
          }}
          onMouseMove={e => {
            if (isPanning && panStart) {
              const container = viewerContainerRef.current;
              if (container) {
                container.scrollLeft = panStart.scrollLeft - (e.clientX - panStart.x);
                container.scrollTop = panStart.scrollTop - (e.clientY - panStart.y);
              }
              e.preventDefault();
            }
          }}
          onMouseUp={() => {
            if (isPanning) { setIsPanning(false); setPanStart(null); }
          }}
          onMouseLeave={() => {
            if (isPanning) { setIsPanning(false); setPanStart(null); }
          }}>
          {!activeFile ? (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center">
              <div className="w-16 h-16 rounded-2xl bg-slate-300/50 flex items-center justify-center mb-4">
                <Loader2 className="w-8 h-8 text-slate-400" />
              </div>
              <h3 className="text-sm font-bold text-slate-500 mb-1">Wybierz plik z listy</h3>
              <p className="text-xs text-slate-400 max-w-xs">Kliknij plik w panelu po lewej stronie, aby otworzyc go w przegladarce.</p>
            </div>
          ) : showApsViewer ? (
            <div className="w-full h-full relative" style={{ minHeight: '400px' }}>
              <AutodeskViewer
                urn={activeFile.aps_urn || undefined}
                fileBase64={!activeFile.aps_urn ? apsFileBase64 || undefined : undefined}
                fileName={activeFile.original_filename || activeFile.name}
                onUrnReady={handleUrnReady}
                onObjectSelected={handleApsObjectSelected}
                highlightDbIds={apsHighlightDbIds.length > 0 ? apsHighlightDbIds : undefined}
                projectId={selectedProject?.id}
                planId={activeFile.id}
                className="w-full h-full"
              />

              {/* Overlay badges */}
              {ws.viewerMode !== 'viewer' && (
                <div className="absolute top-3 left-3 z-20">
                  <span className={`px-3 py-1.5 rounded-lg text-xs font-medium shadow-sm ${
                    ws.viewerMode === 'boq-overlay' ? 'bg-green-600 text-white'
                    : ws.viewerMode === 'ai-overlay' ? 'bg-purple-600 text-white'
                    : ws.viewerMode === 'compare' ? 'bg-amber-600 text-white'
                    : ws.viewerMode === 'manual-takeoff' ? 'bg-blue-600 text-white'
                    : 'bg-slate-600 text-white'
                  }`}>
                    {ws.viewerMode === 'boq-overlay' ? 'BOQ Overlay'
                    : ws.viewerMode === 'ai-overlay' ? 'AI Overlay'
                    : ws.viewerMode === 'compare' ? 'Porownanie'
                    : ws.viewerMode === 'manual-takeoff' ? 'Przedmiar reczny'
                    : ws.viewerMode === 'objects' ? 'Obiekty'
                    : ws.viewerMode}
                  </span>
                </div>
              )}

              {/* Status indicators */}
              {(ws.conversionStatus === 'loading' || ws.analysisStatus === 'loading' || ws.aiStatus === 'loading' || ws.boqStatus === 'loading') && (
                <div className="absolute top-3 right-3 z-20 flex items-center gap-2 px-3 py-1.5 bg-white/90 rounded-lg shadow-sm">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                  <span className="text-xs text-slate-700">
                    {ws.conversionStatus === 'loading' ? 'Konwertowanie...'
                    : ws.analysisStatus === 'loading' ? 'Analizowanie...'
                    : ws.aiStatus === 'loading' ? 'Rozpoznanie AI...'
                    : 'Generowanie BOQ...'}
                  </span>
                </div>
              )}
            </div>
          ) : showPdfViewer ? (
            <div className="w-full h-full overflow-auto flex items-start justify-center p-4">
              <div className="relative inline-block">
                <canvas ref={pdfCanvasRef} className="shadow-lg rounded-lg bg-white" />
                {/* Annotation SVG overlay on top of PDF canvas */}
                {pdfNaturalSize.w > 0 && renderOverlaySvg(pdfNaturalSize.w, pdfNaturalSize.h)}
              </div>
            </div>
          ) : showDxfViewer ? (
            <div className="w-full h-full overflow-auto flex items-start justify-center p-4">
              <div className="relative inline-block">
                <img
                  src={dxfBlobUrl!}
                  alt="DXF Preview"
                  className="shadow-lg rounded-lg bg-white"
                  style={{
                    transform: `scale(${zoom / 100})`,
                    transformOrigin: 'top center',
                    maxWidth: zoom <= 100 ? '100%' : 'none',
                  }}
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    setDxfNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
                  }}
                />
                {/* Annotation SVG overlay on top of DXF image */}
                {dxfNaturalSize.w > 0 && renderOverlaySvg(dxfNaturalSize.w, dxfNaturalSize.h)}
              </div>
            </div>
          ) : showImageViewer ? (
            <div className="w-full h-full overflow-auto flex items-start justify-center p-4">
              <div className="relative inline-block">
                <img
                  ref={imgRef}
                  src={activeFile.file_url}
                  alt={activeFile.name}
                  className="shadow-lg rounded-lg bg-white"
                  style={{
                    transform: `scale(${zoom / 100})`,
                    transformOrigin: 'top center',
                    maxWidth: zoom <= 100 ? '100%' : 'none',
                  }}
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    setImgNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
                  }}
                  onError={() => notify('Nie mozna zaladowac obrazu', 'error')}
                />
                {/* Annotation SVG overlay on top of image */}
                {imgNaturalSize.w > 0 && renderOverlaySvg(imgNaturalSize.w, imgNaturalSize.h)}
              </div>
            </div>
          ) : (
            <div className="w-full h-full flex items-center justify-center p-8 text-center">
              <div>
                <p className="text-sm text-slate-500 mb-4">Ten format pliku wymaga konwersji.</p>
                <button onClick={handleConvert}
                  className="px-6 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700">
                  Konwertuj i otworz
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Bottom Toolbar */}
        {activeFile && (
          <ViewerBottomToolbar
            activeTool={ws.activeTool}
            onSetTool={(tool) => {
              if (tool === 'snapshot') { handleSnapshot(); return; }
              // Toggle: clicking active tool switches to select
              if (tool === ws.activeTool && tool !== 'select') {
                dispatch({ type: 'SET_ACTIVE_TOOL', tool: 'select' });
              } else {
                dispatch({ type: 'SET_ACTIVE_TOOL', tool });
              }
            }}
            strokeColor={strokeColor}
            strokeWidth={strokeWidth}
            onColorChange={setStrokeColor}
            onWidthChange={setStrokeWidth}
            hasScale={!!(selectedPlan?.scale_ratio)}
            onCalibrateScale={handleCalibrateScale}
            countValue={countMarkers.length > 0 ? countMarkers.length : undefined}
            onClearCount={() => setCountMarkers([])}
          />
        )}
      </div>

      {/* Right Panel */}
      {ws.rightPanelOpen && activeFile && (
        <WorkspaceRightPanel
          activeTab={ws.rightTab}
          onSetTab={(tab) => dispatch({ type: 'SET_RIGHT_TAB', tab })}
          onClose={() => dispatch({ type: 'TOGGLE_RIGHT_PANEL' })}
          objects={filteredObjects}
          selectedObjectIds={ws.selectedObjectIds}
          selectedBoqRowId={ws.selectedBoqRowId}
          boqRows={boqRows}
          aiSuggestions={aiSuggestions}
          measurements={measurements}
          annotations={annotations}
          comments={comments}
          compareResult={compareResult}
          errors={errors}
          fileName={activeFile.original_filename || activeFile.name}
          fileFormat={fileFormat}
          fileStatus={fileStatus}
          objectCount={filteredObjects.length}
          analysisStatus={ws.analysisStatus}
          aiStatus={ws.aiStatus}
          boqStatus={ws.boqStatus}
          onSelectObject={handleSelectObject}
          onSelectBoqRow={handleSelectBoqRow}
          onHighlightObjects={handleHighlightObjects}
          onIsolateObject={(id) => handleHighlightObjects([id])}
          onAddToBoq={(ids) => notify(`${ids.length} obiektow dodano do BOQ`)}
          onExcludeFromBoq={(id) => notify('Obiekt wykluczone z BOQ')}
          onApplyAiSuggestion={handleApplyAiSuggestion}
          onRejectAiSuggestion={handleRejectAiSuggestion}
          onCreateRuleFromProperty={(id) => {
            dispatch({ type: 'OPEN_RULE_EDITOR' });
          }}
          onApproveBoqRow={handleApproveBoqRow}
          onRejectBoqRow={handleRejectBoqRow}
          onEditBoqRow={(id, updates) => {
            if (updates) {
              setBoqRows(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r));
              notify('Pozycja BOQ zaktualizowana');
            }
          }}
          onExportBoq={handleExport}
          onGenerateBoq={handleGenerateBoq}
          onGenerateBoqAi={handleGenerateBoqAi}
          onAnalyze={handleAnalyze}
          onAiRecognize={handleAiRecognize}
          onLinkMeasurementToBoq={(mid, rowId) => {
            setMeasurements(prev => prev.map(m => m.id === mid ? { ...m, linkedBoqRowId: rowId } : m));
            supabase.from('plan_measurements').update({ linked_boq_row_id: rowId }).eq('id', mid).then(() => {});
          }}
          onDeleteMeasurement={(id) => setMeasurements(prev => prev.filter(m => m.id !== id))}
          onRetryError={(id) => {
            setErrors(prev => prev.filter(e => e.id !== id));
          }}
          photos={photoPins.flatMap(pin => pin.photos.map(ph => ({ id: ph.id, x: pin.x, y: pin.y, url: ph.url, label: ph.label })))}
          onDeletePhoto={(id) => {
            setPhotoPins(prev => prev.map(pin => ({ ...pin, photos: pin.photos.filter(ph => ph.id !== id) })).filter(pin => pin.photos.length > 0));
            if (activeFile) {
              supabase.from('plan_photos').delete().eq('id', id).then(() => {});
            }
          }}
          // Status
          conversionStatus={ws.conversionStatus}
          conversionProgress={ws.conversionProgress}
          analysisProgress={ws.analysisProgress}
          // Source file info
          sourceFile={activeFile.original_filename || activeFile.name}
          sourceVersion={`v${activeFile.version}`}
          // Compare
          compareVersions={compareVersionList.map(v => ({ id: v.id, name: v.name, version: v.version }))}
          compareStatus={ws.compareStatus}
          onRunCompare={handleRunCompare}
          // Objects tab
          onExcludeObject={(id) => {
            setObjects(prev => prev.filter(o => o.id !== id));
            notify('Obiekt wykluczony');
          }}
          onClassifyObject={(id) => {
            handleAiRecognize();
          }}
          onMarkObjectReviewed={(id) => {
            setObjects(prev => prev.map(o => o.id === id ? { ...o, aiStatus: 'recognized' as const } : o));
          }}
          // Properties tab
          onFindSimilar={(id) => {
            const obj = objects.find(o => o.id === id);
            if (obj?.category) {
              dispatch({ type: 'SET_FILTERS', filters: { categories: [obj.category] } });
              dispatch({ type: 'SET_RIGHT_TAB', tab: 'objects' });
              notify(`Filtrowanie: ${obj.category}`);
            }
          }}
          onLinkObjectToBoq={(id) => {
            const obj = objects.find(o => o.id === id);
            if (obj && boqRows.length > 0) {
              const row = boqRows[0];
              setObjects(prev => prev.map(o => o.id === id ? { ...o, boqRowId: row.id } : o));
              setBoqRows(prev => prev.map(r => r.id === row.id ? { ...r, sourceObjectIds: [...r.sourceObjectIds, id] } : r));
              notify(`Obiekt polaczony z ${row.name}`);
            }
          }}
          // AI tab
          onEditAiSuggestion={(sid) => {
            const suggestion = aiSuggestions.find(s => s.id === sid);
            if (suggestion) {
              const newClass = prompt('Nowa klasa:', suggestion.suggestedClass);
              if (newClass) {
                setAiSuggestions(prev => prev.map(s => s.id === sid ? { ...s, suggestedClass: newClass, status: 'accepted' as const } : s));
              }
            }
          }}
          onCreateRuleFromSuggestion={(sid) => {
            const suggestion = aiSuggestions.find(s => s.id === sid);
            if (suggestion) {
              dispatch({ type: 'OPEN_RULE_EDITOR' });
            }
          }}
          // BOQ tab
          onSplitBoqRow={(rowId) => {
            const row = boqRows.find(r => r.id === rowId);
            if (!row || row.quantity <= 1) return;
            const half = Math.ceil(row.quantity / 2);
            setBoqRows(prev => [
              ...prev.map(r => r.id === rowId ? { ...r, quantity: half } : r),
              { ...row, id: `boq-${Date.now()}`, quantity: row.quantity - half },
            ]);
            notify('Pozycja podzielona');
          }}
          onMergeBoqRows={(rowIds) => {
            const rows = boqRows.filter(r => rowIds.includes(r.id));
            if (rows.length < 2) return;
            const merged: BoqRow = {
              ...rows[0],
              id: `boq-${Date.now()}`,
              quantity: rows.reduce((s, r) => s + r.quantity, 0),
              sourceObjectIds: rows.flatMap(r => r.sourceObjectIds),
              name: rows.map(r => r.name).join(' + '),
            };
            setBoqRows(prev => [...prev.filter(r => !rowIds.includes(r.id)), merged]);
            notify(`${rows.length} pozycji polaczonych`);
          }}
          onAddBoqRowManually={() => {
            const name = prompt('Nazwa pozycji BOQ:');
            if (!name) return;
            setBoqRows(prev => [...prev, {
              id: `boq-${Date.now()}`, name, unit: 'szt', quantity: 1,
              sourceType: 'manual-measurement', sourceObjectIds: [], status: 'manually-edited',
            }]);
            notify('Dodano pozycje BOQ');
          }}
          onRecalculateBoq={() => handleGenerateBoq()}
          onApproveAllBoq={() => {
            setBoqRows(prev => prev.map(r => ({ ...r, status: 'approved' as const })));
            notify('Wszystkie pozycje zatwierdzone');
          }}
          onRemoveBoqSource={(rowId, sourceId) => {
            setBoqRows(prev => prev.map(r => r.id === rowId
              ? { ...r, sourceObjectIds: r.sourceObjectIds.filter(id => id !== sourceId) }
              : r
            ));
          }}
          // Annotations tab
          onDeleteAnnotation={(id) => {
            setAnnotations(prev => prev.filter(a => a.id !== id));
            supabase.from('plan_annotations').delete().eq('id', id).then(() => {});
          }}
          onFocusAnnotation={(id) => {
            const ann = annotations.find(a => a.id === id);
            if (ann?.geometry?.points?.[0]) {
              notify(`Fokus na adnotacji: ${ann.type}`);
            }
          }}
          onLinkAnnotationToBoq={(id) => {
            if (boqRows.length > 0) {
              setAnnotations(prev => prev.map(a => a.id === id ? { ...a, linkedBoqRowId: boqRows[0].id } : a));
              notify('Adnotacja polaczona z BOQ');
            }
          }}
          // Measurements tab
          onRenameMeasurement={(id) => {
            const newLabel = prompt('Nowa nazwa pomiaru:');
            if (newLabel) {
              setMeasurements(prev => prev.map(m => m.id === id ? { ...m, label: newLabel } : m));
            }
          }}
          onExportMeasurements={() => {
            const csv = measurements.map(m => `${m.type},${m.value},${m.unit},${m.label || ''}`).join('\n');
            const blob = new Blob([`Typ,Wartosc,Jednostka,Etykieta\n${csv}`], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = 'pomiary.csv'; a.click();
            URL.revokeObjectURL(url);
          }}
          // Errors tab
          onIgnoreError={(id) => setErrors(prev => prev.filter(e => e.id !== id))}
          onResolveError={(id) => setErrors(prev => prev.filter(e => e.id !== id))}
        />
      )}

      {/* Rule Editor Drawer */}
      <RuleEditorDrawer
        isOpen={ws.ruleEditorOpen}
        rules={rules}
        editingRuleId={ws.editingRuleId}
        onSaveRule={handleSaveRule}
        onDeleteRule={handleDeleteRule}
        onToggleRule={handleToggleRule}
        onReorderRules={setRules}
        onClose={() => dispatch({ type: 'CLOSE_RULE_EDITOR' })}
      />

      {/* PDF Analysis Modal */}
      {showPdfAnalysis && pdfDoc && activeFile && currentUser && (
        <PdfAnalysisModal
          pdfDoc={pdfDoc}
          pageNumber={pdfPage}
          companyId={currentUser.company_id || ''}
          drawingId={activeFile.id}
          scaleRatio={activeFile.scale_ratio}
          onAnalysisComplete={handlePdfAnalysisComplete}
          onClose={() => setShowPdfAnalysis(false)}
        />
      )}

      {/* DXF Analysis Modal */}
      {showDxfAnalysis && dxfData && activeFile && currentUser && (
        <DxfAnalysisModal
          dxf={dxfData}
          companyId={currentUser.company_id || ''}
          drawingId={activeFile.id}
          onAnalysisComplete={handleDxfAnalysisComplete}
          onClose={() => setShowDxfAnalysis(false)}
        />
      )}

      {/* Hidden photo input */}
      <input ref={photoInputRef} type="file" className="hidden"
        accept="image/*" multiple onChange={handlePhotoUpload} />

      {/* Scale calibration dialog */}
      {calibrationInput.show && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-80">
            <h3 className="text-sm font-bold text-slate-800 mb-3">Kalibracja skali</h3>
            <p className="text-xs text-slate-500 mb-3">
              Odleglosc w pikselach: {Math.round(calibrationInput.pixelDist)} px
            </p>
            <label className="block text-xs text-slate-600 mb-1">Rzeczywista odleglosc (mm):</label>
            <input
              type="number"
              autoFocus
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm mb-4"
              placeholder="np. 1000"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const val = parseFloat((e.target as HTMLInputElement).value);
                  if (val > 0) handleCalibrationSubmit(val);
                }
                if (e.key === 'Escape') {
                  setIsCalibrating(false);
                  setCalibrationPoints([]);
                  setCalibrationInput({ pixelDist: 0, show: false });
                }
              }}
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => {
                setIsCalibrating(false);
                setCalibrationPoints([]);
                setCalibrationInput({ pixelDist: 0, show: false });
              }} className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg hover:bg-slate-50">
                Anuluj
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== COMMENT MODAL ===== */}
      {commentModal && commentModal.mode === 'create' && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" onClick={() => setCommentModal(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-96 max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800">Nowy komentarz</h3>
              <button onClick={() => setCommentModal(null)} className="p-1 hover:bg-slate-100 rounded"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4">
              <textarea
                value={commentText}
                onChange={e => setCommentText(e.target.value)}
                rows={4}
                autoFocus
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                placeholder="Wpisz komentarz..."
              />
            </div>
            <div className="px-4 py-3 border-t border-slate-100 flex justify-end gap-2">
              <button onClick={() => setCommentModal(null)} className="px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100 rounded-lg">Anuluj</button>
              <button
                disabled={!commentText.trim()}
                onClick={() => {
                  if (!commentText.trim()) return;
                  const newComment: CommentThread = {
                    id: `comment-${Date.now()}`, fileId: activeFile?.id || '',
                    positionX: commentModal.x, positionY: commentModal.y,
                    authorId: currentUser?.id || '',
                    authorName: `${currentUser?.first_name || ''} ${currentUser?.last_name || ''}`.trim() || 'User',
                    content: commentText.trim(), isResolved: false, replies: [], createdAt: new Date().toISOString(),
                  };
                  setComments(prev => [...prev, newComment]);
                  if (activeFile?.id) {
                    supabase.from('plan_comments').insert({
                      plan_id: activeFile.id, position_x: commentModal.x, position_y: commentModal.y,
                      author_id: currentUser?.id, author_name: newComment.authorName, content: commentText.trim(), is_resolved: false,
                    }).then(() => {});
                  }
                  setCommentModal(null);
                  setCommentText('');
                  dispatch({ type: 'SET_ACTIVE_TOOL', tool: 'select' });
                  notify('Komentarz dodany');
                }}
                className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >Dodaj</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== COMMENT VIEW MODAL ===== */}
      {commentModal && commentModal.mode === 'view' && (() => {
        const c = comments.find(x => x.id === commentModal.commentId);
        if (!c) return null;
        return (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" onClick={() => setCommentModal(null)}>
            <div className="bg-white rounded-xl shadow-2xl w-[420px] max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-800">Komentarz</h3>
                <button onClick={() => setCommentModal(null)} className="p-1 hover:bg-slate-100 rounded"><X className="w-4 h-4" /></button>
              </div>
              <div className="p-4 space-y-3 overflow-y-auto max-h-[60vh]">
                {/* Main comment */}
                <div className="bg-slate-50 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-slate-700">{c.authorName}</span>
                    <span className="text-[10px] text-slate-400">{new Date(c.createdAt).toLocaleString('pl-PL')}</span>
                  </div>
                  {editingCommentId === c.id ? (
                    <div className="space-y-2">
                      <textarea value={editingCommentText} onChange={e => setEditingCommentText(e.target.value)}
                        className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg" rows={3} />
                      <div className="flex gap-1">
                        <button onClick={() => {
                          setComments(prev => prev.map(x => x.id === c.id ? { ...x, content: editingCommentText.trim() } : x));
                          if (activeFile?.id) supabase.from('plan_comments').update({ content: editingCommentText.trim() }).eq('id', c.id).then(() => {});
                          setEditingCommentId(null);
                        }} className="px-2 py-1 text-xs bg-blue-600 text-white rounded">Zapisz</button>
                        <button onClick={() => setEditingCommentId(null)} className="px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 rounded">Anuluj</button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-800 whitespace-pre-wrap">{c.content}</p>
                  )}
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => { setEditingCommentId(c.id); setEditingCommentText(c.content); }}
                      className="text-[10px] text-blue-600 hover:text-blue-800">Edytuj</button>
                    <button onClick={() => {
                      setComments(prev => prev.filter(x => x.id !== c.id));
                      if (activeFile?.id) supabase.from('plan_comments').delete().eq('id', c.id).then(() => {});
                      setCommentModal(null);
                      notify('Komentarz usuniety');
                    }} className="text-[10px] text-red-500 hover:text-red-700">Usun</button>
                    <button onClick={() => {
                      setComments(prev => prev.map(x => x.id === c.id ? { ...x, isResolved: !x.isResolved } : x));
                      if (activeFile?.id) supabase.from('plan_comments').update({ is_resolved: !c.isResolved }).eq('id', c.id).then(() => {});
                    }} className="text-[10px] text-green-600 hover:text-green-800">{c.isResolved ? 'Otworz ponownie' : 'Rozwiaz'}</button>
                  </div>
                </div>
                {/* Replies */}
                {c.replies.map((r: any, i: number) => (
                  <div key={i} className="ml-4 bg-blue-50 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-slate-700">{r.authorName || 'User'}</span>
                      <span className="text-[10px] text-slate-400">{r.createdAt ? new Date(r.createdAt).toLocaleString('pl-PL') : ''}</span>
                    </div>
                    <p className="text-sm text-slate-800">{r.content}</p>
                  </div>
                ))}
                {/* Reply input */}
                <div className="flex gap-2">
                  <input type="text" value={replyText} onChange={e => setReplyText(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && replyText.trim()) {
                        const reply = { id: crypto.randomUUID(), authorId: currentUser?.id || '', authorName: `${currentUser?.first_name || ''} ${currentUser?.last_name || ''}`.trim() || 'User', content: replyText.trim(), createdAt: new Date().toISOString() };
                        setComments(prev => prev.map(x => x.id === c.id ? { ...x, replies: [...x.replies, reply] } : x));
                        setReplyText('');
                      }
                    }}
                    className="flex-1 px-3 py-1.5 text-sm border border-slate-200 rounded-lg" placeholder="Odpowiedz..." />
                  <button disabled={!replyText.trim()} onClick={() => {
                    if (!replyText.trim()) return;
                    const reply = { id: crypto.randomUUID(), authorId: currentUser?.id || '', authorName: `${currentUser?.first_name || ''} ${currentUser?.last_name || ''}`.trim() || 'User', content: replyText.trim(), createdAt: new Date().toISOString() };
                    setComments(prev => prev.map(x => x.id === c.id ? { ...x, replies: [...x.replies, reply] } : x));
                    setReplyText('');
                  }} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg disabled:opacity-50">Wyslij</button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ===== PHOTO UPLOAD MODAL ===== */}
      {showPhotoModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" onClick={() => { setShowPhotoModal(false); setPendingPhotoPoint(null); setPendingPhotoPinId(null); }}>
          <div className="bg-white rounded-xl shadow-2xl w-80" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800">Dodaj zdjecie</h3>
              <button onClick={() => { setShowPhotoModal(false); setPendingPhotoPoint(null); setPendingPhotoPinId(null); }} className="p-1 hover:bg-slate-100 rounded"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-3">
              <button
                onClick={() => { photoInputRef.current?.setAttribute('capture', 'environment'); photoInputRef.current?.click(); setShowPhotoModal(false); }}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
              >
                <Camera className="w-4 h-4" /> Zrob zdjecie
              </button>
              <button
                onClick={() => { photoInputRef.current?.removeAttribute('capture'); photoInputRef.current?.click(); setShowPhotoModal(false); }}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 border border-slate-300 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50"
              >
                <Upload className="w-4 h-4" /> Zaladuj z urzadzenia
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== PHOTO GALLERY MODAL ===== */}
      {showPhotoGallery && (() => {
        const pin = photoPins.find(p => p.id === showPhotoGallery.pinId);
        if (!pin || pin.photos.length === 0) return null;
        const pinPhotos = pin.photos;
        const idx = galleryIndex >= 0 && galleryIndex < pinPhotos.length ? galleryIndex : 0;
        const photo = pinPhotos[idx];
        if (!photo) return null;
        return (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80" onClick={() => setShowPhotoGallery(null)}>
            <div className="bg-white rounded-xl shadow-2xl w-[700px] max-w-[95vw] max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-800">Zdjecie {idx + 1} z {pinPhotos.length}</h3>
                  <div className="flex items-center gap-3 text-[10px] text-slate-400 mt-0.5">
                    {photo.authorName && <span>Dodal: {photo.authorName}</span>}
                    {photo.createdAt && <span>{new Date(photo.createdAt).toLocaleString('pl-PL')}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {/* Add more photos to this pin */}
                  <button onClick={() => {
                    setPendingPhotoPinId(pin.id);
                    setPendingPhotoPoint(null);
                    photoInputRef.current?.removeAttribute('capture');
                    photoInputRef.current?.click();
                  }} className="p-1.5 hover:bg-blue-50 rounded text-slate-500 hover:text-blue-600" title="Dodaj wiecej zdjec">
                    <Plus className="w-4 h-4" />
                  </button>
                  <a href={photo.url} download className="p-1.5 hover:bg-slate-100 rounded text-slate-500" title="Pobierz"><Download className="w-4 h-4" /></a>
                  <button onClick={() => {
                    // Remove this photo from the pin
                    setPhotoPins(prev => prev.map(p => {
                      if (p.id !== pin.id) return p;
                      const remaining = p.photos.filter(ph => ph.id !== photo.id);
                      return { ...p, photos: remaining };
                    }).filter(p => p.photos.length > 0));
                    if (pinPhotos.length <= 1) setShowPhotoGallery(null);
                    else setGalleryIndex(Math.min(idx, pinPhotos.length - 2));
                    notify('Zdjecie usuniete');
                  }} className="p-1.5 hover:bg-red-50 rounded text-slate-500 hover:text-red-500" title="Usun"><Trash2 className="w-4 h-4" /></button>
                  <button onClick={() => setShowPhotoGallery(null)} className="p-1.5 hover:bg-slate-100 rounded"><X className="w-4 h-4" /></button>
                </div>
              </div>
              <div className="flex-1 flex items-center justify-center bg-slate-900 relative min-h-[400px]">
                {pinPhotos.length > 1 && (
                  <button onClick={() => setGalleryIndex((idx - 1 + pinPhotos.length) % pinPhotos.length)}
                    className="absolute left-2 z-10 p-2 bg-black/50 text-white rounded-full hover:bg-black/70">
                    <ChevronDown className="w-5 h-5 rotate-90" />
                  </button>
                )}
                <img src={photo.url} alt={photo.label || 'Zdjecie'} className="max-w-full max-h-[70vh] object-contain" />
                {pinPhotos.length > 1 && (
                  <button onClick={() => setGalleryIndex((idx + 1) % pinPhotos.length)}
                    className="absolute right-2 z-10 p-2 bg-black/50 text-white rounded-full hover:bg-black/70">
                    <ChevronDown className="w-5 h-5 -rotate-90" />
                  </button>
                )}
              </div>
              {/* Thumbnails */}
              {pinPhotos.length > 1 && (
                <div className="px-3 py-2 bg-slate-50 border-t border-slate-200 flex gap-2 overflow-x-auto">
                  {pinPhotos.map((p, i) => (
                    <button key={p.id} onClick={() => setGalleryIndex(i)}
                      className={`w-14 h-14 rounded-lg overflow-hidden flex-shrink-0 border-2 ${i === idx ? 'border-blue-500' : 'border-transparent hover:border-slate-300'}`}>
                      <img src={p.url} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ===== TEXT INPUT OVERLAY ===== */}
      {textInput && (() => {
        const svg = svgOverlayRef.current;
        if (!svg) return null;
        const svgRect = svg.getBoundingClientRect();
        const left = svgRect.left + textInput.x;
        const top = svgRect.top + textInput.y;
        return (
          <div style={{ position: 'fixed', left: `${left}px`, top: `${top - 30}px`, zIndex: 200 }}>
            <input
              type="text"
              autoFocus
              value={textInput.text}
              onChange={e => setTextInput({ ...textInput, text: e.target.value })}
              onKeyDown={e => {
                e.stopPropagation();
                if (e.key === 'Enter') handleTextAnnotationSubmit();
                if (e.key === 'Escape') setTextInput(null);
              }}
              onBlur={() => setTimeout(handleTextAnnotationSubmit, 100)}
              onMouseDown={e => e.stopPropagation()}
              style={{ width: '250px', padding: '6px 10px', fontSize: '13px', border: '2px solid #3b82f6', borderRadius: '8px', outline: 'none', background: 'white', boxShadow: '0 4px 16px rgba(0,0,0,0.2)' }}
              placeholder={textInput.toolType === 'callout' ? 'Wpisz odnosnik...' : 'Wpisz tekst...'}
            />
          </div>
        );
      })()}

      {/* Notification toast */}
      {notification && (
        <div className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] px-4 py-2.5 rounded-xl shadow-xl text-sm font-medium ${
          notification.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {notification.msg}
        </div>
      )}
    </div>
  );
};

export default PlansWorkspace;
