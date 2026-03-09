// ============================================================
// Workspace Types — single-window CAD/BIM/BOQ/AI workspace
// ============================================================

export type FileFormat = 'dwg' | 'dxf' | 'pdf' | 'ifc' | 'rvt' | 'image' | 'zip' | 'other';

export type FileStatus =
  | 'uploaded'
  | 'converting'
  | 'converted'
  | 'analysis_ready'
  | 'ai_ready'
  | 'boq_ready'
  | 'failed';

export type ViewerMode =
  | 'viewer'
  | 'objects'
  | 'boq-overlay'
  | 'ai-overlay'
  | 'compare'
  | 'manual-takeoff';

export type RightTab =
  | 'overview'
  | 'objects'
  | 'properties'
  | 'ai'
  | 'boq'
  | 'compare'
  | 'annotations'
  | 'measurements'
  | 'comments'
  | 'photos'
  | 'errors';

export type BottomTool =
  | 'select'
  | 'pan'
  | 'measure-length'
  | 'measure-area'
  | 'measure-polyline'
  | 'count-marker'
  | 'text-annotation'
  | 'pen'
  | 'highlighter'
  | 'rectangle'
  | 'ellipse'
  | 'arrow'
  | 'line'
  | 'issue-cloud'
  | 'callout'
  | 'link-boq'
  | 'ai-classify-selection'
  | 'erase'
  | 'snapshot'
  | 'comment'
  | 'camera';

export type AsyncStatus = 'idle' | 'loading' | 'success' | 'error';

export type QuantityBasis = 'count' | 'length' | 'area' | 'volume';

export type SourceType =
  | 'aps-properties'
  | 'geometry'
  | 'manual-measurement'
  | 'ai-detection'
  | 'mixed';

export type BoqRowStatus =
  | 'auto-generated'
  | 'needs-review'
  | 'approved'
  | 'manually-edited'
  | 'rejected'
  | 'delta-added'
  | 'delta-removed'
  | 'delta-changed';

export type AiObjectStatus = 'recognized' | 'needs_review' | 'unknown';

export type RuleConditionField =
  | 'category'
  | 'family'
  | 'type'
  | 'layer'
  | 'blockName'
  | 'name'
  | 'system'
  | 'classification'
  | 'property'
  | 'level'
  | 'zone'
  | 'geometryType'
  | 'aiClass';

export type RuleConditionOperator =
  | 'equals'
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | 'regex'
  | 'exists'
  | 'greaterThan'
  | 'lessThan';

export type AggregationMode =
  | 'count'
  | 'sum-length'
  | 'sum-area'
  | 'sum-volume'
  | 'custom';

// ---- Data models ----

export interface ProjectFile {
  id: string;
  name: string;
  format: FileFormat;
  version: number;
  status: FileStatus;
  parentId?: string | null;
  urn?: string | null;
  folderId?: string;
  fileUrl: string;
  originalFilename?: string;
  mimeType?: string;
  fileSize?: number;
  createdAt: string;
  updatedAt: string;
  scaleRatio?: number;
  // Computed flags
  hasAnalysis?: boolean;
  hasAi?: boolean;
  hasBoq?: boolean;
  hasCompare?: boolean;
}

export interface DrawingObject {
  id: string;
  dbId?: number;
  externalId?: string;
  fileId: string;
  name: string;
  category?: string;
  family?: string;
  type?: string;
  level?: string;
  zone?: string;
  layer?: string;
  system?: string;
  geometryType?: string;
  length?: number;
  area?: number;
  volume?: number;
  quantityBasis?: QuantityBasis;
  aiStatus?: AiObjectStatus;
  aiConfidence?: number;
  aiSuggestedClass?: string;
  aiSuggestedBoqName?: string;
  boqRowId?: string | null;
  rawProperties?: Record<string, any>;
}

export interface BoqRow {
  id: string;
  code?: string;
  name: string;
  unit: string;
  quantity: number;
  sourceType: SourceType;
  sourceObjectIds: string[];
  confidence?: number;
  status: BoqRowStatus;
  category?: string;
  level?: string;
  zone?: string;
}

export interface AiSuggestion {
  id: string;
  objectId: string;
  suggestedClass: string;
  suggestedBoqItem?: string;
  confidence: number;
  reasoning?: string;
  status: 'pending' | 'accepted' | 'rejected';
}

export interface MeasurementItem {
  id: string;
  type: 'length' | 'area' | 'count' | 'polyline';
  value: number;
  unit: string;
  label?: string;
  linkedBoqRowId?: string | null;
  points?: { x: number; y: number }[];
  createdBy: string;
  createdAt: string;
}

export interface AnnotationItem {
  id: string;
  type: 'text' | 'arrow' | 'issue-cloud' | 'problem' | 'approved' | 'boq-marker' | 'freehand' | 'rectangle' | 'ellipse' | 'line' | 'callout';
  geometry: any;
  text?: string;
  strokeColor: string;
  strokeWidth: number;
  linkedBoqRowId?: string | null;
  linkedObjectId?: string | null;
  createdBy: string;
  createdAt: string;
}

export interface CommentThread {
  id: string;
  fileId: string;
  objectId?: string;
  boqRowId?: string;
  annotationId?: string;
  positionX?: number;
  positionY?: number;
  authorId: string;
  authorName: string;
  content: string;
  isResolved: boolean;
  replies: CommentReply[];
  createdAt: string;
}

export interface CommentReply {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: string;
}

export interface MappingRule {
  id: string;
  name: string;
  active: boolean;
  priority: number;
  scope?: string;
  conditions: RuleCondition[];
  targetBoqName: string;
  targetCategory?: string;
  targetUnit?: string;
  aggregationMode: AggregationMode;
}

export interface RuleCondition {
  field: RuleConditionField;
  operator: RuleConditionOperator;
  value: string;
  propertyPath?: string; // for 'property' field type
}

export interface VersionCompareResult {
  addedObjects: DrawingObject[];
  removedObjects: DrawingObject[];
  changedObjects: { before: DrawingObject; after: DrawingObject }[];
  deltaBoqRows: BoqRow[];
}

export interface WorkspaceError {
  id: string;
  type: 'conversion' | 'analysis' | 'missing_property' | 'conflicting_rule' | 'duplicate_mapping' | 'ai_failure';
  message: string;
  details?: string;
  severity: 'error' | 'warning' | 'info';
  retryable: boolean;
  timestamp: string;
}

// ---- Filters ----

export interface WorkspaceFilters {
  levels: string[];
  zones: string[];
  layers: string[];
  categories: string[];
  familyTypes: string[];
  onlyAiRecognized: boolean;
  onlyUnresolved: boolean;
  onlyBoqLinked: boolean;
  onlyChangedInCompare: boolean;
  confidenceThreshold: number;
  searchQuery: string;
}

export const DEFAULT_FILTERS: WorkspaceFilters = {
  levels: [],
  zones: [],
  layers: [],
  categories: [],
  familyTypes: [],
  onlyAiRecognized: false,
  onlyUnresolved: false,
  onlyBoqLinked: false,
  onlyChangedInCompare: false,
  confidenceThreshold: 0,
  searchQuery: '',
};

// ---- Workspace State ----

export interface WorkspaceState {
  activeFileId: string | null;
  activeVersionId: string | null;
  viewerMode: ViewerMode;
  rightTab: RightTab;
  selectedObjectIds: string[];
  selectedBoqRowId: string | null;
  hoveredObjectId: string | null;
  filters: WorkspaceFilters;
  activeTool: BottomTool;
  conversionStatus: AsyncStatus;
  analysisStatus: AsyncStatus;
  aiStatus: AsyncStatus;
  boqStatus: AsyncStatus;
  compareStatus: AsyncStatus;
  conversionProgress: number;
  analysisProgress: number;
  aiProgress: number;
  isFullscreen: boolean;
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  ruleEditorOpen: boolean;
  editingRuleId: string | null;
  compareModalOpen: boolean;
  compareVersionA: string | null;
  compareVersionB: string | null;
}

export const INITIAL_WORKSPACE_STATE: WorkspaceState = {
  activeFileId: null,
  activeVersionId: null,
  viewerMode: 'viewer',
  rightTab: 'overview',
  selectedObjectIds: [],
  selectedBoqRowId: null,
  hoveredObjectId: null,
  filters: DEFAULT_FILTERS,
  activeTool: 'select',
  conversionStatus: 'idle',
  analysisStatus: 'idle',
  aiStatus: 'idle',
  boqStatus: 'idle',
  compareStatus: 'idle',
  conversionProgress: 0,
  analysisProgress: 0,
  aiProgress: 0,
  isFullscreen: false,
  leftPanelOpen: true,
  rightPanelOpen: false,
  ruleEditorOpen: false,
  editingRuleId: null,
  compareModalOpen: false,
  compareVersionA: null,
  compareVersionB: null,
};

// ---- Workspace action types ----

export type WorkspaceAction =
  | { type: 'SET_ACTIVE_FILE'; fileId: string | null }
  | { type: 'SET_VIEWER_MODE'; mode: ViewerMode }
  | { type: 'SET_RIGHT_TAB'; tab: RightTab }
  | { type: 'SET_SELECTED_OBJECTS'; ids: string[] }
  | { type: 'ADD_SELECTED_OBJECT'; id: string }
  | { type: 'REMOVE_SELECTED_OBJECT'; id: string }
  | { type: 'SET_SELECTED_BOQ_ROW'; id: string | null }
  | { type: 'SET_HOVERED_OBJECT'; id: string | null }
  | { type: 'SET_FILTERS'; filters: Partial<WorkspaceFilters> }
  | { type: 'SET_ACTIVE_TOOL'; tool: BottomTool }
  | { type: 'SET_STATUS'; key: 'conversionStatus' | 'analysisStatus' | 'aiStatus' | 'boqStatus' | 'compareStatus'; status: AsyncStatus }
  | { type: 'SET_PROGRESS'; key: 'conversionProgress' | 'analysisProgress' | 'aiProgress'; value: number }
  | { type: 'TOGGLE_FULLSCREEN' }
  | { type: 'TOGGLE_LEFT_PANEL' }
  | { type: 'TOGGLE_RIGHT_PANEL' }
  | { type: 'OPEN_RULE_EDITOR'; ruleId?: string }
  | { type: 'CLOSE_RULE_EDITOR' }
  | { type: 'OPEN_COMPARE'; versionA?: string; versionB?: string }
  | { type: 'CLOSE_COMPARE' }
  | { type: 'SELECT_OBJECT_AND_SHOW_PROPS'; id: string }
  | { type: 'SELECT_BOQ_ROW_AND_HIGHLIGHT'; rowId: string; sourceObjectIds: string[] }
  | { type: 'RESET_WORKSPACE' };

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case 'SET_ACTIVE_FILE':
      return {
        ...INITIAL_WORKSPACE_STATE,
        leftPanelOpen: state.leftPanelOpen,
        activeFileId: action.fileId,
      };
    case 'SET_VIEWER_MODE':
      return { ...state, viewerMode: action.mode };
    case 'SET_RIGHT_TAB':
      return { ...state, rightTab: action.tab, rightPanelOpen: true };
    case 'SET_SELECTED_OBJECTS':
      return { ...state, selectedObjectIds: action.ids };
    case 'ADD_SELECTED_OBJECT':
      return { ...state, selectedObjectIds: [...state.selectedObjectIds, action.id] };
    case 'REMOVE_SELECTED_OBJECT':
      return { ...state, selectedObjectIds: state.selectedObjectIds.filter(id => id !== action.id) };
    case 'SET_SELECTED_BOQ_ROW':
      return { ...state, selectedBoqRowId: action.id };
    case 'SET_HOVERED_OBJECT':
      return { ...state, hoveredObjectId: action.id };
    case 'SET_FILTERS':
      return { ...state, filters: { ...state.filters, ...action.filters } };
    case 'SET_ACTIVE_TOOL':
      return { ...state, activeTool: action.tool };
    case 'SET_STATUS':
      return { ...state, [action.key]: action.status };
    case 'SET_PROGRESS':
      return { ...state, [action.key]: action.value };
    case 'TOGGLE_FULLSCREEN':
      return { ...state, isFullscreen: !state.isFullscreen };
    case 'TOGGLE_LEFT_PANEL':
      return { ...state, leftPanelOpen: !state.leftPanelOpen };
    case 'TOGGLE_RIGHT_PANEL':
      return { ...state, rightPanelOpen: !state.rightPanelOpen };
    case 'OPEN_RULE_EDITOR':
      return { ...state, ruleEditorOpen: true, editingRuleId: action.ruleId || null };
    case 'CLOSE_RULE_EDITOR':
      return { ...state, ruleEditorOpen: false, editingRuleId: null };
    case 'OPEN_COMPARE':
      return { ...state, compareModalOpen: true, compareVersionA: action.versionA || null, compareVersionB: action.versionB || null };
    case 'CLOSE_COMPARE':
      return { ...state, compareModalOpen: false };
    case 'SELECT_OBJECT_AND_SHOW_PROPS':
      return { ...state, selectedObjectIds: [action.id], rightTab: 'properties', rightPanelOpen: true };
    case 'SELECT_BOQ_ROW_AND_HIGHLIGHT':
      return { ...state, selectedBoqRowId: action.rowId, selectedObjectIds: action.sourceObjectIds, rightTab: 'boq', rightPanelOpen: true };
    case 'RESET_WORKSPACE':
      return { ...INITIAL_WORKSPACE_STATE, leftPanelOpen: state.leftPanelOpen };
    default:
      return state;
  }
}
