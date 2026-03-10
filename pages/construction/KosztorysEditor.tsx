/**
 * KosztorysEditor - Full-featured cost estimate editor
 * Based on eKosztorysowanie.pl interface and functionality
 */

import React, { useState, useEffect, useMemo, useCallback, startTransition } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Menu, Printer, Plus, FolderPlus, FileText, Hash, Layers,
  ChevronDown, ChevronRight, ChevronUp, Trash2, Copy, ClipboardPaste,
  Scissors, MoveUp, MoveDown, Settings, Eye, CheckCircle2, Check,
  AlertCircle, Save, Download, Upload, RefreshCw, X, Home,
  Calculator, Users, Package, Wrench, Percent, DollarSign,
  MessageSquare, Search, Filter, MoreHorizontal, Loader2, Monitor,
  ArrowLeft, FileSpreadsheet, Clock, List, LayoutList, Expand,
  GripVertical, FileBarChart, FilePieChart, Table2, BookOpen, Grid3X3,
  HelpCircle, Camera, Flag, Clipboard, User, Puzzle, ChevronLeft, ArrowUpRight, Sparkles, SquarePen,
  CalendarClock, ReceiptText, SearchCheck, ExternalLink, FolderOpen
} from 'lucide-react';
import { useAppContext } from '../../context/AppContext';
import { supabase } from '../../lib/supabase';
import {
  calculateCostEstimate,
  calculatePosition,
  formatNumber,
  formatCurrency,
  createNewSection,
  createNewPosition,
  createNewResource,
  createEmptyMeasurements,
  addMeasurementEntry,
  updateMeasurementEntry,
  removeMeasurementEntry,
  createDefaultFactors,
  createDefaultIndirectCostsOverhead,
  createDefaultProfitOverhead,
  createDefaultPurchaseCostsOverhead,
  evaluateMeasurementExpression,
} from '../../lib/kosztorysCalculator';
import {
  parseAthFile,
  parseJsonFile,
  parseXmlFile,
  parseXlsxFile,
  previewXlsxFile,
  parseXlsxWithMapping,
  parseXlsxWithAiStructure,
  convertGeminiResponseToEstimate,
} from '../../lib/kosztorysImportParsers';
import type { XlsxPreview, XlsxColumnMapping, XlsxAiAnalysis, XlsxAiStructureEntry } from '../../lib/kosztorysImportParsers';
import type {
  KosztorysCostEstimate,
  KosztorysCostEstimateData,
  KosztorysSection,
  KosztorysPosition,
  KosztorysResource,
  KosztorysOverhead,
  KosztorysFactors,
  KosztorysMeasurements,
  KosztorysUnit,
  KosztorysEditorState,
  KosztorysPositionCalculationResult,
  KosztorysCostEstimateCalculationResult,
  KosztorysResourceType,
  KosztorysCalculationTemplate,
  KosztorysType,
  WholesalerIntegration,
  KosztorysMaterial,
  KosztorysEquipment,
  KosztorysSystemLabour,
  KosztorysOwnLabour,
  KosztorysSystemLabourCategory,
} from '../../types';
import { OninenIntegrator } from './OninenIntegrator';
import { TIMIntegrator } from './TIMIntegrator';
import { AtutIntegrator } from './AtutIntegrator';
import { RamirentIntegrator } from './RamirentIntegrator';

// View mode types - extended with all views from eKosztorysowanie
type ViewMode = 'przedmiar' | 'kosztorys' | 'naklady' | 'narzuty' | 'zestawienia' | 'pozycje';
type LeftPanelMode = 'overview' | 'properties' | 'export' | 'catalog' | 'comments' | 'titlePageEditor' | 'settings';
type ZestawieniaTab = 'robocizna' | 'materialy' | 'sprzet';
type CustomPriceListTab = 'robocizna' | 'materialy' | 'sprzet';

interface CustomPriceListItem {
  id: string;
  rms_index: string;
  autoIndex: boolean;
  name: string;
  category: string;
  unit: string;
  price: number;
  comment: string;
  isActive: boolean;
}

interface CustomPriceListState {
  name: string;
  items: {
    robocizna: CustomPriceListItem[];
    materialy: CustomPriceListItem[];
    sprzet: CustomPriceListItem[];
  };
}

const createEmptyPriceListItem = (): CustomPriceListItem => ({
  id: crypto.randomUUID(),
  rms_index: '',
  autoIndex: true,
  name: '',
  category: '',
  unit: '',
  price: 0,
  comment: '',
  isActive: false,
});

const generateAutoIndex = (_tab: CustomPriceListTab, sequenceNumber: number): string => {
  return String(sequenceNumber).padStart(5, '0');
};

const initialCustomPriceList: CustomPriceListState = {
  name: 'Nowy cennik',
  items: {
    robocizna: [createEmptyPriceListItem()],
    materialy: [createEmptyPriceListItem()],
    sprzet: [createEmptyPriceListItem()],
  },
};

// Title page editor data structure
interface TitlePageData {
  title: string;
  hideManHourRate: boolean;
  hideOverheads: boolean;
  hideWorkValue: boolean;
  companyName: string;
  companyAddress: string;
  orderName: string;
  orderAddress: string;
  clientName: string;
  clientAddress: string;
  contractorName: string;
  contractorAddress: string;
  contractorNIP: string;  // NIP wykonawcy
  industry: string;
  preparedBy: string;
  preparedByIndustry: string;
  checkedBy: string;
  checkedByIndustry: string;
  preparedDate: string;
  approvedDate: string;
  // Stawki section
  stawkaRobocizny: string;
  kosztyPosrednie: string;
  zysk: string;
  kosztyZakupu: string;
}

// Export page types for print configuration
interface ExportPage {
  id: string;
  type: 'strona_tytulowa' | 'tabela_elementow' | 'przedmiar' | 'kosztorys_ofertowy' |
        'kalkulacja_szczegolowa' | 'kosztorys_szczegolowy' | 'zestawienie_robocizny' |
        'zestawienie_materialow' | 'zestawienie_sprzetu';
  label: string;
  enabled: boolean;
  canEdit?: boolean;
}

// All available export pages
const ALL_EXPORT_PAGES: ExportPage[] = [
  { id: 'p1', type: 'strona_tytulowa', label: 'Strona tytułowa', enabled: true, canEdit: true },
  { id: 'p2', type: 'tabela_elementow', label: 'Tabela elementów scalonych', enabled: true },
  { id: 'p3', type: 'przedmiar', label: 'Przedmiar', enabled: true },
  { id: 'p4', type: 'kosztorys_ofertowy', label: 'Kosztorys ofertowy', enabled: true },
  { id: 'p5', type: 'kalkulacja_szczegolowa', label: 'Szczegółowa kalkulacja cen jednostkowych', enabled: true },
  { id: 'p6', type: 'kosztorys_szczegolowy', label: 'Szczegółowy kosztorys inwestorski', enabled: true },
  { id: 'p7', type: 'zestawienie_robocizny', label: 'Zestawienie robocizny', enabled: true },
  { id: 'p8', type: 'zestawienie_materialow', label: 'Zestawienie materiałów', enabled: true },
  { id: 'p9', type: 'zestawienie_sprzetu', label: 'Zestawienie sprzętu', enabled: true },
];

// Template page configurations
const TEMPLATE_PAGES: Record<string, string[]> = {
  'niestandardowy': [], // Empty - user adds pages manually
  'kosztorys_ofertowy': ['p1', 'p4', 'p5'], // Strona tytułowa, Kosztorys ofertowy, Szczegółowa kalkulacja
  'przedmiar_robot': ['p1', 'p3'], // Strona tytułowa, Przedmiar
};

// Default export pages configuration (empty for niestandardowy)
const DEFAULT_EXPORT_PAGES: ExportPage[] = [];

// Left navigation items - matching eKosztorysowanie exactly
// P = Przedmiar, icons match the portal
const LEFT_NAV_ITEMS = [
  { id: 'przedmiar', label: 'Przedmiar', shortLabel: 'P', icon: List, viewMode: 'przedmiar' as ViewMode },
  { id: 'kosztorysy', label: 'Kosztorys', shortLabel: 'C', icon: FileBarChart, viewMode: 'kosztorys' as ViewMode },
  { id: 'pozycje', label: 'Pozycje', shortLabel: null, icon: LayoutList, viewMode: 'pozycje' as ViewMode },
  { id: 'naklady', label: 'Nakłady', shortLabel: null, icon: Layers, viewMode: 'naklady' as ViewMode },
  { id: 'narzuty', label: 'Narzuty', shortLabel: null, icon: Percent, viewMode: 'narzuty' as ViewMode },
  { id: 'zestawienia', label: 'Zestawienia', shortLabel: null, icon: Table2, viewMode: 'zestawienia' as ViewMode },
  { id: 'wydruki', label: 'Wydruki', shortLabel: null, icon: Printer, viewMode: null, panelMode: 'export' as LeftPanelMode },
];

// Active toolbar mode - determines which buttons are shown
type ToolbarMode = 'przedmiar' | 'kosztorys' | 'naklady' | 'wydruki';

// Position tag/marker options
const POSITION_TAGS = [
  { id: 'analiza', label: 'Analiza indywidualna' },
  { id: 'analogia', label: 'Analogia' },
  { id: 'cena_zakladowa', label: 'Cena zakładowa' },
  { id: 'kalk_szczegolowa', label: 'Kalk. szczegółowa' },
  { id: 'kalk_warsztatowa', label: 'Kalk. warsztatowa' },
  { id: 'kalk_wlasna', label: 'Kalk. własna' },
];

// KNR Catalog structure
interface CatalogNorm {
  type: KosztorysResourceType;
  value: number;
  unit: string;
  name?: string;        // Resource name from database
  index?: string;       // RMS index for price lookup
  rmsCode?: number;     // RMS code
}

interface CatalogItem {
  id: string;
  code: string;
  name: string;
  type: 'catalog' | 'chapter' | 'table' | 'position';
  children?: CatalogItem[];
  unit?: string;
  norms?: CatalogNorm[];
}

// Sample KNR catalog data (based on eKosztorysowanie screenshots)
const KNR_CATALOG: CatalogItem[] = [
  {
    id: 'knnr5',
    code: 'KNNR 5',
    name: 'Instalacje elektryczne i sieci zewnętrzne',
    type: 'catalog',
    children: [
      {
        id: 'knnr5-07',
        code: '(Rozdział 07)',
        name: 'Elektroenergetyczne linie kablowe',
        type: 'chapter',
        children: [
          {
            id: 'knnr5-0701',
            code: 'KNNR 5 0701',
            name: 'Kopanie rowów dla kabli',
            type: 'table',
            children: [
              {
                id: 'knnr5-0701-01',
                code: 'KNNR 5 0701-01',
                name: 'Kopanie rowów dla kabli w sposób ręczny w gruncie kat. I-II',
                type: 'position',
                unit: 'm3',
                norms: [{ type: 'labor', value: 1.35, unit: 'r-g' }],
              },
              {
                id: 'knnr5-0701-02',
                code: 'KNNR 5 0701-02',
                name: 'Kopanie rowów dla kabli w sposób ręczny w gruncie kat. III',
                type: 'position',
                unit: 'm3',
                norms: [{ type: 'labor', value: 1.65, unit: 'r-g' }],
              },
              {
                id: 'knnr5-0701-03',
                code: 'KNNR 5 0701-03',
                name: 'Kopanie rowów dla kabli w sposób ręczny w gruncie kat. IV',
                type: 'position',
                unit: 'm3',
                norms: [{ type: 'labor', value: 2.10, unit: 'r-g' }],
              },
              {
                id: 'knnr5-0701-04',
                code: 'KNNR 5 0701-04',
                name: 'Kopanie rowów dla kabli w sposób mechaniczny w gruncie kat. I-II',
                type: 'position',
                unit: 'm3',
                norms: [{ type: 'equipment', value: 0.15, unit: 'm-g' }],
              },
            ],
          },
          {
            id: 'knnr5-0702',
            code: 'KNNR 5 0702',
            name: 'Zasypywanie rowów dla kabli',
            type: 'table',
            children: [
              {
                id: 'knnr5-0702-01',
                code: 'KNNR 5 0702-01',
                name: 'Zasypywanie rowów dla kabli wykonanych ręcznie w gruncie kat. I-II',
                type: 'position',
                unit: 'm3',
                norms: [{ type: 'labor', value: 0.89, unit: 'r-g' }],
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'knr2-02',
    code: 'KNR 2-02',
    name: 'Konstrukcje budowlane',
    type: 'catalog',
    children: [
      {
        id: 'knr2-02-01',
        code: '(Rozdział 01)',
        name: 'Roboty ziemne',
        type: 'chapter',
        children: [
          {
            id: 'knr2-02-0101',
            code: 'KNR 2-02 0101',
            name: 'Wykopy',
            type: 'table',
            children: [
              {
                id: 'knr2-02-0101-01',
                code: 'KNR 2-02 0101-01',
                name: 'Wykopy jamiste o głęb. do 1,5 m w gruncie kat. I-II',
                type: 'position',
                unit: 'm3',
                norms: [{ type: 'labor', value: 1.20, unit: 'r-g' }],
              },
            ],
          },
        ],
      },
    ],
  },
];

// Resource type configuration (extended with waste type)
type ExtendedResourceType = KosztorysResourceType | 'waste';
const RESOURCE_TYPE_CONFIG: Record<ExtendedResourceType, {
  label: string;
  shortLabel: string;
  color: string;
  bgColor: string;
  icon: React.FC<{ className?: string }>;
}> = {
  labor: { label: 'Robocizna', shortLabel: 'R', color: 'text-yellow-700', bgColor: 'bg-[#FCD34D]', icon: Users },
  material: { label: 'Materiał', shortLabel: 'M', color: 'text-blue-700', bgColor: 'bg-[#60A5FA]', icon: Package },
  equipment: { label: 'Sprzęt', shortLabel: 'S', color: 'text-emerald-700', bgColor: 'bg-[#34D399]', icon: Wrench },
  waste: { label: 'Odpady', shortLabel: 'O', color: 'text-gray-800', bgColor: 'bg-gray-100', icon: Trash2 },
};

// Export template types
type ExportTemplate = 'kosztorys_ofertowy' | 'przedmiar_robot' | 'niestandardowy';

// Comment category types
type CommentCategory = 'none' | 'verification' | 'completion';

// Comment type for the comments panel
interface KosztorysComment {
  id: string;
  userId: string;
  userName: string;
  userInitials: string;
  text: string;
  createdAt: string;
  targetType: 'section' | 'position' | 'resource' | 'measurement';
  targetId: string;
  targetPath: string; // e.g., "Dz. 1.1 » Poz. 8"
  category: CommentCategory;
  completed: boolean;
}

// Price update dialog settings
interface PriceUpdateSettings {
  applyToLabor: boolean;
  applyToMaterial: boolean;
  applyToEquipment: boolean;
  applyToWaste: boolean;
  unitPositionPrices: boolean;
  emptyUnitPrices: boolean;
  objectPrices: boolean;
  onlyZeroPrices: boolean;
  skipStepProcess: boolean;
  expression: {
    field: 'cena' | 'wartosc';
    operation: 'add' | 'subtract' | 'multiply' | 'divide';
    value: string;
  };
  zeroPrices: boolean;
}

// Units reference
const UNITS_REFERENCE = [
  { index: '020', unit: 'szt.', name: 'sztuka' },
  { index: '023', unit: 'tys.szt.', name: 'tysiąc sztuk' },
  { index: '033', unit: 'kg', name: 'kilogram' },
  { index: '034', unit: 't', name: 'tona' },
  { index: '040', unit: 'm', name: 'metr' },
  { index: '050', unit: 'm2', name: 'metr kwadratowy' },
  { index: '060', unit: 'm3', name: 'metr sześcienny' },
  { index: '070', unit: 'kW', name: 'kilowat' },
  { index: '090', unit: 'kpl', name: 'komplet' },
  { index: '149', unit: 'r-g', name: 'roboczogodzina' },
  { index: '150', unit: 'm-g', name: 'maszynogodzina' },
];

// Estimate type labels
const ESTIMATE_TYPE_LABELS: Record<KosztorysType, string> = {
  investor: 'Kosztorys inwestorski',
  contractor: 'Kosztorys wykonawczy',
  offer: 'Kosztorys ofertowy',
};

// Initial editor state
const initialEditorState: KosztorysEditorState = {
  selectedItemId: null,
  selectedItemType: null,
  expandedSections: new Set(),
  expandedPositions: new Set(),
  expandedSubsections: new Set(),
  clipboard: null,
  isDirty: false,
  lastSaved: null,
  treeRootExpanded: true,
};

// Empty estimate data
const createEmptyEstimateData = (): KosztorysCostEstimateData => ({
  root: {
    sectionIds: [],
    positionIds: [],
    factors: createDefaultFactors(),
    overheads: [
      createDefaultIndirectCostsOverhead(65),
      createDefaultProfitOverhead(10),
      createDefaultPurchaseCostsOverhead(5),
    ],
  },
  sections: {},
  positions: {},
});

// =====================================================
// INLINE EDITABLE CELL
// =====================================================
interface EditableCellProps {
  value: string | number;
  type?: 'text' | 'number';
  onSave: (value: string | number) => void;
  className?: string;
  suffix?: string;
  placeholder?: string;
  disabled?: boolean;
}

const EditableCell: React.FC<EditableCellProps> = ({
  value, type = 'text', onSave, className = '', suffix = '', placeholder = '', disabled = false
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(String(value));

  useEffect(() => {
    setEditValue(String(value));
  }, [value]);

  const handleSave = () => {
    if (disabled) return;
    const newValue = type === 'number' ? (parseFloat(editValue.replace(',', '.')) || 0) : editValue;
    onSave(newValue);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') {
      setEditValue(String(value));
      setIsEditing(false);
    }
  };

  if (disabled) {
    return (
      <span className={`px-1 py-0.5 ${className}`}>
        {type === 'number' ? formatNumber(Number(value)) : value}
        {suffix}
      </span>
    );
  }

  if (isEditing) {
    return (
      <input
        type={type === 'number' ? 'text' : type}
        value={editValue}
        onChange={e => setEditValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        autoFocus
        placeholder={placeholder}
        className={`w-full px-1 py-0.5 text-sm border border-blue-400 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 ${className}`}
      />
    );
  }

  return (
    <span
      onClick={() => { setEditValue(String(value)); setIsEditing(true); }}
      className={`block w-full min-h-[1.5em] cursor-pointer hover:bg-blue-50 px-1 py-0.5 rounded ${className}`}
    >
      {type === 'number' ? formatNumber(Number(value)) : (value || placeholder || '\u00A0')}
      {suffix}
    </span>
  );
};

// =====================================================
// PROPERTIES PANEL
// =====================================================
interface PropertiesPanelProps {
  selectedItem: KosztorysSection | KosztorysPosition | KosztorysResource | null;
  selectedType: 'section' | 'position' | 'resource' | null;
  calculationResult: KosztorysPositionCalculationResult | null;
  onUpdate: (updates: Partial<any>) => void;
  onClose: () => void;
  showDetailedOverheads?: boolean;
  overheads?: KosztorysOverhead[];
}

const PropertiesPanel: React.FC<PropertiesPanelProps> = ({
  selectedItem, selectedType, calculationResult, onUpdate, onClose, showDetailedOverheads = false, overheads = []
}) => {
  if (!selectedItem || !selectedType) {
    return (
      <div className="w-80 bg-white border-l border-gray-200 p-4">
        <p className="text-gray-500 text-sm text-center mt-8">
          Wybierz element na kosztorysie, aby wyświetlić jego właściwości
        </p>
      </div>
    );
  }

  const renderSectionProperties = (section: KosztorysSection) => (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Nazwa działu</label>
        <input
          type="text"
          value={section.name}
          onChange={e => onUpdate({ name: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Opis</label>
        <textarea
          value={section.description}
          onChange={e => onUpdate({ description: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          rows={3}
        />
      </div>
      <div className="pt-4 border-t border-gray-200">
        <h4 className="text-sm font-medium text-gray-800 mb-2">Współczynniki działu</h4>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-gray-500">R (robocizna)</label>
            <input
              type="number"
              step="0.01"
              value={section.factors.labor}
              onChange={e => onUpdate({ factors: { ...section.factors, labor: parseFloat(e.target.value) || 1 } })}
              className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500">M (materiały)</label>
            <input
              type="number"
              step="0.01"
              value={section.factors.material}
              onChange={e => onUpdate({ factors: { ...section.factors, material: parseFloat(e.target.value) || 1 } })}
              className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500">S (sprzęt)</label>
            <input
              type="number"
              step="0.01"
              value={section.factors.equipment}
              onChange={e => onUpdate({ factors: { ...section.factors, equipment: parseFloat(e.target.value) || 1 } })}
              className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500">Odpady %</label>
            <input
              type="number"
              step="0.1"
              value={section.factors.waste}
              onChange={e => onUpdate({ factors: { ...section.factors, waste: parseFloat(e.target.value) || 0 } })}
              className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
            />
          </div>
        </div>
      </div>
    </div>
  );

  const renderPositionProperties = (position: KosztorysPosition) => (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Podstawa (norma)</label>
        <input
          type="text"
          value={position.base}
          onChange={e => onUpdate({ base: e.target.value, originBase: e.target.value })}
          placeholder="np. KNNR 5 0702-01"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Nazwa nakładu</label>
        <textarea
          value={position.name}
          onChange={e => onUpdate({ name: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          rows={2}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Jednostka</label>
          <select
            value={position.unit.unitIndex}
            onChange={e => {
              const unit = UNITS_REFERENCE.find(u => u.index === e.target.value);
              if (unit) onUpdate({ unit: { label: unit.unit, unitIndex: unit.index } });
            }}
            className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm"
          >
            {UNITS_REFERENCE.map(u => (
              <option key={u.index} value={u.index}>{u.unit} - {u.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Mnożnik</label>
          <input
            type="number"
            step="0.01"
            value={position.multiplicationFactor}
            onChange={e => onUpdate({ multiplicationFactor: parseFloat(e.target.value) || 1 })}
            className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm"
          />
        </div>
      </div>

      {calculationResult && (
        <div className="pt-4 border-t border-gray-200 space-y-2">
          <h4 className="text-sm font-medium text-gray-800">Podsumowanie pozycji</h4>
          <div className="bg-gray-50 rounded-lg p-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Ilość:</span>
              <span className="font-medium">{formatNumber(calculationResult.quantity)} {position.unit.label}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Robocizna:</span>
              <span className="font-medium">{formatCurrency(calculationResult.laborTotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Materiały:</span>
              <span className="font-medium">{formatCurrency(calculationResult.materialTotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Sprzęt:</span>
              <span className="font-medium">{formatCurrency(calculationResult.equipmentTotal)}</span>
            </div>
            <div className="flex justify-between pt-2 border-t border-gray-200">
              <span className="text-gray-600 font-medium">Koszty bezpośrednie:</span>
              <span className="font-bold">{formatCurrency(calculationResult.directCostsTotal)}</span>
            </div>
            {/* Detailed overhead breakdown */}
            {showDetailedOverheads && overheads.length > 0 && (() => {
              const kpOverhead = overheads.find(o => o.name.includes('Kp'));
              const zOverhead = overheads.find(o => o.name.includes('Zysk'));
              const kzOverhead = overheads.find(o => o.name.includes('zakupu'));

              const laborTotal = calculationResult.laborTotal || 0;
              const materialTotal = calculationResult.materialTotal || 0;

              const kpValue = kpOverhead ? laborTotal * (kpOverhead.value / 100) : 0;
              const kzValue = kzOverhead ? materialTotal * (kzOverhead.value / 100) : 0;
              const zBase = laborTotal + kpValue;
              const zValue = zOverhead ? zBase * (zOverhead.value / 100) : 0;

              return (
                <div className="space-y-0.5 pl-2 text-xs">
                  {kpOverhead && kpOverhead.value > 0 && (
                    <div className="flex justify-between text-gray-500">
                      <span>Kp ({kpOverhead.value}% od R):</span>
                      <span>{formatCurrency(kpValue)}</span>
                    </div>
                  )}
                  {zOverhead && zOverhead.value > 0 && (
                    <div className="flex justify-between text-gray-500">
                      <span>Z ({zOverhead.value}% od R+Kp):</span>
                      <span>{formatCurrency(zValue)}</span>
                    </div>
                  )}
                  {kzOverhead && kzOverhead.value > 0 && (
                    <div className="flex justify-between text-gray-500">
                      <span>Kz ({kzOverhead.value}% od M):</span>
                      <span>{formatCurrency(kzValue)}</span>
                    </div>
                  )}
                </div>
              );
            })()}
            <div className="flex justify-between">
              <span className="text-gray-600 font-medium">Razem z narzutami:</span>
              <span className="font-bold text-blue-600">{formatCurrency(calculationResult.totalWithOverheads)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600 font-medium">Cena jednostkowa:</span>
              <span className="font-bold">{formatCurrency(calculationResult.unitCost)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const renderResourceProperties = (resource: KosztorysResource) => {
    const config = RESOURCE_TYPE_CONFIG[resource.type];
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold ${config.bgColor} ${config.color}`}>
            {config.shortLabel}
          </span>
          <span className="text-sm font-medium text-gray-800">{config.label}</span>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Nazwa</label>
          <input
            type="text"
            value={resource.name}
            onChange={e => onUpdate({ name: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Indeks</label>
          <input
            type="text"
            value={resource.originIndex.index}
            onChange={e => onUpdate({ originIndex: { ...resource.originIndex, index: e.target.value } })}
            placeholder="np. 999"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Norma</label>
            <input
              type="number"
              step="0.0001"
              value={resource.norm.value}
              onChange={e => onUpdate({ norm: { ...resource.norm, value: parseFloat(e.target.value) || 0 } })}
              className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Jednostka</label>
            <select
              value={resource.unit.unitIndex}
              onChange={e => {
                const unit = UNITS_REFERENCE.find(u => u.index === e.target.value);
                if (unit) onUpdate({ unit: { label: unit.unit, unitIndex: unit.index } });
              }}
              className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm"
            >
              {UNITS_REFERENCE.map(u => (
                <option key={u.index} value={u.index}>{u.unit}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Cena jednostkowa</label>
            <input
              type="number"
              step="0.01"
              value={resource.unitPrice.value}
              onChange={e => onUpdate({ unitPrice: { ...resource.unitPrice, value: parseFloat(e.target.value) || 0 } })}
              className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Współczynnik</label>
            <input
              type="number"
              step="0.01"
              value={resource.factor}
              onChange={e => onUpdate({ factor: parseFloat(e.target.value) || 1 })}
              className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="w-80 bg-white border-l border-gray-200 flex flex-col">
      <div className="flex items-center justify-between p-3 border-b border-gray-200">
        <h3 className="font-semibold text-gray-900">Właściwości</h3>
        <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
          <X className="w-4 h-4 text-gray-500" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {selectedType === 'section' && renderSectionProperties(selectedItem as KosztorysSection)}
        {selectedType === 'position' && renderPositionProperties(selectedItem as KosztorysPosition)}
        {selectedType === 'resource' && renderResourceProperties(selectedItem as KosztorysResource)}
      </div>
    </div>
  );
};

// =====================================================
// MAIN EDITOR COMPONENT
// =====================================================
export const KosztorysEditorPage: React.FC = () => {
  const { state } = useAppContext();
  const { currentUser, currentCompany } = state;
  const { estimateId } = useParams<{ estimateId?: string }>();
  const navigate = useNavigate();

  // Loading and saving state
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Estimate data
  const [estimate, setEstimate] = useState<KosztorysCostEstimate | null>(null);
  const [estimateData, setEstimateData] = useState<KosztorysCostEstimateData>(createEmptyEstimateData());

  // Editor state
  const [editorState, setEditorState] = useState<KosztorysEditorState>(initialEditorState);

  // UI state
  const [showPropertiesPanel, setShowPropertiesPanel] = useState(true);
  const [showOverheadsModal, setShowOverheadsModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showAddPositionModal, setShowAddPositionModal] = useState(false);
  const [showAddResourceModal, setShowAddResourceModal] = useState(false);
  const [showExitConfirmModal, setShowExitConfirmModal] = useState(false);
  const [targetSectionId, setTargetSectionId] = useState<string | null>(null);
  const [targetPositionId, setTargetPositionId] = useState<string | null>(null);

  // Drag and drop state for sections and positions
  const [draggedSectionId, setDraggedSectionId] = useState<string | null>(null);
  const [draggedPositionId, setDraggedPositionId] = useState<string | null>(null);
  const [draggedItemParentId, setDraggedItemParentId] = useState<string | null>(null);

  // View modes
  const [viewMode, setViewMode] = useState<ViewMode>('kosztorys');
  const [leftPanelMode, setLeftPanelMode] = useState<LeftPanelMode>('overview');
  const [exportPages, setExportPages] = useState<ExportPage[]>(DEFAULT_EXPORT_PAGES);
  const [draggedExportPageId, setDraggedExportPageId] = useState<string | null>(null);
  const [activeNavItem, setActiveNavItem] = useState<string>('kosztorysy');
  const [activeExportSection, setActiveExportSection] = useState<string | null>(null);

  // Refs for print preview sections
  const printPreviewRef = React.useRef<HTMLDivElement>(null);
  const sectionRefs = React.useRef<{ [key: string]: HTMLDivElement | null }>({});

  // Catalog browser state
  const [catalogSearch, setCatalogSearch] = useState('');
  const [expandedCatalogItems, setExpandedCatalogItems] = useState<Set<string>>(new Set());
  const [selectedCatalogItem, setSelectedCatalogItem] = useState<CatalogItem | null>(null);
  const [catalogQuantity, setCatalogQuantity] = useState('10');
  const [catalogMultiplier, setCatalogMultiplier] = useState('1');
  // catalogUnitIndex removed — replaced by catalogSelectedUnit (raw unit string from DB)
  const [knrCatalog, setKnrCatalog] = useState<CatalogItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [loadedPositions, setLoadedPositions] = useState<Map<string, CatalogItem[]>>(new Map());
  const [loadedResources, setLoadedResources] = useState<Map<string, CatalogNorm[]>>(new Map());
  const [loadingFolder, setLoadingFolder] = useState<string | null>(null);
  const [catalogSearchResults, setCatalogSearchResults] = useState<CatalogItem[] | null>(null);
  const [catalogSearchLoading, setCatalogSearchLoading] = useState(false);
  const [knrUnits, setKnrUnits] = useState<string[]>([]);
  const [catalogSelectedUnit, setCatalogSelectedUnit] = useState<string>('m3');

  // Dropdown states
  const [showDzialDropdown, setShowDzialDropdown] = useState(false);
  const [showNakladDropdown, setShowNakladDropdown] = useState(false);
  const [showKNRDropdown, setShowKNRDropdown] = useState(false);
  const [showKomentarzeDropdown, setShowKomentarzeDropdown] = useState(false);
  const [showUsunDropdown, setShowUsunDropdown] = useState(false);
  const [showPrzesunDropdown, setShowPrzesunDropdown] = useState(false);
  const [showUzupelnijDropdown, setShowUzupelnijDropdown] = useState(false);
  const [showModeDropdown, setShowModeDropdown] = useState(false);
  const [showAddPageDropdown, setShowAddPageDropdown] = useState(false);
  const [selectedPagesToAdd, setSelectedPagesToAdd] = useState<Set<string>>(new Set());

  // Offer exists modal state
  const [showOfferExistsModal, setShowOfferExistsModal] = useState(false);
  const [showOfferUpdateConfirm, setShowOfferUpdateConfirm] = useState(false);
  const [existingOfferId, setExistingOfferId] = useState<string | null>(null);
  const [existingOfferName, setExistingOfferName] = useState('');

  // Gantt exists modal state
  const [showGanttExistsModal, setShowGanttExistsModal] = useState(false);
  const [showGanttUpdateConfirm, setShowGanttUpdateConfirm] = useState(false);
  const [existingProjectId, setExistingProjectId] = useState<string | null>(null);
  const [existingProjectName, setExistingProjectName] = useState('');

  // Ceny (Prices) dialog state
  const [showCenyDialog, setShowCenyDialog] = useState(false);
  const [cenyDialogTab, setCenyDialogTab] = useState<'wstaw' | 'zmien'>('wstaw');
  const [priceUpdateSettings, setPriceUpdateSettings] = useState<PriceUpdateSettings>({
    applyToLabor: false,
    applyToMaterial: false,
    applyToEquipment: false,
    applyToWaste: false,
    unitPositionPrices: false,
    emptyUnitPrices: false,
    objectPrices: false,
    onlyZeroPrices: false,
    skipStepProcess: true,
    expression: { field: 'cena', operation: 'add', value: '' },
    zeroPrices: false,
  });
  const [showPriceSourcesExpanded, setShowPriceSourcesExpanded] = useState(false);
  const [showSearchOptionsExpanded, setShowSearchOptionsExpanded] = useState(false);
  const [showAdvancedExpanded, setShowAdvancedExpanded] = useState(false);
  const [searchByNameWhenNoIndex, setSearchByNameWhenNoIndex] = useState(false);
  const [searchAllIndexTypes, setSearchAllIndexTypes] = useState(false);
  const [matchUnits, setMatchUnits] = useState(false);
  const [zeroNotFoundPrices, setZeroNotFoundPrices] = useState(false);
  const [autoSelectLowestPrice, setAutoSelectLowestPrice] = useState(false);

  // KNR Catalog import modal state
  const [showKatalogImportModal, setShowKatalogImportModal] = useState(false);
  const [katalogImportFile, setKatalogImportFile] = useState<File | null>(null);
  const [katalogImportName, setKatalogImportName] = useState('');
  const [katalogImportBase, setKatalogImportBase] = useState('');
  const [katalogImportDragging, setKatalogImportDragging] = useState(false);

  // Price sources modal state
  const [showPriceSourcesModal, setShowPriceSourcesModal] = useState(false);
  const [selectedPriceSources, setSelectedPriceSources] = useState<string[]>(['system']);
  const [priceSourceSearch, setPriceSourceSearch] = useState('');

  // Price import modal state
  const [showPriceImportModal, setShowPriceImportModal] = useState(false);
  const [priceImportFile, setPriceImportFile] = useState<File | null>(null);
  const [priceImportName, setPriceImportName] = useState('');
  const [priceImportSource, setPriceImportSource] = useState('');
  const [priceImportDragging, setPriceImportDragging] = useState(false);

  // Custom price list creation state
  const [showPriceAddChoice, setShowPriceAddChoice] = useState(false);
  const [showCustomPriceListModal, setShowCustomPriceListModal] = useState(false);
  const [customPriceListTab, setCustomPriceListTab] = useState<CustomPriceListTab>('robocizna');
  const [customPriceListSaving, setCustomPriceListSaving] = useState(false);
  const [customPriceListEditingName, setCustomPriceListEditingName] = useState(false);
  const [customPriceList, setCustomPriceList] = useState<CustomPriceListState>(initialCustomPriceList);
  const [editingPriceSourceId, setEditingPriceSourceId] = useState<string | null>(null);
  const [deletingPriceSourceId, setDeletingPriceSourceId] = useState<string | null>(null);
  const [deletingPriceSourceName, setDeletingPriceSourceName] = useState('');
  const [userPriceSources, setUserPriceSources] = useState<Array<{ id: string; name: string }>>([]);
  const [allPriceSources, setAllPriceSources] = useState<Array<{ id: string; name: string }>>([]);

  // Kartoteka price list modal state
  const [showKartotekaPriceListModal, setShowKartotekaPriceListModal] = useState(false);
  const [kartotekaPriceListTab, setKartotekaPriceListTab] = useState<'robocizna' | 'materialy' | 'sprzet'>('robocizna');
  const [kartotekaPriceListLoading, setKartotekaPriceListLoading] = useState(false);
  const [kartotekaPriceListData, setKartotekaPriceListData] = useState<{
    robocizna: Array<{ code: string; name: string; category: string; unit: string; price: number }>;
    materialy: Array<{ code: string; name: string; category: string; unit: string; price: number }>;
    sprzet: Array<{ code: string; name: string; category: string; unit: string; price: number }>;
  }>({ robocizna: [], materialy: [], sprzet: [] });

  // Replace resources confirmation modal
  const [showReplaceResourcesConfirm, setShowReplaceResourcesConfirm] = useState(false);

  // Search Material modal state
  const [showSearchMaterialModal, setShowSearchMaterialModal] = useState(false);
  const [searchMaterialSubTab, setSearchMaterialSubTab] = useState<'own' | 'onninen' | 'tim'>('own');
  const [searchMaterialIntegrations, setSearchMaterialIntegrations] = useState<WholesalerIntegration[]>([]);
  const [searchMaterialOwnData, setSearchMaterialOwnData] = useState<KosztorysMaterial[]>([]);
  const [searchMaterialSearch, setSearchMaterialSearch] = useState('');
  const [searchMatCategories, setSearchMatCategories] = useState<{ id: string; name: string; sort_order: number; parent_id?: string | null }[]>([]);
  const [searchMatSelectedCategory, setSearchMatSelectedCategory] = useState<string | null>(null);
  const [searchMatViewMode, setSearchMatViewMode] = useState<'grid' | 'list'>('grid');
  const [searchMatExpandedCats, setSearchMatExpandedCats] = useState<Set<string>>(new Set());
  const [searchMatDetailItem, setSearchMatDetailItem] = useState<KosztorysMaterial | null>(null);
  const [searchMatWholesalerPrices, setSearchMatWholesalerPrices] = useState<Array<{ wholesaler: string; productName: string; catalogPrice: number | null; purchasePrice: number | null; stock: number | null; url?: string }>>([]);
  const [searchMatLoadingPrices, setSearchMatLoadingPrices] = useState(false);

  // Search Equipment modal state
  const [showSearchEquipmentModal, setShowSearchEquipmentModal] = useState(false);
  const [searchEquipmentSubTab, setSearchEquipmentSubTab] = useState<'own' | 'atut-rental' | 'ramirent'>('own');
  const [searchEquipmentIntegrations, setSearchEquipmentIntegrations] = useState<WholesalerIntegration[]>([]);
  const [searchEquipmentOwnData, setSearchEquipmentOwnData] = useState<KosztorysEquipment[]>([]);
  const [searchEquipmentSearch, setSearchEquipmentSearch] = useState('');
  const [searchEqCategories, setSearchEqCategories] = useState<{ id: string; name: string; sort_order: number; parent_id?: string | null }[]>([]);
  const [searchEqSelectedCategory, setSearchEqSelectedCategory] = useState<string | null>(null);
  const [searchEqViewMode, setSearchEqViewMode] = useState<'grid' | 'list'>('grid');
  const [searchEqExpandedCats, setSearchEqExpandedCats] = useState<Set<string>>(new Set());
  const [searchEqDetailItem, setSearchEqDetailItem] = useState<KosztorysEquipment | null>(null);

  // Search Labour modal state
  const [showSearchLabourModal, setShowSearchLabourModal] = useState(false);
  const [searchLabourSubTab, setSearchLabourSubTab] = useState<'system' | 'own'>('system');
  const [searchLabourSearch, setSearchLabourSearch] = useState('');
  const [searchLabourSystemData, setSearchLabourSystemData] = useState<KosztorysSystemLabour[]>([]);
  const [searchLabourSystemCategories, setSearchLabourSystemCategories] = useState<KosztorysSystemLabourCategory[]>([]);
  const [searchLabourSelectedSystemCategory, setSearchLabourSelectedSystemCategory] = useState<string | null>(null);
  const [searchLabourExpandedSystemCats, setSearchLabourExpandedSystemCats] = useState<Set<string>>(new Set());
  const [searchLabourSystemPage, setSearchLabourSystemPage] = useState(0);
  const [searchLabourOwnData, setSearchLabourOwnData] = useState<KosztorysOwnLabour[]>([]);
  const [searchLabourOwnCategories, setSearchLabourOwnCategories] = useState<Array<{ id: string; name: string; sort_order: number; parent_id?: string | null }>>([]);
  const [searchLabourSelectedOwnCategory, setSearchLabourSelectedOwnCategory] = useState<string | null>(null);
  const [searchLabourExpandedOwnCats, setSearchLabourExpandedOwnCats] = useState<Set<string>>(new Set());

  // Import modal state
  const [showImportConfirmModal, setShowImportConfirmModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [importDragActive, setImportDragActive] = useState(false);
  const [xlsxPreview, setXlsxPreview] = useState<XlsxPreview | null>(null);
  const [xlsxMapping, setXlsxMapping] = useState<XlsxColumnMapping | null>(null);
  const [xlsxAiAnalysis, setXlsxAiAnalysis] = useState<XlsxAiAnalysis | null>(null);
  const [xlsxAiStructure, setXlsxAiStructure] = useState<XlsxAiStructureEntry[]>([]);
  const [xlsxAiLoading, setXlsxAiLoading] = useState(false);
  const [xlsxAiError, setXlsxAiError] = useState<string | null>(null);
  const [xlsxCollapsedSections, setXlsxCollapsedSections] = useState<Set<number>>(new Set());
  const [xlsxTreeOpen, setXlsxTreeOpen] = useState(true);
  const [xlsxHighlightedRow, setXlsxHighlightedRow] = useState<number | null>(null);
  const [xlsxColWidths, setXlsxColWidths] = useState<Record<number, number>>({});
  const xlsxTableRef = React.useRef<HTMLDivElement>(null);

  // KNR import flow state
  type KnrImportStep = 'choice' | 'ai-mode' | 'ai-scope' | 'processing' | 'review' | 'stats';
  type KnrReviewItem = {
    posId: string;
    posName: string;
    posUnit: string;
    knrCode: string;
    knrDescription: string;
    source: 'portal' | 'ai' | 'original';
    confidence: number;
    accepted?: boolean;
    removed?: boolean;
  };
  type KnrImportStats = {
    totalPositions: number;
    positionsWithKnr: number;
    positionsWithoutKnr: number;
    foundInPortal: number;
    foundByAi: number;
    accepted: number;
    rejected: number;
  };
  const [knrImportStep, setKnrImportStep] = useState<KnrImportStep | null>(null);
  const [knrPendingData, setKnrPendingData] = useState<KosztorysCostEstimateData | null>(null);
  const [knrReviewItems, setKnrReviewItems] = useState<KnrReviewItem[]>([]);
  const [knrReviewIndex, setKnrReviewIndex] = useState(0);
  const [knrImportStats, setKnrImportStats] = useState<KnrImportStats | null>(null);
  const [knrProcessingMsg, setKnrProcessingMsg] = useState('');
  const [knrProcessingProgress, setKnrProcessingProgress] = useState(0);
  const [knrScope, setKnrScope] = useState<'all' | 'empty'>('empty');
  const [knrReviewSelectedId, setKnrReviewSelectedId] = useState<string | null>(null);

  // Comments panel state
  const [showCommentsPanel, setShowCommentsPanel] = useState(false);
  const [commentsFilter, setCommentsFilter] = useState<'all' | 'verification' | 'completion' | 'none'>('all');
  const [commentsSortBy, setCommentsSortBy] = useState<'date' | 'activity'>('activity');
  const [showCommentsSortDropdown, setShowCommentsSortDropdown] = useState(false);
  const [commentSelectionMode, setCommentSelectionMode] = useState(false);
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(null);
  const [newCommentText, setNewCommentText] = useState('');
  const [comments, setComments] = useState<KosztorysComment[]>([
    {
      id: '1',
      userId: 'user1',
      userName: 'Denys Krupka',
      userInitials: 'DK',
      text: 'Stworzył zadanie',
      createdAt: '2026-02-10',
      targetType: 'position',
      targetId: 'pos-1',
      targetPath: 'Dz. 1.1 » Poz. 8',
      category: 'verification',
      completed: false,
    },
    {
      id: '2',
      userId: 'user1',
      userName: 'Denys Krupka',
      userInitials: 'DK',
      text: 'Stworzył zadanie',
      createdAt: '2026-02-10',
      targetType: 'measurement',
      targetId: 'meas-1',
      targetPath: 'Dz. 1.1 » Poz. 8 » Obmiar cc533c2e-f5ed-4c18-8ce1-c0053659ba32',
      category: 'none',
      completed: false,
    },
  ]);

  // Export panel state
  const [exportTemplate, setExportTemplate] = useState<ExportTemplate>('niestandardowy');
  const [exportSearch, setExportSearch] = useState('');

  // Comments display options
  const [showCommentsOnSheet, setShowCommentsOnSheet] = useState(false);
  const [showCompletedTasks, setShowCompletedTasks] = useState(false);

  // Alerts state
  const [alertsCount, setAlertsCount] = useState({ current: 0, total: 13 });
  const [alerts, setAlerts] = useState<{ id: string; type: 'warning' | 'error'; message: string; reason: string; path: string; itemType: string; itemName: string; positionId?: string; resourceId?: string; positionName?: string }[]>([]);
  const [alertsExpanded, setAlertsExpanded] = useState(false);

  // Print dialog state
  const [showPrintDialog, setShowPrintDialog] = useState(false);
  const [printSettings, setPrintSettings] = useState({
    pages: 'all',
    copies: 1,
    orientation: 'portrait',
    color: true,
  });
  const [printPreviewPage, setPrintPreviewPage] = useState(1);
  const [printTotalPages, setPrintTotalPages] = useState(5);

  // Position tag dropdown state
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const [tagSearch, setTagSearch] = useState('');

  // Opcje widoku dropdown state
  const [showOpcjeWidokuDropdown, setShowOpcjeWidokuDropdown] = useState(false);
  const [viewOptions, setViewOptions] = useState({
    showPrzemiar: true,
    showNaklady: true,
    showCeny: true,
    showSumy: true,
    compactView: false,
  });

  // Right panel state
  type RightPanelMode = 'closed' | 'settings' | 'viewOptions' | 'positionSettings';
  const [rightPanelMode, setRightPanelMode] = useState<RightPanelMode>('closed');
  const [viewOptionsPanel, setViewOptionsPanel] = useState({
    highlightZeroPrices: true,
    showDetailedOverheads: true,
  });

  // Highlight state for alert navigation
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);
  const tableContainerRef = React.useRef<HTMLDivElement>(null);
  const rowRefs = React.useRef<{ [key: string]: HTMLTableRowElement | null }>({});
  const [treeSearchQuery, setTreeSearchQuery] = useState('');

  // Title Page Editor state
  const [titlePageData, setTitlePageData] = useState<TitlePageData>({
    title: '',
    hideManHourRate: false,
    hideOverheads: false,
    hideWorkValue: false,
    companyName: '',
    companyAddress: '',
    orderName: '',
    orderAddress: '',
    clientName: '',
    clientAddress: '',
    contractorName: '',
    contractorAddress: '',
    contractorNIP: '',
    industry: '',
    preparedBy: '',
    preparedByIndustry: '',
    checkedBy: '',
    checkedByIndustry: '',
    preparedDate: '',
    approvedDate: '',
    stawkaRobocizny: '',
    kosztyPosrednie: '',
    zysk: '',
    kosztyZakupu: '',
  });

  // Title Page Editor section expand states
  const [titlePageSections, setTitlePageSections] = useState({
    title: true,
    workValue: true,
    company: true,
    order: true,
    client: true,
    contractor: true,
    participants: true,
    dates: true,
    stawki: true,  // Ставки section
  });

  // Zestawienia (Summaries) tab state
  const [zestawieniaTab, setZestawieniaTab] = useState<ZestawieniaTab>('robocizna');

  // Form state for new items
  const [newPositionForm, setNewPositionForm] = useState({
    base: '',
    name: '',
    unitIndex: '020',
    measurement: '',
  });

  const [newResourceForm, setNewResourceForm] = useState({
    type: 'labor' as KosztorysResourceType,
    name: '',
    index: '',
    normValue: 1,
    unitPrice: 0,
    unitIndex: '149',
  });

  // Calculation results
  const calculationResult = useMemo(() => {
    if (!estimate) return null;
    return calculateCostEstimate({
      ...estimate,
      data: estimateData,
    });
  }, [estimate, estimateData]);

  // Selected item
  const selectedItem = useMemo(() => {
    if (!editorState.selectedItemId || !editorState.selectedItemType) return null;

    switch (editorState.selectedItemType) {
      case 'section':
        return estimateData.sections[editorState.selectedItemId] || null;
      case 'position':
        return estimateData.positions[editorState.selectedItemId] || null;
      case 'resource': {
        for (const position of Object.values(estimateData.positions)) {
          const resource = position.resources.find(r => r.id === editorState.selectedItemId);
          if (resource) return resource;
        }
        return null;
      }
      default:
        return null;
    }
  }, [editorState.selectedItemId, editorState.selectedItemType, estimateData]);

  // Position calculation result for selected position
  const selectedPositionResult = useMemo(() => {
    if (editorState.selectedItemType !== 'position' || !editorState.selectedItemId || !calculationResult) {
      return null;
    }
    return calculationResult.positions[editorState.selectedItemId] || null;
  }, [editorState.selectedItemType, editorState.selectedItemId, calculationResult]);

  // Search results for navigation tree
  const treeSearchResults = useMemo(() => {
    const q = treeSearchQuery.trim().toLowerCase();
    if (!q || q.length < 2) return null;

    const results: { positionId: string; sectionName: string; base: string; name: string }[] = [];

    for (const [posId, pos] of Object.entries(estimateData.positions)) {
      const searchableText = [
        pos.name,
        pos.base,
        pos.unit?.label,
        ...pos.resources.map(r => r.name),
        ...pos.resources.map(r => r.index || ''),
      ].join(' ').toLowerCase();

      if (searchableText.includes(q)) {
        let sectionName = '';
        for (const sec of Object.values(estimateData.sections)) {
          if (sec.positionIds.includes(posId)) {
            sectionName = sec.name;
            break;
          }
        }
        results.push({ positionId: posId, sectionName, base: pos.base || '', name: pos.name });
      }
    }
    return results;
  }, [treeSearchQuery, estimateData]);

  // Auto-validate when data changes
  useEffect(() => {
    if (!calculationResult || Object.keys(estimateData.positions).length === 0) {
      setAlerts([]);
      setAlertsCount({ current: 0, total: 0 });
      return;
    }

    const newAlerts: typeof alerts = [];
    let posIndex = 0;

    // Helper function to get positions from a section (including subsections)
    const getPositionsFromSection = (sectionId: string): string[] => {
      const section = estimateData.sections[sectionId];
      if (!section) return [];
      let posIds = [...section.positionIds];
      for (const subId of section.subsectionIds || []) {
        posIds = posIds.concat(getPositionsFromSection(subId));
      }
      return posIds;
    };

    // Helper: build path string showing section names (e.g. "Roboty ziemne \ Wykopy")
    const buildPositionPath = (positionId: string): string => {
      const pathParts: string[] = [];
      const findInSection = (sectionId: string, ancestors: string[]): boolean => {
        const section = estimateData.sections[sectionId];
        if (!section) return false;
        const current = [...ancestors, section.name];
        if (section.positionIds.includes(positionId)) {
          pathParts.push(...current);
          return true;
        }
        for (const subId of section.subsectionIds || []) {
          if (findInSection(subId, current)) return true;
        }
        return false;
      };
      for (const sectionId of estimateData.root.sectionIds) {
        if (findInSection(sectionId, [])) break;
      }
      return pathParts.join(' \\ ') || '';
    };

    const resourceTypeLabel = (type: string) => {
      switch (type) {
        case 'labor': return 'Robocizna';
        case 'material': return 'Materiał';
        case 'equipment': return 'Sprzęt';
        default: return type;
      }
    };

    // Get all visible position IDs in order (through sections)
    let visiblePositionIds: string[] = [];
    // First add positions from root (if any direct positions)
    const rootPosIds = estimateData.root.positionIds || [];
    visiblePositionIds = visiblePositionIds.concat(rootPosIds);
    // Then add positions from sections
    for (const sectionId of estimateData.root.sectionIds) {
      visiblePositionIds = visiblePositionIds.concat(getPositionsFromSection(sectionId));
    }

    // Filter out orphan position IDs (IDs that don't exist in positions object)
    visiblePositionIds = visiblePositionIds.filter(id => estimateData.positions[id]);

    // Validate only visible positions
    visiblePositionIds.forEach((positionId) => {
      const position = estimateData.positions[positionId];

      posIndex++;

      const posPath = buildPositionPath(positionId);
      const posName = position.name || `Pozycja ${posIndex}`;

      // Check for zero unit price (total cost = 0 but has resources)
      if (position.resources.length > 0) {
        position.resources.forEach((resource) => {
          if (resource.unitPrice.value === 0) {
            newAlerts.push({
              id: `${resource.id}-price`,
              type: 'warning',
              message: posName,
              reason: 'Cena zerowa',
              path: posPath,
              itemType: `Nakład (${resourceTypeLabel(resource.type)})`,
              itemName: resource.name || '-',
              positionId: position.id,
              resourceId: resource.id,
              positionName: position.name,
            });
          }
        });
      }

      // Check if position has no resources
      if (position.resources.length === 0) {
        newAlerts.push({
          id: `${position.id}-nores`,
          type: 'warning',
          message: posName,
          reason: 'Brak nakładów',
          path: posPath,
          itemType: 'Pozycja',
          itemName: '-',
          positionId: position.id,
          positionName: position.name,
        });
      }
    });

    setAlerts(newAlerts);
    setAlertsCount({ current: 0, total: newAlerts.length });
  }, [calculationResult, estimateData.positions, estimateData.sections, estimateData.root.sectionIds, estimateData.root.positionIds]);

  // Load estimate
  useEffect(() => {
    if (currentUser) {
      if (estimateId) {
        loadEstimate(estimateId);
      } else {
        createNewEstimate();
      }
    }
  }, [currentUser, estimateId]);

  // Load user-created price sources
  useEffect(() => {
    if (currentUser) {
      loadUserPriceSources();
    }
  }, [currentUser]);

  // Helper: convert DB folder row to CatalogItem
  const folderToItem = (folder: any): CatalogItem => {
    let type: 'catalog' | 'chapter' | 'table' = 'catalog';
    if (folder.depth === 1) type = 'chapter';
    else if (folder.depth >= 2) type = 'table';

    // Show name as description; skip only if it's exactly equal to basis (duplicate)
    const name = (folder.name || '').trim();
    const basis = (folder.basis || '').trim();
    const displayName = (name && name !== basis) ? name : '';

    return {
      id: folder.xid,
      code: folder.basis,
      name: displayName,
      type,
      // All non-position folders are expandable (children loaded lazily)
      children: [],
    };
  };

  // Load ONLY root catalogs (depth 0) on mount — everything else loads on expand
  useEffect(() => {
    const loadRootCatalogs = async () => {
      setCatalogLoading(true);
      try {
        // Fetch root catalogs and units in parallel
        const [rootResult, unitsResult] = await Promise.all([
          supabase
            .from('knr_folders')
            .select('xid,basis,name,depth,parent_xid')
            .eq('is_system', true)
            .eq('depth', 0)
            .order('basis', { ascending: true }),
          supabase
            .from('knr_positions')
            .select('unit')
            .eq('is_system', true)
            .limit(1000),
        ]);

        // Set unique units
        if (unitsResult.data) {
          const uniqueUnits = [...new Set(unitsResult.data.map((r: any) => r.unit).filter(Boolean))].sort();
          setKnrUnits(uniqueUnits);
        }

        if (rootResult.error) {
          console.error('Error loading root catalogs:', rootResult.error);
          return;
        }

        const catalog = (rootResult.data || []).map(folderToItem);
        setKnrCatalog(catalog);
      } catch (error) {
        console.error('Error loading KNR catalog:', error);
      } finally {
        setCatalogLoading(false);
      }
    };

    loadRootCatalogs();
  }, []);

  // Load child folders for a parent folder lazily (on expand)
  const loadChildFolders = async (parentId: string) => {
    setLoadingFolder(parentId);
    try {
      const { data: children, error } = await supabase
        .from('knr_folders')
        .select('xid,basis,name,depth,parent_xid')
        .eq('is_system', true)
        .eq('parent_xid', parentId)
        .order('basis', { ascending: true });

      if (error) {
        console.error('Error loading child folders:', error);
        return;
      }

      const childItems = (children || []).map(folderToItem);

      // Update the tree to add these children
      setKnrCatalog(prev => {
        const updateChildren = (items: CatalogItem[]): CatalogItem[] => {
          return items.map(item => {
            if (item.id === parentId) {
              // Merge: keep existing position children, add new folder children
              const existingPositions = (item.children || []).filter(c => c.type === 'position');
              return { ...item, children: [...childItems, ...existingPositions] };
            }
            if (item.children) {
              return { ...item, children: updateChildren(item.children) };
            }
            return item;
          });
        };
        return updateChildren(prev);
      });
    } catch (error) {
      console.error('Error loading child folders:', error);
    } finally {
      setLoadingFolder(null);
    }
  };

  // Load positions for a folder lazily
  const loadPositionsForFolder = async (folderId: string) => {
    if (loadedPositions.has(folderId)) return; // Already cached
    setLoadingFolder(folderId);
    try {
      const { data: positions, error } = await supabase
        .from('knr_positions')
        .select('*')
        .eq('folder_xid', folderId)
        .order('ordinal_number', { ascending: true });

      if (error) {
        console.error('Error loading positions for folder:', error);
        return;
      }

      const positionItems: CatalogItem[] = (positions || []).map(pos => ({
        id: pos.xid,
        code: pos.basis,
        name: pos.name,
        type: 'position' as const,
        unit: pos.unit,
      }));

      setLoadedPositions(prev => {
        const next = new Map(prev);
        next.set(folderId, positionItems);
        return next;
      });

      // Update the catalog tree to include positions in the folder
      setKnrCatalog(prevCatalog => {
        const addPositionsToFolder = (items: CatalogItem[]): CatalogItem[] => {
          return items.map(item => {
            if (item.id === folderId) {
              const existingFolderChildren = (item.children || []).filter(c => c.type !== 'position');
              return {
                ...item,
                children: [...existingFolderChildren, ...positionItems],
              };
            }
            if (item.children) {
              return { ...item, children: addPositionsToFolder(item.children) };
            }
            return item;
          });
        };
        return addPositionsToFolder(prevCatalog);
      });
    } catch (error) {
      console.error('Error loading positions:', error);
    } finally {
      setLoadingFolder(null);
    }
  };

  // Load resources (norms) for a position lazily
  const loadResourcesForPosition = async (positionId: string): Promise<CatalogNorm[]> => {
    if (loadedResources.has(positionId)) return loadedResources.get(positionId)!;
    try {
      const { data: resources, error } = await supabase
        .from('knr_position_resources')
        .select('*')
        .eq('position_xid', positionId)
        .order('ordinal_number', { ascending: true });

      if (error) {
        console.error('Error loading resources for position:', error);
        return [];
      }

      const norms: CatalogNorm[] = (resources || []).map(res => ({
        type: (res.type === 'R' ? 'labor' : res.type === 'M' ? 'material' : 'equipment') as KosztorysResourceType,
        value: parseFloat(res.norm) || 0,
        unit: res.rms_unit || '',
        name: res.rms_name || '',
        index: res.rms_index || undefined,
        rmsCode: res.rms_code || undefined,
      }));

      setLoadedResources(prev => {
        const next = new Map(prev);
        next.set(positionId, norms);
        return next;
      });

      return norms;
    } catch (error) {
      console.error('Error loading resources:', error);
      return [];
    }
  };

  const loadEstimate = async (id: string) => {
    setLoading(true);
    try {
      // Load from existing kosztorys_estimates table
      const { data, error } = await supabase
        .from('kosztorys_estimates')
        .select(`
          *,
          request:kosztorys_requests(id, investment_name, client_name, address, nip, company_street, company_street_number, company_city, company_postal_code, contacts:kosztorys_request_contacts(*)),
          items:kosztorys_estimate_items(*),
          equipment_items:kosztorys_estimate_equipment(*, equipment:kosztorys_equipment(*))
        `)
        .eq('id', id)
        .single();

      if (error) throw error;

      if (data) {
        const now = new Date().toISOString();

        // Convert existing estimate to new format
        const convertedEstimate: KosztorysCostEstimate = {
          id: data.id,
          company_id: data.company_id,
          created_by_id: data.created_by_id,
          settings: {
            type: 'contractor',
            name: data.request?.investment_name || `Kosztorys ${data.estimate_number}`,
            description: data.request?.client_name || '',
            created: data.created_at,
            modified: data.updated_at || now,
            defaultCurrency: 'PLN',
            calculationTemplate: 'overhead-on-top',
            print: {
              pages: [],
              titlePage: {
                companyInfo: { name: '', address: '', contacts: [] },
                documentTitle: `Kosztorys ${data.estimate_number}`,
                showCostFields: true,
                showManHourRate: true,
                showOverheadsCosts: true,
                orderDetails: {
                  orderName: data.request?.investment_name || '',
                  constructionSiteAddress: data.request?.address || ''
                },
                clientDetails: {
                  clientName: data.request?.client_name || '',
                  clientAddress: ''
                },
                contractorDetails: { contractorName: '', contractorAddress: '', industry: '' },
                participants: {
                  preparedBy: '', preparedAt: '', preparedByIndustry: '',
                  checkedBy: '', checkedAt: '', checkedByIndustry: '',
                },
              },
            },
            precision: {
              norms: 6, resources: 2, measurements: 2, unitValues: 2,
              positionBase: 2, costEstimateBase: 2, roundingMethod: 'default',
            },
          },
          data: createEmptyEstimateData(),
          totalLabor: data.total_works || 0,
          totalMaterial: data.total_materials || 0,
          totalEquipment: data.total_equipment || 0,
          totalOverhead: 0,
          totalValue: data.total_gross || 0,
          created_at: data.created_at,
          updated_at: data.updated_at || now,
        };

        // Check if we have saved JSON data first
        if (data.data_json) {
          // Use saved JSON data directly, but clean orphan positions first
          const rawData = data.data_json as KosztorysCostEstimateData;
          const cleanedData = cleanOrphanPositions(rawData);
          convertedEstimate.data = cleanedData;
          setEstimate(convertedEstimate);
          setEstimateData(cleanedData);

          // Expand all sections and positions by default
          const allSectionIds = Object.keys(cleanedData.sections);
          const allPositionIds = Object.keys(cleanedData.positions);
          setEditorState(prev => ({
            ...prev,
            expandedSections: new Set(allSectionIds),
            expandedPositions: new Set(allPositionIds),
          }));

          // Auto-fill title page from request data (only empty fields)
          if (data.request) {
            const clientAddr = [
              [data.request?.company_street, data.request?.company_street_number].filter(Boolean).join(' '),
              [data.request?.company_postal_code, data.request?.company_city].filter(Boolean).join(' ')
            ].filter(Boolean).join(', ');
            const clientAddrWithNip = clientAddr + (data.request?.nip ? `\nNIP: ${data.request.nip}` : '');

            setTitlePageData(prev => ({
              ...prev,
              title: prev.title || data.request?.investment_name || '',
              orderName: prev.orderName || data.request?.investment_name || '',
              orderAddress: prev.orderAddress || data.request?.address || '',
              clientName: prev.clientName || data.request?.client_name || '',
              clientAddress: prev.clientAddress || clientAddrWithNip,
              // Auto-fill company (entity preparing estimate) from current company
              companyName: prev.companyName || currentCompany?.legal_name || currentCompany?.name || '',
              companyAddress: prev.companyAddress || [
                [currentCompany?.address_street].filter(Boolean).join(' '),
                [currentCompany?.address_postal_code, currentCompany?.address_city].filter(Boolean).join(' ')
              ].filter(Boolean).join(', '),
              // Auto-fill contractor (executor) from current company
              contractorName: prev.contractorName || currentCompany?.legal_name || currentCompany?.name || '',
              contractorAddress: prev.contractorAddress || [
                [currentCompany?.address_street].filter(Boolean).join(' '),
                [currentCompany?.address_postal_code, currentCompany?.address_city].filter(Boolean).join(' ')
              ].filter(Boolean).join(', '),
              contractorNIP: prev.contractorNIP || currentCompany?.tax_id || '',
            }));
          }

          setLoading(false);
          return;
        }

        // Fallback: Convert existing items to positions
        const positions: Record<string, KosztorysPosition> = {};
        const positionIds: string[] = [];

        if (data.items && data.items.length > 0) {
          for (const item of data.items) {
            const posId = item.id;
            positionIds.push(posId);

            // Create measurement from quantity
            let measurements = createEmptyMeasurements();
            if (item.quantity > 0) {
              measurements = addMeasurementEntry(measurements, String(item.quantity), 'Ilość');
            }

            // Create resources from item data
            const resources: KosztorysResource[] = [];

            // Add labor resource if there's work cost
            if (item.unit_price_work > 0) {
              resources.push({
                id: `${posId}-labor`,
                name: 'Robocizna',
                index: null,
                originIndex: { type: 'custom', index: '' },
                type: 'labor',
                factor: 1,
                norm: { type: 'absolute', value: 1 },
                unit: { label: 'r-g', unitIndex: '149' },
                unitPrice: { value: item.unit_price_work, currency: 'PLN' },
                group: null,
                marker: null,
                investorTotal: false,
              });
            }

            // Add material resource if there's material cost
            if (item.unit_price_material > 0) {
              resources.push({
                id: `${posId}-material`,
                name: item.material_name || 'Materiał',
                index: null,
                originIndex: { type: 'custom', index: '' },
                type: 'material',
                factor: 1,
                norm: { type: 'absolute', value: 1 },
                unit: { label: 'szt.', unitIndex: '020' },
                unitPrice: { value: item.unit_price_material, currency: 'PLN' },
                group: null,
                marker: null,
                investorTotal: false,
              });
            }

            positions[posId] = {
              id: posId,
              base: '',
              originBase: '',
              name: item.task_description || 'Pozycja',
              marker: item.room_group || null,
              unit: { label: 'szt.', unitIndex: '020' },
              measurements,
              multiplicationFactor: 1,
              resources,
              factors: createDefaultFactors(),
              overheads: [],
              unitPrice: { value: 0, currency: 'PLN' },
            };
          }
        }

        // Update estimate data with converted positions
        convertedEstimate.data = {
          root: {
            sectionIds: [],
            positionIds,
            factors: createDefaultFactors(),
            overheads: [
              createDefaultIndirectCostsOverhead(65),
              createDefaultProfitOverhead(10),
              createDefaultPurchaseCostsOverhead(5),
            ],
          },
          sections: {},
          positions,
        };

        setEstimate(convertedEstimate);
        setEstimateData(convertedEstimate.data);

        // Expand all positions by default
        setEditorState(prev => ({
          ...prev,
          expandedPositions: new Set(positionIds),
        }));

        // Auto-fill title page from request data
        if (data.request) {
          const clientAddr = [
            [data.request?.company_street, data.request?.company_street_number].filter(Boolean).join(' '),
            [data.request?.company_postal_code, data.request?.company_city].filter(Boolean).join(' ')
          ].filter(Boolean).join(', ');
          const clientAddrWithNip = clientAddr + (data.request?.nip ? `\nNIP: ${data.request.nip}` : '');

          setTitlePageData(prev => ({
            ...prev,
            title: prev.title || data.request?.investment_name || '',
            orderName: prev.orderName || data.request?.investment_name || '',
            orderAddress: prev.orderAddress || data.request?.address || '',
            clientName: prev.clientName || data.request?.client_name || '',
            clientAddress: prev.clientAddress || clientAddrWithNip,
            companyName: prev.companyName || currentCompany?.legal_name || currentCompany?.name || '',
            companyAddress: prev.companyAddress || [
              [currentCompany?.address_street].filter(Boolean).join(' '),
              [currentCompany?.address_postal_code, currentCompany?.address_city].filter(Boolean).join(' ')
            ].filter(Boolean).join(', '),
            contractorName: prev.contractorName || currentCompany?.legal_name || currentCompany?.name || '',
            contractorAddress: prev.contractorAddress || [
              [currentCompany?.address_street].filter(Boolean).join(' '),
              [currentCompany?.address_postal_code, currentCompany?.address_city].filter(Boolean).join(' ')
            ].filter(Boolean).join(', '),
            contractorNIP: prev.contractorNIP || currentCompany?.tax_id || '',
          }));
        }
      }
    } catch (error) {
      console.error('Error loading estimate:', error);
      showNotificationMessage('Nie udało się załadować kosztorysu', 'error');
    } finally {
      setLoading(false);
    }
  };

  const createNewEstimate = () => {
    const now = new Date().toISOString();
    const newEstimate: KosztorysCostEstimate = {
      id: '',
      company_id: currentUser?.company_id || '',
      created_by_id: currentUser?.id || '',
      settings: {
        type: 'contractor',
        name: 'Nowy kosztorys',
        description: '',
        created: now,
        modified: now,
        defaultCurrency: 'PLN',
        calculationTemplate: 'overhead-on-top',
        print: {
          pages: [],
          titlePage: {
            companyInfo: { name: '', address: '', contacts: [] },
            documentTitle: 'Kosztorys',
            showCostFields: true,
            showManHourRate: true,
            showOverheadsCosts: true,
            orderDetails: { orderName: '', constructionSiteAddress: '' },
            clientDetails: { clientName: '', clientAddress: '' },
            contractorDetails: { contractorName: '', contractorAddress: '', industry: '' },
            participants: {
              preparedBy: '',
              preparedAt: '',
              preparedByIndustry: '',
              checkedBy: '',
              checkedAt: '',
              checkedByIndustry: '',
            },
          },
        },
        precision: {
          norms: 6,
          resources: 2,
          measurements: 2,
          unitValues: 2,
          positionBase: 2,
          costEstimateBase: 2,
          roundingMethod: 'default',
        },
      },
      data: createEmptyEstimateData(),
      totalLabor: 0,
      totalMaterial: 0,
      totalEquipment: 0,
      totalOverhead: 0,
      totalValue: 0,
      created_at: now,
      updated_at: now,
    };

    setEstimate(newEstimate);
    setEstimateData(newEstimate.data);
    setLoading(false);
  };

  const showNotificationMessage = (message: string, type: 'success' | 'error' | 'warning') => {
    setNotification({ type: type === 'warning' ? 'error' : type, message });
    setTimeout(() => setNotification(null), 4000);
  };

  // --- Custom price list helpers ---

  const loadUserPriceSources = async () => {
    const companyId = currentUser?.company_id;

    // Load all price sources (for import dropdown)
    const { data: allData } = await supabase
      .from('price_sources')
      .select('id, name')
      .eq('is_active', true)
      .order('name');
    if (allData) {
      setAllPriceSources(allData);
      if (!priceImportSource && allData.length > 0) {
        setPriceImportSource(allData[0].id);
      }
    }

    // Load only user's custom price sources
    let query = supabase
      .from('price_sources')
      .select('id, name')
      .eq('is_system', false)
      .eq('is_active', true);
    if (companyId) {
      query = query.eq('company_id', companyId);
    }
    const { data, error } = await query;
    if (!error && data) {
      setUserPriceSources(data);
    }
  };

  const handleCustomPriceListItemUpdate = (
    tab: CustomPriceListTab,
    itemId: string,
    field: keyof CustomPriceListItem,
    value: string | number | boolean
  ) => {
    setCustomPriceList(prev => {
      const tabItems = [...prev.items[tab]];
      const itemIndex = tabItems.findIndex(item => item.id === itemId);
      if (itemIndex === -1) return prev;

      const updatedItem = { ...tabItems[itemIndex], [field]: value };

      const hasRequiredFields =
        updatedItem.name.trim() !== '' &&
        updatedItem.unit.trim() !== '' &&
        updatedItem.price > 0 &&
        (updatedItem.autoIndex || updatedItem.rms_index.trim() !== '');

      if (!updatedItem.isActive && hasRequiredFields) {
        updatedItem.isActive = true;
        if (updatedItem.autoIndex) {
          const activeCount = tabItems.filter(i => i.isActive).length + 1;
          updatedItem.rms_index = generateAutoIndex(tab, activeCount);
        }
        tabItems[itemIndex] = updatedItem;
        tabItems.push(createEmptyPriceListItem());
      } else {
        tabItems[itemIndex] = updatedItem;
      }

      return { ...prev, items: { ...prev.items, [tab]: tabItems } };
    });
  };

  const handleDeletePriceListItem = (tab: CustomPriceListTab, itemId: string) => {
    setCustomPriceList(prev => {
      const tabItems = prev.items[tab].filter(item => item.id !== itemId);
      if (tabItems.length === 0 || tabItems[tabItems.length - 1].isActive) {
        tabItems.push(createEmptyPriceListItem());
      }
      return { ...prev, items: { ...prev.items, [tab]: tabItems } };
    });
  };

  const handleSaveCustomPriceList = async () => {
    if (!customPriceList.name.trim()) {
      showNotificationMessage('Wprowadź nazwę cennika', 'warning');
      return;
    }

    const allActiveItems = [
      ...customPriceList.items.robocizna.filter(i => i.isActive).map(i => ({ ...i, rms_type: 'R' })),
      ...customPriceList.items.materialy.filter(i => i.isActive).map(i => ({ ...i, rms_type: 'M' })),
      ...customPriceList.items.sprzet.filter(i => i.isActive).map(i => ({ ...i, rms_type: 'S' })),
    ];

    if (allActiveItems.length === 0) {
      showNotificationMessage('Dodaj co najmniej jedną pozycję do cennika', 'warning');
      return;
    }

    setCustomPriceListSaving(true);

    try {
      let sourceId: string;

      if (editingPriceSourceId) {
        // Update existing price source
        const { error: updateError } = await supabase
          .from('price_sources')
          .update({
            name: customPriceList.name,
            description: `Cennik własny: ${customPriceList.name}`,
          })
          .eq('id', editingPriceSourceId);

        if (updateError) throw updateError;
        sourceId = editingPriceSourceId;

        // Delete old prices and re-insert
        const { error: delError } = await supabase
          .from('resource_prices')
          .delete()
          .eq('price_source_id', editingPriceSourceId);

        if (delError) throw delError;

        // Update local list name
        setUserPriceSources(prev => prev.map(p =>
          p.id === editingPriceSourceId ? { ...p, name: customPriceList.name } : p
        ));
      } else {
        // Create new price source
        const { data: priceSource, error: sourceError } = await supabase
          .from('price_sources')
          .insert({
            name: customPriceList.name,
            source_type: 'custom',
            is_system: false,
            company_id: currentUser?.company_id || null,
            is_active: true,
            description: `Cennik własny: ${customPriceList.name}`,
          })
          .select('id')
          .single();

        if (sourceError) throw sourceError;
        sourceId = priceSource.id;

        setUserPriceSources(prev => [...prev, { id: sourceId, name: customPriceList.name }]);
        setSelectedPriceSources(prev => [...prev, sourceId]);
      }

      const priceRows = allActiveItems.map(item => ({
        price_source_id: sourceId,
        rms_index: item.rms_index,
        rms_type: item.rms_type,
        name: item.name,
        unit: item.unit,
        min_price: item.price,
        avg_price: item.price,
        max_price: item.price,
      }));

      const { error: pricesError } = await supabase
        .from('resource_prices')
        .insert(priceRows);

      if (pricesError) throw pricesError;

      showNotificationMessage(editingPriceSourceId ? 'Cennik został zaktualizowany' : 'Cennik został utworzony pomyślnie', 'success');
      setShowCustomPriceListModal(false);
      setCustomPriceList(initialCustomPriceList);
      setEditingPriceSourceId(null);
    } catch (error) {
      console.error('Error saving custom price list:', error);
      showNotificationMessage('Błąd podczas zapisywania cennika', 'error');
    } finally {
      setCustomPriceListSaving(false);
    }
  };

  const handleEditPriceSource = async (psId: string) => {
    try {
      const { data: prices, error } = await supabase
        .from('resource_prices')
        .select('*')
        .eq('price_source_id', psId);

      if (error) throw error;

      const ps = userPriceSources.find(p => p.id === psId);
      const items: CustomPriceListState['items'] = {
        robocizna: [],
        materialy: [],
        sprzet: [],
      };

      (prices || []).forEach(p => {
        const item: CustomPriceListItem = {
          id: p.id,
          rms_index: p.rms_index || '',
          autoIndex: false,
          name: p.name || '',
          category: '',
          unit: p.unit || '',
          price: parseFloat(p.avg_price) || 0,
          comment: '',
          isActive: true,
        };
        if (p.rms_type === 'R') items.robocizna.push(item);
        else if (p.rms_type === 'M') items.materialy.push(item);
        else if (p.rms_type === 'S') items.sprzet.push(item);
      });

      // Add empty placeholder rows
      items.robocizna.push(createEmptyPriceListItem());
      items.materialy.push(createEmptyPriceListItem());
      items.sprzet.push(createEmptyPriceListItem());

      setCustomPriceList({ name: ps?.name || 'Cennik', items });
      setEditingPriceSourceId(psId);
      setCustomPriceListTab('robocizna');
      setShowCustomPriceListModal(true);
    } catch (error) {
      console.error('Error loading price source:', error);
      showNotificationMessage('Błąd podczas ładowania cennika', 'error');
    }
  };

  const handleDeletePriceSource = async (psId: string) => {
    try {
      const { error } = await supabase
        .from('price_sources')
        .delete()
        .eq('id', psId);

      if (error) throw error;

      setUserPriceSources(prev => prev.filter(p => p.id !== psId));
      setSelectedPriceSources(prev => prev.filter(s => s !== psId));
      setDeletingPriceSourceId(null);
      setDeletingPriceSourceName('');

      // Close editor if deleting the one being edited
      if (editingPriceSourceId === psId) {
        setShowCustomPriceListModal(false);
        setCustomPriceList(initialCustomPriceList);
        setEditingPriceSourceId(null);
      }

      showNotificationMessage('Cennik został usunięty', 'success');
    } catch (error) {
      console.error('Error deleting price source:', error);
      showNotificationMessage('Błąd podczas usuwania cennika', 'error');
    }
  };

  // Apply prices to resources based on settings
  const handleApplyPrices = async () => {
    const settings = priceUpdateSettings;
    const newData = { ...estimateData };
    let updatedCount = 0;
    let skippedCount = 0;

    // Determine which resource types to update
    const typesToUpdate: KosztorysResourceType[] = [];
    if (settings.skipStepProcess) {
      // Auto mode: apply to all resource types
      typesToUpdate.push('labor', 'material', 'equipment', 'waste');
    } else {
      if (settings.applyToLabor) typesToUpdate.push('labor');
      if (settings.applyToMaterial) typesToUpdate.push('material');
      if (settings.applyToEquipment) typesToUpdate.push('equipment');
      if (settings.applyToWaste) typesToUpdate.push('waste');
    }

    if (typesToUpdate.length === 0 && !settings.unitPositionPrices) {
      showNotificationMessage('Wybierz co najmniej jeden typ nakładu do aktualizacji', 'warning');
      return;
    }

    // Build list of price source IDs to query
    const sourceIds: string[] = [];
    if (selectedPriceSources.includes('system')) {
      sourceIds.push('00000000-0000-0000-0000-000000000001');
    }
    selectedPriceSources.forEach(s => {
      if (s !== 'system' && s !== 'kartoteka') sourceIds.push(s);
    });

    if (sourceIds.length === 0 && !selectedPriceSources.includes('kartoteka')) {
      showNotificationMessage('Wybierz co najmniej jedno źródło cen', 'warning');
      return;
    }

    // Fetch prices from database for all selected sources
    const { data: prices, error: pricesError } = await supabase
      .from('resource_prices')
      .select('*')
      .in('price_source_id', sourceIds);

    if (pricesError) {
      console.error('Error fetching prices:', pricesError);
      showNotificationMessage('Błąd podczas pobierania cen z bazy danych', 'error');
      return;
    }

    // Create price lookup by index
    const priceByIndex = new Map<string, { min: number; avg: number; max: number }>();
    const priceByName = new Map<string, { min: number; avg: number; max: number }>();
    prices?.forEach(p => {
      const priceData = { min: p.min_price || 0, avg: p.avg_price || 0, max: p.max_price || 0 };
      if (p.rms_index) priceByIndex.set(p.rms_index, priceData);
      if (p.name) priceByName.set(p.name.toLowerCase(), priceData);
    });

    // Add kartoteka prices from own catalogs (don't overwrite existing)
    if (selectedPriceSources.includes('kartoteka')) {
      try {
        const [kLabour, kMat, kEq] = await Promise.all([
          supabase.from('kosztorys_own_labours').select('code, name, price').eq('company_id', currentUser?.company_id || '').eq('is_active', true),
          supabase.from('kosztorys_materials').select('code, name, default_price').eq('company_id', currentUser?.company_id || '').eq('is_active', true),
          supabase.from('kosztorys_equipment').select('code, name, default_price').eq('company_id', currentUser?.company_id || '').eq('is_active', true),
        ]);
        const addKartotekaPrice = (code: string | undefined, name: string | undefined, price: number | undefined) => {
          if (!price || price === 0) return;
          const pd = { min: price, avg: price, max: price };
          if (code && !priceByIndex.has(code)) priceByIndex.set(code, pd);
          if (name && !priceByName.has(name.toLowerCase())) priceByName.set(name.toLowerCase(), pd);
        };
        (kLabour.data || []).forEach((l: any) => addKartotekaPrice(l.code, l.name, l.price));
        (kMat.data || []).forEach((m: any) => addKartotekaPrice(m.code, m.name, m.default_price));
        (kEq.data || []).forEach((e: any) => addKartotekaPrice(e.code, e.name, e.default_price));
      } catch (err) {
        console.error('Error loading kartoteka prices:', err);
      }
    }

    // Update resources in all positions
    Object.values(newData.positions).forEach(position => {
      position.resources.forEach(resource => {
        // Check if this resource type should be updated
        if (!typesToUpdate.includes(resource.type)) return;

        // Check if we should only update zero prices
        if (settings.onlyZeroPrices && resource.unitPrice.value !== 0) {
          skippedCount++;
          return;
        }

        // Try to find price by index (check both resource.index and originIndex.index)
        let foundPrice: { min: number; avg: number; max: number } | undefined;
        const resourceIndex = resource.index || resource.originIndex?.index || '';

        if (resourceIndex) {
          foundPrice = priceByIndex.get(resourceIndex);
        }

        // If not found by index and option enabled, try by name
        if (!foundPrice && searchByNameWhenNoIndex && resource.name) {
          foundPrice = priceByName.get(resource.name.toLowerCase());
        }

        // If searching all index types is enabled, try without prefix
        if (!foundPrice && searchAllIndexTypes && resourceIndex) {
          const indexParts = resourceIndex.split('-');
          if (indexParts.length > 1) {
            foundPrice = priceByIndex.get(indexParts[indexParts.length - 1]);
          }
        }

        if (foundPrice) {
          // Select price based on settings
          let priceToUse = foundPrice.avg;
          if (autoSelectLowestPrice) {
            priceToUse = foundPrice.min;
          }

          // Check unit match if required
          if (matchUnits) {
            // For now, we'll skip unit matching since we don't have unit data in resource_prices
            // In a full implementation, we'd check if units match
          }

          resource.unitPrice.value = priceToUse;
          updatedCount++;
        } else if (zeroNotFoundPrices) {
          resource.unitPrice.value = 0;
          updatedCount++;
        } else {
          skippedCount++;
        }
      });
    });

    setEstimateData(newData);
    showNotificationMessage(
      `Zaktualizowano ${updatedCount} cen. Pominięto: ${skippedCount}`,
      updatedCount > 0 ? 'success' : 'warning'
    );
    setShowCenyDialog(false);
  };

  // Change prices based on expression (Zmień ceny tab)
  const handleChangePrices = () => {
    const settings = priceUpdateSettings;
    const newData = { ...estimateData };
    let updatedCount = 0;

    const typesToUpdate: KosztorysResourceType[] = [];
    if (settings.applyToLabor) typesToUpdate.push('labor');
    if (settings.applyToMaterial) typesToUpdate.push('material');
    if (settings.applyToEquipment) typesToUpdate.push('equipment');
    if (settings.applyToWaste) typesToUpdate.push('waste');

    if (typesToUpdate.length === 0) {
      showNotificationMessage('Wybierz co najmniej jeden typ nakładu do zmiany', 'warning');
      return;
    }

    // Zero all prices if checkbox is checked — no expression needed
    if (settings.zeroPrices) {
      Object.values(newData.positions).forEach(position => {
        position.resources.forEach(resource => {
          if (typesToUpdate.includes(resource.type)) {
            resource.unitPrice.value = 0;
            updatedCount++;
          }
        });
      });
    } else {
      // Validate expression value
      const value = parseFloat(settings.expression.value);
      if (isNaN(value)) {
        showNotificationMessage('Podaj prawidłową wartość', 'warning');
        return;
      }

      // Apply expression to prices
      Object.values(newData.positions).forEach(position => {
        position.resources.forEach(resource => {
          if (!typesToUpdate.includes(resource.type)) return;

          const currentPrice = settings.expression.field === 'cena'
            ? resource.unitPrice.value
            : resource.unitPrice.value * (resource.norm?.value || 1);

          let newPrice = currentPrice;
          switch (settings.expression.operation) {
            case 'add': newPrice = currentPrice + value; break;
            case 'subtract': newPrice = currentPrice - value; break;
            case 'multiply': newPrice = currentPrice * value; break;
            case 'divide': newPrice = value !== 0 ? currentPrice / value : currentPrice; break;
          }

          if (settings.expression.field === 'cena') {
            resource.unitPrice.value = Math.max(0, newPrice);
          } else {
            // If changing value, calculate back to unit price
            const norm = resource.norm?.value || 1;
            resource.unitPrice.value = Math.max(0, newPrice / norm);
          }
          updatedCount++;
        });
      });
    }

    setEstimateData(newData);
    showNotificationMessage(`Zmieniono ${updatedCount} cen`, 'success');
    setShowCenyDialog(false);
  };

  // Populate resources from KNR catalog based on position base codes
  const handleUzupelnijNaklady = async (mode: 'missing' | 'replace') => {
    const newData = { ...estimateData };
    let updatedPositions = 0;
    let addedResources = 0;

    // Normalize KNR code to database format (e.g., "KNR 4-03 1003-02")
    // Handles slash format from PDFs: "KNR 403/1003/2" → "KNR 4-03 1003-02"
    // Handles compact format: "KNNR 5/102/5" → "KNNR 5 0102-05"
    const normalizeKnrCode = (code: string): string => {
      let c = code.trim();
      // Remove ordinal prefixes like "d.1", "d.1.1", "1.", "1.1." etc.
      c = c.replace(/^d\.\d+(\.\d+)*\s*/i, '');
      c = c.replace(/^\d+\.\d+\.\s*/, '');
      // Normalize multiple spaces to single
      c = c.replace(/\s+/g, ' ');

      // Handle slash-separated format: TYPE CATALOG/TABLE/VARIANT
      // e.g., "KNR 403/1003/2", "KNNR 5/102/5", "KNR-W 218/704/1"
      const slashMatch = c.match(/^(KNR-W|KNNR-W|KNR|KNNR|KSNR|KNP|NNRNKB)\s+(\d+)\/(\d+)\/(\d+)$/i);
      if (slashMatch) {
        const type = slashMatch[1].toUpperCase();
        const rawCatalog = slashMatch[2];
        const rawTable = slashMatch[3];
        const rawVariant = slashMatch[4];

        // Convert catalog: "403" → "4-03", "5" → "5", "218" → "2-18"
        let catalog: string;
        if (rawCatalog.length >= 3) {
          // First digit(s) = volume, last 2 = chapter: "403" → "4-03", "218" → "2-18"
          catalog = rawCatalog.slice(0, -2) + '-' + rawCatalog.slice(-2);
        } else {
          catalog = rawCatalog;
        }

        // Pad table to 4 digits, variant to 2 digits
        const table = rawTable.padStart(4, '0');
        const variant = rawVariant.padStart(2, '0');

        return `${type} ${catalog} ${table}-${variant}`;
      }

      // Handle space-separated slash: "KNR 4-03 1003/02" → "KNR 4-03 1003-02"
      c = c.replace(/(\d{4})\/(\d{2})/, '$1-$2');
      return c;
    };

    // Get all positions with KNR base codes
    const positionsWithBase = Object.values(newData.positions).filter(pos => pos.base && pos.base.trim());

    if (positionsWithBase.length === 0) {
      showNotificationMessage('Brak pozycji z powiązaniem KNR do uzupełnienia', 'warning');
      return;
    }

    // Get unique base codes (both original and normalized)
    const rawCodes = [...new Set(positionsWithBase.map(p => p.base?.trim()))].filter(Boolean) as string[];
    const normalizedCodes = [...new Set(rawCodes.map(normalizeKnrCode))].filter(Boolean);
    const allCodesToSearch = [...new Set([...rawCodes, ...normalizedCodes])].filter(Boolean);

    console.log('[Uzupełnij] Searching for codes:', allCodesToSearch);

    // Fetch KNR positions from database by basis (code) — try exact match first
    const { data: knrPositions, error: knrError } = await supabase
      .from('knr_positions')
      .select('xid, basis, name, unit')
      .in('basis', allCodesToSearch);

    if (knrError) {
      console.error('Error fetching KNR positions:', knrError);
      showNotificationMessage('Błąd podczas pobierania danych z katalogu KNR', 'error');
      return;
    }

    // If no exact matches, try ILIKE search for each code
    let allKnrPositions = knrPositions || [];
    if (allKnrPositions.length === 0 && normalizedCodes.length > 0) {
      console.log('[Uzupełnij] No exact matches, trying fuzzy search...');
      // Try searching with ILIKE for each code (handles spacing differences)
      const fuzzyResults: any[] = [];
      for (const code of normalizedCodes.slice(0, 50)) {
        // Build a pattern: replace spaces with flexible whitespace matching
        const likePattern = code.replace(/\s+/g, '%');
        const { data: fuzzy } = await supabase
          .from('knr_positions')
          .select('xid, basis, name, unit')
          .ilike('basis', likePattern)
          .limit(1);
        if (fuzzy && fuzzy.length > 0) fuzzyResults.push(fuzzy[0]);
      }
      if (fuzzyResults.length > 0) {
        allKnrPositions = fuzzyResults;
        console.log(`[Uzupełnij] Fuzzy search found ${fuzzyResults.length} matches`);
      }
    }

    if (allKnrPositions.length === 0) {
      const sampleCodes = rawCodes.slice(0, 5).join(', ');
      console.warn('[Uzupełnij] No KNR positions found. Sample codes searched:', sampleCodes);
      showNotificationMessage(`Nie znaleziono pozycji KNR dla podanych kodów (np. ${sampleCodes})`, 'warning');
      return;
    }

    // Create map of KNR positions by basis code (both exact and normalized)
    const knrByBasis = new Map<string, any>();
    allKnrPositions.forEach(kp => {
      knrByBasis.set(kp.basis, kp);
      knrByBasis.set(normalizeKnrCode(kp.basis), kp);
    });

    // Get all KNR position xids
    const knrXids = allKnrPositions.map(kp => kp.xid);

    // Fetch resources for these KNR positions
    const { data: knrResources, error: resError } = await supabase
      .from('knr_position_resources')
      .select('*')
      .in('position_xid', knrXids)
      .order('ordinal_number', { ascending: true });

    if (resError) {
      console.error('Error fetching KNR resources:', resError);
      showNotificationMessage('Błąd podczas pobierania nakładów z katalogu KNR', 'error');
      return;
    }

    // Group resources by position_xid
    const resourcesByXid = new Map<string, any[]>();
    (knrResources || []).forEach(res => {
      const existing = resourcesByXid.get(res.position_xid) || [];
      existing.push(res);
      resourcesByXid.set(res.position_xid, existing);
    });

    // Update each position with matching KNR code
    Object.values(newData.positions).forEach(position => {
      if (!position.base || !position.base.trim()) return;

      const rawBase = position.base.trim();
      const knrPosition = knrByBasis.get(rawBase) || knrByBasis.get(normalizeKnrCode(rawBase));
      if (!knrPosition) return;

      const knrRes = resourcesByXid.get(knrPosition.xid) || [];
      if (knrRes.length === 0) return;

      let positionUpdated = false;

      if (mode === 'replace') {
        // Clear existing resources
        position.resources = [];
      }

      // Add resources from KNR
      knrRes.forEach(res => {
        const resourceType: KosztorysResourceType =
          res.type === 'R' ? 'labor' :
          res.type === 'M' ? 'material' : 'equipment';

        // For "missing" mode, check if this specific resource already exists
        if (mode === 'missing') {
          const existingResource = position.resources.find(r => {
            // Check by index if available
            if (res.rms_index && r.index === res.rms_index) return true;
            // Check by name and type
            if (r.name === res.rms_name && r.type === resourceType) return true;
            return false;
          });
          if (existingResource) {
            // Resource already exists, skip
            return;
          }
        }

        // Find unit
        const unitMatch = UNITS_REFERENCE.find(u => u.unit === res.rms_unit);

        const newResource = createNewResource(
          resourceType,
          res.rms_name || '',
          parseFloat(res.norm) || 0,
          0, // Price - will be set separately
          res.rms_unit || 'szt.',
          unitMatch?.index || '020'
        );

        // Set index for price lookup
        if (res.rms_index) {
          newResource.index = res.rms_index;
          newResource.originIndex = { type: 'knr', index: res.rms_index };
        }

        position.resources.push(newResource);
        addedResources++;
        positionUpdated = true;
      });

      if (positionUpdated) {
        updatedPositions++;
      }
    });

    if (addedResources === 0) {
      showNotificationMessage(
        mode === 'missing'
          ? 'Wszystkie nakłady KNR już są uzupełnione'
          : 'Nie znaleziono nakładów do dodania',
        'warning'
      );
      return;
    }

    setEstimateData(newData);
    showNotificationMessage(
      `Uzupełniono ${updatedPositions} pozycji, dodano ${addedResources} nakładów`,
      'success'
    );
  };

  // Save estimate
  const handleSave = async () => {
    if (!estimate || !currentUser) return;
    setSaving(true);

    try {
      const totals = calculationResult || {
        totalLabor: 0,
        totalMaterial: 0,
        totalEquipment: 0,
        totalOverheads: 0,
        totalValue: 0,
      };

      // Save to existing kosztorys_estimates table
      if (estimate.id) {
        // Calculate VAT
        const subtotalNet = totals.totalLabor + totals.totalMaterial + totals.totalEquipment;
        const vatRate = estimate.settings?.vatRate ?? 23;
        const vatAmount = vatRate < 0 ? 0 : subtotalNet * (vatRate / 100);
        const totalGross = subtotalNet + vatAmount;

        const { error } = await supabase
          .from('kosztorys_estimates')
          .update({
            total_works: totals.totalLabor,
            total_materials: totals.totalMaterial,
            total_equipment: totals.totalEquipment,
            subtotal_net: subtotalNet,
            vat_amount: vatAmount,
            total_gross: totalGross,
            data_json: estimateData, // Save full estimate data as JSON
            updated_at: new Date().toISOString(),
          })
          .eq('id', estimate.id);

        if (error) throw error;

        // Also update/sync individual items
        // Delete existing items and recreate from positions
        await supabase
          .from('kosztorys_estimate_items')
          .delete()
          .eq('estimate_id', estimate.id);

        // Insert new items from positions
        const itemsToInsert = Object.values(estimateData.positions).map((pos, index) => {
          const posResult = calculationResult?.positions[pos.id];
          const laborResource = pos.resources.find(r => r.type === 'labor');
          const materialResource = pos.resources.find(r => r.type === 'material');

          return {
            estimate_id: estimate.id,
            position_number: index + 1,
            room_group: pos.marker || '',
            installation_element: '',
            task_description: pos.name,
            material_name: materialResource?.name || null,
            unit_id: 1,
            quantity: posResult?.quantity || 0,
            unit_price_work: laborResource?.unitPrice.value || 0,
            total_work: posResult?.laborTotal || 0,
            unit_price_material: materialResource?.unitPrice.value || 0,
            total_material: posResult?.materialTotal || 0,
            total_item: (posResult?.laborTotal || 0) + (posResult?.materialTotal || 0),
            source: 'manual',
            is_deleted: false,
          };
        });

        if (itemsToInsert.length > 0) {
          const { error: itemsError } = await supabase
            .from('kosztorys_estimate_items')
            .insert(itemsToInsert);

          if (itemsError) console.error('Error saving items:', itemsError);
        }
      } else {
        // Creating new estimate - show notification that save is not supported for new estimates yet
        showNotificationMessage('Tworzenie nowych kosztorysów z edytora nie jest jeszcze obsługiwane. Utwórz kosztorys przez formularz.', 'error');
        setSaving(false);
        return;
      }

      setEditorState(prev => ({ ...prev, isDirty: false, lastSaved: new Date().toISOString() }));
      showNotificationMessage('Kosztorys zapisany', 'success');
    } catch (error: any) {
      console.error('Error saving estimate:', error);
      showNotificationMessage(error.message || 'Błąd podczas zapisywania', 'error');
    } finally {
      setSaving(false);
    }
  };

  // Helper: populate offer sections & items from estimate data
  const populateOfferFromEstimate = async (offerId: string) => {
    for (const [sIdx, sectionId] of estimateData.root.sectionIds.entries()) {
      const section = estimateData.sections[sectionId];
      if (!section) continue;

      const { data: newSection } = await supabase
        .from('offer_sections')
        .insert({
          offer_id: offerId,
          name: section.name,
          sort_order: sIdx
        })
        .select()
        .single();

      if (newSection) {
        for (const [pIdx, posId] of section.positionIds.entries()) {
          const position = estimateData.positions[posId];
          if (!position) continue;
          const posResult = calculationResult?.positions[posId];
          const quantity = posResult?.quantity || 0;
          const unitCost = posResult?.unitCost || 0;

          await supabase
            .from('offer_items')
            .insert({
              offer_id: offerId,
              section_id: newSection.id,
              name: position.name,
              description: position.base,
              quantity: quantity,
              unit_price: unitCost,
              sort_order: pIdx,
              is_optional: false
            });
        }
      }
    }
  };

  // Helper: create a new offer from estimate
  const createNewOfferFromEstimate = async () => {
    if (!estimate || !currentUser) return;

    try {
      const countRes = await supabase
        .from('offers')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', currentUser.company_id);
      const nextNum = (countRes.count || 0) + 1;
      const offerNumber = `OFR-${new Date().getFullYear()}-${String(nextNum).padStart(4, '0')}`;

      const vatRate = estimate.settings?.vatRate ?? 23;
      const isExempt = vatRate < 0;
      const totalNet = calculationResult?.totalValue || 0;
      const vatAmount = isExempt ? 0 : totalNet * (vatRate / 100);
      const totalGross = totalNet + vatAmount;

      const { data: newOffer, error: offerError } = await supabase
        .from('offers')
        .insert({
          company_id: currentUser.company_id,
          name: `Oferta - ${estimate.settings.name || 'Kosztorys'}`,
          number: offerNumber,
          status: 'draft',
          total_amount: totalNet,
          discount_percent: 0,
          discount_amount: 0,
          final_amount: totalGross,
          valid_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          notes: `Wygenerowano z kosztorysu: ${estimate.settings.name}`,
          internal_notes: `kosztorys_source:${estimate.id}`,
          created_by_id: currentUser.id
        })
        .select()
        .single();

      if (offerError) throw offerError;

      await populateOfferFromEstimate(newOffer.id);

      showNotificationMessage('Oferta została utworzona', 'success');
      navigate(`/construction/offers?offerId=${newOffer.id}`);
    } catch (error: any) {
      console.error('Error creating offer:', error);
      showNotificationMessage('Błąd podczas tworzenia oferty', 'error');
    }
  };

  // Helper: update existing offer with current estimate data
  const updateExistingOfferFromEstimate = async () => {
    if (!estimate || !currentUser || !existingOfferId) return;

    try {
      const vatRate = estimate.settings?.vatRate ?? 23;
      const isExempt = vatRate < 0;
      const totalNet = calculationResult?.totalValue || 0;
      const vatAmount = isExempt ? 0 : totalNet * (vatRate / 100);
      const totalGross = totalNet + vatAmount;

      // Update offer totals
      await supabase
        .from('offers')
        .update({
          name: `Oferta - ${estimate.settings.name || 'Kosztorys'}`,
          total_amount: totalNet,
          final_amount: totalGross,
          notes: `Wygenerowano z kosztorysu: ${estimate.settings.name} (zaktualizowano)`
        })
        .eq('id', existingOfferId);

      // Delete old sections and items
      await supabase.from('offer_items').delete().eq('offer_id', existingOfferId);
      await supabase.from('offer_sections').delete().eq('offer_id', existingOfferId);

      // Recreate from current estimate
      await populateOfferFromEstimate(existingOfferId);

      setShowOfferUpdateConfirm(false);
      setShowOfferExistsModal(false);
      showNotificationMessage('Oferta została zaktualizowana', 'success');
      navigate(`/construction/offers?offerId=${existingOfferId}`);
    } catch (error: any) {
      console.error('Error updating offer:', error);
      showNotificationMessage('Błąd podczas aktualizacji oferty', 'error');
    }
  };

  // Create offer from estimate - with existence check
  const handleCreateOfferFromEstimate = async () => {
    if (!estimate || !currentUser) return;

    await handleSave();

    try {
      // Check if an offer already exists for this estimate
      const { data: existingOffers } = await supabase
        .from('offers')
        .select('id, name, number')
        .eq('company_id', currentUser.company_id)
        .is('deleted_at', null)
        .like('internal_notes', `kosztorys_source:${estimate.id}%`);

      if (existingOffers && existingOffers.length > 0) {
        // Offer already exists - show modal
        setExistingOfferId(existingOffers[0].id);
        setExistingOfferName(existingOffers[0].number ? `${existingOffers[0].number} - ${existingOffers[0].name}` : existingOffers[0].name);
        setShowOfferExistsModal(true);
      } else {
        // No existing offer - create new one directly
        await createNewOfferFromEstimate();
      }
    } catch (error: any) {
      console.error('Error checking existing offers:', error);
      await createNewOfferFromEstimate();
    }
  };

  // Helper: populate gantt tasks and dependencies for a given project
  const populateGanttFromEstimate = async (projectId: string) => {
    const startDate = new Date();
    let currentDate = new Date(startDate);
    let sortOrder = 0;

    // Create tasks from sections and positions
    for (const [sIdx, sectionId] of estimateData.root.sectionIds.entries()) {
      const section = estimateData.sections[sectionId];
      if (!section) continue;

      const sectionStart = new Date(currentDate);

      // Create parent task for section
      const { data: sectionTask } = await supabase
        .from('gantt_tasks')
        .insert({
          project_id: projectId,
          title: `${sIdx + 1}. ${section.name}`,
          start_date: currentDate.toISOString().split('T')[0],
          end_date: currentDate.toISOString().split('T')[0],
          duration: 0,
          progress: 0,
          color: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'][sIdx % 5],
          is_milestone: false,
          source: 'estimate',
          sort_order: sortOrder++
        })
        .select()
        .single();

      let sectionEndDate = new Date(currentDate);

      // Create child tasks for positions
      for (const [pIdx, posId] of section.positionIds.entries()) {
        const position = estimateData.positions[posId];
        if (!position) continue;
        const posResult = calculationResult?.positions[posId];
        const quantity = posResult?.quantity || 0;

        // Estimate duration: base 1 day, +1 per 10 units of quantity
        const duration = Math.max(1, Math.ceil(quantity / 10));
        const posStart = new Date(currentDate);
        const posEnd = new Date(posStart);
        posEnd.setDate(posEnd.getDate() + duration);

        const { error: posError } = await supabase
          .from('gantt_tasks')
          .insert({
            project_id: projectId,
            parent_id: sectionTask?.id || null,
            title: position.name,
            start_date: posStart.toISOString().split('T')[0],
            end_date: posEnd.toISOString().split('T')[0],
            duration: duration,
            progress: 0,
            color: sectionTask?.color || '#3b82f6',
            is_milestone: false,
            source: 'estimate',
            sort_order: sortOrder++
          });
        if (posError) console.error('Error inserting position task:', posError);

        // Move current date forward (positions sequential within section)
        currentDate = new Date(posEnd);
        if (currentDate > sectionEndDate) {
          sectionEndDate = new Date(currentDate);
        }
      }

      // Update section task end date
      if (sectionTask) {
        const sectionDuration = Math.max(1, Math.round((sectionEndDate.getTime() - sectionStart.getTime()) / (1000 * 60 * 60 * 24)));
        await supabase
          .from('gantt_tasks')
          .update({
            end_date: sectionEndDate.toISOString().split('T')[0],
            duration: sectionDuration
          })
          .eq('id', sectionTask.id);
      }
    }

    // Handle root-level positions (not in any section)
    if (estimateData.root.positionIds && estimateData.root.positionIds.length > 0) {
      const rootStart = new Date(currentDate);
      const { data: rootTask } = await supabase
        .from('gantt_tasks')
        .insert({
          project_id: projectId,
          title: 'Inne pozycje',
          start_date: currentDate.toISOString().split('T')[0],
          end_date: currentDate.toISOString().split('T')[0],
          duration: 0,
          progress: 0,
          color: '#6b7280',
          is_milestone: false,
          source: 'estimate',
          sort_order: sortOrder++
        })
        .select()
        .single();

      let rootEndDate = new Date(currentDate);
      for (const posId of estimateData.root.positionIds) {
        const position = estimateData.positions[posId];
        if (!position) continue;
        const posResult = calculationResult?.positions[posId];
        const quantity = posResult?.quantity || 0;
        const duration = Math.max(1, Math.ceil(quantity / 10));
        const posStart = new Date(currentDate);
        const posEnd = new Date(posStart);
        posEnd.setDate(posEnd.getDate() + duration);

        const { error: rpErr } = await supabase
          .from('gantt_tasks')
          .insert({
            project_id: projectId,
            parent_id: rootTask?.id || null,
            title: position.name,
            start_date: posStart.toISOString().split('T')[0],
            end_date: posEnd.toISOString().split('T')[0],
            duration: duration,
            progress: 0,
            color: rootTask?.color || '#6b7280',
            is_milestone: false,
            source: 'estimate',
            sort_order: sortOrder++
          });
        if (rpErr) console.error('Error inserting root position task:', rpErr);

        currentDate = new Date(posEnd);
        if (currentDate > rootEndDate) rootEndDate = new Date(currentDate);
      }

      if (rootTask) {
        const rootDuration = Math.max(1, Math.round((rootEndDate.getTime() - rootStart.getTime()) / (1000 * 60 * 60 * 24)));
        await supabase
          .from('gantt_tasks')
          .update({ end_date: rootEndDate.toISOString().split('T')[0], duration: rootDuration })
          .eq('id', rootTask.id);
      }
    }

    // Add finish milestone
    await supabase
      .from('gantt_tasks')
      .insert({
        project_id: projectId,
        title: 'Zakończenie projektu',
        start_date: currentDate.toISOString().split('T')[0],
        end_date: currentDate.toISOString().split('T')[0],
        duration: 0,
        progress: 0,
        color: '#ef4444',
        is_milestone: true,
        source: 'milestone',
        sort_order: sortOrder++
      });

    // Add FS dependencies between sections
    const { data: allTasks } = await supabase
      .from('gantt_tasks')
      .select('id, parent_id, sort_order')
      .eq('project_id', projectId)
      .is('parent_id', null)
      .order('sort_order');

    if (allTasks && allTasks.length > 1) {
      for (let i = 1; i < allTasks.length; i++) {
        await supabase
          .from('gantt_dependencies')
          .insert({
            project_id: projectId,
            predecessor_id: allTasks[i - 1].id,
            successor_id: allTasks[i].id,
            dependency_type: 'FS'
          });
      }
    }
  };

  // Helper: create a brand new project + gantt from the estimate
  const createNewGanttFromEstimate = async () => {
    if (!estimate || !currentUser) return;

    try {
      // Create a project for this estimate
      const { data: newProject, error: projError } = await supabase
        .from('projects')
        .insert({
          company_id: currentUser.company_id,
          name: estimate.settings.name || 'Projekt kosztorysu',
          name_mode: 'custom',
          status: 'active',
          color: '#3b82f6',
          billing_type: 'ryczalt',
          description: `kosztorys_source:${estimate.id}`
        })
        .select()
        .single();

      if (projError) throw projError;

      await populateGanttFromEstimate(newProject.id);

      showNotificationMessage('Harmonogram został utworzony', 'success');
      navigate(`/construction/gantt?projectId=${newProject.id}`);
    } catch (error: any) {
      console.error('Error creating gantt:', error);
      showNotificationMessage('Błąd podczas tworzenia harmonogramu', 'error');
    }
  };

  // Helper: update existing project's gantt with current estimate data
  const updateExistingGanttFromEstimate = async () => {
    if (!estimate || !currentUser || !existingProjectId) return;

    try {
      // Delete old dependencies and tasks
      const { error: depDelErr } = await supabase.from('gantt_dependencies').delete().eq('project_id', existingProjectId);
      if (depDelErr) throw depDelErr;
      const { error: taskDelErr } = await supabase.from('gantt_tasks').delete().eq('project_id', existingProjectId);
      if (taskDelErr) throw taskDelErr;

      // Recreate from current estimate
      await populateGanttFromEstimate(existingProjectId);

      setShowGanttUpdateConfirm(false);
      setShowGanttExistsModal(false);
      showNotificationMessage('Harmonogram został zaktualizowany', 'success');
      navigate(`/construction/gantt?projectId=${existingProjectId}`);
    } catch (error: any) {
      console.error('Error updating gantt:', error);
      showNotificationMessage('Błąd podczas aktualizacji harmonogramu', 'error');
    }
  };

  // Create gantt schedule from estimate - with existence check
  const handleCreateGanttFromEstimate = async () => {
    if (!estimate || !currentUser) return;

    // Save first
    await handleSave();

    try {
      // Check if a project already exists for this estimate
      const { data: existingProjects } = await supabase
        .from('projects')
        .select('id, name')
        .eq('company_id', currentUser.company_id)
        .like('description', `kosztorys_source:${estimate.id}%`);

      if (existingProjects && existingProjects.length > 0) {
        // Project already exists - show modal
        setExistingProjectId(existingProjects[0].id);
        setExistingProjectName(existingProjects[0].name);
        setShowGanttExistsModal(true);
      } else {
        // No existing project - create new one directly
        await createNewGanttFromEstimate();
      }
    } catch (error: any) {
      console.error('Error checking existing projects:', error);
      await createNewGanttFromEstimate();
    }
  };

  // --- Import handlers ---
  const handleImportClick = () => {
    setShowModeDropdown(false);
    // Check if estimate has existing data
    const hasSections = estimateData.root.sectionIds.length > 0;
    const hasPositions = Object.keys(estimateData.positions).length > 0;
    if (hasSections || hasPositions) {
      setShowImportConfirmModal(true);
    } else {
      setImportFile(null);
      setImportError(null);
      setImportProgress('');
      setShowImportModal(true);
    }
  };

  const handleImportConfirm = () => {
    setShowImportConfirmModal(false);
    setImportFile(null);
    setImportError(null);
    setImportProgress('');
    setShowImportModal(true);
  };

  const handleImportFile = async (file: File) => {
    setImportLoading(true);
    setImportError(null);
    setImportProgress('Wczytywanie pliku...');

    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      let importedData: KosztorysCostEstimateData;

      if (ext === 'ath') {
        setImportProgress('Parsowanie pliku ATH...');
        const buffer = await file.arrayBuffer();
        importedData = parseAthFile(buffer);
      } else if (ext === 'json') {
        setImportProgress('Parsowanie pliku JSON...');
        const text = await file.text();
        importedData = parseJsonFile(text);
      } else if (ext === 'xml') {
        setImportProgress('Parsowanie pliku XML...');
        const text = await file.text();
        importedData = parseXmlFile(text);
      } else if (ext === 'xlsx' || ext === 'xls') {
        setImportProgress('Wczytywanie pliku Excel...');
        const buffer = await file.arrayBuffer();
        const preview = previewXlsxFile(buffer);
        setXlsxPreview(preview);
        setXlsxMapping({ ...preview.autoMapping });
        setXlsxAiLoading(true);
        setXlsxAiError(null);
        setXlsxAiStructure([]);
        setXlsxAiAnalysis(null);
        setImportLoading(false);
        setImportProgress('');

        // Launch AI analysis in background
        (async () => {
          try {
            // Send all rows to AI for structure analysis (compact format)
            const compactRows = preview.allRows.map(row =>
              (row || []).slice(0, 10).map((c: any) => String(c ?? '').trim().substring(0, 60))
            );
            const { data: aiData, error: aiErr } = await supabase.functions.invoke('xlsx-ai-analyze', {
              body: { rows: compactRows, sheetName: preview.activeSheet },
            });
            if (aiErr || !aiData?.success || !aiData.data) {
              console.error('AI analysis error:', aiErr || aiData);
              setXlsxAiError('AI nie mogło przeanalizować pliku. Użyj mapowania ręcznego.');
              setXlsxAiLoading(false);
              return;
            }
            const analysis: XlsxAiAnalysis = aiData.data;
            setXlsxAiAnalysis(analysis);
            setXlsxAiStructure(analysis.structure || []);
            // Update mapping from AI
            if (analysis.columns) {
              setXlsxMapping({
                colLp: analysis.columns.lp ?? -1,
                colBase: analysis.columns.base ?? -1,
                colName: analysis.columns.name ?? -1,
                colUnit: analysis.columns.unit ?? -1,
                colQty: analysis.columns.qty ?? -1,
                headerRowIdx: analysis.headerRow ?? 0,
              });
            }
          } catch (e: any) {
            console.error('AI analysis failed:', e);
            setXlsxAiError('Błąd analizy AI: ' + (e.message || 'nieznany'));
          }
          setXlsxAiLoading(false);
        })();

        return; // Exit — parsing happens after user confirms
      } else if (['pdf', 'jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
        setImportProgress('Przesyłanie do AI (Gemini)...');
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);

        const mimeMap: Record<string, string> = {
          pdf: 'application/pdf',
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          png: 'image/png',
          webp: 'image/webp',
        };

        setImportProgress('Analiza dokumentu przez AI...');
        const { data: funcData, error: funcError } = await supabase.functions.invoke('parse-kosztorys-document', {
          body: { fileBase64: base64, mimeType: mimeMap[ext] || 'application/pdf' },
        });

        if (funcError) throw new Error(funcError.message || 'Błąd wywołania funkcji AI');
        if (!funcData?.success) throw new Error(funcData?.error || 'AI nie zwróciło danych');

        setImportProgress('Konwertowanie wyników...');
        importedData = convertGeminiResponseToEstimate(funcData.data);
      } else {
        throw new Error(`Nieobsługiwany format pliku: .${ext}. Obsługiwane: .ath, .xlsx, .json, .xml, .pdf, .jpg, .png`);
      }

      // Count imported items
      const sectionCount = Object.keys(importedData.sections).length;
      const positionCount = Object.keys(importedData.positions).length;

      if (sectionCount === 0 && positionCount === 0) {
        throw new Error('Nie znaleziono żadnych działów ani pozycji w pliku');
      }

      // Check for positions without KNR
      const allPositions = Object.values(importedData.positions);
      const withKnr = allPositions.filter(p => p.base && p.base.trim());
      const withoutKnr = allPositions.filter(p => !p.base || !p.base.trim());

      if (withoutKnr.length > 0) {
        // Some positions lack KNR — show KNR import modal
        setKnrPendingData(importedData);
        setKnrImportStats({
          totalPositions: allPositions.length,
          positionsWithKnr: withKnr.length,
          positionsWithoutKnr: withoutKnr.length,
          foundInPortal: 0,
          foundByAi: 0,
          accepted: 0,
          rejected: 0,
        });
        setKnrImportStep('choice');
        setShowImportModal(false);
      } else {
        // All positions have KNR — import directly
        applyImportedData(importedData);
        setShowImportModal(false);
      }
    } catch (error: any) {
      console.error('Import error:', error);
      setImportError(error.message || 'Błąd podczas importu pliku');
    } finally {
      setImportLoading(false);
      setImportProgress('');
    }
  };

  // Apply imported data to editor
  const [applyingImport, setApplyingImport] = useState(false);

  const applyImportedData = (data: KosztorysCostEstimateData) => {
    const sc = Object.keys(data.sections).length;
    const pc = Object.keys(data.positions).length;

    // Show loading overlay immediately (high priority)
    setApplyingImport(true);
    setKnrImportStep(null);
    setKnrPendingData(null);

    // Use startTransition to make heavy state updates non-blocking
    // This lets the spinner render before React processes the data
    requestAnimationFrame(() => {
      startTransition(() => {
        // Keep all sections COLLAPSED to avoid rendering 600+ rows at once
        setEditorState(prev => ({
          ...prev,
          expandedSections: new Set<string>(),
          isDirty: true,
        }));
        setEstimateData(data);
        setViewMode('przedmiar');
        setActiveNavItem('przedmiar');
        setLeftPanelMode('overview');
      });
      // Give React time to commit the transition, then hide overlay
      setTimeout(() => {
        setApplyingImport(false);
        showNotificationMessage(`Zaimportowano ${sc} działów i ${pc} pozycji`, 'success');
      }, 300);
    });
  };

  // Compute text similarity (Sørensen–Dice coefficient) — fast fuzzy match
  const textSimilarity = (a: string, b: string): number => {
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-ząćęłńóśźż0-9]/g, ' ').replace(/\s+/g, ' ').trim();
    const na = normalize(a);
    const nb = normalize(b);
    if (na === nb) return 1;
    if (na.length < 2 || nb.length < 2) return 0;
    const bigrams = (s: string) => {
      const bg = new Set<string>();
      for (let i = 0; i < s.length - 1; i++) bg.add(s.substring(i, i + 2));
      return bg;
    };
    const bgA = bigrams(na);
    const bgB = bigrams(nb);
    let intersection = 0;
    bgA.forEach(bg => { if (bgB.has(bg)) intersection++; });
    return (2 * intersection) / (bgA.size + bgB.size);
  };

  // Process KNR lookup for positions without KNR
  const processKnrLookup = async (scope: 'all' | 'empty', manual: boolean) => {
    if (!knrPendingData) return;
    setKnrImportStep('processing');
    setKnrProcessingProgress(0);

    const allPositions = Object.values(knrPendingData.positions);
    const toProcess = scope === 'all'
      ? allPositions
      : allPositions.filter(p => !p.base || !p.base.trim());

    const reviewItems: KnrReviewItem[] = [];
    const stats: KnrImportStats = {
      totalPositions: allPositions.length,
      positionsWithKnr: allPositions.filter(p => p.base && p.base.trim()).length,
      positionsWithoutKnr: allPositions.filter(p => !p.base || !p.base.trim()).length,
      foundInPortal: 0,
      foundByAi: 0,
      accepted: 0,
      rejected: 0,
    };

    // Phase 1: Bulk-load KNR catalog from portal, then match client-side
    setKnrProcessingMsg('Pobieranie katalogu KNR z portalu...');
    setKnrProcessingProgress(5);

    // Load all KNR position names in one query (typically ~10-30k rows, basis+name only = small)
    let knrCatalog: { basis: string; name: string }[] = [];
    try {
      // Paginate: Supabase returns max 1000 rows per request
      let offset = 0;
      const pageSize = 5000;
      let hasMore = true;
      while (hasMore) {
        const { data, error } = await supabase
          .from('knr_positions')
          .select('basis, name')
          .range(offset, offset + pageSize - 1);
        if (error || !data || data.length === 0) { hasMore = false; break; }
        knrCatalog = knrCatalog.concat(data as any[]);
        setKnrProcessingMsg(`Pobieranie katalogu KNR: ${knrCatalog.length} pozycji...`);
        offset += pageSize;
        if (data.length < pageSize) hasMore = false;
      }
    } catch {
      // Continue even if catalog load fails — AI will handle
    }

    setKnrProcessingProgress(20);
    setKnrProcessingMsg(`Porównywanie ${toProcess.length} pozycji z katalogiem (${knrCatalog.length} KNR)...`);

    // Client-side similarity matching — fast, no network calls
    const notFoundInPortal: { posId: string; name: string; unit: string }[] = [];
    for (let i = 0; i < toProcess.length; i++) {
      const pos = toProcess[i];
      if (i % 50 === 0) {
        setKnrProcessingProgress(20 + Math.round((i / toProcess.length) * 30));
        setKnrProcessingMsg(`Porównywanie nazw: ${i + 1}/${toProcess.length}...`);
        // Yield to UI every 50 items
        await new Promise(r => setTimeout(r, 0));
      }

      const posUnit = typeof pos.unit === 'string' ? pos.unit : pos.unit?.label || 'szt.';

      // Find best match in catalog
      let bestMatch: { basis: string; similarity: number } | null = null;
      for (const row of knrCatalog) {
        const sim = textSimilarity(pos.name, row.name);
        if (sim >= 0.8 && (!bestMatch || sim > bestMatch.similarity)) {
          bestMatch = { basis: row.basis, similarity: sim };
          if (sim > 0.95) break; // Good enough — stop early
        }
      }

      if (bestMatch) {
        stats.foundInPortal++;
        // Find the matching catalog entry name for description
        const matchedEntry = knrCatalog.find(r => r.basis === bestMatch!.basis);
        reviewItems.push({
          posId: pos.id, posName: pos.name, posUnit,
          knrCode: bestMatch.basis, knrDescription: matchedEntry?.name || '', source: 'portal', confidence: bestMatch.similarity,
        });
      } else {
        notFoundInPortal.push({ posId: pos.id, name: pos.name, unit: posUnit });
      }
    }

    setKnrProcessingProgress(45);

    // Phase 2: Check KNR cache in Supabase (instant for repeat imports)
    let notFoundAnywhere = [...notFoundInPortal];
    if (notFoundAnywhere.length > 0) {
      setKnrProcessingMsg(`Sprawdzanie cache KNR (${notFoundAnywhere.length} pozycji)...`);
      try {
        const names = notFoundAnywhere.map(p => p.name);
        const { data: cached } = await supabase
          .from('knr_cache')
          .select('position_name, position_unit, knr_code, knr_description, confidence')
          .in('position_name', names);
        if (cached && cached.length > 0) {
          const cacheMap = new Map(cached.map(c => [c.position_name, c]));
          const stillNotFound: typeof notFoundAnywhere = [];
          for (const item of notFoundAnywhere) {
            const hit = cacheMap.get(item.name);
            if (hit && hit.knr_code) {
              stats.foundByAi++;
              reviewItems.push({
                posId: item.posId, posName: item.name, posUnit: item.unit,
                knrCode: hit.knr_code, knrDescription: hit.knr_description || '',
                source: 'ai', confidence: hit.confidence || 0.7,
              });
            } else {
              stillNotFound.push(item);
            }
          }
          notFoundAnywhere = stillNotFound;
        }
      } catch (e) {
        console.warn('Cache lookup failed, continuing with AI:', e);
      }
    }

    setKnrProcessingProgress(55);

    // Phase 3: AI lookup for remaining — sequential with rate limit pauses
    if (notFoundAnywhere.length > 0) {
      setKnrProcessingMsg(`AI: ${notFoundAnywhere.length} pozycji do analizy...`);

      try {
        const BATCH_SIZE = 50;
        const batches: { posId: string; name: string; unit: string }[][] = [];
        for (let i = 0; i < notFoundAnywhere.length; i += BATCH_SIZE) {
          batches.push(notFoundAnywhere.slice(i, i + BATCH_SIZE));
        }

        let completedBatches = 0;
        const aiResults: { name: string; unit: string; code: string; desc: string; conf: number }[] = [];

        const processBatch = async (chunk: typeof notFoundAnywhere, batchIdx: number) => {
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const { data: aiData, error: aiError } = await supabase.functions.invoke('knr-ai-lookup', {
                body: { positions: chunk.map(p => ({ id: p.posId, name: p.name, unit: p.unit })) },
              });
              if (!aiError && aiData?.success && aiData.data?.results) {
                for (const result of aiData.data.results) {
                  const idx = result.index;
                  if (idx >= 0 && idx < chunk.length && result.knr_code && result.knr_code.trim()) {
                    stats.foundByAi++;
                    reviewItems.push({
                      posId: chunk[idx].posId, posName: chunk[idx].name, posUnit: chunk[idx].unit,
                      knrCode: result.knr_code, knrDescription: result.knr_description || '',
                      source: 'ai', confidence: result.confidence || 0.5,
                    });
                    aiResults.push({ name: chunk[idx].name, unit: chunk[idx].unit, code: result.knr_code, desc: result.knr_description || '', conf: result.confidence || 0.5 });
                    chunk[idx] = null as any;
                  }
                }
                break;
              }
              console.warn(`AI batch ${batchIdx} attempt ${attempt + 1} failed, retrying...`);
              if (attempt < 2) await new Promise(r => setTimeout(r, 15000));
            } catch (e) {
              console.error(`AI batch ${batchIdx} attempt ${attempt + 1} error:`, e);
              if (attempt < 2) await new Promise(r => setTimeout(r, 10000));
            }
          }
          completedBatches++;
          setKnrProcessingProgress(55 + Math.round((completedBatches / batches.length) * 40));
          setKnrProcessingMsg(`AI: ${completedBatches}/${batches.length} partii...`);
        };

        // Sequential with 15s pause to stay under 8K output tokens/min
        for (let i = 0; i < batches.length; i++) {
          await processBatch(batches[i], i);
          if (i < batches.length - 1) {
            const remaining = batches.length - i - 1;
            const etaSec = remaining * 20;
            const etaMin = Math.ceil(etaSec / 60);
            setKnrProcessingMsg(`AI: ${completedBatches}/${batches.length} · ~${etaMin} min`);
            await new Promise(r => setTimeout(r, 15000));
          }
        }

        // Save AI results to cache for future imports (fire-and-forget)
        if (aiResults.length > 0) {
          supabase.from('knr_cache').upsert(
            aiResults.map(r => ({ position_name: r.name, position_unit: r.unit, knr_code: r.code, knr_description: r.desc, confidence: r.conf })),
            { onConflict: 'position_name,position_unit' }
          ).then(() => console.log(`Cached ${aiResults.length} KNR results`));
        }

        // Remaining not found by AI either
        for (const item of notFoundAnywhere) {
          if (!item) continue;
          reviewItems.push({
            posId: item.posId, posName: item.name, posUnit: item.unit,
            knrCode: '', knrDescription: '', source: 'ai', confidence: 0,
          });
        }
      } catch (err) {
        console.error('AI KNR lookup error:', err);
        for (const item of notFoundAnywhere) {
          if (!item) continue;
          reviewItems.push({
            posId: item.posId, posName: item.name, posUnit: item.unit,
            knrCode: '', knrDescription: '', source: 'ai', confidence: 0,
          });
        }
      }
    }

    setKnrProcessingProgress(100);
    setKnrImportStats(stats);
    setKnrReviewItems(reviewItems);
    setKnrReviewIndex(0);

    if (manual) {
      // Manual mode: show review table
      setKnrImportStep('review');
    } else {
      // Automatic mode: apply all found KNR directly
      applyKnrResults(reviewItems, knrPendingData, stats, scope);
    }
  };

  // Apply KNR results to data and import
  const applyKnrResults = (
    items: KnrReviewItem[],
    data: KosztorysCostEstimateData,
    stats: KnrImportStats,
    scope: 'all' | 'empty'
  ) => {
    const updatedData = { ...data, positions: { ...data.positions } };

    for (const item of items) {
      if (item.removed) continue;
      if (item.knrCode && updatedData.positions[item.posId]) {
        updatedData.positions[item.posId] = {
          ...updatedData.positions[item.posId],
          base: item.knrCode,
          originBase: item.knrCode,
          marker: item.source === 'ai' || item.source === 'portal' ? 'AI' : undefined,
        };
      }
    }

    applyImportedData(updatedData);
    setKnrImportStep('stats');
    setKnrImportStats(prev => prev ? {
      ...prev,
      accepted: items.filter(i => !i.removed).length,
      rejected: items.filter(i => i.removed).length,
    } : stats);
  };

  // Clean orphan positions from data (positions that exist but aren't in any section)
  const cleanOrphanPositions = (data: KosztorysCostEstimateData): KosztorysCostEstimateData => {
    // Get all position IDs that are actually referenced
    const referencedPositionIds = new Set<string>();

    // Add root position IDs
    (data.root.positionIds || []).forEach(id => referencedPositionIds.add(id));

    // Add position IDs from all sections (including subsections)
    const collectSectionPositions = (sectionId: string) => {
      const section = data.sections[sectionId];
      if (!section) return;
      (section.positionIds || []).forEach(id => referencedPositionIds.add(id));
      (section.subsectionIds || []).forEach(subId => collectSectionPositions(subId));
    };

    (data.root.sectionIds || []).forEach(sectionId => collectSectionPositions(sectionId));

    // Remove unreferenced positions from positions object
    const cleanedPositions: Record<string, KosztorysPosition> = {};
    for (const [posId, position] of Object.entries(data.positions)) {
      if (referencedPositionIds.has(posId)) {
        cleanedPositions[posId] = position;
      } else {
        console.log('Removing orphan position:', posId, position.name);
      }
    }

    // Clean up section positionIds to remove IDs that don't exist
    const cleanedSections: Record<string, KosztorysSection> = {};
    for (const [secId, section] of Object.entries(data.sections)) {
      cleanedSections[secId] = {
        ...section,
        positionIds: section.positionIds.filter(id => cleanedPositions[id]),
      };
    }

    // Clean up root positionIds
    const cleanedRoot = {
      ...data.root,
      positionIds: (data.root.positionIds || []).filter(id => cleanedPositions[id]),
    };

    return {
      ...data,
      root: cleanedRoot,
      sections: cleanedSections,
      positions: cleanedPositions,
    };
  };

  // Mark as dirty when data changes
  const updateEstimateData = (newData: KosztorysCostEstimateData) => {
    setEstimateData(newData);
    setEditorState(prev => ({ ...prev, isDirty: true }));
  };

  // Reorder sections via drag-and-drop (works for root sections and subsections)
  const handleSectionReorder = (draggedId: string, targetId: string, parentSectionId?: string | null) => {
    if (draggedId === targetId) return;

    const newData = { ...estimateData };

    if (parentSectionId) {
      // Reordering subsections within a parent section
      const sectionIds = [...newData.sections[parentSectionId].subsectionIds];
      const draggedIndex = sectionIds.indexOf(draggedId);
      const targetIndex = sectionIds.indexOf(targetId);

      if (draggedIndex === -1 || targetIndex === -1) return;

      sectionIds.splice(draggedIndex, 1);
      sectionIds.splice(targetIndex, 0, draggedId);

      newData.sections[parentSectionId] = {
        ...newData.sections[parentSectionId],
        subsectionIds: sectionIds,
      };
    } else {
      // Reordering root sections
      const sectionIds = [...newData.root.sectionIds];
      const draggedIndex = sectionIds.indexOf(draggedId);
      const targetIndex = sectionIds.indexOf(targetId);

      if (draggedIndex === -1 || targetIndex === -1) return;

      sectionIds.splice(draggedIndex, 1);
      sectionIds.splice(targetIndex, 0, draggedId);

      // Update ordinal numbers
      sectionIds.forEach((id, index) => {
        if (newData.sections[id]) {
          newData.sections[id] = {
            ...newData.sections[id],
            ordinalNumber: String(index + 1),
          };
        }
      });

      newData.root = {
        ...newData.root,
        sectionIds,
      };
    }

    updateEstimateData(newData);
  };

  // Reorder positions via drag-and-drop within a section
  const handlePositionReorder = (draggedId: string, targetId: string, sectionId: string) => {
    if (draggedId === targetId) return;

    const newData = { ...estimateData };
    const positionIds = [...newData.sections[sectionId].positionIds];
    const draggedIndex = positionIds.indexOf(draggedId);
    const targetIndex = positionIds.indexOf(targetId);

    if (draggedIndex === -1 || targetIndex === -1) return;

    positionIds.splice(draggedIndex, 1);
    positionIds.splice(targetIndex, 0, draggedId);

    newData.sections[sectionId] = {
      ...newData.sections[sectionId],
      positionIds,
    };

    updateEstimateData(newData);
  };

  // Move position from one section to another
  const handleMovePositionToSection = (positionId: string, fromSectionId: string, toSectionId: string) => {
    if (fromSectionId === toSectionId) return;

    const newData = { ...estimateData };

    // Remove from source section
    newData.sections[fromSectionId] = {
      ...newData.sections[fromSectionId],
      positionIds: newData.sections[fromSectionId].positionIds.filter(id => id !== positionId),
    };

    // Add to target section
    newData.sections[toSectionId] = {
      ...newData.sections[toSectionId],
      positionIds: [...newData.sections[toSectionId].positionIds, positionId],
    };

    updateEstimateData(newData);
    showNotificationMessage('Pozycja przeniesiona', 'success');
  };

  // Move section/subsection to become a subsection of another section
  const handleMoveSectionToSection = (sectionId: string, fromParentId: string | null, toSectionId: string) => {
    if (sectionId === toSectionId) return;

    const newData = { ...estimateData };

    // Remove from source
    if (fromParentId) {
      // Remove from parent's subsectionIds
      newData.sections[fromParentId] = {
        ...newData.sections[fromParentId],
        subsectionIds: newData.sections[fromParentId].subsectionIds.filter(id => id !== sectionId),
      };
    } else {
      // Remove from root
      newData.root = {
        ...newData.root,
        sectionIds: newData.root.sectionIds.filter(id => id !== sectionId),
      };
    }

    // Add to target section as subsection
    newData.sections[toSectionId] = {
      ...newData.sections[toSectionId],
      subsectionIds: [...newData.sections[toSectionId].subsectionIds, sectionId],
    };

    updateEstimateData(newData);
    showNotificationMessage('Dział przeniesiony', 'success');
  };

  // Add section
  const handleAddSection = () => {
    const sectionIds = estimateData.root.sectionIds;
    const ordinalNumber = String(sectionIds.length + 1);
    const newSection = createNewSection('Nowy dział', ordinalNumber);

    updateEstimateData({
      ...estimateData,
      root: {
        ...estimateData.root,
        sectionIds: [...sectionIds, newSection.id],
      },
      sections: {
        ...estimateData.sections,
        [newSection.id]: newSection,
      },
    });

    setEditorState(prev => ({
      ...prev,
      selectedItemId: newSection.id,
      selectedItemType: 'section',
      expandedSections: new Set([...prev.expandedSections, newSection.id]),
    }));
  };

  // Add subsection to selected section
  const handleAddSubsection = (parentSectionId?: string) => {
    // Use provided parentSectionId or get from currently selected section
    const targetParentId = parentSectionId || (
      editorState.selectedItemType === 'section' ? editorState.selectedItemId : null
    );

    if (!targetParentId) {
      // No section selected - show alert or handle error
      return;
    }

    const parentSection = estimateData.sections[targetParentId];
    if (!parentSection) return;

    // Calculate ordinal number: parent.ordinalNumber + "." + (subsectionIds.length + 1)
    const subsectionIndex = (parentSection.subsectionIds?.length || 0) + 1;
    const ordinalNumber = `${parentSection.ordinalNumber}.${subsectionIndex}`;
    const newSection = createNewSection('Nowy poddział', ordinalNumber);

    updateEstimateData({
      ...estimateData,
      sections: {
        ...estimateData.sections,
        [newSection.id]: newSection,
        [targetParentId]: {
          ...parentSection,
          subsectionIds: [...(parentSection.subsectionIds || []), newSection.id],
        },
      },
    });

    setEditorState(prev => ({
      ...prev,
      selectedItemId: newSection.id,
      selectedItemType: 'section',
      expandedSections: new Set([...prev.expandedSections, targetParentId, newSection.id]),
    }));
  };

  // Add position
  const handleAddPosition = (sectionId: string | null = null) => {
    setTargetSectionId(sectionId);
    setNewPositionForm({ base: '', name: '', unitIndex: '020', measurement: '' });
    setShowAddPositionModal(true);
  };

  const confirmAddPosition = () => {
    const unit = UNITS_REFERENCE.find(u => u.index === newPositionForm.unitIndex) || UNITS_REFERENCE[0];
    const newPosition = createNewPosition(
      newPositionForm.base,
      newPositionForm.name || 'Nowa pozycja',
      unit.unit,
      unit.index
    );

    // Add measurement if provided
    if (newPositionForm.measurement.trim()) {
      newPosition.measurements = addMeasurementEntry(
        newPosition.measurements,
        newPositionForm.measurement,
        'Przedmiar'
      );
    }

    const newData = { ...estimateData };
    newData.positions = { ...newData.positions, [newPosition.id]: newPosition };

    // Determine target section - use provided targetSectionId, or selected section, or first section
    let effectiveTargetSectionId = targetSectionId;

    if (!effectiveTargetSectionId && editorState.selectedItemType === 'section' && editorState.selectedItemId) {
      effectiveTargetSectionId = editorState.selectedItemId;
    }

    if (!effectiveTargetSectionId && estimateData.root.sectionIds.length > 0) {
      effectiveTargetSectionId = estimateData.root.sectionIds[0];
    }

    // Positions can only be added to sections (działy or poddziały), not to root
    if (!effectiveTargetSectionId || !newData.sections[effectiveTargetSectionId]) {
      setShowAddPositionModal(false);
      showNotificationMessage('Najpierw dodaj dział, aby móc dodać pozycję', 'warning');
      return;
    }

    newData.sections = {
      ...newData.sections,
      [effectiveTargetSectionId]: {
        ...newData.sections[effectiveTargetSectionId],
        positionIds: [...newData.sections[effectiveTargetSectionId].positionIds, newPosition.id],
      },
    };

    updateEstimateData(newData);
    setShowAddPositionModal(false);

    setEditorState(prev => ({
      ...prev,
      selectedItemId: newPosition.id,
      selectedItemType: 'position',
      expandedPositions: new Set([...prev.expandedPositions, newPosition.id]),
      expandedSections: new Set([...prev.expandedSections, effectiveTargetSectionId]),
    }));
  };

  // Add resource - instantly creates and opens properties panel
  const handleAddResource = (positionId: string, resourceType?: KosztorysResourceType) => {
    const position = estimateData.positions[positionId];
    if (!position) return;

    const defaultUnitIndex = resourceType === 'labor' ? '149' : resourceType === 'equipment' ? '150' : '020';
    const unit = UNITS_REFERENCE.find(u => u.index === defaultUnitIndex) || UNITS_REFERENCE[0];

    const resourceNames: Record<string, string> = {
      labor: 'Robocizna',
      material: 'Materiał',
      equipment: 'Sprzęt',
      waste: 'Odpady',
    };

    const safeType = (resourceType === 'waste' ? 'material' : resourceType) || 'labor';
    const newResource = createNewResource(
      safeType as 'labor' | 'material' | 'equipment',
      resourceNames[resourceType || 'labor'] || 'Nowy nakład',
      1,
      0,
      unit.unit,
      unit.index
    );

    updateEstimateData({
      ...estimateData,
      positions: {
        ...estimateData.positions,
        [positionId]: {
          ...position,
          resources: [...position.resources, newResource],
        },
      },
    });

    // Select resource, expand position, and open properties panel
    setEditorState(prev => ({
      ...prev,
      selectedItemId: newResource.id,
      selectedItemType: 'resource',
      expandedPositions: new Set([...prev.expandedPositions, positionId]),
    }));

    setLeftPanelMode('properties');

    // Highlight and scroll to the position
    setHighlightedItemId(positionId);
    setTimeout(() => {
      const rowElement = rowRefs.current[positionId];
      if (rowElement) {
        rowElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
    setTimeout(() => {
      setHighlightedItemId(null);
    }, 2000);

    showNotificationMessage(`Dodano nakład: ${resourceNames[resourceType || 'labor']}`, 'success');
  };

  // Confirm add resource from modal
  const confirmAddResource = () => {
    if (!editorState.selectedItemId) return;
    handleAddResource(editorState.selectedItemId, newResourceForm.type);
    setShowAddResourceModal(false);
  };

  // Update selected item
  const handleUpdateSelectedItem = (updates: Partial<any>) => {
    if (!editorState.selectedItemId || !editorState.selectedItemType) return;

    const newData = { ...estimateData };

    switch (editorState.selectedItemType) {
      case 'section': {
        const section = newData.sections[editorState.selectedItemId];
        if (section) {
          newData.sections = {
            ...newData.sections,
            [editorState.selectedItemId]: { ...section, ...updates },
          };
        }
        break;
      }
      case 'position': {
        const position = newData.positions[editorState.selectedItemId];
        if (position) {
          newData.positions = {
            ...newData.positions,
            [editorState.selectedItemId]: { ...position, ...updates },
          };
        }
        break;
      }
      case 'resource': {
        for (const [posId, position] of Object.entries(newData.positions)) {
          const resourceIndex = position.resources.findIndex(r => r.id === editorState.selectedItemId);
          if (resourceIndex !== -1) {
            const newResources = [...position.resources];
            newResources[resourceIndex] = { ...newResources[resourceIndex], ...updates };
            newData.positions = {
              ...newData.positions,
              [posId]: { ...position, resources: newResources },
            };
            break;
          }
        }
        break;
      }
    }

    updateEstimateData(newData);
  };

  // Open search material modal — load integrations + own materials + categories
  const openSearchMaterialModal = async () => {
    setShowSearchMaterialModal(true);
    setSearchMaterialSubTab('own');
    setSearchMaterialSearch('');
    setSearchMatSelectedCategory(null);
    setSearchMatViewMode('grid');
    try {
      const [intRes, matRes, catRes] = await Promise.all([
        supabase.from('wholesaler_integrations').select('*').eq('company_id', currentUser?.company_id || ''),
        supabase.from('kosztorys_materials').select('*').order('category', { ascending: true }).order('name', { ascending: true }),
        supabase.from('kosztorys_custom_categories').select('*').eq('company_id', currentUser?.company_id || '').order('sort_order', { ascending: true }),
      ]);
      setSearchMaterialIntegrations((intRes.data || []).filter((i: WholesalerIntegration) => i.is_active));
      setSearchMaterialOwnData(matRes.data || []);
      setSearchMatCategories(catRes.data || []);
    } catch (err) {
      console.error('Error loading search material data:', err);
    }
  };

  // Apply selected product from search modal to the current resource
  const handleApplyMaterialFromSearch = (result: { name: string; price?: number | null; sku?: string; index?: string; ean?: string; ref_num?: string; unit?: string }) => {
    const updates: Partial<any> = {};
    if (result.name) updates.name = result.name;
    const idx = result.index || result.sku || result.ean || result.ref_num || `MAT-${Date.now().toString(36).toUpperCase()}`;
    const currentResource = selectedItem as KosztorysResource | null;
    updates.originIndex = { ...(currentResource?.originIndex || { type: 'custom' }), index: idx };
    if (result.price != null) {
      updates.unitPrice = { ...(currentResource?.unitPrice || { type: 'custom' }), value: result.price };
    }
    if (result.unit) {
      const matched = UNITS_REFERENCE.find(u =>
        u.unit.toLowerCase().replace(/[.\s]/g, '') === result.unit!.toLowerCase().replace(/[.\s]/g, '')
      );
      if (matched) {
        updates.unit = { label: matched.unit, unitIndex: matched.index };
      }
    }
    handleUpdateSelectedItem(updates);
    setShowSearchMaterialModal(false);
  };

  // Open search equipment modal — load integrations + own equipment + categories
  const openSearchEquipmentModal = async () => {
    setShowSearchEquipmentModal(true);
    setSearchEquipmentSubTab('own');
    setSearchEquipmentSearch('');
    setSearchEqSelectedCategory(null);
    setSearchEqViewMode('grid');
    try {
      const [intRes, eqRes, catRes] = await Promise.all([
        supabase.from('wholesaler_integrations').select('*').eq('company_id', currentUser?.company_id || ''),
        supabase.from('kosztorys_equipment').select('*').order('category', { ascending: true }).order('name', { ascending: true }),
        supabase.from('kosztorys_equipment_categories').select('*').eq('company_id', currentUser?.company_id || '').order('sort_order', { ascending: true }),
      ]);
      setSearchEquipmentIntegrations((intRes.data || []).filter((i: WholesalerIntegration) => i.is_active));
      setSearchEquipmentOwnData(eqRes.data || []);
      setSearchEqCategories(catRes.data || []);
    } catch (err) {
      console.error('Error loading search equipment data:', err);
    }
  };

  // Apply selected product from equipment search modal to the current resource
  const handleApplyEquipmentFromSearch = (result: { name: string; price?: number | null; sku?: string; index?: string; ean?: string; ref_num?: string; unit?: string; manufacturer?: string }) => {
    const updates: Partial<any> = {};
    if (result.name) updates.name = result.name;
    // Pick the best available code: index > sku > ean > ref_num, generate if none
    const idx = result.index || result.sku || result.ean || result.ref_num || `EQ-${Date.now().toString(36).toUpperCase()}`;
    const currentResource = selectedItem as KosztorysResource | null;
    updates.originIndex = { ...(currentResource?.originIndex || { type: 'custom' }), index: idx };
    if (result.price != null) {
      updates.unitPrice = { ...(currentResource?.unitPrice || { type: 'custom' }), value: result.price };
    }
    if (result.unit) {
      const matched = UNITS_REFERENCE.find(u =>
        u.unit.toLowerCase().replace(/[.\s]/g, '') === result.unit!.toLowerCase().replace(/[.\s]/g, '')
      );
      if (matched) {
        updates.unit = { label: matched.unit, unitIndex: matched.index };
      }
    }
    handleUpdateSelectedItem(updates);
    setShowSearchEquipmentModal(false);
  };

  // Open Kartoteka price list modal — loads live data from own catalogs
  const openKartotekaPriceListModal = async () => {
    setShowKartotekaPriceListModal(true);
    setKartotekaPriceListTab('robocizna');
    setKartotekaPriceListLoading(true);
    try {
      const [labourRes, matRes, eqRes] = await Promise.all([
        supabase.from('kosztorys_own_labours').select('code, name, category, unit, price').eq('company_id', currentUser?.company_id || '').eq('is_active', true).order('name'),
        supabase.from('kosztorys_materials').select('code, name, category, unit, default_price').eq('company_id', currentUser?.company_id || '').eq('is_active', true).order('name'),
        supabase.from('kosztorys_equipment').select('code, name, category, unit, default_price').eq('company_id', currentUser?.company_id || '').eq('is_active', true).order('name'),
      ]);
      setKartotekaPriceListData({
        robocizna: (labourRes.data || []).map((l: any) => ({ code: l.code, name: l.name, category: l.category || '', unit: l.unit || 'r-g', price: l.price || 0 })),
        materialy: (matRes.data || []).map((m: any) => ({ code: m.code, name: m.name, category: m.category || '', unit: m.unit || '', price: m.default_price || 0 })),
        sprzet: (eqRes.data || []).map((e: any) => ({ code: e.code, name: e.name, category: e.category || '', unit: e.unit || '', price: e.default_price || 0 })),
      });
    } catch (err) {
      console.error('Error loading kartoteka price list:', err);
    } finally {
      setKartotekaPriceListLoading(false);
    }
  };

  // Open search labour modal — load system + own labours + categories
  const openSearchLabourModal = async () => {
    setShowSearchLabourModal(true);
    setSearchLabourSubTab('system');
    setSearchLabourSearch('');
    setSearchLabourSelectedSystemCategory(null);
    setSearchLabourSelectedOwnCategory(null);
    setSearchLabourSystemPage(0);
    try {
      // Batch-fetch system labours (may be >1000 rows)
      let allSystemLabours: KosztorysSystemLabour[] = [];
      let from = 0;
      const batchSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from('kosztorys_system_labours')
          .select('*')
          .eq('is_active', true)
          .order('code')
          .range(from, from + batchSize - 1);
        if (error) { console.error('Error loading system labours:', error); break; }
        if (!data || data.length === 0) break;
        allSystemLabours = allSystemLabours.concat(data);
        if (data.length < batchSize) break;
        from += batchSize;
      }
      setSearchLabourSystemData(allSystemLabours);

      const [sysCatRes, ownRes, ownCatRes] = await Promise.all([
        supabase.from('kosztorys_system_labour_categories').select('*').order('sort_order'),
        supabase.from('kosztorys_own_labours').select('*').eq('company_id', currentUser?.company_id || '').eq('is_active', true).order('name'),
        supabase.from('kosztorys_own_labour_categories').select('*').eq('company_id', currentUser?.company_id || '').order('sort_order'),
      ]);
      setSearchLabourSystemCategories(sysCatRes.data || []);
      setSearchLabourOwnData(ownRes.data || []);
      setSearchLabourOwnCategories(ownCatRes.data || []);
    } catch (err) {
      console.error('Error loading search labour data:', err);
    }
  };

  // Apply selected labour from search modal to the current resource
  const handleApplyLabourFromSearch = (result: { name: string; code: string; price?: number | null; unit?: string }) => {
    const updates: Partial<any> = {};
    if (result.name) updates.name = result.name;
    const currentResource = selectedItem as KosztorysResource | null;
    updates.originIndex = { ...(currentResource?.originIndex || { type: 'custom' }), index: result.code };
    if (result.price != null) {
      updates.unitPrice = { ...(currentResource?.unitPrice || { type: 'custom' }), value: result.price };
    }
    if (result.unit) {
      const matched = UNITS_REFERENCE.find(u =>
        u.unit.toLowerCase().replace(/[.\s]/g, '') === result.unit!.toLowerCase().replace(/[.\s]/g, '')
      );
      if (matched) {
        updates.unit = { label: matched.unit, unitIndex: matched.index };
      }
    }
    handleUpdateSelectedItem(updates);
    setShowSearchLabourModal(false);
  };

  // Fetch wholesaler prices when material detail opens in search modal
  useEffect(() => {
    if (!searchMatDetailItem) { setSearchMatWholesalerPrices([]); setSearchMatLoadingPrices(false); return; }
    const dm = searchMatDetailItem as any;
    const seenWholesalers = new Set<string>();
    const activeInts = searchMaterialIntegrations.filter(i => {
      if (!i.is_active) return false;
      if (i.branza === 'sprzet') return false;
      if (seenWholesalers.has(i.wholesaler_id)) return false;
      seenWholesalers.add(i.wholesaler_id);
      return true;
    });
    if (activeInts.length === 0) return;

    const queries: string[] = [];
    if (dm.ref_num) queries.push(dm.ref_num);
    if (dm.ean) queries.push(dm.ean);
    if (dm.sku && dm.sku !== dm.ref_num && dm.sku !== dm.ean) queries.push(dm.sku);
    if (queries.length === 0 && dm.name) queries.push(dm.name);
    if (queries.length === 0) return;

    const scoreProduct = (p: any): number => {
      let score = 0;
      const pName = (p.name || '').toLowerCase();
      const pSku = (p.sku || '').toLowerCase();
      const pRefNum = (p.ref_num || '').toLowerCase();
      if (dm.ref_num) { const ref = dm.ref_num.toLowerCase(); if (pRefNum === ref || pSku.includes(ref) || pName.includes(ref)) score += 20; }
      if (dm.ean && (pName.includes(dm.ean) || pSku.includes(dm.ean))) score += 15;
      const dmWords = (dm.name || '').toLowerCase().split(/\s+/).filter((w: string) => w.length > 3);
      score += dmWords.filter((w: string) => pName.includes(w)).length * 2;
      return score;
    };

    setSearchMatLoadingPrices(true);
    setSearchMatWholesalerPrices([]);

    Promise.allSettled(activeInts.map(async (integration) => {
      const proxyName = integration.wholesaler_id === 'tim' ? 'tim-proxy' : 'oninen-proxy';
      const queryResults = await Promise.allSettled(
        queries.map(q => supabase.functions.invoke(proxyName, { body: { action: 'search', integrationId: integration.id, q } }).then(({ data, error }) => {
          if (error) throw error;
          const parsed = typeof data === 'string' ? JSON.parse(data) : data;
          if (parsed?.error) throw new Error(parsed.error);
          return parsed;
        }))
      );
      const seen = new Map<string, { product: any; score: number }>();
      for (const qr of queryResults) {
        if (qr.status !== 'fulfilled') continue;
        for (const p of (qr.value.products || [])) {
          const key = p.sku || p.url || p.name;
          const score = scoreProduct(p);
          const existing = seen.get(key);
          if (!existing || score > existing.score) seen.set(key, { product: p, score });
        }
      }
      let best: any = null; let bestScore = -1;
      for (const { product, score } of seen.values()) { if (score > bestScore) { best = product; bestScore = score; } }
      if ((dm.ref_num || dm.ean) && bestScore <= 0) best = null;
      return { integration, best };
    })).then(results => {
      const prices: typeof searchMatWholesalerPrices = [];
      for (const r of results) {
        if (r.status !== 'fulfilled') continue;
        const { integration, best } = r.value;
        if (!best) continue;
        const isTim = integration.wholesaler_id === 'tim';
        const wholesalerLabel = integration.wholesaler_name || (isTim ? 'TIM S.A.' : integration.wholesaler_id === 'oninen' ? 'Onninen' : integration.wholesaler_id);
        const purchasePrice = isTim ? (best.price ?? null) : (best.priceEnd ?? null);
        const catalogPrice = isTim ? (best.publicPrice ?? null) : (best.priceCatalog ?? null);
        prices.push({ wholesaler: wholesalerLabel, productName: best.name || '—', catalogPrice, purchasePrice, stock: best.stock ?? null, url: best.url || undefined });
      }
      setSearchMatWholesalerPrices(prices);
      setSearchMatLoadingPrices(false);
    });
  }, [searchMatDetailItem, searchMaterialIntegrations]);

  // Helper to recursively collect all section IDs (including subsections) and their positions
  const collectSectionAndSubsectionIds = (
    sectionId: string,
    sections: Record<string, KosztorysSection>
  ): { sectionIds: string[]; positionIds: string[] } => {
    const section = sections[sectionId];
    if (!section) return { sectionIds: [], positionIds: [] };

    const result = {
      sectionIds: [sectionId],
      positionIds: [...section.positionIds],
    };

    // Recursively collect subsections
    for (const subsectionId of section.subsectionIds || []) {
      const subResult = collectSectionAndSubsectionIds(subsectionId, sections);
      result.sectionIds.push(...subResult.sectionIds);
      result.positionIds.push(...subResult.positionIds);
    }

    return result;
  };

  // Delete item
  const handleDeleteItem = (itemId: string, itemType: 'section' | 'position' | 'resource') => {
    const newData = { ...estimateData };

    switch (itemType) {
      case 'section': {
        // Collect all section IDs and position IDs to delete (including subsections)
        const { sectionIds: sectionsToDelete, positionIds: positionsToDelete } =
          collectSectionAndSubsectionIds(itemId, newData.sections);

        // Remove all collected sections
        const remainingSections = { ...newData.sections };
        for (const secId of sectionsToDelete) {
          delete remainingSections[secId];
        }
        newData.sections = remainingSections;

        // Remove all positions from deleted sections
        const remainingPositions = { ...newData.positions };
        for (const posId of positionsToDelete) {
          delete remainingPositions[posId];
        }
        newData.positions = remainingPositions;

        // Remove from root sectionIds
        newData.root = {
          ...newData.root,
          sectionIds: newData.root.sectionIds.filter(id => id !== itemId),
        };

        // Also remove from parent's subsectionIds if it's a subsection
        for (const [secId, section] of Object.entries(newData.sections)) {
          if (section.subsectionIds?.includes(itemId)) {
            newData.sections = {
              ...newData.sections,
              [secId]: {
                ...section,
                subsectionIds: section.subsectionIds.filter(id => id !== itemId),
              },
            };
            break;
          }
        }
        break;
      }
      case 'position': {
        const { [itemId]: removed, ...remainingPositions } = newData.positions;
        newData.positions = remainingPositions;
        newData.root = {
          ...newData.root,
          positionIds: newData.root.positionIds.filter(id => id !== itemId),
        };
        // Also remove from sections
        for (const [secId, section] of Object.entries(newData.sections)) {
          if (section.positionIds.includes(itemId)) {
            newData.sections = {
              ...newData.sections,
              [secId]: {
                ...section,
                positionIds: section.positionIds.filter(id => id !== itemId),
              },
            };
          }
        }
        break;
      }
      case 'resource': {
        for (const [posId, position] of Object.entries(newData.positions)) {
          const resourceIndex = position.resources.findIndex(r => r.id === itemId);
          if (resourceIndex !== -1) {
            newData.positions = {
              ...newData.positions,
              [posId]: {
                ...position,
                resources: position.resources.filter(r => r.id !== itemId),
              },
            };
            break;
          }
        }
        break;
      }
    }

    updateEstimateData(newData);

    if (editorState.selectedItemId === itemId) {
      setEditorState(prev => ({ ...prev, selectedItemId: null, selectedItemType: null }));
    }
  };

  // Move position in various directions
  const handleMovePosition = (direction: 'up' | 'down' | 'out' | 'last' | 'first') => {
    if (!editorState.selectedItemId || editorState.selectedItemType !== 'position') return;

    const posId = editorState.selectedItemId;
    const newData = { ...estimateData };

    // Find which array the position is in
    let positionIds: string[] | null = null;
    let sectionId: string | null = null;

    if (newData.root.positionIds.includes(posId)) {
      positionIds = [...newData.root.positionIds];
    } else {
      for (const [secId, section] of Object.entries(newData.sections)) {
        if (section.positionIds.includes(posId)) {
          positionIds = [...section.positionIds];
          sectionId = secId;
          break;
        }
      }
    }

    if (!positionIds) return;
    const currentIndex = positionIds.indexOf(posId);

    let handled = false;

    switch (direction) {
      case 'up':
        if (currentIndex > 0) {
          [positionIds[currentIndex], positionIds[currentIndex - 1]] =
            [positionIds[currentIndex - 1], positionIds[currentIndex]];
        }
        break;
      case 'down':
        if (currentIndex < positionIds.length - 1) {
          [positionIds[currentIndex], positionIds[currentIndex + 1]] =
            [positionIds[currentIndex + 1], positionIds[currentIndex]];
        }
        break;
      case 'out':
        // Move to root level
        positionIds.splice(currentIndex, 1);
        newData.root.positionIds = [...newData.root.positionIds, posId];
        break;
      case 'first':
        // Move to first section
        if (newData.root.sectionIds.length > 0) {
          const firstSectionId = newData.root.sectionIds[0];
          // Remove from current location
          if (sectionId) {
            newData.sections[sectionId] = {
              ...newData.sections[sectionId],
              positionIds: newData.sections[sectionId].positionIds.filter(id => id !== posId),
            };
          } else {
            newData.root.positionIds = newData.root.positionIds.filter(id => id !== posId);
          }
          // Add to first section
          newData.sections[firstSectionId] = {
            ...newData.sections[firstSectionId],
            positionIds: [...newData.sections[firstSectionId].positionIds, posId],
          };
          handled = true;
        }
        break;
      case 'last':
        // Move to last section
        if (newData.root.sectionIds.length > 0) {
          const lastSectionId = newData.root.sectionIds[newData.root.sectionIds.length - 1];
          // Remove from current location
          if (sectionId) {
            newData.sections[sectionId] = {
              ...newData.sections[sectionId],
              positionIds: newData.sections[sectionId].positionIds.filter(id => id !== posId),
            };
          } else {
            newData.root.positionIds = newData.root.positionIds.filter(id => id !== posId);
          }
          // Add to last section
          newData.sections[lastSectionId] = {
            ...newData.sections[lastSectionId],
            positionIds: [...newData.sections[lastSectionId].positionIds, posId],
          };
          handled = true;
        }
        break;
    }

    // Update the original array (only if not already handled)
    if (!handled) {
      if (sectionId) {
        newData.sections[sectionId] = { ...newData.sections[sectionId], positionIds };
      } else {
        newData.root.positionIds = positionIds;
      }
    }

    updateEstimateData(newData);
    showNotificationMessage('Pozycja przeniesiona', 'success');
  };

  // Direct move position by ID (for tree panel)
  const handleMovePositionById = (posId: string, direction: 'up' | 'down') => {
    const newData = { ...estimateData };

    // Find which array the position is in
    let positionIds: string[] | null = null;
    let sectionId: string | null = null;

    if (newData.root.positionIds.includes(posId)) {
      positionIds = [...newData.root.positionIds];
    } else {
      for (const [secId, section] of Object.entries(newData.sections)) {
        if (section.positionIds.includes(posId)) {
          positionIds = [...section.positionIds];
          sectionId = secId;
          break;
        }
      }
    }

    if (!positionIds) return;
    const currentIndex = positionIds.indexOf(posId);

    if (direction === 'up' && currentIndex > 0) {
      [positionIds[currentIndex], positionIds[currentIndex - 1]] =
        [positionIds[currentIndex - 1], positionIds[currentIndex]];
    } else if (direction === 'down' && currentIndex < positionIds.length - 1) {
      [positionIds[currentIndex], positionIds[currentIndex + 1]] =
        [positionIds[currentIndex + 1], positionIds[currentIndex]];
    } else {
      return; // No movement possible
    }

    if (sectionId) {
      newData.sections[sectionId] = { ...newData.sections[sectionId], positionIds };
    } else {
      newData.root.positionIds = positionIds;
    }

    updateEstimateData(newData);
    showNotificationMessage('Pozycja przeniesiona', 'success');
  };

  // Direct move section by ID (for tree panel)
  const handleMoveSectionById = (secId: string, direction: 'up' | 'down') => {
    const newData = { ...estimateData };

    // Find if this is a top-level section or a subsection
    let parentSectionId: string | null = null;
    let sectionIds: string[] | null = null;

    if (newData.root.sectionIds.includes(secId)) {
      sectionIds = [...newData.root.sectionIds];
    } else {
      for (const [parentId, section] of Object.entries(newData.sections)) {
        if (section.subsectionIds.includes(secId)) {
          sectionIds = [...section.subsectionIds];
          parentSectionId = parentId;
          break;
        }
      }
    }

    if (!sectionIds) return;
    const currentIndex = sectionIds.indexOf(secId);

    if (direction === 'up' && currentIndex > 0) {
      [sectionIds[currentIndex], sectionIds[currentIndex - 1]] =
        [sectionIds[currentIndex - 1], sectionIds[currentIndex]];
    } else if (direction === 'down' && currentIndex < sectionIds.length - 1) {
      [sectionIds[currentIndex], sectionIds[currentIndex + 1]] =
        [sectionIds[currentIndex + 1], sectionIds[currentIndex]];
    } else {
      return; // No movement possible
    }

    if (parentSectionId) {
      newData.sections[parentSectionId] = { ...newData.sections[parentSectionId], subsectionIds: sectionIds };
    } else {
      newData.root.sectionIds = sectionIds;
    }

    updateEstimateData(newData);
    showNotificationMessage('Dział przeniesiony', 'success');
  };

  // Move section/subsection in various directions
  const handleMoveSection = (direction: 'up' | 'down' | 'out' | 'toFirstSection' | 'toLastSection') => {
    if (!editorState.selectedItemId || editorState.selectedItemType !== 'section') return;

    const sectionId = editorState.selectedItemId;
    const newData = { ...estimateData };

    // Find if this is a top-level section or a subsection
    let parentSectionId: string | null = null;
    let sectionIds: string[] | null = null;

    if (newData.root.sectionIds.includes(sectionId)) {
      // Top-level section
      sectionIds = [...newData.root.sectionIds];
    } else {
      // Find parent section
      for (const [secId, section] of Object.entries(newData.sections)) {
        if (section.subsectionIds.includes(sectionId)) {
          sectionIds = [...section.subsectionIds];
          parentSectionId = secId;
          break;
        }
      }
    }

    if (!sectionIds) return;
    const currentIndex = sectionIds.indexOf(sectionId);

    let handled = false;

    switch (direction) {
      case 'up':
        if (currentIndex > 0) {
          [sectionIds[currentIndex], sectionIds[currentIndex - 1]] =
            [sectionIds[currentIndex - 1], sectionIds[currentIndex]];
        }
        break;
      case 'down':
        if (currentIndex < sectionIds.length - 1) {
          [sectionIds[currentIndex], sectionIds[currentIndex + 1]] =
            [sectionIds[currentIndex + 1], sectionIds[currentIndex]];
        }
        break;
      case 'out':
        // Move subsection out to parent level (or root if in top section)
        if (parentSectionId) {
          // Remove from current parent
          sectionIds.splice(currentIndex, 1);
          newData.sections[parentSectionId] = {
            ...newData.sections[parentSectionId],
            subsectionIds: sectionIds,
          };

          // Find grandparent or add to root
          let grandparentId: string | null = null;
          for (const [secId, section] of Object.entries(newData.sections)) {
            if (section.subsectionIds.includes(parentSectionId)) {
              grandparentId = secId;
              break;
            }
          }

          if (grandparentId) {
            // Add to grandparent's subsections after the parent
            const grandparentSubsections = [...newData.sections[grandparentId].subsectionIds];
            const parentIdx = grandparentSubsections.indexOf(parentSectionId);
            grandparentSubsections.splice(parentIdx + 1, 0, sectionId);
            newData.sections[grandparentId] = {
              ...newData.sections[grandparentId],
              subsectionIds: grandparentSubsections,
            };
          } else {
            // Parent is at root level, add section to root after parent
            const rootSections = [...newData.root.sectionIds];
            const parentIdx = rootSections.indexOf(parentSectionId);
            rootSections.splice(parentIdx + 1, 0, sectionId);
            newData.root.sectionIds = rootSections;
          }
          handled = true;
        }
        break;
      case 'toFirstSection':
        // Move to first section as subsection
        if (newData.root.sectionIds.length > 0) {
          const firstSectionId = newData.root.sectionIds[0];
          if (firstSectionId !== sectionId) {
            // Remove from current location
            if (parentSectionId) {
              newData.sections[parentSectionId] = {
                ...newData.sections[parentSectionId],
                subsectionIds: newData.sections[parentSectionId].subsectionIds.filter(id => id !== sectionId),
              };
            } else {
              newData.root.sectionIds = newData.root.sectionIds.filter(id => id !== sectionId);
            }
            // Add to first section
            newData.sections[firstSectionId] = {
              ...newData.sections[firstSectionId],
              subsectionIds: [...newData.sections[firstSectionId].subsectionIds, sectionId],
            };
            handled = true;
          }
        }
        break;
      case 'toLastSection':
        // Move to last section as subsection
        if (newData.root.sectionIds.length > 0) {
          const lastSectionId = newData.root.sectionIds[newData.root.sectionIds.length - 1];
          if (lastSectionId !== sectionId) {
            // Remove from current location
            if (parentSectionId) {
              newData.sections[parentSectionId] = {
                ...newData.sections[parentSectionId],
                subsectionIds: newData.sections[parentSectionId].subsectionIds.filter(id => id !== sectionId),
              };
            } else {
              newData.root.sectionIds = newData.root.sectionIds.filter(id => id !== sectionId);
            }
            // Add to last section
            newData.sections[lastSectionId] = {
              ...newData.sections[lastSectionId],
              subsectionIds: [...newData.sections[lastSectionId].subsectionIds, sectionId],
            };
            handled = true;
          }
        }
        break;
    }

    // Update the original array (only if not already handled)
    if (!handled) {
      if (parentSectionId) {
        newData.sections[parentSectionId] = { ...newData.sections[parentSectionId], subsectionIds: sectionIds };
      } else {
        newData.root.sectionIds = sectionIds;
      }
    }

    updateEstimateData(newData);
    showNotificationMessage('Dział przeniesiony', 'success');
  };

  // Toggle expand
  const toggleExpandSection = (sectionId: string) => {
    setEditorState(prev => {
      const newExpanded = new Set(prev.expandedSections);
      if (newExpanded.has(sectionId)) {
        newExpanded.delete(sectionId);
      } else {
        newExpanded.add(sectionId);
      }
      return { ...prev, expandedSections: newExpanded };
    });
  };

  const toggleExpandPosition = (positionId: string) => {
    setEditorState(prev => {
      const newExpanded = new Set(prev.expandedPositions);
      if (newExpanded.has(positionId)) {
        newExpanded.delete(positionId);
      } else {
        newExpanded.add(positionId);
      }
      return { ...prev, expandedPositions: newExpanded };
    });
  };

  const toggleExpandSubsection = (subsectionId: string) => {
    setEditorState(prev => {
      const newExpanded = new Set(prev.expandedSubsections);
      if (newExpanded.has(subsectionId)) {
        newExpanded.delete(subsectionId);
      } else {
        newExpanded.add(subsectionId);
      }
      return { ...prev, expandedSubsections: newExpanded };
    });
  };

  // Render section/subsection tree recursively
  const renderSectionTree = (sectionId: string, depth: number = 0, parentId: string | null = null): React.ReactNode => {
    const section = estimateData.sections[sectionId];
    if (!section) return null;

    const isSectionExpanded = editorState.expandedSections.has(sectionId);
    const hasSubsections = section.subsectionIds && section.subsectionIds.length > 0;
    const hasPositions = section.positionIds && section.positionIds.length > 0;
    const paddingLeft = 8 + depth * 16; // 8px base + 16px per depth level

    return (
      <div
        key={sectionId}
        draggable
        data-section-id={sectionId}
        data-parent-id={parentId || 'root'}
        data-item-type="section"
        onDragStart={(e) => {
          e.stopPropagation();
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('application/section-id', sectionId);
          e.dataTransfer.setData('application/parent-id', parentId || 'root');
          e.dataTransfer.setData('application/item-type', 'section');
          setDraggedSectionId(sectionId);
        }}
        onDragEnd={() => {
          setDraggedSectionId(null);
        }}
        onDragOver={(e) => {
          // Accept sections and positions
          if (e.dataTransfer.types.includes('application/section-id') ||
              e.dataTransfer.types.includes('application/position-id')) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();

          // Check if dropping a position
          const draggedPositionIdFromData = e.dataTransfer.getData('application/position-id');
          if (draggedPositionIdFromData) {
            const fromSection = e.dataTransfer.getData('application/section-id');
            if (fromSection && fromSection !== sectionId) {
              handleMovePositionToSection(draggedPositionIdFromData, fromSection, sectionId);
            }
            setDraggedPositionId(null);
            return;
          }

          // Check if dropping a section
          const draggedId = e.dataTransfer.getData('application/section-id');
          const draggedParent = e.dataTransfer.getData('application/parent-id');
          const currentParent = parentId || 'root';

          if (draggedId && draggedId !== sectionId) {
            // Same parent - reorder
            if (draggedParent === currentParent) {
              handleSectionReorder(draggedId, sectionId, parentId);
            } else {
              // Different parent - move into this section as subsection
              const fromParent = draggedParent === 'root' ? null : draggedParent;
              handleMoveSectionToSection(draggedId, fromParent, sectionId);
            }
            setDraggedSectionId(null);
          }
        }}
        className={`${draggedSectionId === sectionId ? 'opacity-50' : ''}`}
      >
        <div
          className={`group flex items-center gap-1 pr-2 py-1.5 text-sm rounded hover:bg-gray-50 ${
            editorState.selectedItemId === sectionId ? 'bg-blue-50 text-blue-700' : ''
          }`}
          style={{ paddingLeft: `${paddingLeft}px` }}
        >
          {/* Drag handle */}
          <GripVertical className="w-4 h-4 text-gray-400 cursor-grab flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
          <button
            onClick={() => {
              toggleExpandSection(sectionId);
              selectItem(sectionId, 'section');
            }}
            className="flex items-center gap-1 flex-1 text-left"
          >
            {(hasSubsections || hasPositions) ? (
              isSectionExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />
            ) : (
              <span className="w-4" />
            )}
            <span className="truncate">{section.ordinalNumber}. {section.name}</span>
          </button>
        </div>

        {isSectionExpanded && (
          <>
            {/* Subsections */}
            {section.subsectionIds?.map(subsectionId => renderSectionTree(subsectionId, depth + 1, sectionId))}

            {/* Positions in this section */}
            {section.positionIds.map((posId, posIndex) => {
              const position = estimateData.positions[posId];
              if (!position) return null;
              return (
                <div
                  key={posId}
                  draggable
                  data-position-id={posId}
                  data-section-id={sectionId}
                  data-item-type="position"
                  onDragStart={(e) => {
                    e.stopPropagation();
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('application/position-id', posId);
                    e.dataTransfer.setData('application/section-id', sectionId);
                    e.dataTransfer.setData('application/item-type', 'position');
                    setDraggedPositionId(posId);
                  }}
                  onDragEnd={() => {
                    setDraggedPositionId(null);
                  }}
                  onDragOver={(e) => {
                    const draggedType = e.dataTransfer.types.includes('application/position-id') ? 'position' : null;
                    if (!draggedType) return;

                    // Check if from same section using types (getData not available in dragOver)
                    // We'll verify in onDrop
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    const draggedId = e.dataTransfer.getData('application/position-id');
                    const draggedSection = e.dataTransfer.getData('application/section-id');

                    if (draggedId && draggedId !== posId) {
                      if (draggedSection === sectionId) {
                        // Same section - reorder
                        handlePositionReorder(draggedId, posId, sectionId);
                      } else {
                        // Different section - move to this section
                        handleMovePositionToSection(draggedId, draggedSection, sectionId);
                      }
                      setDraggedPositionId(null);
                    }
                  }}
                  className={`group flex items-center gap-1 pr-2 py-1 text-xs rounded hover:bg-gray-50 ${
                    editorState.selectedItemId === posId ? 'bg-blue-50 text-blue-700' : 'text-gray-600'
                  } ${draggedPositionId === posId ? 'opacity-50' : ''}`}
                  style={{ paddingLeft: `${paddingLeft + 24}px` }}
                >
                  {/* Drag handle for positions */}
                  <GripVertical className="w-3 h-3 text-gray-400 cursor-grab flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                  <button
                    onClick={() => scrollToPosition(posId)}
                    className="flex items-center gap-1 flex-1 text-left"
                  >
                    <FileText className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">d.{section.ordinalNumber}.{posIndex + 1} {position.base || position.name}</span>
                  </button>
                </div>
              );
            })}
          </>
        )}
      </div>
    );
  };

  // Get target path for comment
  const getTargetPath = (itemId: string, itemType: 'section' | 'position' | 'resource'): string => {
    try {
      if (!estimateData?.sections || !estimateData?.positions) {
        return itemType === 'section' ? 'Dział' : itemType === 'position' ? 'Pozycja' : 'Nakład';
      }

      if (itemType === 'section') {
        const section = estimateData.sections[itemId];
        return section ? `Dz. ${section.ordinalNumber || '?'}` : 'Dział';
      } else if (itemType === 'position') {
        const position = estimateData.positions[itemId];
        if (!position) return 'Pozycja';
        // Find section containing this position
        for (const section of Object.values(estimateData.sections)) {
          if (!section?.positionIds) continue;
          const posIdx = section.positionIds.indexOf(itemId);
          if (posIdx !== -1) {
            return `Dz. ${section.ordinalNumber || '?'} » Poz. ${posIdx + 1}`;
          }
        }
        return 'Pozycja';
      } else {
        // Resource - find parent position
        for (const [posId, position] of Object.entries(estimateData.positions)) {
          if (!position?.resources) continue;
          const resIdx = position.resources.findIndex(r => r?.id === itemId);
          if (resIdx !== -1) {
            // Find section
            for (const section of Object.values(estimateData.sections)) {
              if (!section?.positionIds) continue;
              const posIdx = section.positionIds.indexOf(posId);
              if (posIdx !== -1) {
                return `Dz. ${section.ordinalNumber || '?'} » Poz. ${posIdx + 1} » Nakład ${resIdx + 1}`;
              }
            }
            return `Pozycja » Nakład ${resIdx + 1}`;
          }
        }
        return 'Nakład';
      }
    } catch (error) {
      console.error('Error getting target path:', error);
      return itemType === 'section' ? 'Dział' : itemType === 'position' ? 'Pozycja' : 'Nakład';
    }
  };

  // Scroll main table to a position and highlight it
  const scrollToPosition = (positionId: string) => {
    // Find parent section(s) and expand them
    const sectionsToExpand: string[] = [];
    const findSectionForPosition = (sectionId: string): boolean => {
      const section = estimateData.sections[sectionId];
      if (!section) return false;
      if (section.positionIds.includes(positionId)) {
        sectionsToExpand.push(sectionId);
        return true;
      }
      for (const subId of section.subsectionIds || []) {
        if (findSectionForPosition(subId)) {
          sectionsToExpand.push(sectionId);
          return true;
        }
      }
      return false;
    };
    for (const sectionId of estimateData.root.sectionIds) {
      findSectionForPosition(sectionId);
    }

    setEditorState(prev => ({
      ...prev,
      expandedSections: new Set([...prev.expandedSections, ...sectionsToExpand]),
      expandedPositions: new Set([...prev.expandedPositions, positionId]),
      selectedItemId: positionId,
      selectedItemType: 'position' as const,
    }));

    setHighlightedItemId(positionId);
    setTimeout(() => {
      rowRefs.current[positionId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
    setTimeout(() => setHighlightedItemId(null), 2500);
  };

  // Select item
  const selectItem = (itemId: string, itemType: 'section' | 'position' | 'resource') => {
    // Handle comment selection mode
    if (commentSelectionMode) {
      try {
        const targetPath = getTargetPath(itemId, itemType);
        const commentId = typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `comment-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const newComment: KosztorysComment = {
          id: commentId,
          userId: 'current-user',
          userName: 'Denys Krupka',
          userInitials: 'DK',
          text: '',
          createdAt: new Date().toISOString().split('T')[0],
          targetType: itemType,
          targetId: itemId,
          targetPath,
          category: 'none',
          completed: false,
        };
        setComments(prev => [newComment, ...prev]);
        setSelectedCommentId(commentId);
      } catch (error) {
        console.error('Error creating comment:', error);
      }
      setCommentSelectionMode(false);
      setLeftPanelMode('comments');
      return;
    }

    setEditorState(prev => ({
      ...prev,
      selectedItemId: itemId,
      selectedItemType: itemType,
    }));
  };

  // Toggle catalog item expand (also triggers lazy loading for tables)
  const toggleCatalogItem = (itemId: string, item?: CatalogItem) => {
    setExpandedCatalogItems(prev => {
      const newExpanded = new Set(prev);
      if (newExpanded.has(itemId)) {
        newExpanded.delete(itemId);
      } else {
        newExpanded.add(itemId);
        if (item) {
          // Check if children are already loaded (not just the empty placeholder array)
          const hasLoadedChildren = item.children && item.children.length > 0;
          if (item.type === 'table' && !loadedPositions.has(itemId)) {
            // Table: load positions
            loadPositionsForFolder(itemId);
          } else if (!hasLoadedChildren && item.type !== 'position') {
            // Catalog or chapter: load child folders
            loadChildFolders(itemId);
          }
        }
      }
      return newExpanded;
    });
  };

  // Filter catalog folders by search (for tree view - only filters loaded folders)
  const filterCatalogItems = (items: CatalogItem[], search: string): CatalogItem[] => {
    if (!search.trim()) return items;
    const lowerSearch = search.toLowerCase();

    return items.reduce((acc: CatalogItem[], item) => {
      const matchesCode = item.code.toLowerCase().includes(lowerSearch);
      const matchesName = item.name.toLowerCase().includes(lowerSearch);

      if (item.children && item.children.length > 0) {
        const filteredChildren = filterCatalogItems(item.children, search);
        if (filteredChildren.length > 0 || matchesCode || matchesName) {
          acc.push({ ...item, children: filteredChildren.length > 0 ? filteredChildren : item.children });
        }
      } else if (matchesCode || matchesName) {
        acc.push(item);
      }

      return acc;
    }, []);
  };

  // Search catalog via Supabase (for positions that aren't loaded yet)
  const searchCatalogDebounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchCatalogFromDb = (search: string) => {
    if (searchCatalogDebounceRef.current) {
      clearTimeout(searchCatalogDebounceRef.current);
    }

    if (!search.trim() || search.trim().length < 2) {
      setCatalogSearchResults(null);
      setCatalogSearchLoading(false);
      return;
    }

    setCatalogSearchLoading(true);
    searchCatalogDebounceRef.current = setTimeout(async () => {
      try {
        const { data, error } = await supabase
          .from('knr_positions')
          .select('*')
          .eq('is_system', true)
          .or(`basis.ilike.%${search.trim()}%,name.ilike.%${search.trim()}%`)
          .order('basis', { ascending: true })
          .limit(50);

        if (error) {
          console.error('Error searching catalog:', error);
          setCatalogSearchResults(null);
          return;
        }

        const results: CatalogItem[] = (data || []).map(pos => ({
          id: pos.xid,
          code: pos.basis,
          name: pos.name,
          type: 'position' as const,
          unit: pos.unit,
        }));

        setCatalogSearchResults(results);
      } catch (error) {
        console.error('Error searching catalog:', error);
      } finally {
        setCatalogSearchLoading(false);
      }
    }, 300);
  };

  // Render catalog tree
  const renderCatalogTree = (items: CatalogItem[], level: number): React.ReactNode => {
    const filteredItems = level === 0 && !catalogSearchResults ? filterCatalogItems(items, catalogSearch) : items;

    return filteredItems.map(item => {
      const isExpanded = expandedCatalogItems.has(item.id);
      const hasChildren = item.children !== undefined; // tables always expandable (positions loaded lazily)
      const isSelected = selectedCatalogItem?.id === item.id;
      const isPosition = item.type === 'position';
      const isLoading = loadingFolder === item.id;

      return (
        <div key={item.id}>
          <div
            className={`flex items-start gap-1 py-1.5 px-2 rounded cursor-pointer text-xs ${
              isSelected ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50'
            } ${isPosition ? 'border border-gray-200' : ''}`}
            style={{ paddingLeft: `${level * 12 + 8}px` }}
            onClick={() => {
              if (isPosition) {
                setSelectedCatalogItem(item);
                // Load resources lazily
                loadResourcesForPosition(item.id).then(norms => {
                  if (norms.length > 0) {
                    setSelectedCatalogItem(prev => prev?.id === item.id ? { ...prev, norms } : prev);
                  }
                });
                // Auto-set unit from position
                if (item.unit) {
                  setCatalogSelectedUnit(item.unit);
                }
              } else if (hasChildren) {
                toggleCatalogItem(item.id, item);
              }
            }}
          >
            {hasChildren ? (
              <button className="p-0.5 -ml-1 hover:bg-gray-200 rounded flex-shrink-0">
                {isLoading ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : isExpanded ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
              </button>
            ) : isPosition ? (
              <FileText className="w-3 h-3 text-gray-400 flex-shrink-0 mt-0.5" />
            ) : (
              <div className="w-4" />
            )}
            <div className="flex-1 min-w-0">
              <div className={`font-mono ${isPosition ? 'text-blue-600' : 'text-gray-600'}`}>
                {item.code}
              </div>
              {item.name && (
                <div className="text-gray-500" title={item.name}>
                  {item.name}
                </div>
              )}
            </div>
          </div>
          {hasChildren && isExpanded && (
            <div>
              {renderCatalogTree(item.children || [], level + 1)}
              {isLoading && (
                <div className="flex items-center gap-1 py-1 text-xs text-gray-400" style={{ paddingLeft: `${(level + 1) * 12 + 8}px` }}>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Ładowanie pozycji...
                </div>
              )}
            </div>
          )}
        </div>
      );
    });
  };

  // Insert position from catalog
  const insertFromCatalog = (catalogItem: CatalogItem) => {
    if (!catalogItem || catalogItem.type !== 'position') return;

    // Use selected unit from dropdown (raw unit string from knr_positions)
    const selectedUnit = catalogSelectedUnit;
    const unitRef = UNITS_REFERENCE.find(u => u.unit === selectedUnit);
    const unitLabel = selectedUnit;
    const unitIndex = unitRef?.index || '060';
    const newPosition = createNewPosition(
      catalogItem.code,
      catalogItem.name,
      unitLabel,
      unitIndex
    );

    // Add measurement
    const quantity = parseFloat(catalogQuantity) || 0;
    if (quantity > 0) {
      newPosition.measurements = addMeasurementEntry(
        newPosition.measurements,
        catalogQuantity,
        'Przedmiar'
      );
    }

    // Set multiplication factor
    newPosition.multiplicationFactor = parseFloat(catalogMultiplier) || 1;

    // Add resources from catalog norms
    if (catalogItem.norms) {
      for (const norm of catalogItem.norms) {
        const resourceUnit = UNITS_REFERENCE.find(u => u.unit === norm.unit) || UNITS_REFERENCE[0];
        // Use resource name from catalog if available, otherwise use default
        const resourceName = norm.name ||
          (norm.type === 'labor' ? 'Robotnicy' : norm.type === 'equipment' ? 'Sprzęt' : 'Materiał');
        const resource = createNewResource(
          (norm.type === 'waste' ? 'material' : norm.type) as 'labor' | 'material' | 'equipment',
          resourceName,
          norm.value,
          0, // Price will be set later
          resourceUnit.unit,
          resourceUnit.index
        );
        // Set index for price lookup if available
        if (norm.index) {
          resource.index = norm.index;
          resource.originIndex = { type: 'knr', index: norm.index };
        }
        newPosition.resources.push(resource);
      }
    }

    // Find target section - use selected section or find a section to add to
    let targetSectionId: string | null = null;

    if (editorState.selectedItemType === 'section' && editorState.selectedItemId) {
      targetSectionId = editorState.selectedItemId;
    } else if (editorState.selectedItemType === 'position' && editorState.selectedItemId) {
      // Find which section contains the selected position
      for (const [secId, section] of Object.entries(estimateData.sections)) {
        if (section.positionIds.includes(editorState.selectedItemId)) {
          targetSectionId = secId;
          break;
        }
      }
    }

    // If no section selected, try to use the first section
    if (!targetSectionId && estimateData.root.sectionIds.length > 0) {
      targetSectionId = estimateData.root.sectionIds[0];
    }

    // If still no section, show error
    if (!targetSectionId) {
      showNotificationMessage('Najpierw dodaj dział, aby móc dodać pozycję', 'warning');
      return;
    }

    // Add to estimate
    const newData = { ...estimateData };
    newData.positions = { ...newData.positions, [newPosition.id]: newPosition };

    // Add position to the target section
    const targetSection = newData.sections[targetSectionId];
    if (targetSection) {
      newData.sections = {
        ...newData.sections,
        [targetSectionId]: {
          ...targetSection,
          positionIds: [...targetSection.positionIds, newPosition.id],
        },
      };
    }

    updateEstimateData(newData);
    setLeftPanelMode('overview');

    setEditorState(prev => ({
      ...prev,
      selectedItemId: newPosition.id,
      selectedItemType: 'position',
      expandedPositions: new Set([...prev.expandedPositions, newPosition.id]),
      expandedSections: new Set([...prev.expandedSections, targetSectionId!]),
    }));

    showNotificationMessage(`Dodano pozycję: ${catalogItem.code}`, 'success');
  };

  // Add uncatalogued position (pozycja nieskatalogowana) - instantly creates position and opens properties panel
  const handleAddUncataloguedPosition = () => {
    // Find target section
    let targetSectionId: string | null = null;

    if (editorState.selectedItemType === 'section' && editorState.selectedItemId) {
      targetSectionId = editorState.selectedItemId;
    } else if (editorState.selectedItemType === 'position' && editorState.selectedItemId) {
      // Find which section contains the selected position
      for (const [secId, section] of Object.entries(estimateData.sections)) {
        if (section.positionIds.includes(editorState.selectedItemId)) {
          targetSectionId = secId;
          break;
        }
      }
    }

    // If no section selected, try to use the first section
    if (!targetSectionId && estimateData.root.sectionIds.length > 0) {
      targetSectionId = estimateData.root.sectionIds[0];
    }

    // If still no section, show error
    if (!targetSectionId) {
      showNotificationMessage('Najpierw dodaj dział, aby móc dodać pozycję', 'warning');
      return;
    }

    // Create new empty position
    const newPosition = createNewPosition('', 'Nowa pozycja', 'szt.', '020');

    // Add to estimate
    const newData = { ...estimateData };
    newData.positions = { ...newData.positions, [newPosition.id]: newPosition };
    newData.sections = {
      ...newData.sections,
      [targetSectionId]: {
        ...newData.sections[targetSectionId],
        positionIds: [...newData.sections[targetSectionId].positionIds, newPosition.id],
      },
    };

    updateEstimateData(newData);

    // Select position and open properties panel
    setEditorState(prev => ({
      ...prev,
      selectedItemId: newPosition.id,
      selectedItemType: 'position',
      expandedSections: new Set([...prev.expandedSections, targetSectionId!]),
      expandedPositions: new Set([...prev.expandedPositions, newPosition.id]),
    }));

    setLeftPanelMode('properties');

    // Highlight and scroll to the new position
    setHighlightedItemId(newPosition.id);
    setTimeout(() => {
      const rowElement = rowRefs.current[newPosition.id];
      if (rowElement) {
        rowElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
    setTimeout(() => {
      setHighlightedItemId(null);
    }, 2000);

    showNotificationMessage('Dodano nową pozycję', 'success');
  };

  // Check estimate for errors (Sprawdź kosztorys)
  const handleSprawdzKosztorys = () => {
    const newAlerts: typeof alerts = [];

    // Helper: build path string showing section names
    const buildPath = (positionId: string): string => {
      const pathParts: string[] = [];
      const findInSection = (sectionId: string, ancestors: string[]): boolean => {
        const section = estimateData.sections[sectionId];
        if (!section) return false;
        const current = [...ancestors, section.name];
        if (section.positionIds.includes(positionId)) {
          pathParts.push(...current);
          return true;
        }
        for (const subId of section.subsectionIds || []) {
          if (findInSection(subId, current)) return true;
        }
        return false;
      };
      for (const sectionId of estimateData.root.sectionIds) {
        if (findInSection(sectionId, [])) break;
      }
      return pathParts.join(' \\ ') || '';
    };

    const resourceTypeLabel = (type: string) => {
      switch (type) {
        case 'labor': return 'Robocizna';
        case 'material': return 'Materiał';
        case 'equipment': return 'Sprzęt';
        default: return type;
      }
    };

    // Check all positions
    Object.values(estimateData.positions).forEach((position, index) => {
      const posPath = buildPath(position.id);
      const posName = position.name || `Pozycja ${index + 1}`;

      // Check for empty name
      if (!position.name.trim()) {
        newAlerts.push({
          id: `${position.id}-name`,
          type: 'error',
          message: `Pozycja ${index + 1}`,
          reason: 'Brak nazwy',
          path: posPath,
          itemType: 'Pozycja',
          itemName: '-',
          positionId: position.id,
          positionName: position.name,
        });
      }

      // Check for zero quantity
      const posResult = calculationResult?.positions[position.id];
      if (!posResult?.quantity || posResult.quantity === 0) {
        newAlerts.push({
          id: `${position.id}-qty`,
          type: 'warning',
          message: posName,
          reason: 'Przedmiar równy 0',
          path: posPath,
          itemType: 'Pozycja',
          itemName: '-',
          positionId: position.id,
          positionName: position.name,
        });
      }

      // Check resources for zero prices
      position.resources.forEach((resource) => {
        if (resource.unitPrice.value === 0) {
          newAlerts.push({
            id: `${resource.id}-price`,
            type: 'warning',
            message: posName,
            reason: 'Cena zerowa',
            path: posPath,
            itemType: `Nakład (${resourceTypeLabel(resource.type)})`,
            itemName: resource.name || '-',
            positionId: position.id,
            positionName: position.name,
          });
        }
      });

      // Check if position has no resources
      if (position.resources.length === 0) {
        newAlerts.push({
          id: `${position.id}-nores`,
          type: 'warning',
          message: posName,
          reason: 'Brak nakładów',
          path: posPath,
          itemType: 'Pozycja',
          itemName: '-',
          positionId: position.id,
          positionName: position.name,
        });
      }
    });

    setAlerts(newAlerts);
    setAlertsCount({ current: 0, total: newAlerts.length });

    if (newAlerts.length === 0) {
      showNotificationMessage('Kosztorys nie zawiera błędów', 'success');
    } else {
      showNotificationMessage(`Znaleziono ${newAlerts.length} alertów`, 'error');
    }
  };

  // Paste from clipboard
  const handlePaste = () => {
    if (!editorState.clipboard) return;

    const { id, type, action } = editorState.clipboard;

    if (type === 'position') {
      const sourcePosition = estimateData.positions[id];
      if (!sourcePosition) return;

      // Create a copy of the position
      const newPosition = {
        ...sourcePosition,
        id: `pos-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: action === 'cut' ? sourcePosition.name : `${sourcePosition.name} (kopia)`,
        resources: sourcePosition.resources.map(r => ({
          ...r,
          id: `res-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        })),
      };

      // Add to data
      const newData = { ...estimateData };
      newData.positions = { ...newData.positions, [newPosition.id]: newPosition };
      newData.root = {
        ...newData.root,
        positionIds: [...newData.root.positionIds, newPosition.id],
      };

      // If cut, remove original
      if (action === 'cut') {
        delete newData.positions[id];
        newData.root.positionIds = newData.root.positionIds.filter(pid => pid !== id);
        // Also check sections
        Object.keys(newData.sections).forEach(secId => {
          if (newData.sections[secId].positionIds.includes(id)) {
            newData.sections[secId] = {
              ...newData.sections[secId],
              positionIds: newData.sections[secId].positionIds.filter(pid => pid !== id),
            };
          }
        });
      }

      updateEstimateData(newData);
      setEditorState(prev => ({
        ...prev,
        clipboard: action === 'cut' ? null : prev.clipboard,
        selectedItemId: newPosition.id,
        selectedItemType: 'position',
      }));

      showNotificationMessage(action === 'cut' ? 'Pozycja przeniesiona' : 'Pozycja skopiowana', 'success');
    } else if (type === 'section') {
      const sourceSection = estimateData.sections[id];
      if (!sourceSection) return;

      const newSection = {
        ...sourceSection,
        id: `sec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: action === 'cut' ? sourceSection.name : `${sourceSection.name} (kopia)`,
        positionIds: [],
      };

      // Copy positions too
      const newPositions: Record<string, KosztorysPosition> = {};
      sourceSection.positionIds.forEach(posId => {
        const pos = estimateData.positions[posId];
        if (pos) {
          const newPosId = `pos-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          newPositions[newPosId] = {
            ...pos,
            id: newPosId,
            resources: pos.resources.map(r => ({
              ...r,
              id: `res-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            })),
          };
          newSection.positionIds.push(newPosId);
        }
      });

      const newData = { ...estimateData };
      newData.sections = { ...newData.sections, [newSection.id]: newSection };
      newData.positions = { ...newData.positions, ...newPositions };
      newData.root = {
        ...newData.root,
        sectionIds: [...newData.root.sectionIds, newSection.id],
      };

      if (action === 'cut') {
        delete newData.sections[id];
        sourceSection.positionIds.forEach(posId => {
          delete newData.positions[posId];
        });
        newData.root.sectionIds = newData.root.sectionIds.filter(sid => sid !== id);
      }

      updateEstimateData(newData);
      setEditorState(prev => ({
        ...prev,
        clipboard: action === 'cut' ? null : prev.clipboard,
        selectedItemId: newSection.id,
        selectedItemType: 'section',
      }));

      showNotificationMessage(action === 'cut' ? 'Dział przeniesiony' : 'Dział skopiowany', 'success');
    }
  };

  // Navigate to alert with scroll and highlight
  const handleNavigateToAlert = (alertIndex: number) => {
    if (alertIndex >= 0 && alertIndex < alerts.length) {
      const alert = alerts[alertIndex];
      setAlertsCount(prev => ({ ...prev, current: alertIndex }));

      if (alert.resourceId && alert.positionId) {
        // Alert is for a resource - find and expand parent section and position
        selectItem(alert.resourceId, 'resource');

        // Find which section contains this position and expand it
        const sectionsToExpand: string[] = [];
        const findSectionForPosition = (sectionId: string): boolean => {
          const section = estimateData.sections[sectionId];
          if (!section) return false;
          if (section.positionIds.includes(alert.positionId!)) {
            sectionsToExpand.push(sectionId);
            return true;
          }
          for (const subId of section.subsectionIds || []) {
            if (findSectionForPosition(subId)) {
              sectionsToExpand.push(sectionId);
              return true;
            }
          }
          return false;
        };
        for (const sectionId of estimateData.root.sectionIds) {
          findSectionForPosition(sectionId);
        }

        setEditorState(prev => ({
          ...prev,
          expandedSections: new Set([...prev.expandedSections, ...sectionsToExpand]),
          expandedPositions: new Set([...prev.expandedPositions, alert.positionId!]),
        }));

        // Highlight the resource
        setHighlightedItemId(alert.resourceId);

        // Scroll to the resource row after a short delay to allow DOM update
        setTimeout(() => {
          const rowElement = rowRefs.current[alert.resourceId!];
          if (rowElement) {
            rowElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 100);

        // Clear highlight after animation
        setTimeout(() => {
          setHighlightedItemId(null);
        }, 2000);
      } else if (alert.positionId) {
        // Alert is for a position - find and expand its parent section
        selectItem(alert.positionId, 'position');

        // Find which section contains this position and expand it
        const sectionsToExpand: string[] = [];
        const findSectionForPosition = (sectionId: string): boolean => {
          const section = estimateData.sections[sectionId];
          if (!section) return false;
          if (section.positionIds.includes(alert.positionId!)) {
            sectionsToExpand.push(sectionId);
            return true;
          }
          for (const subId of section.subsectionIds || []) {
            if (findSectionForPosition(subId)) {
              sectionsToExpand.push(sectionId);
              return true;
            }
          }
          return false;
        };
        for (const sectionId of estimateData.root.sectionIds) {
          findSectionForPosition(sectionId);
        }

        setEditorState(prev => ({
          ...prev,
          expandedSections: new Set([...prev.expandedSections, ...sectionsToExpand]),
          expandedPositions: new Set([...prev.expandedPositions, alert.positionId!]),
        }));

        // Highlight the position
        setHighlightedItemId(alert.positionId);

        // Scroll to the position row after a short delay to allow DOM update
        setTimeout(() => {
          const rowElement = rowRefs.current[alert.positionId!];
          if (rowElement) {
            rowElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 100);

        // Clear highlight after animation
        setTimeout(() => {
          setHighlightedItemId(null);
        }, 2000);
      }
    }
  };

  // Scroll to export section when clicked in left panel
  const scrollToExportSection = (sectionId: string) => {
    setActiveExportSection(sectionId);
    const sectionRef = sectionRefs.current[sectionId];
    if (sectionRef && printPreviewRef.current) {
      sectionRef.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Handle print document
  const handlePrintDocument = () => {
    const printContent = printPreviewRef.current;
    if (!printContent) return;

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const styles = `
      <style>
        @page {
          margin: 15mm 20mm;
          size: A4;
        }
        @media print {
          html, body {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .no-print { display: none !important; }
        }
        body {
          font-family: Arial, sans-serif;
          font-size: 12px;
          line-height: 1.5;
          margin: 0;
          padding: 0;
        }
        .print-section {
          page-break-after: always;
          padding: 0;
        }
        .print-section:last-child { page-break-after: auto; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 1em; }
        th, td { border: 1px solid #333; padding: 6px 8px; text-align: left; }
        th { background: #f5f5f5; font-weight: 600; }
        .text-right { text-align: right; }
        .text-center { text-align: center; }
        h1, h2, h3 { margin: 0 0 0.5em 0; }

        /* Title page styles */
        .title-page-content {
          min-height: 85vh;
          display: flex;
          flex-direction: column;
        }
        .company-header {
          text-align: right;
          margin-bottom: 40px;
          line-height: 1.6;
        }
        .main-title {
          text-align: center;
          font-size: 28px;
          font-weight: bold;
          margin: 40px 0 50px 0;
        }
        .details-section {
          flex: 1;
        }
        .detail-group {
          margin-bottom: 24px;
        }
        .detail-row {
          display: flex;
          margin-bottom: 6px;
          line-height: 1.6;
        }
        .detail-label {
          width: 220px;
          color: #555;
          flex-shrink: 0;
        }
        .detail-value {
          flex: 1;
        }
        .dates-section {
          margin-top: 40px;
          padding-top: 20px;
          border-top: 1px solid #ccc;
        }
        .dates-row {
          display: flex;
          justify-content: space-between;
        }
        .date-block {
          line-height: 1.6;
        }
        .date-label {
          color: #555;
          font-size: 11px;
        }
        .page-number {
          text-align: right;
          font-size: 10px;
          color: #999;
          margin-top: 20px;
        }
      </style>
    `;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html lang="pl">
      <head>
        <meta charset="UTF-8">
        <title>${titlePageData.title || estimate?.settings.name || 'Kosztorys'}</title>
        ${styles}
      </head>
      <body>
        ${printContent.innerHTML}
      </body>
      </html>
    `);

    printWindow.document.close();
    printWindow.onload = () => {
      printWindow.print();
      printWindow.close();
    };
  };

  // Export to CSV
  const handleExportCSV = () => {
    if (!estimate || !calculationResult) return;

    let csv = 'Lp.;Podstawa;Nakład;j.m.;Nakład j.;Ceny jedn.;Koszt jedn.;Ilość;Wartość\n';

    let positionNumber = 0;
    const allPositionIds = [
      ...estimateData.root.positionIds,
      ...Object.values(estimateData.sections).flatMap(s => s.positionIds),
    ];

    for (const posId of allPositionIds) {
      const position = estimateData.positions[posId];
      if (!position) continue;

      positionNumber++;
      const result = calculationResult.positions[posId];
      const quantity = result?.quantity || 0;
      const unitCost = result?.unitCost || 0;
      const total = result?.totalWithOverheads || 0;

      csv += `${positionNumber};${position.base};${position.name};${position.unit.label};;${formatNumber(unitCost)};${formatNumber(unitCost)};${formatNumber(quantity)};${formatNumber(total)}\n`;

      for (const resource of position.resources) {
        const resResult = result?.resources.find(r => r.id === resource.id);
        const config = RESOURCE_TYPE_CONFIG[resource.type];
        csv += `;${config.shortLabel};${resource.originIndex.index};${resource.name};${resource.unit.label};${formatNumber(resResult?.calculatedQuantity || 0)};${formatNumber(resource.unitPrice.value)};;${formatNumber(resResult?.calculatedValue || 0)}\n`;
      }
    }

    csv += `\n;;;;;Razem koszty bezpośrednie;;;${formatNumber(calculationResult.totalDirect)}\n`;
    csv += `;;;;;Razem z narzutami;;;${formatNumber(calculationResult.totalValue)}\n`;

    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${estimate.settings.name || 'kosztorys'}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    showNotificationMessage('Eksport do CSV zakończony', 'success');
  };

  // Section depth colors for visual hierarchy
  const sectionDepthColors = [
    { border: 'border-l-4 border-l-blue-500', bg: 'bg-blue-50', headerBg: 'bg-blue-100' },      // depth 0 - main section
    { border: 'border-l-4 border-l-emerald-500', bg: 'bg-emerald-50', headerBg: 'bg-emerald-100' }, // depth 1
    { border: 'border-l-4 border-l-amber-500', bg: 'bg-amber-50', headerBg: 'bg-amber-100' },      // depth 2
    { border: 'border-l-4 border-l-purple-500', bg: 'bg-purple-50', headerBg: 'bg-purple-100' },   // depth 3
    { border: 'border-l-4 border-l-rose-500', bg: 'bg-rose-50', headerBg: 'bg-rose-100' },         // depth 4+
  ];

  const getDepthColors = (depth: number) => sectionDepthColors[Math.min(depth, sectionDepthColors.length - 1)];

  // Render position row
  const renderPositionRow = (position: KosztorysPosition, positionNumber: number, sectionId: string | null, sectionDepth: number = 0) => {
    const isExpanded = editorState.expandedPositions.has(position.id);
    const isSelected = editorState.selectedItemId === position.id;
    const result = calculationResult?.positions[position.id];
    const quantity = result?.quantity || 0;
    const depthColors = getDepthColors(sectionDepth);

    // Przedmiar view - matching eKosztorysowanie layout
    if (viewMode === 'przedmiar') {
      const sectionPrefix = sectionId ? 'd.1.' : 'd.';
      return (
        <React.Fragment key={position.id}>
          {/* Position header row */}
          <tr
            className={`border-b border-gray-100 hover:bg-gray-50 cursor-pointer ${depthColors.border} ${isSelected ? 'bg-blue-100' : depthColors.bg}`}
            onClick={() => selectItem(position.id, 'position')}
          >
            <td className="px-3 py-2 text-sm align-top">
              <div className="flex flex-col items-center">
                <button
                  onClick={(e) => { e.stopPropagation(); toggleExpandPosition(position.id); }}
                  className="w-6 h-6 rounded-full border-2 border-blue-600 flex items-center justify-center text-xs font-bold text-blue-600 hover:bg-blue-50"
                >
                  {positionNumber}
                </button>
                <span className="text-xs text-gray-400 mt-0.5">{sectionPrefix}{positionNumber}</span>
              </div>
            </td>
            <td className="px-3 py-2 text-sm font-mono text-gray-800 align-top">{position.base || ''}</td>
            <td className="px-3 py-2 text-sm text-gray-900 align-top" colSpan={2}>{position.name}</td>
            <td className="px-3 py-2 text-sm text-right text-gray-800 align-top">{position.unit.label}</td>
            <td className="px-3 py-2 text-sm text-right align-top"></td>
          </tr>
          {/* Measurement rows */}
          {position.measurements.rootIds.map((measureId, idx) => {
            const measure = position.measurements.entries[measureId];
            if (!measure) return null;
            const measureValue = evaluateMeasurementExpression(measure.expression) || 0;
            return (
              <tr key={measureId} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="px-3 py-1 text-sm"></td>
                <td className="px-3 py-1 text-sm text-gray-500">{measure.description || ''}</td>
                <td className="px-3 py-1 text-sm text-gray-600" colSpan={2}>{measure.expression || ''}</td>
                <td className="px-3 py-1 text-sm text-right text-gray-500">{position.unit.label}</td>
                <td className="px-3 py-1 text-sm text-right text-gray-700">{formatNumber(measureValue, 2)}</td>
              </tr>
            );
          })}
          {/* Razem row */}
          <tr className="border-b border-gray-200">
            <td colSpan={4}></td>
            <td className="px-3 py-1.5 text-sm text-right text-gray-500">Razem</td>
            <td className="px-3 py-1.5 text-sm text-right font-medium text-gray-900">{formatNumber(quantity, 2)}</td>
          </tr>
        </React.Fragment>
      );
    }

    // Pozycje view - matching eKosztorysowanie reference layout
    if (viewMode === 'pozycje') {
      const sectionPrefix = sectionId ? 'd.1.' : 'd.';
      return (
        <tr
          key={position.id}
          className={`cursor-pointer ${depthColors.border} ${isSelected ? 'bg-blue-100' : depthColors.bg + ' hover:brightness-95'}`}
          onClick={() => selectItem(position.id, 'position')}
        >
          <td className="px-3 py-3 text-sm border border-gray-300 align-top">
            <div className="flex flex-col items-center">
              <span className="text-sm font-medium text-blue-600">{positionNumber}</span>
              <span className="text-xs text-gray-500">{sectionPrefix}{positionNumber}</span>
            </div>
          </td>
          <td className="px-3 py-3 text-sm font-mono text-gray-800 border border-gray-300 align-top">{position.base || ''}</td>
          <td className="px-3 py-3 text-sm text-gray-900 border border-gray-300 align-top">{position.name}</td>
          <td className="px-3 py-3 text-sm text-center text-gray-600 border border-gray-300 align-top">{position.unit.label}</td>
          <td className="px-3 py-3 text-sm text-right text-gray-800 border border-gray-300 align-top">{formatNumber(quantity, 2)}</td>
          <td className="px-3 py-3 text-sm text-right text-gray-800 border border-gray-300 align-top">{formatNumber(result?.unitCost || 0, 3)}</td>
          <td className="px-3 py-3 text-sm text-right font-medium text-gray-900 border border-gray-300 align-top">{formatNumber(result?.totalWithOverheads || 0, 3)}</td>
        </tr>
      );
    }

    // Nakłady view
    if (viewMode === 'naklady') {
      return (
        <React.Fragment key={position.id}>
          {position.resources.map((resource, index) => {
            const config = RESOURCE_TYPE_CONFIG[resource.type] || RESOURCE_TYPE_CONFIG.material;
            const resResult = result?.resources.find(r => r.id === resource.id);
            const isResourceSelected = editorState.selectedItemId === resource.id;
            const resQuantity = resResult?.calculatedQuantity || resource.norm.value * quantity;

            return (
              <tr
                key={resource.id}
                className={`border-b border-gray-100 cursor-pointer ${depthColors.border} ${isResourceSelected ? 'bg-blue-100' : depthColors.bg + ' hover:brightness-95'}`}
                onClick={() => selectItem(resource.id, 'resource')}
              >
                <td className="px-3 py-2 text-sm">
                  <span className="flex items-center gap-1">
                    {index + 1}
                    <span className={`w-2 h-2 rounded-full ${
                      resource.type === 'labor' ? 'bg-blue-500' :
                      resource.type === 'material' ? 'bg-green-500' : 'bg-orange-500'
                    }`}></span>
                  </span>
                </td>
                <td className="px-3 py-2 text-sm font-mono text-gray-600">{resource.originIndex.index || '-'}</td>
                <td className="px-3 py-2 text-sm text-gray-800">{resource.name}</td>
                <td className="px-3 py-2 text-sm text-right text-gray-600">{resource.unit.label}</td>
                <td className={`px-3 py-2 text-sm text-right ${viewOptionsPanel.highlightZeroPrices && resource.unitPrice.value === 0 ? 'text-amber-600 font-semibold bg-amber-50' : 'text-gray-600'}`}>{formatNumber(resource.unitPrice.value, 3)}</td>
                <td className="px-3 py-2 text-sm text-right text-gray-600">{formatNumber(resQuantity, 2)}</td>
                <td className="px-3 py-2 text-sm text-right font-medium">{formatNumber(resResult?.calculatedValue || 0, 2)}</td>
                <td className="px-3 py-2 text-sm text-right text-gray-500">{formatNumber(0, 3)}</td>
                <td className="px-3 py-2 text-sm text-right text-gray-600">{formatNumber(resQuantity, 3)}</td>
              </tr>
            );
          })}
        </React.Fragment>
      );
    }

    // Kosztorys view (default) - matching eKosztorysowanie layout
    const sectionPrefix = sectionId ? 'd.1.' : 'd.';

    // Handle position click - only select, don't toggle expand (expand only via chevron)
    const handlePositionClick = () => {
      selectItem(position.id, 'position');
    };

    return (
      <React.Fragment key={position.id}>
        {/* Position row */}
        <tr
          ref={(el) => { rowRefs.current[position.id] = el; }}
          className={`border-b border-gray-100 cursor-pointer ${depthColors.border} ${isSelected ? 'bg-blue-100' : depthColors.bg + ' hover:brightness-95'} ${highlightedItemId === position.id ? 'animate-pulse ring-2 ring-yellow-400 bg-yellow-50' : ''}`}
          onClick={handlePositionClick}
        >
          <td className="px-3 py-2 text-sm align-top">
            <div className="flex flex-col items-center">
              <div className="flex items-center gap-1">
                {position.resources.length > 0 ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleExpandPosition(position.id); }}
                    className="p-0.5 hover:bg-gray-200 rounded"
                  >
                    {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                  </button>
                ) : (
                  <span className="w-5 h-4" />
                )}
                <span
                  className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs font-bold ${isExpanded ? 'bg-blue-600 text-white border-blue-600' : 'border-blue-600 text-blue-600'}`}
                >
                  {positionNumber}
                </span>
              </div>
              <span className="text-xs text-gray-400 mt-0.5">{sectionPrefix}{positionNumber}</span>
            </div>
          </td>
          <td className="px-3 py-2 text-sm align-top">
            <div className="text-xs text-gray-800 font-mono">{position.base || ''}</div>
            {position.marker && (
              <span className="mt-1 inline-block px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded border border-gray-200">
                {POSITION_TAGS.find(t => t.id === position.marker)?.label || position.marker}
              </span>
            )}
          </td>
          <td className="px-3 py-2 text-sm align-top">
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <div className="font-medium text-gray-900">{position.name}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  Przedmiar z sumami = {formatNumber(quantity, 2)} {position.unit.label}
                </div>
              </div>
              {/* Comment tag */}
              {(() => {
                const positionComments = comments.filter(c =>
                  c.targetId === position.id && (showCompletedTasks || !c.completed)
                );
                if (!showCommentsOnSheet || positionComments.length === 0) return null;

                // Get primary category for color (first non-completed comment)
                const primaryComment = positionComments[0];
                const colorClass = primaryComment?.category === 'verification'
                  ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                  : primaryComment?.category === 'completion'
                  ? 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200';

                return (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (positionComments.length > 0) {
                        setSelectedCommentId(positionComments[0].id);
                        setLeftPanelMode('comments');
                      }
                    }}
                    className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${colorClass}`}
                  >
                    <MessageSquare className="w-3 h-3" />
                    {positionComments.length}
                  </button>
                );
              })()}
            </div>
          </td>
          <td className="px-3 py-2 text-sm text-right text-gray-600 align-top">{position.unit.label}</td>
          <td className="px-3 py-2 text-sm text-right text-gray-600 align-top">{formatNumber(quantity, 2)}</td>
          <td className="px-3 py-2 text-sm text-right text-gray-600 align-top">{formatNumber(result?.unitCost || 0, 3)}</td>
          <td className="px-3 py-2 text-sm text-right align-top"></td>
          <td className="px-3 py-2 text-sm text-right align-top"></td>
          <td className="px-3 py-2 text-sm text-right align-top"></td>
        </tr>

        {/* Resources rows when expanded */}
        {isExpanded && position.resources.map((resource, index) => {
          const config = RESOURCE_TYPE_CONFIG[resource.type] || RESOURCE_TYPE_CONFIG.material;
          const resResult = result?.resources.find(r => r.id === resource.id);
          const isResourceSelected = editorState.selectedItemId === resource.id;
          const resQuantity = resResult?.calculatedQuantity || resource.norm.value * quantity;

          // Calculate values for R, M, S columns
          const rValue = resource.type === 'labor' ? resResult?.calculatedValue || 0 : 0;
          const mValue = resource.type === 'material' ? resResult?.calculatedValue || 0 : 0;
          const sValue = resource.type === 'equipment' ? resResult?.calculatedValue || 0 : 0;

          return (
            <React.Fragment key={resource.id}>
              {/* R/M/S badge row */}
              <tr className="border-b border-gray-50">
                <td className="px-3 py-0.5"></td>
                <td className="px-3 py-0.5" colSpan={8}>
                  <span className="inline-block px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 rounded border border-gray-200">
                    {config.shortLabel}
                  </span>
                </td>
              </tr>
              {/* Resource data row */}
              <tr
                ref={(el) => { rowRefs.current[resource.id] = el; }}
                className={`border-b border-gray-100 hover:bg-gray-50 cursor-pointer ${isResourceSelected ? 'bg-blue-50' : ''} ${highlightedItemId === resource.id ? 'animate-pulse ring-2 ring-yellow-400 bg-yellow-50' : ''} ${viewOptionsPanel.highlightZeroPrices && resource.unitPrice.value === 0 ? 'bg-amber-50' : ''}`}
                onClick={() => selectItem(resource.id, 'resource')}
              >
                <td className="px-3 py-1.5 text-sm">
                  <span className="flex items-center gap-0.5">
                    <span className="text-gray-600">{index + 1}</span>
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      resource.type === 'labor' ? 'bg-blue-500' :
                      resource.type === 'material' ? 'bg-green-500' : 'bg-orange-500'
                    }`}></span>
                  </span>
                </td>
                <td className="px-3 py-1.5 text-sm font-mono text-gray-600">{resource.originIndex.index || ''}</td>
                <td className="px-3 py-1.5 text-sm">
                  <div className="text-gray-800">{resource.name}</div>
                  <div className="text-xs text-gray-400 font-mono mt-0.5">
                    {resource.factor !== 1 ? `${formatNumber(resource.factor, 1)} · ` : ''}
                    {formatNumber(resource.norm.value, 2)} · {formatNumber(quantity, 2)}{resource.unit.label}/{position.unit.label} · {formatNumber(resource.unitPrice.value, 2)}PLN/{resource.unit.label}
                  </div>
                </td>
                <td className="px-3 py-1.5 text-sm text-right text-gray-500">{resource.unit.label}</td>
                <td className="px-3 py-1.5 text-sm text-right text-gray-600">{formatNumber(resQuantity, 1)}</td>
                <td className={`px-3 py-1.5 text-sm text-right ${viewOptionsPanel.highlightZeroPrices && resource.unitPrice.value === 0 ? 'text-amber-600 font-semibold' : 'text-gray-600'}`}>{formatNumber(resResult?.calculatedValue || 0, 3)}</td>
                <td className="px-3 py-1.5 text-sm text-right text-gray-600">{rValue > 0 ? formatNumber(rValue, 2) : ''}</td>
                <td className="px-3 py-1.5 text-sm text-right text-gray-600">{mValue > 0 ? formatNumber(mValue, 2) : ''}</td>
                <td className="px-3 py-1.5 text-sm text-right text-gray-600">{sValue > 0 ? formatNumber(sValue, 2) : ''}</td>
              </tr>
            </React.Fragment>
          );
        })}

        {/* Summary rows when expanded */}
        {isExpanded && (
          <>
            <tr className="border-b border-gray-100">
              <td colSpan={5}></td>
              <td className="px-3 py-1 text-xs text-right text-gray-500">RAZEM: {formatNumber(quantity, 1)}</td>
              <td colSpan={3}></td>
            </tr>
            <tr className="border-b border-gray-100">
              <td colSpan={5} className="px-3 py-1 text-xs text-gray-600 text-right">Razem koszty bezpośrednie</td>
              <td className="px-3 py-1 text-xs text-right">{formatNumber(result?.directCostsTotal || 0, 3)}</td>
              <td className="px-3 py-1 text-xs text-right text-gray-500">{formatNumber(0, 3)}</td>
              <td className="px-3 py-1 text-xs text-right">{formatNumber(result?.directCostsTotal || 0, 2)}</td>
              <td></td>
            </tr>
            {/* Detailed overhead breakdown */}
            {viewOptionsPanel.showDetailedOverheads && (() => {
              const kpOverhead = estimateData.root.overheads.find(o => o.name.includes('Kp'));
              const zOverhead = estimateData.root.overheads.find(o => o.name.includes('Zysk'));
              const kzOverhead = estimateData.root.overheads.find(o => o.name.includes('zakupu'));

              const laborTotal = result?.laborTotal || 0;
              const materialTotal = result?.materialTotal || 0;

              const kpValue = kpOverhead ? laborTotal * (kpOverhead.value / 100) : 0;
              const kzValue = kzOverhead ? materialTotal * (kzOverhead.value / 100) : 0;
              // Z (zysk) typically applies to R+Kp
              const zBase = laborTotal + kpValue;
              const zValue = zOverhead ? zBase * (zOverhead.value / 100) : 0;

              return (
                <>
                  {kpOverhead && kpOverhead.value > 0 && (
                    <tr className="border-b border-gray-50">
                      <td colSpan={5} className="px-3 py-0.5 text-xs text-gray-500 text-right pl-8">
                        Koszty pośrednie (Kp) {kpOverhead.value}% od R
                      </td>
                      <td className="px-3 py-0.5 text-xs text-right text-gray-500">{formatNumber(kpValue, 3)}</td>
                      <td className="px-3 py-0.5 text-xs text-right text-gray-400">{formatNumber(kpValue, 2)}</td>
                      <td></td>
                      <td></td>
                    </tr>
                  )}
                  {zOverhead && zOverhead.value > 0 && (
                    <tr className="border-b border-gray-50">
                      <td colSpan={5} className="px-3 py-0.5 text-xs text-gray-500 text-right pl-8">
                        Zysk (Z) {zOverhead.value}% od R+Kp
                      </td>
                      <td className="px-3 py-0.5 text-xs text-right text-gray-500">{formatNumber(zValue, 3)}</td>
                      <td className="px-3 py-0.5 text-xs text-right text-gray-400">{formatNumber(zValue, 2)}</td>
                      <td></td>
                      <td></td>
                    </tr>
                  )}
                  {kzOverhead && kzOverhead.value > 0 && (
                    <tr className="border-b border-gray-50">
                      <td colSpan={5} className="px-3 py-0.5 text-xs text-gray-500 text-right pl-8">
                        Koszty zakupu (Kz) {kzOverhead.value}% od M
                      </td>
                      <td className="px-3 py-0.5 text-xs text-right text-gray-500">{formatNumber(kzValue, 3)}</td>
                      <td></td>
                      <td className="px-3 py-0.5 text-xs text-right text-gray-400">{formatNumber(kzValue, 2)}</td>
                      <td></td>
                    </tr>
                  )}
                </>
              );
            })()}
            <tr className="border-b border-gray-100">
              <td colSpan={5} className="px-3 py-1 text-xs text-gray-600 text-right">Razem z narzutami</td>
              <td className="px-3 py-1 text-xs text-right">{formatNumber(result?.totalWithOverheads || 0, 3)}</td>
              <td className="px-3 py-1 text-xs text-right text-gray-500">{formatNumber(0, 3)}</td>
              <td className="px-3 py-1 text-xs text-right">{formatNumber(result?.totalWithOverheads || 0, 2)}</td>
              <td></td>
            </tr>
            <tr className="border-b border-gray-200">
              <td colSpan={5} className="px-3 py-1 text-xs text-gray-600 text-right font-medium">Cena jednostkowa</td>
              <td className="px-3 py-1 text-xs text-right font-medium text-blue-600">{formatNumber(result?.unitCost || 0, 3)}</td>
              <td colSpan={3}></td>
            </tr>
          </>
        )}
      </React.Fragment>
    );
  };

  // Render section (with recursive subsections)
  const renderSection = (section: KosztorysSection, sectionIndex: number, depth: number = 0) => {
    const isExpanded = editorState.expandedSections.has(section.id);
    const isSelected = editorState.selectedItemId === section.id;
    const sectionResult = calculationResult?.sections[section.id];
    const hasSubsections = section.subsectionIds && section.subsectionIds.length > 0;
    const hasPositions = section.positionIds && section.positionIds.length > 0;
    const depthColors = getDepthColors(depth);

    // Determine colspan based on view mode
    const colspan = viewMode === 'przedmiar' ? 4 : viewMode === 'pozycje' ? 5 : viewMode === 'naklady' ? 7 : viewMode === 'kosztorys' ? 7 : 5;

    // Indentation based on depth
    const indentPadding = depth * 16;

    // Pozycje view - matching eKosztorysowanie reference
    if (viewMode === 'pozycje') {
      return (
        <React.Fragment key={section.id}>
          {/* Section header row */}
          <tr
            className={`cursor-pointer ${depthColors.border} ${isSelected ? 'bg-blue-200 ring-2 ring-inset ring-blue-400' : depthColors.headerBg + ' hover:brightness-95'}`}
            onClick={() => selectItem(section.id, 'section')}
          >
            <td className="px-3 py-3 text-sm border border-gray-300" style={{ paddingLeft: `${12 + indentPadding}px` }}>
              {(hasSubsections || hasPositions) && (
                <button
                  onClick={(e) => { e.stopPropagation(); toggleExpandSection(section.id); }}
                  className="p-0.5 hover:bg-white/50 rounded"
                >
                  {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-600" /> : <ChevronRight className="w-4 h-4 text-gray-600" />}
                </button>
              )}
            </td>
            <td className="px-3 py-3 text-sm font-semibold text-gray-900 border border-gray-300">{section.ordinalNumber}</td>
            <td colSpan={5} className="px-3 py-3 text-sm font-semibold text-gray-900 border border-gray-300">{section.name}</td>
          </tr>

          {/* Subsections (rendered recursively) */}
          {isExpanded && section.subsectionIds?.map((subsectionId, subIndex) => {
            const subsection = estimateData.sections[subsectionId];
            if (!subsection) return null;
            return renderSection(subsection, subIndex, depth + 1);
          })}

          {/* Positions in section */}
          {isExpanded && section.positionIds.map((posId, posIndex) => {
            const position = estimateData.positions[posId];
            if (!position) return null;
            return renderPositionRow(position, posIndex + 1, section.id, depth);
          })}
        </React.Fragment>
      );
    }

    return (
      <React.Fragment key={section.id}>
        {/* Section header row */}
        <tr
          className={`border-b border-gray-200 cursor-pointer ${depthColors.border} ${isSelected ? 'bg-blue-200 ring-2 ring-inset ring-blue-400' : depthColors.headerBg + ' hover:brightness-95'}`}
          onClick={() => selectItem(section.id, 'section')}
        >
          <td className="px-3 py-2 text-sm" style={{ paddingLeft: `${12 + indentPadding}px` }}>
            {(hasSubsections || hasPositions) && (
              <button
                onClick={(e) => { e.stopPropagation(); toggleExpandSection(section.id); }}
                className="p-0.5 hover:bg-white/50 rounded"
              >
                {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-600" /> : <ChevronRight className="w-4 h-4 text-gray-600" />}
              </button>
            )}
          </td>
          <td className="px-3 py-2 text-sm font-semibold text-gray-900">{section.ordinalNumber}</td>
          <td colSpan={colspan} className="px-3 py-2 text-sm font-semibold text-gray-900">
            <div className="flex items-center gap-2">
              <span>{section.name}</span>
              {/* Comment tag */}
              {(() => {
                const sectionComments = comments.filter(c =>
                  c.targetId === section.id && (showCompletedTasks || !c.completed)
                );
                if (!showCommentsOnSheet || sectionComments.length === 0) return null;

                const primaryComment = sectionComments[0];
                const colorClass = primaryComment?.category === 'verification'
                  ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                  : primaryComment?.category === 'completion'
                  ? 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200';

                return (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (sectionComments.length > 0) {
                        setSelectedCommentId(sectionComments[0].id);
                        setLeftPanelMode('comments');
                      }
                    }}
                    className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-normal ${colorClass}`}
                  >
                    <MessageSquare className="w-3 h-3" />
                    {sectionComments.length}
                  </button>
                );
              })()}
            </div>
          </td>
        </tr>

        {/* Subsections (rendered recursively) */}
        {isExpanded && section.subsectionIds?.map((subsectionId, subIndex) => {
          const subsection = estimateData.sections[subsectionId];
          if (!subsection) return null;
          return renderSection(subsection, subIndex, depth + 1);
        })}

        {/* Positions in section - aggregated for naklady view */}
        {isExpanded && viewMode === 'naklady' && (() => {
          // Aggregate resources by index within this section
          const aggregated: Record<string, {
            index: string;
            name: string;
            unit: string;
            type: string;
            unitPrice: number;
            totalQuantity: number;
            totalValue: number;
          }> = {};

          for (const posId of section.positionIds) {
            const position = estimateData.positions[posId];
            if (!position) continue;
            const posResult = calculationResult?.positions[posId];
            const posQuantity = posResult?.quantity || 0;

            for (const resource of position.resources) {
              const resIndex = resource.originIndex?.index || resource.index || '-';
              const resResult = posResult?.resources.find(r => r.id === resource.id);
              const resQuantity = resResult?.calculatedQuantity || resource.norm.value * posQuantity;
              const resValue = resResult?.calculatedValue || resQuantity * resource.unitPrice.value;

              const key = `${resIndex}_${resource.type}`;
              if (aggregated[key]) {
                aggregated[key].totalQuantity += resQuantity;
                aggregated[key].totalValue += resValue;
              } else {
                aggregated[key] = {
                  index: resIndex,
                  name: resource.name,
                  unit: resource.unit.label,
                  type: resource.type,
                  unitPrice: resource.unitPrice.value,
                  totalQuantity: resQuantity,
                  totalValue: resValue,
                };
              }
            }
          }

          const sorted = Object.values(aggregated).sort((a, b) => {
            const typeOrder: Record<string, number> = { labor: 0, material: 1, equipment: 2, waste: 3 };
            const ta = typeOrder[a.type] ?? 4;
            const tb = typeOrder[b.type] ?? 4;
            if (ta !== tb) return ta - tb;
            return a.index.localeCompare(b.index);
          });

          return sorted.map((agg, idx) => (
            <tr key={`agg-${section.id}-${agg.index}-${agg.type}`} className={`border-b border-gray-100 ${depthColors.bg}`}>
              <td className="px-3 py-2 text-sm">
                <span className="flex items-center gap-1">
                  {idx + 1}
                  <span className={`w-2 h-2 rounded-full ${
                    agg.type === 'labor' ? 'bg-blue-500' :
                    agg.type === 'material' ? 'bg-green-500' : 'bg-orange-500'
                  }`}></span>
                </span>
              </td>
              <td className="px-3 py-2 text-sm font-mono text-gray-600">{agg.index}</td>
              <td className="px-3 py-2 text-sm text-gray-800">{agg.name}</td>
              <td className="px-3 py-2 text-sm text-right text-gray-600">{agg.unit}</td>
              <td className={`px-3 py-2 text-sm text-right ${viewOptionsPanel.highlightZeroPrices && agg.unitPrice === 0 ? 'text-amber-600 font-semibold bg-amber-50' : 'text-gray-600'}`}>{formatNumber(agg.unitPrice, 3)}</td>
              <td className="px-3 py-2 text-sm text-right text-gray-600">{formatNumber(agg.totalQuantity, 2)}</td>
              <td className="px-3 py-2 text-sm text-right font-medium">{formatNumber(agg.totalValue, 2)}</td>
              <td className="px-3 py-2 text-sm text-right text-gray-500">{formatNumber(0, 3)}</td>
              <td className="px-3 py-2 text-sm text-right text-gray-600">{formatNumber(agg.totalQuantity, 3)}</td>
            </tr>
          ));
        })()}

        {/* Positions in section - individual rendering for non-naklady views */}
        {isExpanded && viewMode !== 'naklady' && section.positionIds.map((posId, posIndex) => {
          const position = estimateData.positions[posId];
          if (!position) return null;
          return renderPositionRow(position, posIndex + 1, section.id, depth);
        })}
      </React.Fragment>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white relative">
      {/* Single Toolbar Row */}
      <div className="bg-white border-b border-gray-200 px-2 py-1.5 flex items-center justify-between">
        <div className="flex items-center gap-0.5 flex-wrap">
          {/* Powrót button */}
          <button
            onClick={() => {
              if (editorState.isDirty) {
                setShowExitConfirmModal(true);
              } else {
                navigate('/construction/estimates');
              }
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded border border-gray-300"
          >
            <ArrowLeft className="w-4 h-4" />
            Powrót
          </button>

          <div className="w-px h-6 bg-gray-200 mx-1" />

          {/* Mode selection dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowModeDropdown(!showModeDropdown)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-100 rounded"
            >
              <Menu className="w-4 h-4" />
              {leftPanelMode === 'export' ? 'Wydruki' :
               viewMode === 'przedmiar' ? 'Przedmiar' :
               viewMode === 'kosztorys' ? 'Kosztorys' :
               viewMode === 'pozycje' ? 'Pozycje' :
               viewMode === 'naklady' ? 'Nakłady' :
               viewMode === 'narzuty' ? 'Narzuty' :
               viewMode === 'zestawienia' ? 'Zestawienia' : 'Kosztorys'}
              <ChevronDown className="w-3 h-3" />
            </button>
            {showModeDropdown && (
              <div className="absolute top-full left-0 mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
                <button
                  onClick={handleImportClick}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-center gap-2 text-blue-600 font-medium"
                >
                  <Upload className="w-4 h-4" />
                  Import
                </button>
                <div className="border-t border-gray-200" />
                <button
                  onClick={() => { setViewMode('przedmiar'); setActiveNavItem('przedmiar'); setLeftPanelMode('overview'); setShowModeDropdown(false); }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2 ${viewMode === 'przedmiar' && leftPanelMode !== 'export' ? 'bg-blue-50 text-blue-600' : ''}`}
                >
                  <List className="w-4 h-4" />
                  Przedmiar
                </button>
                <button
                  onClick={() => { setViewMode('kosztorys'); setActiveNavItem('kosztorysy'); setLeftPanelMode('overview'); setShowModeDropdown(false); }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2 ${viewMode === 'kosztorys' && leftPanelMode !== 'export' ? 'bg-blue-50 text-blue-600' : ''}`}
                >
                  <FileBarChart className="w-4 h-4" />
                  Kosztorys
                </button>
                <button
                  onClick={() => { setViewMode('pozycje'); setActiveNavItem('pozycje'); setLeftPanelMode('overview'); setShowModeDropdown(false); }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2 ${viewMode === 'pozycje' && leftPanelMode !== 'export' ? 'bg-blue-50 text-blue-600' : ''}`}
                >
                  <LayoutList className="w-4 h-4" />
                  Pozycje
                </button>
                <button
                  onClick={() => { setViewMode('naklady'); setActiveNavItem('naklady'); setLeftPanelMode('overview'); setShowModeDropdown(false); }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2 ${viewMode === 'naklady' && leftPanelMode !== 'export' ? 'bg-blue-50 text-blue-600' : ''}`}
                >
                  <Layers className="w-4 h-4" />
                  Nakłady
                </button>
                <button
                  onClick={() => { setViewMode('narzuty'); setActiveNavItem('narzuty'); setLeftPanelMode('overview'); setShowModeDropdown(false); }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2 ${viewMode === 'narzuty' && leftPanelMode !== 'export' ? 'bg-blue-50 text-blue-600' : ''}`}
                >
                  <Percent className="w-4 h-4" />
                  Narzuty
                </button>
                <button
                  onClick={() => { setViewMode('zestawienia'); setActiveNavItem('zestawienia'); setLeftPanelMode('overview'); setShowModeDropdown(false); }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2 ${viewMode === 'zestawienia' && leftPanelMode !== 'export' ? 'bg-blue-50 text-blue-600' : ''}`}
                >
                  <Table2 className="w-4 h-4" />
                  Zestawienia
                </button>
                <div className="border-t border-gray-200" />
                <button
                  onClick={() => { setLeftPanelMode('export'); setActiveNavItem('wydruki'); setShowModeDropdown(false); }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2 ${leftPanelMode === 'export' ? 'bg-blue-50 text-blue-600' : ''}`}
                >
                  <Printer className="w-4 h-4" />
                  Wydruki
                </button>
              </div>
            )}
          </div>


          {/* + Dział dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowDzialDropdown(!showDzialDropdown)}
              className="flex items-center gap-1 px-2 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded"
            >
              <Plus className="w-4 h-4" />
              Dział
              <ChevronDown className="w-3 h-3" />
            </button>
            {showDzialDropdown && (
              <div className="absolute top-full left-0 mt-1 w-52 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
                <button onClick={() => { handleAddSection(); setShowDzialDropdown(false); }} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50">
                  + Dział
                </button>
                <button
                  onClick={() => { handleAddSubsection(); setShowDzialDropdown(false); }}
                  disabled={editorState.selectedItemType !== 'section'}
                  className={`w-full text-left px-3 py-2 text-sm ${
                    editorState.selectedItemType === 'section'
                      ? 'hover:bg-gray-50'
                      : 'text-gray-400 cursor-not-allowed'
                  }`}
                >
                  + Poddział {editorState.selectedItemType !== 'section' && '(wybierz dział)'}
                </button>
              </div>
            )}
          </div>

          {/* KNR Pozycja dropdown */}
          <div className="relative">
            <div className="flex">
              <button
                onClick={() => setLeftPanelMode(leftPanelMode === 'catalog' ? 'overview' : 'catalog')}
                className={`flex items-center gap-1 px-2 py-1.5 text-sm rounded-l ${
                  leftPanelMode === 'catalog' ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                }`}
              >
                <span className="text-[10px] font-bold px-1 py-0.5 bg-blue-500 text-white rounded">KNR</span>
                Pozycja
              </button>
              <button
                onClick={() => setShowKNRDropdown(!showKNRDropdown)}
                className={`px-1 py-1.5 text-sm rounded-r border-l ${
                  leftPanelMode === 'catalog' ? 'bg-blue-600 text-white border-blue-500' : 'bg-blue-50 text-blue-600 hover:bg-blue-100 border-blue-200'
                }`}
              >
                <ChevronDown className="w-3 h-3" />
              </button>
            </div>
            {showKNRDropdown && (
              <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
                <button
                  onClick={() => { setLeftPanelMode('catalog'); setShowKNRDropdown(false); }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"
                >
                  <span className="text-[10px] font-bold px-1 py-0.5 bg-blue-500 text-white rounded">KNR</span>
                  Pozycja
                </button>
                <button
                  onClick={() => { handleAddUncataloguedPosition(); setShowKNRDropdown(false); }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                >
                  Wstaw pozycję nieskatalogowaną
                </button>
              </div>
            )}
          </div>

          {/* Nakład dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowNakladDropdown(!showNakladDropdown)}
              className={`flex items-center gap-1 px-2 py-1.5 text-sm rounded ${
                editorState.selectedItemType === 'position' ? 'text-gray-600 hover:bg-gray-100' : 'text-gray-400 cursor-not-allowed'
              }`}
            >
              <Clipboard className="w-4 h-4" />
              Nakład
              <ChevronDown className="w-3 h-3" />
            </button>
            {showNakladDropdown && (
              <div className="absolute top-full left-0 mt-1 w-40 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
                <button
                  onClick={() => {
                    if (editorState.selectedItemId && editorState.selectedItemType === 'position') {
                      handleAddResource(editorState.selectedItemId, 'labor');
                    }
                    setShowNakladDropdown(false);
                  }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                >
                  Robocizna
                </button>
                <button
                  onClick={() => {
                    if (editorState.selectedItemId && editorState.selectedItemType === 'position') {
                      handleAddResource(editorState.selectedItemId, 'material');
                    }
                    setShowNakladDropdown(false);
                  }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                >
                  Materiały
                </button>
                <button
                  onClick={() => {
                    if (editorState.selectedItemId && editorState.selectedItemType === 'position') {
                      handleAddResource(editorState.selectedItemId, 'equipment');
                    }
                    setShowNakladDropdown(false);
                  }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                >
                  Sprzęt
                </button>
                <button
                  onClick={() => {
                    if (editorState.selectedItemId && editorState.selectedItemType === 'position') {
                      handleAddResource(editorState.selectedItemId, 'waste');
                    }
                    setShowNakladDropdown(false);
                  }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                >
                  Odpady
                </button>
              </div>
            )}
          </div>

          {/* Uzupełnij dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowUzupelnijDropdown(!showUzupelnijDropdown)}
              className={`flex items-center gap-1 px-2 py-1.5 text-sm rounded ${
                Object.keys(estimateData.positions).length > 0 ? 'text-gray-600 hover:bg-gray-100' : 'text-gray-400 cursor-not-allowed'
              }`}
              disabled={Object.keys(estimateData.positions).length === 0}
            >
              Uzupełnij
              <ChevronDown className="w-3 h-3" />
            </button>
            {showUzupelnijDropdown && (
              <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
                <button
                  onClick={() => { setShowUzupelnijDropdown(false); handleUzupelnijNaklady('missing'); }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                >
                  Uzupełnij tylko brakujące
                </button>
                <button
                  onClick={() => { setShowUzupelnijDropdown(false); setShowReplaceResourcesConfirm(true); }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 text-red-600"
                >
                  Zastąp wszystkie nakłady
                </button>
              </div>
            )}
          </div>

          <div className="w-px h-6 bg-gray-200 mx-1" />

          {/* Ceny */}
          <button onClick={() => setShowCenyDialog(true)} className="px-2 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded">
            Ceny
          </button>

          {/* Komentarze split button */}
          <div className="relative flex">
            {/* Main button - opens comments panel */}
            <button
              onClick={() => setLeftPanelMode('comments')}
              className={`flex items-center gap-1 pl-2 pr-1 py-1.5 text-sm rounded-l border-r border-gray-200 ${
                leftPanelMode === 'comments' || commentSelectionMode ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <MessageSquare className="w-4 h-4" />
              Komentarze
            </button>
            {/* Dropdown arrow */}
            <button
              onClick={() => setShowKomentarzeDropdown(!showKomentarzeDropdown)}
              className={`flex items-center px-1 py-1.5 text-sm rounded-r ${
                leftPanelMode === 'comments' || commentSelectionMode ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <ChevronDown className="w-3 h-3" />
            </button>
            {showKomentarzeDropdown && (
              <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
                {/* Insert comment option */}
                <button
                  onClick={() => {
                    setCommentSelectionMode(true);
                    setShowKomentarzeDropdown(false);
                  }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"
                >
                  <Plus className="w-4 h-4 text-gray-500" />
                  Wstaw komentarz do...
                </button>
                <div className="border-t border-gray-100" />
                {/* Show comments on sheet checkbox */}
                <label className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showCommentsOnSheet}
                    onChange={(e) => setShowCommentsOnSheet(e.target.checked)}
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                  Pokaż komentarze na arkuszu
                </label>
                {/* Show completed tasks checkbox */}
                <label className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showCompletedTasks}
                    onChange={(e) => setShowCompletedTasks(e.target.checked)}
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                  Pokazuj ukończone zadania
                </label>
              </div>
            )}
          </div>
        </div>

        {/* Right side - Weryfikuj, Widok, Settings, Zapisz */}
        <div className="flex items-center gap-1">
          {/* Weryfikuj button */}
          <button
            onClick={handleSprawdzKosztorys}
            className="p-1.5 text-gray-500 hover:bg-gray-100 rounded"
            title="Weryfikuj"
          >
            <SearchCheck className="w-5 h-5" />
          </button>

          {/* Widok button - opens right panel */}
          <button
            onClick={() => setRightPanelMode(rightPanelMode === 'viewOptions' ? 'closed' : 'viewOptions')}
            className={`p-1.5 rounded ${rightPanelMode === 'viewOptions' ? 'bg-blue-100 text-blue-600' : 'text-gray-500 hover:bg-gray-100'}`}
            title="Opcje widoku"
          >
            <Eye className="w-5 h-5" />
          </button>

          {/* Settings icon - opens right panel */}
          <button
            onClick={() => setRightPanelMode(rightPanelMode === 'settings' ? 'closed' : 'settings')}
            className={`p-1.5 rounded ${rightPanelMode === 'settings' ? 'bg-blue-100 text-blue-600' : 'text-gray-500 hover:bg-gray-100'}`}
            title="Ustawienia"
          >
            <Settings className="w-5 h-5" />
          </button>

          {/* Zapisz icon */}
          <button
            onClick={handleSave}
            disabled={saving}
            className="p-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            title="Zapisz"
          >
            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
          </button>

          {/* Utwórz ofertę */}
          <button
            onClick={handleCreateOfferFromEstimate}
            className="p-1.5 text-gray-500 hover:bg-green-100 hover:text-green-700 rounded"
            title="Utwórz ofertę"
          >
            <ReceiptText className="w-5 h-5" />
          </button>

          {/* Utwórz harmonogram */}
          <button
            onClick={handleCreateGanttFromEstimate}
            className="p-1.5 text-gray-500 hover:bg-orange-100 hover:text-orange-700 rounded"
            title="Utwórz harmonogram"
          >
            <CalendarClock className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Toolbar Row 2 - shown only when item is selected */}
      {editorState.selectedItemId && (
        <div className="bg-gray-50 border-b border-gray-200 px-2 py-1 flex items-center">
          <div className="flex items-center gap-0.5">
            {/* Usuń dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowUsunDropdown(!showUsunDropdown)}
                className="flex items-center gap-1 px-2 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded"
              >
                <Trash2 className="w-4 h-4" />
                Usuń
                <ChevronDown className="w-3 h-3" />
              </button>
              {showUsunDropdown && (
                <div className="absolute top-full left-0 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
                  <button
                    onClick={() => {
                      if (editorState.selectedItemId && editorState.selectedItemType) {
                        if (confirm('Czy na pewno chcesz usunąć ten element?')) {
                          handleDeleteItem(editorState.selectedItemId, editorState.selectedItemType);
                        }
                      }
                      setShowUsunDropdown(false);
                    }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 text-red-600"
                  >
                    {editorState.selectedItemType === 'section' ? 'Usuń dział' :
                     editorState.selectedItemType === 'position' ? 'Usuń pozycję' :
                     editorState.selectedItemType === 'resource' ? 'Usuń nakład' : 'Usuń zaznaczony element'}
                  </button>
                  {editorState.selectedItemType === 'position' && (
                    <button
                      onClick={() => {
                        if (editorState.selectedItemId && editorState.selectedItemType === 'position') {
                          if (confirm('Czy na pewno chcesz usunąć pozycję wraz z nakładami?')) {
                            handleDeleteItem(editorState.selectedItemId, 'position');
                          }
                        }
                        setShowUsunDropdown(false);
                      }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                    >
                      Usuń pozycję z nakładami
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Przesuń dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowPrzesunDropdown(!showPrzesunDropdown)}
                className="flex items-center gap-1 px-2 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded"
              >
                <MoveUp className="w-4 h-4" />
                Przesuń
                <ChevronDown className="w-3 h-3" />
              </button>
              {showPrzesunDropdown && (
                <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
                  {/* Position move options */}
                  {editorState.selectedItemType === 'position' && (
                    <>
                      <button
                        onClick={() => { handleMovePosition('up'); setShowPrzesunDropdown(false); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"
                      >
                        <MoveUp className="w-4 h-4 text-gray-400" />
                        Przesuń pozycję w górę
                      </button>
                      <button
                        onClick={() => { handleMovePosition('down'); setShowPrzesunDropdown(false); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"
                      >
                        <MoveDown className="w-4 h-4 text-gray-400" />
                        Przesuń pozycję w dół
                      </button>
                      <button
                        onClick={() => { handleMovePosition('first'); setShowPrzesunDropdown(false); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"
                      >
                        <ArrowUpRight className="w-4 h-4 text-gray-400" />
                        Przesuń pozycję do pierwszego działu
                      </button>
                      <button
                        onClick={() => { handleMovePosition('last'); setShowPrzesunDropdown(false); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"
                      >
                        <ArrowUpRight className="w-4 h-4 text-gray-400 rotate-90" />
                        Przesuń pozycję do ostatniego działu
                      </button>
                    </>
                  )}

                  {/* Section move options */}
                  {editorState.selectedItemType === 'section' && (
                    <>
                      <button
                        onClick={() => { handleMoveSection('up'); setShowPrzesunDropdown(false); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"
                      >
                        <MoveUp className="w-4 h-4 text-gray-400" />
                        Przesuń dział w górę
                      </button>
                      <button
                        onClick={() => { handleMoveSection('down'); setShowPrzesunDropdown(false); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"
                      >
                        <MoveDown className="w-4 h-4 text-gray-400" />
                        Przesuń dział w dół
                      </button>
                      <button
                        onClick={() => { handleMoveSection('out'); setShowPrzesunDropdown(false); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"
                      >
                        <ChevronLeft className="w-4 h-4 text-gray-400" />
                        Przesuń dział wyżej (na poziom rodzica)
                      </button>
                      <button
                        onClick={() => { handleMoveSection('toFirstSection'); setShowPrzesunDropdown(false); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"
                      >
                        <ArrowUpRight className="w-4 h-4 text-gray-400" />
                        Przesuń jako poddział do pierwszego działu
                      </button>
                      <button
                        onClick={() => { handleMoveSection('toLastSection'); setShowPrzesunDropdown(false); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"
                      >
                        <ArrowUpRight className="w-4 h-4 text-gray-400 rotate-90" />
                        Przesuń jako poddział do ostatniego działu
                      </button>
                    </>
                  )}

                  {/* No selection message */}
                  {(!editorState.selectedItemType || (editorState.selectedItemType !== 'position' && editorState.selectedItemType !== 'section')) && (
                    <div className="px-3 py-2 text-sm text-gray-400">
                      Zaznacz dział lub pozycję, aby przenieść
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="w-px h-6 bg-gray-300 mx-1" />

            {/* Kopiuj */}
            <button
              onClick={() => {
                if (editorState.selectedItemId && editorState.selectedItemType) {
                  setEditorState(prev => ({
                    ...prev,
                    clipboard: { id: editorState.selectedItemId!, type: editorState.selectedItemType!, action: 'copy' }
                  }));
                  showNotificationMessage('Skopiowano do schowka', 'success');
                }
              }}
              className="flex items-center gap-1 px-2 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded"
            >
              <Clipboard className="w-4 h-4" />
              Kopiuj
            </button>

            {/* Wytnij */}
            <button
              onClick={() => {
                if (editorState.selectedItemId && editorState.selectedItemType) {
                  setEditorState(prev => ({
                    ...prev,
                    clipboard: { id: editorState.selectedItemId!, type: editorState.selectedItemType!, action: 'cut' }
                  }));
                  showNotificationMessage('Wycięto do schowka', 'success');
                }
              }}
              className="flex items-center gap-1 px-2 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded"
            >
              <Scissors className="w-4 h-4" />
              Wytnij
            </button>

            {/* Wklej */}
            <button
              onClick={handlePaste}
              className={`flex items-center gap-1 px-2 py-1.5 text-sm rounded ${
                editorState.clipboard ? 'text-gray-600 hover:bg-gray-100' : 'text-gray-400 cursor-not-allowed'
              }`}
              disabled={!editorState.clipboard}
            >
              <Clipboard className="w-4 h-4" />
              {editorState.clipboard?.action === 'cut' ? 'Wklej (wycięta)' :
               editorState.clipboard?.action === 'copy' ? 'Wklej (kopia)' : 'Wklej'}
            </button>
          </div>
        </div>
      )}

      {/* Click outside to close all dropdowns */}
      {(showDzialDropdown || showNakladDropdown || showKomentarzeDropdown || showUsunDropdown || showPrzesunDropdown || showUzupelnijDropdown || showKNRDropdown || showTagDropdown || showCommentsSortDropdown) && (
        <div className="fixed inset-0 z-40" onClick={() => {
          setShowDzialDropdown(false);
          setShowNakladDropdown(false);
          setShowKomentarzeDropdown(false);
          setShowUsunDropdown(false);
          setShowPrzesunDropdown(false);
          setShowUzupelnijDropdown(false);
          setShowTagDropdown(false);
          setTagSearch('');
          setShowKNRDropdown(false);
          setShowCommentsSortDropdown(false);
        }} />
      )}

      {/* Main content */}
      <div className="flex-1 flex min-h-0 bg-gray-100 overflow-hidden">
        {/* Left panel - Navigation and Properties */}
        <div className="shrink-0 bg-white w-[356px] h-full relative border-r border-gray-400 flex flex-col">
          {/* Tab headers - Przegląd / Właściwości */}
          <div className="flex border-b border-gray-200">
            <button
              onClick={() => setLeftPanelMode('overview')}
              className={`flex-1 px-4 py-2 text-sm font-medium ${
                leftPanelMode === 'overview' || leftPanelMode === 'catalog' || leftPanelMode === 'comments' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              Przegląd
            </button>
            <button
              onClick={() => setLeftPanelMode('properties')}
              className={`flex-1 px-4 py-2 text-sm font-medium ${
                leftPanelMode === 'properties' || leftPanelMode === 'settings' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              Właściwości
            </button>
          </div>

          {/* Panel content based on mode */}

          {/* Panel content based on mode */}
          <div className="flex-1 overflow-y-auto">
            {leftPanelMode === 'overview' && (
              <div className="flex flex-col h-full">
                {/* Search in estimate */}
                <div className="p-3 border-b border-gray-200">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      value={treeSearchQuery}
                      onChange={e => setTreeSearchQuery(e.target.value)}
                      placeholder="Szukaj w kosztorysie"
                      className="w-full pl-8 pr-8 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    {treeSearchQuery && (
                      <button onClick={() => setTreeSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2">
                        <X className="w-4 h-4 text-gray-400 hover:text-gray-600" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Estimate structure tree or search results */}
                <div className="flex-1 overflow-y-auto p-2">
                  {treeSearchResults ? (
                    <div className="space-y-1">
                      <div className="text-xs text-gray-500 px-2 mb-2">
                        Znaleziono: {treeSearchResults.length} pozycji
                      </div>
                      {treeSearchResults.length === 0 && (
                        <div className="text-sm text-gray-400 text-center py-4">Brak wyników</div>
                      )}
                      {treeSearchResults.map(result => (
                        <button
                          key={result.positionId}
                          onClick={() => scrollToPosition(result.positionId)}
                          className={`w-full text-left px-3 py-2 rounded-lg hover:bg-blue-50 text-sm ${
                            editorState.selectedItemId === result.positionId ? 'bg-blue-100' : ''
                          }`}
                        >
                          <div className="font-medium text-gray-800 truncate">{result.name}</div>
                          <div className="text-xs text-gray-500 truncate">
                            {result.base && <span className="font-mono mr-2">{result.base}</span>}
                            {result.sectionName}
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <>
                      {/* Root node "▼ Kosztorys" per documentation 4.2 */}
                      <button
                        onClick={() => setEditorState(prev => ({ ...prev, treeRootExpanded: !prev.treeRootExpanded }))}
                        className="w-full flex items-center gap-1 px-2 py-1.5 text-sm text-left rounded hover:bg-gray-50 font-medium"
                      >
                        {editorState.treeRootExpanded !== false ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        <span>Kosztorys</span>
                      </button>

                      {/* Sections tree - only shown when root is expanded */}
                      {editorState.treeRootExpanded !== false && estimateData.root.sectionIds.map(sectionId =>
                        renderSectionTree(sectionId, 0)
                      )}

                      {/* Empty state */}
                      {estimateData.root.sectionIds.length === 0 && (
                        <p className="text-sm text-gray-400 text-center py-4">Kosztorys jest pusty</p>
                      )}
                    </>
                  )}
                </div>

              </div>
            )}

            {leftPanelMode === 'properties' && selectedItem && (
              <div className="p-4">
                {editorState.selectedItemType === 'section' && (
                  <div className="space-y-3">
                    {/* Nazwa działu - matching eKosztorysowanie layout */}
                    <div>
                      <label className="block text-sm text-gray-800 mb-1">Nazwa działu</label>
                      <input
                        type="text"
                        value={(selectedItem as KosztorysSection).name}
                        onChange={e => handleUpdateSelectedItem({ name: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                      />
                    </div>

                    {/* Opis działu - no expand button per documentation 4.3.1 */}
                    <div>
                      <label className="text-sm text-gray-800 mb-1 block">Opis działu</label>
                      <textarea
                        value={(selectedItem as KosztorysSection).description}
                        onChange={e => handleUpdateSelectedItem({ description: e.target.value })}
                        placeholder="Opis działu"
                        className="w-full px-3 py-2 border border-gray-300 rounded text-sm resize-none"
                        rows={2}
                      />
                    </div>

                    {/* Współczynniki norm - expandable section matching screenshot */}
                    <div className="border-t border-gray-200 pt-3">
                      <button className="w-full flex items-center justify-between text-sm text-gray-800 mb-3">
                        <span>Współczynniki norm</span>
                        <ChevronUp className="w-4 h-4 text-gray-400" />
                      </button>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-sm text-gray-600">Robocizna</label>
                          <input
                            type="text"
                            value={(selectedItem as KosztorysSection).factors.labor.toString().replace('.', ',')}
                            onChange={e => handleUpdateSelectedItem({
                              factors: { ...(selectedItem as KosztorysSection).factors, labor: parseFloat(e.target.value.replace(',', '.')) || 1 }
                            })}
                            className="w-24 px-2 py-1.5 border border-gray-300 rounded text-sm text-right"
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <label className="text-sm text-gray-600">Materiały</label>
                          <input
                            type="text"
                            value={(selectedItem as KosztorysSection).factors.material.toString().replace('.', ',')}
                            onChange={e => handleUpdateSelectedItem({
                              factors: { ...(selectedItem as KosztorysSection).factors, material: parseFloat(e.target.value.replace(',', '.')) || 1 }
                            })}
                            className="w-24 px-2 py-1.5 border border-gray-300 rounded text-sm text-right"
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <label className="text-sm text-gray-600">Sprzęt</label>
                          <input
                            type="text"
                            value={(selectedItem as KosztorysSection).factors.equipment.toString().replace('.', ',')}
                            onChange={e => handleUpdateSelectedItem({
                              factors: { ...(selectedItem as KosztorysSection).factors, equipment: parseFloat(e.target.value.replace(',', '.')) || 1 }
                            })}
                            className="w-24 px-2 py-1.5 border border-gray-300 rounded text-sm text-right"
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <label className="text-sm text-gray-600">Odpady</label>
                          <input
                            type="text"
                            value={(selectedItem as KosztorysSection).factors.waste.toString().replace('.', ',')}
                            onChange={e => handleUpdateSelectedItem({
                              factors: { ...(selectedItem as KosztorysSection).factors, waste: parseFloat(e.target.value.replace(',', '.')) || 0 }
                            })}
                            className="w-24 px-2 py-1.5 border border-gray-300 rounded text-sm text-right"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {editorState.selectedItemType === 'position' && (
                  <div className="space-y-3">
                    {/* Podstawa - with eye icon matching eKosztorysowanie */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-sm text-gray-800">Podstawa</label>
                        <button className="p-0.5 hover:bg-gray-100 rounded">
                          <Eye className="w-4 h-4 text-gray-400" />
                        </button>
                      </div>
                      <input
                        type="text"
                        value={(selectedItem as KosztorysPosition).base}
                        onChange={e => handleUpdateSelectedItem({ base: e.target.value, originBase: e.target.value })}
                        placeholder=""
                        className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                      />
                    </div>

                    {/* Znacznik (Tag) - dropdown with search */}
                    <div className="relative">
                      <button
                        onClick={() => setShowTagDropdown(!showTagDropdown)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded border border-gray-200 hover:bg-gray-200"
                      >
                        {(selectedItem as KosztorysPosition).marker ? (
                          POSITION_TAGS.find(t => t.id === (selectedItem as KosztorysPosition).marker)?.label || 'Znacznik'
                        ) : (
                          <span className="text-gray-400">Znacznik <span className="text-blue-500">wpisz...</span></span>
                        )}
                      </button>
                      {showTagDropdown && (
                        <div className="absolute top-full left-0 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
                          <div className="p-2 border-b border-gray-100">
                            <div className="relative">
                              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                              <input
                                type="text"
                                value={tagSearch}
                                onChange={e => setTagSearch(e.target.value)}
                                placeholder="Wyszukaj znacznik"
                                className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                autoFocus
                              />
                            </div>
                          </div>
                          <div className="max-h-48 overflow-y-auto">
                            {/* Clear tag option */}
                            {(selectedItem as KosztorysPosition).marker && (
                              <button
                                onClick={() => {
                                  handleUpdateSelectedItem({ marker: null });
                                  setShowTagDropdown(false);
                                  setTagSearch('');
                                }}
                                className="w-full text-left px-3 py-2 text-sm text-gray-400 hover:bg-gray-50 italic"
                              >
                                Usuń znacznik
                              </button>
                            )}
                            {POSITION_TAGS
                              .filter(tag => tag.label.toLowerCase().includes(tagSearch.toLowerCase()))
                              .map(tag => (
                                <button
                                  key={tag.id}
                                  onClick={() => {
                                    handleUpdateSelectedItem({ marker: tag.id });
                                    setShowTagDropdown(false);
                                    setTagSearch('');
                                  }}
                                  className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 ${
                                    (selectedItem as KosztorysPosition).marker === tag.id ? 'bg-blue-100 text-blue-700' : 'text-gray-700'
                                  }`}
                                >
                                  {tag.label}
                                </button>
                              ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Opis - textarea */}
                    <div>
                      <label className="text-sm text-gray-800 mb-1 block">Opis</label>
                      <textarea
                        value={(selectedItem as KosztorysPosition).name}
                        onChange={e => handleUpdateSelectedItem({ name: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded text-sm resize-none"
                        rows={3}
                      />
                    </div>

                    {/* Przedmiar - expandable section matching screenshot */}
                    <div className="border-t border-gray-200 pt-3">
                      <button className="w-full flex items-center justify-between text-sm text-gray-800 mb-2">
                        <span>Przedmiar</span>
                        <ChevronUp className="w-4 h-4 text-gray-400" />
                      </button>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={selectedPositionResult?.quantity?.toString().replace('.', ',') || '0'}
                          onChange={e => {
                            const pos = selectedItem as KosztorysPosition;
                            const val = parseFloat(e.target.value.replace(',', '.')) || 0;
                            // Update measurement
                            let measurements = pos.measurements;
                            if (measurements.rootIds.length === 0) {
                              measurements = addMeasurementEntry(measurements, String(val), 'Ilość');
                            } else {
                              measurements = updateMeasurementEntry(measurements, measurements.rootIds[0], String(val));
                            }
                            handleUpdateSelectedItem({ measurements });
                          }}
                          className="w-20 px-2 py-1.5 border border-gray-300 rounded text-sm text-right"
                        />
                        <button className="p-1 hover:bg-gray-100 rounded">
                          <ArrowUpRight className="w-4 h-4 text-gray-400" />
                        </button>
                        <select
                          value={(selectedItem as KosztorysPosition).unit.unitIndex}
                          onChange={e => {
                            const unit = UNITS_REFERENCE.find(u => u.index === e.target.value);
                            if (unit) handleUpdateSelectedItem({ unit: { label: unit.unit, unitIndex: unit.index } });
                          }}
                          className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm"
                        >
                          {UNITS_REFERENCE.map(u => (
                            <option key={u.index} value={u.index}>{u.unit}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Krotność */}
                    <div>
                      <label className="text-sm text-gray-800 mb-1 block">Krotność</label>
                      <input
                        type="text"
                        value={(selectedItem as KosztorysPosition).multiplicationFactor.toString().replace('.', ',')}
                        onChange={e => handleUpdateSelectedItem({ multiplicationFactor: parseFloat(e.target.value.replace(',', '.')) || 1 })}
                        className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                      />
                    </div>

                    {/* Współczynniki norm - expandable section */}
                    <div className="border-t border-gray-200 pt-3">
                      <button className="w-full flex items-center justify-between text-sm text-gray-800 mb-3">
                        <span>Współczynniki norm</span>
                        <ChevronUp className="w-4 h-4 text-gray-400" />
                      </button>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-sm text-gray-600">Robocizna</label>
                          <input
                            type="text"
                            value={(selectedItem as KosztorysPosition).factors.labor.toString().replace('.', ',')}
                            onChange={e => handleUpdateSelectedItem({
                              factors: { ...(selectedItem as KosztorysPosition).factors, labor: parseFloat(e.target.value.replace(',', '.')) || 1 }
                            })}
                            className="w-24 px-2 py-1.5 border border-gray-300 rounded text-sm text-right"
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <label className="text-sm text-gray-600">Materiały</label>
                          <input
                            type="text"
                            value={(selectedItem as KosztorysPosition).factors.material.toString().replace('.', ',')}
                            onChange={e => handleUpdateSelectedItem({
                              factors: { ...(selectedItem as KosztorysPosition).factors, material: parseFloat(e.target.value.replace(',', '.')) || 1 }
                            })}
                            className="w-24 px-2 py-1.5 border border-gray-300 rounded text-sm text-right"
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <label className="text-sm text-gray-600">Sprzęt</label>
                          <input
                            type="text"
                            value={(selectedItem as KosztorysPosition).factors.equipment.toString().replace('.', ',')}
                            onChange={e => handleUpdateSelectedItem({
                              factors: { ...(selectedItem as KosztorysPosition).factors, equipment: parseFloat(e.target.value.replace(',', '.')) || 1 }
                            })}
                            className="w-24 px-2 py-1.5 border border-gray-300 rounded text-sm text-right"
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <label className="text-sm text-gray-600">Odpady</label>
                          <input
                            type="text"
                            value={(selectedItem as KosztorysPosition).factors.waste.toString().replace('.', ',')}
                            onChange={e => handleUpdateSelectedItem({
                              factors: { ...(selectedItem as KosztorysPosition).factors, waste: parseFloat(e.target.value.replace(',', '.')) || 0 }
                            })}
                            className="w-24 px-2 py-1.5 border border-gray-300 rounded text-sm text-right"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {editorState.selectedItemType === 'resource' && (
                  <div className="space-y-4">
                    {(() => {
                      const resource = selectedItem as KosztorysResource;
                      const config = RESOURCE_TYPE_CONFIG[resource.type];
                      return (
                        <>
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold ${config.bgColor} ${config.color}`}>
                                {config.shortLabel}
                              </span>
                              <span className="text-sm font-medium text-gray-800">{config.label}</span>
                            </div>
                            {resource.type === 'material' && (
                              <button
                                onClick={openSearchMaterialModal}
                                className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
                              >
                                <Search className="w-3 h-3" />
                                Szukaj
                              </button>
                            )}
                            {resource.type === 'equipment' && (
                              <button
                                onClick={openSearchEquipmentModal}
                                className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
                              >
                                <Search className="w-3 h-3" />
                                Szukaj
                              </button>
                            )}
                            {resource.type === 'labor' && (
                              <button
                                onClick={openSearchLabourModal}
                                className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
                              >
                                <Search className="w-3 h-3" />
                                Szukaj
                              </button>
                            )}
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Indeks</label>
                            <input
                              type="text"
                              value={resource.originIndex.index}
                              onChange={e => handleUpdateSelectedItem({ originIndex: { ...resource.originIndex, index: e.target.value } })}
                              placeholder="np. 999"
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Nazwa</label>
                            <input
                              type="text"
                              value={resource.name}
                              onChange={e => handleUpdateSelectedItem({ name: e.target.value })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-xs font-medium text-gray-500 mb-1">Norma</label>
                              <input
                                type="number"
                                step="0.0001"
                                value={resource.norm.value}
                                onChange={e => handleUpdateSelectedItem({ norm: { ...resource.norm, value: parseFloat(e.target.value) || 0 } })}
                                className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-500 mb-1">Jednostka</label>
                              <select
                                value={resource.unit.unitIndex}
                                onChange={e => {
                                  const unit = UNITS_REFERENCE.find(u => u.index === e.target.value);
                                  if (unit) handleUpdateSelectedItem({ unit: { label: unit.unit, unitIndex: unit.index } });
                                }}
                                className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm"
                              >
                                {UNITS_REFERENCE.map(u => (
                                  <option key={u.index} value={u.index}>{u.unit}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Cena</label>
                            <input
                              type="number"
                              step="0.01"
                              value={resource.unitPrice.value}
                              onChange={e => handleUpdateSelectedItem({ unitPrice: { ...resource.unitPrice, value: parseFloat(e.target.value) || 0 } })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                            />
                          </div>
                          <button
                            onClick={() => setViewMode('naklady')}
                            className="w-full px-3 py-2 text-sm text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50"
                          >
                            Przejdź do widoku nakłady
                          </button>
                        </>
                      );
                    })()}
                  </div>
                )}

                {!selectedItem && (
                  <p className="text-sm text-gray-500 text-center">
                    Wybierz element na kosztorysie, aby wyświetlić jego właściwości
                  </p>
                )}
              </div>
            )}

            {leftPanelMode === 'properties' && !selectedItem && (
              <div className="p-4">
                <p className="text-sm text-gray-500 text-center">
                  Wybierz element na kosztorysie, aby wyświetlić jego właściwości
                </p>
              </div>
            )}

            {leftPanelMode === 'export' && (
              <div className="p-3 flex flex-col h-full">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Eksportuj kosztorys</h3>

                {/* Zawartość section */}
                <p className="text-xs text-gray-500 mb-2">Zawartość</p>

                {/* Template dropdown - Szablon */}
                <p className="text-xs text-gray-500 mb-1">Szablon</p>
                <select
                  value={exportTemplate}
                  onChange={(e) => {
                    const newTemplate = e.target.value as ExportTemplate;
                    setExportTemplate(newTemplate);
                    // Set pages based on template
                    const templatePageIds = TEMPLATE_PAGES[newTemplate] || [];
                    const newPages = templatePageIds.map(id => {
                      const page = ALL_EXPORT_PAGES.find(p => p.id === id);
                      return page ? { ...page } : null;
                    }).filter((p): p is ExportPage => p !== null);
                    setExportPages(newPages);
                  }}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg mb-3"
                >
                  <option value="niestandardowy">Niestandardowy</option>
                  <option value="kosztorys_ofertowy">Kosztorys ofertowy</option>
                  <option value="przedmiar_robot">Przedmiar robót</option>
                </select>

                {/* Search field */}
                <div className="relative mb-3">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Wyszukaj..."
                    value={exportSearch}
                    onChange={(e) => setExportSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 text-sm border border-gray-300 rounded-lg"
                  />
                </div>

                {/* Kolejność stron label */}
                <p className="text-xs text-gray-500 mb-2">Kolejność stron</p>

                {/* Draggable export pages list - full drag-and-drop support */}
                <div className="flex-1 overflow-y-auto space-y-1">
                  {exportPages.length === 0 ? (
                    <div className="text-center text-gray-400 text-xs py-4">
                      Brak stron do wydruku
                    </div>
                  ) : exportPages
                    .filter(p => !exportSearch || p.label.toLowerCase().includes(exportSearch.toLowerCase()))
                    .map((page, index) => (
                    <div
                      key={page.id}
                      className={`outline-none bg-white hover:bg-gray-50 flex items-center gap-2 rounded p-2 border focus-visible:border-gray-600 text-xs text-left cursor-grab transition-all ${
                        page.enabled ? 'border-gray-300' : 'border-gray-200 bg-gray-50 opacity-60'
                      } ${draggedExportPageId === page.id ? 'opacity-50 scale-95' : ''} ${activeExportSection === page.id ? 'ring-2 ring-blue-500 bg-blue-50' : ''}`}
                      draggable
                      onDragStart={(e) => {
                        setDraggedExportPageId(page.id);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragEnd={() => setDraggedExportPageId(null)}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (!draggedExportPageId || draggedExportPageId === page.id) return;

                        const newPages = [...exportPages];
                        const draggedIndex = newPages.findIndex(p => p.id === draggedExportPageId);
                        const dropIndex = newPages.findIndex(p => p.id === page.id);

                        if (draggedIndex !== -1 && dropIndex !== -1) {
                          const [draggedItem] = newPages.splice(draggedIndex, 1);
                          newPages.splice(dropIndex, 0, draggedItem);
                          setExportPages(newPages);
                        }
                        setDraggedExportPageId(null);
                      }}
                    >
                      <GripVertical className="w-4 h-4 text-gray-400 flex-shrink-0" />
                      <input
                        type="checkbox"
                        checked={page.enabled}
                        onChange={(e) => {
                          e.stopPropagation();
                          const newPages = [...exportPages];
                          const actualIndex = exportPages.findIndex(p => p.id === page.id);
                          newPages[actualIndex] = { ...page, enabled: !page.enabled };
                          setExportPages(newPages);
                        }}
                        className="w-4 h-4 rounded border-gray-300 flex-shrink-0"
                      />
                      <span
                        className="flex-1 text-xs text-gray-800 truncate cursor-pointer hover:text-blue-600"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (page.enabled) {
                            scrollToExportSection(page.id);
                          }
                        }}
                      >
                        {page.label}
                      </span>
                      {page.canEdit && (
                        <button
                          onClick={() => setLeftPanelMode('titlePageEditor')}
                          className="flex items-center justify-center rounded font-semibold whitespace-nowrap focus-visible:ring-1 focus:ring-blue-400 focus:ring-opacity-50 focus:outline-none transition-colors shrink-0 border border-transparent hover:bg-gray-900 hover:bg-opacity-20 rounded-full h-7 w-7"
                          title="Edytuj stronę tytułową"
                        >
                          <SquarePen className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => {
                          const newPages = exportPages.filter(p => p.id !== page.id);
                          setExportPages(newPages);
                        }}
                        className="p-1 hover:bg-gray-100 rounded flex-shrink-0"
                        title="Usuń"
                      >
                        <X className="w-3 h-3 text-gray-400" />
                      </button>
                    </div>
                  ))}
                </div>

                {/* Add page and print buttons - fixed at bottom */}
                <div className="mt-4 pt-3 border-t border-gray-200 flex gap-2 relative">
                  <div className="flex-1 relative">
                    <button
                      onClick={() => setShowAddPageDropdown(!showAddPageDropdown)}
                      className="w-full flex items-center justify-center gap-1 px-3 py-2 text-sm border border-dashed border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50"
                    >
                      <Plus className="w-4 h-4" />
                      Dodaj
                    </button>

                    {/* Dropdown with available pages */}
                    {showAddPageDropdown && (
                      <div className="absolute bottom-full left-0 mb-1 bg-white border border-gray-300 rounded-lg shadow-lg z-10 max-h-64 overflow-y-auto min-w-[280px]">
                        <div className="p-2 space-y-0.5">
                          {ALL_EXPORT_PAGES
                            .filter(page => !exportPages.some(p => p.id === page.id))
                            .map(page => (
                              <label key={page.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 rounded cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={false}
                                  onChange={() => {
                                    // Immediately add page to list
                                    const pageToAdd = ALL_EXPORT_PAGES.find(p => p.id === page.id);
                                    if (pageToAdd) {
                                      setExportPages([...exportPages, { ...pageToAdd }]);
                                    }
                                  }}
                                  className="w-4 h-4 rounded border-gray-300 flex-shrink-0"
                                />
                                <span className="text-sm text-gray-800">{page.label}</span>
                              </label>
                            ))}
                          {ALL_EXPORT_PAGES.filter(page => !exportPages.some(p => p.id === page.id)).length === 0 && (
                            <p className="text-sm text-gray-400 text-center py-2">Wszystkie strony zostały dodane</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={handlePrintDocument}
                    className="flex-1 flex items-center justify-center gap-1 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    <Printer className="w-4 h-4" />
                    Drukuj
                  </button>
                </div>
              </div>
            )}

            {leftPanelMode === 'catalog' && (
              <div className="flex flex-col h-full">
                {/* Search with settings */}
                <div className="p-3 border-b border-gray-200">
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Szukaj pozycji (min. 2 znaki)"
                        value={catalogSearch}
                        onChange={e => {
                          setCatalogSearch(e.target.value);
                          searchCatalogFromDb(e.target.value);
                        }}
                        className="w-full pl-8 pr-8 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      {catalogSearchLoading && (
                        <Loader2 className="absolute right-7 top-1/2 -translate-y-1/2 w-3 h-3 animate-spin text-gray-400" />
                      )}
                      {catalogSearch && (
                        <button
                          onClick={() => {
                            setCatalogSearch('');
                            setCatalogSearchResults(null);
                          }}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 hover:bg-gray-100 rounded"
                        >
                          <X className="w-3 h-3 text-gray-400" />
                        </button>
                      )}
                    </div>
                    <button
                      onClick={() => setShowKatalogImportModal(true)}
                      className="p-2 hover:bg-gray-100 rounded border border-gray-300"
                      title="Wczytaj inne normatywy"
                    >
                      <Settings className="w-4 h-4 text-gray-500" />
                    </button>
                    <button
                      onClick={() => setLeftPanelMode('overview')}
                      className="p-2 hover:bg-gray-100 rounded"
                    >
                      <X className="w-4 h-4 text-gray-500" />
                    </button>
                  </div>
                </div>

                {/* Column headers */}
                <div className="flex items-center justify-between px-4 py-2 text-xs text-gray-500 border-b border-gray-100">
                  <span>Podstawa</span>
                  <span>Opis</span>
                </div>

                {/* Catalog tree */}
                <div className="flex-1 overflow-y-auto p-2">
                  {/* Search results */}
                  {catalogSearchResults ? (
                    <div>
                      <div className="px-2 py-1 text-xs text-gray-500 mb-1">
                        Wyniki wyszukiwania ({catalogSearchResults.length})
                      </div>
                      {catalogSearchResults.length > 0 ? (
                        catalogSearchResults.map(item => (
                          <div
                            key={item.id}
                            className={`flex items-start gap-1 py-1.5 px-2 rounded cursor-pointer text-xs ${
                              selectedCatalogItem?.id === item.id ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50'
                            } border border-gray-200`}
                            onClick={() => {
                              setSelectedCatalogItem(item);
                              loadResourcesForPosition(item.id).then(norms => {
                                if (norms.length > 0) {
                                  setSelectedCatalogItem(prev => prev?.id === item.id ? { ...prev!, norms } : prev);
                                }
                              });
                              if (item.unit) {
                                setCatalogSelectedUnit(item.unit);
                              }
                            }}
                          >
                            <FileText className="w-3 h-3 text-gray-400 flex-shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                              <div className="font-mono text-blue-600">{item.code}</div>
                              <div className="text-gray-500">{item.name}</div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-xs text-gray-400 text-center py-4">Brak wyników</div>
                      )}
                    </div>
                  ) : (
                    /* Katalog Systemowy section */
                    <div className="mb-2">
                      <button
                        className="w-full flex items-center gap-1 px-2 py-1.5 text-sm font-medium text-gray-900 hover:bg-gray-50 rounded"
                        onClick={() => {/* toggle system catalog */}}
                      >
                        <ChevronDown className="w-4 h-4" />
                        <span>Katalog systemowy</span>
                        {catalogLoading && <Loader2 className="w-3 h-3 animate-spin ml-1" />}
                      </button>
                      <div className="ml-2">
                        {catalogLoading ? (
                          <div className="flex items-center justify-center py-4 text-sm text-gray-500">
                            <Loader2 className="w-4 h-4 animate-spin mr-2" />
                            Ładowanie katalogu...
                          </div>
                        ) : knrCatalog.length > 0 ? (
                          renderCatalogTree(knrCatalog, 0)
                        ) : (
                          renderCatalogTree(KNR_CATALOG, 0)
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Insert position form */}
                {selectedCatalogItem?.type === 'position' && (
                  <div className="p-3 border-t border-gray-200 bg-gray-50">
                    <p className="text-xs font-mono text-blue-600 mb-0.5">{selectedCatalogItem.code}</p>
                    <p className="text-xs text-gray-600 mb-2" title={selectedCatalogItem.name}>
                      {selectedCatalogItem.name}
                    </p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <label className="text-xs text-gray-500">Ilość</label>
                        <input
                          type="number"
                          value={catalogQuantity}
                          onChange={e => setCatalogQuantity(e.target.value)}
                          className="flex items-center rounded-md px-1.5 py-1.5 text-xs border focus-visible:ring-1 focus:ring-blue-400 focus:ring-opacity-50 focus:outline-none disabled:bg-gray-50 border-gray-400 w-full"
                        />
                      </div>
                      <div className="w-20">
                        <label className="text-xs text-gray-500">j.m.</label>
                        <select
                          value={catalogSelectedUnit}
                          onChange={e => setCatalogSelectedUnit(e.target.value)}
                          className="w-full px-1 py-1.5 text-xs border border-gray-400 rounded focus:ring-1 focus:ring-blue-400 focus:outline-none bg-white"
                        >
                          {(knrUnits.length > 0 ? knrUnits : UNITS_REFERENCE.map(u => u.unit)).map(unit => (
                            <option key={unit} value={unit}>{unit}</option>
                          ))}
                        </select>
                      </div>
                      <div className="w-20">
                        <label className="text-xs text-gray-500">Krotność</label>
                        <input
                          type="number"
                          value={catalogMultiplier}
                          onChange={e => setCatalogMultiplier(e.target.value)}
                          className="flex items-center rounded-md px-1.5 py-1.5 text-xs border focus-visible:ring-1 focus:ring-blue-400 focus:ring-opacity-50 focus:outline-none disabled:bg-gray-50 border-gray-400 w-full"
                        />
                      </div>
                    </div>
                    <button
                      onClick={async () => {
                        // Ensure resources are loaded before inserting
                        let itemToInsert = selectedCatalogItem;
                        if (!itemToInsert.norms) {
                          const norms = await loadResourcesForPosition(itemToInsert.id);
                          if (norms.length > 0) {
                            itemToInsert = { ...itemToInsert, norms };
                            setSelectedCatalogItem(itemToInsert);
                          }
                        }
                        insertFromCatalog(itemToInsert);
                      }}
                      className="flex items-center justify-center font-semibold whitespace-nowrap focus-visible:ring-1 focus:ring-blue-400 focus:ring-opacity-50 focus:outline-none transition-colors bg-blue-600 hover:bg-blue-700 text-white aria-disabled:bg-opacity-30 text-sm gap-2.5 leading-tight px-2.5 py-1.5 [&_svg]:w-4 [&_svg]:h-4 rounded w-full mt-2"
                    >
                      Wstaw
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Comments panel - matching eKosztorysowanie exactly */}
            {leftPanelMode === 'comments' && (
              <div className="flex flex-col h-full">
                {/* Header */}
                <div className="flex items-center justify-between p-3 border-b border-gray-200">
                  <h3 className="text-sm font-semibold text-gray-900">Komentarze</h3>
                  <button
                    onClick={() => setLeftPanelMode('overview')}
                    className="p-1 hover:bg-gray-100 rounded"
                  >
                    <X className="w-4 h-4 text-gray-500" />
                  </button>
                </div>

                {/* Filter row */}
                <div className="flex items-center gap-2 p-3 border-b border-gray-100">
                  {/* Category filter dropdown */}
                  <select
                    value={commentsFilter}
                    onChange={(e) => setCommentsFilter(e.target.value as any)}
                    className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white"
                  >
                    <option value="all">Wszystkie komentarze</option>
                    <option value="verification">Do weryfikacji</option>
                    <option value="completion">Do uzupełnienia</option>
                    <option value="none">Bez kategorii</option>
                  </select>

                  {/* Sort filter button */}
                  <div className="relative">
                    <button
                      onClick={() => setShowCommentsSortDropdown(!showCommentsSortDropdown)}
                      className="p-2 hover:bg-gray-100 rounded border border-gray-300"
                    >
                      <Filter className="w-4 h-4 text-gray-500" />
                    </button>
                    {showCommentsSortDropdown && (
                      <div className="absolute top-full right-0 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
                        <label className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 cursor-pointer">
                          <input
                            type="radio"
                            name="commentSort"
                            checked={commentsSortBy === 'date'}
                            onChange={() => { setCommentsSortBy('date'); setShowCommentsSortDropdown(false); }}
                            className="w-4 h-4 text-blue-600"
                          />
                          Sortuj po dacie utworzenia
                        </label>
                        <label className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 cursor-pointer">
                          <input
                            type="radio"
                            name="commentSort"
                            checked={commentsSortBy === 'activity'}
                            onChange={() => { setCommentsSortBy('activity'); setShowCommentsSortDropdown(false); }}
                            className="w-4 h-4 text-blue-600"
                          />
                          Sortuj po najnowszej aktywności
                        </label>
                      </div>
                    )}
                  </div>
                </div>

                {/* Comments list */}
                <div className="flex-1 overflow-y-auto">
                  {comments
                    .filter(c => {
                      if (commentsFilter === 'all') return showCompletedTasks || !c.completed;
                      if (!showCompletedTasks && c.completed) return false;
                      return c.category === commentsFilter;
                    })
                    .sort((a, b) => {
                      if (commentsSortBy === 'date') {
                        return b.createdAt.localeCompare(a.createdAt);
                      }
                      return b.createdAt.localeCompare(a.createdAt); // For now, same as date
                    })
                    .map(comment => (
                      <div
                        key={comment.id}
                        className={`p-3 border-b border-gray-100 cursor-pointer hover:bg-gray-50 ${
                          selectedCommentId === comment.id ? 'bg-blue-50' : ''
                        }`}
                        onClick={() => {
                          setSelectedCommentId(comment.id);
                          // Navigate to target
                          if (comment.targetType === 'position' || comment.targetType === 'section') {
                            selectItem(comment.targetId, comment.targetType);
                          }
                        }}
                      >
                        {/* Date and location */}
                        <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                          <span>{comment.createdAt}</span>
                          <span className="text-blue-600">{comment.targetPath}</span>
                        </div>

                        {/* Category dropdown and completion checkbox */}
                        <div className="flex items-center justify-between mb-2">
                          <div className="relative">
                            <select
                              value={comment.category}
                              onChange={(e) => {
                                e.stopPropagation();
                                setComments(prev => prev.map(c =>
                                  c.id === comment.id ? { ...c, category: e.target.value as CommentCategory } : c
                                ));
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className={`text-xs px-2 py-1 rounded-lg border-0 cursor-pointer ${
                                comment.category === 'verification' ? 'bg-blue-50 text-blue-700' :
                                comment.category === 'completion' ? 'bg-orange-50 text-orange-700' :
                                'bg-gray-100 text-gray-600'
                              }`}
                            >
                              <option value="none">● Bez kategorii</option>
                              <option value="verification">● Do weryfikacji</option>
                              <option value="completion">● Do uzupełnienia</option>
                            </select>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setComments(prev => prev.map(c =>
                                c.id === comment.id ? { ...c, completed: !c.completed } : c
                              ));
                            }}
                            className={`p-1 rounded-full border ${
                              comment.completed ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 text-gray-400 hover:border-gray-400'
                            }`}
                          >
                            <Check className="w-3 h-3" />
                          </button>
                        </div>

                        {/* Author info */}
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs font-bold">
                            {comment.userInitials}
                          </div>
                          <div className="flex-1">
                            <span className="text-sm font-medium text-gray-800">{comment.userName}</span>
                            <span className="text-xs text-gray-400 ml-2">{comment.createdAt}</span>
                          </div>
                        </div>

                        {/* Comment text - editable when selected */}
                        {selectedCommentId === comment.id ? (
                          <div className="mt-2 space-y-2">
                            <textarea
                              value={comment.text}
                              onChange={(e) => {
                                setComments(prev => prev.map(c =>
                                  c.id === comment.id ? { ...c, text: e.target.value } : c
                                ));
                              }}
                              onClick={(e) => e.stopPropagation()}
                              placeholder="Dodaj treść komentarza..."
                              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded resize-none"
                              rows={2}
                            />
                            <div className="flex items-center justify-between">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setComments(prev => prev.filter(c => c.id !== comment.id));
                                  setSelectedCommentId(null);
                                }}
                                className="text-xs text-red-600 hover:text-red-700"
                              >
                                <Trash2 className="w-3 h-3 inline mr-1" />
                                Usuń
                              </button>
                              <div className="flex items-center gap-3">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    // Navigate to target
                                    if (comment.targetType === 'position' || comment.targetType === 'section' || comment.targetType === 'resource') {
                                      setEditorState(prev => ({
                                        ...prev,
                                        selectedItemId: comment.targetId,
                                        selectedItemType: comment.targetType as 'section' | 'position' | 'resource',
                                      }));
                                    }
                                  }}
                                  className="text-xs text-blue-600 hover:text-blue-700"
                                >
                                  <ArrowUpRight className="w-3 h-3 inline mr-1" />
                                  Idź do elementu
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedCommentId(null);
                                  }}
                                  className="p-1.5 bg-blue-600 text-white rounded hover:bg-blue-700"
                                  title="Zapisz"
                                >
                                  <Save className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-gray-500 mt-1">{comment.text || <span className="italic text-gray-400">Brak treści</span>}</p>
                        )}
                      </div>
                    ))}

                  {comments.filter(c => showCompletedTasks || !c.completed).length === 0 && (
                    <p className="text-sm text-gray-400 text-center py-8">Brak komentarzy</p>
                  )}
                </div>

                {/* Add comment button */}
                <div className="p-3 border-t border-gray-200">
                  <button
                    onClick={() => {
                      setCommentSelectionMode(true);
                      setLeftPanelMode('overview');
                    }}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm border border-dashed border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50"
                  >
                    <Plus className="w-4 h-4" />
                    Wstaw komentarz do...
                  </button>
                </div>
              </div>
            )}

            {/* Title Page Editor - Strona tytułowa */}
            {leftPanelMode === 'titlePageEditor' && (
              <div className="p-3 flex flex-col h-full overflow-y-auto">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-900">Strona tytułowa</h3>
                  <button
                    onClick={() => setLeftPanelMode('export')}
                    className="text-xs text-blue-600 hover:text-blue-700"
                  >
                    ← Powrót do wydruku
                  </button>
                </div>

                {/* Tytuł section */}
                <div className="border border-gray-200 rounded-lg mb-3">
                  <button
                    onClick={() => setTitlePageSections(prev => ({ ...prev, title: !prev.title }))}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
                  >
                    <span>Tytuł</span>
                    {titlePageSections.title ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  {titlePageSections.title && (
                    <div className="px-3 pb-3 space-y-2">
                      <input
                        type="text"
                        value={titlePageData.title}
                        onChange={e => setTitlePageData(prev => ({ ...prev, title: e.target.value }))}
                        placeholder="Tytuł kosztorysu"
                        className="flex items-center rounded-md px-1.5 py-1.5 text-xs border focus-visible:ring-1 focus:ring-blue-400 focus:ring-opacity-50 focus:outline-none disabled:bg-gray-50 border-gray-400 w-full"
                      />
                    </div>
                  )}
                </div>

                {/* Wartość robót section */}
                <div className="border border-gray-200 rounded-lg mb-3">
                  <button
                    onClick={() => setTitlePageSections(prev => ({ ...prev, workValue: !prev.workValue }))}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
                  >
                    <span>Wartość robót</span>
                    {titlePageSections.workValue ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  {titlePageSections.workValue && (
                    <div className="px-3 pb-3 space-y-2">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={titlePageData.hideManHourRate}
                          onChange={e => setTitlePageData(prev => ({ ...prev, hideManHourRate: e.target.checked }))}
                          className="w-4 h-4 rounded border-gray-300"
                        />
                        <span className="text-xs text-gray-600">Ukryj stawkę roboczogodziny</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={titlePageData.hideOverheads}
                          onChange={e => setTitlePageData(prev => ({ ...prev, hideOverheads: e.target.checked }))}
                          className="w-4 h-4 rounded border-gray-300"
                        />
                        <span className="text-xs text-gray-600">Ukryj narzuty</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={titlePageData.hideWorkValue}
                          onChange={e => setTitlePageData(prev => ({ ...prev, hideWorkValue: e.target.checked }))}
                          className="w-4 h-4 rounded border-gray-300"
                        />
                        <span className="text-xs text-gray-600">Ukryj wartość robót</span>
                      </label>
                    </div>
                  )}
                </div>

                {/* Podmiot opracowujący kosztorys section */}
                <div className="border border-gray-200 rounded-lg mb-3">
                  <button
                    onClick={() => setTitlePageSections(prev => ({ ...prev, company: !prev.company }))}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
                  >
                    <span>Podmiot opracowujący kosztorys</span>
                    {titlePageSections.company ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  {titlePageSections.company && (
                    <div className="px-3 pb-3 space-y-2">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Nazwa</label>
                        <input
                          type="text"
                          value={titlePageData.companyName}
                          onChange={e => setTitlePageData(prev => ({ ...prev, companyName: e.target.value }))}
                          className="flex items-center rounded-md px-1.5 py-1.5 text-xs border focus-visible:ring-1 focus:ring-blue-400 focus:ring-opacity-50 focus:outline-none disabled:bg-gray-50 border-gray-400 w-full"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Adres podmiotu</label>
                        <textarea
                          value={titlePageData.companyAddress}
                          onChange={e => setTitlePageData(prev => ({ ...prev, companyAddress: e.target.value }))}
                          className="flex items-center rounded-md px-1.5 py-1.5 text-xs border focus-visible:ring-1 focus:ring-blue-400 focus:ring-opacity-50 focus:outline-none disabled:bg-gray-50 border-gray-400 w-full resize-none"
                          rows={2}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Zamówienie section */}
                <div className="border border-gray-200 rounded-lg mb-3">
                  <button
                    onClick={() => setTitlePageSections(prev => ({ ...prev, order: !prev.order }))}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
                  >
                    <span>Zamówienie</span>
                    {titlePageSections.order ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  {titlePageSections.order && (
                    <div className="px-3 pb-3 space-y-2">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Nazwa</label>
                        <input
                          type="text"
                          value={titlePageData.orderName}
                          onChange={e => setTitlePageData(prev => ({ ...prev, orderName: e.target.value }))}
                          className="flex items-center rounded-md px-1.5 py-1.5 text-xs border focus-visible:ring-1 focus:ring-blue-400 focus:ring-opacity-50 focus:outline-none disabled:bg-gray-50 border-gray-400 w-full"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Adres obiektu budowlanego</label>
                        <textarea
                          value={titlePageData.orderAddress}
                          onChange={e => setTitlePageData(prev => ({ ...prev, orderAddress: e.target.value }))}
                          className="flex items-center rounded-md px-1.5 py-1.5 text-xs border focus-visible:ring-1 focus:ring-blue-400 focus:ring-opacity-50 focus:outline-none disabled:bg-gray-50 border-gray-400 w-full resize-none"
                          rows={2}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Zamawiający section */}
                <div className="border border-gray-200 rounded-lg mb-3">
                  <button
                    onClick={() => setTitlePageSections(prev => ({ ...prev, client: !prev.client }))}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
                  >
                    <span>Zamawiający</span>
                    {titlePageSections.client ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  {titlePageSections.client && (
                    <div className="px-3 pb-3 space-y-2">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Nazwa</label>
                        <input
                          type="text"
                          value={titlePageData.clientName}
                          onChange={e => setTitlePageData(prev => ({ ...prev, clientName: e.target.value }))}
                          className="flex items-center rounded-md px-1.5 py-1.5 text-xs border focus-visible:ring-1 focus:ring-blue-400 focus:ring-opacity-50 focus:outline-none disabled:bg-gray-50 border-gray-400 w-full"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Adres zamawiającego</label>
                        <textarea
                          value={titlePageData.clientAddress}
                          onChange={e => setTitlePageData(prev => ({ ...prev, clientAddress: e.target.value }))}
                          className="flex items-center rounded-md px-1.5 py-1.5 text-xs border focus-visible:ring-1 focus:ring-blue-400 focus:ring-opacity-50 focus:outline-none disabled:bg-gray-50 border-gray-400 w-full resize-none"
                          rows={2}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Wykonawca section */}
                <div className="border border-gray-200 rounded-lg mb-3">
                  <button
                    onClick={() => setTitlePageSections(prev => ({ ...prev, contractor: !prev.contractor }))}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
                  >
                    <span>Wykonawca</span>
                    {titlePageSections.contractor ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  {titlePageSections.contractor && (
                    <div className="px-3 pb-3 space-y-2">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Nazwa</label>
                        <input
                          type="text"
                          value={titlePageData.contractorName}
                          onChange={e => setTitlePageData(prev => ({ ...prev, contractorName: e.target.value }))}
                          className="flex items-center rounded-md px-1.5 py-1.5 text-xs border focus-visible:ring-1 focus:ring-blue-400 focus:ring-opacity-50 focus:outline-none disabled:bg-gray-50 border-gray-400 w-full"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Adres</label>
                        <textarea
                          value={titlePageData.contractorAddress}
                          onChange={e => setTitlePageData(prev => ({ ...prev, contractorAddress: e.target.value }))}
                          className="flex items-center rounded-md px-1.5 py-1.5 text-xs border focus-visible:ring-1 focus:ring-blue-400 focus:ring-opacity-50 focus:outline-none disabled:bg-gray-50 border-gray-400 w-full resize-none"
                          rows={2}
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Branża</label>
                        <input
                          type="text"
                          value={titlePageData.industry}
                          onChange={e => setTitlePageData(prev => ({ ...prev, industry: e.target.value }))}
                          placeholder="np. Budowlana, Elektryczna"
                          className="flex items-center rounded-md px-1.5 py-1.5 text-xs border focus-visible:ring-1 focus:ring-blue-400 focus:ring-opacity-50 focus:outline-none disabled:bg-gray-50 border-gray-400 w-full"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">NIP</label>
                        <input
                          type="text"
                          value={titlePageData.contractorNIP}
                          onChange={e => setTitlePageData(prev => ({ ...prev, contractorNIP: e.target.value }))}
                          placeholder="np. 123-456-78-90"
                          className="flex items-center rounded-md px-1.5 py-1.5 text-xs border focus-visible:ring-1 focus:ring-blue-400 focus:ring-opacity-50 focus:outline-none disabled:bg-gray-50 border-gray-400 w-full"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Osoby odpowiedzialne section */}
                <div className="border border-gray-200 rounded-lg mb-3">
                  <button
                    onClick={() => setTitlePageSections(prev => ({ ...prev, participants: !prev.participants }))}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
                  >
                    <span>Osoby odpowiedzialne</span>
                    {titlePageSections.participants ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  {titlePageSections.participants && (
                    <div className="px-3 pb-3 space-y-3">
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-gray-600">Opracował</p>
                        <input
                          type="text"
                          value={titlePageData.preparedBy}
                          onChange={e => setTitlePageData(prev => ({ ...prev, preparedBy: e.target.value }))}
                          placeholder="Imię i nazwisko"
                          className="flex items-center rounded-md px-1.5 py-1.5 text-xs border focus-visible:ring-1 focus:ring-blue-400 focus:ring-opacity-50 focus:outline-none disabled:bg-gray-50 border-gray-400 w-full"
                        />
                        <input
                          type="text"
                          value={titlePageData.preparedByIndustry}
                          onChange={e => setTitlePageData(prev => ({ ...prev, preparedByIndustry: e.target.value }))}
                          placeholder="Branża"
                          className="flex items-center rounded-md px-1.5 py-1.5 text-xs border focus-visible:ring-1 focus:ring-blue-400 focus:ring-opacity-50 focus:outline-none disabled:bg-gray-50 border-gray-400 w-full"
                        />
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-gray-600">Sprawdził</p>
                        <input
                          type="text"
                          value={titlePageData.checkedBy}
                          onChange={e => setTitlePageData(prev => ({ ...prev, checkedBy: e.target.value }))}
                          placeholder="Imię i nazwisko"
                          className="flex items-center rounded-md px-1.5 py-1.5 text-xs border focus-visible:ring-1 focus:ring-blue-400 focus:ring-opacity-50 focus:outline-none disabled:bg-gray-50 border-gray-400 w-full"
                        />
                        <input
                          type="text"
                          value={titlePageData.checkedByIndustry}
                          onChange={e => setTitlePageData(prev => ({ ...prev, checkedByIndustry: e.target.value }))}
                          placeholder="Branża"
                          className="flex items-center rounded-md px-1.5 py-1.5 text-xs border focus-visible:ring-1 focus:ring-blue-400 focus:ring-opacity-50 focus:outline-none disabled:bg-gray-50 border-gray-400 w-full"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Daty section */}
                <div className="border border-gray-200 rounded-lg mb-3">
                  <button
                    onClick={() => setTitlePageSections(prev => ({ ...prev, dates: !prev.dates }))}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
                  >
                    <span>Daty</span>
                    {titlePageSections.dates ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  {titlePageSections.dates && (
                    <div className="px-3 pb-3 space-y-2">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Data opracowania</label>
                        <input
                          type="date"
                          value={titlePageData.preparedDate}
                          onChange={e => setTitlePageData(prev => ({ ...prev, preparedDate: e.target.value }))}
                          className="flex items-center rounded-md px-1.5 py-1.5 text-xs border focus-visible:ring-1 focus:ring-blue-400 focus:ring-opacity-50 focus:outline-none disabled:bg-gray-50 border-gray-400 w-full"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Data zatwierdzenia</label>
                        <input
                          type="date"
                          value={titlePageData.approvedDate}
                          onChange={e => setTitlePageData(prev => ({ ...prev, approvedDate: e.target.value }))}
                          className="flex items-center rounded-md px-1.5 py-1.5 text-xs border focus-visible:ring-1 focus:ring-blue-400 focus:ring-opacity-50 focus:outline-none disabled:bg-gray-50 border-gray-400 w-full"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Stawki section - matching eKosztorysowanie documentation */}
                <div className="border border-gray-200 rounded-lg mb-3">
                  <button
                    onClick={() => setTitlePageSections(prev => ({ ...prev, stawki: !prev.stawki }))}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
                  >
                    <span>Stawki</span>
                    {titlePageSections.stawki ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  {titlePageSections.stawki && (
                    <div className="px-3 pb-3 space-y-2">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Stawka robocizny</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={titlePageData.stawkaRobocizny}
                            onChange={e => setTitlePageData(prev => ({ ...prev, stawkaRobocizny: e.target.value }))}
                            placeholder="0,00"
                            className="flex-1 items-center rounded-md px-1.5 py-1.5 text-xs border focus-visible:ring-1 focus:ring-blue-400 focus:ring-opacity-50 focus:outline-none disabled:bg-gray-50 border-gray-400 text-right"
                          />
                          <span className="text-xs text-gray-500">PLN/r-g</span>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Koszty pośrednie (Kp)</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={titlePageData.kosztyPosrednie}
                            onChange={e => setTitlePageData(prev => ({ ...prev, kosztyPosrednie: e.target.value }))}
                            placeholder="0"
                            className="flex-1 items-center rounded-md px-1.5 py-1.5 text-xs border focus-visible:ring-1 focus:ring-blue-400 focus:ring-opacity-50 focus:outline-none disabled:bg-gray-50 border-gray-400 text-right"
                          />
                          <span className="text-xs text-gray-500">%</span>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Zysk (Z)</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={titlePageData.zysk}
                            onChange={e => setTitlePageData(prev => ({ ...prev, zysk: e.target.value }))}
                            placeholder="0"
                            className="flex-1 items-center rounded-md px-1.5 py-1.5 text-xs border focus-visible:ring-1 focus:ring-blue-400 focus:ring-opacity-50 focus:outline-none disabled:bg-gray-50 border-gray-400 text-right"
                          />
                          <span className="text-xs text-gray-500">%</span>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Koszty zakupu (Kz)</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={titlePageData.kosztyZakupu}
                            onChange={e => setTitlePageData(prev => ({ ...prev, kosztyZakupu: e.target.value }))}
                            placeholder="0"
                            className="flex-1 items-center rounded-md px-1.5 py-1.5 text-xs border focus-visible:ring-1 focus:ring-blue-400 focus:ring-opacity-50 focus:outline-none disabled:bg-gray-50 border-gray-400 text-right"
                          />
                          <span className="text-xs text-gray-500">%</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Apply button */}
                <button
                  onClick={() => {
                    setEditorState(prev => ({ ...prev, isDirty: true }));
                    showNotificationMessage('Strona tytułowa zaktualizowana', 'success');
                  }}
                  className="w-full px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Zastosuj zmiany
                </button>
              </div>
            )}

            {/* Settings panel */}
            {leftPanelMode === 'settings' && estimate && (
              <div className="p-3 flex flex-col h-full overflow-y-auto">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-900">Ustawienia kosztorysu</h3>
                  <button onClick={() => setLeftPanelMode('overview')} className="text-gray-400 hover:text-gray-600">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="space-y-4 flex-1">
                  {/* Nazwa kosztorysu */}
                  <div>
                    <label className="block text-sm font-medium text-gray-800 mb-1">Nazwa kosztorysu</label>
                    <input
                      type="text"
                      value={estimate.settings.name}
                      onChange={(e) => setEstimate(prev => prev ? {
                        ...prev,
                        settings: { ...prev.settings, name: e.target.value }
                      } : null)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                  </div>

                  {/* Rodzaj */}
                  <div>
                    <label className="block text-sm font-medium text-gray-800 mb-2">Rodzaj</label>
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="settingsEstimateType"
                          value="contractor"
                          checked={estimate.settings.type === 'contractor'}
                          onChange={() => setEstimate(prev => prev ? {
                            ...prev,
                            settings: { ...prev.settings, type: 'contractor' }
                          } : null)}
                          className="w-4 h-4 text-blue-600"
                        />
                        <span className="text-sm text-gray-800">Wykonawczy</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="settingsEstimateType"
                          value="investor"
                          checked={estimate.settings.type === 'investor'}
                          onChange={() => setEstimate(prev => prev ? {
                            ...prev,
                            settings: { ...prev.settings, type: 'investor' }
                          } : null)}
                          className="w-4 h-4 text-blue-600"
                        />
                        <span className="text-sm text-gray-800">Inwestorski</span>
                      </label>
                    </div>
                  </div>

                  {/* Kalkulacje */}
                  <div>
                    <label className="block text-sm font-medium text-gray-800 mb-1">Kalkulacje</label>
                    <select
                      value={estimate.settings.calculationTemplate}
                      onChange={(e) => setEstimate(prev => prev ? {
                        ...prev,
                        settings: { ...prev.settings, calculationTemplate: e.target.value as KosztorysCalculationTemplate }
                      } : prev)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    >
                      <option value="overhead-on-top">Narzuty „od góry" - liczenie od kosztów bezpośrednich</option>
                      <option value="overhead-cascade">Narzuty kaskadowe - liczenie od sumy poprzednich</option>
                      <option value="simple">Uproszczona - bez narzutów</option>
                    </select>
                  </div>

                  {/* Stawka VAT */}
                  <div>
                    <label className="block text-sm font-medium text-gray-800 mb-1">Stawka VAT</label>
                    <select
                      value={estimate.settings.vatRate ?? 23}
                      onChange={(e) => setEstimate(prev => prev ? {
                        ...prev,
                        settings: { ...prev.settings, vatRate: parseFloat(e.target.value) }
                      } : null)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    >
                      <option value={23}>23% — stawka podstawowa</option>
                      <option value={8}>8% — budownictwo mieszkaniowe, usługi</option>
                      <option value={5}>5% — żywność, książki</option>
                      <option value={0}>0% — eksport, WDT</option>
                      <option value={-1}>zw. — zwolniony z VAT</option>
                    </select>
                  </div>

                  {/* Opis */}
                  <div>
                    <label className="block text-sm font-medium text-gray-800 mb-1">Opis</label>
                    <textarea
                      value={estimate.settings.description}
                      onChange={(e) => setEstimate(prev => prev ? {
                        ...prev,
                        settings: { ...prev.settings, description: e.target.value }
                      } : null)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none"
                      rows={3}
                      placeholder="Dodaj opis kosztorysu..."
                    />
                  </div>

                  {/* Dokładność */}
                  <div className="border border-gray-200 rounded-lg p-3">
                    <h4 className="text-sm font-medium text-gray-800 mb-2">Dokładność</h4>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-600">Normy</span>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setEstimate(prev => prev ? {
                              ...prev,
                              settings: {
                                ...prev.settings,
                                precision: { ...prev.settings.precision, norms: Math.max(0, prev.settings.precision.norms - 1) }
                              }
                            } : null)}
                            className="w-6 h-6 flex items-center justify-center border border-gray-300 rounded hover:bg-gray-50"
                          >
                            <ChevronDown className="w-4 h-4" />
                          </button>
                          <span className="w-6 text-center text-sm">{estimate.settings.precision.norms}</span>
                          <button
                            onClick={() => setEstimate(prev => prev ? {
                              ...prev,
                              settings: {
                                ...prev.settings,
                                precision: { ...prev.settings.precision, norms: Math.min(10, prev.settings.precision.norms + 1) }
                              }
                            } : null)}
                            className="w-6 h-6 flex items-center justify-center border border-gray-300 rounded hover:bg-gray-50"
                          >
                            <ChevronUp className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-600">Wart</span>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setEstimate(prev => prev ? {
                              ...prev,
                              settings: {
                                ...prev.settings,
                                precision: { ...prev.settings.precision, unitValues: Math.max(0, prev.settings.precision.unitValues - 1) }
                              }
                            } : null)}
                            className="w-6 h-6 flex items-center justify-center border border-gray-300 rounded hover:bg-gray-50"
                          >
                            <ChevronDown className="w-4 h-4" />
                          </button>
                          <span className="w-6 text-center text-sm">{estimate.settings.precision.unitValues}</span>
                          <button
                            onClick={() => setEstimate(prev => prev ? {
                              ...prev,
                              settings: {
                                ...prev.settings,
                                precision: { ...prev.settings.precision, unitValues: Math.min(10, prev.settings.precision.unitValues + 1) }
                              }
                            } : null)}
                            className="w-6 h-6 flex items-center justify-center border border-gray-300 rounded hover:bg-gray-50"
                          >
                            <ChevronUp className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Footer buttons */}
                <div className="pt-3 border-t border-gray-200 flex gap-2 mt-auto">
                  <button
                    onClick={() => setLeftPanelMode('overview')}
                    className="flex-1 px-3 py-2 text-sm text-gray-800 border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    Anuluj
                  </button>
                  <button
                    onClick={() => {
                      setEditorState(prev => ({ ...prev, isDirty: true }));
                      setLeftPanelMode('overview');
                      showNotificationMessage('Ustawienia zapisane', 'success');
                    }}
                    className="flex-1 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    Zapisz ustawienia
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Table */}
        <div className={`flex-1 overflow-auto bg-white ${commentSelectionMode ? 'cursor-crosshair' : ''}`}>
          {/* Comment selection mode indicator */}
          {commentSelectionMode && (
            <div className="sticky top-0 z-20 bg-blue-500 text-white px-4 py-2 text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4" />
                Wybierz element do którego chcesz dodać komentarz (dział, pozycję lub nakład)
              </span>
              <button
                onClick={() => setCommentSelectionMode(false)}
                className="px-2 py-1 bg-blue-600 hover:bg-blue-700 rounded text-sm"
              >
                Anuluj
              </button>
            </div>
          )}
          {/* Narzuty View - summary with calculated values */}
          {viewMode === 'narzuty' && leftPanelMode !== 'export' && (() => {
            const laborTotal = calculationResult?.totalLabor || 0;
            const materialTotal = calculationResult?.totalMaterial || 0;
            const equipmentTotal = calculationResult?.totalEquipment || 0;

            const kpOverhead = estimateData.root.overheads.find(o => o.name.includes('Kp'));
            const zOverhead = estimateData.root.overheads.find(o => o.name.includes('Zysk'));
            const kzOverhead = estimateData.root.overheads.find(o => o.name.includes('zakupu'));

            const kpValue = kpOverhead ? laborTotal * (kpOverhead.value / 100) : 0;
            const kzValue = kzOverhead ? materialTotal * (kzOverhead.value / 100) : 0;
            const zBase = laborTotal + kpValue;
            const zValue = zOverhead ? zBase * (zOverhead.value / 100) : 0;

            return (
            <div className="p-4 space-y-6">
              {/* Koszt zakupu materiałów */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-2">Koszt zakupu materiałów</h3>
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 w-12">L.p.</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-400">Nazwa</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-400 w-16">Skrót</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-400 w-16">Stawka</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-400 w-24">Podstawa (M)</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-400 w-24">Wartość</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kzOverhead ? (
                      <tr className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-3 py-2 text-sm text-gray-600">1</td>
                        <td className="px-3 py-2 text-sm text-gray-800">{kzOverhead.name || 'Koszty zakupu'}</td>
                        <td className="px-3 py-2 text-sm text-right text-gray-600">Kz</td>
                        <td className="px-3 py-2 text-sm text-right text-gray-600">{kzOverhead.value}%</td>
                        <td className="px-3 py-2 text-sm text-right text-gray-600">{formatNumber(materialTotal, 2)}</td>
                        <td className="px-3 py-2 text-sm text-right font-medium text-gray-900">{formatNumber(kzValue, 2)}</td>
                      </tr>
                    ) : (
                      <tr>
                        <td colSpan={6} className="px-3 py-4 text-sm text-gray-400 text-center">
                          Brak kosztów zakupu
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Narzuty procentowe działów i pozycji */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-2">Narzuty procentowe działów i pozycji</h3>
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 w-12">L.p.</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-400">Nazwa</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-400 w-16">Skrót</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-400 w-16">Stawka</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-400 w-24">Podstawa</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-400 w-24">Wartość</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-400 w-24">Obliczane od</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-400 w-24">Ust. na poziomie</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kpOverhead && (
                      <tr className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-3 py-2 text-sm text-gray-600">1</td>
                        <td className="px-3 py-2 text-sm text-gray-800">Koszty pośrednie</td>
                        <td className="px-3 py-2 text-sm text-right text-gray-600">Kp</td>
                        <td className="px-3 py-2 text-sm text-right text-gray-600">{kpOverhead.value}%</td>
                        <td className="px-3 py-2 text-sm text-right text-gray-600">{formatNumber(laborTotal, 2)}</td>
                        <td className="px-3 py-2 text-sm text-right font-medium text-gray-900">{formatNumber(kpValue, 2)}</td>
                        <td className="px-3 py-2 text-sm text-right text-gray-600">R</td>
                        <td className="px-3 py-2 text-sm text-right text-gray-600">kosztorys</td>
                      </tr>
                    )}
                    {zOverhead && (
                      <tr className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-3 py-2 text-sm text-gray-600">{kpOverhead ? 2 : 1}</td>
                        <td className="px-3 py-2 text-sm text-gray-800">Zysk</td>
                        <td className="px-3 py-2 text-sm text-right text-gray-600">Z</td>
                        <td className="px-3 py-2 text-sm text-right text-gray-600">{zOverhead.value}%</td>
                        <td className="px-3 py-2 text-sm text-right text-gray-600">{formatNumber(zBase, 2)}</td>
                        <td className="px-3 py-2 text-sm text-right font-medium text-gray-900">{formatNumber(zValue, 2)}</td>
                        <td className="px-3 py-2 text-sm text-right text-gray-600">R+Kp</td>
                        <td className="px-3 py-2 text-sm text-right text-gray-600">kosztorys</td>
                      </tr>
                    )}
                    {!kpOverhead && !zOverhead && (
                      <tr>
                        <td colSpan={8} className="px-3 py-4 text-sm text-gray-400 text-center">
                          Brak narzutów procentowych
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Podsumowanie narzutów */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-2">Podsumowanie</h3>
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-400">Składnik</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-400 w-28">Wartość</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2 text-sm text-gray-800">Robocizna (R)</td>
                      <td className="px-3 py-2 text-sm text-right text-gray-600">{formatNumber(laborTotal, 2)}</td>
                    </tr>
                    <tr className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2 text-sm text-gray-800">Materiały (M)</td>
                      <td className="px-3 py-2 text-sm text-right text-gray-600">{formatNumber(materialTotal, 2)}</td>
                    </tr>
                    <tr className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2 text-sm text-gray-800">Sprzęt (S)</td>
                      <td className="px-3 py-2 text-sm text-right text-gray-600">{formatNumber(equipmentTotal, 2)}</td>
                    </tr>
                    <tr className="border-b border-gray-100 hover:bg-gray-50 bg-gray-50">
                      <td className="px-3 py-2 text-sm font-medium text-gray-900">Koszty bezpośrednie (R+M+S)</td>
                      <td className="px-3 py-2 text-sm text-right font-medium text-gray-900">{formatNumber(calculationResult?.totalDirect || 0, 2)}</td>
                    </tr>
                    {kpOverhead && kpOverhead.value > 0 && (
                      <tr className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-3 py-2 text-sm text-gray-800">Koszty pośrednie Kp ({kpOverhead.value}% od R)</td>
                        <td className="px-3 py-2 text-sm text-right text-gray-600">{formatNumber(kpValue, 2)}</td>
                      </tr>
                    )}
                    {zOverhead && zOverhead.value > 0 && (
                      <tr className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-3 py-2 text-sm text-gray-800">Zysk Z ({zOverhead.value}% od R+Kp)</td>
                        <td className="px-3 py-2 text-sm text-right text-gray-600">{formatNumber(zValue, 2)}</td>
                      </tr>
                    )}
                    {kzOverhead && kzOverhead.value > 0 && (
                      <tr className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-3 py-2 text-sm text-gray-800">Koszty zakupu Kz ({kzOverhead.value}% od M)</td>
                        <td className="px-3 py-2 text-sm text-right text-gray-600">{formatNumber(kzValue, 2)}</td>
                      </tr>
                    )}
                    <tr className="border-b border-gray-200 bg-blue-50">
                      <td className="px-3 py-2 text-sm font-bold text-blue-900">Razem z narzutami</td>
                      <td className="px-3 py-2 text-sm text-right font-bold text-blue-900">{formatNumber(calculationResult?.totalValue || 0, 2)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* VAT i podsumowanie brutto */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-2">VAT</h3>
                {(() => {
                  const totalNet = calculationResult?.totalValue || 0;
                  const currentVatRate = estimate?.settings?.vatRate ?? 23;
                  const isVatExempt = currentVatRate < 0;
                  const vatAmount = isVatExempt ? 0 : totalNet * (currentVatRate / 100);
                  const totalGross = totalNet + vatAmount;
                  return (
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-400">Składnik</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-400 w-28">Wartość</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="px-3 py-2 text-sm text-gray-800">Razem z narzutami (netto)</td>
                          <td className="px-3 py-2 text-sm text-right text-gray-600">{formatNumber(totalNet, 2)}</td>
                        </tr>
                        <tr className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="px-3 py-2 text-sm text-gray-800">{isVatExempt ? 'VAT (zw.)' : `VAT (${currentVatRate}%)`}</td>
                          <td className="px-3 py-2 text-sm text-right text-gray-600">{formatNumber(vatAmount, 2)}</td>
                        </tr>
                        <tr className="border-b border-gray-200 bg-green-50">
                          <td className="px-3 py-2 text-sm font-bold text-green-900">Razem z narzutami brutto (z VAT)</td>
                          <td className="px-3 py-2 text-sm text-right font-bold text-green-900">{formatNumber(totalGross, 2)}</td>
                        </tr>
                      </tbody>
                    </table>
                  );
                })()}
              </div>
            </div>
            );
          })()}

          {/* Zestawienia View - matching eKosztorysowanie summary layout */}
          {viewMode === 'zestawienia' && leftPanelMode !== 'export' && (() => {
            const zLaborTotal = calculationResult?.totalLabor || 0;
            const zMaterialTotal = calculationResult?.totalMaterial || 0;
            const zEquipmentTotal = calculationResult?.totalEquipment || 0;
            const zDirectTotal = calculationResult?.totalDirect || 0;

            const zKpOverhead = estimateData.root.overheads.find(o => o.name.includes('Kp'));
            const zZOverhead = estimateData.root.overheads.find(o => o.name.includes('Zysk'));
            const zKzOverhead = estimateData.root.overheads.find(o => o.name.includes('zakupu'));

            const zKpValue = zKpOverhead ? zLaborTotal * (zKpOverhead.value / 100) : 0;
            const zKzValue = zKzOverhead ? zMaterialTotal * (zKzOverhead.value / 100) : 0;
            const zBase = zLaborTotal + zKpValue;
            const zZValue = zZOverhead ? zBase * (zZOverhead.value / 100) : 0;

            const zTotalNet = calculationResult?.totalValue || 0;
            const zVatRate = estimate?.settings?.vatRate ?? 23;
            const zIsVatExempt = zVatRate < 0;
            const zVatAmount = zIsVatExempt ? 0 : zTotalNet * (zVatRate / 100);
            const zTotalGross = zTotalNet + zVatAmount;

            return (
            <div className="p-4">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Nazwa</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 w-28">Razem</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 w-24">R</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 w-24">M</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 w-24">S</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2 text-sm text-gray-800">Robocizna (R)</td>
                    <td className="px-3 py-2 text-sm text-right font-medium">{formatNumber(zLaborTotal, 2)}</td>
                    <td className="px-3 py-2 text-sm text-right text-gray-600">{formatNumber(zLaborTotal, 2)}</td>
                    <td className="px-3 py-2 text-sm text-right text-gray-600">{formatNumber(0, 2)}</td>
                    <td className="px-3 py-2 text-sm text-right text-gray-600">{formatNumber(0, 2)}</td>
                  </tr>
                  <tr className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2 text-sm text-gray-800">Materiały (M)</td>
                    <td className="px-3 py-2 text-sm text-right font-medium">{formatNumber(zMaterialTotal, 2)}</td>
                    <td className="px-3 py-2 text-sm text-right text-gray-600">{formatNumber(0, 2)}</td>
                    <td className="px-3 py-2 text-sm text-right text-gray-600">{formatNumber(zMaterialTotal, 2)}</td>
                    <td className="px-3 py-2 text-sm text-right text-gray-600">{formatNumber(0, 2)}</td>
                  </tr>
                  <tr className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2 text-sm text-gray-800">Sprzęt (S)</td>
                    <td className="px-3 py-2 text-sm text-right font-medium">{formatNumber(zEquipmentTotal, 2)}</td>
                    <td className="px-3 py-2 text-sm text-right text-gray-600">{formatNumber(0, 2)}</td>
                    <td className="px-3 py-2 text-sm text-right text-gray-600">{formatNumber(0, 2)}</td>
                    <td className="px-3 py-2 text-sm text-right text-gray-600">{formatNumber(zEquipmentTotal, 2)}</td>
                  </tr>
                  <tr className="border-b border-gray-100 hover:bg-gray-50 bg-gray-50">
                    <td className="px-3 py-2 text-sm font-medium text-gray-900">Koszty bezpośrednie (R+M+S)</td>
                    <td className="px-3 py-2 text-sm text-right font-medium text-gray-900">{formatNumber(zDirectTotal, 2)}</td>
                    <td className="px-3 py-2 text-sm text-right font-medium text-gray-600">{formatNumber(zLaborTotal, 2)}</td>
                    <td className="px-3 py-2 text-sm text-right font-medium text-gray-600">{formatNumber(zMaterialTotal, 2)}</td>
                    <td className="px-3 py-2 text-sm text-right font-medium text-gray-600">{formatNumber(zEquipmentTotal, 2)}</td>
                  </tr>
                  {zKpOverhead && zKpOverhead.value > 0 && (
                    <tr className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2 text-sm text-gray-800">Koszty pośrednie Kp ({zKpOverhead.value}% od R)</td>
                      <td className="px-3 py-2 text-sm text-right font-medium">{formatNumber(zKpValue, 2)}</td>
                      <td className="px-3 py-2 text-sm text-right text-gray-600"></td>
                      <td className="px-3 py-2 text-sm text-right text-gray-600"></td>
                      <td className="px-3 py-2 text-sm text-right text-gray-600"></td>
                    </tr>
                  )}
                  {zZOverhead && zZOverhead.value > 0 && (
                    <tr className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2 text-sm text-gray-800">Zysk Z ({zZOverhead.value}% od R+Kp)</td>
                      <td className="px-3 py-2 text-sm text-right font-medium">{formatNumber(zZValue, 2)}</td>
                      <td className="px-3 py-2 text-sm text-right text-gray-600"></td>
                      <td className="px-3 py-2 text-sm text-right text-gray-600"></td>
                      <td className="px-3 py-2 text-sm text-right text-gray-600"></td>
                    </tr>
                  )}
                  {zKzOverhead && zKzOverhead.value > 0 && (
                    <tr className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2 text-sm text-gray-800">Koszty zakupu Kz ({zKzOverhead.value}% od M)</td>
                      <td className="px-3 py-2 text-sm text-right font-medium">{formatNumber(zKzValue, 2)}</td>
                      <td className="px-3 py-2 text-sm text-right text-gray-600"></td>
                      <td className="px-3 py-2 text-sm text-right text-gray-600"></td>
                      <td className="px-3 py-2 text-sm text-right text-gray-600"></td>
                    </tr>
                  )}
                  <tr className="border-b border-gray-200 bg-blue-50">
                    <td className="px-3 py-2 text-sm font-bold text-blue-900">Razem z narzutami (netto)</td>
                    <td className="px-3 py-2 text-sm text-right font-bold text-blue-900">{formatNumber(zTotalNet, 2)}</td>
                    <td className="px-3 py-2 text-sm text-right text-blue-600"></td>
                    <td className="px-3 py-2 text-sm text-right text-blue-600"></td>
                    <td className="px-3 py-2 text-sm text-right text-blue-600"></td>
                  </tr>
                  <tr className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2 text-sm text-gray-800">{zIsVatExempt ? 'VAT (zw.)' : `VAT (${zVatRate}%)`}</td>
                    <td className="px-3 py-2 text-sm text-right font-medium">{formatNumber(zVatAmount, 2)}</td>
                    <td className="px-3 py-2 text-sm text-right text-gray-600"></td>
                    <td className="px-3 py-2 text-sm text-right text-gray-600"></td>
                    <td className="px-3 py-2 text-sm text-right text-gray-600"></td>
                  </tr>
                  <tr className="border-b border-gray-200 bg-green-50">
                    <td className="px-3 py-2 text-sm font-bold text-green-900">Razem brutto (z VAT)</td>
                    <td className="px-3 py-2 text-sm text-right font-bold text-green-900">{formatNumber(zTotalGross, 2)}</td>
                    <td className="px-3 py-2 text-sm text-right text-green-600"></td>
                    <td className="px-3 py-2 text-sm text-right text-green-600"></td>
                    <td className="px-3 py-2 text-sm text-right text-green-600"></td>
                  </tr>
                </tbody>
              </table>
            </div>
            );
          })()}

          {/* Print Document Preview - shown when in export mode or title page editor */}
          {(leftPanelMode === 'export' || leftPanelMode === 'titlePageEditor') && (
            <div ref={printPreviewRef} className="bg-gray-100 min-h-full p-8">
              <div className="max-w-4xl mx-auto bg-white shadow-lg">
                {exportPages.filter(p => p.enabled).map((page, pageIndex) => {
                  const today = new Date().toLocaleDateString('pl-PL');

                  // Render each page type
                  if (page.type === 'strona_tytulowa') {
                    return (
                      <div
                        key={page.id}
                        ref={el => { sectionRefs.current[page.id] = el; }}
                        className={`print-section p-12 border-b-4 border-dashed border-gray-300 min-h-[800px] ${activeExportSection === page.id ? 'ring-2 ring-blue-500' : ''}`}
                        onClick={() => setActiveExportSection(page.id)}
                      >
                        <div className="title-page-content">
                          {/* Company header - top right */}
                          {(titlePageData.companyName || titlePageData.companyAddress) && (
                            <div className="company-header">
                              {titlePageData.companyName && <div className="font-medium">{titlePageData.companyName}</div>}
                              {titlePageData.companyAddress && <div>{titlePageData.companyAddress}</div>}
                            </div>
                          )}

                          {/* Title */}
                          <h1 className="main-title">{titlePageData.title || estimate?.settings.name || ''}</h1>

                          {/* Details section */}
                          <div className="details-section">
                            {/* Order info group */}
                            {(titlePageData.orderName || titlePageData.orderAddress) && (
                              <div className="detail-group">
                                {titlePageData.orderName && (
                                  <div className="detail-row">
                                    <span className="detail-label">Nazwa zamówienia:</span>
                                    <span className="detail-value">{titlePageData.orderName}</span>
                                  </div>
                                )}
                                {titlePageData.orderAddress && (
                                  <div className="detail-row">
                                    <span className="detail-label">Adres obiektu budowlanego:</span>
                                    <span className="detail-value">{titlePageData.orderAddress}</span>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Client info group */}
                            {(titlePageData.clientName || titlePageData.clientAddress) && (
                              <div className="detail-group">
                                {titlePageData.clientName && (
                                  <div className="detail-row">
                                    <span className="detail-label">Zamawiający:</span>
                                    <span className="detail-value">{titlePageData.clientName}</span>
                                  </div>
                                )}
                                {titlePageData.clientAddress && (
                                  <div className="detail-row">
                                    <span className="detail-label">Adres zamawiającego:</span>
                                    <span className="detail-value">{titlePageData.clientAddress}</span>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Contractor info group */}
                            {(titlePageData.contractorName || titlePageData.contractorAddress) && (
                              <div className="detail-group">
                                {titlePageData.contractorName && (
                                  <div className="detail-row">
                                    <span className="detail-label">Wykonawca:</span>
                                    <span className="detail-value">{titlePageData.contractorName}</span>
                                  </div>
                                )}
                                {titlePageData.contractorAddress && (
                                  <div className="detail-row">
                                    <span className="detail-label">Adres wykonawcy:</span>
                                    <span className="detail-value">{titlePageData.contractorAddress}</span>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Industry */}
                            {titlePageData.industry && (
                              <div className="detail-group">
                                <div className="detail-row">
                                  <span className="detail-label">Branża:</span>
                                  <span className="detail-value">{titlePageData.industry}</span>
                                </div>
                              </div>
                            )}

                            {/* Prepared/Checked by group */}
                            {(titlePageData.preparedBy || titlePageData.checkedBy) && (
                              <div className="detail-group">
                                {titlePageData.preparedBy && (
                                  <div className="detail-row">
                                    <span className="detail-label">Sporządził kosztorys:</span>
                                    <span className="detail-value">{titlePageData.preparedBy}{titlePageData.preparedByIndustry ? ` (branża ${titlePageData.preparedByIndustry})` : ''}</span>
                                  </div>
                                )}
                                {titlePageData.checkedBy && (
                                  <div className="detail-row">
                                    <span className="detail-label">Sprawdził przedmiar:</span>
                                    <span className="detail-value">{titlePageData.checkedBy}{titlePageData.checkedByIndustry ? ` (branża ${titlePageData.checkedByIndustry})` : ''}</span>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Dates section */}
                          <div className="dates-section">
                            <div className="dates-row">
                              <div className="date-block">
                                <div className="date-label">Data opracowania:</div>
                                <div>{titlePageData.preparedDate || today}</div>
                              </div>
                              <div className="date-block">
                                <div className="date-label">Data zatwierdzenia:</div>
                                <div>{titlePageData.approvedDate || today}</div>
                              </div>
                            </div>
                          </div>

                          {/* Page number */}
                          <div className="page-number">
                            {pageIndex + 1}/{exportPages.filter(p => p.enabled).length}
                          </div>
                        </div>
                      </div>
                    );
                  }

                  if (page.type === 'kosztorys_ofertowy') {
                    return (
                      <div
                        key={page.id}
                        ref={el => { sectionRefs.current[page.id] = el; }}
                        className={`print-section p-12 border-b-4 border-dashed border-gray-300 ${activeExportSection === page.id ? 'ring-2 ring-blue-500' : ''}`}
                        onClick={() => setActiveExportSection(page.id)}
                      >
                        <div className="text-sm text-gray-600 mb-2">{titlePageData.title || estimate?.settings.name || ''}</div>
                        <h2 className="text-lg font-bold mb-6">Kosztorys ofertowy</h2>

                        <table className="w-full border-collapse text-sm">
                          <thead>
                            <tr className="border border-gray-400">
                              <th className="border border-gray-400 px-2 py-1 text-left w-14">Lp.</th>
                              <th className="border border-gray-400 px-2 py-1 text-left w-24">Podstawa</th>
                              <th className="border border-gray-400 px-2 py-1 text-left">Nazwa</th>
                              <th className="border border-gray-400 px-2 py-1 text-center w-12">j.m.</th>
                              <th className="border border-gray-400 px-2 py-1 text-right w-16">Nakład</th>
                              <th className="border border-gray-400 px-2 py-1 text-right w-20">Koszt jedn.</th>
                              <th className="border border-gray-400 px-2 py-1 text-right w-12">R</th>
                              <th className="border border-gray-400 px-2 py-1 text-right w-12">M</th>
                              <th className="border border-gray-400 px-2 py-1 text-right w-12">S</th>
                            </tr>
                          </thead>
                          <tbody>
                            {/* Sections */}
                            {estimateData.root.sectionIds.map((sectionId, sIdx) => {
                              const section = estimateData.sections[sectionId];
                              if (!section) return null;
                              return (
                                <React.Fragment key={sectionId}>
                                  <tr className="border border-gray-400">
                                    <td className="border border-gray-400 px-2 py-1 font-medium">{sIdx + 1}</td>
                                    <td className="border border-gray-400 px-2 py-1"></td>
                                    <td className="border border-gray-400 px-2 py-1 font-medium" colSpan={7}>{section.name}</td>
                                  </tr>
                                  {section.positionIds.map((posId, pIdx) => {
                                    const position = estimateData.positions[posId];
                                    if (!position) return null;
                                    const result = calculationResult?.positions[posId];
                                    const quantity = result?.quantity || 0;
                                    return (
                                      <tr key={posId} className="border border-gray-400">
                                        <td className="border border-gray-400 px-2 py-1 align-top">
                                          <div className="flex flex-col items-center">
                                            <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center">{pIdx + 1}</span>
                                            <span className="text-xs text-gray-500">d.{sIdx + 1}.{pIdx + 1}</span>
                                          </div>
                                        </td>
                                        <td className="border border-gray-400 px-2 py-1 text-xs font-mono align-top">
                                          {position.base}
                                          {position.marker === 'AI' && <span className="ml-1 px-1 py-0.5 bg-purple-100 text-purple-700 text-[9px] rounded font-sans font-medium">AI</span>}
                                        </td>
                                        <td className="border border-gray-400 px-2 py-1 align-top">
                                          <div className="font-medium">{position.name}</div>
                                          <div className="text-xs text-gray-500">Przedmiar z sumami = {formatNumber(quantity, 2)} {position.unit.label}</div>
                                        </td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-top">{position.unit.label}</td>
                                        <td className="border border-gray-400 px-2 py-1 text-right align-top">{formatNumber(quantity, 2)}</td>
                                        <td className="border border-gray-400 px-2 py-1 text-right align-top">{formatNumber(result?.unitCost || 0, 3)}</td>
                                        <td className="border border-gray-400 px-2 py-1 text-right align-top">{formatNumber(result?.laborTotal || 0, 2)}</td>
                                        <td className="border border-gray-400 px-2 py-1 text-right align-top">{formatNumber(result?.materialTotal || 0, 2)}</td>
                                        <td className="border border-gray-400 px-2 py-1 text-right align-top">{formatNumber(result?.equipmentTotal || 0, 2)}</td>
                                      </tr>
                                    );
                                  })}
                                </React.Fragment>
                              );
                            })}
                          </tbody>
                        </table>

                        <div className="text-right text-xs text-gray-400 mt-8">
                          {pageIndex + 1}/{exportPages.filter(p => p.enabled).length}
                        </div>
                      </div>
                    );
                  }

                  if (page.type === 'przedmiar') {
                    return (
                      <div
                        key={page.id}
                        ref={el => { sectionRefs.current[page.id] = el; }}
                        className={`print-section p-12 border-b-4 border-dashed border-gray-300 ${activeExportSection === page.id ? 'ring-2 ring-blue-500' : ''}`}
                        onClick={() => setActiveExportSection(page.id)}
                      >
                        <div className="text-sm text-gray-600 mb-2">{titlePageData.title || estimate?.settings.name || ''}</div>
                        <h2 className="text-lg font-bold mb-6">Przedmiar robót</h2>

                        <table className="w-full border-collapse text-sm">
                          <thead>
                            <tr className="border border-gray-400">
                              <th className="border border-gray-400 px-2 py-1 text-left w-14">L.p.</th>
                              <th className="border border-gray-400 px-2 py-1 text-left w-28">Podstawa</th>
                              <th className="border border-gray-400 px-2 py-1 text-left">Nakład</th>
                              <th className="border border-gray-400 px-2 py-1 text-center w-12">j.m.</th>
                              <th className="border border-gray-400 px-2 py-1 text-right w-20">Poszczególne</th>
                              <th className="border border-gray-400 px-2 py-1 text-right w-16">Razem</th>
                            </tr>
                          </thead>
                          <tbody>
                            {estimateData.root.sectionIds.map((sectionId, sIdx) => {
                              const section = estimateData.sections[sectionId];
                              if (!section) return null;
                              return (
                                <React.Fragment key={sectionId}>
                                  <tr className="border border-gray-400">
                                    <td className="border border-gray-400 px-2 py-1 font-medium">{sIdx + 1}</td>
                                    <td className="border border-gray-400 px-2 py-1" colSpan={5}>
                                      <span className="font-medium">{section.name}</span>
                                    </td>
                                  </tr>
                                  {section.positionIds.map((posId, pIdx) => {
                                    const position = estimateData.positions[posId];
                                    if (!position) return null;
                                    const result = calculationResult?.positions[posId];
                                    const quantity = result?.quantity || 0;
                                    return (
                                      <React.Fragment key={posId}>
                                        <tr className="border border-gray-400">
                                          <td className="border border-gray-400 px-2 py-1 align-top">
                                            <div className="flex flex-col items-center">
                                              <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center">{pIdx + 1}</span>
                                              <span className="text-xs text-gray-500">d.{sIdx + 1}.{pIdx + 1}</span>
                                            </div>
                                          </td>
                                          <td className="border border-gray-400 px-2 py-1 text-xs font-mono align-top">
                                            {position.base}
                                            {position.marker === 'AI' && <span className="ml-1 px-1 py-0.5 bg-purple-100 text-purple-700 text-[9px] rounded font-sans font-medium">AI</span>}
                                          </td>
                                          <td className="border border-gray-400 px-2 py-1 font-medium align-top">{position.name}</td>
                                          <td className="border border-gray-400 px-2 py-1 text-center align-top">{position.unit.label}</td>
                                          <td className="border border-gray-400 px-2 py-1 text-right align-top"></td>
                                          <td className="border border-gray-400 px-2 py-1 text-right align-top"></td>
                                        </tr>
                                        {position.measurements.rootIds.map((measureId) => {
                                          const measure = position.measurements.entries[measureId];
                                          if (!measure) return null;
                                          const measureValue = evaluateMeasurementExpression(measure.expression) || 0;
                                          return (
                                            <tr key={measureId} className="border border-gray-400">
                                              <td className="border border-gray-400 px-2 py-1"></td>
                                              <td className="border border-gray-400 px-2 py-1 text-gray-500">{measure.description || ''}</td>
                                              <td className="border border-gray-400 px-2 py-1 text-gray-600">{measure.expression || ''}</td>
                                              <td className="border border-gray-400 px-2 py-1 text-center">{position.unit.label}</td>
                                              <td className="border border-gray-400 px-2 py-1 text-right">{formatNumber(measureValue, 2)}</td>
                                              <td className="border border-gray-400 px-2 py-1"></td>
                                            </tr>
                                          );
                                        })}
                                        <tr className="border border-gray-400">
                                          <td className="border border-gray-400 px-2 py-1" colSpan={4}></td>
                                          <td className="border border-gray-400 px-2 py-1 text-right font-medium">Razem</td>
                                          <td className="border border-gray-400 px-2 py-1 text-right font-medium">{formatNumber(quantity, 2)}</td>
                                        </tr>
                                      </React.Fragment>
                                    );
                                  })}
                                </React.Fragment>
                              );
                            })}
                          </tbody>
                        </table>

                        <div className="text-right text-xs text-gray-400 mt-8">
                          {pageIndex + 1}/{exportPages.filter(p => p.enabled).length}
                        </div>
                      </div>
                    );
                  }

                  if (page.type === 'tabela_elementow') {
                    return (
                      <div
                        key={page.id}
                        ref={el => { sectionRefs.current[page.id] = el; }}
                        className={`print-section p-12 border-b-4 border-dashed border-gray-300 ${activeExportSection === page.id ? 'ring-2 ring-blue-500' : ''}`}
                        onClick={() => setActiveExportSection(page.id)}
                      >
                        <div className="text-sm text-gray-600 mb-2">{titlePageData.title || estimate?.settings.name || ''}</div>
                        <h2 className="text-lg font-bold mb-6">Tabela elementów scalonych</h2>

                        {(() => {
                          const teVatRate = estimate?.settings?.vatRate ?? 23;
                          const teIsExempt = teVatRate < 0;
                          const teNetTotal = calculationResult?.totalValue || 0;
                          const teVatAmount = teIsExempt ? 0 : teNetTotal * (teVatRate / 100);
                          const teBrutto = teNetTotal + teVatAmount;
                          return (
                        <table className="w-full border-collapse text-sm">
                          <thead>
                            <tr className="border border-gray-400">
                              <th className="border border-gray-400 px-2 py-1 text-left w-10">Lp.</th>
                              <th className="border border-gray-400 px-2 py-1 text-left">Nazwa</th>
                              <th className="border border-gray-400 px-2 py-1 text-right w-24">Robocizna</th>
                              <th className="border border-gray-400 px-2 py-1 text-right w-24">Materiały</th>
                              <th className="border border-gray-400 px-2 py-1 text-right w-24">Sprzęt</th>
                              <th className="border border-gray-400 px-2 py-1 text-right w-24">Razem</th>
                            </tr>
                          </thead>
                          <tbody>
                            {estimateData.root.sectionIds.map((sectionId, sIdx) => {
                              const section = estimateData.sections[sectionId];
                              if (!section) return null;
                              const sectionResult = calculationResult?.sections[sectionId];
                              return (
                                <tr key={sectionId} className="border border-gray-400">
                                  <td className="border border-gray-400 px-2 py-1">{sIdx + 1}</td>
                                  <td className="border border-gray-400 px-2 py-1">{section.name}</td>
                                  <td className="border border-gray-400 px-2 py-1 text-right">{formatNumber(sectionResult?.totalLabor || 0, 2)}</td>
                                  <td className="border border-gray-400 px-2 py-1 text-right">{formatNumber(sectionResult?.totalMaterial || 0, 2)}</td>
                                  <td className="border border-gray-400 px-2 py-1 text-right">{formatNumber(sectionResult?.totalEquipment || 0, 2)}</td>
                                  <td className="border border-gray-400 px-2 py-1 text-right font-medium">{formatNumber(sectionResult?.totalValue || 0, 2)}</td>
                                </tr>
                              );
                            })}
                            <tr className="border border-gray-400 font-medium">
                              <td className="border border-gray-400 px-2 py-1"></td>
                              <td className="border border-gray-400 px-2 py-1">Kosztorys netto</td>
                              <td className="border border-gray-400 px-2 py-1 text-right">{formatNumber(calculationResult?.totalLabor || 0, 2)}</td>
                              <td className="border border-gray-400 px-2 py-1 text-right">{formatNumber(calculationResult?.totalMaterial || 0, 2)}</td>
                              <td className="border border-gray-400 px-2 py-1 text-right">{formatNumber(calculationResult?.totalEquipment || 0, 2)}</td>
                              <td className="border border-gray-400 px-2 py-1 text-right">{formatNumber(teNetTotal, 2)}</td>
                            </tr>
                            <tr className="border border-gray-400 font-medium">
                              <td className="border border-gray-400 px-2 py-1"></td>
                              <td className="border border-gray-400 px-2 py-1">{teIsExempt ? 'VAT (zw.)' : `VAT (${teVatRate}%)`}</td>
                              <td className="border border-gray-400 px-2 py-1" colSpan={3}></td>
                              <td className="border border-gray-400 px-2 py-1 text-right">{formatNumber(teVatAmount, 2)}</td>
                            </tr>
                            <tr className="border border-gray-400 font-bold">
                              <td className="border border-gray-400 px-2 py-1"></td>
                              <td className="border border-gray-400 px-2 py-1">Kosztorys brutto</td>
                              <td className="border border-gray-400 px-2 py-1" colSpan={3}></td>
                              <td className="border border-gray-400 px-2 py-1 text-right">{formatNumber(teBrutto, 2)}</td>
                            </tr>
                          </tbody>
                        </table>
                          );
                        })()}

                        <div className="mt-4 text-sm text-center">
                          Słownie: {formatCurrency(calculationResult?.totalValue || 0)}
                        </div>

                        <div className="text-right text-xs text-gray-400 mt-8">
                          {pageIndex + 1}/{exportPages.filter(p => p.enabled).length}
                        </div>
                      </div>
                    );
                  }

                  if (page.type === 'zestawienie_robocizny') {
                    // Calculate labor summary
                    const laborItems: { name: string; unit: string; quantity: number; unitPrice: number; total: number }[] = [];
                    let laborTotal = 0;
                    Object.values(estimateData.positions).forEach(position => {
                      position.resources.filter(r => r.type === 'labor').forEach(resource => {
                        const result = calculationResult?.positions[position.id];
                        const quantity = result?.quantity || 0;
                        const resQuantity = resource.norm.value * quantity;
                        const total = resQuantity * resource.unitPrice.value;
                        laborItems.push({
                          name: resource.name,
                          unit: resource.unit.label,
                          quantity: resQuantity,
                          unitPrice: resource.unitPrice.value,
                          total
                        });
                        laborTotal += total;
                      });
                    });

                    return (
                      <div
                        key={page.id}
                        ref={el => { sectionRefs.current[page.id] = el; }}
                        className={`print-section p-12 border-b-4 border-dashed border-gray-300 ${activeExportSection === page.id ? 'ring-2 ring-blue-500' : ''}`}
                        onClick={() => setActiveExportSection(page.id)}
                      >
                        <div className="text-sm text-gray-600 mb-2">{titlePageData.title || estimate?.settings.name || ''}</div>
                        <h2 className="text-lg font-bold mb-6">Zestawienie robocizny</h2>

                        <table className="w-full border-collapse text-sm">
                          <thead>
                            <tr className="border border-gray-400">
                              <th className="border border-gray-400 px-2 py-1 text-left w-10">Lp.</th>
                              <th className="border border-gray-400 px-2 py-1 text-left">Opis</th>
                              <th className="border border-gray-400 px-2 py-1 text-center w-12">j.m.</th>
                              <th className="border border-gray-400 px-2 py-1 text-right w-16">Ilość</th>
                              <th className="border border-gray-400 px-2 py-1 text-right w-20">Cena jedn.</th>
                              <th className="border border-gray-400 px-2 py-1 text-right w-24">Wartość</th>
                            </tr>
                          </thead>
                          <tbody>
                            {laborItems.length > 0 ? laborItems.map((item, idx) => (
                              <tr key={idx} className="border border-gray-400">
                                <td className="border border-gray-400 px-2 py-1">{idx + 1}</td>
                                <td className="border border-gray-400 px-2 py-1">{item.name}</td>
                                <td className="border border-gray-400 px-2 py-1 text-center">{item.unit}</td>
                                <td className="border border-gray-400 px-2 py-1 text-right">{formatNumber(item.quantity, 1)}</td>
                                <td className="border border-gray-400 px-2 py-1 text-right">{formatNumber(item.unitPrice, 2)}</td>
                                <td className="border border-gray-400 px-2 py-1 text-right">{formatNumber(item.total, 2)}</td>
                              </tr>
                            )) : (
                              <tr className="border border-gray-400">
                                <td colSpan={6} className="border border-gray-400 px-2 py-4 text-center text-gray-500">Brak robocizny</td>
                              </tr>
                            )}
                            <tr className="border border-gray-400 font-medium">
                              <td className="border border-gray-400 px-2 py-1" colSpan={4}></td>
                              <td className="border border-gray-400 px-2 py-1 text-right">Razem</td>
                              <td className="border border-gray-400 px-2 py-1 text-right">{formatNumber(laborTotal, 2)}</td>
                            </tr>
                          </tbody>
                        </table>

                        <div className="text-right text-xs text-gray-400 mt-8">
                          {pageIndex + 1}/{exportPages.filter(p => p.enabled).length}
                        </div>
                      </div>
                    );
                  }

                  if (page.type === 'zestawienie_materialow') {
                    // Calculate materials summary
                    const materialItems: { name: string; unit: string; quantity: number; unitPrice: number; total: number }[] = [];
                    let materialTotal = 0;
                    Object.values(estimateData.positions).forEach(position => {
                      position.resources.filter(r => r.type === 'material').forEach(resource => {
                        const result = calculationResult?.positions[position.id];
                        const quantity = result?.quantity || 0;
                        const resQuantity = resource.norm.value * quantity;
                        const total = resQuantity * resource.unitPrice.value;
                        materialItems.push({
                          name: resource.name,
                          unit: resource.unit.label,
                          quantity: resQuantity,
                          unitPrice: resource.unitPrice.value,
                          total
                        });
                        materialTotal += total;
                      });
                    });

                    return (
                      <div
                        key={page.id}
                        ref={el => { sectionRefs.current[page.id] = el; }}
                        className={`print-section p-12 border-b-4 border-dashed border-gray-300 ${activeExportSection === page.id ? 'ring-2 ring-blue-500' : ''}`}
                        onClick={() => setActiveExportSection(page.id)}
                      >
                        <div className="text-sm text-gray-600 mb-2">{titlePageData.title || estimate?.settings.name || ''}</div>
                        <h2 className="text-lg font-bold mb-6">Zestawienie materiałów</h2>

                        <table className="w-full border-collapse text-sm">
                          <thead>
                            <tr className="border border-gray-400">
                              <th className="border border-gray-400 px-2 py-1 text-left w-10">Lp.</th>
                              <th className="border border-gray-400 px-2 py-1 text-left">Opis</th>
                              <th className="border border-gray-400 px-2 py-1 text-center w-12">j.m.</th>
                              <th className="border border-gray-400 px-2 py-1 text-right w-16">Ilość</th>
                              <th className="border border-gray-400 px-2 py-1 text-right w-20">Cena jedn.</th>
                              <th className="border border-gray-400 px-2 py-1 text-right w-24">Wartość</th>
                            </tr>
                          </thead>
                          <tbody>
                            {materialItems.length > 0 ? materialItems.map((item, idx) => (
                              <tr key={idx} className="border border-gray-400">
                                <td className="border border-gray-400 px-2 py-1">{idx + 1}</td>
                                <td className="border border-gray-400 px-2 py-1">{item.name}</td>
                                <td className="border border-gray-400 px-2 py-1 text-center">{item.unit}</td>
                                <td className="border border-gray-400 px-2 py-1 text-right">{formatNumber(item.quantity, 1)}</td>
                                <td className="border border-gray-400 px-2 py-1 text-right">{formatNumber(item.unitPrice, 2)}</td>
                                <td className="border border-gray-400 px-2 py-1 text-right">{formatNumber(item.total, 2)}</td>
                              </tr>
                            )) : (
                              <tr className="border border-gray-400">
                                <td colSpan={6} className="border border-gray-400 px-2 py-4 text-center text-gray-500">Brak materiałów</td>
                              </tr>
                            )}
                            <tr className="border border-gray-400 font-medium">
                              <td className="border border-gray-400 px-2 py-1" colSpan={4}></td>
                              <td className="border border-gray-400 px-2 py-1 text-right">Razem</td>
                              <td className="border border-gray-400 px-2 py-1 text-right">{formatNumber(materialTotal, 2)}</td>
                            </tr>
                          </tbody>
                        </table>

                        <div className="text-right text-xs text-gray-400 mt-8">
                          {pageIndex + 1}/{exportPages.filter(p => p.enabled).length}
                        </div>
                      </div>
                    );
                  }

                  if (page.type === 'zestawienie_sprzetu') {
                    // Calculate equipment summary
                    const equipmentItems: { name: string; unit: string; quantity: number; unitPrice: number; total: number }[] = [];
                    let equipmentTotal = 0;
                    Object.values(estimateData.positions).forEach(position => {
                      position.resources.filter(r => r.type === 'equipment').forEach(resource => {
                        const result = calculationResult?.positions[position.id];
                        const quantity = result?.quantity || 0;
                        const resQuantity = resource.norm.value * quantity;
                        const total = resQuantity * resource.unitPrice.value;
                        equipmentItems.push({
                          name: resource.name,
                          unit: resource.unit.label,
                          quantity: resQuantity,
                          unitPrice: resource.unitPrice.value,
                          total
                        });
                        equipmentTotal += total;
                      });
                    });

                    return (
                      <div
                        key={page.id}
                        ref={el => { sectionRefs.current[page.id] = el; }}
                        className={`print-section p-12 border-b-4 border-dashed border-gray-300 ${activeExportSection === page.id ? 'ring-2 ring-blue-500' : ''}`}
                        onClick={() => setActiveExportSection(page.id)}
                      >
                        <div className="text-sm text-gray-600 mb-2">{titlePageData.title || estimate?.settings.name || ''}</div>
                        <h2 className="text-lg font-bold mb-6">Zestawienie sprzętu</h2>

                        <table className="w-full border-collapse text-sm">
                          <thead>
                            <tr className="border border-gray-400">
                              <th className="border border-gray-400 px-2 py-1 text-left w-10">Lp.</th>
                              <th className="border border-gray-400 px-2 py-1 text-left">Opis</th>
                              <th className="border border-gray-400 px-2 py-1 text-center w-12">j.m.</th>
                              <th className="border border-gray-400 px-2 py-1 text-right w-16">Ilość</th>
                              <th className="border border-gray-400 px-2 py-1 text-right w-20">Cena jedn.</th>
                              <th className="border border-gray-400 px-2 py-1 text-right w-24">Wartość</th>
                            </tr>
                          </thead>
                          <tbody>
                            {equipmentItems.length > 0 ? equipmentItems.map((item, idx) => (
                              <tr key={idx} className="border border-gray-400">
                                <td className="border border-gray-400 px-2 py-1">{idx + 1}</td>
                                <td className="border border-gray-400 px-2 py-1">{item.name}</td>
                                <td className="border border-gray-400 px-2 py-1 text-center">{item.unit}</td>
                                <td className="border border-gray-400 px-2 py-1 text-right">{formatNumber(item.quantity, 1)}</td>
                                <td className="border border-gray-400 px-2 py-1 text-right">{formatNumber(item.unitPrice, 2)}</td>
                                <td className="border border-gray-400 px-2 py-1 text-right">{formatNumber(item.total, 2)}</td>
                              </tr>
                            )) : (
                              <tr className="border border-gray-400">
                                <td colSpan={6} className="border border-gray-400 px-2 py-4 text-center text-gray-500">Brak sprzętu</td>
                              </tr>
                            )}
                            <tr className="border border-gray-400 font-medium">
                              <td className="border border-gray-400 px-2 py-1" colSpan={4}></td>
                              <td className="border border-gray-400 px-2 py-1 text-right">Razem</td>
                              <td className="border border-gray-400 px-2 py-1 text-right">{formatNumber(equipmentTotal, 2)}</td>
                            </tr>
                          </tbody>
                        </table>

                        <div className="text-right text-xs text-gray-400 mt-8">
                          {pageIndex + 1}/{exportPages.filter(p => p.enabled).length}
                        </div>
                      </div>
                    );
                  }

                  // Szczegółowa kalkulacja cen jednostkowych
                  if (page.type === 'kalkulacja_szczegolowa') {
                    const skKpOverhead = estimateData.root.overheads.find(o => o.name.includes('Kp'));
                    const skZOverhead = estimateData.root.overheads.find(o => o.name.includes('Zysk'));
                    return (
                      <div
                        key={page.id}
                        ref={el => { sectionRefs.current[page.id] = el; }}
                        className={`print-section p-12 border-b-4 border-dashed border-gray-300 ${activeExportSection === page.id ? 'ring-2 ring-blue-500' : ''}`}
                        onClick={() => setActiveExportSection(page.id)}
                      >
                        <div className="text-sm text-gray-600 mb-2">{titlePageData.title || estimate?.settings.name || ''}</div>
                        <h2 className="text-lg font-bold mb-6">Szczegółowa kalkulacja cen jednostkowych</h2>

                        {estimateData.root.sectionIds.map((sectionId, sIdx) => {
                          const section = estimateData.sections[sectionId];
                          if (!section) return null;
                          return (
                            <React.Fragment key={sectionId}>
                              <h3 className="text-sm font-bold mt-6 mb-2">{sIdx + 1}. {section.name}</h3>
                              {section.positionIds.map((posId, pIdx) => {
                                const position = estimateData.positions[posId];
                                if (!position) return null;
                                const result = calculationResult?.positions[posId];
                                const quantity = result?.quantity || 0;

                                // Calculate per-unit values
                                const laborResources = position.resources.filter(r => r.type === 'labor');
                                const materialResources = position.resources.filter(r => r.type === 'material');
                                const equipmentResources = position.resources.filter(r => r.type === 'equipment');

                                const unitLabor = quantity > 0 ? (result?.laborTotal || 0) / quantity : 0;
                                const unitMaterial = quantity > 0 ? (result?.materialTotal || 0) / quantity : 0;
                                const unitEquipment = quantity > 0 ? (result?.equipmentTotal || 0) / quantity : 0;
                                const unitDirect = unitLabor + unitMaterial + unitEquipment;

                                const kpUnit = skKpOverhead ? (unitLabor + unitEquipment) * (skKpOverhead.value / 100) : 0;
                                const zUnit = skZOverhead ? (unitLabor + unitEquipment + kpUnit) * (skZOverhead.value / 100) : 0;
                                const unitTotal = unitDirect + kpUnit + zUnit;

                                return (
                                  <div key={posId} className="mb-6">
                                    <div className="text-xs text-gray-500 mb-1">d.{sIdx + 1}.{pIdx + 1} &middot; {position.base}{position.marker === 'AI' && <span className="ml-1 px-1 py-0.5 bg-purple-100 text-purple-700 text-[9px] rounded font-medium">AI</span>}</div>
                                    <div className="text-sm font-medium mb-2">{position.name} [{position.unit.label}]</div>
                                    <table className="w-full border-collapse text-xs">
                                      <thead>
                                        <tr className="border border-gray-400">
                                          <th className="border border-gray-400 px-2 py-1 text-left w-8">Lp.</th>
                                          <th className="border border-gray-400 px-2 py-1 text-left">Opis nakładu</th>
                                          <th className="border border-gray-400 px-2 py-1 text-center w-12">j.m.</th>
                                          <th className="border border-gray-400 px-2 py-1 text-right w-20">Nakład jedn.</th>
                                          <th className="border border-gray-400 px-2 py-1 text-right w-20">Cena jedn.</th>
                                          <th className="border border-gray-400 px-2 py-1 text-right w-24">Koszt jedn.</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {laborResources.length > 0 && (
                                          <>
                                            <tr className="border border-gray-300 bg-gray-50">
                                              <td colSpan={6} className="border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-500">Robocizna (R)</td>
                                            </tr>
                                            {laborResources.map((res, rIdx) => (
                                              <tr key={res.id} className="border border-gray-400">
                                                <td className="border border-gray-400 px-2 py-1">{rIdx + 1}</td>
                                                <td className="border border-gray-400 px-2 py-1">{res.name}</td>
                                                <td className="border border-gray-400 px-2 py-1 text-center">{res.unit.label}</td>
                                                <td className="border border-gray-400 px-2 py-1 text-right">{formatNumber(res.norm.value, 4)}</td>
                                                <td className="border border-gray-400 px-2 py-1 text-right">{formatNumber(res.unitPrice.value, 2)}</td>
                                                <td className="border border-gray-400 px-2 py-1 text-right">{formatNumber(res.norm.value * res.unitPrice.value, 2)}</td>
                                              </tr>
                                            ))}
                                          </>
                                        )}
                                        {materialResources.length > 0 && (
                                          <>
                                            <tr className="border border-gray-300 bg-gray-50">
                                              <td colSpan={6} className="border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-500">Materiały (M)</td>
                                            </tr>
                                            {materialResources.map((res, rIdx) => (
                                              <tr key={res.id} className="border border-gray-400">
                                                <td className="border border-gray-400 px-2 py-1">{rIdx + 1}</td>
                                                <td className="border border-gray-400 px-2 py-1">{res.name}</td>
                                                <td className="border border-gray-400 px-2 py-1 text-center">{res.unit.label}</td>
                                                <td className="border border-gray-400 px-2 py-1 text-right">{formatNumber(res.norm.value, 4)}</td>
                                                <td className="border border-gray-400 px-2 py-1 text-right">{formatNumber(res.unitPrice.value, 2)}</td>
                                                <td className="border border-gray-400 px-2 py-1 text-right">{formatNumber(res.norm.value * res.unitPrice.value, 2)}</td>
                                              </tr>
                                            ))}
                                          </>
                                        )}
                                        {equipmentResources.length > 0 && (
                                          <>
                                            <tr className="border border-gray-300 bg-gray-50">
                                              <td colSpan={6} className="border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-500">Sprzęt (S)</td>
                                            </tr>
                                            {equipmentResources.map((res, rIdx) => (
                                              <tr key={res.id} className="border border-gray-400">
                                                <td className="border border-gray-400 px-2 py-1">{rIdx + 1}</td>
                                                <td className="border border-gray-400 px-2 py-1">{res.name}</td>
                                                <td className="border border-gray-400 px-2 py-1 text-center">{res.unit.label}</td>
                                                <td className="border border-gray-400 px-2 py-1 text-right">{formatNumber(res.norm.value, 4)}</td>
                                                <td className="border border-gray-400 px-2 py-1 text-right">{formatNumber(res.unitPrice.value, 2)}</td>
                                                <td className="border border-gray-400 px-2 py-1 text-right">{formatNumber(res.norm.value * res.unitPrice.value, 2)}</td>
                                              </tr>
                                            ))}
                                          </>
                                        )}
                                        {/* Subtotals */}
                                        <tr className="border border-gray-400 bg-gray-50">
                                          <td colSpan={5} className="border border-gray-400 px-2 py-1 text-right text-xs font-medium">Rj (robocizna na jedn.)</td>
                                          <td className="border border-gray-400 px-2 py-1 text-right font-medium">{formatNumber(unitLabor, 2)}</td>
                                        </tr>
                                        <tr className="border border-gray-400 bg-gray-50">
                                          <td colSpan={5} className="border border-gray-400 px-2 py-1 text-right text-xs font-medium">Mj (materiały na jedn.)</td>
                                          <td className="border border-gray-400 px-2 py-1 text-right font-medium">{formatNumber(unitMaterial, 2)}</td>
                                        </tr>
                                        <tr className="border border-gray-400 bg-gray-50">
                                          <td colSpan={5} className="border border-gray-400 px-2 py-1 text-right text-xs font-medium">Sj (sprzęt na jedn.)</td>
                                          <td className="border border-gray-400 px-2 py-1 text-right font-medium">{formatNumber(unitEquipment, 2)}</td>
                                        </tr>
                                        <tr className="border border-gray-400 font-medium">
                                          <td colSpan={5} className="border border-gray-400 px-2 py-1 text-right text-xs">Koszty bezpośrednie (Rj+Mj+Sj)</td>
                                          <td className="border border-gray-400 px-2 py-1 text-right">{formatNumber(unitDirect, 2)}</td>
                                        </tr>
                                        {skKpOverhead && skKpOverhead.value > 0 && (
                                          <tr className="border border-gray-400">
                                            <td colSpan={5} className="border border-gray-400 px-2 py-1 text-right text-xs">Koszty pośrednie Kpj ({skKpOverhead.value}% od Rj+Sj)</td>
                                            <td className="border border-gray-400 px-2 py-1 text-right">{formatNumber(kpUnit, 2)}</td>
                                          </tr>
                                        )}
                                        {skZOverhead && skZOverhead.value > 0 && (
                                          <tr className="border border-gray-400">
                                            <td colSpan={5} className="border border-gray-400 px-2 py-1 text-right text-xs">Zysk Zj ({skZOverhead.value}% od Rj+Sj+Kpj)</td>
                                            <td className="border border-gray-400 px-2 py-1 text-right">{formatNumber(zUnit, 2)}</td>
                                          </tr>
                                        )}
                                        <tr className="border border-gray-400 font-bold bg-blue-50">
                                          <td colSpan={5} className="border border-gray-400 px-2 py-1 text-right text-xs">Cena jednostkowa Cj [zł/{position.unit.label}]</td>
                                          <td className="border border-gray-400 px-2 py-1 text-right">{formatNumber(unitTotal, 2)}</td>
                                        </tr>
                                      </tbody>
                                    </table>
                                  </div>
                                );
                              })}
                            </React.Fragment>
                          );
                        })}

                        <div className="text-right text-xs text-gray-400 mt-8">
                          {pageIndex + 1}/{exportPages.filter(p => p.enabled).length}
                        </div>
                      </div>
                    );
                  }

                  // Szczegółowy kosztorys inwestorski
                  if (page.type === 'kosztorys_szczegolowy') {
                    return (
                      <div
                        key={page.id}
                        ref={el => { sectionRefs.current[page.id] = el; }}
                        className={`print-section p-12 border-b-4 border-dashed border-gray-300 ${activeExportSection === page.id ? 'ring-2 ring-blue-500' : ''}`}
                        onClick={() => setActiveExportSection(page.id)}
                      >
                        <div className="text-sm text-gray-600 mb-2">{titlePageData.title || estimate?.settings.name || ''}</div>
                        <h2 className="text-lg font-bold mb-6">Szczegółowy kosztorys inwestorski</h2>

                        <table className="w-full border-collapse text-xs">
                          <thead>
                            <tr className="border border-gray-400">
                              <th className="border border-gray-400 px-1 py-1 text-left w-12">Lp.</th>
                              <th className="border border-gray-400 px-1 py-1 text-left w-20">Podstawa</th>
                              <th className="border border-gray-400 px-1 py-1 text-left">Opis</th>
                              <th className="border border-gray-400 px-1 py-1 text-center w-10">j.m.</th>
                              <th className="border border-gray-400 px-1 py-1 text-right w-16">Nakład jdn.</th>
                              <th className="border border-gray-400 px-1 py-1 text-right w-14">Ilość</th>
                              <th className="border border-gray-400 px-1 py-1 text-right w-16">Cena jdn.</th>
                              <th className="border border-gray-400 px-1 py-1 text-right w-20">R</th>
                              <th className="border border-gray-400 px-1 py-1 text-right w-20">M</th>
                              <th className="border border-gray-400 px-1 py-1 text-right w-20">S</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(() => {
                              let globalLabor = 0, globalMaterial = 0, globalEquipment = 0;

                              return (
                                <>
                                  {estimateData.root.sectionIds.map((sectionId, sIdx) => {
                                    const section = estimateData.sections[sectionId];
                                    if (!section) return null;
                                    let sectionLabor = 0, sectionMaterial = 0, sectionEquipment = 0;

                                    return (
                                      <React.Fragment key={sectionId}>
                                        <tr className="border border-gray-400 bg-gray-100">
                                          <td className="border border-gray-400 px-1 py-1 font-bold">{sIdx + 1}</td>
                                          <td className="border border-gray-400 px-1 py-1 font-bold" colSpan={9}>{section.name}</td>
                                        </tr>
                                        {section.positionIds.map((posId, pIdx) => {
                                          const position = estimateData.positions[posId];
                                          if (!position) return null;
                                          const result = calculationResult?.positions[posId];
                                          const quantity = result?.quantity || 0;
                                          let posLabor = 0, posMaterial = 0, posEquipment = 0;

                                          return (
                                            <React.Fragment key={posId}>
                                              {/* Position header */}
                                              <tr className="border border-gray-400 bg-gray-50">
                                                <td className="border border-gray-400 px-1 py-1 align-top text-center">
                                                  <span className="text-xs">{pIdx + 1}</span>
                                                  <div className="text-xs text-gray-400">d.{sIdx + 1}.{pIdx + 1}</div>
                                                </td>
                                                <td className="border border-gray-400 px-1 py-1 font-mono align-top">{position.base}</td>
                                                <td className="border border-gray-400 px-1 py-1 font-medium align-top">{position.name}</td>
                                                <td className="border border-gray-400 px-1 py-1 text-center align-top">{position.unit.label}</td>
                                                <td className="border border-gray-400 px-1 py-1 text-right align-top"></td>
                                                <td className="border border-gray-400 px-1 py-1 text-right align-top font-medium">{formatNumber(quantity, 2)}</td>
                                                <td className="border border-gray-400 px-1 py-1 text-right align-top"></td>
                                                <td className="border border-gray-400 px-1 py-1 text-right align-top"></td>
                                                <td className="border border-gray-400 px-1 py-1 text-right align-top"></td>
                                                <td className="border border-gray-400 px-1 py-1 text-right align-top"></td>
                                              </tr>
                                              {/* Resource rows */}
                                              {position.resources.map((res) => {
                                                const resQty = res.norm.value * quantity;
                                                const resValue = resQty * res.unitPrice.value;
                                                if (res.type === 'labor') { posLabor += resValue; sectionLabor += resValue; globalLabor += resValue; }
                                                if (res.type === 'material') { posMaterial += resValue; sectionMaterial += resValue; globalMaterial += resValue; }
                                                if (res.type === 'equipment') { posEquipment += resValue; sectionEquipment += resValue; globalEquipment += resValue; }
                                                return (
                                                  <tr key={res.id} className="border border-gray-300">
                                                    <td className="border border-gray-300 px-1 py-0.5"></td>
                                                    <td className="border border-gray-300 px-1 py-0.5"></td>
                                                    <td className="border border-gray-300 px-1 py-0.5 text-gray-600">{res.name}</td>
                                                    <td className="border border-gray-300 px-1 py-0.5 text-center text-gray-500">{res.unit.label}</td>
                                                    <td className="border border-gray-300 px-1 py-0.5 text-right text-gray-500">{formatNumber(res.norm.value, 4)}</td>
                                                    <td className="border border-gray-300 px-1 py-0.5 text-right text-gray-600">{formatNumber(resQty, 2)}</td>
                                                    <td className="border border-gray-300 px-1 py-0.5 text-right text-gray-500">{formatNumber(res.unitPrice.value, 2)}</td>
                                                    <td className="border border-gray-300 px-1 py-0.5 text-right">{res.type === 'labor' ? formatNumber(resValue, 2) : ''}</td>
                                                    <td className="border border-gray-300 px-1 py-0.5 text-right">{res.type === 'material' ? formatNumber(resValue, 2) : ''}</td>
                                                    <td className="border border-gray-300 px-1 py-0.5 text-right">{res.type === 'equipment' ? formatNumber(resValue, 2) : ''}</td>
                                                  </tr>
                                                );
                                              })}
                                              {/* Position total */}
                                              <tr className="border border-gray-400 bg-gray-50">
                                                <td className="border border-gray-400 px-1 py-0.5" colSpan={7}>
                                                  <span className="text-xs font-medium text-gray-600 pl-4">RAZEM poz. d.{sIdx + 1}.{pIdx + 1}</span>
                                                </td>
                                                <td className="border border-gray-400 px-1 py-0.5 text-right font-medium">{formatNumber(posLabor, 2)}</td>
                                                <td className="border border-gray-400 px-1 py-0.5 text-right font-medium">{formatNumber(posMaterial, 2)}</td>
                                                <td className="border border-gray-400 px-1 py-0.5 text-right font-medium">{formatNumber(posEquipment, 2)}</td>
                                              </tr>
                                            </React.Fragment>
                                          );
                                        })}
                                        {/* Section total */}
                                        <tr className="border border-gray-400 bg-gray-200 font-bold">
                                          <td className="border border-gray-400 px-1 py-1" colSpan={7}>
                                            <span className="text-xs">RAZEM dział {sIdx + 1}</span>
                                          </td>
                                          <td className="border border-gray-400 px-1 py-1 text-right">{formatNumber(sectionLabor, 2)}</td>
                                          <td className="border border-gray-400 px-1 py-1 text-right">{formatNumber(sectionMaterial, 2)}</td>
                                          <td className="border border-gray-400 px-1 py-1 text-right">{formatNumber(sectionEquipment, 2)}</td>
                                        </tr>
                                      </React.Fragment>
                                    );
                                  })}
                                  {/* Grand totals */}
                                  {(() => {
                                    const ksKpOverhead = estimateData.root.overheads.find(o => o.name.includes('Kp'));
                                    const ksZOverhead = estimateData.root.overheads.find(o => o.name.includes('Zysk'));
                                    const ksKzOverhead = estimateData.root.overheads.find(o => o.name.includes('zakupu'));
                                    const ksKpVal = ksKpOverhead ? (globalLabor + globalEquipment) * (ksKpOverhead.value / 100) : 0;
                                    const ksZVal = ksZOverhead ? (globalLabor + globalEquipment + ksKpVal) * (ksZOverhead.value / 100) : 0;
                                    const ksKzVal = ksKzOverhead ? globalMaterial * (ksKzOverhead.value / 100) : 0;
                                    const ksNetto = globalLabor + globalMaterial + globalEquipment + ksKpVal + ksZVal + ksKzVal;
                                    const ksVatRate = estimate?.settings?.vatRate ?? 23;
                                    const ksVatExempt = ksVatRate < 0;
                                    const ksVat = ksVatExempt ? 0 : ksNetto * (ksVatRate / 100);
                                    const ksBrutto = ksNetto + ksVat;
                                    return (
                                      <>
                                        <tr className="border border-gray-400 font-bold bg-gray-100">
                                          <td className="border border-gray-400 px-1 py-1" colSpan={7}>Koszty bezpośrednie</td>
                                          <td className="border border-gray-400 px-1 py-1 text-right">{formatNumber(globalLabor, 2)}</td>
                                          <td className="border border-gray-400 px-1 py-1 text-right">{formatNumber(globalMaterial, 2)}</td>
                                          <td className="border border-gray-400 px-1 py-1 text-right">{formatNumber(globalEquipment, 2)}</td>
                                        </tr>
                                        {ksKpOverhead && ksKpOverhead.value > 0 && (
                                          <tr className="border border-gray-400">
                                            <td className="border border-gray-400 px-1 py-1" colSpan={7}>Koszty pośrednie Kp ({ksKpOverhead.value}% od R+S)</td>
                                            <td className="border border-gray-400 px-1 py-1 text-right" colSpan={3}>{formatNumber(ksKpVal, 2)}</td>
                                          </tr>
                                        )}
                                        {ksZOverhead && ksZOverhead.value > 0 && (
                                          <tr className="border border-gray-400">
                                            <td className="border border-gray-400 px-1 py-1" colSpan={7}>Zysk Z ({ksZOverhead.value}% od R+S+Kp)</td>
                                            <td className="border border-gray-400 px-1 py-1 text-right" colSpan={3}>{formatNumber(ksZVal, 2)}</td>
                                          </tr>
                                        )}
                                        {ksKzOverhead && ksKzOverhead.value > 0 && (
                                          <tr className="border border-gray-400">
                                            <td className="border border-gray-400 px-1 py-1" colSpan={7}>Koszty zakupu Kz ({ksKzOverhead.value}% od M)</td>
                                            <td className="border border-gray-400 px-1 py-1 text-right" colSpan={3}>{formatNumber(ksKzVal, 2)}</td>
                                          </tr>
                                        )}
                                        <tr className="border border-gray-400 font-bold bg-blue-50">
                                          <td className="border border-gray-400 px-1 py-1" colSpan={7}>RAZEM netto</td>
                                          <td className="border border-gray-400 px-1 py-1 text-right" colSpan={3}>{formatNumber(ksNetto, 2)}</td>
                                        </tr>
                                        <tr className="border border-gray-400">
                                          <td className="border border-gray-400 px-1 py-1" colSpan={7}>{ksVatExempt ? 'VAT (zw.)' : `VAT (${ksVatRate}%)`}</td>
                                          <td className="border border-gray-400 px-1 py-1 text-right" colSpan={3}>{formatNumber(ksVat, 2)}</td>
                                        </tr>
                                        <tr className="border border-gray-400 font-bold bg-green-50">
                                          <td className="border border-gray-400 px-1 py-1" colSpan={7}>RAZEM brutto</td>
                                          <td className="border border-gray-400 px-1 py-1 text-right" colSpan={3}>{formatNumber(ksBrutto, 2)}</td>
                                        </tr>
                                      </>
                                    );
                                  })()}
                                </>
                              );
                            })()}
                          </tbody>
                        </table>

                        <div className="mt-4 text-sm text-center">
                          Słownie: {formatCurrency(calculationResult?.totalValue || 0)}
                        </div>

                        <div className="text-right text-xs text-gray-400 mt-8">
                          {pageIndex + 1}/{exportPages.filter(p => p.enabled).length}
                        </div>
                      </div>
                    );
                  }

                  return null;
                })}
              </div>
            </div>
          )}

          {/* Standard table views (przedmiar, kosztorys, naklady) */}
          {leftPanelMode !== 'export' && (viewMode === 'przedmiar' || viewMode === 'kosztorys' || viewMode === 'naklady' || viewMode === 'pozycje') && (
            <table className={`w-full border-collapse ${viewMode === 'pozycje' ? 'border border-gray-300' : ''}`}>
              <thead className="sticky top-0 bg-gray-50 z-10">
                {viewMode === 'przedmiar' ? (
                  <tr className="border-b border-gray-200">
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 w-12">L.p.</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 w-28">Podstawa</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Nakład</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 w-14">j.m.</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 w-24">Poszczególne</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 w-20">Razem</th>
                  </tr>
                ) : viewMode === 'naklady' ? (
                  <tr className="border-b border-gray-200">
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 w-14">L.p.</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 w-20">Indeks</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Nazwa</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 w-12">j.m.</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 w-20">Ilość</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 w-28">Cena jednostkowa</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 w-24">Wartość</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 w-24">Ilość inwestora</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 w-28">Ilość wykonawcy</th>
                  </tr>
                ) : viewMode === 'pozycje' ? (
                  <tr className="border-b border-gray-300">
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 border border-gray-300 w-14">Lp.</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 border border-gray-300 w-28">Podstawa</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 border border-gray-300">Nakład</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-600 border border-gray-300 w-12">j.m.</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-600 border border-gray-300 w-20">Obmiar</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-600 border border-gray-300 w-28">Ceny jednostkowa</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-600 border border-gray-300 w-24">Wartość</th>
                  </tr>
                ) : (
                  /* Kosztorys view - matching eKosztorysowanie */
                  <tr className="border-b border-gray-200">
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 w-14">Lp.</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 w-28">Podstawa</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Nazwa</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 w-12">j.m.</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 w-16">Nakład</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 w-20">Koszt jedn.</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 w-20">R</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 w-16">M</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 w-16">S</th>
                  </tr>
                )}
              </thead>
              <tbody>
                {/* Sections (positions can only exist within sections, not at root level) */}
                {estimateData.root.sectionIds.map((sectionId, index) => {
                  const section = estimateData.sections[sectionId];
                  if (!section) return null;
                  return renderSection(section, index);
                })}

                {/* Empty state */}
                {estimateData.root.sectionIds.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center">
                      <div className="text-gray-400 mb-4">
                        <FileText className="w-12 h-12 mx-auto mb-2" />
                        <p>Kosztorys jest pusty</p>
                        <p className="text-sm mt-1">Dodaj dział, aby rozpocząć tworzenie kosztorysu</p>
                      </div>
                      <button
                        onClick={handleAddSection}
                        className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                      >
                        <FolderPlus className="w-4 h-4 inline mr-1" />
                        Dodaj dział
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Properties panel - now integrated into left panel */}

        {/* Right Panel - Settings and View Options */}
        {rightPanelMode !== 'closed' && (
          <div className="shrink-0 bg-white w-[320px] h-full border-l border-gray-200 flex flex-col">
            {/* Panel header */}
            <div className="flex items-center justify-between p-3 border-b border-gray-200">
              <h3 className="text-sm font-semibold text-gray-900">
                {rightPanelMode === 'settings' ? 'Ustawienia' :
                 rightPanelMode === 'viewOptions' ? 'Opcje widoku' :
                 'Ustawienia pozycji'}
              </h3>
              <button onClick={() => setRightPanelMode('closed')} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Settings Panel Content */}
            {rightPanelMode === 'settings' && estimate && (
              <div className="flex-1 overflow-y-auto overflow-x-hidden p-3">
                {/* Nazwa kosztorysu */}
                <div className="mb-4">
                  <label className="block text-xs text-gray-500 mb-1">Nazwa kosztorysu</label>
                  <input
                    type="text"
                    value={estimate.settings.name}
                    onChange={(e) => setEstimate(prev => prev ? {
                      ...prev,
                      settings: { ...prev.settings, name: e.target.value }
                    } : null)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>

                {/* Rodzaj */}
                <div className="mb-4">
                  <label className="block text-xs text-gray-500 mb-2">Rodzaj</label>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="rightPanelEstimateType"
                        value="contractor"
                        checked={estimate.settings.type === 'contractor'}
                        onChange={() => setEstimate(prev => prev ? {
                          ...prev,
                          settings: { ...prev.settings, type: 'contractor' }
                        } : null)}
                        className="w-4 h-4 text-blue-600"
                      />
                      <span className="text-sm text-gray-800">Kosztorys wykonawczy</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="rightPanelEstimateType"
                        value="investor"
                        checked={estimate.settings.type === 'investor'}
                        onChange={() => setEstimate(prev => prev ? {
                          ...prev,
                          settings: { ...prev.settings, type: 'investor' }
                        } : null)}
                        className="w-4 h-4 text-blue-600"
                      />
                      <span className="text-sm text-gray-800">Kosztorys inwestorski</span>
                    </label>
                  </div>
                </div>

                {/* Kalkulacje */}
                <div className="mb-4 border-t border-gray-200 pt-4">
                  <button
                    onClick={() => {}}
                    className="w-full flex items-center justify-between text-sm text-blue-600 font-medium mb-2"
                  >
                    <span>Kalkulacje</span>
                    <ChevronUp className="w-4 h-4" />
                  </button>
                  <div className="mb-2">
                    <label className="block text-xs text-gray-500 mb-1">Szablon kalkulacji podsumowania kosztorysu</label>
                    <select
                      value={estimate.settings.calculationTemplate}
                      onChange={(e) => setEstimate(prev => prev ? {
                        ...prev,
                        settings: { ...prev.settings, calculationTemplate: e.target.value as KosztorysCalculationTemplate }
                      } : prev)}
                      className="w-full px-2 py-2 border border-gray-300 rounded-lg text-xs"
                    >
                      <option value="overhead-on-top">Narzuty liczone dla kosztorysu</option>
                      <option value="overhead-cascade">Narzuty kaskadowe</option>
                      <option value="simple">Uproszczona</option>
                    </select>
                  </div>
                  <div className="mb-3">
                    <label className="block text-xs text-gray-500 mb-1">Opis kosztorysu</label>
                    <textarea
                      value={estimate.settings.description}
                      onChange={(e) => setEstimate(prev => prev ? {
                        ...prev,
                        settings: { ...prev.settings, description: e.target.value }
                      } : null)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none"
                      rows={2}
                      placeholder="KOSZTORYS NASZ"
                    />
                  </div>

                  {/* Narzuty settings */}
                  <div className="border-t border-gray-100 pt-3">
                    <label className="block text-xs text-gray-500 mb-2">Narzuty</label>
                    <div className="space-y-2">
                      {/* Koszty pośrednie (Kp) */}
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-600">Koszty pośrednie (Kp)</span>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="1"
                            value={estimateData.root.overheads.find(o => o.name.includes('Kp'))?.value || 65}
                            onChange={(e) => {
                              const newValue = parseFloat(e.target.value) || 0;
                              const newOverheads = estimateData.root.overheads.map(o =>
                                o.name.includes('Kp') ? { ...o, value: newValue } : o
                              );
                              updateEstimateData({
                                ...estimateData,
                                root: { ...estimateData.root, overheads: newOverheads }
                              });
                            }}
                            className="w-14 px-2 py-1 text-sm text-right border border-gray-300 rounded"
                          />
                          <span className="text-xs text-gray-500">%</span>
                          <span className="text-xs text-gray-400 ml-1">(R)</span>
                        </div>
                      </div>

                      {/* Zysk (Z) */}
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-600">Zysk (Z)</span>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="1"
                            value={estimateData.root.overheads.find(o => o.name.includes('Zysk'))?.value || 10}
                            onChange={(e) => {
                              const newValue = parseFloat(e.target.value) || 0;
                              const newOverheads = estimateData.root.overheads.map(o =>
                                o.name.includes('Zysk') ? { ...o, value: newValue } : o
                              );
                              updateEstimateData({
                                ...estimateData,
                                root: { ...estimateData.root, overheads: newOverheads }
                              });
                            }}
                            className="w-14 px-2 py-1 text-sm text-right border border-gray-300 rounded"
                          />
                          <span className="text-xs text-gray-500">%</span>
                          <span className="text-xs text-gray-400 ml-1">(R)</span>
                        </div>
                      </div>

                      {/* Koszty zakupu (Kz) */}
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-600">Koszty zakupu (Kz)</span>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="1"
                            value={estimateData.root.overheads.find(o => o.name.includes('zakupu'))?.value || 5}
                            onChange={(e) => {
                              const newValue = parseFloat(e.target.value) || 0;
                              const newOverheads = estimateData.root.overheads.map(o =>
                                o.name.includes('zakupu') ? { ...o, value: newValue } : o
                              );
                              updateEstimateData({
                                ...estimateData,
                                root: { ...estimateData.root, overheads: newOverheads }
                              });
                            }}
                            className="w-14 px-2 py-1 text-sm text-right border border-gray-300 rounded"
                          />
                          <span className="text-xs text-gray-500">%</span>
                          <span className="text-xs text-gray-400 ml-1">(M)</span>
                        </div>
                      </div>
                    </div>

                    {/* Stawka VAT */}
                    <div className="mt-2 pt-2 border-t border-gray-100">
                      <label className="block text-xs text-gray-600 mb-1">Stawka VAT</label>
                      <select
                        value={estimate.settings.vatRate ?? 23}
                        onChange={(e) => setEstimate(prev => prev ? {
                          ...prev,
                          settings: { ...prev.settings, vatRate: parseFloat(e.target.value) }
                        } : null)}
                        className="w-full px-2 py-1 text-xs border border-gray-300 rounded"
                      >
                        <option value={23}>23% — podstawowa</option>
                        <option value={8}>8% — budownictwo</option>
                        <option value={5}>5% — żywność, książki</option>
                        <option value={0}>0% — eksport, WDT</option>
                        <option value={-1}>zw. — zwolniony</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Dokładność */}
                <div className="border-t border-gray-200 pt-4">
                  <button
                    onClick={() => {}}
                    className="w-full flex items-center justify-between text-sm text-blue-600 font-medium mb-3"
                  >
                    <span>Dokładność</span>
                    <ChevronUp className="w-4 h-4" />
                  </button>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-gray-600 truncate">Normy</label>
                      <div className="flex items-center gap-0.5">
                        <span className="w-5 text-center text-sm">{estimate.settings.precision.norms}</span>
                        <div className="flex flex-col">
                          <button
                            onClick={() => setEstimate(prev => prev ? {
                              ...prev,
                              settings: {
                                ...prev.settings,
                                precision: { ...prev.settings.precision, norms: Math.min(10, prev.settings.precision.norms + 1) }
                              }
                            } : null)}
                            className="p-0.5 text-gray-400 hover:bg-gray-100 rounded"
                          >
                            <ChevronUp className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => setEstimate(prev => prev ? {
                              ...prev,
                              settings: {
                                ...prev.settings,
                                precision: { ...prev.settings.precision, norms: Math.max(0, prev.settings.precision.norms - 1) }
                              }
                            } : null)}
                            className="p-0.5 text-gray-400 hover:bg-gray-100 rounded"
                          >
                            <ChevronDown className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-gray-600 truncate">Wart...</label>
                      <div className="flex items-center gap-0.5">
                        <span className="w-5 text-center text-sm">{estimate.settings.precision.unitValues}</span>
                        <div className="flex flex-col">
                          <button
                            onClick={() => setEstimate(prev => prev ? {
                              ...prev,
                              settings: {
                                ...prev.settings,
                                precision: { ...prev.settings.precision, unitValues: Math.min(10, prev.settings.precision.unitValues + 1) }
                              }
                            } : null)}
                            className="p-0.5 text-gray-400 hover:bg-gray-100 rounded"
                          >
                            <ChevronUp className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => setEstimate(prev => prev ? {
                              ...prev,
                              settings: {
                                ...prev.settings,
                                precision: { ...prev.settings.precision, unitValues: Math.max(0, prev.settings.precision.unitValues - 1) }
                              }
                            } : null)}
                            className="p-0.5 text-gray-400 hover:bg-gray-100 rounded"
                          >
                            <ChevronDown className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-gray-600 truncate">Nakła...</label>
                      <div className="flex items-center gap-0.5">
                        <span className="w-5 text-center text-sm">1</span>
                        <div className="flex flex-col">
                          <button className="p-0.5 text-gray-400 hover:bg-gray-100 rounded">
                            <ChevronUp className="w-3 h-3" />
                          </button>
                          <button className="p-0.5 text-gray-400 hover:bg-gray-100 rounded">
                            <ChevronDown className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-gray-600 truncate">Pods....</label>
                      <div className="flex items-center gap-0.5">
                        <span className="w-5 text-center text-sm">3</span>
                        <div className="flex flex-col">
                          <button className="p-0.5 text-gray-400 hover:bg-gray-100 rounded">
                            <ChevronUp className="w-3 h-3" />
                          </button>
                          <button className="p-0.5 text-gray-400 hover:bg-gray-100 rounded">
                            <ChevronDown className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-gray-600 truncate">Obmi...</label>
                      <div className="flex items-center gap-0.5">
                        <span className="w-5 text-center text-sm">2</span>
                        <div className="flex flex-col">
                          <button className="p-0.5 text-gray-400 hover:bg-gray-100 rounded">
                            <ChevronUp className="w-3 h-3" />
                          </button>
                          <button className="p-0.5 text-gray-400 hover:bg-gray-100 rounded">
                            <ChevronDown className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-gray-600 truncate">Pods....</label>
                      <div className="flex items-center gap-0.5">
                        <span className="w-5 text-center text-sm">2</span>
                        <div className="flex flex-col">
                          <button className="p-0.5 text-gray-400 hover:bg-gray-100 rounded">
                            <ChevronUp className="w-3 h-3" />
                          </button>
                          <button className="p-0.5 text-gray-400 hover:bg-gray-100 rounded">
                            <ChevronDown className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 mt-3 cursor-pointer">
                    <input type="checkbox" className="w-4 h-4 text-blue-600 rounded" defaultChecked />
                    <span className="text-xs text-gray-600">Zaokrąglanie liczb wg PN-70/N-02120</span>
                    <button className="p-1 text-gray-400 hover:text-gray-600">
                      <HelpCircle className="w-3 h-3" />
                    </button>
                  </label>
                </div>

                {/* Współczynniki norm */}
                <div className="border-t border-gray-200 pt-4 mt-4">
                  <button
                    onClick={() => {}}
                    className="w-full flex items-center justify-between text-sm text-blue-600 font-medium mb-3"
                  >
                    <span>Współczynniki norm</span>
                    <ChevronUp className="w-4 h-4" />
                  </button>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm text-gray-600">Robocizna</label>
                      <input
                        type="text"
                        defaultValue="1,1"
                        className="w-20 px-2 py-1.5 border border-gray-300 rounded text-sm text-right"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <label className="text-sm text-gray-600">Materiały</label>
                      <input
                        type="text"
                        defaultValue="1,2"
                        className="w-20 px-2 py-1.5 border border-gray-300 rounded text-sm text-right"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <label className="text-sm text-gray-600">Sprzęt</label>
                      <input
                        type="text"
                        defaultValue="1,3"
                        className="w-20 px-2 py-1.5 border border-gray-300 rounded text-sm text-right"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <label className="text-sm text-gray-600">Odpady</label>
                      <input
                        type="text"
                        defaultValue="1,4"
                        className="w-20 px-2 py-1.5 border border-gray-300 rounded text-sm text-right"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* View Options Panel Content */}
            {rightPanelMode === 'viewOptions' && (
              <div className="flex-1 overflow-y-auto p-3">
                {/* Ceny jednostkowe */}
                <div className="mb-4">
                  <button
                    onClick={() => {}}
                    className="w-full flex items-center justify-between text-sm text-blue-600 font-medium mb-3"
                  >
                    <span>Ceny jednostkowe</span>
                    <ChevronUp className="w-4 h-4" />
                  </button>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={viewOptionsPanel.highlightZeroPrices}
                      onChange={(e) => setViewOptionsPanel(prev => ({ ...prev, highlightZeroPrices: e.target.checked }))}
                      className="w-4 h-4 text-blue-600 rounded"
                    />
                    <span className="text-sm text-gray-700">Podświetl wartości zerowe cen jednostkowych</span>
                  </label>
                </div>

                {/* Opcje narzutów */}
                <div className="border-t border-gray-200 pt-4">
                  <button
                    onClick={() => {}}
                    className="w-full flex items-center justify-between text-sm text-blue-600 font-medium mb-3"
                  >
                    <span>Opcje narzutów</span>
                    <ChevronUp className="w-4 h-4" />
                  </button>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={viewOptionsPanel.showDetailedOverheads}
                      onChange={(e) => setViewOptionsPanel(prev => ({ ...prev, showDetailedOverheads: e.target.checked }))}
                      className="w-4 h-4 text-blue-600 rounded"
                    />
                    <span className="text-sm text-gray-700">Pokaż szczegółowy podział narzutów w podsumowaniu pozycji</span>
                  </label>
                </div>
              </div>
            )}

            {/* Position Settings Panel Content */}
            {rightPanelMode === 'positionSettings' && selectedItem && editorState.selectedItemType === 'resource' && (
              <div className="flex-1 overflow-y-auto p-3">
                <p className="text-sm text-gray-600">Ustawienia nakładu</p>
                {/* Resource properties will be shown here */}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Alerts bar - matching eKosztorysowanie "0 z 13" style with visual slider */}
      <div className="bg-gray-50 border-t border-gray-200 px-4 py-1.5 flex items-center justify-between">
        <div className="flex items-center gap-3 flex-1">
          <span className="text-xs text-gray-500 font-medium">Alerty</span>
          <span className="text-sm text-gray-600 min-w-[60px]">
            {alerts.length > 0 ? alertsCount.current + 1 : 0} z {alerts.length}
          </span>

          {/* Visual slider track - matching eKosztorysowanie ◄════════════════► style */}
          <div className="flex items-center gap-1 flex-1 max-w-md">
            <button
              onClick={() => handleNavigateToAlert(alertsCount.current - 1)}
              disabled={alertsCount.current === 0 || alerts.length === 0}
              className="p-0.5 hover:bg-gray-200 rounded disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4 text-gray-500" />
            </button>

            {/* Slider track */}
            <div className="flex-1 h-1.5 bg-gray-200 rounded-full relative">
              {alerts.length > 0 && (
                <div
                  className="absolute h-full bg-blue-500 rounded-full transition-all duration-200"
                  style={{
                    width: `${((alertsCount.current + 1) / alerts.length) * 100}%`,
                    minWidth: '8px'
                  }}
                />
              )}
            </div>

            <button
              onClick={() => handleNavigateToAlert(alertsCount.current + 1)}
              disabled={alertsCount.current >= alerts.length - 1 || alerts.length === 0}
              className="p-0.5 hover:bg-gray-200 rounded disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4 text-gray-500" />
            </button>
          </div>

          {/* Alert message with expand button */}
          {alerts.length > 0 && alertsCount.current < alerts.length && (
            <div className="flex items-center gap-1 ml-2">
              <span className={`text-xs flex items-center gap-1 ${
                alerts[alertsCount.current]?.type === 'error' ? 'text-[#EF4444]' : 'text-amber-600'
              }`}>
                <AlertCircle className="w-3 h-3" />
                {alerts[alertsCount.current]?.message || 'Alerty w kosztorysie'}{alerts[alertsCount.current]?.reason ? `: ${alerts[alertsCount.current].reason}` : ''}
              </span>
              <button
                onClick={() => setAlertsExpanded(!alertsExpanded)}
                className="p-0.5 hover:bg-gray-200 rounded transition-colors"
                title={alertsExpanded ? 'Zwiń listę alertów' : 'Rozwiń listę alertów'}
              >
                {alertsExpanded ? (
                  <ChevronDown className="w-4 h-4 text-gray-500" />
                ) : (
                  <ChevronUp className="w-4 h-4 text-gray-500" />
                )}
              </button>
            </div>
          )}
          {alerts.length === 0 && (
            <span className="text-xs text-green-600 flex items-center gap-1 ml-2">
              <CheckCircle2 className="w-3 h-3" />
              Brak alertów
            </span>
          )}
        </div>

        {/* Right side - total value */}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-gray-500">Wartość kosztorysu:</span>
          <span className="font-bold text-gray-900">{formatCurrency(calculationResult?.totalValue || 0)}</span>
        </div>
      </div>

      {/* Expanded Alerts Panel */}
      {alertsExpanded && alerts.length > 0 && (
        <div className="absolute bottom-[40px] left-0 right-0 bg-white border-t border-gray-300 shadow-lg z-40 max-h-[300px] overflow-y-auto">
          <div className="sticky top-0 bg-gray-100 border-b border-gray-200 px-4 py-2 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">Lista alertów ({alerts.length})</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  // Delete all positions without resources
                  const positionsToDelete = alerts
                    .filter(a => a.reason === 'Brak nakładów' && a.positionId)
                    .map(a => a.positionId!);

                  if (positionsToDelete.length === 0) return;

                  if (!confirm(`Usunąć ${positionsToDelete.length} pozycji bez nakładów?`)) return;

                  const newPositions = { ...estimateData.positions };
                  positionsToDelete.forEach(id => delete newPositions[id]);

                  // Remove from sections
                  const newSections = { ...estimateData.sections };
                  for (const [secId, section] of Object.entries(newSections)) {
                    newSections[secId] = {
                      ...section,
                      positionIds: section.positionIds.filter(id => !positionsToDelete.includes(id)),
                    };
                  }

                  // Remove from root
                  const newRoot = {
                    ...estimateData.root,
                    positionIds: (estimateData.root.positionIds || []).filter(id => !positionsToDelete.includes(id)),
                  };

                  updateEstimateData({
                    ...estimateData,
                    root: newRoot,
                    sections: newSections,
                    positions: newPositions,
                  });

                  showNotificationMessage(`Usunięto ${positionsToDelete.length} pozycji`, 'success');
                }}
                className="px-2 py-1 text-xs bg-red-100 text-red-700 hover:bg-red-200 rounded flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" />
                Usuń puste pozycje
              </button>
              <button
                onClick={() => setAlertsExpanded(false)}
                className="p-1 hover:bg-gray-200 rounded"
              >
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 sticky top-[41px]">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Lokalizacja</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Pozycja</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Typ</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Nazwa</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Alert</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-28">Komunikat</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {alerts.map((alert, index) => (
                <tr
                  key={alert.id}
                  className={`hover:bg-gray-50 cursor-pointer ${index === alertsCount.current ? 'bg-blue-50' : ''}`}
                  onClick={() => handleNavigateToAlert(index)}
                >
                  <td className="px-3 py-2 text-gray-500 text-xs max-w-[200px] truncate" title={alert.path}>
                    {alert.path || '-'}
                  </td>
                  <td className="px-3 py-2 text-gray-700 font-medium max-w-[280px] truncate" title={alert.positionName || alert.message}>
                    {alert.message}
                  </td>
                  <td className="px-3 py-2 text-gray-600 text-xs whitespace-nowrap">
                    {alert.itemType}
                  </td>
                  <td className="px-3 py-2 text-gray-600 text-xs max-w-[180px] truncate" title={alert.itemName}>
                    {alert.itemName}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-xs font-medium ${
                      alert.type === 'error' ? 'text-red-600' : 'text-amber-600'
                    }`}>
                      {alert.reason}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                      alert.type === 'error'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}>
                      <AlertCircle className="w-3 h-3" />
                      {alert.type === 'error' ? 'Błąd' : 'Ostrzeżenie'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Position Modal */}
      {showAddPositionModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-gray-500/75 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full shadow-xl">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">Dodaj pozycję</h2>
              <button onClick={() => setShowAddPositionModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-800 mb-1">Podstawa (norma)</label>
                <input
                  type="text"
                  value={newPositionForm.base}
                  onChange={e => setNewPositionForm(prev => ({ ...prev, base: e.target.value }))}
                  placeholder="np. KNNR 5 0702-01"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-800 mb-1">Nazwa nakładu</label>
                <textarea
                  value={newPositionForm.name}
                  onChange={e => setNewPositionForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Opis pracy..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  rows={2}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-800 mb-1">Jednostka miary</label>
                  <select
                    value={newPositionForm.unitIndex}
                    onChange={e => setNewPositionForm(prev => ({ ...prev, unitIndex: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  >
                    {UNITS_REFERENCE.map(u => (
                      <option key={u.index} value={u.index}>{u.unit} - {u.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-800 mb-1">Przedmiar (ilość)</label>
                  <input
                    type="text"
                    value={newPositionForm.measurement}
                    onChange={e => setNewPositionForm(prev => ({ ...prev, measurement: e.target.value }))}
                    placeholder="np. 10*2.5 lub 25"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
              </div>
            </div>
            <div className="p-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => setShowAddPositionModal(false)}
                className="px-4 py-2 text-gray-800 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Anuluj
              </button>
              <button
                onClick={confirmAddPosition}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Dodaj pozycję
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Resource Modal */}
      {showAddResourceModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-gray-500/75 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full shadow-xl">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">Dodaj nakład</h2>
              <button onClick={() => setShowAddResourceModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-800 mb-1">Typ nakładu</label>
                <div className="flex gap-2">
                  {(['labor', 'material', 'equipment'] as KosztorysResourceType[]).map(type => {
                    const config = RESOURCE_TYPE_CONFIG[type];
                    return (
                      <button
                        key={type}
                        onClick={() => {
                          const defaultUnitIndex = type === 'labor' ? '149' : type === 'equipment' ? '150' : '020';
                          setNewResourceForm(prev => ({ ...prev, type, unitIndex: defaultUnitIndex }));
                        }}
                        className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border ${
                          newResourceForm.type === type
                            ? `${config.bgColor} ${config.color} border-current`
                            : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        <config.icon className="w-4 h-4" />
                        {config.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-800 mb-1">Indeks</label>
                  <input
                    type="text"
                    value={newResourceForm.index}
                    onChange={e => setNewResourceForm(prev => ({ ...prev, index: e.target.value }))}
                    placeholder="np. 999"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-800 mb-1">Jednostka</label>
                  <select
                    value={newResourceForm.unitIndex}
                    onChange={e => setNewResourceForm(prev => ({ ...prev, unitIndex: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  >
                    {UNITS_REFERENCE.map(u => (
                      <option key={u.index} value={u.index}>{u.unit} - {u.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-800 mb-1">Nazwa</label>
                <input
                  type="text"
                  value={newResourceForm.name}
                  onChange={e => setNewResourceForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder={RESOURCE_TYPE_CONFIG[newResourceForm.type].label}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-800 mb-1">Norma</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={newResourceForm.normValue}
                    onChange={e => setNewResourceForm(prev => ({ ...prev, normValue: parseFloat(e.target.value) || 0 }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-800 mb-1">Cena jednostkowa</label>
                  <input
                    type="number"
                    step="0.01"
                    value={newResourceForm.unitPrice}
                    onChange={e => setNewResourceForm(prev => ({ ...prev, unitPrice: parseFloat(e.target.value) || 0 }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
              </div>
            </div>
            <div className="p-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => setShowAddResourceModal(false)}
                className="px-4 py-2 text-gray-800 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Anuluj
              </button>
              <button
                onClick={confirmAddResource}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Dodaj nakład
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Ceny (Prices Update) Dialog */}
      {showCenyDialog && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-gray-500/75 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full shadow-xl">
            {/* Dialog header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <h2 className="text-base font-bold text-gray-900">Uaktualnij ceny w kosztorysie</h2>
              <button onClick={() => setShowCenyDialog(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-200">
              <button
                onClick={() => setCenyDialogTab('wstaw')}
                className={`px-4 py-2 text-sm font-medium ${
                  cenyDialogTab === 'wstaw'
                    ? 'text-blue-600 border-b-2 border-blue-600'
                    : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                Wstaw ceny
              </button>
              <button
                onClick={() => setCenyDialogTab('zmien')}
                className={`px-4 py-2 text-sm font-medium ${
                  cenyDialogTab === 'zmien'
                    ? 'text-blue-600 border-b-2 border-blue-600'
                    : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                Zmień ceny
              </button>
            </div>

            {/* Tab content */}
            <div className="p-3 space-y-3">
              {/* Zastosuj do section */}
              <div>
                <p className="text-xs text-gray-600 mb-1.5">Zastosuj do</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-0.5">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={priceUpdateSettings.applyToLabor}
                        onChange={(e) => setPriceUpdateSettings(prev => ({ ...prev, applyToLabor: e.target.checked }))}
                        className="w-3.5 h-3.5 rounded border-gray-300"
                      />
                      <span className="text-xs text-gray-800">Robocizna</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={priceUpdateSettings.applyToMaterial}
                        onChange={(e) => setPriceUpdateSettings(prev => ({ ...prev, applyToMaterial: e.target.checked }))}
                        className="w-3.5 h-3.5 rounded border-gray-300"
                      />
                      <span className="text-xs text-gray-800">Materiały</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={priceUpdateSettings.applyToEquipment}
                        onChange={(e) => setPriceUpdateSettings(prev => ({ ...prev, applyToEquipment: e.target.checked }))}
                        className="w-3.5 h-3.5 rounded border-gray-300"
                      />
                      <span className="text-xs text-gray-800">Sprzęt</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={priceUpdateSettings.applyToWaste}
                        onChange={(e) => setPriceUpdateSettings(prev => ({ ...prev, applyToWaste: e.target.checked }))}
                        className="w-3.5 h-3.5 rounded border-gray-300"
                      />
                      <span className="text-xs text-gray-800">Odpady</span>
                    </label>
                  </div>
                  <div className="space-y-0.5">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={priceUpdateSettings.unitPositionPrices}
                        onChange={(e) => setPriceUpdateSettings(prev => ({ ...prev, unitPositionPrices: e.target.checked }))}
                        className="w-3.5 h-3.5 rounded border-gray-300"
                      />
                      <span className="text-xs text-gray-800">Ceny jednostkowe pozycji</span>
                    </label>
                    {cenyDialogTab === 'wstaw' && (
                      <>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={priceUpdateSettings.emptyUnitPrices}
                            onChange={(e) => setPriceUpdateSettings(prev => ({ ...prev, emptyUnitPrices: e.target.checked }))}
                            className="w-3.5 h-3.5 rounded border-gray-300"
                          />
                          <span className="text-xs text-gray-800">Puste ceny jednostkowe pozycji</span>
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={priceUpdateSettings.objectPrices}
                            onChange={(e) => setPriceUpdateSettings(prev => ({ ...prev, objectPrices: e.target.checked }))}
                            className="w-3.5 h-3.5 rounded border-gray-300"
                          />
                          <span className="text-xs text-gray-800">Ceny obiektów</span>
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={priceUpdateSettings.onlyZeroPrices}
                            onChange={(e) => setPriceUpdateSettings(prev => ({ ...prev, onlyZeroPrices: e.target.checked }))}
                            className="w-3.5 h-3.5 rounded border-gray-300"
                          />
                          <span className="text-xs text-gray-800">Uaktualnij tylko ceny zerowe</span>
                        </label>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {cenyDialogTab === 'wstaw' && (
                <>
                  {/* Źródła cen section */}
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <button
                      onClick={() => setShowPriceSourcesExpanded(!showPriceSourcesExpanded)}
                      className="w-full flex items-center justify-between px-3 py-2 text-xs text-gray-800 hover:bg-gray-50"
                    >
                      <span>Źródła cen</span>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={(e) => { e.stopPropagation(); setShowPriceSourcesModal(true); }}
                          className="p-0.5 hover:bg-gray-100 rounded"
                        >
                          <FileSpreadsheet className="w-3.5 h-3.5 text-gray-400" />
                        </button>
                        {showPriceSourcesExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </div>
                    </button>
                    {showPriceSourcesExpanded && (
                      <div className="px-3 pb-2 space-y-1 border-t border-gray-100">
                        {selectedPriceSources.length === 0 && (
                          <div className="py-1.5 text-xs text-gray-400 italic">Brak wybranych cenników</div>
                        )}
                        {selectedPriceSources.includes('system') && (
                          <div className="flex items-center justify-between py-1.5">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-gray-800">Cennik Systemowy</span>
                              <button className="text-gray-400 hover:text-gray-600" title="Cennik systemowy">
                                <HelpCircle className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <button
                              onClick={() => setSelectedPriceSources(prev => prev.filter(s => s !== 'system'))}
                              className="text-gray-400 hover:text-red-500"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                        {selectedPriceSources.includes('kartoteka') && (
                          <div className="flex items-center justify-between py-1.5">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-gray-800">Cennik z Kartoteki</span>
                              <button className="text-gray-400 hover:text-gray-600" title="Cennik z kartoteki własnych katalogów">
                                <FolderOpen className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <button
                              onClick={() => setSelectedPriceSources(prev => prev.filter(s => s !== 'kartoteka'))}
                              className="text-gray-400 hover:text-red-500"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                        {userPriceSources
                          .filter(ps => selectedPriceSources.includes(ps.id))
                          .map(ps => (
                          <div key={ps.id} className="flex items-center justify-between py-1.5">
                            <span className="text-xs text-gray-800">{ps.name}</span>
                            <button
                              onClick={() => setSelectedPriceSources(prev => prev.filter(s => s !== ps.id))}
                              className="text-gray-400 hover:text-red-500"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Opcje wyszukiwania cen */}
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <button
                      onClick={() => setShowSearchOptionsExpanded(!showSearchOptionsExpanded)}
                      className="w-full flex items-center justify-between px-3 py-2 text-xs text-gray-800 hover:bg-gray-50"
                    >
                      <span>Opcje wyszukiwania cen</span>
                      {showSearchOptionsExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                    {showSearchOptionsExpanded && (
                      <div className="px-3 pb-2 space-y-1.5 border-t border-gray-100 pt-2">
                        <select className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded">
                          <option value="">Wybierz opcję szukiwania cen</option>
                          <option value="index">Szukaj po indeksie</option>
                          <option value="name">Szukaj po nazwie</option>
                        </select>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={searchByNameWhenNoIndex}
                            onChange={(e) => setSearchByNameWhenNoIndex(e.target.checked)}
                            className="w-3.5 h-3.5 rounded border-gray-300"
                          />
                          <span className="text-xs text-gray-800">Szukaj po nazwie gdy brak wyników wg indeksu</span>
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={searchAllIndexTypes}
                            onChange={(e) => setSearchAllIndexTypes(e.target.checked)}
                            className="w-3.5 h-3.5 rounded border-gray-300"
                          />
                          <span className="text-xs text-gray-800">Szukaj we wszystkich typach indeksów</span>
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={matchUnits}
                            onChange={(e) => setMatchUnits(e.target.checked)}
                            className="w-3.5 h-3.5 rounded border-gray-300"
                          />
                          <span className="text-xs text-gray-800">Zgodność jednostek miar</span>
                        </label>
                      </div>
                    )}
                  </div>

                  {/* Zaawansowane */}
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <button
                      onClick={() => setShowAdvancedExpanded(!showAdvancedExpanded)}
                      className="w-full flex items-center justify-between px-3 py-2 text-xs text-gray-800 hover:bg-gray-50"
                    >
                      <span>Zaawansowane</span>
                      {showAdvancedExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                    {showAdvancedExpanded && (
                      <div className="px-3 pb-2 space-y-1.5 border-t border-gray-100 pt-2">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={zeroNotFoundPrices}
                            onChange={(e) => setZeroNotFoundPrices(e.target.checked)}
                            className="w-3.5 h-3.5 rounded border-gray-300"
                          />
                          <span className="text-xs text-gray-800">Zeruj ceny nieznalezione</span>
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={autoSelectLowestPrice}
                            onChange={(e) => setAutoSelectLowestPrice(e.target.checked)}
                            className="w-3.5 h-3.5 rounded border-gray-300"
                          />
                          <span className="text-xs text-gray-800">Po znalezieniu kilku cen automatycznie wybieraj najniższą</span>
                        </label>
                      </div>
                    )}
                  </div>

                  {/* Skip step process checkbox */}
                  <label className="flex items-center gap-1.5 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={priceUpdateSettings.skipStepProcess}
                      onChange={(e) => setPriceUpdateSettings(prev => ({ ...prev, skipStepProcess: e.target.checked }))}
                      className="w-3.5 h-3.5 rounded border-blue-600 text-blue-600"
                    />
                    <span className="text-xs text-gray-800">Pomiń proces krokowy (automatyczne wstawienie cen)</span>
                  </label>
                </>
              )}

              {cenyDialogTab === 'zmien' && (
                <>
                  {/* Wyrażenie section */}
                  <div>
                    <p className="text-xs text-gray-600 mb-1.5">Wyrażenie</p>
                    <div className="flex gap-1.5">
                      <select
                        value={priceUpdateSettings.expression.field}
                        onChange={(e) => setPriceUpdateSettings(prev => ({
                          ...prev,
                          expression: { ...prev.expression, field: e.target.value as 'cena' | 'wartosc' }
                        }))}
                        className="px-2 py-1.5 text-xs border border-gray-300 rounded"
                      >
                        <option value="cena">Cena</option>
                        <option value="wartosc">Wartość</option>
                      </select>
                      <select
                        value={priceUpdateSettings.expression.operation}
                        onChange={(e) => setPriceUpdateSettings(prev => ({
                          ...prev,
                          expression: { ...prev.expression, operation: e.target.value as 'add' | 'subtract' | 'multiply' | 'divide' }
                        }))}
                        className="px-2 py-1.5 text-xs border border-gray-300 rounded"
                      >
                        <option value="add">Dodaj (+)</option>
                        <option value="subtract">Odejmij (-)</option>
                        <option value="multiply">Pomnóż (*)</option>
                        <option value="divide">Podziel (/)</option>
                      </select>
                      <input
                        type="text"
                        value={priceUpdateSettings.expression.value}
                        onChange={(e) => setPriceUpdateSettings(prev => ({
                          ...prev,
                          expression: { ...prev.expression, value: e.target.value }
                        }))}
                        placeholder="Wartość"
                        className="flex-1 px-2 py-1.5 text-xs border border-gray-300 rounded"
                      />
                    </div>
                  </div>

                  {/* Wyzeruj ceny checkbox */}
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={priceUpdateSettings.zeroPrices}
                      onChange={(e) => setPriceUpdateSettings(prev => ({ ...prev, zeroPrices: e.target.checked }))}
                      className="w-3.5 h-3.5 rounded border-gray-300"
                    />
                    <span className="text-xs text-gray-800">Wyzeruj ceny</span>
                  </label>
                </>
              )}
            </div>

            {/* Dialog footer */}
            <div className="p-3 border-t border-gray-200 flex justify-end gap-2">
              <button
                onClick={() => setShowCenyDialog(false)}
                className="px-3 py-1.5 text-sm text-gray-800 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Anuluj
              </button>
              <button
                onClick={() => cenyDialogTab === 'wstaw' ? handleApplyPrices() : handleChangePrices()}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                {cenyDialogTab === 'wstaw' ? 'Rozpocznij wstawianie' : 'Zastosuj'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Replace Resources Confirmation Modal */}
      {showReplaceResourcesConfirm && (
        <div className="fixed inset-0 z-[60] overflow-y-auto bg-gray-500/75 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full shadow-xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <h2 className="text-base font-bold text-red-600 flex items-center gap-2">
                <AlertCircle className="w-5 h-5" />
                Zastąpienie wszystkich nakładów
              </h2>
              <button onClick={() => setShowReplaceResourcesConfirm(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4">
              <p className="text-sm text-gray-700 mb-3">
                <strong>Uwaga!</strong> Ta operacja usunie wszystkie istniejące nakłady (robocizna, materiały, sprzęt)
                ze wszystkich pozycji powiązanych z katalogiem KNR i zastąpi je nakładami z bazy normatywnej.
              </p>
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                <p className="text-xs text-red-700">
                  <strong>Zostaną usunięte:</strong> wszystkie ręcznie dodane nakłady, ceny,
                  modyfikacje i niestandardowe wartości norm.
                </p>
              </div>
              <p className="text-sm text-gray-600">
                Czy na pewno chcesz kontynuować?
              </p>
            </div>
            <div className="p-3 border-t border-gray-200 flex justify-end gap-2">
              <button
                onClick={() => setShowReplaceResourcesConfirm(false)}
                className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Anuluj
              </button>
              <button
                onClick={() => {
                  setShowReplaceResourcesConfirm(false);
                  handleUzupelnijNaklady('replace');
                }}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                Tak, zastąp wszystkie
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Price Sources Selection Modal (Baza cenników) */}
      {showPriceSourcesModal && (
        <div className="fixed inset-0 z-[60] overflow-y-auto bg-gray-500/75 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-sm w-full shadow-xl">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">Baza cenników</h2>
              <button onClick={() => setShowPriceSourcesModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={priceSourceSearch}
                  onChange={(e) => setPriceSourceSearch(e.target.value)}
                  placeholder="Szukaj"
                  className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div className="space-y-2">
                <label className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedPriceSources.includes('system')}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedPriceSources([...selectedPriceSources, 'system']);
                      } else {
                        setSelectedPriceSources(selectedPriceSources.filter(s => s !== 'system'));
                      }
                    }}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600"
                  />
                  <span className="text-sm text-gray-800">Cennik Systemowy</span>
                </label>
                <div className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded group">
                  <label className="flex items-center gap-3 flex-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedPriceSources.includes('kartoteka')}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedPriceSources([...selectedPriceSources, 'kartoteka']);
                        } else {
                          setSelectedPriceSources(selectedPriceSources.filter(s => s !== 'kartoteka'));
                        }
                      }}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600"
                    />
                    <span className="text-sm text-gray-800">Cennik z Kartoteki</span>
                  </label>
                  <button
                    onClick={openKartotekaPriceListModal}
                    className="p-1 text-gray-400 hover:text-blue-600 rounded"
                    title="Podgląd cennika z kartoteki"
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                </div>
                {userPriceSources
                  .filter(ps => !priceSourceSearch || ps.name.toLowerCase().includes(priceSourceSearch.toLowerCase()))
                  .map(ps => (
                  <div key={ps.id} className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded group">
                    <label className="flex items-center gap-3 flex-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedPriceSources.includes(ps.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedPriceSources([...selectedPriceSources, ps.id]);
                          } else {
                            setSelectedPriceSources(selectedPriceSources.filter(s => s !== ps.id));
                          }
                        }}
                        className="w-4 h-4 rounded border-gray-300 text-blue-600"
                      />
                      <span className="text-sm text-gray-800">{ps.name}</span>
                    </label>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleEditPriceSource(ps.id)}
                        className="p-1 text-gray-400 hover:text-blue-600 rounded"
                        title="Edytuj cennik"
                      >
                        <SquarePen className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => { setDeletingPriceSourceId(ps.id); setDeletingPriceSourceName(ps.name); }}
                        className="p-1 text-gray-400 hover:text-red-500 rounded"
                        title="Usuń cennik"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="relative">
                <button
                  onClick={() => setShowPriceAddChoice(!showPriceAddChoice)}
                  className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800"
                >
                  <Plus className="w-4 h-4" />
                  <span>Dodaj cennik</span>
                </button>
                {showPriceAddChoice && (
                  <>
                    <div className="fixed inset-0 z-[65]" onClick={() => setShowPriceAddChoice(false)} />
                    <div className="absolute left-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-[70] w-56">
                      <button
                        onClick={() => {
                          setShowPriceAddChoice(false);
                          setShowPriceImportModal(true);
                        }}
                        className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 rounded-t-lg"
                      >
                        <Upload className="w-4 h-4 text-gray-400" />
                        <div className="text-left">
                          <div className="font-medium">Importuj cennik</div>
                          <div className="text-xs text-gray-400">Z pliku dbf, csv lub xlsx</div>
                        </div>
                      </button>
                      <button
                        onClick={() => {
                          setShowPriceAddChoice(false);
                          setShowCustomPriceListModal(true);
                        }}
                        className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 rounded-b-lg border-t border-gray-100"
                      >
                        <SquarePen className="w-4 h-4 text-gray-400" />
                        <div className="text-left">
                          <div className="font-medium">Utwórz własny cennik</div>
                          <div className="text-xs text-gray-400">Wprowadź pozycje ręcznie</div>
                        </div>
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
            <div className="p-4 border-t border-gray-200 flex justify-end">
              <button
                onClick={() => setShowPriceSourcesModal(false)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Zatwierdź
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Price Import Modal */}
      {showPriceImportModal && (
        <div className="fixed inset-0 z-[70] overflow-y-auto bg-gray-500/75 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-sm w-full shadow-xl">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowPriceImportModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
              </div>
              <button onClick={() => setShowPriceImportModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              {/* Drag and drop area */}
              <div
                onDragOver={(e) => { e.preventDefault(); setPriceImportDragging(true); }}
                onDragLeave={() => setPriceImportDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setPriceImportDragging(false);
                  const files = e.dataTransfer.files;
                  if (files.length > 0) {
                    setPriceImportFile(files[0]);
                  }
                }}
                className={`border-2 border-dashed rounded-lg p-8 text-center ${
                  priceImportDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300'
                }`}
              >
                <FileSpreadsheet className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                <p className="text-sm text-gray-600 mb-3">
                  Przeciągnij i upuść plik dbf, by zaimportować.
                </p>
                <label className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer inline-block">
                  Wybierz z plików
                  <input
                    type="file"
                    accept=".dbf,.csv,.xlsx"
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) {
                        setPriceImportFile(e.target.files[0]);
                      }
                    }}
                    className="hidden"
                  />
                </label>
                {priceImportFile && (
                  <p className="text-sm text-green-600 mt-2">Wybrano: {priceImportFile.name}</p>
                )}
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">Nazwa cennika</label>
                <input
                  type="text"
                  value={priceImportName}
                  onChange={(e) => setPriceImportName(e.target.value)}
                  placeholder=""
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">Źródło cennika</label>
                <select
                  value={priceImportSource}
                  onChange={(e) => setPriceImportSource(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                >
                  {allPriceSources.map(ps => (
                    <option key={ps.id} value={ps.id}>{ps.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="p-4 border-t border-gray-200 flex justify-end">
              <button
                onClick={() => {
                  if (priceImportFile) {
                    showNotificationMessage('Importowanie cennika...', 'success');
                    setShowPriceImportModal(false);
                    setPriceImportFile(null);
                    setPriceImportName('');
                  }
                }}
                disabled={!priceImportFile}
                className={`px-4 py-2 rounded-lg ${
                  priceImportFile
                    ? 'bg-orange-500 text-white hover:bg-orange-600'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Price List Creation Modal */}
      {showCustomPriceListModal && (
        <div className="fixed inset-0 z-[70] overflow-y-auto bg-gray-500/75 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-5xl w-full shadow-xl max-h-[90vh] flex flex-col">
            {/* Header with editable name */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setShowCustomPriceListModal(false); setCustomPriceList(initialCustomPriceList); setEditingPriceSourceId(null); }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                {customPriceListEditingName ? (
                  <input
                    type="text"
                    value={customPriceList.name}
                    onChange={(e) => setCustomPriceList(prev => ({ ...prev, name: e.target.value }))}
                    onBlur={() => setCustomPriceListEditingName(false)}
                    onKeyDown={(e) => { if (e.key === 'Enter') setCustomPriceListEditingName(false); }}
                    autoFocus
                    className="text-lg font-bold text-gray-900 border border-blue-400 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                ) : (
                  <h2
                    onClick={() => setCustomPriceListEditingName(true)}
                    className="text-lg font-bold text-gray-900 cursor-pointer hover:bg-blue-50 px-2 py-1 rounded"
                  >
                    {customPriceList.name}
                    <SquarePen className="w-3.5 h-3.5 inline ml-2 text-gray-400" />
                  </h2>
                )}
              </div>
              <button onClick={() => { setShowCustomPriceListModal(false); setCustomPriceList(initialCustomPriceList); setEditingPriceSourceId(null); }} className="text-gray-400 hover:text-gray-600">
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-200">
              {([
                { key: 'robocizna' as CustomPriceListTab, label: 'Robocizna' },
                { key: 'materialy' as CustomPriceListTab, label: 'Materiał' },
                { key: 'sprzet' as CustomPriceListTab, label: 'Sprzęt' },
              ]).map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setCustomPriceListTab(tab.key)}
                  className={`px-4 py-2 text-sm font-medium ${
                    customPriceListTab === tab.key
                      ? 'text-blue-600 border-b-2 border-blue-600'
                      : 'text-gray-500 hover:text-gray-800'
                  }`}
                >
                  {tab.label}
                  {customPriceList.items[tab.key].filter(i => i.isActive).length > 0 && (
                    <span className="ml-1.5 text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">
                      {customPriceList.items[tab.key].filter(i => i.isActive).length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Auto-index checkbox */}
            <div className="px-4 pt-3 pb-1 flex items-center gap-2">
              <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={customPriceList.items[customPriceListTab].every(i => i.autoIndex)}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setCustomPriceList(prev => ({
                      ...prev,
                      items: {
                        ...prev.items,
                        [customPriceListTab]: prev.items[customPriceListTab].map(item => ({
                          ...item,
                          autoIndex: checked,
                        })),
                      },
                    }));
                  }}
                  className="w-3 h-3 rounded border-gray-300"
                />
                Automatycznie generuj indeks
              </label>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto px-4 pb-2">
              <table className="w-full text-sm border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-gray-50 text-left">
                    <th className="px-2 py-2 border border-gray-200 w-12 text-center">Nr</th>
                    <th className="px-2 py-2 border border-gray-200 w-32">Indeks</th>
                    <th className="px-2 py-2 border border-gray-200 min-w-[200px]">Nazwa</th>
                    <th className="px-2 py-2 border border-gray-200 w-32">Kategoria</th>
                    <th className="px-2 py-2 border border-gray-200 w-24">Jedn. miary</th>
                    <th className="px-2 py-2 border border-gray-200 w-28">Cena netto</th>
                    <th className="px-2 py-2 border border-gray-200 w-36">Komentarz</th>
                    <th className="px-2 py-2 border border-gray-200 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {customPriceList.items[customPriceListTab].map((item, index) => (
                    <tr
                      key={item.id}
                      className={`${item.isActive ? 'bg-white' : 'bg-gray-50/50'} hover:bg-blue-50/30 transition-colors`}
                    >
                      <td className="px-2 py-1 border border-gray-200 text-center text-gray-400 text-xs">
                        {item.isActive ? index + 1 : ''}
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        {item.autoIndex ? (
                          <span className="text-xs text-gray-400 italic px-1">
                            {item.isActive ? item.rms_index : 'auto'}
                          </span>
                        ) : (
                          <EditableCell
                            value={item.rms_index}
                            onSave={(v) => handleCustomPriceListItemUpdate(customPriceListTab, item.id, 'rms_index', String(v))}
                            placeholder="Indeks..."
                            className="text-xs"
                          />
                        )}
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <EditableCell
                          value={item.name}
                          onSave={(v) => handleCustomPriceListItemUpdate(customPriceListTab, item.id, 'name', String(v))}
                          placeholder="Nazwa pozycji..."
                          className="text-sm"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <EditableCell
                          value={item.category}
                          onSave={(v) => handleCustomPriceListItemUpdate(customPriceListTab, item.id, 'category', String(v))}
                          placeholder="Kategoria..."
                          className="text-xs"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <select
                          value={UNITS_REFERENCE.some(u => u.unit === item.unit) ? item.unit : (item.unit ? '__custom__' : '')}
                          onChange={(e) => {
                            if (e.target.value === '__add_new__') {
                              const newUnit = prompt('Podaj nową jednostkę miary:');
                              if (newUnit && newUnit.trim()) {
                                handleCustomPriceListItemUpdate(customPriceListTab, item.id, 'unit', newUnit.trim());
                              }
                            } else {
                              handleCustomPriceListItemUpdate(customPriceListTab, item.id, 'unit', e.target.value);
                            }
                          }}
                          className="w-full px-1 py-0.5 text-xs border-0 bg-transparent cursor-pointer focus:ring-1 focus:ring-blue-500 rounded"
                        >
                          <option value="">jm</option>
                          {UNITS_REFERENCE.map(u => (
                            <option key={u.index} value={u.unit}>{u.unit}</option>
                          ))}
                          {item.unit && !UNITS_REFERENCE.some(u => u.unit === item.unit) && (
                            <option value="__custom__">{item.unit}</option>
                          )}
                          <option value="__add_new__">+ Dodaj...</option>
                        </select>
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <EditableCell
                          value={item.price}
                          type="number"
                          onSave={(v) => handleCustomPriceListItemUpdate(customPriceListTab, item.id, 'price', Number(v))}
                          placeholder="0,00"
                          suffix=" zł"
                          className="text-xs"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200">
                        <EditableCell
                          value={item.comment}
                          onSave={(v) => handleCustomPriceListItemUpdate(customPriceListTab, item.id, 'comment', String(v))}
                          placeholder=""
                          className="text-xs"
                        />
                      </td>
                      <td className="px-1 py-1 border border-gray-200 text-center">
                        {item.isActive && (
                          <button
                            onClick={() => handleDeletePriceListItem(customPriceListTab, item.id)}
                            className="text-gray-400 hover:text-red-500 transition-colors"
                            title="Usuń"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-gray-200 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="text-xs text-gray-500">
                  R: {customPriceList.items.robocizna.filter(i => i.isActive).length} | M: {customPriceList.items.materialy.filter(i => i.isActive).length} | S: {customPriceList.items.sprzet.filter(i => i.isActive).length}
                </div>
                {editingPriceSourceId && (
                  <button
                    onClick={() => { setDeletingPriceSourceId(editingPriceSourceId); setDeletingPriceSourceName(customPriceList.name); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Usuń cennik
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => { setShowCustomPriceListModal(false); setCustomPriceList(initialCustomPriceList); setEditingPriceSourceId(null); }}
                  className="px-4 py-2 text-gray-800 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Anuluj
                </button>
                <button
                  onClick={handleSaveCustomPriceList}
                  disabled={customPriceListSaving}
                  className={`px-4 py-2 rounded-lg flex items-center gap-2 ${
                    customPriceListSaving
                      ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  {customPriceListSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                  Zapisz cennik
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Kartoteka Price List Read-Only Modal */}
      {showKartotekaPriceListModal && (
        <div className="fixed inset-0 z-[70] overflow-y-auto bg-gray-500/75 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-4xl w-full shadow-xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <FolderOpen className="w-5 h-5 text-blue-500" />
                <h2 className="text-lg font-bold text-gray-900">Cennik z Kartoteki</h2>
              </div>
              <button onClick={() => setShowKartotekaPriceListModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="flex border-b border-gray-200">
              {(['robocizna', 'materialy', 'sprzet'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setKartotekaPriceListTab(tab)}
                  className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                    kartotekaPriceListTab === tab
                      ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50'
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {tab === 'robocizna' ? 'Robocizna' : tab === 'materialy' ? 'Materiały' : 'Sprzęt'}
                  <span className="ml-1.5 text-xs text-gray-400">({kartotekaPriceListData[tab].length})</span>
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-auto p-4">
              {kartotekaPriceListLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                </div>
              ) : kartotekaPriceListData[kartotekaPriceListTab].length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <Package className="w-10 h-10 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Brak pozycji w tej kategorii</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 w-10">Nr</th>
                      <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 w-28">Indeks</th>
                      <th className="text-left py-2 px-2 text-xs font-medium text-gray-500">Nazwa</th>
                      <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 w-28">Kategoria</th>
                      <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 w-20">Jedn. miary</th>
                      <th className="text-right py-2 px-2 text-xs font-medium text-gray-500 w-24">Cena netto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kartotekaPriceListData[kartotekaPriceListTab].map((item, idx) => (
                      <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-1.5 px-2 text-xs text-gray-400">{idx + 1}</td>
                        <td className="py-1.5 px-2 text-xs font-mono text-gray-700">{item.code}</td>
                        <td className="py-1.5 px-2 text-xs text-gray-800">{item.name}</td>
                        <td className="py-1.5 px-2 text-xs text-gray-500">{item.category}</td>
                        <td className="py-1.5 px-2 text-xs text-gray-500">{item.unit}</td>
                        <td className="py-1.5 px-2 text-xs text-right font-medium text-gray-800">{item.price.toFixed(2)} zł</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="p-4 border-t border-gray-200 flex items-center justify-between">
              <div className="text-xs text-gray-500">
                R: {kartotekaPriceListData.robocizna.length} | M: {kartotekaPriceListData.materialy.length} | S: {kartotekaPriceListData.sprzet.length}
              </div>
              <button
                onClick={() => setShowKartotekaPriceListModal(false)}
                className="px-4 py-2 text-gray-800 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Zamknij
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Price Source Confirmation Modal */}
      {deletingPriceSourceId && (
        <div className="fixed inset-0 z-[80] overflow-y-auto bg-gray-500/75 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-sm w-full shadow-xl">
            <div className="p-6 text-center">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
                <Trash2 className="w-6 h-6 text-red-600" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">Usuń cennik</h3>
              <p className="text-sm text-gray-600 mb-6">
                Czy na pewno chcesz usunąć cennik <strong>"{deletingPriceSourceName}"</strong>? Ta operacja jest nieodwracalna.
              </p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => { setDeletingPriceSourceId(null); setDeletingPriceSourceName(''); }}
                  className="px-4 py-2 text-gray-800 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Anuluj
                </button>
                <button
                  onClick={() => handleDeletePriceSource(deletingPriceSourceId)}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                >
                  Usuń
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* KNR Catalog Import Modal */}
      {showKatalogImportModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-gray-500/75 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full shadow-xl">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">Wczytaj inne normatywy</h2>
              <button onClick={() => setShowKatalogImportModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <p className="text-sm text-gray-600">Dodaj własny katalog (CSV)</p>

              {/* Drag and drop area */}
              <div
                onDragOver={(e) => { e.preventDefault(); setKatalogImportDragging(true); }}
                onDragLeave={() => setKatalogImportDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setKatalogImportDragging(false);
                  const files = e.dataTransfer.files;
                  if (files.length > 0) {
                    setKatalogImportFile(files[0]);
                  }
                }}
                className={`border-2 border-dashed rounded-lg p-8 text-center ${
                  katalogImportDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300'
                }`}
              >
                <FileSpreadsheet className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                <p className="text-sm text-gray-600 mb-3">
                  Przeciągnij i upuść plik csv, aby go przesłać.
                </p>
                <label className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer inline-block">
                  Wybierz z plików
                  <input
                    type="file"
                    accept=".csv,.xlsx"
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) {
                        setKatalogImportFile(e.target.files[0]);
                      }
                    }}
                    className="hidden"
                  />
                </label>
                {katalogImportFile && (
                  <p className="text-sm text-green-600 mt-2">Wybrano: {katalogImportFile.name}</p>
                )}
              </div>

              <div>
                <label className="block text-sm text-gray-800 mb-1">Nazwa katalogu *</label>
                <input
                  type="text"
                  value={katalogImportName}
                  onChange={(e) => setKatalogImportName(e.target.value)}
                  placeholder="Wprowadź nazwę katalogu"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  required
                />
              </div>

              <div>
                <label className="block text-sm text-gray-800 mb-1">Baza katalogu *</label>
                <input
                  type="text"
                  value={katalogImportBase}
                  onChange={(e) => setKatalogImportBase(e.target.value)}
                  placeholder="Wprowadź bazę katalogu"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  required
                />
              </div>
            </div>
            <div className="p-4 border-t border-gray-200 flex justify-between">
              <button
                onClick={() => setShowKatalogImportModal(false)}
                className="px-4 py-2 text-gray-800 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Anuluj
              </button>
              <button
                onClick={() => {
                  if (katalogImportFile && katalogImportName && katalogImportBase) {
                    showNotificationMessage('Importowanie katalogu...', 'success');
                    setShowKatalogImportModal(false);
                    setKatalogImportFile(null);
                    setKatalogImportName('');
                    setKatalogImportBase('');
                  }
                }}
                disabled={!katalogImportFile || !katalogImportName || !katalogImportBase}
                className={`px-4 py-2 rounded-lg ${
                  katalogImportFile && katalogImportName && katalogImportBase
                    ? 'bg-orange-500 text-white hover:bg-orange-600'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Exit Confirmation Modal */}
      {/* Offer exists modal */}
      {/* Offer exists modal */}
      {showOfferExistsModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 px-6 py-5 border-b border-blue-100">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
                    <ReceiptText className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-gray-900">Oferta już istnieje</h2>
                    <p className="text-sm text-gray-500">Wybierz co chcesz zrobić</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowOfferExistsModal(false)}
                  className="p-1.5 hover:bg-white/60 rounded-lg text-gray-400 hover:text-gray-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-6">
              {/* Existing offer info card */}
              <div className="bg-slate-50 rounded-xl p-4 mb-6 border border-slate-200">
                <p className="text-xs text-slate-500 mb-1">Istniejąca oferta</p>
                <p className="text-sm font-semibold text-slate-800">{existingOfferName}</p>
              </div>

              {/* Action buttons */}
              <div className="space-y-3">
                <button
                  onClick={async () => {
                    setShowOfferExistsModal(false);
                    await createNewOfferFromEstimate();
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors group"
                >
                  <div className="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center group-hover:bg-blue-400">
                    <Plus className="w-4 h-4" />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-semibold">Utwórz nową ofertę</p>
                    <p className="text-xs text-blue-200">Niezależna oferta z aktualnymi danymi</p>
                  </div>
                </button>

                <button
                  onClick={() => {
                    setShowOfferExistsModal(false);
                    navigate(`/construction/offers?offerId=${existingOfferId}`);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3.5 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors group"
                >
                  <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center group-hover:bg-slate-200">
                    <ArrowUpRight className="w-4 h-4 text-slate-600" />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-semibold text-slate-800">Przejdź do istniejącej oferty</p>
                    <p className="text-xs text-slate-500">Otwórz bez zmian</p>
                  </div>
                </button>

                <button
                  onClick={() => setShowOfferUpdateConfirm(true)}
                  className="w-full flex items-center gap-3 px-4 py-3.5 bg-white border border-orange-200 rounded-xl hover:bg-orange-50 transition-colors group"
                >
                  <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center group-hover:bg-orange-200">
                    <RefreshCw className="w-4 h-4 text-orange-600" />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-semibold text-orange-700">Aktualizuj istniejącą ofertę</p>
                    <p className="text-xs text-orange-500">Zastąp danymi z kosztorysu</p>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Offer update confirmation modal */}
      {showOfferUpdateConfirm && (
        <div className="fixed inset-0 z-[60] overflow-y-auto bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-red-50 to-orange-50 px-6 py-5 border-b border-red-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center">
                  <AlertCircle className="w-5 h-5 text-red-600" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-red-700">Potwierdzenie aktualizacji</h2>
                  <p className="text-sm text-red-500">Ta operacja jest nieodwracalna</p>
                </div>
              </div>
            </div>
            <div className="p-6">
              <p className="text-sm text-gray-600 mb-6">
                Wszystkie sekcje i pozycje z poprzedniej oferty zostaną <span className="font-semibold text-red-600">trwale usunięte</span> i zastąpione aktualnymi danymi z kosztorysu.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowOfferUpdateConfirm(false)}
                  className="px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-100 rounded-xl border border-gray-200"
                >
                  Anuluj
                </button>
                <button
                  onClick={updateExistingOfferFromEstimate}
                  className="px-4 py-2.5 text-sm bg-red-600 text-white rounded-xl hover:bg-red-700 font-medium"
                >
                  Tak, aktualizuj ofertę
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Gantt exists modal */}
      {showGanttExistsModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-orange-50 to-amber-50 px-6 py-5 border-b border-orange-100">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center">
                    <CalendarClock className="w-5 h-5 text-orange-600" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-gray-900">Harmonogram już istnieje</h2>
                    <p className="text-sm text-gray-500">Wybierz co chcesz zrobić</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowGanttExistsModal(false)}
                  className="p-1.5 hover:bg-white/60 rounded-lg text-gray-400 hover:text-gray-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-6">
              {/* Existing project info card */}
              <div className="bg-slate-50 rounded-xl p-4 mb-6 border border-slate-200">
                <p className="text-xs text-slate-500 mb-1">Istniejący harmonogram</p>
                <p className="text-sm font-semibold text-slate-800">{existingProjectName}</p>
              </div>

              {/* Action buttons */}
              <div className="space-y-3">
                <button
                  onClick={async () => {
                    setShowGanttExistsModal(false);
                    await createNewGanttFromEstimate();
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors group"
                >
                  <div className="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center group-hover:bg-blue-400">
                    <Plus className="w-4 h-4" />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-semibold">Utwórz nowy harmonogram</p>
                    <p className="text-xs text-blue-200">Niezależny harmonogram z aktualnymi danymi</p>
                  </div>
                </button>

                <button
                  onClick={() => {
                    setShowGanttExistsModal(false);
                    navigate(`/construction/gantt?projectId=${existingProjectId}`);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3.5 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors group"
                >
                  <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center group-hover:bg-slate-200">
                    <ArrowUpRight className="w-4 h-4 text-slate-600" />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-semibold text-slate-800">Przejdź do istniejącego</p>
                    <p className="text-xs text-slate-500">Otwórz bez zmian</p>
                  </div>
                </button>

                <button
                  onClick={() => setShowGanttUpdateConfirm(true)}
                  className="w-full flex items-center gap-3 px-4 py-3.5 bg-white border border-orange-200 rounded-xl hover:bg-orange-50 transition-colors group"
                >
                  <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center group-hover:bg-orange-200">
                    <RefreshCw className="w-4 h-4 text-orange-600" />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-semibold text-orange-700">Aktualizuj istniejący</p>
                    <p className="text-xs text-orange-500">Zastąp danymi z kosztorysu</p>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Gantt update confirmation modal */}
      {showGanttUpdateConfirm && (
        <div className="fixed inset-0 z-[60] overflow-y-auto bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-red-50 to-orange-50 px-6 py-5 border-b border-red-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center">
                  <AlertCircle className="w-5 h-5 text-red-600" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-red-700">Potwierdzenie aktualizacji</h2>
                  <p className="text-sm text-red-500">Ta operacja jest nieodwracalna</p>
                </div>
              </div>
            </div>
            <div className="p-6">
              <p className="text-sm text-gray-600 mb-6">
                Wszystkie zadania i zależności z istniejącego harmonogramu zostaną <span className="font-semibold text-red-600">trwale usunięte</span> i zastąpione aktualnymi danymi z kosztorysu.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowGanttUpdateConfirm(false)}
                  className="px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-100 rounded-xl border border-gray-200"
                >
                  Anuluj
                </button>
                <button
                  onClick={updateExistingGanttFromEstimate}
                  className="px-4 py-2.5 text-sm bg-red-600 text-white rounded-xl hover:bg-red-700 font-medium"
                >
                  Tak, aktualizuj harmonogram
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showExitConfirmModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-gray-500/75 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full shadow-xl">
            <div className="p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4">Zapisz przed wyjściem?</h2>
              <p className="text-sm text-gray-600 mb-6">
                Masz niezapisane zmiany. Co chcesz zrobić?
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => {
                    setShowExitConfirmModal(false);
                    navigate('/construction/estimates');
                  }}
                  className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg border border-gray-300"
                >
                  Nie zapisuj
                </button>
                <button
                  onClick={async () => {
                    await handleSave();
                    setShowExitConfirmModal(false);
                    navigate('/construction/estimates');
                  }}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Zapisz i wyjdź
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Print Dialog - matching eKosztorysowanie */}
      {showPrintDialog && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-gray-500/75 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-5xl w-full shadow-xl flex max-h-[90vh]">
            {/* Preview section */}
            <div className="flex-1 bg-gray-100 p-4 flex flex-col">
              <div className="flex-1 bg-white rounded-lg shadow-inner overflow-auto flex items-center justify-center">
                <div className="w-[595px] h-[842px] bg-white shadow-lg p-8 text-xs">
                  {/* Preview header */}
                  <div className="flex justify-between text-[8px] text-gray-500 mb-4">
                    <span>{new Date().toLocaleDateString('pl-PL')}</span>
                    <span>{titlePageData.title || estimate?.settings.name || ''}</span>
                  </div>

                  {/* Preview content */}
                  <h1 className="text-lg font-bold text-center mb-4">Kosztorys</h1>
                  <h2 className="text-sm font-medium text-center mb-6">Tabela elementów scalonych</h2>

                  <table className="w-full text-[8px] border-collapse border border-gray-300">
                    <thead>
                      <tr className="bg-gray-100">
                        <th className="border border-gray-300 px-1 py-0.5">Lp</th>
                        <th className="border border-gray-300 px-1 py-0.5">Nazwa</th>
                        <th className="border border-gray-300 px-1 py-0.5">Robocizna</th>
                        <th className="border border-gray-300 px-1 py-0.5">Materiały</th>
                        <th className="border border-gray-300 px-1 py-0.5">Sprzęt</th>
                        <th className="border border-gray-300 px-1 py-0.5">Razem</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.values(estimateData.sections).slice(0, 5).map((section, index) => (
                        <tr key={section.id}>
                          <td className="border border-gray-300 px-1 py-0.5 text-center">{index + 1}</td>
                          <td className="border border-gray-300 px-1 py-0.5">{section.name}</td>
                          <td className="border border-gray-300 px-1 py-0.5 text-right">
                            {formatNumber(calculationResult?.sections[section.id]?.laborTotal || 0)}
                          </td>
                          <td className="border border-gray-300 px-1 py-0.5 text-right">
                            {formatNumber(calculationResult?.sections[section.id]?.materialTotal || 0)}
                          </td>
                          <td className="border border-gray-300 px-1 py-0.5 text-right">
                            {formatNumber(calculationResult?.sections[section.id]?.equipmentTotal || 0)}
                          </td>
                          <td className="border border-gray-300 px-1 py-0.5 text-right font-medium">
                            {formatNumber(calculationResult?.sections[section.id]?.totalValue || 0)}
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-gray-100 font-medium">
                        <td colSpan={2} className="border border-gray-300 px-1 py-0.5 text-right">Razem netto:</td>
                        <td colSpan={4} className="border border-gray-300 px-1 py-0.5 text-right">
                          {formatCurrency(calculationResult?.totalValue || 0)}
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <p className="mt-4 text-[8px]">
                    Słownie: {calculationResult?.totalValue ? `${Math.floor(calculationResult.totalValue)} i ${Math.round((calculationResult.totalValue % 1) * 100)}/100 PLN` : '0 PLN'}
                  </p>
                </div>
              </div>

              {/* Page navigation */}
              <div className="flex items-center justify-center gap-2 mt-4">
                <button
                  onClick={() => setPrintPreviewPage(prev => Math.max(1, prev - 1))}
                  disabled={printPreviewPage === 1}
                  className="p-1 hover:bg-gray-200 rounded disabled:opacity-40"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <span className="text-sm text-gray-600">{printPreviewPage}</span>
                <button
                  onClick={() => setPrintPreviewPage(prev => Math.min(printTotalPages, prev + 1))}
                  disabled={printPreviewPage === printTotalPages}
                  className="p-1 hover:bg-gray-200 rounded disabled:opacity-40"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Settings section */}
            <div className="w-80 border-l border-gray-200 p-4 flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-gray-900">Drukuj</h2>
                <button onClick={() => setShowPrintDialog(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <p className="text-sm text-gray-500 mb-2">{printTotalPages} stron</p>

              <div className="space-y-4 flex-1">
                {/* Printer */}
                <div>
                  <label className="block text-sm font-medium text-gray-800 mb-1">Drukarka</label>
                  <select className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                    <option>Microsoft Print to PDF</option>
                    <option>RICOH MP C2503</option>
                  </select>
                </div>

                {/* Pages */}
                <div>
                  <label className="block text-sm font-medium text-gray-800 mb-1">Strony</label>
                  <select
                    value={printSettings.pages}
                    onChange={(e) => setPrintSettings(prev => ({ ...prev, pages: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  >
                    <option value="all">Wszystkie</option>
                    <option value="current">Bieżąca</option>
                    <option value="range">Zakres</option>
                  </select>
                </div>

                {/* Copies */}
                <div>
                  <label className="block text-sm font-medium text-gray-800 mb-1">Kopie</label>
                  <input
                    type="number"
                    min="1"
                    max="999"
                    value={printSettings.copies}
                    onChange={(e) => setPrintSettings(prev => ({ ...prev, copies: parseInt(e.target.value) || 1 }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>

                {/* Orientation */}
                <div>
                  <label className="block text-sm font-medium text-gray-800 mb-1">Orientacja</label>
                  <select
                    value={printSettings.orientation}
                    onChange={(e) => setPrintSettings(prev => ({ ...prev, orientation: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  >
                    <option value="portrait">Pionowa</option>
                    <option value="landscape">Pozioma</option>
                  </select>
                </div>

                {/* Color */}
                <div>
                  <label className="block text-sm font-medium text-gray-800 mb-1">Kolor</label>
                  <select
                    value={printSettings.color ? 'color' : 'bw'}
                    onChange={(e) => setPrintSettings(prev => ({ ...prev, color: e.target.value === 'color' }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  >
                    <option value="color">Kolorowy</option>
                    <option value="bw">Czarno-biały</option>
                  </select>
                </div>

                {/* Dodatkowe ustawienia - matching eKosztorysowanie */}
                <div className="border-t border-gray-200 pt-3 mt-3">
                  <button
                    className="w-full flex items-center justify-between text-sm text-gray-600 hover:text-gray-800"
                    onClick={() => {/* Toggle advanced settings */}}
                  >
                    <span>Dodatkowe ustawienia</span>
                    <ChevronDown className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2 mt-4 pt-4 border-t border-gray-200">
                <button
                  onClick={() => setShowPrintDialog(false)}
                  className="flex-1 px-4 py-2 text-gray-800 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Anuluj
                </button>
                <button
                  onClick={() => {
                    window.print();
                    setShowPrintDialog(false);
                  }}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Drukuj
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Search Material Modal */}
      {showSearchMaterialModal && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center pt-8 pb-8 px-4 overflow-y-auto bg-black/40 backdrop-blur-sm" onClick={() => setShowSearchMaterialModal(false)}>
          <div className="bg-white rounded-xl max-w-5xl w-full shadow-2xl overflow-hidden max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 flex-shrink-0">
              <h2 className="text-base font-semibold text-slate-900">Szukaj Materiał</h2>
              <button onClick={() => setShowSearchMaterialModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Sub-tabs */}
            <div className="flex border-b border-slate-200 px-5 flex-shrink-0">
              <button
                onClick={() => setSearchMaterialSubTab('own')}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  searchMaterialSubTab === 'own'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                Własny katalog
              </button>
              {searchMaterialIntegrations.some(i => i.wholesaler_id === 'oninen') && (
                <button
                  onClick={() => setSearchMaterialSubTab('onninen')}
                  className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                    searchMaterialSubTab === 'onninen'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Onninen
                </button>
              )}
              {searchMaterialIntegrations.some(i => i.wholesaler_id === 'tim') && (
                <button
                  onClick={() => setSearchMaterialSubTab('tim')}
                  className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                    searchMaterialSubTab === 'tim'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  TIM
                </button>
              )}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-hidden">
              {searchMaterialSubTab === 'own' && (() => {
                const getMatCatChildren = (parentId: string | null) => searchMatCategories.filter(c => (c.parent_id || null) === parentId);
                const getMatCatSubtreeNames = (catName: string): string[] => {
                  const cat = searchMatCategories.find(c => c.name === catName);
                  if (!cat) return [catName];
                  return [catName, ...searchMatCategories.filter(c => c.parent_id === cat.id).flatMap(ch => getMatCatSubtreeNames(ch.name))];
                };
                const getMatCatCount = (catName: string): number => {
                  const cat = searchMatCategories.find(c => c.name === catName);
                  if (!cat) return 0;
                  return searchMaterialOwnData.filter(m => m.category === catName).length + searchMatCategories.filter(c => c.parent_id === cat.id).reduce((s, ch) => s + getMatCatCount(ch.name), 0);
                };
                const filtered = searchMaterialOwnData.filter(m => {
                  const matchesSearch = !searchMaterialSearch || m.code?.toLowerCase().includes(searchMaterialSearch.toLowerCase()) || m.name?.toLowerCase().includes(searchMaterialSearch.toLowerCase()) || m.ean?.toLowerCase().includes(searchMaterialSearch.toLowerCase()) || m.sku?.toLowerCase().includes(searchMaterialSearch.toLowerCase()) || m.manufacturer?.toLowerCase().includes(searchMaterialSearch.toLowerCase());
                  let matchesCat = true;
                  if (searchMatSelectedCategory === '__none__') matchesCat = !m.category;
                  else if (searchMatSelectedCategory) matchesCat = getMatCatSubtreeNames(searchMatSelectedCategory).includes(m.category || '');
                  return matchesSearch && matchesCat;
                });
                const renderMatCatNode = (cat: typeof searchMatCategories[0], depth: number): React.ReactNode => {
                  const children = getMatCatChildren(cat.id);
                  const hasChildren = children.length > 0;
                  const isExpanded = searchMatExpandedCats.has(cat.id);
                  return (
                    <div key={cat.id}>
                      <div className="flex items-center" style={{ paddingLeft: depth * 14 }}>
                        <button
                          onClick={() => { setSearchMatSelectedCategory(cat.name); if (hasChildren) setSearchMatExpandedCats(prev => { const next = new Set(prev); if (next.has(cat.id)) next.delete(cat.id); else next.add(cat.id); return next; }); }}
                          className={`flex-1 text-left flex items-center gap-1 py-1.5 px-2 text-xs rounded transition-colors min-w-0 ${searchMatSelectedCategory === cat.name ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-600 hover:bg-slate-50'}`}
                        >
                          {hasChildren ? <ChevronRight className={`w-3 h-3 flex-shrink-0 opacity-40 transition-transform ${isExpanded ? 'rotate-90' : ''}`} /> : <span className="w-3 flex-shrink-0" />}
                          <Package className="w-3.5 h-3.5 opacity-40 flex-shrink-0" />
                          <span className="truncate">{cat.name}</span>
                          <span className="ml-auto text-[10px] text-slate-400 flex-shrink-0">{getMatCatCount(cat.name)}</span>
                        </button>
                      </div>
                      {isExpanded && hasChildren && children.map(child => renderMatCatNode(child, depth + 1))}
                    </div>
                  );
                };
                return (
                  <div className="flex h-full" style={{ height: 'calc(90vh - 120px)' }}>
                    {/* Category sidebar */}
                    <div className="w-52 flex-shrink-0 border-r border-slate-200 overflow-y-auto bg-slate-50">
                      <div className="px-3 py-2.5 border-b border-slate-200">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Kategorie</span>
                      </div>
                      <div className="py-1">
                        <button onClick={() => setSearchMatSelectedCategory(null)} className={`w-full text-left flex items-center gap-1.5 py-1.5 px-2.5 text-xs rounded transition-colors ${!searchMatSelectedCategory ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-600 hover:bg-slate-50'}`}>
                          <Package className="w-3.5 h-3.5 opacity-40" />
                          <span className="truncate">Wszystkie</span>
                          <span className="ml-auto text-[10px] text-slate-400">{searchMaterialOwnData.length}</span>
                        </button>
                        {getMatCatChildren(null).map(cat => renderMatCatNode(cat, 0))}
                        {searchMaterialOwnData.some(m => !m.category) && (
                          <button onClick={() => setSearchMatSelectedCategory('__none__')} className={`w-full text-left flex items-center gap-1.5 py-1.5 px-2.5 text-xs rounded transition-colors ${searchMatSelectedCategory === '__none__' ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-600 hover:bg-slate-50'}`}>
                            <Package className="w-3.5 h-3.5 opacity-40" />
                            <span className="truncate">Bez kategorii</span>
                            <span className="ml-auto text-[10px] text-slate-400">{searchMaterialOwnData.filter(m => !m.category).length}</span>
                          </button>
                        )}
                      </div>
                    </div>
                    {/* Main content */}
                    <div className="flex-1 flex flex-col overflow-hidden">
                      {/* Search bar + view toggle */}
                      <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-3 bg-white flex-shrink-0">
                        <div className="flex-1 max-w-md flex items-center bg-slate-100 rounded-lg px-3 border border-slate-200">
                          <Search className="w-4 h-4 text-slate-400" />
                          <input value={searchMaterialSearch} onChange={e => setSearchMaterialSearch(e.target.value)} placeholder="Szukaj materiałów..." className="flex-1 bg-transparent border-none px-2.5 py-2 text-sm outline-none text-slate-700 placeholder-slate-400" />
                          {searchMaterialSearch && <button onClick={() => setSearchMaterialSearch('')} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>}
                        </div>
                        <div className="flex gap-1 bg-slate-100 rounded p-0.5">
                          <button onClick={() => setSearchMatViewMode('grid')} className={`p-1.5 rounded transition-colors ${searchMatViewMode === 'grid' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'}`}><Grid3X3 className="w-4 h-4" /></button>
                          <button onClick={() => setSearchMatViewMode('list')} className={`p-1.5 rounded transition-colors ${searchMatViewMode === 'list' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'}`}><List className="w-4 h-4" /></button>
                        </div>
                        <span className="text-xs text-slate-400 whitespace-nowrap">{filtered.length} materiałów</span>
                      </div>
                      {/* Items */}
                      <div className="flex-1 overflow-y-auto p-4">
                        {filtered.length === 0 ? (
                          <div className="flex flex-col items-center justify-center h-full text-center">
                            <Package className="w-12 h-12 text-slate-200 mb-4" />
                            <p className="text-sm text-slate-400">{searchMaterialOwnData.length === 0 ? 'Brak materiałów w katalogu własnym.' : 'Brak wyników.'}</p>
                          </div>
                        ) : searchMatViewMode === 'grid' ? (
                          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                            {filtered.slice(0, 100).map(m => {
                              const imgs = (() => { try { return JSON.parse((m as any).images || '[]'); } catch { return []; } })();
                              return (
                                <div key={m.id} onClick={() => setSearchMatDetailItem(m)} className="bg-white rounded-lg border border-slate-200 overflow-hidden cursor-pointer hover:border-blue-400 hover:shadow-md transition-all">
                                  <div className="h-32 bg-slate-50 flex items-center justify-center border-b border-slate-100">
                                    {imgs.length > 0 ? <img src={imgs[0]} alt="" className="max-w-[85%] max-h-28 object-contain" /> : <Package className="w-10 h-10 text-slate-200" />}
                                  </div>
                                  <div className="p-2.5">
                                    <div className="text-[10px] text-slate-400 font-mono">{m.code}</div>
                                    <div className="text-xs font-medium text-slate-800 mt-0.5 line-clamp-2 min-h-[32px]">{m.name}</div>
                                    {m.manufacturer && <div className="text-[10px] text-slate-400 mt-0.5">{m.manufacturer}</div>}
                                    <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between">
                                      {((m as any).purchase_price || (m as any).default_price) ? (
                                        <span className="text-sm font-bold text-blue-600">{((m as any).purchase_price || (m as any).default_price)?.toFixed(2)} <span className="text-[10px] font-normal text-slate-400">zł</span></span>
                                      ) : <span className="text-[10px] text-slate-300">—</span>}
                                      <span className={`px-1.5 py-0.5 text-[10px] rounded ${m.is_active ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`}>{m.is_active ? 'Aktywny' : 'Nieaktywny'}</span>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {filtered.slice(0, 100).map(m => {
                              const imgs = (() => { try { return JSON.parse((m as any).images || '[]'); } catch { return []; } })();
                              return (
                                <div key={m.id} onClick={() => setSearchMatDetailItem(m)} className="bg-white rounded-lg border border-slate-200 p-2.5 flex items-center gap-3 cursor-pointer hover:border-blue-400 transition-colors">
                                  <div className="w-14 h-14 bg-slate-50 rounded flex items-center justify-center flex-shrink-0">
                                    {imgs.length > 0 ? <img src={imgs[0]} alt="" className="max-w-[90%] max-h-[90%] object-contain" /> : <Package className="w-6 h-6 text-slate-200" />}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="text-xs font-medium text-slate-800 truncate">{m.name}</div>
                                    <div className="text-[10px] text-slate-400 font-mono">{m.code}{m.manufacturer ? ` · ${m.manufacturer}` : ''}</div>
                                  </div>
                                  <div className="flex-shrink-0">
                                    <span className={`px-1.5 py-0.5 text-[10px] rounded ${m.is_active ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`}>{m.is_active ? 'Aktywny' : 'Nieaktywny'}</span>
                                  </div>
                                  <div className="flex-shrink-0 text-right">
                                    {((m as any).purchase_price || (m as any).default_price) ? (
                                      <span className="text-sm font-bold text-blue-600">{((m as any).purchase_price || (m as any).default_price)?.toFixed(2)} zł</span>
                                    ) : <span className="text-[10px] text-slate-300">—</span>}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {filtered.length > 100 && <div className="mt-3 text-xs text-slate-400 text-center">Wyświetlono 100 z {filtered.length} wyników. Użyj wyszukiwania, aby zawęzić.</div>}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Material Detail inside search modal */}
              {searchMatDetailItem && (() => {
                const dm = searchMatDetailItem as any;
                const imgs = (() => { try { return JSON.parse(dm.images || '[]'); } catch { return []; } })();
                return (
                  <div className="fixed inset-0 z-[70] flex items-start justify-center pt-8 pb-8 px-4 overflow-y-auto bg-black/40 backdrop-blur-sm" onClick={() => setSearchMatDetailItem(null)}>
                    <div className="bg-white rounded-xl max-w-3xl w-full shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
                      {/* Header */}
                      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
                        <span className="text-xs text-slate-400 font-mono">
                          {dm.code}{dm.ean ? ` · EAN: ${dm.ean}` : ''}{dm.sku ? ` · SKU: ${dm.sku}` : ''}{dm.ref_num ? ` · Ref: ${dm.ref_num}` : ''}
                        </span>
                        <button onClick={() => setSearchMatDetailItem(null)} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
                      </div>
                      <div className="flex flex-wrap">
                        <div className="w-64 min-h-[220px] bg-slate-50 flex items-center justify-center p-4">
                          {imgs.length > 0 ? <img src={imgs[0]} alt="" className="max-w-[90%] max-h-52 object-contain" /> : <Package className="w-14 h-14 text-slate-200" />}
                        </div>
                        <div className="flex-1 p-5 min-w-[260px]">
                          <h2 className="text-base font-semibold text-slate-900 mb-2 leading-tight">{dm.name}</h2>
                          {dm.manufacturer && <p className="text-xs text-slate-500">Producent: <span className="font-medium text-slate-700">{dm.manufacturer}</span></p>}
                          {dm.category && <p className="text-xs text-slate-400 mt-0.5">Kategoria: {dm.category}</p>}
                          <div className="mt-3 mb-3 p-3 bg-slate-50 rounded-lg border border-slate-100">
                            {(dm.purchase_price || dm.default_price) ? (
                              <>
                                <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Cena zakupu</div>
                                <div className="text-xl font-bold text-blue-600">
                                  {(dm.purchase_price || dm.default_price)?.toFixed(2)} <span className="text-sm font-normal">zł netto</span>
                                  {dm.catalog_price && dm.catalog_price > 0 && (dm.purchase_price || dm.default_price) < dm.catalog_price && (
                                    <span className="ml-2 text-sm font-semibold text-green-600">-{((dm.catalog_price - (dm.purchase_price || dm.default_price)) / dm.catalog_price * 100).toFixed(1)}%</span>
                                  )}
                                </div>
                                {dm.catalog_price != null && <div className="mt-1 text-xs text-slate-400">Cena katalogowa: <span className="line-through">{dm.catalog_price?.toFixed(2)} zł</span></div>}
                              </>
                            ) : <div className="text-xs text-slate-400">Cena niedostępna</div>}
                          </div>
                          <div className="flex flex-wrap gap-1.5 mb-3">
                            {dm.unit && <span className="px-2 py-0.5 bg-slate-100 rounded text-[10px] text-slate-600">Jedn.: <b>{dm.unit}</b></span>}
                            {dm.source_wholesaler && <span className="px-2 py-0.5 bg-slate-100 rounded text-[10px] text-slate-600">Źródło: <b>{dm.source_wholesaler === 'tim' ? 'TIM' : dm.source_wholesaler === 'oninen' ? 'Onninen' : dm.source_wholesaler}</b></span>}
                            <span className={`px-2 py-0.5 rounded text-[10px] ${dm.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>{dm.is_active ? 'Aktywny' : 'Nieaktywny'}</span>
                          </div>
                          <button
                            onClick={() => { handleApplyMaterialFromSearch({ name: dm.name, index: dm.code, price: dm.purchase_price || dm.default_price || null, sku: dm.sku, ean: dm.ean, ref_num: dm.ref_num }); setSearchMatDetailItem(null); }}
                            className="w-full py-2.5 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 transition-colors flex items-center justify-center gap-2"
                          >
                            <Plus className="w-4 h-4" />
                            Dodaj do kosztorysu
                          </button>
                        </div>
                      </div>
                      {/* Wholesaler price comparison table */}
                      {searchMaterialIntegrations.some(i => i.is_active) && (
                        <div className="px-5 pb-4">
                          <h4 className="text-xs font-semibold text-slate-600 mb-2">Ceny i dostępność w hurtowniach</h4>
                          <div className="border border-slate-200 rounded-lg overflow-hidden">
                            <table className="w-full text-xs">
                              <thead className="bg-slate-50">
                                <tr>
                                  <th className="px-3 py-2 text-left text-slate-500 font-medium">Hurtownia</th>
                                  <th className="px-3 py-2 text-left text-slate-500 font-medium">Produkt</th>
                                  <th className="px-3 py-2 text-right text-slate-500 font-medium">Cena katalogowa</th>
                                  <th className="px-3 py-2 text-right text-slate-500 font-medium">Cena zakupu</th>
                                  <th className="px-3 py-2 text-center text-slate-500 font-medium">Dostępność</th>
                                  <th className="px-3 py-2 w-10"></th>
                                </tr>
                              </thead>
                              <tbody>
                                {searchMatLoadingPrices ? (
                                  <tr>
                                    <td colSpan={6} className="px-3 py-4 text-center">
                                      <Loader2 className="w-4 h-4 animate-spin text-blue-600 mx-auto" />
                                    </td>
                                  </tr>
                                ) : searchMatWholesalerPrices.length === 0 ? (
                                  <tr>
                                    <td colSpan={6} className="px-3 py-4 text-center text-slate-400">
                                      Brak danych z hurtowni.
                                    </td>
                                  </tr>
                                ) : (
                                  searchMatWholesalerPrices.map((wp, idx) => {
                                    const prices = searchMatWholesalerPrices.filter(p => p.purchasePrice != null).map(p => p.purchasePrice!);
                                    const bestPrice = prices.length > 0 ? Math.min(...prices) : null;
                                    const worstPrice = prices.length > 1 ? Math.max(...prices) : null;
                                    const isBest = bestPrice != null && wp.purchasePrice === bestPrice && prices.length > 1;
                                    const isWorst = worstPrice != null && wp.purchasePrice === worstPrice && worstPrice !== bestPrice;
                                    return (
                                      <tr key={idx} className={`${isBest ? 'bg-green-50' : isWorst ? 'bg-red-50' : idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}`}>
                                        <td className="px-3 py-2 font-medium text-slate-700">{wp.wholesaler}</td>
                                        <td className="px-3 py-2 text-slate-600 max-w-[200px] truncate" title={wp.productName}>{wp.productName}</td>
                                        <td className="px-3 py-2 text-right text-slate-600">{wp.catalogPrice?.toFixed(2) ?? '—'} zł</td>
                                        <td className="px-3 py-2 text-right font-medium text-slate-800">{wp.purchasePrice?.toFixed(2) ?? '—'} zł</td>
                                        <td className="px-3 py-2 text-center">
                                          {wp.stock != null ? (
                                            <span className={`px-1.5 py-0.5 rounded ${wp.stock > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                                              {wp.stock > 0 ? `${wp.stock} szt.` : 'Brak'}
                                            </span>
                                          ) : '—'}
                                        </td>
                                        <td className="px-3 py-2">
                                          {wp.url && (
                                            <a href={wp.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-700">
                                              <ExternalLink className="w-3.5 h-3.5" />
                                            </a>
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  })
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {dm.description && (
                        <div className="px-5 pb-4">
                          <h4 className="text-xs font-semibold text-slate-600 mb-1.5">Opis</h4>
                          <div className="text-xs text-slate-500 leading-relaxed prose prose-xs max-w-none" dangerouslySetInnerHTML={{ __html: dm.description }} />
                        </div>
                      )}
                      {imgs.length > 1 && (
                        <div className="px-5 pb-4">
                          <h4 className="text-xs font-semibold text-slate-600 mb-2">Zdjęcia</h4>
                          <div className="flex gap-2 flex-wrap">
                            {imgs.map((img: string, i: number) => (
                              <div key={i} className="w-20 h-20 bg-slate-50 rounded border border-slate-200 flex items-center justify-center">
                                <img src={img} alt="" className="max-w-[90%] max-h-[90%] object-contain" />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {searchMaterialSubTab === 'onninen' && (
                <div className="p-0">
                  <OninenIntegrator
                    integrationId={searchMaterialIntegrations.find(i => i.wholesaler_id === 'oninen')?.id}
                    onSelectProduct={(p) => handleApplyMaterialFromSearch({ name: p.name, price: p.price, sku: p.sku, ean: p.ean, unit: p.unit })}
                  />
                </div>
              )}

              {searchMaterialSubTab === 'tim' && (
                <div className="p-0">
                  <TIMIntegrator
                    integrationId={searchMaterialIntegrations.find(i => i.wholesaler_id === 'tim')?.id}
                    onSelectProduct={(p) => handleApplyMaterialFromSearch({ name: p.name, price: p.price, sku: p.sku, ean: p.ean, unit: p.unit })}
                  />
                </div>
              )}

            </div>
          </div>
        </div>
      )}

      {/* Search Equipment Modal */}
      {showSearchEquipmentModal && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center pt-8 pb-8 px-4 overflow-y-auto bg-black/40 backdrop-blur-sm" onClick={() => setShowSearchEquipmentModal(false)}>
          <div className="bg-white rounded-xl max-w-5xl w-full shadow-2xl overflow-hidden max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 flex-shrink-0">
              <h2 className="text-base font-semibold text-slate-900">Szukaj Sprzęt</h2>
              <button onClick={() => setShowSearchEquipmentModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Sub-tabs */}
            <div className="flex border-b border-slate-200 px-5 flex-shrink-0">
              <button
                onClick={() => setSearchEquipmentSubTab('own')}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  searchEquipmentSubTab === 'own'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                Własny katalog
              </button>
              {searchEquipmentIntegrations.some(i => i.wholesaler_id === 'atut-rental') && (
                <button
                  onClick={() => setSearchEquipmentSubTab('atut-rental')}
                  className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                    searchEquipmentSubTab === 'atut-rental'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Atut Rental
                </button>
              )}
              {searchEquipmentIntegrations.some(i => i.wholesaler_id === 'ramirent') && (
                <button
                  onClick={() => setSearchEquipmentSubTab('ramirent')}
                  className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                    searchEquipmentSubTab === 'ramirent'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Ramirent
                </button>
              )}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-hidden">
              {searchEquipmentSubTab === 'own' && (() => {
                const getEqCatChildren = (parentId: string | null) => searchEqCategories.filter(c => (c.parent_id || null) === parentId);
                const getEqCatSubtreeNames = (catName: string): string[] => {
                  const cat = searchEqCategories.find(c => c.name === catName);
                  if (!cat) return [catName];
                  return [catName, ...searchEqCategories.filter(c => c.parent_id === cat.id).flatMap(ch => getEqCatSubtreeNames(ch.name))];
                };
                const getEqCatCount = (catName: string): number => {
                  const cat = searchEqCategories.find(c => c.name === catName);
                  if (!cat) return 0;
                  return searchEquipmentOwnData.filter(e => e.category === catName).length + searchEqCategories.filter(c => c.parent_id === cat.id).reduce((s, ch) => s + getEqCatCount(ch.name), 0);
                };
                const filtered = searchEquipmentOwnData.filter(eq => {
                  const matchesSearch = !searchEquipmentSearch || eq.code?.toLowerCase().includes(searchEquipmentSearch.toLowerCase()) || eq.name?.toLowerCase().includes(searchEquipmentSearch.toLowerCase()) || eq.ean?.toLowerCase().includes(searchEquipmentSearch.toLowerCase()) || eq.sku?.toLowerCase().includes(searchEquipmentSearch.toLowerCase()) || eq.manufacturer?.toLowerCase().includes(searchEquipmentSearch.toLowerCase());
                  let matchesCat = true;
                  if (searchEqSelectedCategory === '__none__') matchesCat = !eq.category;
                  else if (searchEqSelectedCategory) matchesCat = getEqCatSubtreeNames(searchEqSelectedCategory).includes(eq.category || '');
                  return matchesSearch && matchesCat;
                });
                const renderEqCatNode = (cat: typeof searchEqCategories[0], depth: number): React.ReactNode => {
                  const children = getEqCatChildren(cat.id);
                  const hasChildren = children.length > 0;
                  const isExpanded = searchEqExpandedCats.has(cat.id);
                  return (
                    <div key={cat.id}>
                      <div className="flex items-center" style={{ paddingLeft: depth * 14 }}>
                        <button
                          onClick={() => { setSearchEqSelectedCategory(cat.name); if (hasChildren) setSearchEqExpandedCats(prev => { const next = new Set(prev); if (next.has(cat.id)) next.delete(cat.id); else next.add(cat.id); return next; }); }}
                          className={`flex-1 text-left flex items-center gap-1 py-1.5 px-2 text-xs rounded transition-colors min-w-0 ${searchEqSelectedCategory === cat.name ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-600 hover:bg-slate-50'}`}
                        >
                          {hasChildren ? <ChevronRight className={`w-3 h-3 flex-shrink-0 opacity-40 transition-transform ${isExpanded ? 'rotate-90' : ''}`} /> : <span className="w-3 flex-shrink-0" />}
                          <Monitor className="w-3.5 h-3.5 opacity-40 flex-shrink-0" />
                          <span className="truncate">{cat.name}</span>
                          <span className="ml-auto text-[10px] text-slate-400 flex-shrink-0">{getEqCatCount(cat.name)}</span>
                        </button>
                      </div>
                      {isExpanded && hasChildren && children.map(child => renderEqCatNode(child, depth + 1))}
                    </div>
                  );
                };
                return (
                  <div className="flex h-full" style={{ height: 'calc(90vh - 120px)' }}>
                    {/* Category sidebar */}
                    <div className="w-52 flex-shrink-0 border-r border-slate-200 overflow-y-auto bg-slate-50">
                      <div className="px-3 py-2.5 border-b border-slate-200">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Kategorie</span>
                      </div>
                      <div className="py-1">
                        <button onClick={() => setSearchEqSelectedCategory(null)} className={`w-full text-left flex items-center gap-1.5 py-1.5 px-2.5 text-xs rounded transition-colors ${!searchEqSelectedCategory ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-600 hover:bg-slate-50'}`}>
                          <Monitor className="w-3.5 h-3.5 opacity-40" />
                          <span className="truncate">Wszystkie</span>
                          <span className="ml-auto text-[10px] text-slate-400">{searchEquipmentOwnData.length}</span>
                        </button>
                        {getEqCatChildren(null).map(cat => renderEqCatNode(cat, 0))}
                        {searchEquipmentOwnData.some(e => !e.category) && (
                          <button onClick={() => setSearchEqSelectedCategory('__none__')} className={`w-full text-left flex items-center gap-1.5 py-1.5 px-2.5 text-xs rounded transition-colors ${searchEqSelectedCategory === '__none__' ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-600 hover:bg-slate-50'}`}>
                            <Monitor className="w-3.5 h-3.5 opacity-40" />
                            <span className="truncate">Bez kategorii</span>
                            <span className="ml-auto text-[10px] text-slate-400">{searchEquipmentOwnData.filter(e => !e.category).length}</span>
                          </button>
                        )}
                      </div>
                    </div>
                    {/* Main content */}
                    <div className="flex-1 flex flex-col overflow-hidden">
                      {/* Search bar + view toggle */}
                      <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-3 bg-white flex-shrink-0">
                        <div className="flex-1 max-w-md flex items-center bg-slate-100 rounded-lg px-3 border border-slate-200">
                          <Search className="w-4 h-4 text-slate-400" />
                          <input value={searchEquipmentSearch} onChange={e => setSearchEquipmentSearch(e.target.value)} placeholder="Szukaj sprzętu..." className="flex-1 bg-transparent border-none px-2.5 py-2 text-sm outline-none text-slate-700 placeholder-slate-400" />
                          {searchEquipmentSearch && <button onClick={() => setSearchEquipmentSearch('')} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>}
                        </div>
                        <div className="flex gap-1 bg-slate-100 rounded p-0.5">
                          <button onClick={() => setSearchEqViewMode('grid')} className={`p-1.5 rounded transition-colors ${searchEqViewMode === 'grid' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'}`}><Grid3X3 className="w-4 h-4" /></button>
                          <button onClick={() => setSearchEqViewMode('list')} className={`p-1.5 rounded transition-colors ${searchEqViewMode === 'list' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'}`}><List className="w-4 h-4" /></button>
                        </div>
                        <span className="text-xs text-slate-400 whitespace-nowrap">{filtered.length} sprzętu</span>
                      </div>
                      {/* Items */}
                      <div className="flex-1 overflow-y-auto p-4">
                        {filtered.length === 0 ? (
                          <div className="flex flex-col items-center justify-center h-full text-center">
                            <Monitor className="w-12 h-12 text-slate-200 mb-4" />
                            <p className="text-sm text-slate-400">{searchEquipmentOwnData.length === 0 ? 'Brak sprzętu w katalogu własnym.' : 'Brak wyników.'}</p>
                          </div>
                        ) : searchEqViewMode === 'grid' ? (
                          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                            {filtered.slice(0, 100).map(eq => {
                              const imgs = (() => { try { return JSON.parse((eq as any).images || '[]'); } catch { return []; } })();
                              return (
                                <div key={eq.id} onClick={() => setSearchEqDetailItem(eq)} className="bg-white rounded-lg border border-slate-200 overflow-hidden cursor-pointer hover:border-blue-400 hover:shadow-md transition-all">
                                  <div className="h-32 bg-slate-50 flex items-center justify-center border-b border-slate-100">
                                    {imgs.length > 0 ? <img src={imgs[0]} alt="" className="max-w-[85%] max-h-28 object-contain" /> : <Monitor className="w-10 h-10 text-slate-200" />}
                                  </div>
                                  <div className="p-2.5">
                                    <div className="text-[10px] text-slate-400 font-mono">{eq.code}</div>
                                    <div className="text-xs font-medium text-slate-800 mt-0.5 line-clamp-2 min-h-[32px]">{eq.name}</div>
                                    {eq.manufacturer && <div className="text-[10px] text-slate-400 mt-0.5">{eq.manufacturer}</div>}
                                    <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between">
                                      {((eq as any).purchase_price || eq.default_price) ? (
                                        <span className="text-sm font-bold text-blue-600">{((eq as any).purchase_price || eq.default_price)?.toFixed(2)} <span className="text-[10px] font-normal text-slate-400">zł</span></span>
                                      ) : <span className="text-[10px] text-slate-300">—</span>}
                                      <span className={`px-1.5 py-0.5 text-[10px] rounded ${eq.is_active ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`}>{eq.is_active ? 'Aktywny' : 'Nieaktywny'}</span>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {filtered.slice(0, 100).map(eq => {
                              const imgs = (() => { try { return JSON.parse((eq as any).images || '[]'); } catch { return []; } })();
                              return (
                                <div key={eq.id} onClick={() => setSearchEqDetailItem(eq)} className="bg-white rounded-lg border border-slate-200 p-2.5 flex items-center gap-3 cursor-pointer hover:border-blue-400 transition-colors">
                                  <div className="w-14 h-14 bg-slate-50 rounded flex items-center justify-center flex-shrink-0">
                                    {imgs.length > 0 ? <img src={imgs[0]} alt="" className="max-w-[90%] max-h-[90%] object-contain" /> : <Monitor className="w-6 h-6 text-slate-200" />}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="text-xs font-medium text-slate-800 truncate">{eq.name}</div>
                                    <div className="text-[10px] text-slate-400 font-mono">{eq.code}{eq.manufacturer ? ` · ${eq.manufacturer}` : ''}</div>
                                  </div>
                                  <div className="flex-shrink-0">
                                    <span className={`px-1.5 py-0.5 text-[10px] rounded ${eq.is_active ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`}>{eq.is_active ? 'Aktywny' : 'Nieaktywny'}</span>
                                  </div>
                                  <div className="flex-shrink-0 text-right">
                                    {((eq as any).purchase_price || eq.default_price) ? (
                                      <span className="text-sm font-bold text-blue-600">{((eq as any).purchase_price || eq.default_price)?.toFixed(2)} zł</span>
                                    ) : <span className="text-[10px] text-slate-300">—</span>}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {filtered.length > 100 && <div className="mt-3 text-xs text-slate-400 text-center">Wyświetlono 100 z {filtered.length} wyników. Użyj wyszukiwania, aby zawęzić.</div>}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Equipment Detail inside search modal */}
              {searchEqDetailItem && (() => {
                const de = searchEqDetailItem as any;
                const imgs = (() => { try { return JSON.parse(de.images || '[]'); } catch { return []; } })();
                return (
                  <div className="fixed inset-0 z-[70] flex items-start justify-center pt-8 pb-8 px-4 overflow-y-auto bg-black/40 backdrop-blur-sm" onClick={() => setSearchEqDetailItem(null)}>
                    <div className="bg-white rounded-xl max-w-3xl w-full shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
                      {/* Header */}
                      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
                        <span className="text-xs text-slate-400 font-mono">
                          {de.code}{de.sku ? ` · SKU: ${de.sku}` : ''}{de.ean ? ` · EAN: ${de.ean}` : ''}
                        </span>
                        <button onClick={() => setSearchEqDetailItem(null)} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
                      </div>
                      <div className="flex flex-wrap">
                        <div className="w-64 min-h-[220px] bg-slate-50 flex items-center justify-center p-4">
                          {imgs.length > 0 ? <img src={imgs[0]} alt="" className="max-w-[90%] max-h-52 object-contain" /> : <Monitor className="w-14 h-14 text-slate-200" />}
                        </div>
                        <div className="flex-1 p-5 min-w-[260px]">
                          <h2 className="text-base font-semibold text-slate-900 mb-2 leading-tight">{de.name}</h2>
                          {de.manufacturer && <p className="text-xs text-slate-500">Producent: <span className="font-medium text-slate-700">{de.manufacturer}</span></p>}
                          {de.category && <p className="text-xs text-slate-400 mt-0.5">Kategoria: {de.category}</p>}
                          <div className="mt-3 mb-3 p-3 bg-slate-50 rounded-lg border border-slate-100">
                            {(de.purchase_price || de.default_price) ? (
                              <>
                                <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Cena wynajmu</div>
                                <div className="text-xl font-bold text-blue-600">
                                  {(de.purchase_price || de.default_price)?.toFixed(2)} <span className="text-sm font-normal">zł netto</span>
                                </div>
                                {de.catalog_price != null && <div className="mt-1 text-xs text-slate-400">Cena brutto: {de.catalog_price?.toFixed(2)} zł</div>}
                              </>
                            ) : <div className="text-xs text-slate-400">Cena niedostępna</div>}
                          </div>
                          <div className="flex flex-wrap gap-1.5 mb-3">
                            {de.unit && <span className="px-2 py-0.5 bg-slate-100 rounded text-[10px] text-slate-600">Jedn.: <b>{de.unit}</b></span>}
                            {de.source_wholesaler && <span className="px-2 py-0.5 bg-slate-100 rounded text-[10px] text-slate-600">Źródło: <b>{de.source_wholesaler === 'atut-rental' ? 'Atut Rental' : de.source_wholesaler === 'ramirent' ? 'Ramirent' : de.source_wholesaler}</b></span>}
                            <span className={`px-2 py-0.5 rounded text-[10px] ${de.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>{de.is_active ? 'Aktywny' : 'Nieaktywny'}</span>
                          </div>
                          {de.source_wholesaler_url && (
                            <a href={de.source_wholesaler_url.startsWith('http') ? de.source_wholesaler_url : `https://www.atutrental.com.pl${de.source_wholesaler_url}`} target="_blank" rel="noopener noreferrer" className="w-full flex items-center justify-center gap-2 px-4 py-2 mb-2 text-xs font-medium text-blue-600 border border-blue-200 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors">
                              <ArrowUpRight className="w-3.5 h-3.5" />
                              {de.source_wholesaler === 'atut-rental' ? 'Otwórz na AtutRental.com.pl' : de.source_wholesaler === 'ramirent' ? 'Otwórz na Ramirent.pl' : 'Otwórz stronę źródłową'}
                            </a>
                          )}
                          <button
                            onClick={() => { handleApplyEquipmentFromSearch({ name: de.name, index: de.code, price: de.purchase_price || de.default_price || null, sku: de.sku, ean: de.ean, ref_num: de.ref_num, manufacturer: de.manufacturer }); setSearchEqDetailItem(null); }}
                            className="w-full py-2.5 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 transition-colors flex items-center justify-center gap-2"
                          >
                            <Plus className="w-4 h-4" />
                            Dodaj do kosztorysu
                          </button>
                        </div>
                      </div>
                      {de.description && (
                        <div className="px-5 pb-4">
                          <h4 className="text-xs font-semibold text-slate-600 mb-1.5">Opis</h4>
                          <p className="text-xs text-slate-500 leading-relaxed whitespace-pre-line">{de.description}</p>
                        </div>
                      )}
                      {(() => {
                        const params: Array<{ name: string; value: string }> = (() => { try { if (!de.parameters) return []; if (typeof de.parameters === 'string') return JSON.parse(de.parameters); return de.parameters as any; } catch { return []; } })();
                        if (params.length === 0) return null;
                        return (
                          <div className="px-5 pb-4">
                            <h4 className="text-xs font-semibold text-slate-600 mb-2">Parametry techniczne</h4>
                            <div className="border border-slate-200 rounded-lg overflow-hidden">
                              {params.map((p: any, i: number) => (
                                <div key={i} className={`flex items-center text-xs ${i % 2 === 0 ? 'bg-slate-50' : 'bg-white'}`}>
                                  <div className="w-1/2 px-3 py-2 text-slate-500 font-medium">{p.name}</div>
                                  <div className="w-1/2 px-3 py-2 text-slate-700 font-semibold text-right">{p.value}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })()}
                      {imgs.length > 1 && (
                        <div className="px-5 pb-4">
                          <h4 className="text-xs font-semibold text-slate-600 mb-2">Zdjęcia</h4>
                          <div className="flex gap-2 flex-wrap">
                            {imgs.map((img: string, i: number) => (
                              <div key={i} className="w-20 h-20 bg-slate-50 rounded border border-slate-200 flex items-center justify-center">
                                <img src={img} alt="" className="max-w-[90%] max-h-[90%] object-contain" />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {searchEquipmentSubTab === 'atut-rental' && (
                <div className="p-0">
                  <AtutIntegrator
                    integrationId={searchEquipmentIntegrations.find(i => i.wholesaler_id === 'atut-rental')?.id}
                    catalogButtonLabel="Dodaj do kosztorysu"
                    onAddToOwnCatalog={(p) => handleApplyEquipmentFromSearch({ name: p.name, price: p.price, sku: p.sku, ean: p.ean, ref_num: p.ref_num, unit: p.unit, manufacturer: p.manufacturer })}
                  />
                </div>
              )}

              {searchEquipmentSubTab === 'ramirent' && (
                <div className="p-0">
                  <RamirentIntegrator
                    integrationId={searchEquipmentIntegrations.find(i => i.wholesaler_id === 'ramirent')?.id}
                    catalogButtonLabel="Dodaj do kosztorysu"
                    onAddToOwnCatalog={(p) => handleApplyEquipmentFromSearch({ name: p.name, price: p.price, sku: p.sku, ean: p.ean, ref_num: p.ref_num, unit: p.unit, manufacturer: p.manufacturer })}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Search Labour Modal */}
      {showSearchLabourModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-gray-500/75 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-5xl w-full shadow-xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">Szukaj Robocizna</h2>
              <button onClick={() => setShowSearchLabourModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="flex border-b border-gray-200">
              <button
                onClick={() => { setSearchLabourSubTab('system'); setSearchLabourSearch(''); setSearchLabourSystemPage(0); }}
                className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                  searchLabourSubTab === 'system'
                    ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                Katalog Systemowy
              </button>
              <button
                onClick={() => { setSearchLabourSubTab('own'); setSearchLabourSearch(''); }}
                className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                  searchLabourSubTab === 'own'
                    ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                Katalog Własny
              </button>
            </div>
            <div className="flex-1 flex overflow-hidden">
              {/* Left sidebar — categories */}
              <div className="w-56 border-r border-gray-200 overflow-y-auto p-2">
                {searchLabourSubTab === 'system' ? (
                  <>
                    <button
                      onClick={() => setSearchLabourSelectedSystemCategory(null)}
                      className={`w-full text-left px-2 py-1.5 text-xs rounded ${!searchLabourSelectedSystemCategory ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
                    >
                      Wszystkie ({searchLabourSystemData.length})
                    </button>
                    {searchLabourSystemCategories.filter(c => !c.parent_id).map(cat => {
                      const children = searchLabourSystemCategories.filter(c => c.parent_id === cat.id);
                      const isExpanded = searchLabourExpandedSystemCats.has(cat.id);
                      const catCount = searchLabourSystemData.filter(l => l.category_name === cat.name || l.category_path?.startsWith(cat.name)).length;
                      return (
                        <div key={cat.id}>
                          <button
                            onClick={() => {
                              setSearchLabourSelectedSystemCategory(cat.id);
                              setSearchLabourSystemPage(0);
                              if (children.length > 0) {
                                setSearchLabourExpandedSystemCats(prev => {
                                  const next = new Set(prev);
                                  if (next.has(cat.id)) next.delete(cat.id); else next.add(cat.id);
                                  return next;
                                });
                              }
                            }}
                            className={`w-full text-left px-2 py-1.5 text-xs rounded flex items-center gap-1 ${searchLabourSelectedSystemCategory === cat.id ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
                          >
                            {children.length > 0 && (isExpanded ? <ChevronDown className="w-3 h-3 flex-shrink-0" /> : <ChevronRight className="w-3 h-3 flex-shrink-0" />)}
                            <FolderOpen className="w-3 h-3 flex-shrink-0 text-amber-500" />
                            <span className="truncate flex-1">{cat.name}</span>
                            <span className="text-[10px] text-gray-400 ml-1">{catCount}</span>
                          </button>
                          {isExpanded && children.map(child => {
                            const childCount = searchLabourSystemData.filter(l => l.category_name === child.name).length;
                            return (
                              <button
                                key={child.id}
                                onClick={() => { setSearchLabourSelectedSystemCategory(child.id); setSearchLabourSystemPage(0); }}
                                className={`w-full text-left pl-7 pr-2 py-1 text-xs rounded flex items-center gap-1 ${searchLabourSelectedSystemCategory === child.id ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-500 hover:bg-gray-50'}`}
                              >
                                <FolderOpen className="w-3 h-3 flex-shrink-0 text-amber-400" />
                                <span className="truncate flex-1">{child.name}</span>
                                <span className="text-[10px] text-gray-400 ml-1">{childCount}</span>
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => setSearchLabourSelectedOwnCategory(null)}
                      className={`w-full text-left px-2 py-1.5 text-xs rounded ${!searchLabourSelectedOwnCategory ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
                    >
                      Wszystkie ({searchLabourOwnData.length})
                    </button>
                    {searchLabourOwnCategories.filter(c => !c.parent_id).map(cat => {
                      const children = searchLabourOwnCategories.filter(c => c.parent_id === cat.id);
                      const isExpanded = searchLabourExpandedOwnCats.has(cat.id);
                      const catCount = searchLabourOwnData.filter(l => l.category === cat.name).length;
                      return (
                        <div key={cat.id}>
                          <button
                            onClick={() => {
                              setSearchLabourSelectedOwnCategory(cat.id);
                              if (children.length > 0) {
                                setSearchLabourExpandedOwnCats(prev => {
                                  const next = new Set(prev);
                                  if (next.has(cat.id)) next.delete(cat.id); else next.add(cat.id);
                                  return next;
                                });
                              }
                            }}
                            className={`w-full text-left px-2 py-1.5 text-xs rounded flex items-center gap-1 ${searchLabourSelectedOwnCategory === cat.id ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
                          >
                            {children.length > 0 && (isExpanded ? <ChevronDown className="w-3 h-3 flex-shrink-0" /> : <ChevronRight className="w-3 h-3 flex-shrink-0" />)}
                            <FolderOpen className="w-3 h-3 flex-shrink-0 text-amber-500" />
                            <span className="truncate flex-1">{cat.name}</span>
                            <span className="text-[10px] text-gray-400 ml-1">{catCount}</span>
                          </button>
                          {isExpanded && children.map(child => {
                            const childCount = searchLabourOwnData.filter(l => l.category === child.name).length;
                            return (
                              <button
                                key={child.id}
                                onClick={() => setSearchLabourSelectedOwnCategory(child.id)}
                                className={`w-full text-left pl-7 pr-2 py-1 text-xs rounded flex items-center gap-1 ${searchLabourSelectedOwnCategory === child.id ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-500 hover:bg-gray-50'}`}
                              >
                                <FolderOpen className="w-3 h-3 flex-shrink-0 text-amber-400" />
                                <span className="truncate flex-1">{child.name}</span>
                                <span className="text-[10px] text-gray-400 ml-1">{childCount}</span>
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
              {/* Main content area */}
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="p-3 border-b border-gray-100 flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      value={searchLabourSearch}
                      onChange={(e) => { setSearchLabourSearch(e.target.value); setSearchLabourSystemPage(0); }}
                      placeholder="Szukaj po kodzie lub nazwie..."
                      className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                  </div>
                </div>
                <div className="flex-1 overflow-auto">
                  {searchLabourSubTab === 'system' ? (() => {
                    const selCat = searchLabourSystemCategories.find(c => c.id === searchLabourSelectedSystemCategory);
                    let filtered = searchLabourSystemData;
                    if (selCat) {
                      const childNames = searchLabourSystemCategories.filter(c => c.parent_id === selCat.id).map(c => c.name);
                      filtered = filtered.filter(l =>
                        l.category_name === selCat.name || (l.category_path && l.category_path.startsWith(selCat.name)) || childNames.includes(l.category_name || '')
                      );
                    }
                    if (searchLabourSearch) {
                      const q = searchLabourSearch.toLowerCase();
                      filtered = filtered.filter(l => l.code.toLowerCase().includes(q) || l.name.toLowerCase().includes(q));
                    }
                    const pageSize = 50;
                    const totalPages = Math.ceil(filtered.length / pageSize);
                    const paged = filtered.slice(searchLabourSystemPage * pageSize, (searchLabourSystemPage + 1) * pageSize);
                    return (
                      <>
                        <div className="px-3 py-1.5 text-xs text-gray-400 border-b border-gray-100">
                          Znaleziono: {filtered.length} pozycji
                        </div>
                        <table className="w-full text-sm">
                          <thead className="sticky top-0 bg-white">
                            <tr className="border-b border-gray-200">
                              <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 w-28">KOD</th>
                              <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">NAZWA</th>
                              <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 w-16">JEDN.</th>
                              <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 w-24">CENA</th>
                              <th className="w-10"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {paged.map(l => (
                              <tr key={l.id} className="border-b border-gray-100 hover:bg-blue-50/50">
                                <td className="py-1.5 px-3 text-xs font-mono text-gray-700">{l.code}</td>
                                <td className="py-1.5 px-3 text-xs text-gray-800">{l.name}</td>
                                <td className="py-1.5 px-3 text-xs text-gray-500">{l.unit}</td>
                                <td className="py-1.5 px-3 text-xs text-right font-medium text-gray-800">{(l.price_unit || 0).toFixed(2)} zł</td>
                                <td className="py-1.5 px-1">
                                  <button
                                    onClick={() => handleApplyLabourFromSearch({ name: l.name, code: l.code, price: l.price_unit, unit: l.unit })}
                                    className="p-1 text-green-600 hover:bg-green-50 rounded"
                                    title="Dodaj"
                                  >
                                    <Plus className="w-4 h-4" />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {totalPages > 1 && (
                          <div className="flex items-center justify-center gap-2 py-3 border-t border-gray-100">
                            <button
                              onClick={() => setSearchLabourSystemPage(p => Math.max(0, p - 1))}
                              disabled={searchLabourSystemPage === 0}
                              className="px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-30"
                            >
                              Poprzednia
                            </button>
                            <span className="text-xs text-gray-500">{searchLabourSystemPage + 1} / {totalPages}</span>
                            <button
                              onClick={() => setSearchLabourSystemPage(p => Math.min(totalPages - 1, p + 1))}
                              disabled={searchLabourSystemPage >= totalPages - 1}
                              className="px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-30"
                            >
                              Następna
                            </button>
                          </div>
                        )}
                      </>
                    );
                  })() : (() => {
                    const selCat = searchLabourOwnCategories.find(c => c.id === searchLabourSelectedOwnCategory);
                    let filtered = searchLabourOwnData;
                    if (selCat) {
                      const childNames = searchLabourOwnCategories.filter(c => c.parent_id === selCat.id).map(c => c.name);
                      filtered = filtered.filter(l => l.category === selCat.name || childNames.includes(l.category || ''));
                    }
                    if (searchLabourSearch) {
                      const q = searchLabourSearch.toLowerCase();
                      filtered = filtered.filter(l => l.code.toLowerCase().includes(q) || l.name.toLowerCase().includes(q));
                    }
                    return (
                      <>
                        <div className="px-3 py-1.5 text-xs text-gray-400 border-b border-gray-100">
                          Znaleziono: {filtered.length} pozycji
                        </div>
                        <table className="w-full text-sm">
                          <thead className="sticky top-0 bg-white">
                            <tr className="border-b border-gray-200">
                              <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 w-28">KOD</th>
                              <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">NAZWA</th>
                              <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 w-16">JEDN.</th>
                              <th className="text-right py-2 px-3 text-xs font-medium text-gray-500 w-24">CENA</th>
                              <th className="w-10"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {filtered.map(l => (
                              <tr key={l.id} className="border-b border-gray-100 hover:bg-blue-50/50">
                                <td className="py-1.5 px-3 text-xs font-mono text-gray-700">{l.code}</td>
                                <td className="py-1.5 px-3 text-xs text-gray-800">{l.name}</td>
                                <td className="py-1.5 px-3 text-xs text-gray-500">{l.unit || 'r-g'}</td>
                                <td className="py-1.5 px-3 text-xs text-right font-medium text-gray-800">{(l.price || 0).toFixed(2)} zł</td>
                                <td className="py-1.5 px-1">
                                  <button
                                    onClick={() => handleApplyLabourFromSearch({ name: l.name, code: l.code, price: l.price, unit: l.unit })}
                                    className="p-1 text-green-600 hover:bg-green-50 rounded"
                                    title="Dodaj"
                                  >
                                    <Plus className="w-4 h-4" />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Import Confirmation Modal */}
      {showImportConfirmModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <AlertCircle className="w-5 h-5 text-red-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900">Zastąpić istniejące dane?</h3>
            </div>
            <p className="text-sm text-gray-600 mb-2">
              Obecny kosztorys zawiera:
            </p>
            <ul className="text-sm text-gray-700 mb-4 ml-4 list-disc">
              <li><strong>{estimateData.root.sectionIds.length}</strong> działów</li>
              <li><strong>{Object.keys(estimateData.positions).length}</strong> pozycji</li>
            </ul>
            <p className="text-sm text-red-600 font-medium mb-6">
              Import zastąpi wszystkie istniejące dane. Tej operacji nie można cofnąć.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowImportConfirmModal(false)}
                className="px-4 py-2 text-sm text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg"
              >
                Anuluj
              </button>
              <button
                onClick={handleImportConfirm}
                className="px-4 py-2 text-sm text-white bg-red-600 hover:bg-red-700 rounded-lg"
              >
                Tak, importuj
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-lg font-semibold text-gray-900">Import kosztorysu</h3>
              <button
                onClick={() => { setShowImportModal(false); setImportFile(null); setImportError(null); }}
                className="text-gray-400 hover:text-gray-600"
                disabled={importLoading}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6">
              {/* Drag & Drop Zone */}
              <div
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                  importDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
                } ${importLoading ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}
                onDragOver={(e) => { e.preventDefault(); setImportDragActive(true); }}
                onDragLeave={() => setImportDragActive(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setImportDragActive(false);
                  const file = e.dataTransfer.files[0];
                  if (file) { setImportFile(file); setImportError(null); }
                }}
                onClick={() => {
                  if (importLoading) return;
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = '.ath,.xlsx,.xls,.xml,.json,.pdf,.jpg,.jpeg,.png,.webp';
                  input.onchange = (e) => {
                    const file = (e.target as HTMLInputElement).files?.[0];
                    if (file) { setImportFile(file); setImportError(null); }
                  };
                  input.click();
                }}
              >
                <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3" />
                <p className="text-sm text-gray-600 mb-1">
                  Przeciągnij plik tutaj lub <span className="text-blue-600 font-medium">wybierz z dysku</span>
                </p>
                <p className="text-xs text-gray-400">
                  Obsługiwane formaty: .ath, .xlsx, .xml, .json, .pdf, .jpg, .png
                </p>
              </div>

              {/* Selected file info */}
              {importFile && !importLoading && (
                <div className="mt-4 flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                  <FileText className="w-5 h-5 text-blue-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{importFile.name}</p>
                    <p className="text-xs text-gray-500">{(importFile.size / 1024).toFixed(1)} KB</p>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); setImportFile(null); setImportError(null); }}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Loading spinner */}
              {importLoading && (
                <div className="mt-4 flex items-center gap-3 p-3 bg-blue-50 rounded-lg">
                  <Loader2 className="w-5 h-5 text-blue-500 animate-spin flex-shrink-0" />
                  <p className="text-sm text-blue-700">{importProgress || 'Przetwarzanie...'}</p>
                </div>
              )}

              {/* Error display */}
              {importError && (
                <div className="mt-4 flex items-start gap-3 p-3 bg-red-50 rounded-lg">
                  <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">{importError}</p>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 p-4 border-t">
              <button
                onClick={() => { setShowImportModal(false); setImportFile(null); setImportError(null); }}
                className="px-4 py-2 text-sm text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg"
                disabled={importLoading}
              >
                Anuluj
              </button>
              <button
                onClick={() => importFile && handleImportFile(importFile)}
                className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={!importFile || importLoading}
              >
                {importLoading ? 'Importowanie...' : 'Importuj'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== XLSX AI ANALYSIS MODAL ===== */}
      {xlsxPreview && xlsxMapping && (() => {
          const hdrIdx = xlsxMapping.headerRowIdx;
          const maxCols = Math.min(xlsxPreview.totalCols, 10);
          const dynHeaderRow = xlsxPreview.allRows[hdrIdx]?.map((c: any) => String(c ?? '').trim()).slice(0, maxCols) || [];
          const structureMap = new Map<number, XlsxAiStructureEntry>();
          for (const s of xlsxAiStructure) structureMap.set(s.row, s);
          const sectionEntries = xlsxAiStructure.filter(s => s.type === 'dzial').sort((a, b) => a.row - b.row);
          const subsectionEntries = xlsxAiStructure.filter(s => s.type === 'poddzial');
          const ignoreEntries = xlsxAiStructure.filter(s => s.type === 'ignore');
          // All data rows after header
          const allDataRows = xlsxPreview.allRows.slice(hdrIdx + 1).map((row, i) => ({
            rowIdx: hdrIdx + 1 + i,
            cells: (row || []).slice(0, maxCols).map((c: any) => String(c ?? '').trim()),
          })).filter(r => r.cells.some(c => c.length > 0));

          // Build tree: sections → subsections → position count
          const tree = sectionEntries.map((sec, si) => {
            const nextSecRow = si + 1 < sectionEntries.length ? sectionEntries[si + 1].row : Infinity;
            const subs = xlsxAiStructure.filter(s => s.type === 'poddzial' && s.row > sec.row && s.row < nextSecRow).sort((a, b) => a.row - b.row);
            // Count positions in each subsection
            const subsWithCounts = subs.map((sub, subi) => {
              const nextSubRow = subi + 1 < subs.length ? subs[subi + 1].row : nextSecRow;
              const posCount = allDataRows.filter(r => r.rowIdx > sub.row && r.rowIdx < nextSubRow && !structureMap.has(r.rowIdx)).length;
              return { ...sub, posCount };
            });
            // Positions directly in section (before first subsection or if no subsections)
            const firstSubRow = subs.length > 0 ? subs[0].row : nextSecRow;
            const directPosCount = allDataRows.filter(r => r.rowIdx > sec.row && r.rowIdx < firstSubRow && !structureMap.has(r.rowIdx)).length;
            const totalPosCount = directPosCount + subsWithCounts.reduce((sum, s) => sum + s.posCount, 0);
            return { ...sec, subs: subsWithCounts, directPosCount, totalPosCount };
          });

          const closeModal = () => {
            setXlsxPreview(null); setXlsxMapping(null); setXlsxAiAnalysis(null);
            setXlsxAiStructure([]); setXlsxAiError(null); setXlsxAiLoading(false);
            setXlsxCollapsedSections(new Set()); setXlsxTreeOpen(true);
          };

          const doImport = () => {
            if (!xlsxPreview || !xlsxMapping || xlsxMapping.colName < 0) return;
            try {
              const importedData = xlsxAiStructure.length > 0
                ? parseXlsxWithAiStructure(
                    xlsxPreview.allRows,
                    { lp: xlsxMapping.colLp, base: xlsxMapping.colBase, name: xlsxMapping.colName, unit: xlsxMapping.colUnit, qty: xlsxMapping.colQty },
                    xlsxMapping.headerRowIdx,
                    xlsxAiStructure
                  )
                : parseXlsxWithMapping(xlsxPreview.allRows, xlsxMapping);
              const allPositions = Object.values(importedData.positions);
              const withKnr = allPositions.filter(p => p.base && p.base.trim());
              const withoutKnr = allPositions.filter(p => !p.base || !p.base.trim());
              closeModal(); setShowImportModal(false);
              if (withoutKnr.length > 0) {
                setKnrPendingData(importedData);
                setKnrImportStats({ totalPositions: allPositions.length, positionsWithKnr: withKnr.length, positionsWithoutKnr: withoutKnr.length, foundInPortal: 0, foundByAi: 0, accepted: 0, rejected: 0 });
                setKnrImportStep('choice');
              } else {
                applyImportedData(importedData);
              }
            } catch (err: any) {
              setImportError(err.message || 'Błąd parsowania pliku');
              closeModal();
            }
          };

          const getRowName = (rowIdx: number): string => {
            const row = xlsxPreview.allRows[rowIdx];
            if (!row) return '';
            // Try name column first
            if (xlsxMapping.colName >= 0) {
              const v = String(row[xlsxMapping.colName] ?? '').trim();
              if (v) return v;
            }
            // Fallback: longest non-empty cell in row
            let best = '';
            for (let c = 0; c < Math.min(row.length, maxCols); c++) {
              const v = String(row[c] ?? '').trim();
              if (v.length > best.length && isNaN(Number(v))) best = v;
            }
            return best;
          };

          const cycleRowType = (rowIdx: number) => {
            setXlsxAiStructure(prev => {
              const existing = prev.find(s => s.row === rowIdx);
              if (!existing) {
                return [...prev, { row: rowIdx, type: 'dzial' as const, name: getRowName(rowIdx) }];
              }
              if (existing.type === 'dzial') return prev.map(s => s.row === rowIdx ? { ...s, type: 'poddzial' as const } : s);
              if (existing.type === 'poddzial') return prev.map(s => s.row === rowIdx ? { ...s, type: 'ignore' as const, reason: 'ręcznie' } : s);
              return prev.filter(s => s.row !== rowIdx);
            });
          };

          const toggleCollapse = (rowIdx: number) => {
            setXlsxCollapsedSections(prev => {
              const next = new Set(prev);
              if (next.has(rowIdx)) next.delete(rowIdx); else next.add(rowIdx);
              return next;
            });
          };

          // Precompute hidden row ranges for collapsed sections/subsections
          const hiddenRanges: [number, number][] = [];
          for (let si = 0; si < sectionEntries.length; si++) {
            const sec = sectionEntries[si];
            const nextSecRow = si + 1 < sectionEntries.length ? sectionEntries[si + 1].row : Infinity;
            if (xlsxCollapsedSections.has(sec.row)) {
              // Entire section collapsed — hide everything between sec.row and nextSecRow
              hiddenRanges.push([sec.row + 1, nextSecRow]);
            } else {
              // Section open — check collapsed subsections within it
              const subs = subsectionEntries.filter(s => s.row > sec.row && s.row < nextSecRow).sort((a, b) => a.row - b.row);
              for (let subi = 0; subi < subs.length; subi++) {
                if (xlsxCollapsedSections.has(subs[subi].row)) {
                  const nextSubRow = subi + 1 < subs.length ? subs[subi + 1].row : nextSecRow;
                  hiddenRanges.push([subs[subi].row + 1, nextSubRow]);
                }
              }
            }
          }
          const isRowHidden = (rowIdx: number): boolean => {
            for (const [from, to] of hiddenRanges) {
              if (rowIdx >= from && rowIdx < to) return true;
            }
            return false;
          };

          return (
        <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center" onClick={closeModal}>
          <div className="bg-white rounded-xl shadow-2xl w-[1150px] max-w-[97vw] max-h-[92vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="px-5 py-3 border-b flex items-center justify-between flex-shrink-0">
              <div>
                <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-purple-500" />
                  Analiza importu — {xlsxPreview.activeSheet}
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {xlsxPreview.totalRows} wierszy • {sectionEntries.length} działów • {subsectionEntries.length} poddziałów • {ignoreEntries.length} ignorowanych
                  {xlsxAiLoading && <span className="ml-2 text-purple-600"><Loader2 className="w-3 h-3 animate-spin inline" /> AI analizuje...</span>}
                </p>
              </div>
              <button onClick={closeModal} className="p-1 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5 text-gray-400" /></button>
            </div>

            {xlsxAiError && (
              <div className="px-5 py-2 bg-amber-50 border-b flex items-center gap-2 flex-shrink-0">
                <AlertCircle className="w-4 h-4 text-amber-500" />
                <span className="text-xs text-amber-700">{xlsxAiError}</span>
              </div>
            )}

            {/* Column mapping */}
            <div className="px-4 py-2.5 border-b bg-gray-50 flex-shrink-0">
              <div className="grid grid-cols-6 gap-2">
                {([
                  { key: 'colLp', label: 'Lp / Nr' },
                  { key: 'colBase', label: 'Podstawa (KNR)' },
                  { key: 'colName', label: 'Opis / Nazwa ★' },
                  { key: 'colUnit', label: 'J.m.' },
                  { key: 'colQty', label: 'Ilość' },
                ] as const).map(col => (
                  <div key={col.key}>
                    <label className={`block text-[10px] font-medium mb-0.5 ${col.key === 'colName' ? 'text-blue-600 font-bold' : 'text-gray-500'}`}>{col.label}</label>
                    <select value={(xlsxMapping as any)[col.key]} onChange={e => setXlsxMapping(prev => prev ? { ...prev, [col.key]: +e.target.value } : prev)}
                      className={`w-full text-xs border rounded-lg px-2 py-1 ${col.key === 'colName' ? 'border-blue-400 bg-blue-50' : 'border-gray-300'}`}>
                      <option value={-1}>— brak —</option>
                      {dynHeaderRow.map((h, i) => <option key={i} value={i}>{h || `Kol. ${i + 1}`}</option>)}
                    </select>
                  </div>
                ))}
                <div>
                  <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Nagłówek (wiersz)</label>
                  <input type="number" min={1} max={50} value={hdrIdx + 1}
                    onChange={e => setXlsxMapping(prev => prev ? { ...prev, headerRowIdx: Math.max(0, +e.target.value - 1) } : prev)}
                    className="w-full text-xs border border-gray-300 rounded-lg px-2 py-1" />
                </div>
              </div>
            </div>

            {/* Main content: tree sidebar + table */}
            <div className="flex-1 flex min-h-0">
              {/* Left: Tree navigation with collapse toggle */}
              <div className={`border-r flex flex-col flex-shrink-0 transition-all ${xlsxTreeOpen && sectionEntries.length > 0 ? 'w-[220px]' : 'w-7'}`}>
                {xlsxTreeOpen && sectionEntries.length > 0 ? (
                  <>
                    <div className="flex items-center justify-between px-2 pt-2 pb-1 flex-shrink-0">
                      <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">Struktura</span>
                      <button onClick={() => setXlsxTreeOpen(false)} className="p-0.5 hover:bg-gray-200 rounded" title="Zwiń panel">
                        <ChevronLeft className="w-3.5 h-3.5 text-gray-400" />
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto px-1 pb-2">
                      {tree.map(sec => {
                        const isCollapsed = xlsxCollapsedSections.has(sec.row);
                        const isHighlighted = xlsxHighlightedRow === sec.row;
                        return (
                          <div key={sec.row} className="mb-0.5">
                            <div className="flex items-center gap-0.5">
                              <button className="p-0.5 hover:bg-gray-200 rounded flex-shrink-0" onClick={() => toggleCollapse(sec.row)}>
                                {sec.subs.length > 0 ? (
                                  isCollapsed ? <ChevronRight className="w-3 h-3 text-gray-400" /> : <ChevronDown className="w-3 h-3 text-gray-400" />
                                ) : <div className="w-3 h-3" />}
                              </button>
                              <button
                                className={`flex-1 flex items-center gap-1 px-1 py-0.5 rounded text-left min-w-0 ${isHighlighted ? 'bg-blue-100 ring-1 ring-blue-300' : 'hover:bg-blue-50'}`}
                                onClick={() => {
                                  setXlsxHighlightedRow(sec.row);
                                  // Expand if collapsed
                                  if (xlsxCollapsedSections.has(sec.row)) toggleCollapse(sec.row);
                                  // Scroll to row in table
                                  const el = xlsxTableRef.current?.querySelector(`[data-row="${sec.row}"]`);
                                  el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                }}
                              >
                                <span className="text-[10px] px-1 py-0.5 bg-blue-100 text-blue-700 rounded font-bold flex-shrink-0">D</span>
                                <span className="text-[11px] text-gray-800 font-medium truncate flex-1" title={sec.name || getRowName(sec.row)}>{sec.name || getRowName(sec.row) || `Dział (w.${sec.row + 1})`}</span>
                                <span className="text-[9px] text-gray-400 flex-shrink-0">{sec.totalPosCount}</span>
                              </button>
                            </div>
                            {!isCollapsed && sec.subs.map(sub => {
                              const subHighlighted = xlsxHighlightedRow === sub.row;
                              return (
                                <div key={sub.row} className="flex items-center gap-0.5 pl-3.5">
                                  <button className="p-0.5 hover:bg-gray-200 rounded flex-shrink-0" onClick={() => toggleCollapse(sub.row)}>
                                    {xlsxCollapsedSections.has(sub.row) ? <ChevronRight className="w-2.5 h-2.5 text-gray-400" /> : <ChevronDown className="w-2.5 h-2.5 text-gray-400" />}
                                  </button>
                                  <button
                                    className={`flex-1 flex items-center gap-1 px-1 py-0.5 rounded text-left min-w-0 ${subHighlighted ? 'bg-sky-100 ring-1 ring-sky-300' : 'hover:bg-sky-50'}`}
                                    onClick={() => {
                                      setXlsxHighlightedRow(sub.row);
                                      if (xlsxCollapsedSections.has(sub.row)) toggleCollapse(sub.row);
                                      const el = xlsxTableRef.current?.querySelector(`[data-row="${sub.row}"]`);
                                      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                    }}
                                  >
                                    <span className="text-[9px] px-1 py-0.5 bg-sky-100 text-sky-700 rounded font-bold flex-shrink-0">P</span>
                                    <span className="text-[10px] text-gray-700 truncate flex-1" title={sub.name || getRowName(sub.row)}>{sub.name || getRowName(sub.row) || `Poddział (w.${sub.row + 1})`}</span>
                                    <span className="text-[9px] text-gray-400 flex-shrink-0">{sub.posCount}</span>
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                      {allDataRows.length > 0 && (sectionEntries.length === 0 || allDataRows[0].rowIdx < sectionEntries[0].row) && (
                        <div className="text-[10px] text-gray-400 px-1.5 py-1 italic">
                          Bez działu: {allDataRows.filter(r => r.rowIdx < (sectionEntries[0]?.row ?? Infinity) && !structureMap.has(r.rowIdx)).length}
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <button
                    onClick={() => setXlsxTreeOpen(true)}
                    className="w-full h-full flex items-center justify-center hover:bg-gray-100 transition"
                    title="Rozwiń panel struktury"
                  >
                    <ChevronRight className="w-4 h-4 text-gray-400" />
                  </button>
                )}
              </div>

              {/* Right: Table */}
              <div ref={xlsxTableRef} className="flex-1 overflow-auto min-h-0">
                <table className="text-xs" style={{ minWidth: '100%' }}>
                  <thead className="bg-gray-100 sticky top-0 z-10">
                    <tr>
                      <th className="px-1.5 py-1.5 text-left text-gray-400 font-normal" style={{ width: 32, minWidth: 32 }}>#</th>
                      <th className="px-1.5 py-1.5 text-left text-gray-500 font-medium" style={{ width: 56, minWidth: 56 }}>Typ</th>
                      {dynHeaderRow.map((h, i) => {
                        let hl = '';
                        if (i === xlsxMapping.colName) hl = 'bg-blue-100 text-blue-800 font-bold';
                        else if (i === xlsxMapping.colBase) hl = 'bg-green-100 text-green-800 font-bold';
                        else if (i === xlsxMapping.colUnit) hl = 'bg-amber-100 text-amber-800';
                        else if (i === xlsxMapping.colQty) hl = 'bg-purple-100 text-purple-800';
                        else if (i === xlsxMapping.colLp) hl = 'bg-gray-200 text-gray-700';
                        const w = xlsxColWidths[i] || (i === xlsxMapping.colName ? 300 : 120);
                        return (
                          <th key={i} className={`px-1.5 py-1.5 text-left whitespace-nowrap relative group ${hl}`} style={{ width: w, minWidth: 50 }}>
                            {h || `Kol.${i + 1}`}
                            {/* Resize handle */}
                            <div
                              className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-400/40 group-hover:bg-gray-300/40"
                              onMouseDown={e => {
                                e.preventDefault();
                                const startX = e.clientX;
                                const startW = w;
                                const colIdx = i;
                                const onMove = (ev: MouseEvent) => {
                                  const delta = ev.clientX - startX;
                                  setXlsxColWidths(prev => ({ ...prev, [colIdx]: Math.max(50, startW + delta) }));
                                };
                                const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
                                document.addEventListener('mousemove', onMove);
                                document.addEventListener('mouseup', onUp);
                              }}
                            />
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {allDataRows.map(({ rowIdx, cells }) => {
                      if (isRowHidden(rowIdx)) return null;
                      const entry = structureMap.get(rowIdx);
                      const rowType = entry?.type || 'position';
                      const isCollapsible = (rowType === 'dzial' || rowType === 'poddzial');
                      const isCollapsed = xlsxCollapsedSections.has(rowIdx);
                      const isHighlighted = xlsxHighlightedRow === rowIdx;

                      let rowBg = 'hover:bg-gray-50';
                      let typeBadge = <span className="text-[9px] text-gray-400">Poz.</span>;
                      if (rowType === 'dzial') {
                        rowBg = 'bg-blue-50 hover:bg-blue-100 font-medium';
                        typeBadge = <span className="text-[9px] px-1 py-0.5 bg-blue-200 text-blue-800 rounded font-bold cursor-pointer">Dział</span>;
                      } else if (rowType === 'poddzial') {
                        rowBg = 'bg-sky-50 hover:bg-sky-100';
                        typeBadge = <span className="text-[9px] px-1 py-0.5 bg-sky-200 text-sky-800 rounded font-bold cursor-pointer">Poddz.</span>;
                      } else if (rowType === 'ignore') {
                        rowBg = 'bg-gray-100 hover:bg-gray-200 opacity-50';
                        typeBadge = <span className="text-[9px] px-1 py-0.5 bg-red-100 text-red-600 rounded line-through cursor-pointer">Ign.</span>;
                      }
                      if (isHighlighted) rowBg += ' ring-2 ring-inset ring-blue-400';

                      return (
                        <tr key={rowIdx} data-row={rowIdx} className={`border-t border-gray-100 transition-colors ${rowBg}`}>
                          <td className="px-1.5 py-1 text-gray-400" style={{ width: 32 }}>
                            {isCollapsible ? (
                              <button onClick={() => toggleCollapse(rowIdx)} className="p-0 text-gray-400 hover:text-gray-600">
                                {isCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                              </button>
                            ) : <span className="pl-0.5">{rowIdx + 1}</span>}
                          </td>
                          <td className="px-1.5 py-1" style={{ width: 56 }} onClick={() => cycleRowType(rowIdx)}>{typeBadge}</td>
                          {cells.map((val, cIdx) => {
                            let hl = '';
                            if (cIdx === xlsxMapping.colName && rowType === 'position') hl = 'bg-blue-50/50 font-medium';
                            else if (cIdx === xlsxMapping.colBase) hl = 'bg-green-50/50';
                            else if (cIdx === xlsxMapping.colUnit) hl = 'bg-amber-50/50';
                            else if (cIdx === xlsxMapping.colQty) hl = 'bg-purple-50/50';
                            const w = xlsxColWidths[cIdx] || (cIdx === xlsxMapping.colName ? 300 : 120);
                            return (
                              <td key={cIdx} className={`px-1.5 py-1 truncate ${hl}`} style={{ maxWidth: w, width: w }} title={val}>{val}</td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-5 py-3 border-t flex-shrink-0">
              <button onClick={closeModal} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg">Anuluj</button>
              <button onClick={doImport} disabled={xlsxMapping.colName < 0 || xlsxAiLoading}
                className="px-5 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 flex items-center gap-2">
                {xlsxAiLoading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Czekaj na AI...</> : 'Importuj'}
              </button>
            </div>
          </div>
        </div>
          );
        })()}

      {/* ===== KNR IMPORT FLOW MODALS ===== */}
      {knrImportStep && (
        <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center" onClick={() => { if (knrImportStep !== 'processing') { setKnrImportStep(null); setKnrPendingData(null); } }}>
          <div className="bg-white rounded-xl shadow-2xl max-w-[95vw] max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>

            {/* Step 1: Choice — what to do with missing KNR */}
            {knrImportStep === 'choice' && (
              <div className="w-[520px]">
                <div className="px-6 py-4 border-b flex items-center justify-between">
                  <h2 className="text-base font-bold text-gray-900">Brak KNR w pliku</h2>
                  <button onClick={() => { setKnrImportStep(null); setKnrPendingData(null); }} className="p-1 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5 text-gray-400" /></button>
                </div>
                <div className="p-6">
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-5">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-amber-800">
                          {knrImportStats?.positionsWithoutKnr} z {knrImportStats?.totalPositions} pozycji nie posiada numeru KNR
                        </p>
                        <p className="text-xs text-amber-600 mt-1">
                          Pozycje z KNR: {knrImportStats?.positionsWithKnr} | Bez KNR: {knrImportStats?.positionsWithoutKnr}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <button onClick={() => {
                      if (knrPendingData) applyImportedData(knrPendingData);
                    }} className="w-full text-left p-4 border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50/50 transition group">
                      <div className="font-medium text-sm text-gray-900 group-hover:text-blue-700">Importuj wszystkie pozycje</div>
                      <p className="text-xs text-gray-500 mt-1">Importuj wszystkie pozycje, nawet bez KNR</p>
                    </button>
                    <button onClick={() => {
                      if (knrPendingData) {
                        // Filter: keep only positions with KNR
                        const filtered = { ...knrPendingData, positions: { ...knrPendingData.positions }, sections: { ...knrPendingData.sections } };
                        const withoutKnrIds = new Set(Object.values(filtered.positions).filter(p => !p.base || !p.base.trim()).map(p => p.id));
                        for (const id of withoutKnrIds) delete filtered.positions[id];
                        // Remove from sections
                        for (const sec of Object.values(filtered.sections)) {
                          (sec as any).positionIds = ((sec as any).positionIds || []).filter((pid: string) => !withoutKnrIds.has(pid));
                        }
                        filtered.root.positionIds = (filtered.root.positionIds || []).filter(pid => !withoutKnrIds.has(pid));
                        applyImportedData(filtered);
                      }
                    }} className="w-full text-left p-4 border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50/50 transition group">
                      <div className="font-medium text-sm text-gray-900 group-hover:text-blue-700">Importuj tylko pozycje z KNR</div>
                      <p className="text-xs text-gray-500 mt-1">Pomiń {knrImportStats?.positionsWithoutKnr} pozycji bez KNR</p>
                    </button>
                    <button onClick={() => setKnrImportStep('ai-scope')}
                      className="w-full text-left p-4 border-2 border-blue-200 bg-blue-50/30 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition group">
                      <div className="font-medium text-sm text-blue-700 flex items-center gap-2">
                        <Sparkles className="w-4 h-4" /> Importuj wszystkie + wyszukaj KNR z pomocą AI
                      </div>
                      <p className="text-xs text-gray-500 mt-1">Automatyczne wyszukiwanie KNR w portalu i z pomocą AI</p>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Step 2: AI scope — all positions or only empty */}
            {knrImportStep === 'ai-scope' && (
              <div className="w-[480px]">
                <div className="px-6 py-4 border-b flex items-center justify-between">
                  <h2 className="text-base font-bold text-gray-900">Zakres wyszukiwania KNR</h2>
                  <button onClick={() => setKnrImportStep('choice')} className="p-1 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5 text-gray-400" /></button>
                </div>
                <div className="p-6">
                  <p className="text-sm text-gray-600 mb-4">Wybierz dla których pozycji wyszukać KNR:</p>
                  <div className="space-y-3 mb-6">
                    <button onClick={() => { setKnrScope('all'); setKnrImportStep('ai-mode'); }}
                      className="w-full text-left p-4 border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50/50 transition group">
                      <div className="font-medium text-sm text-gray-900 group-hover:text-blue-700">Wszystkie pozycje</div>
                      <p className="text-xs text-gray-500 mt-1">Wyszukaj KNR dla wszystkich {knrImportStats?.totalPositions} pozycji (również tych z istniejącym KNR)</p>
                    </button>
                    <button onClick={() => { setKnrScope('empty'); setKnrImportStep('ai-mode'); }}
                      className="w-full text-left p-4 border-2 border-blue-200 bg-blue-50/30 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition group">
                      <div className="font-medium text-sm text-blue-700">Tylko puste pozycje</div>
                      <p className="text-xs text-gray-500 mt-1">Pozycje z KNR importują się automatycznie, wyszukaj KNR dla {knrImportStats?.positionsWithoutKnr} pustych</p>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Step 3: AI mode — automatic or manual */}
            {knrImportStep === 'ai-mode' && (
              <div className="w-[480px]">
                <div className="px-6 py-4 border-b flex items-center justify-between">
                  <h2 className="text-base font-bold text-gray-900">Tryb wyszukiwania KNR</h2>
                  <button onClick={() => setKnrImportStep('ai-scope')} className="p-1 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5 text-gray-400" /></button>
                </div>
                <div className="p-6">
                  <p className="text-sm text-gray-600 mb-4">Jak chcesz obsłużyć znalezione KNR?</p>
                  <div className="space-y-3">
                    <button onClick={() => processKnrLookup(knrScope, false)}
                      className="w-full text-left p-4 border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50/50 transition group">
                      <div className="font-medium text-sm text-gray-900 group-hover:text-blue-700">Automatycznie</div>
                      <p className="text-xs text-gray-500 mt-1">Wyszukaj i od razu zastosuj KNR do pozycji. Pozycje z KNR znalezionym przez AI zostaną oznaczone.</p>
                    </button>
                    <button onClick={() => processKnrLookup(knrScope, true)}
                      className="w-full text-left p-4 border-2 border-blue-200 bg-blue-50/30 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition group">
                      <div className="font-medium text-sm text-blue-700">Ręcznie</div>
                      <p className="text-xs text-gray-500 mt-1">Pokaż tabelę z wynikami do ręcznego zatwierdzenia przed importem</p>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Step 4: Processing */}
            {knrImportStep === 'processing' && (
              <div className="w-[440px]">
                <div className="px-6 py-4 border-b">
                  <h2 className="text-base font-bold text-gray-900">Wyszukiwanie KNR...</h2>
                </div>
                <div className="p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
                    <p className="text-sm text-gray-700">{knrProcessingMsg}</p>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                    <div className="bg-blue-600 h-2 rounded-full transition-all" style={{ width: `${knrProcessingProgress}%` }} />
                  </div>
                  <p className="text-xs text-gray-400 text-right">{knrProcessingProgress}%</p>
                </div>
              </div>
            )}

            {/* Step 5: Review table (manual mode) */}
            {knrImportStep === 'review' && (() => {
              const pendingItems = knrReviewItems.filter(i => !i.accepted && !i.removed);
              const selectedId = knrReviewSelectedId && pendingItems.some(i => i.posId === knrReviewSelectedId) ? knrReviewSelectedId : pendingItems[0]?.posId || null;
              return (
              <div className="w-[950px]">
                <div className="px-6 py-4 border-b flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-bold text-gray-900">Weryfikacja KNR</h2>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Pozostało: {pendingItems.length} pozycji
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => {
                      if (!selectedId) return;
                      setKnrReviewItems(prev => prev.map(i => i.posId === selectedId ? { ...i, accepted: true } : i));
                      setKnrReviewSelectedId(null);
                    }} className="px-3 py-1.5 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5" /> Przyjmij pozycję
                    </button>
                    <button onClick={() => {
                      if (!selectedId) return;
                      setKnrReviewItems(prev => prev.map(i => i.posId === selectedId ? { ...i, accepted: true, knrCode: '', knrDescription: '' } : i));
                      setKnrReviewSelectedId(null);
                    }} className="px-3 py-1.5 text-xs border border-red-300 text-red-600 rounded-lg hover:bg-red-50 flex items-center gap-1.5">
                      <X className="w-3.5 h-3.5" /> Odrzuć KNR
                    </button>
                    <button onClick={() => {
                      setKnrReviewItems(prev => prev.map(i => (!i.accepted && !i.removed) ? { ...i, accepted: true } : i));
                      setKnrReviewSelectedId(null);
                    }} className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                      Przyjmij wszystkie
                    </button>
                  </div>
                </div>
                <div className="max-h-[60vh] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0 z-10">
                      <tr>
                        <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 w-8">#</th>
                        <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 w-[130px]">KNR</th>
                        <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">Opis KNR</th>
                        <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 w-16">Źródło</th>
                        <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">Nazwa pozycji</th>
                        <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 w-14">Pewność</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingItems.map((item, idx) => (
                        <tr key={item.posId}
                          className={`border-b border-gray-100 cursor-pointer transition-colors ${
                            item.posId === selectedId ? 'bg-blue-50 ring-1 ring-inset ring-blue-200' : 'hover:bg-gray-50'
                          }`}
                          onClick={() => setKnrReviewSelectedId(item.posId)}
                        >
                          <td className="py-2 px-3 text-xs text-gray-400">{idx + 1}</td>
                          <td className="py-2 px-3">
                            <span className={`text-xs font-mono font-medium ${item.knrCode ? 'text-blue-700' : 'text-gray-400 italic'}`}>
                              {item.knrCode || 'brak'}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-xs text-gray-500 max-w-[200px] truncate" title={item.knrDescription}>
                            {item.knrDescription || '—'}
                          </td>
                          <td className="py-2 px-3">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                              item.source === 'portal' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'
                            }`}>
                              {item.source === 'portal' ? 'Portal' : 'AI'}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-xs text-gray-700 max-w-[250px] truncate" title={item.posName}>{item.posName}</td>
                          <td className="py-2 px-3">
                            <span className={`text-[10px] font-medium ${
                              item.confidence >= 0.8 ? 'text-green-600' : item.confidence >= 0.5 ? 'text-amber-600' : 'text-red-500'
                            }`}>
                              {Math.round(item.confidence * 100)}%
                            </span>
                          </td>
                        </tr>
                      ))}
                      {pendingItems.length === 0 && (() => {
                        // All reviewed — auto-advance to stats
                        setTimeout(() => {
                          if (knrPendingData && knrImportStats) {
                            const finalItems = knrReviewItems;
                            const finalStats = {
                              ...knrImportStats,
                              accepted: finalItems.filter(i => i.accepted && !i.removed).length,
                              rejected: finalItems.filter(i => i.removed).length,
                            };
                            setKnrImportStats(finalStats);
                            applyKnrResults(finalItems, knrPendingData, finalStats, 'empty');
                          }
                        }, 300);
                        return <tr><td colSpan={6} className="py-8 text-center text-sm text-gray-400">Wszystkie pozycje zostały sprawdzone</td></tr>;
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>
              );
            })()}

            {/* Step 6: Stats summary */}
            {knrImportStep === 'stats' && (
              <div className="w-[460px]">
                <div className="px-6 py-4 border-b">
                  <h2 className="text-base font-bold text-gray-900">Statystyki importu</h2>
                </div>
                <div className="p-6">
                  <div className="space-y-3 mb-6">
                    {[
                      { label: 'Pozycji w pliku', value: knrImportStats?.totalPositions || 0, color: 'text-gray-700' },
                      { label: 'Pozycji z KNR w pliku', value: knrImportStats?.positionsWithKnr || 0, color: 'text-blue-600' },
                      { label: 'Pozycji bez KNR', value: knrImportStats?.positionsWithoutKnr || 0, color: 'text-amber-600' },
                      { label: 'KNR znaleziono w portalu', value: knrImportStats?.foundInPortal || 0, color: 'text-green-600' },
                      { label: 'KNR znaleziono z AI', value: knrImportStats?.foundByAi || 0, color: 'text-purple-600' },
                      { label: 'Zaakceptowano', value: knrImportStats?.accepted || 0, color: 'text-green-700' },
                      { label: 'Odrzucono', value: knrImportStats?.rejected || 0, color: 'text-red-600' },
                    ].map(row => (
                      <div key={row.label} className="flex items-center justify-between py-2 border-b border-gray-100">
                        <span className="text-sm text-gray-600">{row.label}</span>
                        <span className={`text-sm font-bold ${row.color}`}>{row.value}</span>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => { setKnrImportStep(null); setKnrPendingData(null); }}
                    className="w-full py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium">
                    Przejdź do kosztorysu
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      )}

      {/* Import loading overlay */}
      {applyingImport && (
        <div className="fixed inset-0 bg-black/40 z-[80] flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-2xl p-8 flex flex-col items-center gap-4">
            <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
            <p className="text-sm font-medium text-gray-700">Importowanie pozycji do kosztorysu...</p>
            <p className="text-xs text-gray-400">Proszę czekać</p>
          </div>
        </div>
      )}

      {/* Notification */}
      {notification && (
        <div className={`fixed bottom-4 right-4 px-4 py-3 rounded-lg shadow-lg ${
          notification.type === 'success' ? 'bg-green-500' : 'bg-red-500'
        } text-white flex items-center gap-2 z-50`}>
          {notification.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5" />
          ) : (
            <AlertCircle className="w-5 h-5" />
          )}
          {notification.message}
        </div>
      )}
    </div>
  );
};

export default KosztorysEditorPage;
