import React, { useReducer, useState, useCallback, useEffect, useRef } from 'react';
import { Loader2, X } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import { useAppContext } from '../../../context/AppContext';
import { supabase } from '../../../lib/supabase';
import type { Project } from '../../../types';
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
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [folders, setFolders] = useState<FolderWithPlans[]>([]);
  const [allPlans, setAllPlans] = useState<PlanRecord[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<PlanRecord | null>(null);
  const [projectSearch, setProjectSearch] = useState('');
  const [fileSearch, setFileSearch] = useState('');
  const [loading, setLoading] = useState(true);

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
  const [textInput, setTextInput] = useState<{ x: number; y: number; text: string } | null>(null);
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

  // ---- Photo pins ----
  const [photoPins, setPhotoPins] = useState<{ id: string; x: number; y: number; url: string; label?: string }[]>([]);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [pendingPhotoPoint, setPendingPhotoPoint] = useState<DrawPoint | null>(null);

  // ---- Hover tooltip ----
  const [hoverTooltip, setHoverTooltip] = useState<{ x: number; y: number; obj: DrawingObject } | null>(null);

  // ---- Box selection ----
  const [boxSelectStart, setBoxSelectStart] = useState<{ x: number; y: number } | null>(null);
  const [boxSelectEnd, setBoxSelectEnd] = useState<{ x: number; y: number } | null>(null);

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
    if (selectedProject) loadPlansData();
  }, [selectedProject]);

  const loadProjects = async () => {
    if (!currentUser?.company_id) return;
    try {
      const { data } = await supabase.from('projects').select('*')
        .eq('company_id', currentUser.company_id).eq('is_active', true).order('name');
      if (data) {
        setProjects(data);
        if (data.length > 0 && !selectedProject) setSelectedProject(data[0]);
      }
    } catch (err) {
      console.error('Load projects error:', err);
    } finally {
      setLoading(false);
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
        setPhotoPins(photoData.map((p: any) => ({
          id: p.id,
          x: p.position_x,
          y: p.position_y,
          url: p.photo_url,
          label: p.label,
        })));
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

      const { error: insertErr } = await supabase.from('plans').insert({
        project_id: selectedProject.id,
        component_id: selectedProject.id,
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

  // ---- Snapshot ----

  const handleSnapshot = useCallback(() => {
    const container = viewerContainerRef.current;
    if (!container) return;

    // Use canvas if PDF, or capture the viewer area
    const canvas = pdfCanvasRef.current;
    if (canvas && fileFormat === 'pdf') {
      const link = document.createElement('a');
      link.download = `snapshot_${activeFile?.name || 'plan'}_${Date.now()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      notify('Zrzut ekranu zapisany');
      return;
    }

    // For other formats, use html2canvas-style approach via SVG overlay
    const svg = svgOverlayRef.current;
    if (svg) {
      const serializer = new XMLSerializer();
      const svgStr = serializer.serializeToString(svg);
      const blob = new Blob([svgStr], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `snapshot_${activeFile?.name || 'plan'}_${Date.now()}.svg`;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
      notify('Zrzut ekranu zapisany (SVG)');
      return;
    }

    notify('Brak widoku do zrzutu', 'error');
  }, [fileFormat, activeFile, notify]);

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
    const file = e.target.files?.[0];
    if (!file || !pendingPhotoPoint || !selectedPlan || !selectedProject) return;

    try {
      const safeName = sanitizeFileName(file.name);
      const path = `plan-photos/${selectedProject.id}/${Date.now()}_${safeName}`;
      const { error: uploadErr } = await supabase.storage.from('plan-files').upload(path, file);
      if (uploadErr) throw uploadErr;
      const { data: urlData } = supabase.storage.from('plan-files').getPublicUrl(path);

      const pin = {
        id: `photo-${Date.now()}`,
        x: pendingPhotoPoint.x,
        y: pendingPhotoPoint.y,
        url: urlData.publicUrl,
        label: file.name,
      };
      setPhotoPins(prev => [...prev, pin]);

      // Persist
      await supabase.from('plan_photos').insert({
        plan_id: selectedPlan.id,
        position_x: pendingPhotoPoint.x,
        position_y: pendingPhotoPoint.y,
        photo_url: urlData.publicUrl,
        label: file.name,
        created_by: currentUser?.id,
      });

      notify('Zdjecie dodane');
    } catch (err: any) {
      notify(err.message || 'Blad przesylania zdjecia', 'error');
    }

    setPendingPhotoPoint(null);
    if (photoInputRef.current) photoInputRef.current.value = '';
  }, [pendingPhotoPoint, selectedPlan, selectedProject, currentUser, notify]);

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

  const handleSvgMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const pt = getOverlayCoords(e);
    if (!pt) return;

    // Scale calibration mode intercepts clicks
    if (isCalibrating) {
      handleCalibrationClick(pt);
      return;
    }

    // Select tool: start box selection
    if (ws.activeTool === 'select') {
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
      setTextInput({ x: pt.x, y: pt.y, text: '' });
      return;
    }

    if (ws.activeTool === 'count-marker') {
      setCountMarkers(prev => [...prev, pt]);
      return;
    }

    if (ws.activeTool === 'comment') {
      const commentText = prompt('Dodaj komentarz:');
      if (!commentText) return;
      const newComment: CommentThread = {
        id: `comment-${Date.now()}`,
        fileId: activeFile?.id || '',
        positionX: pt.x,
        positionY: pt.y,
        authorId: currentUser?.id || '',
        authorName: `${currentUser?.first_name || ''} ${currentUser?.last_name || ''}`.trim() || 'User',
        content: commentText,
        isResolved: false,
        replies: [],
        createdAt: new Date().toISOString(),
      };
      setComments(prev => [...prev, newComment]);
      // Persist comment
      if (activeFile?.id) {
        supabase.from('plan_comments').insert({
          plan_id: activeFile.id,
          position_x: pt.x,
          position_y: pt.y,
          author_id: currentUser?.id,
          content: commentText,
          is_resolved: false,
        }).then(() => {});
      }
      return;
    }

    if (ws.activeTool === 'camera') {
      setPendingPhotoPoint(pt);
      photoInputRef.current?.click();
      return;
    }

    if (ws.activeTool === 'erase') {
      // Find and remove nearest annotation
      const threshold = 20;
      setAnnotations(prev => {
        const remaining = prev.filter(ann => {
          const geom = ann.geometry;
          if (!geom || !geom.points || geom.points.length === 0) return true;
          const firstPt = geom.points[0];
          const dist = Math.sqrt((firstPt.x - pt.x) ** 2 + (firstPt.y - pt.y) ** 2);
          return dist > threshold;
        });
        return remaining;
      });
      return;
    }

    setIsDrawing(true);
    setDrawPoints([pt]);
  }, [ws.activeTool, getOverlayCoords, currentUser, activeFile]);

  const handleSvgMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const pt = getOverlayCoords(e);
    if (!pt) return;

    // Box selection drag
    if (ws.activeTool === 'select' && boxSelectStart) {
      setBoxSelectEnd({ x: pt.x, y: pt.y });
      return;
    }

    // Hover tooltip for select/pan modes
    if ((ws.activeTool === 'select' || ws.activeTool === 'pan') && !isDrawing) {
      // Find nearest object by checking if any objects have geometry near point
      // For now, check annotations/measurements near cursor
      setHoverTooltip(null); // Clear — real hit-testing requires APS viewer integration
    }

    if (!isDrawing) return;

    if (ws.activeTool === 'pen' || ws.activeTool === 'highlighter') {
      setDrawPoints(prev => [...prev, pt]);
    } else {
      // For shapes, only track start + current
      setDrawPoints(prev => [prev[0], pt]);
    }
  }, [isDrawing, ws.activeTool, getOverlayCoords, boxSelectStart]);

  const handleSvgMouseUp = useCallback(() => {
    // Complete box selection
    if (ws.activeTool === 'select' && boxSelectStart && boxSelectEnd) {
      const minX = Math.min(boxSelectStart.x, boxSelectEnd.x);
      const maxX = Math.max(boxSelectStart.x, boxSelectEnd.x);
      const minY = Math.min(boxSelectStart.y, boxSelectEnd.y);
      const maxY = Math.max(boxSelectStart.y, boxSelectEnd.y);
      // Select annotations within box
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

    if (['measure-length', 'measure-area', 'measure-polyline'].includes(tool)) {
      // Create measurement
      const p0 = drawPoints[0];
      const p1 = drawPoints[drawPoints.length - 1];
      const pixelDist = Math.sqrt((p1.x - p0.x) ** 2 + (p1.y - p0.y) ** 2);
      const scaleFactor = activeFile?.scale_ratio || 1;
      const realValue = pixelDist * scaleFactor;

      const measurement: MeasurementItem = {
        id: `meas-${Date.now()}`,
        type: tool === 'measure-area' ? 'area' : 'length',
        value: Math.round(realValue * 100) / 100,
        unit: tool === 'measure-area' ? 'm2' : 'mm',
        points: [...drawPoints],
        createdBy: currentUser?.id || '',
        createdAt: new Date().toISOString(),
      };
      setMeasurements(prev => [...prev, measurement]);
      if (activeFile?.id) api.saveMeasurement(measurement, activeFile.id);
    } else {
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
    }

    setIsDrawing(false);
    setDrawPoints([]);
  }, [isDrawing, drawPoints, ws.activeTool, strokeColor, strokeWidth, currentUser, activeFile, boxSelectStart, boxSelectEnd, annotations]);

  // ---- Text annotation submit ----
  const handleTextAnnotationSubmit = useCallback(() => {
    if (!textInput || !textInput.text.trim()) { setTextInput(null); return; }
    const annotation: AnnotationItem = {
      id: `ann-${Date.now()}`,
      type: ws.activeTool === 'callout' ? 'callout' : 'text',
      geometry: { points: [{ x: textInput.x, y: textInput.y }] },
      text: textInput.text,
      strokeColor,
      strokeWidth,
      createdBy: currentUser?.id || '',
      createdAt: new Date().toISOString(),
    };
    setAnnotations(prev => [...prev, annotation]);
    setTextInput(null);
  }, [textInput, ws.activeTool, strokeColor, strokeWidth, currentUser]);

  // ---- Keyboard shortcuts ----

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'Escape') {
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
  }, [ws.isFullscreen, textInput]);

  // ---- SVG Overlay Rendering ----

  const renderSvgAnnotations = () => {
    const parts: React.ReactNode[] = [];

    // Existing annotations
    for (const ann of annotations) {
      const pts = ann.geometry?.points as DrawPoint[] | undefined;
      if (!pts || pts.length === 0) continue;

      const key = ann.id;
      const sc = ann.strokeColor;
      const sw = ann.strokeWidth;

      switch (ann.type) {
        case 'freehand': {
          if (pts.length < 2) break;
          const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
          parts.push(
            <path key={key} d={d} stroke={sc} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round"
              opacity={sw > 8 ? 0.4 : 1} />
          );
          break;
        }
        case 'rectangle': {
          if (pts.length < 2) break;
          const x = Math.min(pts[0].x, pts[1].x);
          const y = Math.min(pts[0].y, pts[1].y);
          const w = Math.abs(pts[1].x - pts[0].x);
          const h = Math.abs(pts[1].y - pts[0].y);
          parts.push(<rect key={key} x={x} y={y} width={w} height={h} stroke={sc} strokeWidth={sw} fill="none" />);
          break;
        }
        case 'ellipse': {
          if (pts.length < 2) break;
          const cx = (pts[0].x + pts[1].x) / 2;
          const cy = (pts[0].y + pts[1].y) / 2;
          const rx = Math.abs(pts[1].x - pts[0].x) / 2;
          const ry = Math.abs(pts[1].y - pts[0].y) / 2;
          parts.push(<ellipse key={key} cx={cx} cy={cy} rx={rx} ry={ry} stroke={sc} strokeWidth={sw} fill="none" />);
          break;
        }
        case 'arrow':
        case 'line': {
          if (pts.length < 2) break;
          parts.push(
            <line key={key} x1={pts[0].x} y1={pts[0].y} x2={pts[1].x} y2={pts[1].y}
              stroke={sc} strokeWidth={sw}
              markerEnd={ann.type === 'arrow' ? 'url(#arrowhead)' : undefined} />
          );
          break;
        }
        case 'text':
        case 'callout': {
          parts.push(
            <g key={key}>
              {ann.type === 'callout' && (
                <rect x={pts[0].x - 4} y={pts[0].y - 16} width={(ann.text?.length || 1) * 8 + 8} height={22}
                  rx={4} fill="white" stroke={sc} strokeWidth={1} />
              )}
              <text x={pts[0].x} y={pts[0].y} fill={sc} fontSize={14} fontFamily="sans-serif">
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
          // Cloud shape with scalloped edges
          const scallops = Math.max(4, Math.round((w + h) / 30));
          let d = '';
          // Top edge
          for (let i = 0; i < scallops; i++) {
            const sx = x + (w / scallops) * i;
            const ex = x + (w / scallops) * (i + 1);
            const r = (ex - sx) / 2;
            d += `${i === 0 ? 'M' : ''} ${sx} ${y} A ${r} ${r * 0.7} 0 0 1 ${ex} ${y} `;
          }
          // Right edge
          const rScallops = Math.max(2, Math.round(h / 30));
          for (let i = 0; i < rScallops; i++) {
            const sy = y + (h / rScallops) * i;
            const ey = y + (h / rScallops) * (i + 1);
            const r = (ey - sy) / 2;
            d += `A ${r * 0.7} ${r} 0 0 1 ${x + w} ${ey} `;
          }
          // Bottom edge (reverse)
          for (let i = scallops - 1; i >= 0; i--) {
            const sx = x + (w / scallops) * (i + 1);
            const ex = x + (w / scallops) * i;
            const r = (sx - ex) / 2;
            d += `A ${r} ${r * 0.7} 0 0 1 ${ex} ${y + h} `;
          }
          // Left edge (reverse)
          for (let i = rScallops - 1; i >= 0; i--) {
            const sy = y + (h / rScallops) * (i + 1);
            const ey = y + (h / rScallops) * i;
            const r = (sy - ey) / 2;
            d += `A ${r * 0.7} ${r} 0 0 1 ${x} ${ey} `;
          }
          d += 'Z';
          parts.push(<path key={key} d={d} stroke={sc} strokeWidth={sw} fill="rgba(239,68,68,0.08)" />);
          break;
        }
      }
    }

    // Measurements
    for (const m of measurements) {
      if (!m.points || m.points.length < 2) continue;
      const p0 = m.points[0];
      const p1 = m.points[m.points.length - 1];
      const midX = (p0.x + p1.x) / 2;
      const midY = (p0.y + p1.y) / 2;
      parts.push(
        <g key={m.id}>
          <line x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y}
            stroke="#2563eb" strokeWidth={2} strokeDasharray="6 3" />
          <circle cx={p0.x} cy={p0.y} r={4} fill="#2563eb" />
          <circle cx={p1.x} cy={p1.y} r={4} fill="#2563eb" />
          <rect x={midX - 30} y={midY - 12} width={60} height={18} rx={4} fill="white" stroke="#2563eb" strokeWidth={1} />
          <text x={midX} y={midY + 2} textAnchor="middle" fontSize={11} fill="#2563eb" fontFamily="sans-serif" fontWeight="bold">
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
      parts.push(
        <g key={`cpin-${c.id}`} style={{ cursor: 'pointer' }}>
          <circle cx={c.positionX} cy={c.positionY} r={14}
            fill={c.isResolved ? '#22c55e' : '#f59e0b'} stroke="white" strokeWidth={2} />
          <text x={c.positionX} y={c.positionY + 5} textAnchor="middle" fontSize={12} fill="white" fontFamily="sans-serif" fontWeight="bold">
            💬
          </text>
        </g>
      );
    }

    // Photo pins
    for (const pin of photoPins) {
      parts.push(
        <g key={`photo-${pin.id}`} style={{ cursor: 'pointer' }}
          onClick={() => window.open(pin.url, '_blank')}>
          <circle cx={pin.x} cy={pin.y} r={14} fill="#3b82f6" stroke="white" strokeWidth={2} />
          <text x={pin.x} y={pin.y + 5} textAnchor="middle" fontSize={12} fill="white" fontFamily="sans-serif">📷</text>
          {pin.label && (
            <text x={pin.x + 18} y={pin.y + 4} fontSize={10} fill="#3b82f6" fontFamily="sans-serif">{pin.label}</text>
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

    // Current drawing in progress
    if (isDrawing && drawPoints.length >= 2) {
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
      } else if (tool === 'arrow' || tool === 'line' || tool.startsWith('measure-')) {
        parts.push(
          <line key="drawing-preview" x1={drawPoints[0].x} y1={drawPoints[0].y}
            x2={drawPoints[1].x} y2={drawPoints[1].y}
            stroke={tool.startsWith('measure-') ? '#2563eb' : strokeColor}
            strokeWidth={strokeWidth} strokeDasharray="4 2"
            markerEnd={tool === 'arrow' ? 'url(#arrowhead)' : undefined} />
        );
        // Show live measurement
        if (tool.startsWith('measure-')) {
          const dist = Math.sqrt(
            (drawPoints[1].x - drawPoints[0].x) ** 2 + (drawPoints[1].y - drawPoints[0].y) ** 2
          );
          const scale = activeFile?.scale_ratio || 1;
          const midX = (drawPoints[0].x + drawPoints[1].x) / 2;
          const midY = (drawPoints[0].y + drawPoints[1].y) / 2;
          parts.push(
            <text key="measure-live" x={midX} y={midY - 8}
              textAnchor="middle" fontSize={12} fill="#2563eb" fontWeight="bold" fontFamily="sans-serif">
              {(dist * scale).toFixed(1)} mm
            </text>
          );
        }
      }
    }

    return parts;
  };

  // ---- SVG Overlay Component ----

  const renderOverlaySvg = (naturalW: number, naturalH: number) => {
    if (naturalW === 0 || naturalH === 0) return null;
    const cursorStyle = isAnnotationTool(ws.activeTool) ? 'crosshair' : ws.activeTool === 'select' ? 'default' : ws.activeTool === 'pan' ? 'grab' : 'default';

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
        onMouseLeave={() => { if (isDrawing) handleSvgMouseUp(); }}
      >
        {/* Arrow marker definition */}
        <defs>
          <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill={strokeColor} />
          </marker>
        </defs>
        {renderSvgAnnotations()}

        {/* Text input overlay */}
        {textInput && (
          <foreignObject x={textInput.x} y={textInput.y - 20} width={200} height={30}>
            <input
              type="text"
              autoFocus
              value={textInput.text}
              onChange={e => setTextInput({ ...textInput, text: e.target.value })}
              onKeyDown={e => {
                if (e.key === 'Enter') handleTextAnnotationSubmit();
                if (e.key === 'Escape') setTextInput(null);
              }}
              onBlur={handleTextAnnotationSubmit}
              className="w-full px-2 py-1 text-xs border border-blue-500 rounded shadow-lg bg-white"
              placeholder="Wpisz tekst..."
            />
          </foreignObject>
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
    const filteredProjects = projects.filter(p =>
      !projectSearch || p.name.toLowerCase().includes(projectSearch.toLowerCase())
    );
    return (
      <div className="flex flex-col items-center justify-center h-full p-8">
        <h2 className="text-lg font-bold text-slate-800 mb-4">Wybierz projekt</h2>
        <input type="text" value={projectSearch} onChange={e => setProjectSearch(e.target.value)}
          placeholder="Szukaj projektu..." className="px-4 py-2 border border-slate-300 rounded-lg text-sm w-80 mb-4" />
        <div className="w-80 max-h-96 overflow-y-auto space-y-1">
          {filteredProjects.map(p => (
            <button key={p.id} onClick={() => setSelectedProject(p)}
              className="w-full text-left px-4 py-3 rounded-lg hover:bg-blue-50 border border-slate-200 text-sm font-medium text-slate-700">
              {p.name}
            </button>
          ))}
        </div>
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
    <div className={`flex h-full bg-slate-100 ${ws.isFullscreen ? 'fixed inset-0 z-[80]' : ''}`}>
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
          />
        </div>
      )}

      {/* Center workspace */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Toolbar */}
        {activeFile && (
          <WorkspaceTopToolbar
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
        <div ref={viewerContainerRef} className="flex-1 overflow-hidden relative bg-slate-200">
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
            <div className="w-full h-full overflow-auto flex flex-col items-center p-4">
              <div className="relative inline-block">
                <canvas ref={pdfCanvasRef} className="shadow-lg rounded-lg bg-white" />
                {/* Annotation SVG overlay on top of PDF canvas */}
                {pdfNaturalSize.w > 0 && renderOverlaySvg(pdfNaturalSize.w, pdfNaturalSize.h)}
              </div>
              <div className="flex items-center gap-3 mt-3 flex-shrink-0">
                <button onClick={() => setShowPdfAnalysis(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg text-xs font-medium hover:bg-purple-700 shadow-sm">
                  Analizuj PDF (AI)
                </button>
                <button onClick={handleOpenInAps}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 shadow-sm">
                  Otworz w Autodesk Viewer
                </button>
                <a href={activeFile.file_url} download className="flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-xs font-medium hover:bg-slate-50">
                  Pobierz PDF
                </a>
              </div>
            </div>
          ) : showDxfViewer ? (
            <div className="w-full h-full overflow-auto flex flex-col items-center p-4">
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
              <div className="flex items-center gap-3 mt-3 flex-shrink-0">
                <button onClick={() => setShowDxfAnalysis(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg text-xs font-medium hover:bg-purple-700 shadow-sm">
                  Analizuj DXF (AI)
                </button>
                <button onClick={handleOpenInAps}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 shadow-sm">
                  Otworz w Autodesk Viewer
                </button>
                <a href={activeFile.file_url} download className="flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-xs font-medium hover:bg-slate-50">
                  Pobierz DXF
                </a>
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
              dispatch({ type: 'SET_ACTIVE_TOOL', tool });
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
          photos={photoPins}
          onDeletePhoto={(id) => {
            setPhotoPins(prev => prev.filter(p => p.id !== id));
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
        accept="image/*" onChange={handlePhotoUpload} />

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
