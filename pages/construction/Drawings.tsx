import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Plus, Search, FileImage, ChevronRight, Loader2,
  Upload, Eye, EyeOff, Download, Trash2, ZoomIn, ZoomOut,
  Move, Type, Circle, Square, ArrowUpRight, Ruler,
  X, MoreVertical, ArrowLeft, Maximize2, Minimize2,
  GripVertical, BookOpen, ArrowUpDown, Clock, Pencil, Eraser,
  Lock, Unlock, PenTool, Hexagon, Minus,
  ListTodo, LayoutList, ChevronDown, FolderPlus,
  CloudUpload, RotateCcw
} from 'lucide-react';
import { useAppContext } from '../../context/AppContext';
import { supabase } from '../../lib/supabase';
import { Project } from '../../types';

// =====================================================
// TYPES
// =====================================================

interface PlanFolder {
  id: string;
  project_id: string;
  parent_id?: string | null;
  name: string;
  code?: string;
  description?: string;
  sort_order: number;
  created_by_id: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

interface PlanRecord {
  id: string;
  component_id: string;
  project_id: string;
  name: string;
  description?: string;
  file_url: string;
  thumbnail_url?: string;
  original_filename?: string;
  mime_type?: string;
  file_size?: number;
  width?: number;
  height?: number;
  calibration_enabled?: boolean;
  calibration_length?: number;
  calibration_pixels?: number;
  scale_ratio?: number;
  version: number;
  is_current_version: boolean;
  parent_plan_id?: string | null;
  sort_order: number;
  is_active?: boolean;
  created_by_id: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

interface PlanVersion {
  id: string;
  file_url: string;
  original_filename?: string;
  version: number;
  is_current_version: boolean;
  created_at: string;
  created_by_id?: string;
}

interface FolderWithPlans extends PlanFolder {
  plans: PlanRecord[];
  isExpanded: boolean;
}

type AnnotationTool = 'pointer' | 'pen' | 'highlighter' | 'cloud' | 'rectangle' | 'ellipse' | 'polygon' | 'arrow' | 'line' | 'text' | 'eraser';

interface VisibilityState {
  private: boolean;
  public: boolean;
  measurements: boolean;
  drawings: boolean;
  shapes: boolean;
  texts: boolean;
}

// =====================================================
// HELPERS
// =====================================================

const sanitizeFileName = (name: string): string => {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .replace(/[^a-zA-Z0-9._-]/g, '_');
};

const formatFileSize = (bytes?: number): string => {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};

const isPdfFile = (plan: PlanRecord): boolean => {
  return plan.mime_type === 'application/pdf' ||
    (plan.original_filename || '').toLowerCase().endsWith('.pdf') ||
    (plan.file_url || '').toLowerCase().includes('.pdf');
};

const hasValidFile = (plan: PlanRecord): boolean => {
  return !!(plan.file_url && plan.file_url !== 'placeholder' && plan.file_url.startsWith('http'));
};

// =====================================================
// MAIN COMPONENT
// =====================================================

export const DrawingsPage: React.FC = () => {
  const { state } = useAppContext();
  const { currentUser } = state;

  // --- Data state ---
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [folders, setFolders] = useState<FolderWithPlans[]>([]);
  const [allPlans, setAllPlans] = useState<PlanRecord[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<FolderWithPlans | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<PlanRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [projectSearch, setProjectSearch] = useState('');

  // --- Viewer state ---
  const [zoom, setZoom] = useState(100);
  const [activeTool, setActiveTool] = useState<AnnotationTool>('pointer');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [visibility, setVisibility] = useState<VisibilityState>({
    private: true, public: true, measurements: true, drawings: true, shapes: true, texts: true
  });

  // --- Popups / Modals ---
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showSortModal, setShowSortModal] = useState(false);
  const [showVisibilityPopup, setShowVisibilityPopup] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showUploadDropdown, setShowUploadDropdown] = useState(false);
  const [showUpdateDropdown, setShowUpdateDropdown] = useState(false);
  const [showPenDropdown, setShowPenDropdown] = useState(false);
  const [showShapeDropdown, setShowShapeDropdown] = useState(false);
  const [showEraserDropdown, setShowEraserDropdown] = useState(false);
  const [showVersionModal, setShowVersionModal] = useState(false);
  const [showScaleModal, setShowScaleModal] = useState(false);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [notification, setNotification] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  // --- Edit state ---
  const [editName, setEditName] = useState('');
  const [editParentPlan, setEditParentPlan] = useState('');
  const [saving, setSaving] = useState(false);

  // --- Create modal ---
  const [createName, setCreateName] = useState('');
  const [createFolderId, setCreateFolderId] = useState('');
  const [createFile, setCreateFile] = useState<File | null>(null);
  const [createAskApproval, setCreateAskApproval] = useState(false);
  const [uploading, setUploading] = useState(false);

  // --- New folder ---
  const [newFolderName, setNewFolderName] = useState('');

  // --- Scale calibration ---
  const [scaleDistance, setScaleDistance] = useState('');
  const [scaleUnit, setScaleUnit] = useState('centymetr');

  // --- Versions ---
  const [planVersions, setPlanVersions] = useState<PlanVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState('');

  // --- Drag reorder ---
  const [dragOverPlanId, setDragOverPlanId] = useState<string | null>(null);
  const [draggedPlanId, setDraggedPlanId] = useState<string | null>(null);

  // --- Refs ---
  const fileInputRef = useRef<HTMLInputElement>(null);
  const createFileInputRef = useRef<HTMLInputElement>(null);
  const updateFileInputRef = useRef<HTMLInputElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);

  const MAX_PLANS = 500;

  // =====================================================
  // NOTIFICATIONS
  // =====================================================

  const showNotification = (msg: string, type: 'success' | 'error' = 'success') => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 3000);
  };

  // =====================================================
  // DATA LOADING
  // =====================================================

  useEffect(() => {
    if (currentUser) loadProjects();
  }, [currentUser]);

  useEffect(() => {
    if (selectedProject) loadPlansData();
  }, [selectedProject]);

  useEffect(() => {
    if (selectedPlan) {
      setEditName(selectedPlan.name);
      setEditParentPlan(selectedPlan.parent_plan_id || '');
    } else if (selectedFolder) {
      setEditName(selectedFolder.name);
      setEditParentPlan('');
    }
  }, [selectedPlan, selectedFolder]);

  const loadProjects = async () => {
    if (!currentUser) return;
    try {
      const { data } = await supabase
        .from('projects')
        .select('*')
        .eq('company_id', currentUser.company_id)
        .order('created_at', { ascending: false });
      if (data) setProjects(data);
    } catch (err) {
      console.error('Error loading projects:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadPlansData = async () => {
    if (!selectedProject) return;
    setLoading(true);
    try {
      const [foldersRes, plansRes] = await Promise.all([
        supabase
          .from('plan_components')
          .select('*')
          .eq('project_id', selectedProject.id)
          .is('deleted_at', null)
          .order('sort_order'),
        supabase
          .from('plans')
          .select('*')
          .eq('project_id', selectedProject.id)
          .is('deleted_at', null)
          .eq('is_current_version', true)
          .order('sort_order')
      ]);

      const foldersData: PlanFolder[] = foldersRes.data || [];
      const plansData: PlanRecord[] = plansRes.data || [];
      setAllPlans(plansData);

      const foldersWithPlans: FolderWithPlans[] = foldersData.map(f => ({
        ...f,
        plans: plansData.filter(p => p.component_id === f.id),
        isExpanded: true
      }));

      setFolders(foldersWithPlans);

      // Auto-select first folder if none selected
      if (!selectedFolder && foldersWithPlans.length > 0) {
        setSelectedFolder(foldersWithPlans[0]);
        setEditName(foldersWithPlans[0].name);
      } else if (selectedFolder) {
        // Refresh the selected folder data
        const updated = foldersWithPlans.find(f => f.id === selectedFolder.id);
        if (updated) setSelectedFolder(updated);
      }

      // Refresh the selected plan data
      if (selectedPlan) {
        const updatedPlan = plansData.find(p => p.id === selectedPlan.id);
        if (updatedPlan) setSelectedPlan(updatedPlan);
      }
    } catch (err) {
      console.error('Error loading plans:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadVersions = async (planId: string) => {
    try {
      const plan = allPlans.find(p => p.id === planId);
      const rootId = plan?.parent_plan_id || planId;

      const { data } = await supabase
        .from('plans')
        .select('id, file_url, original_filename, version, is_current_version, created_at, created_by_id')
        .or(`id.eq.${rootId},parent_plan_id.eq.${rootId}`)
        .is('deleted_at', null)
        .order('version', { ascending: false });

      if (data && data.length > 0) {
        setPlanVersions(data);
        const current = data.find(v => v.is_current_version);
        if (current) setSelectedVersionId(current.id);
      } else {
        // If no versions found, just show current plan
        setPlanVersions([{
          id: planId,
          file_url: plan?.file_url || '',
          original_filename: plan?.original_filename,
          version: plan?.version || 1,
          is_current_version: true,
          created_at: plan?.created_at || ''
        }]);
        setSelectedVersionId(planId);
      }
    } catch (err) {
      console.error('Error loading versions:', err);
    }
  };

  // =====================================================
  // FILTERED DATA
  // =====================================================

  const totalPlans = allPlans.length;

  const filteredFolders = useMemo(() => {
    if (!search.trim()) return folders;
    const s = search.toLowerCase();
    return folders.map(f => ({
      ...f,
      plans: f.plans.filter(p =>
        p.name.toLowerCase().includes(s) ||
        (p.original_filename || '').toLowerCase().includes(s)
      )
    })).filter(f =>
      f.name.toLowerCase().includes(s) || f.plans.length > 0
    );
  }, [folders, search]);

  // =====================================================
  // FILE UPLOAD LOGIC
  // =====================================================

  const uploadFileToStorage = async (file: File, projectId: string): Promise<{ url: string; error?: string } | null> => {
    try {
      const safeName = sanitizeFileName(file.name);
      const filePath = `${projectId}/${Date.now()}_${safeName}`;

      const { error: uploadError } = await supabase.storage
        .from('plans')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type || 'application/octet-stream'
        });

      if (uploadError) {
        console.error('Storage upload error:', uploadError);
        return { url: '', error: uploadError.message };
      }

      const { data: urlData } = supabase.storage
        .from('plans')
        .getPublicUrl(filePath);

      return { url: urlData?.publicUrl || '' };
    } catch (err: any) {
      console.error('Upload exception:', err);
      return { url: '', error: err.message };
    }
  };

  // =====================================================
  // CRUD - CREATE PLAN
  // =====================================================

  const handleCreatePlan = async () => {
    if (!currentUser || !selectedProject || !createName.trim()) return;
    setUploading(true);
    try {
      let folderId = createFolderId;

      // If no folder selected, use first or create default
      if (!folderId) {
        if (folders.length > 0) {
          folderId = folders[0].id;
        } else {
          const { data: newFolder, error: folderError } = await supabase
            .from('plan_components')
            .insert({
              project_id: selectedProject.id,
              name: 'DOKUMENTY BUDOWLANE',
              sort_order: 0,
              created_by_id: currentUser.id
            })
            .select()
            .single();

          if (folderError) {
            showNotification('Błąd tworzenia folderu: ' + folderError.message, 'error');
            return;
          }
          folderId = newFolder.id;
        }
      }

      let fileUrl = '';
      let originalFilename = '';
      let mimeType = '';
      let fileSize = 0;

      if (createFile) {
        const result = await uploadFileToStorage(createFile, selectedProject.id);
        if (!result || result.error) {
          showNotification('Błąd przesyłania pliku: ' + (result?.error || 'Nieznany błąd'), 'error');
          return;
        }
        fileUrl = result.url;
        originalFilename = createFile.name;
        mimeType = createFile.type;
        fileSize = createFile.size;
      }

      const { error: insertError } = await supabase
        .from('plans')
        .insert({
          project_id: selectedProject.id,
          component_id: folderId,
          name: createName.trim(),
          file_url: fileUrl || 'placeholder',
          original_filename: originalFilename || null,
          mime_type: mimeType || null,
          file_size: fileSize || null,
          version: 1,
          is_current_version: true,
          created_by_id: currentUser.id,
          sort_order: allPlans.length
        });

      if (insertError) {
        showNotification('Błąd zapisu: ' + insertError.message, 'error');
        return;
      }

      showNotification('Rzut został utworzony');
      setShowCreateModal(false);
      setCreateName('');
      setCreateFolderId('');
      setCreateFile(null);
      setCreateAskApproval(false);
      await loadPlansData();
    } catch (err: any) {
      showNotification('Błąd: ' + err.message, 'error');
    } finally {
      setUploading(false);
    }
  };

  // =====================================================
  // CRUD - UPLOAD FILE TO FOLDER (drop zone)
  // =====================================================

  const handleUploadToFolder = async (file: File, folder?: FolderWithPlans | null) => {
    if (!currentUser || !selectedProject) return;
    const targetFolder = folder || selectedFolder;
    if (!targetFolder) {
      showNotification('Wybierz folder docelowy', 'error');
      return;
    }
    setUploading(true);
    try {
      const result = await uploadFileToStorage(file, selectedProject.id);
      if (!result || result.error) {
        showNotification('Błąd przesyłania: ' + (result?.error || 'Nieznany błąd'), 'error');
        return;
      }

      const { error } = await supabase
        .from('plans')
        .insert({
          project_id: selectedProject.id,
          component_id: targetFolder.id,
          name: file.name.replace(/\.[^/.]+$/, ''),
          file_url: result.url,
          original_filename: file.name,
          mime_type: file.type,
          file_size: file.size,
          version: 1,
          is_current_version: true,
          created_by_id: currentUser.id,
          sort_order: allPlans.length
        });

      if (error) {
        showNotification('Błąd zapisu: ' + error.message, 'error');
        return;
      }

      showNotification('Plik został przesłany');
      await loadPlansData();
    } catch (err: any) {
      showNotification('Błąd: ' + err.message, 'error');
    } finally {
      setUploading(false);
    }
  };

  // =====================================================
  // CRUD - UPDATE PLAN FILE (new version)
  // =====================================================

  const handleUpdatePlanFile = async (file: File) => {
    if (!currentUser || !selectedProject || !selectedPlan) return;
    setUploading(true);
    try {
      const result = await uploadFileToStorage(file, selectedProject.id);
      if (!result || result.error) {
        showNotification('Błąd przesyłania: ' + (result?.error || 'Nieznany błąd'), 'error');
        return;
      }

      // Mark old as not current
      await supabase
        .from('plans')
        .update({ is_current_version: false })
        .eq('id', selectedPlan.id);

      // Create new version
      const { data: newPlan, error } = await supabase
        .from('plans')
        .insert({
          project_id: selectedProject.id,
          component_id: selectedPlan.component_id,
          name: selectedPlan.name,
          file_url: result.url,
          original_filename: file.name,
          mime_type: file.type,
          file_size: file.size,
          version: (selectedPlan.version || 1) + 1,
          is_current_version: true,
          parent_plan_id: selectedPlan.parent_plan_id || selectedPlan.id,
          created_by_id: currentUser.id,
          sort_order: selectedPlan.sort_order
        })
        .select()
        .single();

      if (error) {
        showNotification('Błąd zapisu wersji: ' + error.message, 'error');
        return;
      }

      if (newPlan) setSelectedPlan(newPlan);
      showNotification('Nowa wersja została przesłana');
      await loadPlansData();
    } catch (err: any) {
      showNotification('Błąd: ' + err.message, 'error');
    } finally {
      setUploading(false);
    }
  };

  // =====================================================
  // CRUD - DELETE
  // =====================================================

  const handleDeletePlan = async () => {
    if (!selectedPlan) return;
    if (!confirm('Czy na pewno chcesz usunąć ten rzut?')) return;
    try {
      await supabase
        .from('plans')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', selectedPlan.id);
      setSelectedPlan(null);
      showNotification('Rzut został usunięty');
      await loadPlansData();
    } catch (err: any) {
      showNotification('Błąd usuwania: ' + err.message, 'error');
    }
  };

  const handleDeleteOldVersions = async () => {
    if (!selectedProject) return;
    if (!confirm('Czy na pewno chcesz usunąć stare wersje wszystkich planów?')) return;
    try {
      const { error } = await supabase
        .from('plans')
        .update({ deleted_at: new Date().toISOString() })
        .eq('project_id', selectedProject.id)
        .eq('is_current_version', false)
        .is('deleted_at', null);

      if (error) {
        showNotification('Błąd: ' + error.message, 'error');
        return;
      }
      showNotification('Stare wersje zostały usunięte');
      await loadPlansData();
    } catch (err: any) {
      showNotification('Błąd: ' + err.message, 'error');
    }
  };

  // =====================================================
  // CRUD - SAVE NAME / PARENT
  // =====================================================

  const handleSaveName = async () => {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      if (selectedPlan) {
        const { error } = await supabase
          .from('plans')
          .update({
            name: editName.trim(),
            parent_plan_id: editParentPlan || null
          })
          .eq('id', selectedPlan.id);
        if (error) { showNotification('Błąd zapisu: ' + error.message, 'error'); return; }
        setSelectedPlan({ ...selectedPlan, name: editName.trim(), parent_plan_id: editParentPlan || null });
      } else if (selectedFolder) {
        const { error } = await supabase
          .from('plan_components')
          .update({ name: editName.trim() })
          .eq('id', selectedFolder.id);
        if (error) { showNotification('Błąd zapisu: ' + error.message, 'error'); return; }
      }
      await loadPlansData();
    } catch (err: any) {
      showNotification('Błąd: ' + err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  // =====================================================
  // CRUD - CREATE FOLDER
  // =====================================================

  const handleCreateFolder = async () => {
    if (!currentUser || !selectedProject || !newFolderName.trim()) return;
    try {
      const { error } = await supabase
        .from('plan_components')
        .insert({
          project_id: selectedProject.id,
          name: newFolderName.trim().toUpperCase(),
          sort_order: folders.length,
          created_by_id: currentUser.id
        });

      if (error) {
        showNotification('Błąd tworzenia grupy: ' + error.message, 'error');
        return;
      }

      showNotification('Grupa została utworzona');
      setNewFolderName('');
      setShowNewFolderInput(false);
      await loadPlansData();
    } catch (err: any) {
      showNotification('Błąd: ' + err.message, 'error');
    }
  };

  // =====================================================
  // SORT
  // =====================================================

  const handleSort = async (direction: 'asc' | 'desc') => {
    try {
      const sortedFolders = [...folders];
      sortedFolders.sort((a, b) => direction === 'asc'
        ? a.name.localeCompare(b.name, 'pl')
        : b.name.localeCompare(a.name, 'pl')
      );
      sortedFolders.forEach(f => {
        f.plans.sort((a, b) => direction === 'asc'
          ? a.name.localeCompare(b.name, 'pl')
          : b.name.localeCompare(a.name, 'pl')
        );
      });

      // Persist sort order
      const updates: Promise<any>[] = [];
      for (let i = 0; i < sortedFolders.length; i++) {
        updates.push(supabase.from('plan_components').update({ sort_order: i }).eq('id', sortedFolders[i].id));
        for (let j = 0; j < sortedFolders[i].plans.length; j++) {
          updates.push(supabase.from('plans').update({ sort_order: j }).eq('id', sortedFolders[i].plans[j].id));
        }
      }
      await Promise.all(updates);

      setFolders(sortedFolders);
      setShowSortModal(false);
      showNotification('Posortowano');
    } catch (err: any) {
      showNotification('Błąd sortowania: ' + err.message, 'error');
    }
  };

  // =====================================================
  // SCALE CALIBRATION
  // =====================================================

  const handleScaleCalibration = async () => {
    if (!selectedPlan || !scaleDistance) return;
    try {
      const { error } = await supabase
        .from('plans')
        .update({
          calibration_enabled: true,
          calibration_length: parseFloat(scaleDistance)
        })
        .eq('id', selectedPlan.id);

      if (error) {
        showNotification('Błąd kalibracji: ' + error.message, 'error');
        return;
      }
      showNotification('Skala została skalibrowana');
      setShowScaleModal(false);
      setScaleDistance('');
    } catch (err: any) {
      showNotification('Błąd: ' + err.message, 'error');
    }
  };

  // =====================================================
  // DRAG & DROP
  // =====================================================

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0 && files[0]) {
      if (selectedPlan && hasValidFile(selectedPlan)) {
        handleUpdatePlanFile(files[0]);
      } else if (selectedFolder) {
        handleUploadToFolder(files[0]);
      }
    }
  }, [selectedPlan, selectedFolder, selectedProject, currentUser]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  // Drag reorder in plan list
  const handlePlanDragStart = (planId: string) => setDraggedPlanId(planId);

  const handlePlanDragOver = (e: React.DragEvent, planId: string) => {
    e.preventDefault();
    setDragOverPlanId(planId);
  };

  const handlePlanDrop = async (targetPlanId: string) => {
    if (!draggedPlanId || draggedPlanId === targetPlanId) {
      setDraggedPlanId(null);
      setDragOverPlanId(null);
      return;
    }

    try {
      // Find both plans
      const allFolderPlans = folders.flatMap(f => f.plans);
      const draggedIdx = allFolderPlans.findIndex(p => p.id === draggedPlanId);
      const targetIdx = allFolderPlans.findIndex(p => p.id === targetPlanId);

      if (draggedIdx !== -1 && targetIdx !== -1) {
        const reordered = [...allFolderPlans];
        const [moved] = reordered.splice(draggedIdx, 1);
        reordered.splice(targetIdx, 0, moved);

        const updates = reordered.map((p, i) =>
          supabase.from('plans').update({ sort_order: i }).eq('id', p.id)
        );
        await Promise.all(updates);
        await loadPlansData();
      }
    } catch (err) {
      console.error('Drag reorder error:', err);
    }

    setDraggedPlanId(null);
    setDragOverPlanId(null);
  };

  // =====================================================
  // CLOSE ALL POPUPS HELPER
  // =====================================================

  const closeAllPopups = () => {
    setShowVisibilityPopup(false);
    setShowMoreMenu(false);
    setShowUploadDropdown(false);
    setShowUpdateDropdown(false);
    setShowPenDropdown(false);
    setShowShapeDropdown(false);
    setShowEraserDropdown(false);
  };

  // =====================================================
  // RENDER: PROJECT SELECTION
  // =====================================================

  if (!selectedProject) {
    return (
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900 mb-4">Plany i rzuty</h1>
          <p className="text-slate-500 mb-4">Wybierz projekt, aby zarządzać planami i rzutami.</p>
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              placeholder="Szukaj projektu..."
              value={projectSearch}
              onChange={e => setProjectSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
            />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-16">
            <FileImage className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            <p className="text-lg text-slate-500">Brak projektów</p>
            <p className="text-sm text-slate-400 mt-1">Utwórz projekt w zakładce "Projekty" aby rozpocząć.</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {projects
              .filter(p => p.name.toLowerCase().includes(projectSearch.toLowerCase()))
              .map(project => (
                <button
                  key={project.id}
                  onClick={() => { setSelectedProject(project); setLoading(true); }}
                  className="text-left p-4 bg-white rounded-xl border border-slate-200 hover:border-blue-300 hover:shadow-lg transition group"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center"
                      style={{ backgroundColor: (project.color || '#3b82f6') + '20' }}
                    >
                      <FileImage className="w-6 h-6" style={{ color: project.color || '#3b82f6' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-slate-900 truncate group-hover:text-blue-600">{project.name}</h3>
                      <p className="text-sm text-slate-500">{project.code || 'Brak kodu'}</p>
                    </div>
                    <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-blue-500 transition" />
                  </div>
                </button>
              ))}
          </div>
        )}
      </div>
    );
  }

  // =====================================================
  // RENDER: MAIN SPLIT-PANEL LAYOUT
  // =====================================================

  const viewingPlan = selectedPlan && hasValidFile(selectedPlan);
  const isPdf = selectedPlan ? isPdfFile(selectedPlan) : false;

  return (
    <div className="h-full flex flex-col bg-slate-50" onClick={closeAllPopups}>
      {/* Notification */}
      {notification && (
        <div className={`fixed top-4 right-4 z-[100] px-4 py-3 rounded-lg shadow-lg text-white text-sm font-medium transition-all ${
          notification.type === 'success' ? 'bg-green-600' : 'bg-red-600'
        }`}>
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

      {/* ===== TOP BAR ===== */}
      <div className="bg-white border-b-[3px] border-blue-600 px-4 py-2.5 flex items-center gap-3 flex-shrink-0">
        <button
          onClick={() => { setSelectedProject(null); setSelectedPlan(null); setSelectedFolder(null); setFolders([]); setAllPlans([]); }}
          className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 transition"
          title="Powrót do projektów"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        <button
          onClick={(e) => {
            e.stopPropagation();
            setCreateName('');
            setCreateFolderId(selectedFolder?.id || '');
            setCreateFile(null);
            setCreateAskApproval(false);
            setShowCreateModal(true);
          }}
          className="px-5 py-2 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 transition text-sm whitespace-nowrap shadow-sm"
        >
          Utwórz rzuty
        </button>

        {/* Progress */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="w-32 h-2 bg-slate-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-600 rounded-full transition-all duration-300"
              style={{ width: `${Math.min(100, (totalPlans / MAX_PLANS) * 100)}%` }}
            />
          </div>
          <span className="text-sm text-slate-600 whitespace-nowrap">{totalPlans} z {MAX_PLANS} plany</span>
        </div>

        {/* Search */}
        <div className="flex-1 max-w-xs">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Szukaj"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onClick={e => e.stopPropagation()}
              className="w-full pl-8 pr-3 py-1.5 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>

        <div className="flex-1" />

        <button
          onClick={handleDeleteOldVersions}
          className="flex items-center gap-2 px-4 py-2 bg-red-700 text-white rounded-md font-medium hover:bg-red-800 transition text-sm whitespace-nowrap shadow-sm"
        >
          <Trash2 className="w-4 h-4" />
          Usuń stare wersje planu
        </button>
      </div>

      {/* ===== SPLIT PANEL ===== */}
      <div className="flex-1 flex overflow-hidden">

        {/* ===== LEFT PANEL ===== */}
        <div className="w-[380px] min-w-[320px] border-r border-slate-300 bg-white flex flex-col overflow-hidden flex-shrink-0">
          {/* Header */}
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
            <span className="font-semibold text-slate-700 text-sm">Plany i rzuty</span>
            <div className="flex items-center gap-1">
              <button
                onClick={(e) => { e.stopPropagation(); setShowNewFolderInput(!showNewFolderInput); }}
                className="p-1.5 hover:bg-slate-100 rounded text-slate-500 transition"
                title="Nowa grupa"
              >
                <FolderPlus className="w-4 h-4" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setShowSortModal(true); }}
                className="p-1.5 hover:bg-slate-100 rounded text-slate-500 transition"
                title="Sortuj"
              >
                <ArrowUpDown className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* New folder input */}
          {showNewFolderInput && (
            <div className="px-3 py-2 border-b border-slate-200 bg-blue-50 flex items-center gap-2">
              <input
                type="text"
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreateFolder()}
                placeholder="Nazwa grupy..."
                className="flex-1 px-2 py-1.5 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
                autoFocus
                onClick={e => e.stopPropagation()}
              />
              <button
                onClick={handleCreateFolder}
                disabled={!newFolderName.trim()}
                className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                Dodaj
              </button>
              <button onClick={() => { setShowNewFolderInput(false); setNewFolderName(''); }} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Folder & plan list */}
          <div className="flex-1 overflow-y-auto">
            {loading && folders.length === 0 ? (
              <div className="flex items-center justify-center h-32">
                <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
              </div>
            ) : filteredFolders.length === 0 ? (
              <div className="text-center py-10 px-4">
                <FileImage className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                <p className="text-sm text-slate-400">Brak planów.</p>
                <p className="text-xs text-slate-400 mt-1">Kliknij "Utwórz rzuty" aby dodać pierwszy rzut.</p>
              </div>
            ) : (
              filteredFolders.map(folder => (
                <div key={folder.id}>
                  {/* Folder header */}
                  <div
                    className={`flex items-center gap-2 px-3 py-3 cursor-pointer transition-colors border-b border-slate-100 ${
                      selectedFolder?.id === folder.id && !selectedPlan
                        ? 'bg-[#2c3e50] text-white'
                        : 'bg-slate-50 hover:bg-slate-100 text-slate-800'
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedFolder(folder);
                      setSelectedPlan(null);
                      setEditName(folder.name);
                      setEditParentPlan('');
                    }}
                  >
                    <GripVertical className={`w-4 h-4 flex-shrink-0 ${
                      selectedFolder?.id === folder.id && !selectedPlan ? 'opacity-50' : 'opacity-30'
                    }`} />
                    <span className="font-bold text-xs uppercase tracking-wider flex-1 truncate">
                      {folder.name}
                    </span>
                  </div>

                  {/* Plans in folder */}
                  {folder.plans.map(plan => (
                    <div
                      key={plan.id}
                      draggable
                      onDragStart={() => handlePlanDragStart(plan.id)}
                      onDragOver={(e) => handlePlanDragOver(e, plan.id)}
                      onDrop={() => handlePlanDrop(plan.id)}
                      className={`flex items-center gap-2 px-3 py-3 cursor-pointer border-b border-slate-50 transition-colors ${
                        selectedPlan?.id === plan.id
                          ? 'bg-[#2c3e50] text-white'
                          : dragOverPlanId === plan.id
                          ? 'bg-blue-50 border-l-4 border-l-blue-400'
                          : 'hover:bg-slate-50 bg-white'
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedPlan(plan);
                        setSelectedFolder(folder);
                        setEditName(plan.name);
                        setEditParentPlan(plan.parent_plan_id || '');
                        setZoom(100);
                      }}
                    >
                      <GripVertical className={`w-4 h-4 flex-shrink-0 cursor-grab ${
                        selectedPlan?.id === plan.id ? 'opacity-50' : 'opacity-25'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-semibold truncate ${
                          selectedPlan?.id === plan.id ? 'text-white' : 'text-slate-900'
                        }`}>
                          {plan.name}
                        </p>
                        <p className={`text-xs truncate ${
                          selectedPlan?.id === plan.id ? 'text-slate-300' : 'text-slate-500'
                        }`}>
                          {plan.original_filename || `${plan.name}.pdf`}
                        </p>
                      </div>
                      {selectedPlan?.id === plan.id && (
                        <div className="w-px h-7 bg-white/30 mx-1 flex-shrink-0" />
                      )}
                      <BookOpen className={`w-5 h-5 flex-shrink-0 ${
                        selectedPlan?.id === plan.id ? 'text-white/70' : 'text-slate-400'
                      }`} />
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>

        {/* ===== RIGHT PANEL ===== */}
        <div className="flex-1 flex flex-col overflow-hidden bg-white" onClick={e => e.stopPropagation()}>
          {/* Right header */}
          <div className="px-4 py-2.5 border-b border-slate-200 flex items-center gap-3 flex-shrink-0 bg-white">
            <span className="text-sm text-slate-500 whitespace-nowrap font-medium">Nazwa</span>
            <input
              type="text"
              value={editName}
              onChange={e => setEditName(e.target.value)}
              onBlur={handleSaveName}
              onKeyDown={e => e.key === 'Enter' && handleSaveName()}
              className="px-3 py-1.5 border border-slate-300 rounded-md text-sm w-48 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder={selectedPlan ? 'Nazwa planu' : 'Nazwa grupy'}
            />

            <span className="text-sm text-slate-500 whitespace-nowrap font-medium">Rzut nadrzędny</span>
            <select
              value={editParentPlan}
              onChange={e => { setEditParentPlan(e.target.value); }}
              onBlur={handleSaveName}
              className="px-3 py-1.5 border border-slate-300 rounded-md text-sm flex-1 max-w-[220px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">Rzut nadrzędny</option>
              {allPlans
                .filter(p => p.id !== selectedPlan?.id)
                .map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
            </select>

            <div className="flex-1" />

            {/* Three-dot menu */}
            <div className="relative" onClick={e => e.stopPropagation()}>
              <button
                onClick={() => setShowMoreMenu(!showMoreMenu)}
                className="p-1.5 hover:bg-slate-100 rounded-md text-slate-500 transition"
              >
                <MoreVertical className="w-5 h-5" />
              </button>
              {showMoreMenu && (
                <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-slate-200 rounded-lg shadow-xl z-50 py-1">
                  <button className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition"
                    onClick={() => setShowMoreMenu(false)}>
                    <ListTodo className="w-4 h-4 text-slate-400" /> Widok listy zadań
                  </button>
                  <button className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition"
                    onClick={() => setShowMoreMenu(false)}>
                    <LayoutList className="w-4 h-4 text-slate-400" /> Widok planu zadań
                  </button>
                  {selectedPlan && (
                    <>
                      <div className="border-t border-slate-100 my-1" />
                      <button className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition"
                        onClick={() => { setShowMoreMenu(false); setShowScaleModal(true); }}>
                        <Ruler className="w-4 h-4 text-slate-400" /> Skalibruj skalę
                      </button>
                      <button className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 transition"
                        onClick={() => { setShowMoreMenu(false); handleDeletePlan(); }}>
                        <Trash2 className="w-4 h-4" /> Usuń rzut
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ===== VIEWER or DROP ZONE ===== */}
          {viewingPlan ? (
            <div className={`flex-1 flex flex-col overflow-hidden ${isFullscreen ? 'fixed inset-0 z-[80] bg-white' : ''}`}>
              {/* Viewer toolbar */}
              <div className="px-3 py-2 border-b border-slate-200 flex items-center gap-0.5 flex-shrink-0 bg-white" onClick={e => e.stopPropagation()}>
                {/* Zoom */}
                <button onClick={() => setZoom(z => Math.min(z + 25, 400))}
                  className="p-1.5 hover:bg-slate-100 rounded-md text-slate-600 transition" title="Powiększ">
                  <ZoomIn className="w-5 h-5" />
                </button>
                <button onClick={() => setZoom(z => Math.max(z - 25, 25))}
                  className="p-1.5 hover:bg-slate-100 rounded-md text-slate-600 transition" title="Pomniejsz">
                  <ZoomOut className="w-5 h-5" />
                </button>

                <div className="w-px h-6 bg-slate-200 mx-1" />

                {/* Visibility */}
                <div className="relative">
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowVisibilityPopup(!showVisibilityPopup); }}
                    className={`p-1.5 rounded-md transition ${showVisibilityPopup || !Object.values(visibility).every(v => v) ? 'bg-yellow-400 text-white' : 'hover:bg-slate-100 text-slate-600'}`}
                    title="Widoczność oznaczeń"
                  >
                    <Eye className="w-5 h-5" />
                  </button>
                  {showVisibilityPopup && (
                    <div className="absolute left-0 top-full mt-1 w-56 bg-white border border-slate-200 rounded-lg shadow-xl z-50 py-2" onClick={e => e.stopPropagation()}>
                      <div className="px-4 py-1.5 text-sm font-semibold text-slate-800 border-b border-slate-100 mb-1">Widoczność oznaczeń</div>
                      {[
                        { key: 'private' as const, label: 'Prywatne', icon: Lock },
                        { key: 'public' as const, label: 'Publiczne', icon: Unlock },
                        { key: 'measurements' as const, label: 'Pomiary', icon: Pencil },
                        { key: 'drawings' as const, label: 'Rysunki', icon: PenTool },
                        { key: 'shapes' as const, label: 'Kształty', icon: Hexagon },
                        { key: 'texts' as const, label: 'Teksty', icon: Type },
                      ].map(item => (
                        <button key={item.key}
                          className="w-full flex items-center gap-3 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition"
                          onClick={() => setVisibility(v => ({ ...v, [item.key]: !v[item.key] }))}>
                          <item.icon className="w-4 h-4 text-slate-400" />
                          <span className="flex-1 text-left">{item.label}</span>
                          {visibility[item.key]
                            ? <Eye className="w-4 h-4 text-slate-500" />
                            : <EyeOff className="w-4 h-4 text-slate-300" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Fullscreen */}
                <button onClick={() => setIsFullscreen(!isFullscreen)}
                  className="p-1.5 hover:bg-slate-100 rounded-md text-slate-600 transition" title="Pełny ekran">
                  {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
                </button>

                {/* Fit */}
                <button onClick={() => setZoom(100)}
                  className="p-1.5 hover:bg-slate-100 rounded-md text-slate-600 transition" title="Dopasuj do widoku">
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                  </svg>
                </button>

                <div className="w-px h-6 bg-slate-200 mx-1" />

                {/* Filename + zoom % */}
                <span className="text-sm text-slate-500 px-2 truncate max-w-[200px]">{selectedPlan!.original_filename || selectedPlan!.name}</span>
                <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded">{zoom}%</span>

                <div className="w-px h-6 bg-slate-200 mx-1" />

                {/* Versions */}
                <button onClick={() => { loadVersions(selectedPlan!.id); setShowVersionModal(true); }}
                  className="p-1.5 hover:bg-slate-100 rounded-md text-slate-600 transition" title="Wersje">
                  <RotateCcw className="w-5 h-5" />
                </button>

                {/* Upload update */}
                <div className="relative">
                  <button onClick={(e) => { e.stopPropagation(); setShowUpdateDropdown(!showUpdateDropdown); }}
                    className="p-1.5 hover:bg-slate-100 rounded-md text-slate-600 transition" title="Zaktualizuj plik">
                    <Upload className="w-5 h-5" />
                  </button>
                  {showUpdateDropdown && (
                    <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-slate-200 rounded-lg shadow-xl z-50 py-1" onClick={e => e.stopPropagation()}>
                      <button className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition"
                        onClick={() => { setShowUpdateDropdown(false); updateFileInputRef.current?.click(); }}>
                        <div className="flex items-center gap-2"><CloudUpload className="w-4 h-4 text-slate-400" /><span>Zaktualizuj</span></div>
                        <span className="text-xs bg-slate-100 px-2 py-0.5 rounded font-medium">Prześlij</span>
                      </button>
                      <button className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-slate-400 cursor-not-allowed">
                        <div className="flex items-center gap-2"><CloudUpload className="w-4 h-4" /><span>Dropbox</span></div>
                        <span className="text-xs bg-blue-50 text-blue-500 px-2 py-0.5 rounded font-medium">Dropbox</span>
                      </button>
                      <button className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-slate-400 cursor-not-allowed">
                        <div className="flex items-center gap-2"><CloudUpload className="w-4 h-4" /><span>Google Drive</span></div>
                        <span className="text-xs bg-green-50 text-green-500 px-2 py-0.5 rounded font-medium">Google Drive</span>
                      </button>
                      <button className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-slate-400 cursor-not-allowed">
                        <div className="flex items-center gap-2"><CloudUpload className="w-4 h-4" /><span>OneDrive</span></div>
                        <span className="text-xs bg-sky-50 text-sky-500 px-2 py-0.5 rounded font-medium">OneDrive</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Download */}
                <a href={selectedPlan!.file_url} download={selectedPlan!.original_filename || selectedPlan!.name}
                  className="p-1.5 hover:bg-slate-100 rounded-md text-slate-600 transition" title="Pobieranie"
                  target="_blank" rel="noopener noreferrer">
                  <Download className="w-5 h-5" />
                </a>

                {/* Delete */}
                <button onClick={handleDeletePlan}
                  className="p-1.5 hover:bg-red-50 rounded-md text-red-400 hover:text-red-600 transition" title="Usuń">
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>

              {/* Plan viewer */}
              <div ref={viewerRef} className="flex-1 overflow-auto bg-slate-100 relative"
                onDrop={handleFileDrop} onDragOver={handleDragOver}>
                <div className="min-h-full flex items-center justify-center p-4"
                  style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center', transition: 'transform 0.2s ease' }}>
                  {isPdf ? (
                    <iframe src={selectedPlan!.file_url + '#toolbar=0&navpanes=0'}
                      className="bg-white shadow-lg border border-slate-200"
                      style={{ width: '100%', height: '85vh', minWidth: '700px', maxWidth: '1200px' }}
                      title={selectedPlan!.name} />
                  ) : (
                    <img src={selectedPlan!.file_url} alt={selectedPlan!.name}
                      className="shadow-lg bg-white border border-slate-200"
                      style={{ maxWidth: '100%', imageRendering: zoom > 200 ? 'pixelated' : 'auto' }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                        showNotification('Nie można załadować obrazu', 'error');
                      }} />
                  )}
                </div>
              </div>

              {/* Bottom annotation toolbar */}
              <div className="px-4 py-2 border-t border-slate-200 bg-white flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                <button onClick={() => setActiveTool('pointer')}
                  className={`p-2.5 rounded-lg transition ${activeTool === 'pointer' ? 'bg-slate-200 shadow-inner' : 'hover:bg-slate-100'}`} title="Zaznacz">
                  <Move className="w-5 h-5 text-slate-600" />
                </button>

                {/* Pen dropdown */}
                <div className="relative">
                  <button onClick={(e) => { e.stopPropagation(); setShowPenDropdown(!showPenDropdown); }}
                    className={`p-2.5 rounded-lg flex items-center gap-0.5 transition ${['pen','highlighter'].includes(activeTool) ? 'bg-slate-200 shadow-inner' : 'hover:bg-slate-100'}`}>
                    <PenTool className="w-5 h-5 text-slate-600" /><ChevronDown className="w-3 h-3 text-slate-400" />
                  </button>
                  {showPenDropdown && (
                    <div className="absolute left-0 bottom-full mb-1 w-48 bg-white border border-slate-200 rounded-lg shadow-xl z-50 py-1" onClick={e => e.stopPropagation()}>
                      <div className="px-3 py-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">Rysowanie</div>
                      <button className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm transition ${activeTool === 'pen' ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'}`}
                        onClick={() => { setActiveTool('pen'); setShowPenDropdown(false); }}>
                        <PenTool className="w-4 h-4" /> Pióro
                      </button>
                      <button className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm transition ${activeTool === 'highlighter' ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'}`}
                        onClick={() => { setActiveTool('highlighter'); setShowPenDropdown(false); }}>
                        <Pencil className="w-4 h-4" /> Zakreślacz
                      </button>
                    </div>
                  )}
                </div>

                {/* Shapes dropdown */}
                <div className="relative">
                  <button onClick={(e) => { e.stopPropagation(); setShowShapeDropdown(!showShapeDropdown); }}
                    className={`p-2.5 rounded-lg flex items-center gap-0.5 transition ${['cloud','rectangle','ellipse','polygon','arrow','line'].includes(activeTool) ? 'bg-slate-200 shadow-inner' : 'hover:bg-slate-100'}`}>
                    <Square className="w-5 h-5 text-slate-600" /><ChevronDown className="w-3 h-3 text-slate-400" />
                  </button>
                  {showShapeDropdown && (
                    <div className="absolute left-0 bottom-full mb-1 w-52 bg-white border border-slate-200 rounded-lg shadow-xl z-50 py-1" onClick={e => e.stopPropagation()}>
                      <div className="px-3 py-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">Kształty</div>
                      {([
                        { tool: 'cloud', label: 'Chmurka rewizyjna', icon: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16.5 18H7a5 5 0 1 1 .5-9.98A7.002 7.002 0 0 1 19 9a4.5 4.5 0 0 1-2.5 9Z" /></svg> },
                        { tool: 'rectangle', label: 'Prostokąt', icon: <Square className="w-4 h-4" /> },
                        { tool: 'ellipse', label: 'Elipsa', icon: <Circle className="w-4 h-4" /> },
                        { tool: 'polygon', label: 'Wielokąt', icon: <Hexagon className="w-4 h-4" /> },
                        { tool: 'arrow', label: 'Strzałka', icon: <ArrowUpRight className="w-4 h-4" /> },
                        { tool: 'line', label: 'Linia', icon: <Minus className="w-4 h-4" /> },
                      ] as { tool: AnnotationTool; label: string; icon: React.ReactNode }[]).map(item => (
                        <button key={item.tool}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm transition ${activeTool === item.tool ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'}`}
                          onClick={() => { setActiveTool(item.tool); setShowShapeDropdown(false); }}>
                          {item.icon} {item.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Text */}
                <button onClick={() => setActiveTool('text')}
                  className={`p-2.5 rounded-lg transition ${activeTool === 'text' ? 'bg-slate-200 shadow-inner' : 'hover:bg-slate-100'}`} title="Tekst">
                  <Type className="w-5 h-5 text-slate-600" />
                </button>

                {/* Eraser */}
                <div className="relative">
                  <button onClick={(e) => { e.stopPropagation(); setShowEraserDropdown(!showEraserDropdown); }}
                    className={`p-2.5 rounded-lg flex items-center gap-0.5 transition ${activeTool === 'eraser' ? 'bg-slate-200 shadow-inner' : 'hover:bg-slate-100'}`}>
                    <Eraser className="w-5 h-5 text-slate-600" /><ChevronDown className="w-3 h-3 text-slate-400" />
                  </button>
                  {showEraserDropdown && (
                    <div className="absolute left-0 bottom-full mb-1 w-44 bg-white border border-slate-200 rounded-lg shadow-xl z-50 py-1" onClick={e => e.stopPropagation()}>
                      <button className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition"
                        onClick={() => { setActiveTool('eraser'); setShowEraserDropdown(false); }}>
                        <Eraser className="w-4 h-4" /> Gumka
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Drop zone - no plan or no file */
            <div className="flex-1 flex flex-col items-center justify-center p-8" onDrop={handleFileDrop} onDragOver={handleDragOver}>
              <div className="border-2 border-dashed border-slate-300 rounded-2xl p-16 w-full max-w-xl text-center hover:border-blue-400 hover:bg-blue-50/30 transition-colors">
                <CloudUpload className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                <p className="text-lg text-slate-400 leading-relaxed">
                  Aby dodać plan, możesz przeciągnąć i upuścić plik planu tutaj albo
                </p>

                <div className="relative inline-block mt-6" onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => setShowUploadDropdown(!showUploadDropdown)}
                    className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition shadow-sm"
                  >
                    Wybierz plik planu.
                    <ChevronDown className="w-4 h-4" />
                  </button>
                  {showUploadDropdown && (
                    <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 w-60 bg-white border border-slate-200 rounded-lg shadow-xl z-50 py-1">
                      <button className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition"
                        onClick={() => { setShowUploadDropdown(false); fileInputRef.current?.click(); }}>
                        <div className="flex items-center gap-2"><CloudUpload className="w-4 h-4 text-slate-400" /><span>Wybierz plik planu.</span></div>
                        <span className="text-xs bg-slate-100 px-2 py-0.5 rounded font-medium">Prześlij</span>
                      </button>
                      <button className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-slate-400 cursor-not-allowed">
                        <div className="flex items-center gap-2"><CloudUpload className="w-4 h-4" /><span>Dropbox</span></div>
                        <span className="text-xs bg-blue-50 text-blue-500 px-2 py-0.5 rounded font-medium">Dropbox</span>
                      </button>
                      <button className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-slate-400 cursor-not-allowed">
                        <div className="flex items-center gap-2"><CloudUpload className="w-4 h-4" /><span>Google Drive</span></div>
                        <span className="text-xs bg-green-50 text-green-500 px-2 py-0.5 rounded font-medium">Google Drive</span>
                      </button>
                      <button className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-slate-400 cursor-not-allowed">
                        <div className="flex items-center gap-2"><CloudUpload className="w-4 h-4" /><span>OneDrive</span></div>
                        <span className="text-xs bg-sky-50 text-sky-500 px-2 py-0.5 rounded font-medium">OneDrive</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ===== HIDDEN FILE INPUTS ===== */}
      <input ref={fileInputRef} type="file" className="hidden" accept="image/*,.pdf,.dwg,.dxf"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleUploadToFolder(f); e.target.value = ''; }} />
      <input ref={updateFileInputRef} type="file" className="hidden" accept="image/*,.pdf,.dwg,.dxf"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleUpdatePlanFile(f); e.target.value = ''; }} />
      <input ref={createFileInputRef} type="file" className="hidden" accept="image/*,.pdf,.dwg,.dxf"
        onChange={e => { const f = e.target.files?.[0]; if (f) setCreateFile(f); e.target.value = ''; }} />

      {/* =====================================================
          MODALS
          ===================================================== */}

      {/* Sort Modal */}
      {showSortModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" onClick={() => setShowSortModal(false)}>
          <div className="bg-white rounded-xl w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="p-5 flex justify-between items-center border-b border-slate-100">
              <h2 className="text-lg font-bold text-orange-600">Sortowanie</h2>
              <button onClick={() => setShowSortModal(false)} className="p-1.5 hover:bg-slate-100 rounded-lg transition">
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
            <div className="p-5">
              <p className="font-semibold text-slate-800 text-base">Czy chcesz posortować alfabetycznie?</p>
              <p className="text-sm text-slate-500 mt-1">Twoje rzuty zostaną posortowane, ale hierarchia zostanie zachowana.</p>
            </div>
            <div className="px-5 pb-5 flex items-center gap-3">
              <button onClick={() => handleSort('asc')}
                className="px-4 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 text-sm transition shadow-sm">
                Sortuj rosnąco (0-9, A-Z)
              </button>
              <button onClick={() => handleSort('desc')}
                className="px-4 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 text-sm transition shadow-sm">
                Sortuj malejąco (Z-A, 9-0)
              </button>
              <button onClick={() => setShowSortModal(false)}
                className="px-4 py-2.5 border border-slate-300 rounded-lg font-medium hover:bg-slate-50 text-sm text-slate-700 transition">
                Anuluj
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Plan Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" onClick={() => setShowCreateModal(false)}>
          <div className="bg-white rounded-xl w-full max-w-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="p-5 flex justify-between items-center border-b border-slate-100">
              <h2 className="text-lg font-bold text-blue-600">Utwórz rzuty</h2>
              <button onClick={() => setShowCreateModal(false)}
                className="w-8 h-8 flex items-center justify-center bg-slate-700 text-white rounded-full hover:bg-slate-600 transition">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6">
              {/* Drag zone */}
              <div
                className={`border-2 border-dashed rounded-xl p-8 mb-5 text-center transition-colors ${
                  createFile ? 'border-blue-400 bg-blue-50/50' : 'border-slate-300 hover:border-blue-400 hover:bg-blue-50/30'
                }`}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setCreateFile(f); }}
                onDragOver={e => e.preventDefault()}
              >
                {createFile ? (
                  <div className="flex items-center justify-center gap-4">
                    <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                      <FileImage className="w-6 h-6 text-blue-600" />
                    </div>
                    <div className="text-left">
                      <p className="font-semibold text-slate-800">{createFile.name}</p>
                      <p className="text-sm text-slate-500">{formatFileSize(createFile.size)}</p>
                    </div>
                    <button onClick={() => setCreateFile(null)} className="p-1.5 hover:bg-slate-100 rounded-lg transition">
                      <X className="w-5 h-5 text-slate-400" />
                    </button>
                  </div>
                ) : (
                  <>
                    <Plus className="w-14 h-14 text-slate-300 mx-auto mb-2" />
                    <p className="text-sm text-slate-400">Przeciągnij plik tutaj</p>
                  </>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2 mb-5 flex-wrap">
                <button onClick={() => createFileInputRef.current?.click()}
                  className="px-4 py-2 bg-orange-500 text-white rounded-lg font-medium hover:bg-orange-600 text-sm transition shadow-sm">
                  Wybierz plik planu
                </button>
                <span className="text-sm text-slate-400">lub</span>
                <button onClick={() => setCreateFile(null)}
                  className="px-4 py-2 bg-slate-700 text-white rounded-lg font-medium hover:bg-slate-800 text-sm transition shadow-sm">
                  Utwórz rzut bez planu
                </button>
                <span className="text-sm text-slate-400">lub</span>
                <button className="px-4 py-2 bg-blue-500 text-white rounded-lg font-medium text-sm opacity-60 cursor-not-allowed" disabled>
                  Dropbox
                </button>
                <span className="text-sm text-slate-400">lub</span>
                <button className="px-4 py-2 bg-green-500 text-white rounded-lg font-medium text-sm opacity-60 cursor-not-allowed" disabled>
                  Google Drive
                </button>
                <span className="text-sm text-slate-400">lub</span>
                <button className="px-4 py-2 bg-sky-500 text-white rounded-lg font-medium text-sm opacity-60 cursor-not-allowed" disabled>
                  OneDrive
                </button>
              </div>

              {/* Name + folder */}
              <div className="flex items-center gap-3">
                <input type="text" value={createName} onChange={e => setCreateName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createName.trim() && handleCreatePlan()}
                  placeholder="Nazwa rzutu"
                  className="flex-1 px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                <select value={createFolderId} onChange={e => setCreateFolderId(e.target.value)}
                  className="px-3 py-2.5 border border-slate-300 rounded-lg text-sm flex-1 focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                  <option value="">-- Folder --</option>
                  {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
                <button onClick={() => createFileInputRef.current?.click()}
                  className="px-4 py-2.5 bg-slate-700 text-white rounded-lg font-medium hover:bg-slate-800 text-sm transition shadow-sm whitespace-nowrap">
                  Wybierz plik planu
                </button>
                <button onClick={() => { setCreateName(''); setCreateFile(null); setCreateFolderId(''); }}
                  className="p-2 text-orange-500 hover:bg-orange-50 rounded-lg transition">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between bg-slate-50 rounded-b-xl">
              <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
                <input type="checkbox" checked={createAskApproval} onChange={e => setCreateAskApproval(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                Poproś o akceptację
              </label>
              <div className="flex items-center gap-3">
                <button onClick={handleCreatePlan} disabled={!createName.trim() || uploading}
                  className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 text-sm disabled:opacity-50 transition shadow-sm flex items-center gap-2">
                  {uploading && <Loader2 className="w-4 h-4 animate-spin" />}
                  Zapisz
                </button>
                <button onClick={() => setShowCreateModal(false)}
                  className="px-6 py-2.5 border border-slate-300 rounded-lg font-medium hover:bg-white text-sm text-slate-700 transition">
                  Anuluj
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Version History Modal */}
      {showVersionModal && selectedPlan && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" onClick={() => setShowVersionModal(false)}>
          <div className="bg-white rounded-xl w-full max-w-6xl max-h-[90vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="p-4 flex items-center justify-between border-b border-slate-200 flex-shrink-0">
              <h2 className="text-lg font-semibold text-slate-800">Zobacz wersję planu</h2>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" className="rounded border-slate-300" /> Pokaż zadania
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" defaultChecked className="rounded border-slate-300 text-blue-600" /> Pokaż oznacz...
                </label>
                <button onClick={() => { setShowVersionModal(false); setShowCompareModal(true); }}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 text-sm transition shadow-sm">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 3h5v5M8 3H3v5M3 16v5h5M21 16v5h-5" /></svg>
                  Porównaj wersje
                </button>
                <button onClick={() => setShowVersionModal(false)} className="p-1.5 hover:bg-slate-100 rounded-lg transition">
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>
            </div>
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-3 flex-shrink-0">
                <span className="text-sm font-medium text-slate-600">Wersja planu</span>
                <select value={selectedVersionId} onChange={e => setSelectedVersionId(e.target.value)}
                  className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm flex-1 max-w-xl">
                  {planVersions.map(v => (
                    <option key={v.id} value={v.id}>
                      {v.original_filename || 'plan'} (V{v.version} {v.is_current_version ? 'Aktualna wersja' : ''})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1 overflow-auto bg-slate-100 p-4 flex items-center justify-center">
                {(() => {
                  const version = planVersions.find(v => v.id === selectedVersionId);
                  if (!version || !version.file_url) return <p className="text-slate-400">Wybierz wersję</p>;
                  const isVPdf = (version.original_filename || '').toLowerCase().endsWith('.pdf');
                  return isVPdf ? (
                    <iframe src={version.file_url + '#toolbar=0'} className="bg-white shadow-lg border" style={{ width: '100%', height: '70vh', minWidth: '600px' }} title="version" />
                  ) : (
                    <img src={version.file_url} alt="" className="max-w-full shadow-lg bg-white border" />
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Compare Versions Modal */}
      {showCompareModal && selectedPlan && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" onClick={() => setShowCompareModal(false)}>
          <div className="bg-white rounded-xl w-full max-w-3xl shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="p-5 flex justify-between items-center border-b border-slate-100">
              <h2 className="text-lg font-semibold text-slate-800">Wybierz wersję do porównania</h2>
              <button onClick={() => setShowCompareModal(false)} className="p-1.5 hover:bg-slate-100 rounded-lg transition">
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
            <div className="p-5">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-slate-200 text-left">
                    <th className="py-2.5 px-3 font-semibold text-slate-700">Plik planu</th>
                    <th className="py-2.5 px-3 font-semibold text-slate-700">Załadowane...</th>
                    <th className="py-2.5 px-3 font-semibold text-slate-700">Załadowano</th>
                    <th className="py-2.5 px-3 font-semibold text-slate-700">Status akcept...</th>
                    <th className="py-2.5 px-3 font-semibold text-slate-700">Wersja</th>
                    <th className="py-2.5 px-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {planVersions.map(v => (
                    <tr key={v.id} className="border-b border-slate-100 hover:bg-blue-50 cursor-pointer transition">
                      <td className="py-2.5 px-3 text-slate-700">{v.original_filename || 'plan'}</td>
                      <td className="py-2.5 px-3 text-slate-500">-</td>
                      <td className="py-2.5 px-3 text-slate-500">
                        {v.created_at ? new Date(v.created_at).toLocaleDateString('pl-PL') + ' ' + new Date(v.created_at).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) : '-'}
                      </td>
                      <td className="py-2.5 px-3 text-slate-500">-</td>
                      <td className="py-2.5 px-3">V{v.version} {v.is_current_version ? 'Aktualna wersja' : ''}</td>
                      <td className="py-2.5 px-3">
                        {v.id === selectedVersionId && (
                          <span className="px-3 py-1 border border-slate-300 rounded-full text-xs text-slate-600 bg-slate-50">Wyświetlono</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {planVersions.length === 0 && (
                    <tr><td colSpan={6} className="text-center py-8 text-slate-400">Brak wersji do porównania</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Scale Calibration Modal */}
      {showScaleModal && selectedPlan && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" onClick={() => setShowScaleModal(false)}>
          <div className="bg-white rounded-xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="p-5 flex justify-between items-center border-b border-slate-100 flex-shrink-0">
              <h2 className="text-lg font-bold text-slate-800">Skalibruj skalę</h2>
              <button onClick={() => setShowScaleModal(false)} className="p-1.5 hover:bg-slate-100 rounded-lg transition">
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
            <div className="px-5 py-3 bg-blue-50 border-b border-blue-100 flex-shrink-0">
              <p className="text-sm text-slate-700">
                Na potrzeby kalibracji dostosuj pozycję dwóch pinezek na planie. W tym celu należy wprowadzić rzeczywistą odległość między nimi.
              </p>
            </div>
            <div className="px-5 py-4 border-b border-slate-200 flex-shrink-0">
              <p className="text-sm font-semibold text-slate-800 mb-3">Wprowadź odległość między dwoma punktami</p>
              <div className="flex items-center gap-3">
                <input type="number" value={scaleDistance} onChange={e => setScaleDistance(e.target.value)}
                  placeholder="Wprowadź odległość"
                  className="px-3 py-2.5 border border-slate-300 rounded-lg text-sm w-56 focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                <select value={scaleUnit} onChange={e => setScaleUnit(e.target.value)}
                  className="px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500">
                  <option value="centymetr">centymetr</option>
                  <option value="metr">metr</option>
                  <option value="milimetr">milimetr</option>
                  <option value="cal">cal</option>
                  <option value="stopa">stopa</option>
                </select>
              </div>
            </div>
            <div className="flex-1 overflow-auto bg-slate-100 p-4 flex items-center justify-center min-h-[350px]">
              {isPdfFile(selectedPlan) ? (
                <iframe src={selectedPlan.file_url + '#toolbar=0'} className="bg-white shadow-lg border rounded"
                  style={{ width: '100%', height: '50vh', minWidth: '500px' }} title="calibration" />
              ) : (
                <img src={selectedPlan.file_url} alt={selectedPlan.name}
                  className="max-w-full max-h-[50vh] shadow-lg bg-white border rounded" />
              )}
            </div>
            <div className="p-4 border-t border-slate-200 flex justify-end gap-3 flex-shrink-0 bg-slate-50 rounded-b-xl">
              <button onClick={handleScaleCalibration} disabled={!scaleDistance}
                className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 text-sm disabled:opacity-50 transition shadow-sm">
                OK
              </button>
              <button onClick={() => setShowScaleModal(false)}
                className="px-6 py-2.5 border border-slate-300 rounded-lg font-medium hover:bg-white text-sm text-slate-700 transition">
                Anuluj
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DrawingsPage;
