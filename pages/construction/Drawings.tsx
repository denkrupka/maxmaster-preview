import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Plus, Search, FileImage, ChevronRight, Loader2,
  Upload, Eye, Download, Trash2, ZoomIn, ZoomOut,
  Type, Circle, Square, ArrowUpRight, Ruler,
  X, MoreVertical, ArrowLeft, Maximize2, Minimize2,
  GripVertical, ArrowUpDown, Pencil, Eraser,
  PenTool, Minus, ChevronDown, FolderPlus, ChevronLeft,
  CloudUpload, MousePointer, FileDown, AlertTriangle,
  Camera, MessageSquare, Scissors, Link2, History,
  Save, Undo2, Filter, MapPin, Image,
  ExternalLink, Crosshair, LayoutList, BookOpen,
  Hash, CloudLightning, MessageCircleWarning,
  Magnet, FileSearch, BarChart3, Printer, FileType2, Info, Sparkles
} from 'lucide-react';
import { useAppContext } from '../../context/AppContext';
import { supabase } from '../../lib/supabase';
import { Project } from '../../types';
import * as pdfjsLib from 'pdfjs-dist';
import {
  renderDxfToSvgBlobUrl, parseDxf, extractLayerInfo, renderDxfToBlobUrl, renderDxfFull,
  screenToDxfCoords, dxfToScreenCoords, findNearestEntity, findMatchingEntities, getEntityCenter,
  type IDxf, type DxfLayerInfo, type DxfViewBoxInfo
} from '../../lib/dxfRenderer';
import { findSnapPoints, getBestSnap, findIntersections, type SnapPoint, type SnapType } from '../../lib/dxfSnap';
import type { DxfSearchResult } from '../../lib/dxfSearch';
import type { DxfAnalysis } from '../../lib/dxfAnalyzer';
import type { TakeoffRule, TakeoffResult } from '../../lib/dxfTakeoff';
import { applyRules, getDefaultElectricalRules, getDefaultPdfElectricalRules } from '../../lib/dxfTakeoff';
import DxfSearchPanel from '../../components/construction/DxfSearchPanel';
import DxfPropertiesPanel from '../../components/construction/DxfPropertiesPanel';
import DxfTakeoffPanel from '../../components/construction/DxfTakeoffPanel';
import DxfTakeoffRulesModal from '../../components/construction/DxfTakeoffRulesModal';
import DxfBlockMappingsModal from '../../components/construction/DxfBlockMappingsModal';
import DxfAnalysisModal from '../../components/construction/DxfAnalysisModal';
import DxfExportModal from '../../components/construction/DxfExportModal';
import DwgConvertPanel from '../../components/construction/DwgConvertPanel';
import PdfAnalysisModal from '../../components/construction/PdfAnalysisModal';
import PdfStyleGroupsPanel from '../../components/construction/PdfStyleGroupsPanel';
import PdfLegendPanel from '../../components/construction/PdfLegendPanel';
import PdfMappingDictionaryPanel from '../../components/construction/PdfMappingDictionaryPanel';
import { mappingsToRules } from '../../lib/pdfCompanyMappings';
import type { PdfAnalysisExtra } from '../../lib/pdfAnalyzer';
import type { PdfStyleGroup, PdfLegend } from '../../lib/pdfTypes';

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
  type: 'freehand' | 'line' | 'arrow' | 'rectangle' | 'ellipse' | 'text' | 'measurement' | 'polyline' | 'polygon' | 'cloud' | 'callout';
  geometry: any;
  strokeColor: string;
  strokeWidth: number;
  fillColor?: string;
  fillOpacity?: number;
  textContent?: string;
  measurementValue?: number;
  measurementUnit?: string;
}

interface PlanComment {
  id: string; plan_id: string; author_id: string;
  position_x: number; position_y: number;
  content: string; is_resolved: boolean;
  resolved_by_id?: string; resolved_at?: string;
  created_at: string; updated_at: string;
}

interface PlanPin {
  id: string; plan_id: string; position_x: number; position_y: number;
  icon: string; color: string; label: string;
  created_by_id: string; created_at: string;
}

type AnnotationTool = 'pointer' | 'pen' | 'highlighter' | 'rectangle' | 'ellipse' | 'arrow' | 'line' | 'text' | 'eraser' | 'ruler' | 'comment' | 'camera' | 'screenshot' | 'cloud' | 'callout' | 'count';
type RulerMode = 'single' | 'polyline' | 'area';

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

const getFileType = (plan: PlanRecord): 'pdf' | 'image' | 'dxf' | 'dwg' | 'other' => {
  const ext = (plan.original_filename || plan.file_url || '').toLowerCase();
  if (plan.mime_type === 'application/pdf' || ext.endsWith('.pdf')) return 'pdf';
  if (ext.endsWith('.dxf')) return 'dxf';
  if (ext.endsWith('.dwg')) return 'dwg';
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
      // Polyline measurement
      if (ann.geometry.points && ann.geometry.points.length >= 2) {
        const pts = ann.geometry.points as number[][];
        const isClosed = ann.geometry.isClosed;
        return <g key={idx} onClick={onSelect} style={{ cursor: 'pointer' }}>
          {isClosed && <polygon points={pts.map((p: number[]) => `${p[0]},${p[1]}`).join(' ')} fill={ann.strokeColor} fillOpacity={0.08} stroke="none" />}
          {pts.map((p: number[], i: number) => {
            if (i === 0) return null;
            const prev = pts[i - 1];
            const mx = (prev[0] + p[0]) / 2, my = (prev[1] + p[1]) / 2;
            const segDist = ann.geometry.segDists?.[i - 1];
            const angleDeg = Math.atan2(p[1] - prev[1], p[0] - prev[0]) * 180 / Math.PI;
            let textAngle = angleDeg; if (textAngle > 90 || textAngle < -90) textAngle += 180;
            return <g key={i}>
              <line x1={prev[0]} y1={prev[1]} x2={p[0]} y2={p[1]} stroke={ann.strokeColor} strokeWidth={ann.strokeWidth} />
              <circle cx={prev[0]} cy={prev[1]} r={3} fill={ann.strokeColor} />
              <circle cx={p[0]} cy={p[1]} r={3} fill={ann.strokeColor} />
              {segDist != null && <text transform={`translate(${mx},${my}) rotate(${textAngle})`} dy={-6} fill={ann.strokeColor} fontSize="11" textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight="600">{segDist.toFixed(2)} {ann.measurementUnit || 'm'}</text>}
            </g>;
          })}
          {isClosed && pts.length > 0 && (() => {
            const last = pts[pts.length - 1], first = pts[0];
            return <line x1={last[0]} y1={last[1]} x2={first[0]} y2={first[1]} stroke={ann.strokeColor} strokeWidth={ann.strokeWidth} />;
          })()}
          {ann.measurementValue != null && (() => {
            const cx = pts.reduce((s: number, p: number[]) => s + p[0], 0) / pts.length;
            const cy = pts.reduce((s: number, p: number[]) => s + p[1], 0) / pts.length;
            const totalLabel = isClosed && ann.geometry.area
              ? `Σ ${ann.measurementValue.toFixed(2)} ${ann.measurementUnit || 'm'} | S=${ann.geometry.area.toFixed(2)} ${ann.measurementUnit || 'm'}²`
              : `Σ ${ann.measurementValue.toFixed(2)} ${ann.measurementUnit || 'm'}`;
            return <text x={cx} y={cy} fill="#fff" fontSize="12" textAnchor="middle" fontFamily="Arial" fontWeight="700" paintOrder="stroke" stroke={ann.strokeColor} strokeWidth={3}>{totalLabel}</text>;
          })()}
        </g>;
      }
      // Single line measurement with AutoCAD-style label
      const { x1, y1, x2, y2 } = ann.geometry;
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      const label = ann.measurementValue != null ? `${ann.measurementValue.toFixed(2)} ${ann.measurementUnit || 'm'}` : '';
      const angleDeg = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
      let textAngle = angleDeg; if (textAngle > 90 || textAngle < -90) textAngle += 180;
      // Extension lines
      const len = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
      const nx = -(y2 - y1) / (len || 1) * 8, ny = (x2 - x1) / (len || 1) * 8;
      return <g key={idx} onClick={onSelect} style={{ cursor: 'pointer' }}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={ann.strokeColor} strokeWidth={ann.strokeWidth} />
        <line x1={x1 + nx} y1={y1 + ny} x2={x1 - nx} y2={y1 - ny} stroke={ann.strokeColor} strokeWidth={1} />
        <line x1={x2 + nx} y1={y2 + ny} x2={x2 - nx} y2={y2 - ny} stroke={ann.strokeColor} strokeWidth={1} />
        <circle cx={x1} cy={y1} r={3} fill={ann.strokeColor} />
        <circle cx={x2} cy={y2} r={3} fill={ann.strokeColor} />
        {label && <text transform={`translate(${mx},${my}) rotate(${textAngle})`} dy={-6} fill="#fff" fontSize="12" textAnchor="middle" fontFamily="Arial" fontWeight="700" paintOrder="stroke" stroke={ann.strokeColor} strokeWidth={3}>{label}</text>}
      </g>;
    }
    case 'cloud': {
      const { x, y, w, h } = ann.geometry;
      if (!w || !h || (w < 5 && h < 5)) return null;
      const perimeter = 2 * (w + h);
      const bumpR = 14;
      const numTop = Math.max(2, Math.round(w / (bumpR * 2)));
      const numRight = Math.max(2, Math.round(h / (bumpR * 2)));
      const numBottom = numTop;
      const numLeft = numRight;
      const pts: [number, number][] = [];
      for (let i = 0; i <= numTop; i++) pts.push([x + (i * w / numTop), y]);
      for (let i = 1; i <= numRight; i++) pts.push([x + w, y + (i * h / numRight)]);
      for (let i = 1; i <= numBottom; i++) pts.push([x + w - (i * w / numBottom), y + h]);
      for (let i = 1; i < numLeft; i++) pts.push([x, y + h - (i * h / numLeft)]);
      let d = `M ${pts[0][0]},${pts[0][1]}`;
      for (let i = 1; i < pts.length; i++) {
        const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1];
        const dist = Math.sqrt(dx * dx + dy * dy);
        const r = dist * 0.55;
        d += ` A ${r},${r} 0 0,1 ${pts[i][0]},${pts[i][1]}`;
      }
      const last = pts[pts.length - 1];
      const dx0 = pts[0][0] - last[0], dy0 = pts[0][1] - last[1];
      const d0 = Math.sqrt(dx0 * dx0 + dy0 * dy0);
      d += ` A ${d0 * 0.55},${d0 * 0.55} 0 0,1 ${pts[0][0]},${pts[0][1]} Z`;
      return <path key={idx} d={d} {...baseProps} />;
    }
    case 'callout': {
      const { x1, y1, x2, y2 } = ann.geometry;
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const hl = Math.max(ann.strokeWidth * 3, 8);
      const ax1 = x2 - hl * Math.cos(angle - Math.PI / 6);
      const ay1 = y2 - hl * Math.sin(angle - Math.PI / 6);
      const ax2 = x2 - hl * Math.cos(angle + Math.PI / 6);
      const ay2 = y2 - hl * Math.sin(angle + Math.PI / 6);
      const text = ann.textContent || '';
      const textW = Math.max(text.length * 7.5 + 16, 40);
      return <g key={idx} onClick={onSelect} style={{ cursor: 'pointer' }}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={ann.strokeColor} strokeWidth={ann.strokeWidth} />
        <polygon points={`${x2},${y2} ${ax1},${ay1} ${ax2},${ay2}`} fill={ann.strokeColor} />
        {text && <>
          <rect x={x1 - 6} y={y1 - 20} width={textW} height={24} rx={4}
            fill="white" stroke={ann.strokeColor} strokeWidth={1.5} />
          <text x={x1 + 2} y={y1 - 3} fill={ann.strokeColor} fontSize="12"
            fontFamily="Arial, sans-serif" fontWeight="600">{text}</text>
        </>}
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

  // DXF
  const [dxfImageUrl, setDxfImageUrl] = useState<string | null>(null);
  const [dxfLoading, setDxfLoading] = useState(false);
  const [dxfData, setDxfData] = useState<IDxf | null>(null);
  const [dxfLayers, setDxfLayers] = useState<DxfLayerInfo[]>([]);
  const [dxfHiddenLayers, setDxfHiddenLayers] = useState<Set<string>>(new Set());
  const [dxfViewBox, setDxfViewBox] = useState<DxfViewBoxInfo | null>(null);
  const [showDxfLayerPanel, setShowDxfLayerPanel] = useState(false);
  // DXF auto-count
  const [dxfCountMatches, setDxfCountMatches] = useState<{x: number; y: number}[]>([]);
  const [dxfCountLabel, setDxfCountLabel] = useState('');

  // DXF Advanced features
  const [dxfSnapEnabled, setDxfSnapEnabled] = useState(true);
  const [dxfSnapPoint, setDxfSnapPoint] = useState<SnapPoint | null>(null);
  const [dxfCursorCoords, setDxfCursorCoords] = useState<{ x: number; y: number } | null>(null);
  const [showDxfSearch, setShowDxfSearch] = useState(false);
  const [showDxfProperties, setShowDxfProperties] = useState(false);
  const [dxfSelectedEntity, setDxfSelectedEntity] = useState<any>(null);
  const [showDxfAnalysis, setShowDxfAnalysis] = useState(false);
  const [dxfAnalysis, setDxfAnalysis] = useState<DxfAnalysis | null>(null);
  const [showDxfTakeoff, setShowDxfTakeoff] = useState(false);
  const [dxfTakeoffResult, setDxfTakeoffResult] = useState<TakeoffResult | null>(null);
  const [dxfTakeoffRules, setDxfTakeoffRules] = useState<TakeoffRule[]>([]);
  const [showDxfRulesModal, setShowDxfRulesModal] = useState(false);
  const [showDxfMappingsModal, setShowDxfMappingsModal] = useState(false);
  const [showDxfExportModal, setShowDxfExportModal] = useState(false);
  const [showDwgConvert, setShowDwgConvert] = useState(false);

  // PDF Analysis
  const [showPdfAnalysis, setShowPdfAnalysis] = useState(false);
  const [pdfAnalysis, setPdfAnalysis] = useState<DxfAnalysis | null>(null);
  const [pdfAnalysisExtra, setPdfAnalysisExtra] = useState<PdfAnalysisExtra | null>(null);
  const [showPdfStyleGroups, setShowPdfStyleGroups] = useState(false);
  const [showPdfLegend, setShowPdfLegend] = useState(false);
  const [pdfStyleGroups, setPdfStyleGroups] = useState<PdfStyleGroup[]>([]);
  const [pdfLegend, setPdfLegend] = useState<PdfLegend | null>(null);
  const [showPdfTakeoff, setShowPdfTakeoff] = useState(false);
  const [pdfTakeoffResult, setPdfTakeoffResult] = useState<TakeoffResult | null>(null);
  const [pdfTakeoffRules, setPdfTakeoffRules] = useState<TakeoffRule[]>([]);
  const [showPdfRulesModal, setShowPdfRulesModal] = useState(false);
  const [pdfHighlightPaths, setPdfHighlightPaths] = useState<{ segments: { type: string; points: { x: number; y: number }[] }[]; color: string }[]>([]);
  const [pdfHighlightPoints, setPdfHighlightPoints] = useState<{ x: number; y: number; label: string }[]>([]);
  const [pdfHighlightLabel, setPdfHighlightLabel] = useState('');
  const [showPdfMappingDict, setShowPdfMappingDict] = useState(false);

  // Annotations
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [currentDrawing, setCurrentDrawing] = useState<Annotation | null>(null);
  const [selectedAnnotation, setSelectedAnnotation] = useState<number>(-1);
  const [isDrawing, setIsDrawing] = useState(false);
  const [textInputPos, setTextInputPos] = useState<{ x: number; y: number } | null>(null);
  const [textInputValue, setTextInputValue] = useState('');

  // Ruler modes
  const [rulerMode, setRulerMode] = useState<RulerMode>('single');
  const [showRulerDropdown, setShowRulerDropdown] = useState(false);
  const [polylinePoints, setPolylinePoints] = useState<{ x: number; y: number }[]>([]);
  const [polylineCursorPt, setPolylineCursorPt] = useState<{ x: number; y: number } | null>(null);
  // Ruler single click-to-click
  const [rulerSingleStart, setRulerSingleStart] = useState<{ x: number; y: number } | null>(null);
  const [rulerSingleCursorPt, setRulerSingleCursorPt] = useState<{ x: number; y: number } | null>(null);

  // Comments
  const [comments, setComments] = useState<PlanComment[]>([]);
  const [commentInputPos, setCommentInputPos] = useState<{ x: number; y: number } | null>(null);
  const [commentInputValue, setCommentInputValue] = useState('');
  const [selectedComment, setSelectedComment] = useState<PlanComment | null>(null);

  // Pins/Photos
  const [pins, setPins] = useState<PlanPin[]>([]);
  const [photoModalPos, setPhotoModalPos] = useState<{ x: number; y: number } | null>(null);
  const [selectedPin, setSelectedPin] = useState<PlanPin | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);

  // Navigator
  const [showNavigator, setShowNavigator] = useState(false);
  const [navigatorFilter, setNavigatorFilter] = useState<string>('all');

  // Screenshot
  const [screenshotRect, setScreenshotRect] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);

  // Save/Undo
  const savedAnnotationsRef = useRef<Annotation[]>([]);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Count tool
  const [countItems, setCountItems] = useState<{ x: number; y: number }[]>([]);

  // Links
  const [showLinksModal, setShowLinksModal] = useState(false);
  const [planLinks, setPlanLinks] = useState<{ type: string; id: string; name: string }[]>([]);

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
  const photoInputRef = useRef<HTMLInputElement>(null);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);
  const finishPolylineRef = useRef<(forceClose?: boolean) => void>(() => {});

  const MAX_PLANS = 500;
  const notifyTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  // ==================== NOTIFICATIONS ====================

  const notify = (msg: string, type: 'success' | 'error' = 'success') => {
    if (notifyTimeoutRef.current) clearTimeout(notifyTimeoutRef.current);
    setNotification({ msg, type });
    notifyTimeoutRef.current = setTimeout(() => setNotification(null), 3500);
  };

  // Cleanup PDF + DXF blob on unmount
  useEffect(() => {
    return () => {
      if (pdfDoc) { try { pdfDoc.destroy(); } catch {} }
      if (dxfImageUrl) URL.revokeObjectURL(dxfImageUrl);
    };
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // Ctrl+S: Save
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); if (hasUnsavedChanges) handleSaveAll(); return; }
      // Ctrl+Z: Undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); if (hasUnsavedChanges) handleUndo(); return; }
      // Delete: remove selected annotation
      if (e.key === 'Delete' && selectedAnnotation >= 0) { deleteAnnotation(selectedAnnotation); return; }
      // Enter: finish polyline measurement
      if (e.key === 'Enter') { finishPolylineRef.current(); return; }
      // Escape: cancel current tool or exit fullscreen
      if (e.key === 'Escape') {
        if (isFullscreen) { setIsFullscreen(false); return; }
        setActiveTool('pointer'); setPolylinePoints([]); setPolylineCursorPt(null);
        setRulerSingleStart(null); setRulerSingleCursorPt(null);
        setTextInputPos(null); setCommentInputPos(null); setPhotoModalPos(null);
        setScreenshotRect(null); setCountItems([]); setDxfCountMatches([]); setDxfCountLabel('');
        if (calibrationMode) { setCalibrationMode(false); setCalibrationPoints([]); }
        return;
      }
      // F3 — toggle SNAP
      if (e.key === 'F3') { e.preventDefault(); setDxfSnapEnabled(prev => !prev); return; }
      // Ctrl+F — DXF search
      if ((e.ctrlKey || e.metaKey) && e.key === 'f' && fileType === 'dxf' && dxfData) {
        e.preventDefault(); setShowDxfSearch(prev => !prev); return;
      }
      // Tool shortcuts (no modifier keys)
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        switch (e.key.toLowerCase()) {
          case 'v': setActiveTool('pointer'); setPolylinePoints([]); break;
          case 'p': setActiveTool('pen'); break;
          case 'h': setActiveTool('highlighter'); break;
          case 'r': setActiveTool('rectangle'); break;
          case 'o': setActiveTool('ellipse'); break;
          case 'a': setActiveTool('arrow'); break;
          case 'l': setActiveTool('line'); break;
          case 't': setActiveTool('text'); break;
          case 'm': setActiveTool('ruler'); break;
          case 'c': setActiveTool('comment'); break;
          case 'e': setActiveTool('eraser'); break;
          case 'k': setActiveTool('cloud'); break;
          case 'b': setActiveTool('callout'); break;
          case 'n': setActiveTool('count'); setCountItems([]); setDxfCountMatches([]); setDxfCountLabel(''); break;
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isFullscreen, hasUnsavedChanges, selectedAnnotation, calibrationMode]);

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

  // Re-render DXF when hidden layers change
  useEffect(() => {
    if (!dxfData) return;
    if (dxfImageUrl) URL.revokeObjectURL(dxfImageUrl);
    const { url, viewBox } = renderDxfToBlobUrl(dxfData, dxfHiddenLayers);
    setDxfImageUrl(url);
    setDxfViewBox(viewBox);
  }, [dxfHiddenLayers]);

  // ==================== DATA LOADING ====================

  useEffect(() => { if (currentUser) loadProjects(); }, [currentUser]);
  useEffect(() => { if (selectedProject) loadPlansData(); }, [selectedProject]);

  const loadDxf = async (url: string) => {
    setDxfLoading(true);
    if (dxfImageUrl) { URL.revokeObjectURL(dxfImageUrl); setDxfImageUrl(null); }
    setDxfData(null); setDxfLayers([]); setDxfHiddenLayers(new Set()); setDxfViewBox(null);
    setDxfCountMatches([]); setDxfCountLabel('');
    try {
      const resp = await fetch(url);
      const text = await resp.text();
      const dxf = parseDxf(text);
      setDxfData(dxf);
      const layers = extractLayerInfo(dxf);
      setDxfLayers(layers);
      const { url: blobUrl, viewBox } = renderDxfToBlobUrl(dxf);
      setDxfImageUrl(blobUrl);
      setDxfViewBox(viewBox);
    } catch (err) {
      console.error('DXF render error:', err);
      notify('Nie udało się wyrenderować pliku DXF', 'error');
    } finally {
      setDxfLoading(false);
    }
  };

  // Helper: reset all PDF analysis states
  const resetPdfAnalysisState = useCallback(() => {
    setPdfAnalysis(null);
    setPdfAnalysisExtra(null);
    setPdfStyleGroups([]);
    setPdfLegend(null);
    setPdfTakeoffResult(null);
    setShowPdfTakeoff(false);
    setShowPdfStyleGroups(false);
    setShowPdfLegend(false);
    setShowPdfAnalysis(false);
    setShowPdfMappingDict(false);
    setPdfHighlightPaths([]);
    setPdfHighlightPoints([]);
    setPdfHighlightLabel('');
  }, []);

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
          setDxfImageUrl(null); setDxfData(null); setDxfLayers([]); setDxfHiddenLayers(new Set()); setDxfViewBox(null);
          // Reset PDF analysis state before loading new data
          resetPdfAnalysisState();
          // Load previous PDF analysis from DB if exists
          const planId = selectedPlan.id;
          if (currentUser?.company_id) {
            supabase.from('pdf_analyses')
              .select('id, analysis_result, detected_scale, scale_factor, ai_classification_status')
              .eq('drawing_id', planId)
              .eq('company_id', currentUser.company_id)
              .eq('status', 'completed')
              .order('created_at', { ascending: false })
              .limit(1)
              .then(async ({ data: rows, error: dbError }) => {
                if (dbError) { console.error('PDF analysis load error:', dbError); return; }
                if (!rows || rows.length === 0 || !rows[0].analysis_result) return;
                const savedAnalysis = rows[0].analysis_result as DxfAnalysis;
                // Validate loaded structure
                if (!savedAnalysis.entities || !Array.isArray(savedAnalysis.entities)) {
                  console.error('Invalid analysis structure from DB');
                  return;
                }
                const analysisId = rows[0].id;
                setPdfAnalysis(savedAnalysis);
                // Compute rules: use existing or create defaults
                const rulesToUse = pdfTakeoffRules.length > 0 ? pdfTakeoffRules : getDefaultPdfElectricalRules();
                setPdfTakeoffRules(rulesToUse);
                const result = applyRules(savedAnalysis, rulesToUse);
                setPdfTakeoffResult(result);

                try {
                  // Load style groups from DB
                  const { data: sgRows } = await supabase.from('pdf_style_groups')
                    .select('*')
                    .eq('analysis_id', analysisId)
                    .order('path_count', { ascending: false });
                  if (sgRows && sgRows.length > 0) {
                    // Build entity-to-group index once for efficiency
                    const entityGroupMap = new Map<string, number[]>();
                    for (let i = 0; i < savedAnalysis.entities.length; i++) {
                      const ln = savedAnalysis.entities[i].layerName;
                      const pi = savedAnalysis.entities[i].properties?.pathIndex;
                      if (ln && pi != null) {
                        if (!entityGroupMap.has(ln)) entityGroupMap.set(ln, []);
                        entityGroupMap.get(ln)!.push(pi);
                      }
                    }
                    const groups: PdfStyleGroup[] = sgRows.map(r => ({
                      id: r.id,
                      name: r.name,
                      styleKey: `${r.stroke_color}-${(r.line_width || 0).toFixed(1)}-${(r.dash_pattern || []).join(',')}`,
                      strokeColor: r.stroke_color || '#000000',
                      lineWidth: r.line_width || 1,
                      dashPattern: r.dash_pattern || [],
                      pathCount: r.path_count || 0,
                      pathIndices: entityGroupMap.get(r.name) || [],
                      totalLengthPx: r.total_length_px || 0,
                      totalLengthM: r.total_length_m || 0,
                      category: r.category,
                      aiConfidence: r.ai_confidence,
                      visible: true,
                    }));
                    setPdfStyleGroups(groups);
                  }

                  // Load legend from DB
                  const { data: legendRows } = await supabase.from('pdf_legends')
                    .select('*')
                    .eq('analysis_id', analysisId)
                    .limit(1);
                  if (legendRows && legendRows.length > 0) {
                    setPdfLegend({
                      boundingBox: legendRows[0].bounding_box || { x: 0, y: 0, width: 0, height: 0 },
                      entries: legendRows[0].entries || [],
                    });
                  }
                } catch (err) {
                  console.error('Error loading PDF style groups / legend from DB:', err);
                }
              });
          }
        } else if (ft === 'dxf') {
          setPdfDoc(null);
          setPdfTotalPages(0);
          resetPdfAnalysisState();
          loadDxf(selectedPlan.file_url);
        } else {
          setPdfDoc(null);
          setPdfTotalPages(0);
          resetPdfAnalysisState();
          if (dxfImageUrl) { URL.revokeObjectURL(dxfImageUrl); setDxfImageUrl(null); }
          setDxfData(null); setDxfLayers([]); setDxfHiddenLayers(new Set()); setDxfViewBox(null);
        }
      }
      setDxfCountMatches([]); setDxfCountLabel('');
      loadAnnotations(selectedPlan.id);
    } else {
      setPdfDoc(null);
      resetPdfAnalysisState();
      if (dxfImageUrl) { URL.revokeObjectURL(dxfImageUrl); setDxfImageUrl(null); }
      setDxfData(null); setDxfLayers([]); setDxfHiddenLayers(new Set()); setDxfViewBox(null);
      setDxfCountMatches([]); setDxfCountLabel('');
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
        const mapped = data.map((m: any) => ({
          id: m.id, type: m.markup_type,
          geometry: m.geometry, strokeColor: m.stroke_color || '#ef4444',
          strokeWidth: m.stroke_width || 2, fillColor: m.fill_color,
          fillOpacity: m.fill_opacity ?? 0.15, textContent: m.text_content,
          measurementValue: m.measurement_value, measurementUnit: m.measurement_unit,
        }));
        setAnnotations(mapped);
        savedAnnotationsRef.current = [...mapped];
      } else { setAnnotations([]); savedAnnotationsRef.current = []; }
      setHasUnsavedChanges(false);
    } catch { setAnnotations([]); savedAnnotationsRef.current = []; }
    // Also load comments and pins
    loadComments(planId);
    loadPins(planId);
  };

  const saveAnnotation = (ann: Annotation) => {
    if (!selectedPlan || !currentUser) return;
    setAnnotations(prev => [...prev, ann]);
    setHasUnsavedChanges(true);
  };

  const deleteAnnotation = (idx: number) => {
    const ann = annotations[idx];
    if (!ann) return;
    setAnnotations(prev => prev.filter((_, i) => i !== idx));
    setSelectedAnnotation(-1);
    setHasUnsavedChanges(true);
  };

  // Finish polyline/area measurement (shared by double-click and Enter)
  const finishPolylineMeasurement = useCallback((forceClose?: boolean) => {
    if (activeTool !== 'ruler' || rulerMode === 'single' || polylinePoints.length < 2) return;
    if (!selectedPlan || !currentUser) return;
    const ratio = selectedPlan.scale_ratio || 1;
    const pts = polylinePoints;
    let totalDist = 0;
    const segDists: number[] = [];
    for (let i = 1; i < pts.length; i++) {
      const d = Math.sqrt((pts[i].x - pts[i - 1].x) ** 2 + (pts[i].y - pts[i - 1].y) ** 2) * ratio;
      segDists.push(d);
      totalDist += d;
    }
    const first = pts[0], last = pts[pts.length - 1];
    const closeDist = Math.sqrt((last.x - first.x) ** 2 + (last.y - first.y) ** 2);
    const isClosed = forceClose || (closeDist < 30 && pts.length >= 3);
    if (isClosed) {
      const closingDist = closeDist * ratio;
      segDists.push(closingDist);
      totalDist += closingDist;
    }
    let area: number | undefined;
    if (isClosed && pts.length >= 3) {
      let a = 0;
      for (let i = 0; i < pts.length; i++) {
        const j = (i + 1) % pts.length;
        a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
      }
      area = Math.abs(a / 2) * ratio * ratio;
    }
    const ann: Annotation = {
      type: 'measurement',
      geometry: { points: pts.map(p => [p.x, p.y]), segDists, isClosed, area },
      strokeColor: annColor, strokeWidth: annWidth,
      measurementValue: totalDist, measurementUnit: scaleUnit || 'm',
    };
    saveAnnotation(ann);
    setPolylinePoints([]);
    setPolylineCursorPt(null);
  }, [activeTool, rulerMode, polylinePoints, selectedPlan, currentUser, annColor, annWidth, scaleUnit]);
  finishPolylineRef.current = finishPolylineMeasurement;

  // ==================== COMMENTS CRUD ====================

  const loadComments = async (planId: string) => {
    try {
      const { data } = await supabase.from('plan_comments').select('*')
        .eq('plan_id', planId).is('deleted_at', null).order('created_at');
      if (data) setComments(data);
      else setComments([]);
    } catch { setComments([]); }
  };

  const saveCommentToDb = async (x: number, y: number, content: string) => {
    if (!selectedPlan || !currentUser || !content.trim()) return;
    try {
      const { data, error } = await supabase.from('plan_comments').insert({
        plan_id: selectedPlan.id, author_id: currentUser.id,
        position_x: x, position_y: y, content: content.trim(),
      }).select().single();
      if (error) { notify('Błąd zapisu komentarza: ' + error.message, 'error'); return; }
      if (data) setComments(prev => [...prev, data]);
      notify('Komentarz dodany');
    } catch (err: any) { notify('Błąd: ' + err.message, 'error'); }
  };

  const deleteCommentFromDb = async (id: string) => {
    const { error } = await supabase.from('plan_comments').update({ deleted_at: new Date().toISOString() }).eq('id', id);
    if (error) { notify('Błąd usuwania komentarza', 'error'); return; }
    setComments(prev => prev.filter(c => c.id !== id));
    setSelectedComment(null);
  };

  // ==================== PINS/PHOTOS CRUD ====================

  const loadPins = async (planId: string) => {
    try {
      const { data } = await supabase.from('plan_pins').select('*').eq('plan_id', planId).order('created_at');
      if (data) setPins(data);
      else setPins([]);
    } catch { setPins([]); }
  };

  const savePinWithPhoto = async (x: number, y: number, file: File) => {
    if (!selectedPlan || !currentUser) return;
    try {
      const safeName = sanitizeFileName(file.name);
      const filePath = `${selectedPlan.project_id}/photos/${Date.now()}_${safeName}`;
      const { error: ue } = await supabase.storage.from('plans').upload(filePath, file, { contentType: file.type });
      if (ue) { notify('Błąd przesyłania zdjęcia: ' + ue.message, 'error'); return; }
      const { data: urlData } = supabase.storage.from('plans').getPublicUrl(filePath);
      const photoUrl = urlData?.publicUrl || '';
      const { data, error } = await supabase.from('plan_pins').insert({
        plan_id: selectedPlan.id, position_x: x, position_y: y,
        icon: 'Camera', color: '#22c55e', label: photoUrl,
        created_by_id: currentUser.id,
      }).select().single();
      if (error) { notify('Błąd zapisu zdjęcia: ' + error.message, 'error'); return; }
      if (data) setPins(prev => [...prev, data]);
      notify('Zdjęcie dodane');
    } catch (err: any) { notify('Błąd: ' + err.message, 'error'); }
  };

  const deletePinFromDb = async (id: string) => {
    const { error } = await supabase.from('plan_pins').delete().eq('id', id);
    if (error) { notify('Błąd usuwania', 'error'); return; }
    setPins(prev => prev.filter(p => p.id !== id));
    setSelectedPin(null);
  };

  // ==================== SAVE/UNDO ====================

  const handleSaveAll = async () => {
    if (!selectedPlan || !currentUser) return;
    setSaving(true);
    try {
      // Find new annotations (no id)
      const newAnns = annotations.filter(a => !a.id);
      const removed = savedAnnotationsRef.current.filter(s => s.id && !annotations.find(a => a.id === s.id));
      // Insert new
      for (const ann of newAnns) {
        const row = {
          plan_id: selectedPlan.id, author_id: currentUser.id,
          markup_type: ann.type === 'polygon' ? 'polygon' : ann.type === 'polyline' ? 'polyline' : ann.type,
          geometry: ann.geometry, stroke_color: ann.strokeColor, stroke_width: ann.strokeWidth,
          fill_color: ann.fillColor || null, fill_opacity: ann.fillOpacity ?? 0.15,
          text_content: ann.textContent || null,
          measurement_value: ann.measurementValue ?? null, measurement_unit: ann.measurementUnit || null,
          z_index: annotations.indexOf(ann),
        };
        const { data } = await supabase.from('plan_markups').insert(row).select().single();
        if (data) ann.id = data.id;
      }
      // Mark removed as deleted
      for (const r of removed) {
        await supabase.from('plan_markups').update({ deleted_at: new Date().toISOString() }).eq('id', r.id);
      }
      savedAnnotationsRef.current = [...annotations];
      setHasUnsavedChanges(false);
      notify('Zapisano');
    } catch (err: any) { notify('Błąd zapisu: ' + err.message, 'error'); }
    finally { setSaving(false); }
  };

  const handleUndo = () => {
    setAnnotations([...savedAnnotationsRef.current]);
    setHasUnsavedChanges(false);
    setSelectedAnnotation(-1);
  };

  // ==================== SCREENSHOT ====================

  const captureScreenshot = useCallback(() => {
    const canvas = pdfCanvasRef.current;
    if (!canvas || !screenshotRect) return;
    const r = screenshotRect;
    const sx = Math.min(r.x1, r.x2), sy = Math.min(r.y1, r.y2);
    const sw = Math.abs(r.x2 - r.x1), sh = Math.abs(r.y2 - r.y1);
    if (sw < 5 || sh < 5) { setScreenshotRect(null); return; }
    try {
      const dpr = window.devicePixelRatio || 1;
      const scaleX = canvas.width / planNatW, scaleY = canvas.height / planNatH;
      const tmpCanvas = document.createElement('canvas');
      tmpCanvas.width = sw * scaleX; tmpCanvas.height = sh * scaleY;
      const ctx = tmpCanvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(canvas, sx * scaleX, sy * scaleY, sw * scaleX, sh * scaleY, 0, 0, tmpCanvas.width, tmpCanvas.height);
      tmpCanvas.toBlob(blob => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `screenshot_${Date.now()}.png`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
        notify('Zrzut ekranu pobrany');
      }, 'image/png');
    } catch { notify('Błąd zrzutu ekranu', 'error'); }
    setScreenshotRect(null);
  }, [screenshotRect, planNatW, planNatH]);

  // ==================== NAVIGATOR HELPERS ====================

  const scrollToPoint = useCallback((x: number, y: number) => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const scale = zoom / 100;
    viewer.scrollTo({ left: x * scale - viewer.clientWidth / 2, top: y * scale - viewer.clientHeight / 2, behavior: 'smooth' });
  }, [zoom]);

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
    if (activeTool === 'pointer') {
      // DXF entity properties on click
      if (dxfData && dxfViewBox && selectedPlan && getFileType(selectedPlan) === 'dxf') {
        const pt = getSvgPoint(e);
        const dxfPt = screenToDxfCoords(pt, planNatW, planNatH, dxfViewBox);
        const maxDist = Math.max(dxfViewBox.vbW, dxfViewBox.vbH) * 0.02;
        const entity = findNearestEntity(dxfData, dxfPt, maxDist, dxfHiddenLayers);
        if (entity) {
          setDxfSelectedEntity(entity);
          setShowDxfProperties(true);
        } else {
          setDxfSelectedEntity(null);
          setShowDxfProperties(false);
        }
      }
      return;
    }
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
    if (activeTool === 'comment') {
      const pt = getSvgPoint(e);
      setCommentInputPos(pt);
      setCommentInputValue('');
      setTimeout(() => commentInputRef.current?.focus(), 50);
      return;
    }
    if (activeTool === 'camera') {
      const pt = getSvgPoint(e);
      setPhotoModalPos(pt);
      return;
    }
    if (activeTool === 'count') {
      const pt = getSvgPoint(e);
      const ft = selectedPlan ? getFileType(selectedPlan) : 'other';
      if (ft === 'dxf' && dxfData && dxfViewBox) {
        // DXF auto-count: find entity → find all matching → show markers
        const dxfPt = screenToDxfCoords(pt, planNatW, planNatH, dxfViewBox);
        const maxDist = Math.max(dxfViewBox.vbW, dxfViewBox.vbH) * 0.02;
        const entity = findNearestEntity(dxfData, dxfPt, maxDist, dxfHiddenLayers);
        if (entity) {
          const matches = findMatchingEntities(dxfData, entity, dxfHiddenLayers);
          const screenPts = matches.map(m => {
            const c = getEntityCenter(m);
            return c ? dxfToScreenCoords(c, planNatW, planNatH, dxfViewBox) : null;
          }).filter((p): p is {x: number; y: number} => p !== null);
          setDxfCountMatches(screenPts);
          const e = entity as any;
          const label = e.type === 'INSERT' ? `Blok: ${e.name}` : `${e.type} @ ${e.layer || '0'}`;
          setDxfCountLabel(label);
        }
      } else {
        // Manual count (PDF/image)
        setCountItems(prev => [...prev, pt]);
      }
      return;
    }
    // Ruler single: click-to-click (first click = start, second click = finish)
    if (activeTool === 'ruler' && rulerMode === 'single') {
      const pt = getSvgPoint(e);
      if (!rulerSingleStart) {
        setRulerSingleStart(pt);
        setRulerSingleCursorPt(pt);
      } else {
        // Second click — save measurement
        const { x: x1, y: y1 } = rulerSingleStart;
        const { x: x2, y: y2 } = pt;
        const pxDist = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
        const ann: Annotation = {
          type: 'measurement',
          geometry: { x1, y1, x2, y2 },
          strokeColor: annColor, strokeWidth: annWidth,
          measurementValue: pxDist * (selectedPlan?.scale_ratio || 1),
          measurementUnit: scaleUnit || 'm',
        };
        saveAnnotation(ann);
        setRulerSingleStart(null);
        setRulerSingleCursorPt(null);
      }
      return;
    }
    // Polyline/area ruler: click-based, not drag
    if (activeTool === 'ruler' && rulerMode !== 'single') {
      const pt = getSvgPoint(e);
      // Check if clicking near first point to close area (3+ points, distance < 30)
      if (polylinePoints.length >= 3) {
        const first = polylinePoints[0];
        const dist = Math.sqrt((pt.x - first.x) ** 2 + (pt.y - first.y) ** 2);
        if (dist < 30) {
          finishPolylineMeasurement(true);
          return;
        }
      }
      setPolylinePoints(prev => [...prev, pt]);
      return;
    }
    // Screenshot mode: draw rect
    if (activeTool === 'screenshot') {
      const pt = getSvgPoint(e);
      setScreenshotRect({ x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y });
      setIsDrawing(true);
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
    } else if (activeTool === 'cloud') {
      setCurrentDrawing({
        type: 'cloud', geometry: { x: pt.x, y: pt.y, w: 0, h: 0, startX: pt.x, startY: pt.y },
        strokeColor: annColor, strokeWidth: annWidth, fillColor: annColor, fillOpacity: 0.05,
      });
    } else if (activeTool === 'callout') {
      setCurrentDrawing({
        type: 'callout', geometry: { x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y },
        strokeColor: annColor, strokeWidth: annWidth,
      });
    } else if (activeTool === 'line' || activeTool === 'arrow') {
      setCurrentDrawing({
        type: activeTool, geometry: { x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y },
        strokeColor: annColor, strokeWidth: annWidth,
      });
    }
  }, [activeTool, annColor, annWidth, getSvgPoint, calibrationMode, rulerMode, rulerSingleStart, polylinePoints, selectedPlan, scaleUnit, finishPolylineMeasurement, dxfData, dxfViewBox, dxfHiddenLayers, planNatW, planNatH]);

  const handleSvgMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    // DXF coordinate tracking + SNAP
    const svgPt = getSvgPoint(e);
    if (dxfData && dxfViewBox && selectedPlan && getFileType(selectedPlan) === 'dxf') {
      const dxfPt = screenToDxfCoords(svgPt, planNatW, planNatH, dxfViewBox);
      setDxfCursorCoords(dxfPt);
      // SNAP
      if (dxfSnapEnabled) {
        const snapRadius = Math.max(dxfViewBox.vbW, dxfViewBox.vbH) * 0.015;
        const snaps = findSnapPoints(dxfData, dxfPt, snapRadius, dxfHiddenLayers);
        const intersections = findIntersections(dxfData, dxfPt, snapRadius, dxfHiddenLayers);
        const allSnaps = [...snaps, ...intersections];
        const best = getBestSnap(allSnaps);
        setDxfSnapPoint(best);
      } else {
        setDxfSnapPoint(null);
      }
    }

    // Ruler single: track cursor for preview line
    if (activeTool === 'ruler' && rulerMode === 'single' && rulerSingleStart) {
      setRulerSingleCursorPt(svgPt);
    }
    // Polyline cursor tracking
    if (activeTool === 'ruler' && rulerMode !== 'single' && polylinePoints.length > 0) {
      setPolylineCursorPt(svgPt);
    }
    // Screenshot rect drag
    if (activeTool === 'screenshot' && isDrawing && screenshotRect) {
      const pt = getSvgPoint(e);
      setScreenshotRect(prev => prev ? { ...prev, x2: pt.x, y2: pt.y } : null);
      return;
    }
    if (!isDrawing || !currentDrawing) return;
    const pt = getSvgPoint(e);
    setCurrentDrawing(prev => {
      if (!prev) return null;
      if (prev.type === 'freehand') {
        return { ...prev, geometry: { ...prev.geometry, points: [...prev.geometry.points, [pt.x, pt.y]] } };
      } else if (prev.type === 'cloud') {
        const sx = prev.geometry.startX, sy = prev.geometry.startY;
        return { ...prev, geometry: { ...prev.geometry, x: Math.min(sx, pt.x), y: Math.min(sy, pt.y), w: Math.abs(pt.x - sx), h: Math.abs(pt.y - sy) } };
      } else if (prev.type === 'rectangle') {
        const sx = prev.geometry.startX, sy = prev.geometry.startY;
        return { ...prev, geometry: { ...prev.geometry, x: Math.min(sx, pt.x), y: Math.min(sy, pt.y), w: Math.abs(pt.x - sx), h: Math.abs(pt.y - sy) } };
      } else if (prev.type === 'ellipse') {
        const sx = prev.geometry.startX, sy = prev.geometry.startY;
        return { ...prev, geometry: { ...prev.geometry, cx: (sx + pt.x) / 2, cy: (sy + pt.y) / 2, rx: Math.abs(pt.x - sx) / 2, ry: Math.abs(pt.y - sy) / 2 } };
      } else if (['line', 'arrow', 'measurement', 'callout'].includes(prev.type)) {
        return { ...prev, geometry: { ...prev.geometry, x2: pt.x, y2: pt.y } };
      }
      return prev;
    });
  }, [isDrawing, currentDrawing, getSvgPoint, activeTool, rulerMode, polylinePoints, screenshotRect, rulerSingleStart]);

  // Polyline double-click to finish
  const handleSvgDoubleClick = useCallback(() => {
    finishPolylineMeasurement();
  }, [finishPolylineMeasurement]);

  const handleSvgMouseUp = useCallback(() => {
    // Screenshot finish
    if (activeTool === 'screenshot' && isDrawing && screenshotRect) {
      setIsDrawing(false);
      captureScreenshot();
      return;
    }
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
    if (ann.type === 'cloud' && ann.geometry.w < 10 && ann.geometry.h < 10) { setCurrentDrawing(null); return; }
    // Clean geometry
    if (ann.type === 'rectangle') { const { startX, startY, ...rest } = ann.geometry; ann.geometry = rest; }
    if (ann.type === 'ellipse') { const { startX, startY, ...rest } = ann.geometry; ann.geometry = rest; }
    if (ann.type === 'cloud') { const { startX, startY, ...rest } = ann.geometry; ann.geometry = rest; }
    // Callout: prompt for text
    if (ann.type === 'callout') {
      const text = prompt('Wpisz tekst odnośnika:');
      if (!text) { setCurrentDrawing(null); return; }
      ann.textContent = text;
    }
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
    setShowRulerDropdown(false);
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
          className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500" title="Powrót do listy projektów">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <button onClick={e => { e.stopPropagation(); setCreateName(''); setCreateFolderId(selectedFolder?.id || ''); setCreateFile(null); setShowCreateModal(true); }}
          className="px-5 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 text-sm shadow-sm">
          Importuj plik
        </button>
        <div className="flex-1" />
        <div className="text-center">
          <p className="text-sm font-semibold text-slate-800 truncate max-w-[300px]">{selectedProject.name}</p>
          <p className="text-[10px] text-slate-400">
            Utworzono: {new Date(selectedProject.created_at).toLocaleDateString('pl-PL')}
            {' · '}Aktualizacja: {new Date(selectedProject.updated_at || selectedProject.created_at).toLocaleDateString('pl-PL')}
          </p>
        </div>
        <div className="flex-1" />
        <button onClick={e => { e.stopPropagation(); setShowLinksModal(true); }}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-50" title="Związki">
          <Link2 className="w-3.5 h-3.5" /> Związki
        </button>
      </div>

      {/* SPLIT PANEL */}
      <div className="flex-1 flex overflow-hidden">

        {/* LEFT PANEL */}
        <div className="w-[300px] min-w-[240px] border-r border-slate-200 bg-white flex flex-col overflow-hidden flex-shrink-0">
          <div className="px-3 py-2.5 border-b border-slate-200 flex items-center justify-between flex-shrink-0 bg-slate-50">
            <span className="font-semibold text-slate-700 text-sm">Plany i rzuty</span>
            <div className="flex items-center gap-0.5">
              <button onClick={e => { e.stopPropagation(); setShowNewFolderInput(!showNewFolderInput); }}
                className="p-1.5 hover:bg-slate-200 rounded text-slate-500" title="Utwórz nową grupę planów"><FolderPlus className="w-4 h-4" /></button>
              <button onClick={e => { e.stopPropagation(); setShowSortModal(true); }}
                className="p-1.5 hover:bg-slate-200 rounded text-slate-500" title="Sortuj plany alfabetycznie"><ArrowUpDown className="w-4 h-4" /></button>
            </div>
          </div>
          {/* Search in left panel */}
          <div className="px-3 py-2 border-b border-slate-100">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input type="text" placeholder="Szukaj planu..." value={search} onChange={e => setSearch(e.target.value)}
                onClick={e => e.stopPropagation()}
                className="w-full pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 bg-white" />
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
                <p className="text-sm text-slate-400">Brak planów. Kliknij "Importuj plik" aby dodać.</p>
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
              <div className="px-3 py-1.5 border-b border-slate-200 flex items-center gap-1 flex-shrink-0 bg-slate-50 overflow-x-auto" onClick={e => e.stopPropagation()}>
                <button onClick={() => setZoom(z => Math.min(z + 25, 500))} className="p-1.5 hover:bg-white rounded-lg text-slate-600" title="Powiększ (Ctrl + kółko myszy)"><ZoomIn className="w-4 h-4" /></button>
                <span className="text-xs text-slate-500 w-10 text-center font-mono">{zoom}%</span>
                <button onClick={() => setZoom(z => Math.max(z - 25, 25))} className="p-1.5 hover:bg-white rounded-lg text-slate-600" title="Pomniejsz (Ctrl + kółko myszy)"><ZoomOut className="w-4 h-4" /></button>
                <button onClick={() => setZoom(100)} className="p-1.5 hover:bg-white rounded-lg text-slate-600 text-xs font-medium" title="Resetuj powiększenie do 100%">1:1</button>
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
                  className="p-1.5 hover:bg-white rounded-lg text-slate-600" title="Historia wersji pliku"><History className="w-4 h-4" /></button>
                <div className="relative">
                  <button onClick={e => { e.stopPropagation(); setShowUpdateDropdown(!showUpdateDropdown); }}
                    className="p-1.5 hover:bg-white rounded-lg text-slate-600" title="Prześlij nową wersję pliku"><Upload className="w-4 h-4" /></button>
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
                  className="p-1.5 hover:bg-white rounded-lg text-slate-600" title="Pobierz plik na dysk" target="_blank" rel="noopener noreferrer">
                  <Download className="w-4 h-4" />
                </a>
                <div className="w-px h-5 bg-slate-200 mx-1" />
                {fileType === 'dxf' && dxfData && (
                  <>
                    <button onClick={() => setShowDxfLayerPanel(!showDxfLayerPanel)}
                      className={`p-1.5 rounded-lg transition ${showDxfLayerPanel ? 'bg-blue-100 text-blue-700' : 'hover:bg-white text-slate-600'}`} title="Warstwy DXF">
                      <Filter className="w-4 h-4" />
                    </button>
                    <button onClick={() => setDxfSnapEnabled(!dxfSnapEnabled)}
                      className={`p-1.5 rounded-lg transition ${dxfSnapEnabled ? 'bg-green-100 text-green-700' : 'hover:bg-white text-slate-600'}`} title={`SNAP (F3) — ${dxfSnapEnabled ? 'WŁ' : 'WYŁ'}`}>
                      <Magnet className="w-4 h-4" />
                    </button>
                    <button onClick={() => setShowDxfSearch(!showDxfSearch)}
                      className={`p-1.5 rounded-lg transition ${showDxfSearch ? 'bg-blue-100 text-blue-700' : 'hover:bg-white text-slate-600'}`} title="Szukaj w DXF (Ctrl+F)">
                      <FileSearch className="w-4 h-4" />
                    </button>
                    <button onClick={() => setShowDxfProperties(!showDxfProperties)}
                      className={`p-1.5 rounded-lg transition ${showDxfProperties ? 'bg-blue-100 text-blue-700' : 'hover:bg-white text-slate-600'}`} title="Właściwości elementu">
                      <Info className="w-4 h-4" />
                    </button>
                    <div className="w-px h-5 bg-slate-200 mx-0.5" />
                    <button onClick={() => setShowDxfAnalysis(true)}
                      className="p-1.5 rounded-lg transition hover:bg-white text-slate-600" title="Analiza DXF + AI">
                      <BarChart3 className="w-4 h-4" />
                    </button>
                    <button onClick={() => { if (dxfAnalysis && dxfTakeoffRules.length > 0) { const result = applyRules(dxfAnalysis, dxfTakeoffRules); setDxfTakeoffResult(result); } setShowDxfTakeoff(!showDxfTakeoff); }}
                      className={`p-1.5 rounded-lg transition ${showDxfTakeoff ? 'bg-blue-100 text-blue-700' : 'hover:bg-white text-slate-600'}`} title="Przedmiar z DXF">
                      <BookOpen className="w-4 h-4" />
                    </button>
                    <div className="w-px h-5 bg-slate-200 mx-0.5" />
                    <button onClick={() => setShowDxfExportModal(true)}
                      className="p-1.5 rounded-lg transition hover:bg-white text-slate-600" title="Eksport do PDF">
                      <Printer className="w-4 h-4" />
                    </button>
                  </>
                )}
                {fileType === 'dwg' && selectedPlan && (
                  <button onClick={() => setShowDwgConvert(true)}
                    className="p-1.5 rounded-lg transition hover:bg-white text-slate-600" title="Konwertuj DWG → DXF">
                    <FileType2 className="w-4 h-4" />
                  </button>
                )}
                {fileType === 'pdf' && pdfDoc && (
                  <>
                    <div className="w-px h-5 bg-slate-200 mx-0.5" />
                    <button onClick={() => setShowPdfAnalysis(true)}
                      className="p-1.5 rounded-lg transition hover:bg-white text-slate-600" title="Analiza AI rysunku PDF">
                      <Sparkles className="w-4 h-4" />
                    </button>
                    {pdfAnalysis && (
                      <>
                        <button onClick={() => setShowPdfStyleGroups(!showPdfStyleGroups)}
                          className={`p-1.5 rounded-lg transition ${showPdfStyleGroups ? 'bg-blue-100 text-blue-700' : 'hover:bg-white text-slate-600'}`} title="Grupy stylów PDF">
                          <Filter className="w-4 h-4" />
                        </button>
                        <button onClick={() => { if (pdfAnalysis && pdfTakeoffRules.length > 0) { const result = applyRules(pdfAnalysis, pdfTakeoffRules); setPdfTakeoffResult(result); } setShowPdfTakeoff(!showPdfTakeoff); }}
                          className={`p-1.5 rounded-lg transition ${showPdfTakeoff ? 'bg-blue-100 text-blue-700' : 'hover:bg-white text-slate-600'}`} title="Przedmiar z PDF">
                          <BookOpen className="w-4 h-4" />
                        </button>
                        {(pdfLegend || pdfAnalysisExtra?.legend) && (
                          <button onClick={() => setShowPdfLegend(!showPdfLegend)}
                            className={`p-1.5 rounded-lg transition ${showPdfLegend ? 'bg-amber-100 text-amber-700' : 'hover:bg-white text-slate-600'}`} title="Legenda PDF">
                            <MapPin className="w-4 h-4" />
                          </button>
                        )}
                        <button onClick={() => setShowPdfMappingDict(!showPdfMappingDict)}
                          className={`p-1.5 rounded-lg transition ${showPdfMappingDict ? 'bg-indigo-100 text-indigo-700' : 'hover:bg-white text-slate-600'}`} title="Słownik mapowań">
                          <Hash className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </>
                )}
                <button onClick={() => setShowNavigator(!showNavigator)}
                  className={`p-1.5 rounded-lg transition ${showNavigator ? 'bg-blue-100 text-blue-700' : 'hover:bg-white text-slate-600'}`} title="Panel nawigacji — lista oznaczeń">
                  <LayoutList className="w-4 h-4" />
                </button>
              </div>

              {/* Plan viewer area */}
              <div ref={viewerRef} className="flex-1 overflow-auto bg-slate-100 relative"
                onDrop={handleFileDrop} onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}>
                {fileType === 'dwg' ? (
                  <div className="flex-1 flex flex-col items-center justify-center p-12 text-center relative">
                    <AlertTriangle className="w-16 h-16 text-amber-400 mb-4" />
                    <h3 className="text-lg font-semibold text-slate-700 mb-2">Format DWG</h3>
                    <p className="text-sm text-slate-500 mb-6 max-w-md">
                      Podgląd plików DWG nie jest dostępny w przeglądarce. Skonwertuj do DXF lub pobierz plik.
                    </p>
                    <div className="flex items-center gap-3">
                      <button onClick={() => setShowDwgConvert(true)} className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 shadow-sm">
                        <FileType2 className="w-5 h-5" /> Konwertuj DWG → DXF
                      </button>
                      <a href={selectedPlan!.file_url} download className="flex items-center gap-2 px-6 py-3 border border-slate-300 text-slate-700 rounded-xl font-medium hover:bg-slate-50">
                        <FileDown className="w-5 h-5" /> Pobierz plik DWG
                      </a>
                    </div>
                    {showDwgConvert && selectedPlan && (
                      <DwgConvertPanel
                        fileName={selectedPlan.original_filename || selectedPlan.name}
                        fileUrl={selectedPlan.file_url}
                        onConvertComplete={(dxfText, dxfFileName) => {
                          setShowDwgConvert(false);
                          try {
                            const dxf = parseDxf(dxfText);
                            setDxfData(dxf);
                            setDxfLayers(extractLayerInfo(dxf));
                            const { url: blobUrl, viewBox } = renderDxfToBlobUrl(dxf);
                            setDxfImageUrl(blobUrl);
                            setDxfViewBox(viewBox);
                          } catch (err) {
                            console.error('DXF parse after convert error:', err);
                            notify('Nie udało się przetworzyć skonwertowanego pliku DXF', 'error');
                          }
                        }}
                        onClose={() => setShowDwgConvert(false)}
                      />
                    )}
                  </div>
                ) : fileType === 'dxf' && dxfLoading ? (
                  <div className="flex-1 flex flex-col items-center justify-center p-12">
                    <Loader2 className="w-10 h-10 text-blue-500 animate-spin mb-3" />
                    <p className="text-sm text-slate-500">Renderowanie pliku DXF...</p>
                  </div>
                ) : fileType === 'dxf' && !dxfImageUrl ? (
                  <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
                    <AlertTriangle className="w-12 h-12 text-amber-400 mb-3" />
                    <p className="text-sm text-slate-500 mb-4">Nie udało się wyrenderować podglądu DXF.</p>
                    <a href={selectedPlan!.file_url} download className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 shadow-sm">
                      <FileDown className="w-4 h-4" /> Pobierz plik DXF
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
                      {/* DXF rendered as SVG image */}
                      {fileType === 'dxf' && dxfImageUrl && (
                        <img src={dxfImageUrl} alt={selectedPlan!.name}
                          className="shadow-lg bg-white"
                          onLoad={e => { const img = e.target as HTMLImageElement; setPlanNatW(img.naturalWidth); setPlanNatH(img.naturalHeight); }}
                          onError={() => notify('Nie można wyświetlić podglądu DXF', 'error')} />
                      )}
                      {/* SVG Annotation Overlay */}
                      <svg ref={svgRef} viewBox={`0 0 ${planNatW} ${planNatH}`}
                        className="absolute top-0 left-0 w-full h-full"
                        style={{ cursor: activeTool === 'pointer' ? 'default' : activeTool === 'eraser' ? 'not-allowed' : 'crosshair' }}
                        onMouseDown={handleSvgMouseDown} onMouseMove={handleSvgMouseMove} onMouseUp={handleSvgMouseUp}
                        onMouseLeave={handleSvgMouseUp} onDoubleClick={handleSvgDoubleClick}>
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
                        {/* Comment input */}
                        {commentInputPos && (
                          <foreignObject x={commentInputPos.x} y={commentInputPos.y - 10} width="220" height="80">
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <textarea ref={commentInputRef} value={commentInputValue} onChange={e => setCommentInputValue(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (commentInputValue.trim()) { saveCommentToDb(commentInputPos.x, commentInputPos.y, commentInputValue); setCommentInputPos(null); } } if (e.key === 'Escape') setCommentInputPos(null); }}
                                className="w-full px-2 py-1 border border-blue-400 rounded text-xs bg-white/95 focus:outline-none resize-none"
                                rows={2} placeholder="Komentarz..." autoFocus />
                              <div style={{ display: 'flex', gap: '4px' }}>
                                <button onClick={() => { if (commentInputValue.trim()) { saveCommentToDb(commentInputPos.x, commentInputPos.y, commentInputValue); setCommentInputPos(null); } }}
                                  style={{ padding: '2px 8px', background: '#3b82f6', color: '#fff', borderRadius: '4px', fontSize: '10px', border: 'none', cursor: 'pointer' }}>Dodaj</button>
                                <button onClick={() => setCommentInputPos(null)}
                                  style={{ padding: '2px 8px', background: '#e2e8f0', borderRadius: '4px', fontSize: '10px', border: 'none', cursor: 'pointer' }}>Anuluj</button>
                              </div>
                            </div>
                          </foreignObject>
                        )}
                        {/* Comment markers */}
                        {comments.map(c => (
                          <foreignObject key={`c-${c.id}`} x={c.position_x - 14} y={c.position_y - 14} width="28" height="28">
                            <div onClick={e => { e.stopPropagation(); setSelectedComment(selectedComment?.id === c.id ? null : c); }}
                              title={c.content}
                              style={{ width: 28, height: 28, borderRadius: '50%', background: c.is_resolved ? '#22c55e' : '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 2px 6px rgba(0,0,0,0.3)', border: selectedComment?.id === c.id ? '2px solid #fff' : 'none' }}>
                              <MessageSquare style={{ width: 14, height: 14, color: '#fff' }} />
                            </div>
                          </foreignObject>
                        ))}
                        {/* Photo/pin markers */}
                        {pins.map(p => (
                          <foreignObject key={`p-${p.id}`} x={p.position_x - 14} y={p.position_y - 14} width="28" height="28">
                            <div onClick={e => { e.stopPropagation(); setSelectedPin(selectedPin?.id === p.id ? null : p); }}
                              style={{ width: 28, height: 28, borderRadius: '50%', background: '#22c55e', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 2px 6px rgba(0,0,0,0.3)', border: selectedPin?.id === p.id ? '2px solid #fff' : 'none' }}>
                              <Camera style={{ width: 14, height: 14, color: '#fff' }} />
                            </div>
                          </foreignObject>
                        ))}
                        {/* Polyline measurement in-progress */}
                        {polylinePoints.length > 0 && (
                          <g>
                            {polylinePoints.map((pt, i) => {
                              if (i === 0) return <circle key={`pp${i}`} cx={pt.x} cy={pt.y} r={4} fill={annColor} />;
                              const prev = polylinePoints[i - 1];
                              const dist = Math.sqrt((pt.x - prev.x) ** 2 + (pt.y - prev.y) ** 2) * (selectedPlan?.scale_ratio || 1);
                              const mx = (pt.x + prev.x) / 2, my = (pt.y + prev.y) / 2;
                              const angleDeg = Math.atan2(pt.y - prev.y, pt.x - prev.x) * 180 / Math.PI;
                              let textAngle = angleDeg; if (textAngle > 90 || textAngle < -90) textAngle += 180;
                              return <g key={`pp${i}`}>
                                <line x1={prev.x} y1={prev.y} x2={pt.x} y2={pt.y} stroke={annColor} strokeWidth={annWidth} strokeDasharray="6 3" />
                                <circle cx={pt.x} cy={pt.y} r={4} fill={annColor} />
                                <text transform={`translate(${mx},${my}) rotate(${textAngle})`} dy={-6} fill="#fff" fontSize="11" textAnchor="middle" fontFamily="Arial" fontWeight="600" paintOrder="stroke" stroke={annColor} strokeWidth={3}>{dist.toFixed(2)} {scaleUnit}</text>
                              </g>;
                            })}
                            {polylineCursorPt && polylinePoints.length > 0 && (
                              <line x1={polylinePoints[polylinePoints.length - 1].x} y1={polylinePoints[polylinePoints.length - 1].y}
                                x2={polylineCursorPt.x} y2={polylineCursorPt.y} stroke={annColor} strokeWidth={1} strokeDasharray="4 4" opacity={0.5} />
                            )}
                            {/* Pulsing circle on first point when cursor is near (area close hint) */}
                            {polylinePoints.length >= 3 && polylineCursorPt && (() => {
                              const first = polylinePoints[0];
                              const dist = Math.sqrt((polylineCursorPt.x - first.x) ** 2 + (polylineCursorPt.y - first.y) ** 2);
                              if (dist < 30) return <circle cx={first.x} cy={first.y} r={12} fill="none" stroke={annColor} strokeWidth={2} opacity={0.7}>
                                <animate attributeName="r" values="8;14;8" dur="1.2s" repeatCount="indefinite" />
                                <animate attributeName="opacity" values="0.8;0.3;0.8" dur="1.2s" repeatCount="indefinite" />
                              </circle>;
                              return null;
                            })()}
                          </g>
                        )}
                        {/* Ruler single click-to-click preview */}
                        {rulerSingleStart && rulerSingleCursorPt && (
                          <g>
                            <line x1={rulerSingleStart.x} y1={rulerSingleStart.y} x2={rulerSingleCursorPt.x} y2={rulerSingleCursorPt.y}
                              stroke={annColor} strokeWidth={annWidth} strokeDasharray="6 3" />
                            <circle cx={rulerSingleStart.x} cy={rulerSingleStart.y} r={4} fill={annColor} />
                            <circle cx={rulerSingleCursorPt.x} cy={rulerSingleCursorPt.y} r={4} fill={annColor} opacity={0.5} />
                            {(() => {
                              const dx = rulerSingleCursorPt.x - rulerSingleStart.x;
                              const dy = rulerSingleCursorPt.y - rulerSingleStart.y;
                              const pxDist = Math.sqrt(dx * dx + dy * dy);
                              const dist = pxDist * (selectedPlan?.scale_ratio || 1);
                              const mx = (rulerSingleStart.x + rulerSingleCursorPt.x) / 2;
                              const my = (rulerSingleStart.y + rulerSingleCursorPt.y) / 2;
                              const angleDeg = Math.atan2(dy, dx) * 180 / Math.PI;
                              let textAngle = angleDeg; if (textAngle > 90 || textAngle < -90) textAngle += 180;
                              return <text transform={`translate(${mx},${my}) rotate(${textAngle})`} dy={-6} fill="#fff" fontSize="11" textAnchor="middle" fontFamily="Arial" fontWeight="600" paintOrder="stroke" stroke={annColor} strokeWidth={3}>{dist.toFixed(2)} {scaleUnit}</text>;
                            })()}
                          </g>
                        )}
                        {/* Count markers (manual) */}
                        {countItems.map((item, i) => (
                          <g key={`count-${i}`}>
                            <circle cx={item.x} cy={item.y} r={14} fill="#ef4444" stroke="white" strokeWidth={2} />
                            <text x={item.x} y={item.y + 5} fill="white" fontSize="12" fontWeight="700" textAnchor="middle" fontFamily="Arial">{i + 1}</text>
                          </g>
                        ))}
                        {/* DXF auto-count markers */}
                        {dxfCountMatches.map((item, i) => (
                          <g key={`dxfc-${i}`}>
                            <circle cx={item.x} cy={item.y} r={16} fill="#f97316" fillOpacity={0.25} stroke="#f97316" strokeWidth={2} />
                            <text x={item.x} y={item.y + 5} fill="#f97316" fontSize="11" fontWeight="700" textAnchor="middle" fontFamily="Arial" paintOrder="stroke" stroke="white" strokeWidth={3}>{i + 1}</text>
                          </g>
                        ))}
                        {/* PDF visible style groups overlay */}
                        {showPdfStyleGroups && pdfStyleGroups.filter(g => g.visible).map(sg => {
                          // When pdfAnalysisExtra is available (fresh analysis), use extraction.paths
                          if (pdfAnalysisExtra) {
                            return sg.pathIndices.slice(0, 150).map((pi, idx) => {
                              const p = pdfAnalysisExtra.extraction.paths[pi];
                              if (!p) return null;
                              const d = p.segments.map(seg => {
                                if (seg.type === 'M' && seg.points[0]) return `M${seg.points[0].x},${seg.points[0].y}`;
                                if (seg.type === 'L' && seg.points[0]) return `L${seg.points[0].x},${seg.points[0].y}`;
                                if (seg.type === 'C' && seg.points.length >= 3) return `C${seg.points[0].x},${seg.points[0].y} ${seg.points[1].x},${seg.points[1].y} ${seg.points[2].x},${seg.points[2].y}`;
                                if (seg.type === 'Z') return 'Z';
                                return '';
                              }).join(' ');
                              return <path key={`sgov-${sg.id}-${idx}`} d={d} fill="none" stroke={sg.strokeColor} strokeWidth={2} strokeOpacity={0.35} />;
                            });
                          }
                          // Fallback: reconstruct from entity geometry (loaded from DB)
                          if (!pdfAnalysis) return null;
                          const entities = pdfAnalysis.entities.filter(e => e.layerName === sg.name && e.geometry.points?.length);
                          return entities.slice(0, 150).map((entity, idx) => {
                            const pts = entity.geometry.points!;
                            const d = pts.map((p, i) => i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`).join(' ');
                            return <path key={`sgov-${sg.id}-${idx}`} d={d} fill="none" stroke={sg.strokeColor} strokeWidth={2} strokeOpacity={0.35} />;
                          });
                        })}
                        {/* PDF highlight paths */}
                        {pdfHighlightPaths.map((path, pi) => {
                          const d = path.segments.map(seg => {
                            if (seg.type === 'M' && seg.points[0]) return `M${seg.points[0].x},${seg.points[0].y}`;
                            if (seg.type === 'L' && seg.points[0]) return `L${seg.points[0].x},${seg.points[0].y}`;
                            if (seg.type === 'C' && seg.points.length >= 3) return `C${seg.points[0].x},${seg.points[0].y} ${seg.points[1].x},${seg.points[1].y} ${seg.points[2].x},${seg.points[2].y}`;
                            if (seg.type === 'Z') return 'Z';
                            return '';
                          }).join(' ');
                          return <path key={`pdfhl-${pi}`} d={d} fill="none" stroke="#f97316" strokeWidth={4} strokeOpacity={0.7} />;
                        })}
                        {/* PDF highlight points (symbols) */}
                        {pdfHighlightPoints.map((pt, i) => (
                          <g key={`pdfpt-${i}`}>
                            <circle cx={pt.x} cy={pt.y} r={14} fill="#f97316" fillOpacity={0.25} stroke="#f97316" strokeWidth={2} />
                            <text x={pt.x} y={pt.y + 4} fill="#f97316" fontSize="10" fontWeight="700" textAnchor="middle" fontFamily="Arial" paintOrder="stroke" stroke="white" strokeWidth={3}>{i + 1}</text>
                          </g>
                        ))}
                        {/* SNAP indicator */}
                        {dxfSnapEnabled && dxfSnapPoint && dxfViewBox && (() => {
                          const screenPt = dxfToScreenCoords(dxfSnapPoint, planNatW, planNatH, dxfViewBox);
                          const snapColors: Record<SnapType, string> = { endpoint: '#ef4444', midpoint: '#22c55e', center: '#3b82f6', intersection: '#f59e0b', nearest: '#8b5cf6' };
                          const color = snapColors[dxfSnapPoint.type] || '#ef4444';
                          return (
                            <g>
                              {dxfSnapPoint.type === 'endpoint' && (
                                <rect x={screenPt.x - 5} y={screenPt.y - 5} width={10} height={10} fill="none" stroke={color} strokeWidth={2} />
                              )}
                              {dxfSnapPoint.type === 'midpoint' && (
                                <polygon points={`${screenPt.x},${screenPt.y - 6} ${screenPt.x - 6},${screenPt.y + 4} ${screenPt.x + 6},${screenPt.y + 4}`} fill="none" stroke={color} strokeWidth={2} />
                              )}
                              {dxfSnapPoint.type === 'center' && (
                                <circle cx={screenPt.x} cy={screenPt.y} r={6} fill="none" stroke={color} strokeWidth={2} />
                              )}
                              {dxfSnapPoint.type === 'intersection' && (
                                <g><line x1={screenPt.x - 6} y1={screenPt.y - 6} x2={screenPt.x + 6} y2={screenPt.y + 6} stroke={color} strokeWidth={2} /><line x1={screenPt.x + 6} y1={screenPt.y - 6} x2={screenPt.x - 6} y2={screenPt.y + 6} stroke={color} strokeWidth={2} /></g>
                              )}
                              {dxfSnapPoint.type === 'nearest' && (
                                <g><circle cx={screenPt.x} cy={screenPt.y} r={4} fill={color} /><circle cx={screenPt.x} cy={screenPt.y} r={8} fill="none" stroke={color} strokeWidth={1} strokeDasharray="2 2" /></g>
                              )}
                            </g>
                          );
                        })()}
                        {/* Screenshot selection rect */}
                        {screenshotRect && (
                          <rect x={Math.min(screenshotRect.x1, screenshotRect.x2)} y={Math.min(screenshotRect.y1, screenshotRect.y2)}
                            width={Math.abs(screenshotRect.x2 - screenshotRect.x1)} height={Math.abs(screenshotRect.y2 - screenshotRect.y1)}
                            fill="#3b82f6" fillOpacity={0.15} stroke="#3b82f6" strokeWidth={2} strokeDasharray="8 4" />
                        )}
                      </svg>
                    </div>
                  </div>
                )}
                {/* DXF coordinates display */}
                {fileType === 'dxf' && dxfCursorCoords && (
                  <div className="absolute bottom-1 left-1 z-30 bg-black/70 text-white text-[10px] font-mono px-2 py-0.5 rounded select-none pointer-events-none">
                    X: {dxfCursorCoords.x.toFixed(2)} &nbsp; Y: {dxfCursorCoords.y.toFixed(2)}
                    {dxfSnapEnabled && dxfSnapPoint && (
                      <span className="ml-2 text-green-300">[SNAP: {dxfSnapPoint.type}]</span>
                    )}
                  </div>
                )}
              </div>

              {/* Bottom annotation toolbar */}
              <div className="px-3 py-1.5 border-t border-slate-200 bg-white flex items-center gap-0.5 flex-shrink-0 overflow-x-auto" onClick={e => e.stopPropagation()}>
                {/* Pointer */}
                <button onClick={() => { setActiveTool('pointer'); setPolylinePoints([]); setPolylineCursorPt(null); setRulerSingleStart(null); setRulerSingleCursorPt(null); setCountItems([]); setDxfCountMatches([]); setDxfCountLabel(''); }}
                  className={`p-2 rounded-lg transition ${activeTool === 'pointer' ? 'bg-blue-100 text-blue-700 shadow-inner' : 'hover:bg-slate-100 text-slate-600'}`} title="Zaznacz (V)">
                  <MousePointer className="w-5 h-5" />
                </button>

                <div className="w-px h-6 bg-slate-200 mx-1" />

                {/* Pen dropdown */}
                <div className="relative">
                  <button onClick={e => { e.stopPropagation(); setShowPenDropdown(!showPenDropdown); }}
                    className={`p-2 rounded-lg flex items-center gap-0.5 transition ${['pen', 'highlighter'].includes(activeTool) ? 'bg-blue-100 text-blue-700 shadow-inner' : 'hover:bg-slate-100 text-slate-600'}`}
                    title="Rysowanie (P/H)">
                    <PenTool className="w-5 h-5" /><ChevronDown className="w-3 h-3 opacity-50" />
                  </button>
                  {showPenDropdown && (
                    <div className="absolute left-0 bottom-full mb-1 w-48 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-1" onClick={e => e.stopPropagation()}>
                      <button className={`w-full flex items-center gap-3 px-3 py-2 text-sm ${activeTool === 'pen' ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'}`}
                        onClick={() => { setActiveTool('pen'); setShowPenDropdown(false); }}>
                        <PenTool className="w-4 h-4" /> Pióro <span className="ml-auto text-[10px] text-slate-400 font-mono">P</span>
                      </button>
                      <button className={`w-full flex items-center gap-3 px-3 py-2 text-sm ${activeTool === 'highlighter' ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'}`}
                        onClick={() => { setActiveTool('highlighter'); setShowPenDropdown(false); }}>
                        <Pencil className="w-4 h-4" /> Zakreślacz <span className="ml-auto text-[10px] text-slate-400 font-mono">H</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Shape dropdown */}
                <div className="relative">
                  <button onClick={e => { e.stopPropagation(); setShowShapeDropdown(!showShapeDropdown); }}
                    className={`p-2 rounded-lg flex items-center gap-0.5 transition ${['rectangle', 'ellipse', 'arrow', 'line'].includes(activeTool) ? 'bg-blue-100 text-blue-700 shadow-inner' : 'hover:bg-slate-100 text-slate-600'}`}
                    title="Kształty (R/O/A/L)">
                    <Square className="w-5 h-5" /><ChevronDown className="w-3 h-3 opacity-50" />
                  </button>
                  {showShapeDropdown && (
                    <div className="absolute left-0 bottom-full mb-1 w-52 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-1" onClick={e => e.stopPropagation()}>
                      {([
                        { tool: 'rectangle' as const, label: 'Prostokąt', icon: Square, key: 'R' },
                        { tool: 'ellipse' as const, label: 'Elipsa', icon: Circle, key: 'O' },
                        { tool: 'arrow' as const, label: 'Strzałka', icon: ArrowUpRight, key: 'A' },
                        { tool: 'line' as const, label: 'Linia', icon: Minus, key: 'L' },
                      ]).map(item => (
                        <button key={item.tool}
                          className={`w-full flex items-center gap-3 px-3 py-2 text-sm ${activeTool === item.tool ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'}`}
                          onClick={() => { setActiveTool(item.tool); setShowShapeDropdown(false); }}>
                          <item.icon className="w-4 h-4" /> {item.label} <span className="ml-auto text-[10px] text-slate-400 font-mono">{item.key}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Text */}
                <button onClick={() => setActiveTool('text')}
                  className={`p-2 rounded-lg transition ${activeTool === 'text' ? 'bg-blue-100 text-blue-700 shadow-inner' : 'hover:bg-slate-100 text-slate-600'}`} title="Tekst (T)">
                  <Type className="w-5 h-5" />
                </button>

                {/* Cloud markup */}
                <button onClick={() => setActiveTool('cloud')}
                  className={`p-2 rounded-lg transition ${activeTool === 'cloud' ? 'bg-blue-100 text-blue-700 shadow-inner' : 'hover:bg-slate-100 text-slate-600'}`} title="Chmura rewizyjna (K)">
                  <CloudLightning className="w-5 h-5" />
                </button>

                {/* Callout */}
                <button onClick={() => setActiveTool('callout')}
                  className={`p-2 rounded-lg transition ${activeTool === 'callout' ? 'bg-blue-100 text-blue-700 shadow-inner' : 'hover:bg-slate-100 text-slate-600'}`} title="Odnośnik z tekstem (B)">
                  <MessageCircleWarning className="w-5 h-5" />
                </button>

                <div className="w-px h-6 bg-slate-200 mx-1" />

                {/* Ruler dropdown */}
                <div className="relative">
                  <button onClick={e => { e.stopPropagation(); setShowRulerDropdown(!showRulerDropdown); }}
                    className={`p-2 rounded-lg flex items-center gap-0.5 transition ${activeTool === 'ruler' ? 'bg-blue-100 text-blue-700 shadow-inner' : 'hover:bg-slate-100 text-slate-600'}`}
                    title={selectedPlan?.scale_ratio ? 'Pomiar (M)' : 'Pomiar — skalibruj skalę (M)'}>
                    <Ruler className="w-5 h-5" /><ChevronDown className="w-3 h-3 opacity-50" />
                  </button>
                  {showRulerDropdown && (
                    <div className="absolute left-0 bottom-full mb-1 w-64 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-1" onClick={e => e.stopPropagation()}>
                      <button className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm ${activeTool === 'ruler' && rulerMode === 'single' ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'}`}
                        onClick={() => { setActiveTool('ruler'); setRulerMode('single'); setShowRulerDropdown(false); setPolylinePoints([]); setRulerSingleStart(null); setRulerSingleCursorPt(null); }}>
                        <Crosshair className="w-4 h-4" /> Odcinek
                      </button>
                      <button className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm ${activeTool === 'ruler' && rulerMode === 'polyline' ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'}`}
                        onClick={() => { setActiveTool('ruler'); setRulerMode('polyline'); setShowRulerDropdown(false); setPolylinePoints([]); setRulerSingleStart(null); setRulerSingleCursorPt(null); }}>
                        <Ruler className="w-4 h-4" /> Polilinia — łamana
                      </button>
                      <button className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm ${activeTool === 'ruler' && rulerMode === 'area' ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'}`}
                        onClick={() => { setActiveTool('ruler'); setRulerMode('area'); setShowRulerDropdown(false); setPolylinePoints([]); setRulerSingleStart(null); setRulerSingleCursorPt(null); }}>
                        <Square className="w-4 h-4" /> Polilinia / obszar
                      </button>
                    </div>
                  )}
                </div>

                {/* Count tool */}
                <button onClick={() => { setActiveTool('count'); setCountItems([]); setDxfCountMatches([]); setDxfCountLabel(''); }}
                  className={`p-2 rounded-lg transition ${activeTool === 'count' ? 'bg-amber-100 text-amber-700 shadow-inner' : 'hover:bg-slate-100 text-slate-600'}`} title="Licznik elementów (N)">
                  <Hash className="w-5 h-5" />
                </button>
                {activeTool === 'count' && (countItems.length > 0 || dxfCountMatches.length > 0) && (
                  <div className="flex items-center gap-1 ml-1">
                    {dxfCountMatches.length > 0 ? (
                      <span className="text-xs font-bold text-orange-700 bg-orange-50 px-2 py-0.5 rounded-full truncate max-w-[200px]" title={dxfCountLabel}>
                        {dxfCountLabel}: {dxfCountMatches.length}
                      </span>
                    ) : (
                      <span className="text-xs font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">Σ {countItems.length}</span>
                    )}
                    <button onClick={() => { setCountItems([]); setDxfCountMatches([]); setDxfCountLabel(''); }} className="p-1 hover:bg-red-50 rounded text-slate-400 hover:text-red-500" title="Wyczyść licznik">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
                {pdfHighlightLabel && (pdfHighlightPaths.length > 0 || pdfHighlightPoints.length > 0) && (
                  <div className="flex items-center gap-1 ml-1">
                    <span className="text-xs font-bold text-orange-700 bg-orange-50 px-2 py-0.5 rounded-full truncate max-w-[250px]" title={pdfHighlightLabel}>
                      {pdfHighlightLabel}: {pdfHighlightPaths.length + pdfHighlightPoints.length}
                    </span>
                    <button onClick={() => { setPdfHighlightPaths([]); setPdfHighlightPoints([]); setPdfHighlightLabel(''); }} className="p-1 hover:bg-red-50 rounded text-slate-400 hover:text-red-500" title="Ukryj podświetlenie">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                <div className="w-px h-6 bg-slate-200 mx-1" />

                {/* Comment */}
                <button onClick={() => setActiveTool('comment')}
                  className={`p-2 rounded-lg transition ${activeTool === 'comment' ? 'bg-blue-100 text-blue-700 shadow-inner' : 'hover:bg-slate-100 text-slate-600'}`} title="Komentarz (C)">
                  <MessageSquare className="w-5 h-5" />
                </button>

                {/* Camera */}
                <button onClick={() => setActiveTool('camera')}
                  className={`p-2 rounded-lg transition ${activeTool === 'camera' ? 'bg-green-100 text-green-700 shadow-inner' : 'hover:bg-slate-100 text-slate-600'}`} title="Zdjęcie — przypnij do planu">
                  <Camera className="w-5 h-5" />
                </button>

                {/* Screenshot */}
                <button onClick={() => setActiveTool('screenshot')}
                  className={`p-2 rounded-lg transition ${activeTool === 'screenshot' ? 'bg-purple-100 text-purple-700 shadow-inner' : 'hover:bg-slate-100 text-slate-600'}`} title="Zrzut ekranu — zaznacz obszar">
                  <Scissors className="w-5 h-5" />
                </button>

                {/* Eraser */}
                <button onClick={() => setActiveTool('eraser')}
                  className={`p-2 rounded-lg transition ${activeTool === 'eraser' ? 'bg-red-100 text-red-600 shadow-inner' : 'hover:bg-slate-100 text-slate-600'}`} title="Gumka — kliknij oznaczenie aby usunąć (E)">
                  <Eraser className="w-5 h-5" />
                </button>

                <div className="w-px h-6 bg-slate-200 mx-1" />

                {/* Color picker */}
                <div className="relative">
                  <button onClick={e => { e.stopPropagation(); setShowColorPicker(!showColorPicker); }}
                    className="p-2 hover:bg-slate-100 rounded-lg flex items-center gap-1.5" title="Kolor i grubość linii">
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
                            style={{ backgroundColor: c }} title={c} />
                        ))}
                      </div>
                      <p className="text-xs font-medium text-slate-500 mb-2">Grubość</p>
                      <div className="flex gap-1.5">
                        {STROKE_WIDTHS.map(w => (
                          <button key={w} onClick={() => { setAnnWidth(w); setShowColorPicker(false); }}
                            className={`w-8 h-8 rounded-lg border flex items-center justify-center transition ${annWidth === w ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-400'}`}
                            title={`${w}px`}>
                            <div className="rounded-full bg-slate-800" style={{ width: `${Math.min(w * 2, 16)}px`, height: `${Math.min(w * 2, 16)}px` }} />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex-1" />

                {/* Save & Undo */}
                <button onClick={handleUndo} disabled={!hasUnsavedChanges}
                  className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 disabled:opacity-30 transition" title="Cofnij zmiany (Ctrl+Z)">
                  <Undo2 className="w-5 h-5" />
                </button>
                <button onClick={handleSaveAll} disabled={!hasUnsavedChanges || saving}
                  className={`p-2 rounded-lg transition flex items-center gap-1 ${hasUnsavedChanges ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm' : 'hover:bg-slate-100 text-slate-400'}`} title="Zapisz oznaczenia (Ctrl+S)">
                  {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                </button>
                {selectedAnnotation >= 0 && (
                  <button onClick={() => { deleteAnnotation(selectedAnnotation); }}
                    className="p-1.5 hover:bg-red-50 rounded-lg text-red-400 hover:text-red-600 ml-1" title="Usuń zaznaczenie (Del)">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Status bar with contextual hints */}
              <div className="px-3 py-1 border-t border-slate-100 bg-slate-50 flex items-center gap-3 flex-shrink-0 text-[11px] text-slate-400" onClick={e => e.stopPropagation()}>
                <span className="font-medium text-slate-500">
                  {activeTool === 'pointer' && 'Zaznaczanie'}
                  {activeTool === 'pen' && 'Pióro'}
                  {activeTool === 'highlighter' && 'Zakreślacz'}
                  {activeTool === 'rectangle' && 'Prostokąt'}
                  {activeTool === 'ellipse' && 'Elipsa'}
                  {activeTool === 'arrow' && 'Strzałka'}
                  {activeTool === 'line' && 'Linia'}
                  {activeTool === 'text' && 'Tekst'}
                  {activeTool === 'ruler' && (rulerMode === 'single' ? 'Pomiar — odcinek' : rulerMode === 'polyline' ? 'Pomiar — polilinia' : 'Pomiar — obszar')}
                  {activeTool === 'comment' && 'Komentarz'}
                  {activeTool === 'camera' && 'Zdjęcie'}
                  {activeTool === 'screenshot' && 'Zrzut ekranu'}
                  {activeTool === 'eraser' && 'Gumka'}
                  {activeTool === 'cloud' && 'Chmura rewizyjna'}
                  {activeTool === 'callout' && 'Odnośnik'}
                  {activeTool === 'count' && 'Licznik'}
                </span>
                <span>
                  {activeTool === 'pointer' && 'Kliknij element aby go zaznaczyć · Del = usuń'}
                  {activeTool === 'pen' && 'Rysuj dowolny kształt przytrzymując przycisk myszy'}
                  {activeTool === 'highlighter' && 'Zaznacz ważny fragment przytrzymując przycisk myszy'}
                  {(activeTool === 'rectangle' || activeTool === 'ellipse' || activeTool === 'cloud') && 'Kliknij i przeciągnij aby narysować'}
                  {(activeTool === 'arrow' || activeTool === 'line' || activeTool === 'callout') && 'Kliknij i przeciągnij od początku do końca'}
                  {activeTool === 'text' && 'Kliknij na planie aby wstawić tekst'}
                  {activeTool === 'ruler' && rulerMode === 'single' && 'Kliknij punkt początkowy, następnie kliknij punkt końcowy'}
                  {activeTool === 'ruler' && rulerMode !== 'single' && 'Klikaj punkty · Dwuklik lub Enter = zakończ pomiar'}
                  {activeTool === 'comment' && 'Kliknij na planie aby dodać komentarz'}
                  {activeTool === 'camera' && 'Kliknij na planie aby przypiąć zdjęcie'}
                  {activeTool === 'screenshot' && 'Zaznacz obszar aby pobrać fragment jako PNG'}
                  {activeTool === 'eraser' && 'Kliknij oznaczenie aby je usunąć'}
                  {activeTool === 'count' && `Klikaj elementy aby je policzyć · Esc = wyczyść`}
                </span>
                <span className="ml-auto">Esc = anuluj · Ctrl+Z = cofnij · Ctrl+S = zapisz</span>
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

        {/* NAVIGATOR PANEL (RIGHT) */}
        {showNavigator && viewingPlan && (
          <div className="w-[300px] min-w-[260px] border-l border-slate-200 bg-white flex flex-col overflow-hidden flex-shrink-0">
            <div className="px-3 py-2.5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <span className="font-semibold text-slate-700 text-sm flex items-center gap-1.5"><LayoutList className="w-4 h-4" /> Nawigator</span>
              <button onClick={() => setShowNavigator(false)} className="p-1 hover:bg-slate-200 rounded text-slate-400"><X className="w-4 h-4" /></button>
            </div>
            {/* Filter */}
            <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-1 flex-wrap">
              {[
                { key: 'all', label: 'Wszystko' },
                { key: 'annotations', label: 'Oznaczenia' },
                { key: 'measurements', label: 'Pomiary' },
                { key: 'comments', label: 'Komentarze' },
                { key: 'photos', label: 'Zdjęcia' },
              ].map(f => (
                <button key={f.key} onClick={() => setNavigatorFilter(f.key)}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition ${navigatorFilter === f.key ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                  {f.label}
                </button>
              ))}
            </div>
            {/* Items list */}
            <div className="flex-1 overflow-y-auto">
              {/* Annotations */}
              {(navigatorFilter === 'all' || navigatorFilter === 'annotations') && annotations.filter(a => a.type !== 'measurement').map((ann, i) => (
                <div key={`na-${i}`} onClick={() => { setSelectedAnnotation(i); if (ann.geometry.x1 != null) scrollToPoint(ann.geometry.x1, ann.geometry.y1); else if (ann.geometry.x != null) scrollToPoint(ann.geometry.x, ann.geometry.y); else if (ann.geometry.points?.[0]) scrollToPoint(ann.geometry.points[0][0], ann.geometry.points[0][1]); }}
                  className={`px-3 py-2 border-b border-slate-50 cursor-pointer hover:bg-blue-50 transition ${selectedAnnotation === i ? 'bg-blue-50' : ''}`}>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: ann.strokeColor }} />
                    <span className="text-xs font-medium text-slate-700 capitalize">{ann.type === 'freehand' ? 'Rysunek' : ann.type === 'rectangle' ? 'Prostokąt' : ann.type === 'ellipse' ? 'Elipsa' : ann.type === 'arrow' ? 'Strzałka' : ann.type === 'line' ? 'Linia' : ann.type === 'text' ? 'Tekst' : ann.type === 'cloud' ? 'Chmura rewizyjna' : ann.type === 'callout' ? 'Odnośnik' : ann.type}</span>
                    {ann.textContent && <span className="text-[10px] text-slate-400 truncate">"{ann.textContent}"</span>}
                  </div>
                </div>
              ))}
              {/* Measurements */}
              {(navigatorFilter === 'all' || navigatorFilter === 'measurements') && annotations.filter(a => a.type === 'measurement').map((ann, i) => {
                const origIdx = annotations.indexOf(ann);
                return (
                  <div key={`nm-${i}`} onClick={() => { setSelectedAnnotation(origIdx); if (ann.geometry.x1 != null) scrollToPoint(ann.geometry.x1, ann.geometry.y1); else if (ann.geometry.points?.[0]) scrollToPoint(ann.geometry.points[0][0], ann.geometry.points[0][1]); }}
                    className={`px-3 py-2 border-b border-slate-50 cursor-pointer hover:bg-blue-50 transition ${selectedAnnotation === origIdx ? 'bg-blue-50' : ''}`}>
                    <div className="flex items-center gap-2">
                      <Ruler className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                      <span className="text-xs font-medium text-slate-700">
                        {ann.measurementValue != null ? `${ann.measurementValue.toFixed(2)} ${ann.measurementUnit || 'm'}` : 'Pomiar'}
                      </span>
                      {ann.geometry.area && <span className="text-[10px] text-slate-400">S={ann.geometry.area.toFixed(2)} {ann.measurementUnit || 'm'}²</span>}
                    </div>
                  </div>
                );
              })}
              {/* Comments */}
              {(navigatorFilter === 'all' || navigatorFilter === 'comments') && comments.map(c => (
                <div key={`nc-${c.id}`} onClick={() => { setSelectedComment(c); scrollToPoint(c.position_x, c.position_y); }}
                  className={`px-3 py-2 border-b border-slate-50 cursor-pointer hover:bg-blue-50 transition ${selectedComment?.id === c.id ? 'bg-blue-50' : ''}`}>
                  <div className="flex items-center gap-2">
                    <MessageSquare className={`w-3.5 h-3.5 flex-shrink-0 ${c.is_resolved ? 'text-green-500' : 'text-blue-500'}`} />
                    <span className="text-xs text-slate-700 truncate flex-1">{c.content}</span>
                    <button onClick={e => { e.stopPropagation(); deleteCommentFromDb(c.id); }} className="p-0.5 hover:bg-red-50 rounded text-slate-300 hover:text-red-500"><X className="w-3 h-3" /></button>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-0.5 pl-5">{new Date(c.created_at).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</p>
                </div>
              ))}
              {/* Photos */}
              {(navigatorFilter === 'all' || navigatorFilter === 'photos') && pins.map(p => (
                <div key={`np-${p.id}`} onClick={() => { setSelectedPin(p); scrollToPoint(p.position_x, p.position_y); }}
                  className={`px-3 py-2 border-b border-slate-50 cursor-pointer hover:bg-blue-50 transition ${selectedPin?.id === p.id ? 'bg-blue-50' : ''}`}>
                  <div className="flex items-center gap-2">
                    <Camera className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                    <span className="text-xs text-slate-700 truncate flex-1">Zdjęcie</span>
                    <button onClick={e => { e.stopPropagation(); deletePinFromDb(p.id); }} className="p-0.5 hover:bg-red-50 rounded text-slate-300 hover:text-red-500"><X className="w-3 h-3" /></button>
                  </div>
                  {p.label && p.label.startsWith('http') && (
                    <img src={p.label} alt="" className="mt-1 w-full h-16 object-cover rounded-lg border border-slate-200" />
                  )}
                  <p className="text-[10px] text-slate-400 mt-0.5 pl-5">{new Date(p.created_at).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</p>
                </div>
              ))}
              {/* Empty state */}
              {annotations.length === 0 && comments.length === 0 && pins.length === 0 && (
                <div className="text-center py-10 px-4">
                  <LayoutList className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                  <p className="text-xs text-slate-400">Brak oznaczeń</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* DXF LAYER PANEL (RIGHT) */}
        {showDxfLayerPanel && dxfData && viewingPlan && (
          <div className="w-[300px] min-w-[260px] border-l border-slate-200 bg-white flex flex-col overflow-hidden flex-shrink-0">
            <div className="px-3 py-2.5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <span className="font-semibold text-slate-700 text-sm flex items-center gap-1.5"><Filter className="w-4 h-4" /> Warstwy DXF</span>
              <button onClick={() => setShowDxfLayerPanel(false)} className="p-1 hover:bg-slate-200 rounded text-slate-400"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-2">
              <button onClick={() => setDxfHiddenLayers(new Set())}
                className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-100 text-green-700 hover:bg-green-200 transition">
                Włącz wszystkie
              </button>
              <button onClick={() => setDxfHiddenLayers(new Set(dxfLayers.map(l => l.name)))}
                className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-100 text-red-600 hover:bg-red-200 transition">
                Wyłącz wszystkie
              </button>
              <span className="ml-auto text-[10px] text-slate-400">{dxfLayers.length} warstw</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {dxfLayers.map(layer => (
                <label key={layer.name}
                  className={`flex items-center gap-2 px-3 py-1.5 border-b border-slate-50 cursor-pointer hover:bg-slate-50 transition ${dxfHiddenLayers.has(layer.name) ? 'opacity-50' : ''}`}>
                  <input type="checkbox" checked={!dxfHiddenLayers.has(layer.name)}
                    onChange={() => {
                      setDxfHiddenLayers(prev => {
                        const next = new Set(prev);
                        if (next.has(layer.name)) next.delete(layer.name);
                        else next.add(layer.name);
                        return next;
                      });
                    }}
                    className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                  <div className="w-3 h-3 rounded-sm flex-shrink-0 border border-slate-200" style={{ backgroundColor: layer.color }} />
                  <span className="text-xs text-slate-700 truncate flex-1" title={layer.name}>{layer.name}</span>
                  <span className="text-[10px] text-slate-400 flex-shrink-0">{layer.entityCount}</span>
                </label>
              ))}
              {dxfLayers.length === 0 && (
                <div className="text-center py-10 px-4">
                  <Filter className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                  <p className="text-xs text-slate-400">Brak warstw</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Selected comment popup */}
        {selectedComment && viewingPlan && (
          <div className="fixed bottom-24 right-4 z-[70] w-72 bg-white rounded-xl shadow-2xl border border-slate-200" onClick={e => e.stopPropagation()}>
            <div className="p-3 flex items-start gap-2 border-b border-slate-100">
              <MessageSquare className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm text-slate-800">{selectedComment.content}</p>
                <p className="text-[10px] text-slate-400 mt-1">{new Date(selectedComment.created_at).toLocaleString('pl-PL')}</p>
              </div>
              <button onClick={() => setSelectedComment(null)} className="p-1 hover:bg-slate-100 rounded"><X className="w-3.5 h-3.5 text-slate-400" /></button>
            </div>
            <div className="p-2 flex gap-2">
              <button onClick={() => deleteCommentFromDb(selectedComment.id)}
                className="px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 rounded-lg">Usuń</button>
            </div>
          </div>
        )}

        {/* Selected photo popup */}
        {selectedPin && viewingPlan && selectedPin.label?.startsWith('http') && (
          <div className="fixed bottom-24 right-4 z-[70] w-80 bg-white rounded-xl shadow-2xl border border-slate-200" onClick={e => e.stopPropagation()}>
            <div className="p-3 flex items-center justify-between border-b border-slate-100">
              <span className="text-sm font-medium text-slate-700 flex items-center gap-1.5"><Camera className="w-4 h-4 text-green-500" /> Zdjęcie</span>
              <button onClick={() => setSelectedPin(null)} className="p-1 hover:bg-slate-100 rounded"><X className="w-3.5 h-3.5 text-slate-400" /></button>
            </div>
            <div className="p-3">
              <img src={selectedPin.label} alt="" className="w-full rounded-lg border border-slate-200" />
              <div className="mt-2 flex gap-2">
                <a href={selectedPin.label} target="_blank" rel="noopener noreferrer"
                  className="px-3 py-1.5 text-xs text-blue-600 hover:bg-blue-50 rounded-lg flex items-center gap-1"><ExternalLink className="w-3 h-3" /> Otwórz</a>
                <button onClick={() => deletePinFromDb(selectedPin.id)}
                  className="px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 rounded-lg">Usuń</button>
              </div>
            </div>
          </div>
        )}

        {/* Photo upload modal */}
        {photoModalPos && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" onClick={() => { setPhotoModalPos(null); setPhotoFile(null); }}>
            <div className="bg-white rounded-xl w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="p-4 flex items-center justify-between border-b border-slate-100">
                <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2"><Camera className="w-5 h-5 text-green-500" /> Dodaj zdjęcie</h2>
                <button onClick={() => { setPhotoModalPos(null); setPhotoFile(null); }} className="p-1 hover:bg-slate-100 rounded-lg"><X className="w-4 h-4 text-slate-500" /></button>
              </div>
              <div className="p-4">
                <div className={`border-2 border-dashed rounded-xl p-6 text-center transition ${photoFile ? 'border-green-400 bg-green-50/50' : 'border-slate-300 hover:border-green-400'}`}
                  onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setPhotoFile(f); }} onDragOver={e => e.preventDefault()}>
                  {photoFile ? (
                    <div className="flex items-center justify-center gap-3">
                      <Image className="w-8 h-8 text-green-500" />
                      <div className="text-left">
                        <p className="text-sm font-medium text-slate-800">{photoFile.name}</p>
                        <p className="text-xs text-slate-500">{formatFileSize(photoFile.size)}</p>
                      </div>
                      <button onClick={() => setPhotoFile(null)} className="p-1 hover:bg-slate-100 rounded"><X className="w-4 h-4 text-slate-400" /></button>
                    </div>
                  ) : (
                    <>
                      <Camera className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                      <p className="text-sm text-slate-400">Przeciągnij zdjęcie lub kliknij poniżej</p>
                    </>
                  )}
                </div>
                <button onClick={() => photoInputRef.current?.click()}
                  className="mt-3 w-full px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700">Wybierz plik</button>
              </div>
              <div className="px-4 pb-4 flex gap-2">
                <button onClick={async () => {
                  if (photoFile && photoModalPos) {
                    await savePinWithPhoto(photoModalPos.x, photoModalPos.y, photoFile);
                    setPhotoModalPos(null); setPhotoFile(null);
                  }
                }} disabled={!photoFile}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">Zapisz</button>
                <button onClick={() => { setPhotoModalPos(null); setPhotoFile(null); }}
                  className="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-700 hover:bg-slate-50">Anuluj</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* HIDDEN FILE INPUTS */}
      <input ref={fileInputRef} type="file" className="hidden" accept="image/*,.pdf,.dwg,.dxf"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleUploadToFolder(f); e.target.value = ''; }} />
      <input ref={updateFileInputRef} type="file" className="hidden" accept="image/*,.pdf,.dwg,.dxf"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleUpdatePlanFile(f); e.target.value = ''; }} />
      <input ref={createFileInputRef} type="file" className="hidden" accept="image/*,.pdf,.dwg,.dxf"
        onChange={e => { const f = e.target.files?.[0]; if (f) setCreateFile(f); e.target.value = ''; }} />
      <input ref={photoInputRef} type="file" className="hidden" accept="image/*"
        onChange={e => { const f = e.target.files?.[0]; if (f) setPhotoFile(f); e.target.value = ''; }} />

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
              <h2 className="text-lg font-bold text-blue-600">Importuj plik</h2>
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
                    <tr key={v.id} className="border-b border-slate-100 hover:bg-blue-50">
                      <td className="py-2.5 px-3 text-slate-700">{v.original_filename || 'plan'}</td>
                      <td className="py-2.5 px-3 text-slate-500">
                        {v.created_at ? new Date(v.created_at).toLocaleDateString('pl-PL') + ' ' + new Date(v.created_at).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) : '-'}
                      </td>
                      <td className="py-2.5 px-3">V{v.version} {v.is_current_version ? <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">aktualna</span> : ''}</td>
                      <td className="py-2.5 px-3 flex items-center gap-2">
                        <button onClick={() => { setSelectedVersionId(v.id); setShowCompareModal(false); setShowVersionModal(true); }}
                          className="flex items-center gap-1 px-2.5 py-1 bg-blue-50 text-blue-600 rounded-lg text-xs font-medium hover:bg-blue-100">
                          <Eye className="w-3 h-3" /> Pokaż
                        </button>
                        {v.file_url && (
                          <a href={v.file_url} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1 px-2.5 py-1 bg-slate-50 text-slate-600 rounded-lg text-xs font-medium hover:bg-slate-100">
                            <ExternalLink className="w-3 h-3" /> Otwórz
                          </a>
                        )}
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

      {/* Links / Związki Modal */}
      {showLinksModal && selectedProject && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" onClick={() => setShowLinksModal(false)}>
          <div className="bg-white rounded-xl w-full max-w-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="p-5 flex justify-between items-center border-b border-slate-100">
              <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2"><Link2 className="w-5 h-5 text-blue-500" /> Związki</h2>
              <button onClick={() => setShowLinksModal(false)} className="p-1.5 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5 text-slate-500" /></button>
            </div>
            <div className="p-5">
              <p className="text-sm text-slate-500 mb-4">Powiąż plany z innymi elementami systemu:</p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { type: 'Kosztorys', icon: '📊', desc: 'Kosztorysy budowlane' },
                  { type: 'Oferta', icon: '📋', desc: 'Oferty i wyceny' },
                  { type: 'Zapytanie ofertowe', icon: '📩', desc: 'Zapytania ofertowe' },
                  { type: 'Projekt', icon: '📁', desc: 'Projekty budowlane' },
                  { type: 'Harmonogram', icon: '📅', desc: 'Harmonogramy Gantta' },
                  { type: 'Klient', icon: '👤', desc: 'Klienci i kontrahenci' },
                  { type: 'Obiekt', icon: '🏗️', desc: 'Obiekty budowlane' },
                ].map(item => {
                  const linked = planLinks.filter(l => l.type === item.type);
                  return (
                    <div key={item.type} className="border border-slate-200 rounded-xl p-3 hover:border-blue-300 transition">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-lg">{item.icon}</span>
                        <div>
                          <p className="text-sm font-medium text-slate-800">{item.type}</p>
                          <p className="text-[10px] text-slate-400">{item.desc}</p>
                        </div>
                      </div>
                      {linked.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2">
                          {linked.map(l => (
                            <span key={l.id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full text-[10px]">
                              {l.name}
                              <button onClick={() => setPlanLinks(prev => prev.filter(p => p.id !== l.id))} className="hover:text-red-500"><X className="w-2.5 h-2.5" /></button>
                            </span>
                          ))}
                        </div>
                      )}
                      <button onClick={() => {
                        const name = prompt(`Wpisz nazwę ${item.type}:`);
                        if (name) setPlanLinks(prev => [...prev, { type: item.type, id: crypto.randomUUID(), name }]);
                      }}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium">+ Dodaj powiązanie</button>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="px-5 pb-5 flex justify-end">
              <button onClick={() => setShowLinksModal(false)} className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 text-sm">Zamknij</button>
            </div>
          </div>
        </div>
      )}

      {/* DXF Search Panel */}
      {showDxfSearch && dxfData && (
        <DxfSearchPanel
          dxf={dxfData}
          hiddenLayers={dxfHiddenLayers}
          onResultClick={(result: DxfSearchResult) => {
            if (dxfViewBox) {
              const screenPt = dxfToScreenCoords(result.position, planNatW, planNatH, dxfViewBox);
              // Scroll to entity position
              const viewer = viewerRef.current;
              if (viewer) {
                const scale = zoom / 100;
                viewer.scrollTo({
                  left: screenPt.x * scale - viewer.clientWidth / 2,
                  top: screenPt.y * scale - viewer.clientHeight / 2,
                  behavior: 'smooth',
                });
              }
              setDxfSelectedEntity(result.entity);
              setShowDxfProperties(true);
            }
          }}
          onClose={() => setShowDxfSearch(false)}
        />
      )}

      {/* DXF Properties Panel */}
      {showDxfProperties && dxfSelectedEntity && dxfData && (
        <DxfPropertiesPanel
          entity={dxfSelectedEntity}
          dxf={dxfData}
          onClose={() => { setShowDxfProperties(false); setDxfSelectedEntity(null); }}
        />
      )}

      {/* DXF Analysis Modal */}
      {showDxfAnalysis && dxfData && selectedPlan && currentUser?.company_id && (
        <DxfAnalysisModal
          dxf={dxfData}
          companyId={currentUser.company_id}
          drawingId={selectedPlan.id}
          onAnalysisComplete={(analysis: DxfAnalysis) => {
            setDxfAnalysis(analysis);
            // Auto-load default rules if none loaded
            if (dxfTakeoffRules.length === 0) {
              setDxfTakeoffRules(getDefaultElectricalRules());
            }
          }}
          onClose={() => setShowDxfAnalysis(false)}
        />
      )}

      {/* DXF Takeoff Panel */}
      {showDxfTakeoff && dxfTakeoffResult && (
        <DxfTakeoffPanel
          result={dxfTakeoffResult}
          analysis={dxfAnalysis || undefined}
          onItemClick={(item) => {
            // Highlight source entities on the drawing
            if (dxfData && dxfViewBox) {
              const screenPts = item.sourceEntityIndices.map(idx => {
                const entity = (dxfData.entities as any[])[idx];
                if (!entity) return null;
                const center = getEntityCenter(entity);
                return center ? dxfToScreenCoords(center, planNatW, planNatH, dxfViewBox) : null;
              }).filter((p): p is { x: number; y: number } => p !== null);
              setDxfCountMatches(screenPts);
              setDxfCountLabel(item.description);
            }
          }}
          onClose={() => { setShowDxfTakeoff(false); setDxfCountMatches([]); setDxfCountLabel(''); }}
          onOpenRules={() => setShowDxfRulesModal(true)}
        />
      )}

      {/* DXF Takeoff Rules Modal */}
      {showDxfRulesModal && currentUser?.company_id && (
        <DxfTakeoffRulesModal
          companyId={currentUser.company_id}
          rules={dxfTakeoffRules}
          onRulesChange={(rules) => {
            setDxfTakeoffRules(rules);
            // Re-apply rules if analysis exists
            if (dxfAnalysis) {
              const result = applyRules(dxfAnalysis, rules);
              setDxfTakeoffResult(result);
            }
          }}
          onClose={() => setShowDxfRulesModal(false)}
          onTestRules={dxfAnalysis ? () => {
            const result = applyRules(dxfAnalysis!, dxfTakeoffRules);
            setDxfTakeoffResult(result);
            setShowDxfTakeoff(true);
          } : undefined}
        />
      )}

      {/* DXF Block Mappings Modal */}
      {showDxfMappingsModal && currentUser?.company_id && (
        <DxfBlockMappingsModal
          companyId={currentUser.company_id}
          onClose={() => setShowDxfMappingsModal(false)}
        />
      )}

      {/* DXF Export Modal */}
      {showDxfExportModal && dxfData && (
        <DxfExportModal
          svgContent={renderDxfFull(dxfData, dxfHiddenLayers).svg}
          drawingName={selectedPlan?.name}
          onClose={() => setShowDxfExportModal(false)}
        />
      )}

      {/* PDF Analysis Modal */}
      {showPdfAnalysis && pdfDoc && selectedPlan && currentUser?.company_id && (
        <PdfAnalysisModal
          pdfDoc={pdfDoc}
          pageNumber={pdfPage}
          companyId={currentUser.company_id}
          drawingId={selectedPlan.id}
          scaleRatio={selectedPlan.scale_ratio || undefined}
          onAnalysisComplete={(analysis: DxfAnalysis, extra?: PdfAnalysisExtra) => {
            setPdfAnalysis(analysis);
            if (extra) {
              setPdfAnalysisExtra(extra);
              setPdfStyleGroups(extra.styleGroups);
              if (extra.legend) setPdfLegend(extra.legend);
            }
            // Auto-apply rules and show takeoff
            const rules = pdfTakeoffRules.length > 0 ? pdfTakeoffRules : getDefaultPdfElectricalRules();
            if (pdfTakeoffRules.length === 0) {
              setPdfTakeoffRules(rules);
            }
            const takeoffResult = applyRules(analysis, rules);
            setPdfTakeoffResult(takeoffResult);
            setShowPdfTakeoff(true);
          }}
          onClose={() => setShowPdfAnalysis(false)}
        />
      )}

      {/* PDF Takeoff Panel (reuses DxfTakeoffPanel) */}
      {showPdfTakeoff && pdfTakeoffResult && (
        <DxfTakeoffPanel
          result={pdfTakeoffResult}
          analysis={pdfAnalysis || undefined}
          sourceType="PDF"
          onItemClick={(item) => {
            if (!pdfAnalysis) return;
            const paths: typeof pdfHighlightPaths = [];
            const points: typeof pdfHighlightPoints = [];
            for (const idx of item.sourceEntityIndices) {
              const entity = pdfAnalysis.entities[idx];
              if (!entity) continue;
              if (entity.entityType === 'PDF_PATH' && entity.geometry.points?.length) {
                const pathIdx = entity.properties?.pathIndex;
                const srcPath = pathIdx != null && pdfAnalysisExtra ? pdfAnalysisExtra.extraction.paths[pathIdx] : null;
                if (srcPath) {
                  paths.push({ segments: srcPath.segments, color: srcPath.style.strokeColor });
                } else {
                  paths.push({ segments: [{ type: 'M', points: [entity.geometry.points[0]] }, ...entity.geometry.points.slice(1).map(p => ({ type: 'L' as const, points: [p] }))], color: entity.properties?.styleColor || '#f97316' });
                }
              } else if (entity.entityType === 'PDF_SYMBOL' && entity.geometry.center) {
                points.push({ x: entity.geometry.center.x, y: entity.geometry.center.y, label: entity.properties?.symbolShape || '' });
              } else if (entity.entityType === 'PDF_TEXT' && entity.geometry.points?.[0]) {
                points.push({ x: entity.geometry.points[0].x, y: entity.geometry.points[0].y, label: 'T' });
              }
            }
            setPdfHighlightPaths(paths);
            setPdfHighlightPoints(points);
            setPdfHighlightLabel(item.description);
          }}
          onClose={() => { setShowPdfTakeoff(false); setPdfHighlightPaths([]); setPdfHighlightPoints([]); setPdfHighlightLabel(''); }}
          onOpenRules={() => setShowPdfRulesModal(true)}
        />
      )}

      {/* PDF Takeoff Rules Modal (reuses DxfTakeoffRulesModal) */}
      {showPdfRulesModal && currentUser?.company_id && (
        <DxfTakeoffRulesModal
          companyId={currentUser.company_id}
          rules={pdfTakeoffRules}
          sourceType="PDF"
          onRulesChange={(rules) => {
            setPdfTakeoffRules(rules);
            if (pdfAnalysis) {
              const result = applyRules(pdfAnalysis, rules);
              setPdfTakeoffResult(result);
            }
          }}
          onClose={() => setShowPdfRulesModal(false)}
          onTestRules={pdfAnalysis ? () => {
            const result = applyRules(pdfAnalysis!, pdfTakeoffRules);
            setPdfTakeoffResult(result);
            setShowPdfTakeoff(true);
          } : undefined}
        />
      )}

      {/* PDF Style Groups Panel */}
      {showPdfStyleGroups && pdfStyleGroups.length > 0 && (
        <PdfStyleGroupsPanel
          styleGroups={pdfStyleGroups}
          onToggleVisibility={(groupId) => {
            setPdfStyleGroups(prev => prev.map(sg =>
              sg.id === groupId ? { ...sg, visible: !sg.visible } : sg
            ));
          }}
          onSetCategory={(groupId, category) => {
            setPdfStyleGroups(prev => prev.map(sg =>
              sg.id === groupId ? { ...sg, category } : sg
            ));
          }}
          onHighlightGroup={(groupId) => {
            const sg = pdfStyleGroups.find(g => g.id === groupId);
            if (!sg) return;
            const paths: typeof pdfHighlightPaths = [];
            if (pdfAnalysisExtra) {
              // Use extraction.paths (fresh analysis)
              const indices = sg.pathIndices.slice(0, 200);
              for (const pi of indices) {
                const p = pdfAnalysisExtra.extraction.paths[pi];
                if (p) paths.push({ segments: p.segments, color: sg.strokeColor });
              }
            } else if (pdfAnalysis) {
              // Fallback: reconstruct from entity geometry (loaded from DB)
              const entities = pdfAnalysis.entities.filter(e => e.layerName === sg.name && e.geometry.points?.length);
              for (const entity of entities.slice(0, 200)) {
                const pts = entity.geometry.points!;
                paths.push({
                  segments: [{ type: 'M', points: [pts[0]] }, ...pts.slice(1).map(p => ({ type: 'L' as const, points: [p] }))],
                  color: sg.strokeColor,
                });
              }
            }
            setPdfHighlightPaths(paths);
            setPdfHighlightPoints([]);
            setPdfHighlightLabel(`${sg.name} (${sg.pathCount} ścieżek)`);
          }}
          onClose={() => setShowPdfStyleGroups(false)}
        />
      )}

      {/* PDF Legend Panel */}
      {showPdfLegend && (pdfLegend || pdfAnalysisExtra?.legend) && (
        <PdfLegendPanel
          legend={(pdfLegend || pdfAnalysisExtra?.legend)!}
          styleGroups={pdfStyleGroups}
          onApplyToGroups={(mappings) => {
            const activeLegend = pdfLegend || pdfAnalysisExtra?.legend;
            setPdfStyleGroups(prev => {
              const updated = [...prev];
              for (const m of mappings) {
                // Find the legend entry to get its styleKey / sampleColor
                const legendEntry = activeLegend?.entries.find(e => e.label === m.entryLabel);

                for (const sg of updated) {
                  // Priority 1: match by styleKey (set during legend extraction)
                  if (legendEntry?.styleKey && sg.styleKey === legendEntry.styleKey) {
                    sg.category = m.category;
                    continue;
                  }
                  // Priority 2: match by sample color + line width
                  if (legendEntry?.sampleColor &&
                      sg.strokeColor === legendEntry.sampleColor &&
                      Math.abs(sg.lineWidth - (legendEntry.sampleLineWidth || 0)) < 0.5) {
                    sg.category = m.category;
                    continue;
                  }
                  // Priority 3: match by color name in entry label
                  const colorName = sg.strokeColor.toLowerCase();
                  const groupColorWord = sg.name.match(/\(([^,]+)/)?.[1]?.trim().toLowerCase();
                  if (groupColorWord && m.entryLabel.toLowerCase().includes(groupColorWord)) {
                    sg.category = m.category;
                  }
                }
              }
              return updated;
            });
          }}
          onClose={() => setShowPdfLegend(false)}
        />
      )}

      {/* PDF Mapping Dictionary Panel */}
      {showPdfMappingDict && currentUser?.company_id && (
        <PdfMappingDictionaryPanel
          companyId={currentUser.company_id}
          onClose={() => setShowPdfMappingDict(false)}
          onMappingsChanged={(mappings) => {
            // Auto-generate rules from company mappings
            const newRules = mappingsToRules(mappings);
            setPdfTakeoffRules(prev => {
              // Keep non-mapping rules, replace mapping-generated ones
              const kept = prev.filter(r => !r.id.startsWith('mapping_'));
              return [...kept, ...newRules];
            });
          }}
        />
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
