import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Plus, Search, FileText, Send, CheckCircle, XCircle, Eye, Pencil,
  Trash2, Copy, Download, ExternalLink, Loader2, Filter, Calendar,
  DollarSign, User, Building2, MoreVertical, ArrowLeft, Clock,
  Mail, Link as LinkIcon, RefreshCw, ChevronDown, ChevronRight,
  Save, X, GripVertical, Percent, AlertCircle, FileSpreadsheet,
  FolderPlus, Package, Star, UserPlus, Briefcase, MapPin,
  ToggleLeft, ToggleRight, ListChecks, ChevronUp, Wrench, Hammer,
  FolderOpen, Printer, MessageSquare, Phone, Globe, Store, Settings
} from 'lucide-react';
import jsPDF from 'jspdf';
import * as XLSX from 'xlsx';
import { useAppContext } from '../../context/AppContext';
import { WholesalerIntegrationModal } from './WholesalerIntegrationModal';
import { RentalIntegrationModal } from './RentalIntegrationModal';
import { TIMIntegrator } from './TIMIntegrator';
import { OninenIntegrator } from './OninenIntegrator';
import { AtutIntegrator } from './AtutIntegrator';
import { RamirentIntegrator } from './RamirentIntegrator';
import { supabase } from '../../lib/supabase';
import { fetchCompanyByNip, validateNip, normalizeNip } from '../../lib/gusApi';
import { searchAddress, OSMAddress, createDebouncedSearch } from '../../lib/osmAutocomplete';
import { Project, Offer, OfferStatus, OfferSection, OfferItem, Contractor, EstimateStage, EstimateTask, EstimateResource, KosztorysRequestSource, KosztorysObjectType, KosztorysInstallationType, User as UserType } from '../../types';
import { OFFER_STATUS_LABELS, OFFER_STATUS_COLORS } from '../../constants';

const OFFER_SOURCE_LABELS: Record<KosztorysRequestSource, string> = {
  email: 'E-mail',
  phone: 'Telefon',
  meeting: 'Spotkanie',
  tender: 'Przetarg',
  other: 'Inne'
};

const DEFAULT_UNITS = [
  'szt.', 'm', 'm²', 'm³', 'kg', 'kpl.', 'godz.', 'mb', 'op.', 'l', 't'
];

const OBJECT_TYPE_LABELS: Record<KosztorysObjectType, string> = {
  industrial: 'Przemysłowe',
  residential: 'Mieszkaniowe',
  office: 'Biurowe'
};

interface OfferExistingClient {
  contractor_id?: string;
  client_name: string;
  nip: string | null;
  company_street: string | null;
  company_street_number: string | null;
  company_city: string | null;
  company_postal_code: string | null;
  company_country: string | null;
  source: 'contractor' | 'request_history';
}

interface ContactFormData {
  id?: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  position: string;
  is_primary: boolean;
}

const initialContactData: ContactFormData = {
  first_name: '',
  last_name: '',
  phone: '',
  email: '',
  position: '',
  is_primary: true
};

const formatPhoneNumber = (value: string): string => {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 0) return '';
  if (digits.startsWith('48') && digits.length > 2) {
    const rest = digits.substring(2);
    return `+48 ${rest.substring(0, 3)}${rest.length > 3 ? ' ' + rest.substring(3, 6) : ''}${rest.length > 6 ? ' ' + rest.substring(6, 9) : ''}`.trim();
  }
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.substring(0, 3)} ${digits.substring(3)}`;
  return `${digits.substring(0, 3)} ${digits.substring(3, 6)} ${digits.substring(6, 9)}`;
};

const isValidEmail = (email: string): boolean => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

// ============================================
// TYPES
// ============================================
type CalculationMode = 'markup' | 'fixed';

interface OfferComponent {
  id: string;
  type: 'labor' | 'material' | 'equipment';
  name: string;
  code: string;
  unit: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  markup_percent?: number;
  discount_percent?: number;
}

interface LocalOfferItem extends Omit<OfferItem, 'total_price'> {
  total_price: number;
  isEditing?: boolean;
  isNew?: boolean;
  isExpanded?: boolean;
  components?: OfferComponent[];
  markup_percent?: number;
  cost_price?: number;
  discount_percent?: number;
  vat_rate?: number;
  selected?: boolean;
}

interface LocalOfferSection extends OfferSection {
  items: LocalOfferItem[];
  isExpanded?: boolean;
  children?: LocalOfferSection[];
  parent_id?: string;
}

// ============================================
// COMPONENTS
// ============================================

const StatusBadge: React.FC<{ status: OfferStatus }> = ({ status }) => {
  const config = OFFER_STATUS_COLORS[status];
  const label = OFFER_STATUS_LABELS[status];
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${config}`}>
      {label}
    </span>
  );
};

// Inline editable cell
const EditableCell: React.FC<{
  value: string | number;
  onChange: (value: string) => void;
  onBlur: () => void;
  type?: 'text' | 'number';
  className?: string;
  disabled?: boolean;
}> = ({ value, onChange, onBlur, type = 'text', className = '', disabled }) => {
  const [localValue, setLocalValue] = useState(String(value));

  useEffect(() => {
    setLocalValue(String(value));
  }, [value]);

  return (
    <input
      type={type}
      value={localValue}
      onChange={e => setLocalValue(e.target.value)}
      onBlur={() => { onChange(localValue); onBlur(); }}
      onKeyDown={e => { if (e.key === 'Enter') { onChange(localValue); onBlur(); } }}
      disabled={disabled}
      className={`w-full px-2 py-1 border border-slate-200 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${disabled ? 'bg-slate-50 cursor-not-allowed' : ''} ${className}`}
    />
  );
};

// ============================================
// MAIN COMPONENT
// ============================================
export const OffersPage: React.FC = () => {
  const { state } = useAppContext();
  const { currentUser, language } = state;

  // List state
  const [offers, setOffers] = useState<Offer[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<OfferStatus | 'all'>('all');

  // Modal/View state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showImportFromEstimate, setShowImportFromEstimate] = useState(false);
  const [selectedOffer, setSelectedOffer] = useState<Offer | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingOffer, setEditingOffer] = useState<Offer | null>(null);
  const [editForm, setEditForm] = useState({ name: '', project_id: '', client_id: '', valid_until: '', notes: '' });

  // Editor state
  const [offerData, setOfferData] = useState({
    name: '',
    number: '',
    project_id: '',
    client_id: '',
    valid_until: '',
    discount_percent: 0,
    discount_amount: 0,
    notes: '',
    internal_notes: ''
  });
  const [sections, setSections] = useState<LocalOfferSection[]>([]);
  const [sectionsReady, setSectionsReady] = useState(999); // progressive render: how many sections are ready (999 = show all)
  const [savingOffer, setSavingOffer] = useState(false);

  // Calculation mode & dates
  const [calculationMode, setCalculationMode] = useState<CalculationMode>('markup');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().split('T')[0]);
  const [objectName, setObjectName] = useState('');
  const [objectAddress, setObjectAddress] = useState('');
  const [workStartDate, setWorkStartDate] = useState('');
  const [workEndDate, setWorkEndDate] = useState('');

  // Warunki istotne
  const [paymentTerm, setPaymentTerm] = useState('');
  const [invoiceFrequency, setInvoiceFrequency] = useState('');
  const [warrantyPeriod, setWarrantyPeriod] = useState('');
  // "Uwzględnij" flags — when true, surcharge is applied to totals; when false, informational only
  const [paymentTermApply, setPaymentTermApply] = useState(true);
  const [invoiceFreqApply, setInvoiceFreqApply] = useState(true);
  const [warrantyApply, setWarrantyApply] = useState(true);

  // "Na ofercie" flags for built-in warunki — when true, shown on public offer
  const [paymentTermShowOnOffer, setPaymentTermShowOnOffer] = useState(true);
  const [invoiceFreqShowOnOffer, setInvoiceFreqShowOnOffer] = useState(true);
  const [warrantyShowOnOffer, setWarrantyShowOnOffer] = useState(true);

  // Custom warunki istotne (beyond the 3 built-in)
  interface CustomWarunek {
    id: string;
    name: string;
    value: string;
    surcharge: number;
    apply: boolean;
    show_on_offer: boolean;
  }
  const [customWarunki, setCustomWarunki] = useState<CustomWarunek[]>([]);

  // Koszty powiązane
  const calculateMonthsBetween = (from: string, to: string): number => {
    if (!from || !to) return 1;
    const d1 = new Date(from);
    const d2 = new Date(to);
    const months = (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth()) + (d2.getDate() > d1.getDate() ? 1 : 0);
    return Math.max(1, Math.ceil(months));
  };

  interface RelatedCost {
    id: string; name: string; value: number;
    mode: 'fixed' | 'percent'; // fixed sum or % of net contract
    frequency: 'one_time' | 'monthly'; // only for fixed mode
    show_on_offer: boolean; // show as separate line in offer
    date_from?: string;
    date_to?: string;
  }
  const [relatedCosts, setRelatedCosts] = useState<RelatedCost[]>([
    { id: 'koszty_budowy', name: 'Koszty budowy', value: 0, mode: 'fixed', frequency: 'one_time', show_on_offer: false },
    { id: 'kaucja_gwarancyjna', name: 'Kaucja Gwarancyjna', value: 0, mode: 'percent', frequency: 'one_time', show_on_offer: false },
    { id: 'polisa_oc', name: 'Polisa OC', value: 0, mode: 'fixed', frequency: 'one_time', show_on_offer: false },
    { id: 'wynajem_konteneru', name: 'Wynajem Konteneru', value: 0, mode: 'fixed', frequency: 'monthly', show_on_offer: false }
  ]);

  // SMS acceptance & Negotiation flags
  const [smsAcceptance, setSmsAcceptance] = useState(false);
  const [negotiationEnabled, setNegotiationEnabled] = useState(false);
  // Negotiation data (owner view)
  const [negotiationData, setNegotiationData] = useState<any>(null);
  const [negotiationResponding, setNegotiationResponding] = useState(false);
  // Comments state
  const [comments, setComments] = useState<any[]>([]);
  const [showCommentsPanel, setShowCommentsPanel] = useState(false);
  const [commentsFilter, setCommentsFilter] = useState<'all' | 'unread' | 'unanswered'>('all');
  const [commentItemId, setCommentItemId] = useState<string | null>(null); // focused item
  const [newCommentText, setNewCommentText] = useState('');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [collapsedThreads, setCollapsedThreads] = useState<Set<string>>(new Set());

  // Settings modal
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'dodatki' | 'widok'>('dodatki');
  const [showComponentsInPrint, setShowComponentsInPrint] = useState(false);

  // Dropdown options for warunki istotne (configurable in settings)
  const [paymentTermOptions, setPaymentTermOptions] = useState<number[]>([1, 3, 7, 14, 21, 30, 45, 60]);
  const [invoiceFreqOptions, setInvoiceFreqOptions] = useState<number[]>([7, 14, 21, 30]);
  const [warrantyOptions, setWarrantyOptions] = useState<number[]>([12, 24, 36, 48, 60]);

  // Surcharge/discount rules based on payment term, warranty, invoice frequency
  interface SurchargeRule { value: number; surcharge: number; } // surcharge > 0 = narzut, < 0 = rabat
  const [paymentTermRules, setPaymentTermRules] = useState<SurchargeRule[]>([
    { value: 7, surcharge: -2 }, { value: 14, surcharge: -1 }, { value: 30, surcharge: 0 }, { value: 60, surcharge: 2 }
  ]);
  const [warrantyRules, setWarrantyRules] = useState<SurchargeRule[]>([
    { value: 24, surcharge: 0 }, { value: 36, surcharge: 1 }, { value: 48, surcharge: 2 }, { value: 60, surcharge: 3 }
  ]);
  const [invoiceFreqRules, setInvoiceFreqRules] = useState<SurchargeRule[]>([]);

  // Bulk operations
  const [showBulkBar, setShowBulkBar] = useState(false);
  const [showBulkRabatModal, setShowBulkRabatModal] = useState(false);
  const [bulkRabatValue, setBulkRabatValue] = useState(0);
  const [itemSearchQuery, setItemSearchQuery] = useState('');
  const [itemFilterSection, setItemFilterSection] = useState('');
  // Preview & Send
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState<'netto' | 'brutto' | 'rabat' | 'no_prices' | 'full'>('netto');
  const [showLogoInPreview, setShowLogoInPreview] = useState(true);
  const [showSendModal, setShowSendModal] = useState(false);
  const [showDownloadDropdown, setShowDownloadDropdown] = useState(false);
  const [sendRepresentativeId, setSendRepresentativeId] = useState('');
  const [sendCoverLetter, setSendCoverLetter] = useState('');
  const [sendChannels, setSendChannels] = useState<string[]>(['email']);
  const [sendingOffer, setSendingOffer] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [sendManualContact, setSendManualContact] = useState({ first_name: '', last_name: '', email: '', phone: '' });

  // Zapytania ofertowe (RFQ)
  const [showCreateRequestModal, setShowCreateRequestModal] = useState(false);
  const [requestType, setRequestType] = useState<'robota' | 'materialy' | 'sprzet' | 'all'>('all');
  const [requestStep, setRequestStep] = useState<'type' | 'preview'>('type');
  const [offerRequests, setOfferRequests] = useState<any[]>([]);
  const [offersTab, setOffersTab] = useState<'offers' | 'requests'>('offers');
  const [selectedRequest, setSelectedRequest] = useState<any>(null);
  const [requestSubcontractorId, setRequestSubcontractorId] = useState('');
  const [requestName, setRequestName] = useState('');
  const [requestOfferId, setRequestOfferId] = useState('');
  const [requestSections, setRequestSections] = useState<any[]>([]);
  const [loadingRequestSections, setLoadingRequestSections] = useState(false);
  const [subcontractors, setSubcontractors] = useState<any[]>([]);
  const [creatingRequest, setCreatingRequest] = useState(false);
  // Searchable subcontractor dropdown
  const [subcontractorSearch, setSubcontractorSearch] = useState('');
  const [subcontractorDropdownOpen, setSubcontractorDropdownOpen] = useState(false);
  const [selectedSubcontractor, setSelectedSubcontractor] = useState<any>(null);
  // Searchable supplier dropdown
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [supplierDropdownOpen, setSupplierDropdownOpen] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<any>(null);

  // Toast notification system
  interface ToastMessage { id: number; text: string; type: 'success' | 'error' | 'info'; }
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastIdRef = useRef(0);
  const showToast = useCallback((text: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, text, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  // Confirmation modal system
  interface ConfirmModalState { show: boolean; title: string; message: string; onConfirm: (inputValue?: string) => void; confirmLabel?: string; destructive?: boolean; showInput?: boolean; inputPlaceholder?: string; inputValue?: string; }
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState>({ show: false, title: '', message: '', onConfirm: () => {} });
  const showConfirm = useCallback((opts: Omit<ConfirmModalState, 'show'>) => {
    setConfirmModal({ ...opts, show: true });
  }, []);

  // Auto-generate cover letter when send modal opens
  useEffect(() => {
    if (showSendModal && selectedOffer) {
      const itemCount = getAllItems(sections).length;
      const userName = currentUser ? `${currentUser.first_name || ''} ${currentUser.last_name || ''}`.trim() : '';
      const companyName = state.currentCompany?.name || '';
      const validUntil = selectedOffer.valid_until ? formatDate(selectedOffer.valid_until) : '';
      const letter = `Szanowni Państwo,\n\nW załączeniu przesyłam ofertę ${selectedOffer.number} — ${selectedOffer.name}.\nOferta obejmuje ${itemCount} pozycji o wartości ${formatCurrency(totals.total)} netto.${validUntil ? `\nWażność: do ${validUntil}.` : ''}\n\nW razie pytań pozostaję do dyspozycji.\n\nZ poważaniem,\n${userName}${companyName ? `\n${companyName}` : ''}`;
      setSendCoverLetter(letter);
      setSendManualContact({ first_name: '', last_name: '', email: '', phone: '' });
    }
  }, [showSendModal]);

  // Keyboard shortcuts: Ctrl+S to save, Escape to close modals/exit edit
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+S — save offer
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (editMode && selectedOffer && !savingOffer) {
          handleUpdateOffer();
        }
      }
      // Escape — close topmost modal or exit edit mode
      if (e.key === 'Escape') {
        if (confirmModal.show) { setConfirmModal(prev => ({ ...prev, show: false })); return; }
        if (showSettingsModal) { setShowSettingsModal(false); return; }
        if (showBulkRabatModal) { setShowBulkRabatModal(false); return; }
        if (showPreviewModal) { setShowPreviewModal(false); return; }
        if (showSendModal) { setShowSendModal(false); return; }
        if (showImportFromEstimate) { setShowImportFromEstimate(false); return; }
        if (showEditModal) { setShowEditModal(false); setEditingOffer(null); return; }
        if (showCreateModal) { setShowCreateModal(false); resetOfferForm(); return; }
        if (editMode) { setEditMode(false); return; }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editMode, selectedOffer, savingOffer, confirmModal.show, showSettingsModal, showBulkRabatModal, showPreviewModal, showSendModal, showImportFromEstimate, showEditModal, showCreateModal]);

  // Load client data when entering edit mode
  useEffect(() => {
    if (editMode && selectedOffer) {
      loadOfferExistingClients();
      // Populate client form data from selected offer's client
      const client = (selectedOffer as any).client;
      if (client) {
        setOfferClientData(prev => ({
          ...prev,
          client_name: client.name || '',
          nip: client.nip || '',
          company_street: client.address_street || '',
          company_street_number: '',
          company_city: client.address_city || '',
          company_postal_code: client.address_postal_code || '',
          company_country: client.address_country || 'Polska'
        }));
        setOfferClientSelected(true);
      }
    }
  }, [editMode, selectedOffer?.id]);

  // Kartoteka search modals
  const [showSearchLabourModal, setShowSearchLabourModal] = useState(false);
  const [showSearchMaterialModal, setShowSearchMaterialModal] = useState(false);
  const [showSearchEquipmentModal, setShowSearchEquipmentModal] = useState(false);
  const [searchComponentTarget, setSearchComponentTarget] = useState<{ sectionId: string; itemId: string; type: 'labor' | 'material' | 'equipment' } | null>(null);
  const [searchPositionTarget, setSearchPositionTarget] = useState<{ sectionId: string } | null>(null);
  const [kartotekaSearchText, setKartotekaSearchText] = useState('');
  const [kartotekaData, setKartotekaData] = useState<any[]>([]);
  const [kartotekaOwnData, setKartotekaOwnData] = useState<any[]>([]);
  const [kartotekaTab, setKartotekaTab] = useState<'system' | 'own'>('own');
  const [kartotekaLoading, setKartotekaLoading] = useState(false);
  const [kartotekaMode, setKartotekaMode] = useState<'fill_item' | 'add_component'>('add_component');
  const [kartotekaCategories, setKartotekaCategories] = useState<any[]>([]);
  const [kartotekaSelectedCategory, setKartotekaSelectedCategory] = useState<string | null>(null);
  const [kartotekaExpandedCats, setKartotekaExpandedCats] = useState<Set<string>>(new Set());
  const [kartotekaViewMode, setKartotekaViewMode] = useState<'list' | 'grid'>('list');
  const [kartotekaDetailItem, setKartotekaDetailItem] = useState<any | null>(null);
  const [kartotekaMainTab, setKartotekaMainTab] = useState<string>('katalog');
  const [showWholesalerConfig, setShowWholesalerConfig] = useState(false);
  const [showRentalConfig, setShowRentalConfig] = useState(false);
  const [wholesalerIntegrations, setWholesalerIntegrations] = useState<any[]>([]);
  const [wholesalerSearchText, setWholesalerSearchText] = useState('');
  const [wholesalerResults, setWholesalerResults] = useState<any[]>([]);
  const [wholesalerSearching, setWholesalerSearching] = useState(false);
  const [wholesalerProvider, setWholesalerProvider] = useState<'tim' | 'onninen'>('tim');
  const [rentalProvider, setRentalProvider] = useState<'atut' | 'ramirent'>('atut');

  // Import from estimate state
  const [selectedEstimateId, setSelectedEstimateId] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [importSource, setImportSource] = useState<'estimates' | 'kosztorys'>('kosztorys');
  const [kosztorysEstimates, setKosztorysEstimates] = useState<any[]>([]);
  const [selectedKosztorysId, setSelectedKosztorysId] = useState('');
  const [importedKosztorysName, setImportedKosztorysName] = useState<string | null>(null);

  const autoSelectDone = useRef(false);

  // Client form state (kosztorys-style)
  const [offerClientData, setOfferClientData] = useState({
    client_name: '', nip: '', company_street: '', company_street_number: '',
    company_city: '', company_postal_code: '', company_country: 'Polska',
    internal_notes: '', request_source: 'email' as KosztorysRequestSource,
    // Object fields
    investment_name: '', object_code: '',
    object_type: 'residential' as KosztorysObjectType,
    object_type_id: '', object_category_id: '',
    installation_types: 'IE' as KosztorysInstallationType,
    object_street: '', object_street_number: '',
    object_city: '', object_postal_code: '', object_country: 'Polska',
    // Materials
    main_material_side: '', minor_material_side: '',
    // Assignment
    assigned_user_id: '', planned_response_date: '',
    // Notes
    notes: ''
  });
  const [offerGusLoading, setOfferGusLoading] = useState(false);
  const [offerGusError, setOfferGusError] = useState<string | null>(null);
  const [offerGusSuccess, setOfferGusSuccess] = useState<string | null>(null);
  const [offerExistingClients, setOfferExistingClients] = useState<OfferExistingClient[]>([]);
  const [offerClientSearchQuery, setOfferClientSearchQuery] = useState('');
  const [offerShowClientDropdown, setOfferShowClientDropdown] = useState(false);
  const [offerFilteredClients, setOfferFilteredClients] = useState<OfferExistingClient[]>([]);
  const [offerCompanyAddressSuggestions, setOfferCompanyAddressSuggestions] = useState<OSMAddress[]>([]);
  const [offerShowCompanyAddressSuggestions, setOfferShowCompanyAddressSuggestions] = useState(false);

  // Contact/representatives state (kosztorys-style)
  const [offerContacts, setOfferContacts] = useState<ContactFormData[]>([{ ...initialContactData }]);
  const [offerClientContacts, setOfferClientContacts] = useState<any[]>([]);
  const [offerShowAddContactForm, setOfferShowAddContactForm] = useState(false);
  const [offerSelectedContactId, setOfferSelectedContactId] = useState('');
  const [offerClientSelected, setOfferClientSelected] = useState(false);
  const [showAddRepInline, setShowAddRepInline] = useState(false);
  const [newRepData, setNewRepData] = useState({ first_name: '', last_name: '', phone: '', email: '', position: '', is_main_contact: true });

  // Object/Materials/Assignment state (kosztorys-style)
  const [offerUsers, setOfferUsers] = useState<UserType[]>([]);
  const [offerWorkTypes, setOfferWorkTypes] = useState<{ id: string; code: string; name: string }[]>([]);
  const [offerSelectedWorkTypes, setOfferSelectedWorkTypes] = useState<string[]>([]);
  const [offerShowWorkTypesDropdown, setOfferShowWorkTypesDropdown] = useState(false);
  const [offerShowAddWorkType, setOfferShowAddWorkType] = useState(false);
  const [offerNewWorkTypeCode, setOfferNewWorkTypeCode] = useState('');
  const [offerNewWorkTypeName, setOfferNewWorkTypeName] = useState('');
  const [offerShowAddSource, setOfferShowAddSource] = useState(false);
  const [offerNewSourceOption, setOfferNewSourceOption] = useState('');
  const [offerCustomSources, setOfferCustomSources] = useState<string[]>([]);
  const [offerShowAddObjectCategory, setOfferShowAddObjectCategory] = useState(false);
  const [offerNewObjectCategoryOption, setOfferNewObjectCategoryOption] = useState('');
  const [offerObjectTypes, setOfferObjectTypes] = useState<any[]>([]);
  const [offerObjectCategories, setOfferObjectCategories] = useState<any[]>([]);
  const [offerObjectAddressSuggestions, setOfferObjectAddressSuggestions] = useState<OSMAddress[]>([]);
  const [offerShowObjectAddressSuggestions, setOfferShowObjectAddressSuggestions] = useState(false);
  const [offerEditingObjectCode, setOfferEditingObjectCode] = useState(false);

  // ============================================
  // DATA LOADING
  // ============================================
  useEffect(() => {
    if (currentUser) loadData();
  }, [currentUser]);

  const loadData = async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      const [offersRes, projectsRes, contractorsRes, kosztorysRes] = await Promise.all([
        supabase
          .from('offers')
          .select('*, project:projects(*), client:contractors(*)')
          .eq('company_id', currentUser.company_id)
          .is('deleted_at', null)
          .order('created_at', { ascending: false }),
        supabase
          .from('projects')
          .select('*')
          .eq('company_id', currentUser.company_id),
        supabase
          .from('contractors')
          .select('*')
          .eq('company_id', currentUser.company_id)
          .eq('contractor_type', 'customer')
          .is('deleted_at', null),
        supabase
          .from('kosztorys_estimates')
          .select('*, request:kosztorys_requests(investment_name, client_name)')
          .eq('company_id', currentUser.company_id)
          .in('status', ['draft', 'pending_approval', 'approved', 'sent'])
          .order('created_at', { ascending: false })
      ]);

      if (offersRes.data) setOffers(offersRes.data);
      if (projectsRes.data) setProjects(projectsRes.data);
      if (contractorsRes.data) setContractors(contractorsRes.data);
      if (kosztorysRes.data) setKosztorysEstimates(kosztorysRes.data);

      // Load subcontractors, suppliers, and offer requests
      const [subRes, supplierRes, reqRes] = await Promise.all([
        supabase.from('contractors_subcontractors').select('*').eq('company_id', currentUser.company_id).eq('is_archived', false).order('name'),
        supabase.from('contractors_clients').select('*').eq('company_id', currentUser.company_id).eq('contractor_type', 'supplier').eq('is_archived', false).order('name'),
        supabase.from('offer_requests').select('*, offer:offers(name, number), subcontractor:contractors(name)').eq('company_id', currentUser.company_id).order('created_at', { ascending: false })
      ]);
      if (subRes.data) setSubcontractors(subRes.data);
      if (supplierRes.data) setSuppliers(supplierRes.data);
      if (reqRes.data) setOfferRequests(reqRes.data);
    } catch (err) {
      console.error('Error loading offers:', err);
    } finally {
      setLoading(false);
    }
  };

  // ============================================
  // CLIENT FORM HELPERS (kosztorys-style)
  // ============================================
  const loadOfferExistingClients = async () => {
    if (!currentUser) return;
    try {
      const { data: portalClients } = await supabase
        .from('contractors_clients')
        .select('id, name, nip, address_street, address_city, address_postal_code, address_country, contractor_type')
        .eq('company_id', currentUser.company_id)
        .eq('is_archived', false)
        .order('name');

      const { data: requestsData } = await supabase
        .from('kosztorys_requests')
        .select('client_name, nip, company_street, company_street_number, company_city, company_postal_code, company_country')
        .eq('company_id', currentUser.company_id)
        .order('client_name');

      const allClients: OfferExistingClient[] = [];
      const portalByNip = new Map<string, number>();
      const portalByName = new Map<string, number>();

      if (portalClients) {
        portalClients.forEach(c => {
          const idx = allClients.length;
          allClients.push({
            contractor_id: c.id, client_name: c.name, nip: c.nip,
            company_street: c.address_street, company_street_number: null,
            company_city: c.address_city, company_postal_code: c.address_postal_code,
            company_country: c.address_country === 'PL' ? 'Polska' : (c.address_country || 'Polska'),
            source: 'contractor'
          });
          if (c.nip) portalByNip.set(c.nip.replace(/\D/g, ''), idx);
          portalByName.set(c.name.toLowerCase(), idx);
        });
      }

      if (requestsData) {
        requestsData.forEach(r => {
          if (portalByName.has(r.client_name.toLowerCase())) {
            const idx = portalByName.get(r.client_name.toLowerCase())!;
            if (!allClients[idx].company_street && r.company_street) {
              allClients[idx].company_street = r.company_street;
              allClients[idx].company_street_number = r.company_street_number;
              allClients[idx].company_city = r.company_city;
              allClients[idx].company_postal_code = r.company_postal_code;
            }
            return;
          }
          if (r.nip) {
            const rawNip = r.nip.replace(/\D/g, '');
            if (portalByNip.has(rawNip)) return;
          }
          allClients.push({
            client_name: r.client_name, nip: r.nip,
            company_street: r.company_street, company_street_number: r.company_street_number,
            company_city: r.company_city, company_postal_code: r.company_postal_code,
            company_country: r.company_country || 'Polska', source: 'request_history'
          });
        });
      }

      setOfferExistingClients(allClients);
    } catch (err) {
      console.error('Error loading existing clients for offers:', err);
    }
  };

  useEffect(() => {
    if (currentUser) {
      loadOfferExistingClients();
      loadOfferUsers();
      loadOfferWorkTypes();
      loadOfferObjectTypes();
      loadOfferObjectCategories();
    }
  }, [currentUser]);

  const loadOfferUsers = async () => {
    if (!currentUser) return;
    try {
      const { data } = await supabase
        .from('users')
        .select('id, first_name, last_name, email, role')
        .eq('company_id', currentUser.company_id)
        .in('role', ['company_admin', 'hr', 'coordinator', 'employee'])
        .order('first_name');
      if (data) setOfferUsers(data as any);
    } catch (err) {
      console.error('Error loading users:', err);
    }
  };

  const loadOfferWorkTypes = async () => {
    if (!currentUser) return;
    try {
      const { data } = await supabase
        .from('kosztorys_work_types')
        .select('id, code, name')
        .eq('company_id', currentUser.company_id)
        .eq('is_active', true)
        .order('code');
      if (data) {
        setOfferWorkTypes(data);
      } else {
        setOfferWorkTypes([
          { id: 'ie', code: 'IE', name: 'IE - Elektryka' },
          { id: 'it', code: 'IT', name: 'IT - Teletechnika' }
        ]);
      }
    } catch (err) {
      console.error('Error loading work types:', err);
      setOfferWorkTypes([
        { id: 'ie', code: 'IE', name: 'IE - Elektryka' },
        { id: 'it', code: 'IT', name: 'IT - Teletechnika' }
      ]);
    }
  };

  const loadOfferObjectTypes = async () => {
    if (!currentUser) return;
    try {
      const { data } = await supabase
        .from('kosztorys_object_types')
        .select('*')
        .eq('company_id', currentUser.company_id)
        .eq('is_active', true)
        .order('name');
      if (data) setOfferObjectTypes(data);
    } catch (err) {
      console.error('Error loading object types:', err);
    }
  };

  const loadOfferObjectCategories = async () => {
    if (!currentUser) return;
    try {
      const { data } = await supabase
        .from('kosztorys_object_categories')
        .select('*, object_type:kosztorys_object_types(*)')
        .eq('company_id', currentUser.company_id)
        .eq('is_active', true)
        .order('name');
      if (data) setOfferObjectCategories(data);
    } catch (err) {
      console.error('Error loading object categories:', err);
    }
  };

  // Filter clients based on search query
  useEffect(() => {
    if (offerClientSearchQuery.trim().length >= 2) {
      const query = offerClientSearchQuery.toLowerCase();
      const filtered = offerExistingClients.filter(c =>
        c.client_name.toLowerCase().includes(query) || (c.nip && c.nip.includes(query))
      );
      filtered.sort((a, b) => {
        if (a.source !== b.source) return a.source === 'contractor' ? -1 : 1;
        return a.client_name.localeCompare(b.client_name);
      });
      setOfferFilteredClients(filtered);
      setOfferShowClientDropdown(filtered.length > 0 || offerClientSearchQuery.trim().length >= 2);
    } else {
      setOfferFilteredClients([]);
      setOfferShowClientDropdown(false);
    }
  }, [offerClientSearchQuery, offerExistingClients]);

  const debouncedOfferAddressSearch = useCallback(createDebouncedSearch(500), []);

  const handleOfferCompanyStreetChange = (value: string) => {
    setOfferClientData(prev => ({ ...prev, company_street: value }));
    if (value.length >= 3) {
      const sq = offerClientData.company_city ? `${value}, ${offerClientData.company_city}` : value;
      debouncedOfferAddressSearch(sq, (results: OSMAddress[]) => {
        setOfferCompanyAddressSuggestions(results);
        setOfferShowCompanyAddressSuggestions(results.length > 0);
      });
    } else {
      setOfferShowCompanyAddressSuggestions(false);
    }
  };

  const selectOfferCompanyAddress = (addr: OSMAddress) => {
    setOfferClientData(prev => ({
      ...prev,
      company_street: addr.street, company_street_number: addr.streetNumber,
      company_city: addr.city, company_postal_code: addr.postalCode,
      company_country: addr.country || 'Polska'
    }));
    setOfferShowCompanyAddressSuggestions(false);
  };

  // Object address autocomplete
  const debouncedOfferObjectAddressSearch = useCallback(createDebouncedSearch(500), []);

  const handleOfferObjectStreetChange = (value: string) => {
    setOfferClientData(prev => ({ ...prev, object_street: value }));
    if (value.length >= 3) {
      const sq = offerClientData.object_city ? `${value}, ${offerClientData.object_city}` : value;
      debouncedOfferObjectAddressSearch(sq, (results: OSMAddress[]) => {
        setOfferObjectAddressSuggestions(results);
        setOfferShowObjectAddressSuggestions(results.length > 0);
      });
    } else {
      setOfferShowObjectAddressSuggestions(false);
    }
  };

  const selectOfferObjectAddress = (addr: OSMAddress) => {
    setOfferClientData(prev => ({
      ...prev,
      object_street: addr.street, object_street_number: addr.streetNumber,
      object_city: addr.city, object_postal_code: addr.postalCode,
      object_country: addr.country || 'Polska'
    }));
    setOfferShowObjectAddressSuggestions(false);
  };

  // Auto-generate object code
  const generateOfferObjectCode = (city: string, investmentName: string): string => {
    if (!investmentName) return '';
    const cityPart = city ? city.trim().toUpperCase().slice(0, 3).padEnd(3, 'X') : 'XXX';
    const words = investmentName.trim().split(/\s+/).filter(w => w.length > 0);
    let namePart = '';
    if (words.length >= 2) {
      namePart = (words[0].slice(0, 2) + words[1][0]).toUpperCase();
    } else if (words.length === 1) {
      namePart = words[0].slice(0, 3).toUpperCase();
    }
    const year = String(new Date().getFullYear()).slice(-2);
    return `${cityPart}\\${namePart}\\${year}`;
  };

  // Auto-generate object code when investment name or city changes
  useEffect(() => {
    if (offerClientData.investment_name && !offerEditingObjectCode) {
      setOfferClientData(prev => ({
        ...prev,
        object_code: generateOfferObjectCode(prev.object_city, prev.investment_name)
      }));
    }
  }, [offerClientData.investment_name, offerClientData.object_city, offerEditingObjectCode]);

  const selectOfferExistingClient = (client: OfferExistingClient) => {
    let nip = client.nip || '';
    if (!nip && client.contractor_id) {
      const entry = offerExistingClients.find(c => c.contractor_id === client.contractor_id && c.nip);
      if (entry) nip = entry.nip || '';
    }
    setOfferClientData(prev => ({
      ...prev, client_name: client.client_name, nip,
      company_street: client.company_street || '', company_street_number: client.company_street_number || '',
      company_city: client.company_city || '', company_postal_code: client.company_postal_code || '',
      company_country: client.company_country || 'Polska'
    }));
    setOfferClientSearchQuery('');
    setOfferShowClientDropdown(false);
    // Load contacts for this client (like kosztorys does)
    if (client.contractor_id) {
      offerLoadClientContactsById(client.contractor_id);
    } else if (nip) {
      offerFindAndLoadContacts(nip);
    } else {
      offerFindAndLoadContacts(undefined, client.client_name);
    }
    setOfferSelectedContactId('');
    setOfferShowAddContactForm(false);
    setOfferClientSelected(true);
  };

  const handleOfferFetchGus = async () => {
    if (!offerClientData.nip) { setOfferGusError('Wprowadź NIP'); return; }
    if (!validateNip(offerClientData.nip)) { setOfferGusError('Nieprawidłowy format NIP'); return; }
    setOfferGusLoading(true); setOfferGusError(null); setOfferGusSuccess(null);
    try {
      // Step 1: Check local contractor database first
      const localContractor = await offerLookupContractorByNip(offerClientData.nip);
      if (localContractor) {
        setOfferClientData(prev => ({
          ...prev,
          client_name: localContractor.name,
          company_street: localContractor.street || prev.company_street,
          company_street_number: localContractor.streetNumber || prev.company_street_number,
          company_city: localContractor.city || prev.company_city,
          company_postal_code: localContractor.postalCode || prev.company_postal_code,
          company_country: localContractor.country || 'Polska'
        }));
        await offerLoadClientContactsById(localContractor.contractor_id);
        setOfferGusSuccess('Klient znaleziony w bazie kontrahentów');
        setOfferClientSelected(true);
        setOfferGusLoading(false);
        return;
      }

      // Step 2: Not found locally - fetch from GUS API
      const result = await fetchCompanyByNip(offerClientData.nip);
      if (result.success && result.data) {
        const d = result.data;
        setOfferClientData(prev => ({
          ...prev, client_name: d.name || prev.client_name,
          company_street: d.street || prev.company_street, company_street_number: d.streetNumber || prev.company_street_number,
          company_city: d.city || prev.company_city, company_postal_code: d.postalCode || prev.company_postal_code,
          company_country: d.country || 'Polska'
        }));
        // Load contacts by NIP
        offerFindAndLoadContacts(offerClientData.nip);
      } else if (result.error === 'ALREADY_REGISTERED') {
        setOfferGusSuccess('Klient jest już zarejestrowany w systemie. Wybierz go z listy klientów.');
        offerFindAndLoadContacts(offerClientData.nip);
        setOfferClientSelected(true);
      } else {
        setOfferGusError(result.error || 'Nie udało się pobrać danych');
      }
    } catch (err: any) {
      setOfferGusError(err.message || 'Błąd połączenia');
    } finally {
      setOfferGusLoading(false);
    }
  };

  const resetOfferClientData = () => {
    setOfferClientData({
      client_name: '', nip: '', company_street: '', company_street_number: '',
      company_city: '', company_postal_code: '', company_country: 'Polska',
      internal_notes: '', request_source: 'email' as KosztorysRequestSource,
      investment_name: '', object_code: '',
      object_type: 'residential' as KosztorysObjectType,
      object_type_id: '', object_category_id: '',
      installation_types: 'IE' as KosztorysInstallationType,
      object_street: '', object_street_number: '',
      object_city: '', object_postal_code: '', object_country: 'Polska',
      main_material_side: '', minor_material_side: '',
      assigned_user_id: '', planned_response_date: '',
      notes: ''
    });
    setOfferGusError(null); setOfferGusSuccess(null);
    setOfferClientSearchQuery(''); setOfferShowClientDropdown(false);
    setOfferShowCompanyAddressSuggestions(false);
    setOfferContacts([{ ...initialContactData }]);
    setOfferClientContacts([]);
    setOfferShowAddContactForm(false);
    setOfferSelectedContactId('');
    setOfferClientSelected(false);
    setOfferSelectedWorkTypes([]);
    setOfferShowWorkTypesDropdown(false);
    setOfferObjectAddressSuggestions([]);
    setOfferShowObjectAddressSuggestions(false);
    setOfferEditingObjectCode(false);
  };

  // ============================================
  // CONTACT/REPRESENTATIVES FUNCTIONS (kosztorys-style)
  // ============================================
  const offerLoadClientContactsById = async (contractorId: string) => {
    try {
      // contractorId is from 'contractors' table; contacts use 'contractors_clients' table
      // Bridge: find matching contractors_clients record
      let contactsClientId = '';
      const { data: contractor } = await supabase.from('contractors').select('name, nip').eq('id', contractorId).single();
      if (contractor) {
        const nipN = contractor.nip ? contractor.nip.replace(/\D/g, '') : '';
        if (nipN) {
          const { data: byNip } = await supabase.from('contractors_clients').select('id')
            .eq('company_id', currentUser!.company_id).eq('nip', nipN).limit(1);
          if (byNip?.length) contactsClientId = byNip[0].id;
        }
        if (!contactsClientId && contractor.name) {
          const { data: byName } = await supabase.from('contractors_clients').select('id')
            .eq('company_id', currentUser!.company_id).ilike('name', contractor.name).limit(1);
          if (byName?.length) contactsClientId = byName[0].id;
        }
      }
      const { data } = contactsClientId ? await supabase
        .from('contractor_client_contacts')
        .select('*')
        .eq('client_id', contactsClientId)
        .order('last_name') : { data: null };
      const contactsList = data || [];
      setOfferClientContacts(contactsList);

      // Auto-select main contact if available
      const mainContact = contactsList.find((c: any) => c.is_main_contact === true);
      if (mainContact) {
        setOfferSelectedContactId(mainContact.id);
        setSendRepresentativeId(mainContact.id);
        setOfferContacts([{
          first_name: mainContact.first_name || '',
          last_name: mainContact.last_name || '',
          phone: mainContact.phone || '',
          email: mainContact.email || '',
          position: mainContact.position || '',
          is_primary: true
        }]);
        setOfferShowAddContactForm(false);
      } else if (contactsList.length > 0) {
        // Auto-select first contact as representative
        setSendRepresentativeId(contactsList[0].id);
      }
    } catch (err) {
      console.error('Error loading client contacts:', err);
      setOfferClientContacts([]);
    }
  };

  const offerFindAndLoadContacts = async (nip?: string, name?: string) => {
    if (!currentUser) return;
    try {
      // Try by NIP first
      if (nip) {
        const rawNip = nip.replace(/\D/g, '');
        const { data: portalClients } = await supabase
          .from('contractors_clients')
          .select('id, nip')
          .eq('company_id', currentUser.company_id)
          .eq('is_archived', false);

        const match = portalClients?.find(c => c.nip && c.nip.replace(/\D/g, '') === rawNip);
        if (match) {
          await offerLoadClientContactsById(match.id);
          return;
        }
      }

      // Try by name
      if (name) {
        const { data } = await supabase
          .from('contractors_clients')
          .select('id')
          .eq('company_id', currentUser.company_id)
          .eq('is_archived', false)
          .ilike('name', `%${name}%`)
          .limit(1);

        if (data && data.length > 0) {
          await offerLoadClientContactsById(data[0].id);
          return;
        }

        // Strategy 2: match by first significant word
        const firstWord = name.split(/[\s.,]+/).find(w => w.length > 2);
        if (firstWord && firstWord.toLowerCase() !== name.toLowerCase()) {
          const { data: data2 } = await supabase
            .from('contractors_clients')
            .select('id')
            .eq('company_id', currentUser.company_id)
            .eq('is_archived', false)
            .ilike('name', `%${firstWord}%`)
            .limit(1);

          if (data2 && data2.length > 0) {
            await offerLoadClientContactsById(data2[0].id);
            return;
          }
        }
      }

      setOfferClientContacts([]);
    } catch (err) {
      console.error('Error finding contractor:', err);
      setOfferClientContacts([]);
    }
  };

  const offerLookupContractorByNip = async (nip: string): Promise<{ contractor_id: string; name: string; street: string; streetNumber: string; city: string; postalCode: string; country: string } | null> => {
    if (!currentUser) return null;
    try {
      const rawNip = nip.replace(/\D/g, '');
      const { data: portalClients } = await supabase
        .from('contractors_clients')
        .select('id, name, nip, address_street, address_city, address_postal_code, address_country')
        .eq('company_id', currentUser.company_id)
        .eq('is_archived', false);

      const match = portalClients?.find(c => c.nip && c.nip.replace(/\D/g, '') === rawNip);
      if (!match) return null;

      return {
        contractor_id: match.id,
        name: match.name,
        street: match.address_street || '',
        streetNumber: '',
        city: match.address_city || '',
        postalCode: match.address_postal_code || '',
        country: match.address_country === 'PL' ? 'Polska' : (match.address_country || 'Polska')
      };
    } catch (err) {
      console.error('Error looking up contractor by NIP:', err);
      return null;
    }
  };

  const offerSelectExistingContact = (contactId: string) => {
    setOfferSelectedContactId(contactId);
    const contact = offerClientContacts.find(c => c.id === contactId);
    if (contact) {
      setOfferContacts([{
        first_name: contact.first_name || '',
        last_name: contact.last_name || '',
        phone: contact.phone || '',
        email: contact.email || '',
        position: contact.position || '',
        is_primary: true
      }]);
      setOfferShowAddContactForm(false);
    }
  };

  const offerAddContact = () => {
    setOfferContacts(prev => [...prev, { ...initialContactData, is_primary: false }]);
  };

  const offerRemoveContact = (index: number) => {
    if (offerContacts.length <= 1) return;
    setOfferContacts(prev => {
      const newContacts = prev.filter((_, i) => i !== index);
      if (prev[index].is_primary && newContacts.length > 0) {
        newContacts[0].is_primary = true;
      }
      return newContacts;
    });
  };

  const offerUpdateContact = (index: number, field: keyof ContactFormData, value: string | boolean) => {
    setOfferContacts(prev => {
      const newContacts = [...prev];
      if (field === 'is_primary' && value === true) {
        newContacts.forEach((c, i) => {
          c.is_primary = i === index;
        });
      } else {
        newContacts[index] = { ...newContacts[index], [field]: value };
      }
      return newContacts;
    });
  };

  // Auto-select offer from URL param (e.g. #/construction/offers?offerId=xxx)
  useEffect(() => {
    if (loading || autoSelectDone.current || !offers.length) return;
    // HashRouter: params are inside the hash, not in window.location.search
    const hash = window.location.hash;
    const qIndex = hash.indexOf('?');
    const params = qIndex >= 0 ? new URLSearchParams(hash.substring(qIndex)) : new URLSearchParams();
    const offerId = params.get('offerId');
    if (offerId) {
      const offer = offers.find(o => o.id === offerId);
      if (offer) {
        setSelectedOffer(offer);
        loadOfferDetails(offerId);
      }
      // Clean up URL — keep path inside hash, remove query
      const hashPath = qIndex >= 0 ? hash.substring(0, qIndex) : hash;
      window.history.replaceState({}, '', window.location.pathname + hashPath);
      autoSelectDone.current = true;
    }
  }, [loading, offers]);

  const loadOfferDetails = async (offerId: string) => {
    try {
      // Load offer with sections and items
      const [offerRes, sectionsRes, itemsRes] = await Promise.all([
        supabase
          .from('offers')
          .select('*, project:projects(*), client:contractors(*)')
          .eq('id', offerId)
          .single(),
        supabase
          .from('offer_sections')
          .select('*')
          .eq('offer_id', offerId)
          .order('sort_order'),
        supabase
          .from('offer_items')
          .select('*')
          .eq('offer_id', offerId)
          .order('sort_order')
      ]);

      // Load components for all items
      const itemIds = (itemsRes.data || []).map((i: any) => i.id);
      const componentsRes = itemIds.length > 0
        ? await supabase.from('offer_item_components').select('*').in('offer_item_id', itemIds).order('sort_order')
        : { data: [] };

      if (offerRes.data) {
        const offer = offerRes.data;
        setOfferData({
          name: offer.name,
          number: offer.number || '',
          project_id: offer.project_id || '',
          client_id: offer.client_id || '',
          valid_until: offer.valid_until ? offer.valid_until.split('T')[0] : '',
          discount_percent: offer.discount_percent || 0,
          discount_amount: offer.discount_amount || 0,
          notes: offer.notes || '',
          internal_notes: offer.internal_notes || ''
        });
        setSelectedOffer(offer);
        setIssueDate(offer.created_at ? offer.created_at.split('T')[0] : new Date().toISOString().split('T')[0]);
        setObjectName(offer.object_name || '');
        setObjectAddress(offer.object_address || '');
        setWorkStartDate(offer.work_start_date ? offer.work_start_date.split('T')[0] : '');
        setWorkEndDate(offer.work_end_date ? offer.work_end_date.split('T')[0] : '');

        // Parse print_settings for saved state
        const ps = offer.print_settings || {};
        if (ps.calculation_mode) setCalculationMode(ps.calculation_mode);
        if (ps.issue_date) setIssueDate(ps.issue_date);
        if (ps.warunki) {
          setPaymentTerm(ps.warunki.payment_term || '');
          setInvoiceFrequency(ps.warunki.invoice_frequency || '');
          setWarrantyPeriod(ps.warunki.warranty_period || '');
          if (ps.warunki.payment_term_apply !== undefined) setPaymentTermApply(ps.warunki.payment_term_apply);
          if (ps.warunki.invoice_freq_apply !== undefined) setInvoiceFreqApply(ps.warunki.invoice_freq_apply);
          if (ps.warunki.warranty_apply !== undefined) setWarrantyApply(ps.warunki.warranty_apply);
          if (ps.warunki.payment_term_options) setPaymentTermOptions(ps.warunki.payment_term_options);
          if (ps.warunki.invoice_freq_options) setInvoiceFreqOptions(ps.warunki.invoice_freq_options);
          if (ps.warunki.warranty_options) setWarrantyOptions(ps.warunki.warranty_options);
          if (ps.warunki.payment_term_rules) setPaymentTermRules(ps.warunki.payment_term_rules);
          if (ps.warunki.warranty_rules) setWarrantyRules(ps.warunki.warranty_rules);
          if (ps.warunki.invoice_freq_rules) setInvoiceFreqRules(ps.warunki.invoice_freq_rules);
          if (ps.warunki.custom_warunki) setCustomWarunki(ps.warunki.custom_warunki);
          if (ps.warunki.payment_term_show_on_offer !== undefined) setPaymentTermShowOnOffer(ps.warunki.payment_term_show_on_offer);
          if (ps.warunki.invoice_freq_show_on_offer !== undefined) setInvoiceFreqShowOnOffer(ps.warunki.invoice_freq_show_on_offer);
          if (ps.warunki.warranty_show_on_offer !== undefined) setWarrantyShowOnOffer(ps.warunki.warranty_show_on_offer);
        }
        if (ps.related_costs) setRelatedCosts(ps.related_costs);
        if (ps.show_components_in_print !== undefined) setShowComponentsInPrint(ps.show_components_in_print);
        if (ps.sms_acceptance !== undefined) setSmsAcceptance(ps.sms_acceptance);
        if (ps.negotiation_enabled !== undefined) setNegotiationEnabled(ps.negotiation_enabled);

        // Restore client data from saved print_settings and contractor
        const client = offer.client;
        if (ps.client_data || client) {
          const cd = ps.client_data || {};
          setOfferClientData(prev => ({
            ...prev,
            client_name: client?.name || cd.client_name || prev.client_name,
            nip: client?.nip || cd.nip || prev.nip,
            company_street: cd.company_street || client?.address_street || prev.company_street,
            company_street_number: cd.company_street_number || prev.company_street_number,
            company_city: cd.company_city || client?.address_city || prev.company_city,
            company_postal_code: cd.company_postal_code || client?.address_postal_code || prev.company_postal_code,
            investment_name: cd.investment_name || prev.investment_name,
            object_code: cd.object_code || prev.object_code,
            object_category_id: cd.object_category_id || prev.object_category_id,
            object_type: cd.object_type || prev.object_type,
            object_street: cd.object_street || prev.object_street,
            object_street_number: cd.object_street_number || prev.object_street_number,
            object_city: cd.object_city || prev.object_city,
            object_postal_code: cd.object_postal_code || prev.object_postal_code,
          }));
          if (cd.representative_id) setSendRepresentativeId(cd.representative_id);
          if (cd.work_type_ids) setOfferSelectedWorkTypes(cd.work_type_ids);
          if (client) setOfferClientSelected(true);
        }

        const componentsByItem = (componentsRes.data || []).reduce((acc: Record<string, OfferComponent[]>, c: any) => {
          if (!acc[c.offer_item_id]) acc[c.offer_item_id] = [];
          acc[c.offer_item_id].push({
            id: c.id,
            type: c.type,
            name: c.name,
            code: c.code || '',
            unit: c.unit || '',
            quantity: c.quantity || 1,
            unit_price: c.unit_price || 0,
            total_price: c.total_price || 0
          });
          return acc;
        }, {});

        const mapItem = (i: OfferItem): LocalOfferItem => ({
          ...i,
          unit: i.unit || 'szt.',
          isEditing: false,
          isNew: false,
          isExpanded: false,
          components: componentsByItem[i.id] || [],
          markup_percent: 0,
          cost_price: 0,
          discount_percent: i.discount_percent || 0,
          vat_rate: i.vat_rate ?? 23,
          selected: false
        });

        // Map all sections flat first
        const allSectionsMap = new Map<string, LocalOfferSection>();
        for (const s of (sectionsRes.data || [])) {
          allSectionsMap.set(s.id, {
            ...s,
            isExpanded: true,
            children: [],
            items: (itemsRes.data || [])
              .filter((i: OfferItem) => i.section_id === s.id)
              .map(mapItem)
          });
        }

        // Build tree: attach children to parents
        const rootSections: LocalOfferSection[] = [];
        for (const sec of allSectionsMap.values()) {
          if (sec.parent_id && allSectionsMap.has(sec.parent_id)) {
            const parent = allSectionsMap.get(sec.parent_id)!;
            if (!parent.children) parent.children = [];
            parent.children.push(sec);
          } else {
            rootSections.push(sec);
          }
        }
        // Sort children by sort_order
        const sortChildren = (sections: LocalOfferSection[]) => {
          sections.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
          for (const s of sections) {
            if (s.children && s.children.length > 0) sortChildren(s.children);
          }
        };
        sortChildren(rootSections);

        // Items without section
        const unsectionedItems = (itemsRes.data || [])
          .filter((i: OfferItem) => !i.section_id)
          .map(mapItem);

        if (unsectionedItems.length > 0) {
          rootSections.unshift({
            id: 'unsectioned',
            offer_id: offerId,
            name: 'Pozycje bez sekcji',
            sort_order: -1,
            isExpanded: true,
            items: unsectionedItems,
            children: [],
            created_at: '',
            updated_at: ''
          });
        }

        setSections(rootSections);
        // Progressive render: reveal sections one by one to avoid blocking UI
        setSectionsReady(0);
        const totalSections = rootSections.length;
        let revealed = 0;
        const revealNext = () => {
          revealed++;
          setSectionsReady(revealed);
          if (revealed < totalSections) {
            requestAnimationFrame(revealNext);
          }
        };
        if (totalSections > 0) requestAnimationFrame(revealNext);

        // Populate client data for edit mode (only fill name/nip if not already set from print_settings)
        if (offer.client) {
          const c = offer.client as any;
          setOfferClientData(prev => ({
            ...prev,
            client_name: prev.client_name || c.name || '',
            nip: prev.nip || c.nip || '',
            company_street: prev.company_street || c.address_street || c.street || '',
            company_street_number: prev.company_street_number || c.address_building_number || c.building_number || '',
            company_city: prev.company_city || c.address_city || c.city || '',
            company_postal_code: prev.company_postal_code || c.address_postal_code || c.postal_code || '',
            company_country: prev.company_country || c.country || 'Polska'
          }));
          setOfferClientSelected(true);
        }

        // Load client contacts for send modal
        // offer.client_id is from 'contractors' table, but contacts use 'contractors_clients' table
        // Bridge: find matching contractors_clients record by NIP or name
        if (offer.client_id) {
          let contactsClientId = '';
          const { data: contractor } = await supabase.from('contractors').select('name, nip').eq('id', offer.client_id).single();
          if (contractor) {
            const nipN = contractor.nip ? contractor.nip.replace(/\D/g, '') : '';
            if (nipN) {
              const { data: byNip } = await supabase.from('contractors_clients').select('id')
                .eq('company_id', currentUser.company_id).eq('nip', nipN).limit(1);
              if (byNip?.length) contactsClientId = byNip[0].id;
            }
            if (!contactsClientId && contractor.name) {
              const { data: byName } = await supabase.from('contractors_clients').select('id')
                .eq('company_id', currentUser.company_id).ilike('name', contractor.name).limit(1);
              if (byName?.length) contactsClientId = byName[0].id;
            }
          }
          if (contactsClientId) {
            const { data: contacts } = await supabase
              .from('contractor_client_contacts')
              .select('*')
              .eq('client_id', contactsClientId)
              .order('last_name');
            setOfferClientContacts(contacts || []);
            const ps = offer.print_settings?.client_data;
            const savedRepId = ps?.representative_id;
            const mainContact = (contacts || []).find((c: any) => c.id === savedRepId) || (contacts || []).find((c: any) => c.is_main_contact) || (contacts || [])[0];
            if (mainContact) setSendRepresentativeId(mainContact.id);
          } else {
            setOfferClientContacts([]);
          }
        }

        // Load negotiation data if status is negotiation
        if (offer.status === 'negotiation') {
          const { data: negData } = await supabase
            .from('offer_negotiations')
            .select('*, items:offer_negotiation_items(*), costs:offer_negotiation_costs(*), warunki:offer_negotiation_warunki(*)')
            .eq('offer_id', offerId)
            .order('round', { ascending: false })
            .limit(1)
            .maybeSingle();
          setNegotiationData(negData);
        } else {
          setNegotiationData(null);
        }

        // Load comments
        const { data: commentsData } = await supabase
          .from('offer_comments')
          .select('*')
          .eq('offer_id', offerId)
          .order('created_at', { ascending: true });
        setComments(commentsData || []);
      }
    } catch (err) {
      console.error('Error loading offer details:', err);
    }
  };

  // ============================================
  // COMMENTS HELPERS
  // ============================================
  const handleAddComment = async (offerId: string, itemId: string | null, parentId: string | null, text: string) => {
    if (!text.trim() || !currentUser) return;
    const authorName = `${currentUser.first_name || ''} ${currentUser.last_name || ''}`.trim() || 'Nadawca';
    await supabase.from('offer_comments').insert({
      offer_id: offerId,
      offer_item_id: itemId || null,
      parent_id: parentId || null,
      author_type: 'owner',
      author_name: authorName,
      content: text.trim()
    });
    // Mark parent as answered if replying
    if (parentId) {
      await supabase.from('offer_comments').update({ is_answered: true }).eq('id', parentId);
    }
    // Reload comments
    const { data } = await supabase
      .from('offer_comments')
      .select('*')
      .eq('offer_id', offerId)
      .order('created_at', { ascending: true });
    setComments(data || []);
    setNewCommentText('');
    setReplyText('');
    setReplyingTo(null);
  };

  const getItemCommentCount = useCallback((itemId: string) => {
    return comments.filter(c => c.offer_item_id === itemId).length;
  }, [comments]);

  const getUnreadCount = useCallback(() => {
    return comments.filter(c => !c.is_read && c.author_type === 'recipient').length;
  }, [comments]);

  const filteredComments = useMemo(() => {
    let filtered = comments;
    if (commentItemId) {
      filtered = filtered.filter(c => c.offer_item_id === commentItemId);
    }
    if (commentsFilter === 'unread') {
      filtered = filtered.filter(c => !c.is_read && c.author_type === 'recipient');
    } else if (commentsFilter === 'unanswered') {
      filtered = filtered.filter(c => !c.is_answered && c.author_type === 'recipient' && !c.parent_id);
    }
    return filtered;
  }, [comments, commentItemId, commentsFilter]);

  // ============================================
  // FILTERING
  // ============================================
  const filteredOffers = useMemo(() => {
    return offers.filter(offer => {
      const matchesSearch = offer.name.toLowerCase().includes(search.toLowerCase()) ||
        offer.number?.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === 'all' || offer.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [offers, search, statusFilter]);

  // ============================================
  // FORMATTING
  // ============================================
  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(value);

  const formatDate = (date: string | null | undefined) => {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('pl-PL');
  };

  // ============================================
  // CALCULATIONS
  // ============================================
  // Flatten all items from sections (including nested children)
  const getAllItems = useCallback((secs: LocalOfferSection[]): LocalOfferItem[] => {
    const items: LocalOfferItem[] = [];
    const collect = (sections: LocalOfferSection[]) => {
      for (const sec of sections) {
        items.push(...sec.items);
        if (sec.children) collect(sec.children);
      }
    };
    collect(secs);
    return items;
  }, []);

  const calculateTotals = useCallback(() => {
    const allItems = getAllItems(sections);
    const totalNetto = allItems.reduce((sum, i) => sum + (i.quantity * i.unit_price), 0);
    const totalCost = allItems.reduce((sum, i) => sum + (i.cost_price || 0) * i.quantity, 0);
    const totalDiscount = allItems.reduce((sum, i) => {
      const itemTotal = i.quantity * i.unit_price;
      return sum + itemTotal * ((i.discount_percent || 0) / 100);
    }, 0);
    const nettoAfterDiscount = totalNetto - totalDiscount;

    // Surcharges from warunki istotne (only applied if uwzglednij is checked)
    const ptRule = paymentTermRules.find(r => String(r.value) === paymentTerm);
    const wrRule = warrantyRules.find(r => String(r.value) === warrantyPeriod);
    const ifRule = invoiceFreqRules.find(r => String(r.value) === invoiceFrequency);
    const customSurcharge = customWarunki.reduce((s, cw) => s + (cw.apply ? cw.surcharge : 0), 0);
    const surchargePercent = (paymentTermApply ? (ptRule?.surcharge || 0) : 0) + (warrantyApply ? (wrRule?.surcharge || 0) : 0) + (invoiceFreqApply ? (ifRule?.surcharge || 0) : 0) + customSurcharge;
    const surchargeAmount = nettoAfterDiscount * (surchargePercent / 100);
    const nettoAfterSurcharges = nettoAfterDiscount + surchargeAmount;

    // Related costs (monthly costs multiplied by month count)
    const relatedCostsTotal = relatedCosts.reduce((s, c) => {
      if (c.mode === 'percent') return s + nettoAfterDiscount * (c.value / 100);
      if (c.frequency === 'monthly') {
        const months = calculateMonthsBetween(c.date_from || workStartDate, c.date_to || workEndDate);
        return s + c.value * months;
      }
      return s + c.value;
    }, 0);

    const profit = nettoAfterSurcharges - totalCost;
    const discountPercent = totalNetto > 0 ? (totalDiscount / totalNetto) * 100 : 0;
    // VAT calculation (per-item rates or default 23%)
    const totalVat = allItems.reduce((sum, i) => {
      const itemTotal = i.quantity * i.unit_price;
      const itemDiscount = itemTotal * ((i.discount_percent || 0) / 100);
      const netItem = itemTotal - itemDiscount;
      return sum + netItem * ((i.vat_rate ?? 23) / 100);
    }, 0);
    const vatOnSurcharges = surchargeAmount * 0.23; // default VAT on surcharges
    const totalBrutto = nettoAfterSurcharges + totalVat + vatOnSurcharges;
    return {
      total: totalNetto,
      totalCost,
      totalDiscount,
      discountPercent,
      nettoAfterDiscount,
      surchargePercent,
      surchargeAmount,
      nettoAfterSurcharges,
      relatedCostsTotal,
      profit,
      totalVat: totalVat + vatOnSurcharges,
      totalBrutto,
      discountPct: totalDiscount,
      discountFixed: offerData.discount_amount,
      final: Math.max(0, nettoAfterSurcharges)
    };
  }, [sections, offerData.discount_amount, getAllItems, paymentTerm, warrantyPeriod, invoiceFrequency, paymentTermRules, warrantyRules, invoiceFreqRules, relatedCosts, paymentTermApply, invoiceFreqApply, warrantyApply, customWarunki]);

  const totals = useMemo(() => calculateTotals(), [calculateTotals]);

  const selectedItemsCount = useMemo(() => {
    return getAllItems(sections).filter(i => i.selected).length;
  }, [sections, getAllItems]);

  // ============================================
  // ACTIONS - OFFER CRUD
  // ============================================
  const handleCreateOffer = async () => {
    if (!currentUser || !offerData.name.trim()) return;
    setSavingOffer(true);
    try {
      // Generate offer number
      const countRes = await supabase
        .from('offers')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', currentUser.company_id);
      const nextNum = (countRes.count || 0) + 1;
      const offerNumber = `OFR-${new Date().getFullYear()}-${String(nextNum).padStart(4, '0')}`;

      const validUntil = offerData.valid_until ||
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      // Find or create contractor from offerClientData
      let clientId: string | null = offerData.client_id || null;

      if (!clientId && offerClientData.client_name.trim()) {
        // Try to find existing contractor by NIP
        const nipNorm = offerClientData.nip ? offerClientData.nip.replace(/\D/g, '') : '';
        if (nipNorm) {
          const { data: existingByNip } = await supabase
            .from('contractors')
            .select('id')
            .eq('company_id', currentUser.company_id)
            .eq('nip', nipNorm)
            .is('deleted_at', null)
            .limit(1);
          if (existingByNip && existingByNip.length > 0) {
            clientId = existingByNip[0].id;
          }
        }

        // Try to find by name
        if (!clientId) {
          const { data: existingByName } = await supabase
            .from('contractors')
            .select('id')
            .eq('company_id', currentUser.company_id)
            .ilike('name', offerClientData.client_name.trim())
            .is('deleted_at', null)
            .limit(1);
          if (existingByName && existingByName.length > 0) {
            clientId = existingByName[0].id;
          }
        }

        // Create new contractor if not found
        if (!clientId) {
          const address = [
            offerClientData.company_street,
            offerClientData.company_street_number,
            offerClientData.company_postal_code,
            offerClientData.company_city
          ].filter(Boolean).join(', ') || null;

          const { data: newContractor } = await supabase
            .from('contractors')
            .insert({
              company_id: currentUser.company_id,
              name: offerClientData.client_name.trim(),
              nip: nipNorm || null,
              contractor_entity_type: 'legal_entity',
              contractor_type: 'customer',
              legal_address: address,
              actual_address: address,
              created_by_id: currentUser.id
            })
            .select('id')
            .single();
          if (newContractor) {
            clientId = newContractor.id;
          }
        }
      }

      // Notes: only use what the user typed, no auto-fill
      const internalNotesLines: string[] = [];
      if (offerData.internal_notes) internalNotesLines.push(offerData.internal_notes);
      if (offerClientData.internal_notes) internalNotesLines.push(offerClientData.internal_notes);

      // Generate public token for sharing
      const publicToken = crypto.randomUUID().replace(/-/g, '').substring(0, 16);

      const { data: newOffer, error } = await supabase
        .from('offers')
        .insert({
          company_id: currentUser.company_id,
          name: offerData.name.trim(),
          number: offerNumber,
          project_id: offerData.project_id || null,
          client_id: clientId,
          valid_until: validUntil,
          discount_percent: offerData.discount_percent,
          discount_amount: offerData.discount_amount,
          notes: offerData.notes || null,
          internal_notes: internalNotesLines.join('\n') || null,
          status: 'draft',
          created_by_id: currentUser.id,
          public_token: publicToken,
          public_url: `/#/offer/${publicToken}`,
          object_name: objectName || offerClientData.investment_name || null,
          object_address: objectAddress || [offerClientData.object_street, offerClientData.object_street_number, offerClientData.object_postal_code, offerClientData.object_city].filter(Boolean).join(', ') || null,
          work_start_date: workStartDate || null,
          work_end_date: workEndDate || null,
          print_settings: {
            calculation_mode: calculationMode,
            issue_date: issueDate,
            client_data: {
              client_name: offerClientData.client_name,
              nip: offerClientData.nip,
              company_street: offerClientData.company_street,
              company_street_number: offerClientData.company_street_number,
              company_city: offerClientData.company_city,
              company_postal_code: offerClientData.company_postal_code,
              investment_name: offerClientData.investment_name,
              object_code: offerClientData.object_code,
              object_category_id: offerClientData.object_category_id,
              object_type: offerClientData.object_type,
              object_street: offerClientData.object_street,
              object_street_number: offerClientData.object_street_number,
              object_city: offerClientData.object_city,
              object_postal_code: offerClientData.object_postal_code,
              representative_id: sendRepresentativeId || null,
              representative_name: (() => { const oc = offerContacts.find(c => c.first_name.trim()); if (oc) return `${oc.first_name} ${oc.last_name}`.trim(); if (showAddRepInline && newRepData.first_name) return `${newRepData.first_name} ${newRepData.last_name}`.trim(); const r = offerClientContacts.find((c: any) => c.id === sendRepresentativeId) || offerClientContacts[0]; return r ? `${r.first_name || ''} ${r.last_name || ''}`.trim() : ''; })(),
              representative_email: (() => { const oc = offerContacts.find(c => c.first_name.trim()); if (oc) return oc.email || ''; if (showAddRepInline && newRepData.first_name) return newRepData.email || ''; return (offerClientContacts.find((c: any) => c.id === sendRepresentativeId) || offerClientContacts[0])?.email || ''; })(),
              representative_phone: (() => { const oc = offerContacts.find(c => c.first_name.trim()); if (oc) return oc.phone || ''; if (showAddRepInline && newRepData.first_name) return newRepData.phone || ''; return (offerClientContacts.find((c: any) => c.id === sendRepresentativeId) || offerClientContacts[0])?.phone || ''; })(),
              representative_position: (() => { const oc = offerContacts.find(c => c.first_name.trim()); if (oc) return oc.position || ''; if (showAddRepInline && newRepData.first_name) return newRepData.position || ''; return (offerClientContacts.find((c: any) => c.id === sendRepresentativeId) || offerClientContacts[0])?.position || ''; })(),
              work_type_ids: offerSelectedWorkTypes
            },
            warunki: {
              payment_term: paymentTerm,
              invoice_frequency: invoiceFrequency,
              warranty_period: warrantyPeriod,
              payment_term_apply: paymentTermApply,
              invoice_freq_apply: invoiceFreqApply,
              warranty_apply: warrantyApply,
              payment_term_show_on_offer: paymentTermShowOnOffer,
              invoice_freq_show_on_offer: invoiceFreqShowOnOffer,
              warranty_show_on_offer: warrantyShowOnOffer,
              payment_term_options: paymentTermOptions,
              invoice_freq_options: invoiceFreqOptions,
              warranty_options: warrantyOptions,
              payment_term_rules: paymentTermRules,
              warranty_rules: warrantyRules,
              invoice_freq_rules: invoiceFreqRules,
              custom_warunki: customWarunki
            },
            company_data: {
              name: state.currentCompany?.name || '',
              nip: (state.currentCompany as any)?.nip || (state.currentCompany as any)?.tax_id || '',
              street: (state.currentCompany as any)?.street || '',
              building_number: (state.currentCompany as any)?.building_number || '',
              city: (state.currentCompany as any)?.city || '',
              postal_code: (state.currentCompany as any)?.postal_code || '',
              phone: (state.currentCompany as any)?.phone || (state.currentCompany as any)?.contact_phone || '',
              email: (state.currentCompany as any)?.email || (state.currentCompany as any)?.contact_email || '',
              logo_url: (state.currentCompany as any)?.logo_url || ''
            },
            related_costs: relatedCosts,
            show_components_in_print: showComponentsInPrint,
            sms_acceptance: smsAcceptance,
            negotiation_enabled: negotiationEnabled
          }
        })
        .select()
        .single();

      if (error) throw error;

      // Create sections and items from imported kosztorys data
      if (sections.length > 0) {
        for (const section of sections.filter(s => s.id !== 'unsectioned')) {
          // Ensure every item has a valid name string
          const safeItems = section.items
            .map((item, idx) => ({
              ...item,
              name: String(item.name || item.description || '').trim() || `Pozycja ${idx + 1}`
            }))
            .filter(item => item.name.length > 0);

          const sectionName = String(section.name || '').trim() || 'Sekcja';

          try {
            const { data: newSection } = await supabase
              .from('offer_sections')
              .insert({
                offer_id: newOffer.id,
                name: sectionName,
                description: section.description || null,
                sort_order: section.sort_order || 0
              })
              .select()
              .single();

            if (newSection && safeItems.length > 0) {
              const { data: insertedItems } = await supabase
                .from('offer_items')
                .insert(safeItems.map((item, idx) => ({
                  offer_id: newOffer.id,
                  section_id: newSection.id,
                  name: item.name,
                  description: item.description || null,
                  unit: item.unit || 'szt.',
                  quantity: item.quantity || 1,
                  unit_price: item.unit_price || 0,
                  discount_percent: item.discount_percent || 0,
                  vat_rate: item.vat_rate ?? 23,
                  sort_order: item.sort_order ?? idx,
                  is_optional: item.is_optional || false
                })))
                .select();

              // Save R/M/S components for each item
              if (insertedItems && insertedItems.length > 0) {
                const allComponents: any[] = [];
                insertedItems.forEach((newItem: any, idx: number) => {
                  const srcItem = safeItems[idx];
                  if (srcItem?.components && srcItem.components.length > 0) {
                    srcItem.components.forEach((comp: any, ci: number) => {
                      allComponents.push({
                        offer_item_id: newItem.id,
                        type: comp.type || 'material',
                        name: comp.name || '',
                        code: comp.code || '',
                        unit: comp.unit || 'szt.',
                        quantity: comp.quantity || 0,
                        unit_price: comp.unit_price || 0,
                        total_price: comp.total_price || 0,
                        sort_order: ci
                      });
                    });
                  }
                });
                if (allComponents.length > 0) {
                  await supabase.from('offer_item_components').insert(allComponents);
                }
              }
            }
          } catch (sectionErr) {
            console.warn('Error inserting section/items, skipping:', sectionErr);
          }
        }

        // Unsectioned items
        const unsectioned = sections.find(s => s.id === 'unsectioned');
        if (unsectioned && unsectioned.items.length > 0) {
          const safeItems = unsectioned.items
            .map((item, idx) => ({
              ...item,
              name: String(item.name || item.description || '').trim() || `Pozycja ${idx + 1}`
            }))
            .filter(item => item.name.length > 0);

          if (safeItems.length > 0) {
            try {
              const { data: insertedItems } = await supabase
                .from('offer_items')
                .insert(safeItems.map((item, idx) => ({
                  offer_id: newOffer.id,
                  section_id: null,
                  name: item.name,
                  description: item.description || null,
                  unit: item.unit || 'szt.',
                  quantity: item.quantity || 1,
                  unit_price: item.unit_price || 0,
                  discount_percent: item.discount_percent || 0,
                  vat_rate: item.vat_rate ?? 23,
                  sort_order: item.sort_order ?? idx,
                  is_optional: item.is_optional || false
                })))
                .select();

              // Save R/M/S components
              if (insertedItems && insertedItems.length > 0) {
                const allComponents: any[] = [];
                insertedItems.forEach((newItem: any, idx: number) => {
                  const srcItem = safeItems[idx];
                  if (srcItem?.components && srcItem.components.length > 0) {
                    srcItem.components.forEach((comp: any, ci: number) => {
                      allComponents.push({
                        offer_item_id: newItem.id,
                        type: comp.type || 'material',
                        name: comp.name || '',
                        code: comp.code || '',
                        unit: comp.unit || 'szt.',
                        quantity: comp.quantity || 0,
                        unit_price: comp.unit_price || 0,
                        total_price: comp.total_price || 0,
                        sort_order: ci
                      });
                    });
                  }
                });
                if (allComponents.length > 0) {
                  await supabase.from('offer_item_components').insert(allComponents);
                }
              }
            } catch (itemErr) {
              console.warn('Error inserting unsectioned items, skipping:', itemErr);
            }
          }
        }
      }

      // Always sync client to contractors_clients (kartoteka) when creating offer
      let contactsClientIdC = '';
      if (offerClientData.client_name.trim()) {
        const nipNormC = offerClientData.nip ? offerClientData.nip.replace(/\D/g, '') : '';
        if (nipNormC) {
          const { data: byNip } = await supabase.from('contractors_clients').select('id')
            .eq('company_id', currentUser.company_id).eq('nip', nipNormC).limit(1);
          if (byNip?.length) contactsClientIdC = byNip[0].id;
        }
        if (!contactsClientIdC) {
          const { data: byName } = await supabase.from('contractors_clients').select('id')
            .eq('company_id', currentUser.company_id).ilike('name', offerClientData.client_name.trim()).limit(1);
          if (byName?.length) contactsClientIdC = byName[0].id;
        }
        if (!contactsClientIdC) {
          const { data: newCl } = await supabase.from('contractors_clients').insert({
            company_id: currentUser.company_id, name: offerClientData.client_name.trim(),
            nip: nipNormC || null,
            address_street: offerClientData.company_street ? `${offerClientData.company_street} ${offerClientData.company_street_number || ''}`.trim() : null,
            address_city: offerClientData.company_city || null,
            address_postal_code: offerClientData.company_postal_code || null
          }).select('id').single();
          if (newCl) contactsClientIdC = newCl.id;
        }
      }

      // Save representative contacts if added (from create modal offerContacts or inline newRepData)
      if (contactsClientIdC) {
        // From create modal form (offerContacts)
        const validContacts = offerContacts.filter(c => c.first_name.trim() && c.last_name.trim());
        for (const contact of validContacts) {
          const { data: savedContact } = await supabase.from('contractor_client_contacts').insert({
            client_id: contactsClientIdC, company_id: currentUser.company_id,
            first_name: contact.first_name.trim(), last_name: contact.last_name.trim(),
            phone: contact.phone || null, email: contact.email || null,
            position: contact.position || null, is_main_contact: contact.is_primary || false
          }).select().single();
          if (savedContact) {
            setSendRepresentativeId(savedContact.id);
          }
        }
        // From inline form (edit mode fallback)
        if (validContacts.length === 0 && showAddRepInline && newRepData.first_name.trim() && newRepData.last_name.trim()) {
          const { data: savedContact } = await supabase.from('contractor_client_contacts').insert({
            client_id: contactsClientIdC, company_id: currentUser.company_id,
            first_name: newRepData.first_name.trim(), last_name: newRepData.last_name.trim(),
            phone: newRepData.phone || null, email: newRepData.email || null,
            position: newRepData.position || null, is_main_contact: newRepData.is_main_contact
          }).select().single();
          if (savedContact) {
            setSendRepresentativeId(savedContact.id);
          }
        }
      }
      setShowAddRepInline(false);
      setNewRepData({ first_name: '', last_name: '', phone: '', email: '', position: '', is_main_contact: true });

      await loadData();
      setShowCreateModal(false);
      resetOfferForm();

      // Navigate to the newly created offer
      setSelectedOffer(newOffer);
      loadOfferDetails(newOffer.id);
    } catch (err) {
      console.error('Error creating offer:', err);
    } finally {
      setSavingOffer(false);
    }
  };

  const handleUpdateOffer = async () => {
    if (!currentUser || !selectedOffer) return;
    setSavingOffer(true);
    try {
      // Calculate final amount
      const allItemsFlat = getAllItems(sections);
      const totalNetto = allItemsFlat.reduce((sum, i) => sum + (i.quantity * i.unit_price), 0);
      const totalDisc = allItemsFlat.reduce((sum, i) => sum + (i.quantity * i.unit_price) * ((i.discount_percent || 0) / 100), 0);
      const finalAmount = totalNetto - totalDisc;

      // Resolve client_id: find or create contractor if needed (before offer update)
      let resolvedClientId = offerData.client_id || (selectedOffer as any)?.client_id || '';
      if (!resolvedClientId && offerClientData.client_name.trim()) {
        const nipNorm = offerClientData.nip ? offerClientData.nip.replace(/\D/g, '') : '';
        if (nipNorm) {
          const { data: byNip } = await supabase.from('contractors').select('id')
            .eq('company_id', currentUser.company_id).eq('nip', nipNorm).is('deleted_at', null).limit(1);
          if (byNip?.length) resolvedClientId = byNip[0].id;
        }
        if (!resolvedClientId) {
          const { data: byName } = await supabase.from('contractors').select('id')
            .eq('company_id', currentUser.company_id).ilike('name', offerClientData.client_name.trim()).is('deleted_at', null).limit(1);
          if (byName?.length) resolvedClientId = byName[0].id;
        }
        if (!resolvedClientId) {
          const address = [offerClientData.company_street, offerClientData.company_street_number, offerClientData.company_postal_code, offerClientData.company_city].filter(Boolean).join(', ') || null;
          const nipNorm2 = offerClientData.nip ? offerClientData.nip.replace(/\D/g, '') : '';
          const { data: newC } = await supabase.from('contractors').insert({
            company_id: currentUser.company_id, name: offerClientData.client_name.trim(),
            nip: nipNorm2 || null, contractor_entity_type: 'legal_entity', contractor_type: 'customer',
            legal_address: address, actual_address: address, created_by_id: currentUser.id
          }).select('id').single();
          if (newC) resolvedClientId = newC.id;
        }
      }

      // Always sync client to contractors_clients (kartoteka) when saving offer
      let contactsClientId = '';
      if (offerClientData.client_name.trim()) {
        const nipNorm = offerClientData.nip ? offerClientData.nip.replace(/\D/g, '') : '';
        if (nipNorm) {
          const { data: byNip } = await supabase.from('contractors_clients').select('id')
            .eq('company_id', currentUser.company_id).eq('nip', nipNorm).limit(1);
          if (byNip?.length) contactsClientId = byNip[0].id;
        }
        if (!contactsClientId) {
          const { data: byName } = await supabase.from('contractors_clients').select('id')
            .eq('company_id', currentUser.company_id).ilike('name', offerClientData.client_name.trim()).limit(1);
          if (byName?.length) contactsClientId = byName[0].id;
        }
        if (!contactsClientId) {
          const { data: newCl } = await supabase.from('contractors_clients').insert({
            company_id: currentUser.company_id, name: offerClientData.client_name.trim(),
            nip: nipNorm || null,
            address_street: offerClientData.company_street ? `${offerClientData.company_street} ${offerClientData.company_street_number || ''}`.trim() : null,
            address_city: offerClientData.company_city || null,
            address_postal_code: offerClientData.company_postal_code || null
          }).select('id').single();
          if (newCl) contactsClientId = newCl.id;
        }
      }

      // Save new representative contact BEFORE offer update
      const inlineRepActive = showAddRepInline && newRepData.first_name.trim() && newRepData.last_name.trim();
      const inlineRepSnapshot = inlineRepActive ? { ...newRepData } : null;
      let savedRepId = sendRepresentativeId || '';

      if (inlineRepActive && contactsClientId) {
        const { data: savedContact, error: contactErr } = await supabase.from('contractor_client_contacts').insert({
          client_id: contactsClientId, company_id: currentUser.company_id,
          first_name: inlineRepSnapshot!.first_name.trim(), last_name: inlineRepSnapshot!.last_name.trim(),
          phone: inlineRepSnapshot!.phone || null, email: inlineRepSnapshot!.email || null,
          position: inlineRepSnapshot!.position || null, is_main_contact: inlineRepSnapshot!.is_main_contact
        }).select().single();
        if (savedContact) {
          savedRepId = savedContact.id;
          setOfferClientContacts(prev => [...prev, savedContact]);
          setSendRepresentativeId(savedContact.id);
        }
        if (contactErr) console.error('Contact save error:', contactErr);
        setShowAddRepInline(false);
        setNewRepData({ first_name: '', last_name: '', phone: '', email: '', position: '', is_main_contact: true });
      }

      // Build representative data for print_settings (always use inline data if it was active)
      const repFromContacts = offerClientContacts.find((c: any) => c.id === sendRepresentativeId) || offerClientContacts[0];
      const repName = inlineRepSnapshot ? `${inlineRepSnapshot.first_name} ${inlineRepSnapshot.last_name}`.trim()
        : repFromContacts ? `${repFromContacts.first_name || ''} ${repFromContacts.last_name || ''}`.trim() : '';
      const repEmail = inlineRepSnapshot ? (inlineRepSnapshot.email || '') : repFromContacts?.email || '';
      const repPhone = inlineRepSnapshot ? (inlineRepSnapshot.phone || '') : repFromContacts?.phone || '';
      const repPosition = inlineRepSnapshot ? (inlineRepSnapshot.position || '') : repFromContacts?.position || '';

      // Update offer
      await supabase
        .from('offers')
        .update({
          name: offerData.name.trim(),
          number: offerData.number || selectedOffer.number,
          project_id: offerData.project_id || null,
          client_id: resolvedClientId || null,
          valid_until: offerData.valid_until || null,
          discount_percent: offerData.discount_percent,
          discount_amount: offerData.discount_amount,
          total_amount: totalNetto,
          final_amount: finalAmount,
          notes: offerData.notes,
          internal_notes: offerData.internal_notes,
          object_name: objectName || null,
          object_address: objectAddress || null,
          work_start_date: workStartDate || null,
          work_end_date: workEndDate || null,
          print_settings: {
            calculation_mode: calculationMode,
            issue_date: issueDate,
            client_data: {
              client_name: offerClientData.client_name,
              nip: offerClientData.nip,
              company_street: offerClientData.company_street,
              company_street_number: offerClientData.company_street_number,
              company_city: offerClientData.company_city,
              company_postal_code: offerClientData.company_postal_code,
              investment_name: offerClientData.investment_name,
              object_code: offerClientData.object_code,
              object_category_id: offerClientData.object_category_id,
              object_type: offerClientData.object_type,
              object_street: offerClientData.object_street,
              object_street_number: offerClientData.object_street_number,
              object_city: offerClientData.object_city,
              object_postal_code: offerClientData.object_postal_code,
              representative_id: savedRepId || sendRepresentativeId || null,
              representative_name: repName,
              representative_email: repEmail,
              representative_phone: repPhone,
              representative_position: repPosition,
              work_type_ids: offerSelectedWorkTypes
            },
            warunki: {
              payment_term: paymentTerm,
              invoice_frequency: invoiceFrequency,
              warranty_period: warrantyPeriod,
              payment_term_apply: paymentTermApply,
              invoice_freq_apply: invoiceFreqApply,
              warranty_apply: warrantyApply,
              payment_term_show_on_offer: paymentTermShowOnOffer,
              invoice_freq_show_on_offer: invoiceFreqShowOnOffer,
              warranty_show_on_offer: warrantyShowOnOffer,
              payment_term_options: paymentTermOptions,
              invoice_freq_options: invoiceFreqOptions,
              warranty_options: warrantyOptions,
              payment_term_rules: paymentTermRules,
              warranty_rules: warrantyRules,
              invoice_freq_rules: invoiceFreqRules,
              custom_warunki: customWarunki
            },
            company_data: {
              name: state.currentCompany?.name || '',
              nip: (state.currentCompany as any)?.nip || (state.currentCompany as any)?.tax_id || '',
              street: (state.currentCompany as any)?.street || '',
              building_number: (state.currentCompany as any)?.building_number || '',
              city: (state.currentCompany as any)?.city || '',
              postal_code: (state.currentCompany as any)?.postal_code || '',
              phone: (state.currentCompany as any)?.phone || (state.currentCompany as any)?.contact_phone || '',
              email: (state.currentCompany as any)?.email || (state.currentCompany as any)?.contact_email || '',
              logo_url: (state.currentCompany as any)?.logo_url || ''
            },
            related_costs: relatedCosts,
            show_components_in_print: showComponentsInPrint,
            sms_acceptance: smsAcceptance,
            negotiation_enabled: negotiationEnabled
          }
        })
        .eq('id', selectedOffer.id);

      // Delete existing sections and items (will re-create)
      await supabase.from('offer_sections').delete().eq('offer_id', selectedOffer.id);
      await supabase.from('offer_items').delete().eq('offer_id', selectedOffer.id);

      // Helper to save sections recursively (including children)
      const saveSectionsRecursive = async (secs: LocalOfferSection[], parentSectionId?: string) => {
        for (const section of secs.filter(s => s.id !== 'unsectioned')) {
          const validItems = section.items.filter(item => item.name && item.name.trim());
          if (validItems.length === 0 && !section.name && (!section.children || section.children.length === 0)) continue;

          const { data: newSection } = await supabase
            .from('offer_sections')
            .insert({
              offer_id: selectedOffer.id,
              name: section.name || 'Sekcja',
              description: section.description,
              sort_order: section.sort_order
            })
            .select()
            .single();

          if (newSection && validItems.length > 0) {
            const { data: savedItems } = await supabase
              .from('offer_items')
              .insert(validItems.map(item => ({
                offer_id: selectedOffer.id,
                section_id: newSection.id,
                name: item.name.trim(),
                description: item.description || null,
                unit: item.unit || 'szt.',
                quantity: item.quantity || 1,
                unit_price: item.unit_price || 0,
                discount_percent: item.discount_percent || 0,
                vat_rate: item.vat_rate ?? 23,
                sort_order: item.sort_order,
                is_optional: item.is_optional || false,
                source_resource_id: item.source_resource_id || null
              })))
              .select('id, sort_order');

            // Save components for each item
            if (savedItems) {
              const allComponents: any[] = [];
              for (const savedItem of savedItems) {
                const localItem = validItems.find(vi => vi.sort_order === savedItem.sort_order);
                if (localItem?.components && localItem.components.length > 0) {
                  localItem.components.forEach((comp, ci) => {
                    allComponents.push({
                      offer_item_id: savedItem.id,
                      type: comp.type,
                      name: comp.name,
                      code: comp.code || '',
                      unit: comp.unit || '',
                      quantity: comp.quantity || 1,
                      unit_price: comp.unit_price || 0,
                      total_price: comp.total_price || 0,
                      sort_order: ci
                    });
                  });
                }
              }
              if (allComponents.length > 0) {
                await supabase.from('offer_item_components').insert(allComponents);
              }
            }
          }

          // Save children recursively
          if (section.children && section.children.length > 0) {
            await saveSectionsRecursive(section.children, newSection?.id);
          }
        }
      };

      // Save all sections recursively (including nested children)
      await saveSectionsRecursive(sections);

      // Unsectioned items
      const unsectioned = sections.find(s => s.id === 'unsectioned');
      if (unsectioned) {
        const validItems = unsectioned.items.filter(item => item.name && item.name.trim());
        if (validItems.length > 0) {
          const { data: savedUnsectioned } = await supabase
            .from('offer_items')
            .insert(validItems.map(item => ({
              offer_id: selectedOffer.id,
              section_id: null,
              name: item.name.trim(),
              description: item.description || null,
              unit: item.unit || 'szt.',
              quantity: item.quantity || 1,
              unit_price: item.unit_price || 0,
              discount_percent: item.discount_percent || 0,
              vat_rate: item.vat_rate ?? 23,
              sort_order: item.sort_order,
              is_optional: item.is_optional || false,
              source_resource_id: item.source_resource_id || null
            })))
            .select('id, sort_order');

          // Save components for unsectioned items
          if (savedUnsectioned) {
            const allComponents: any[] = [];
            for (const savedItem of savedUnsectioned) {
              const localItem = validItems.find(vi => vi.sort_order === savedItem.sort_order);
              if (localItem?.components && localItem.components.length > 0) {
                localItem.components.forEach((comp, ci) => {
                  allComponents.push({
                    offer_item_id: savedItem.id,
                    type: comp.type,
                    name: comp.name,
                    code: comp.code || '',
                    unit: comp.unit || '',
                    quantity: comp.quantity || 1,
                    unit_price: comp.unit_price || 0,
                    total_price: comp.total_price || 0,
                    sort_order: ci
                  });
                });
              }
            }
            if (allComponents.length > 0) {
              await supabase.from('offer_item_components').insert(allComponents);
            }
          }
        }
      }

      await loadData();
      setEditMode(false);
      await loadOfferDetails(selectedOffer.id);
      showToast('Oferta została zapisana', 'success');
    } catch (err) {
      console.error('Error updating offer:', err);
      showToast('Błąd podczas zapisywania oferty', 'error');
    } finally {
      setSavingOffer(false);
    }
  };

  const handleDeleteOffer = async (offer: Offer) => {
    showConfirm({
      title: 'Usunąć ofertę?',
      message: `Oferta "${offer.name}" zostanie przeniesiona do kosza.`,
      confirmLabel: 'Usuń',
      destructive: true,
      onConfirm: async () => {
        try {
          await supabase
            .from('offers')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', offer.id);
          await loadData();
          if (selectedOffer?.id === offer.id) {
            setSelectedOffer(null);
          }
          showToast('Oferta została usunięta', 'success');
        } catch (err) {
          console.error('Error deleting offer:', err);
          showToast('Błąd podczas usuwania oferty', 'error');
        }
      }
    });
  };

  const handleDuplicateOffer = async (offer: Offer) => {
    try {
      // Generate new number
      const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
      const newNumber = `OF-${dateStr}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;

      // Create new offer as draft copy
      const { data: newOffer, error } = await supabase
        .from('offers')
        .insert({
          company_id: offer.company_id,
          name: `${offer.name} (kopia)`,
          number: newNumber,
          project_id: offer.project_id,
          client_id: offer.client_id,
          status: 'draft',
          valid_until: offer.valid_until,
          discount_percent: offer.discount_percent,
          discount_amount: offer.discount_amount,
          notes: offer.notes,
          internal_notes: offer.internal_notes,
          print_settings: offer.print_settings
        })
        .select()
        .single();

      if (error || !newOffer) throw error;

      // Copy sections and items
      const { data: srcSections } = await supabase
        .from('offer_sections')
        .select('*')
        .eq('offer_id', offer.id)
        .order('sort_order');

      if (srcSections && srcSections.length > 0) {
        for (const sec of srcSections) {
          const { data: newSec } = await supabase
            .from('offer_sections')
            .insert({ offer_id: newOffer.id, name: sec.name, sort_order: sec.sort_order, parent_id: null })
            .select()
            .single();

          if (newSec) {
            const { data: srcItems } = await supabase
              .from('offer_items')
              .select('*')
              .eq('section_id', sec.id)
              .order('sort_order');

            if (srcItems && srcItems.length > 0) {
              await supabase.from('offer_items').insert(
                srcItems.map(item => ({
                  offer_id: newOffer.id,
                  section_id: newSec.id,
                  name: item.name,
                  description: item.description,
                  unit: item.unit,
                  quantity: item.quantity,
                  unit_price: item.unit_price,
                  discount_percent: item.discount_percent,
                  vat_rate: item.vat_rate,
                  sort_order: item.sort_order
                }))
              );
            }
          }
        }
      }

      await loadData();
      showToast('Oferta została zduplikowana', 'success');
    } catch (err) {
      console.error('Error duplicating offer:', err);
      showToast('Błąd podczas duplikowania oferty', 'error');
    }
  };

  const handleOpenEditOffer = (offer: Offer) => {
    setEditingOffer(offer);
    setEditForm({
      name: offer.name || '',
      project_id: (offer as any).project?.id || offer.project_id || '',
      client_id: (offer as any).client?.id || offer.client_id || '',
      valid_until: offer.valid_until ? offer.valid_until.split('T')[0] : '',
      notes: offer.notes || ''
    });
    // Pre-populate client data from the offer's client
    const client = (offer as any).client;
    if (client) {
      setOfferClientData(prev => ({
        ...prev,
        client_name: client.name || '',
        nip: client.nip || '',
        company_street: client.address_street || '',
        company_street_number: client.address_street_number || '',
        company_city: client.address_city || '',
        company_postal_code: client.address_postal_code || '',
        internal_notes: offer.notes || ''
      }));
    } else {
      resetOfferClientData();
    }
    setShowEditModal(true);
  };

  const handleSaveEditOffer = async () => {
    if (!editingOffer || !currentUser) return;
    setSavingOffer(true);
    try {
      // Resolve client_id from offerClientData (find or create in contractors)
      let resolvedClientId = editForm.client_id || '';
      if (!resolvedClientId && offerClientData.client_name.trim()) {
        const nipNorm = offerClientData.nip ? offerClientData.nip.replace(/\D/g, '') : '';
        if (nipNorm) {
          const { data: byNip } = await supabase.from('contractors').select('id')
            .eq('company_id', currentUser.company_id).eq('nip', nipNorm).is('deleted_at', null).limit(1);
          if (byNip?.length) resolvedClientId = byNip[0].id;
        }
        if (!resolvedClientId) {
          const { data: byName } = await supabase.from('contractors').select('id')
            .eq('company_id', currentUser.company_id).ilike('name', offerClientData.client_name.trim()).is('deleted_at', null).limit(1);
          if (byName?.length) resolvedClientId = byName[0].id;
        }
        if (!resolvedClientId) {
          const address = [offerClientData.company_street, offerClientData.company_street_number, offerClientData.company_postal_code, offerClientData.company_city].filter(Boolean).join(', ') || null;
          const { data: newC } = await supabase.from('contractors').insert({
            company_id: currentUser.company_id, name: offerClientData.client_name.trim(),
            nip: nipNorm || null, contractor_entity_type: 'legal_entity', contractor_type: 'customer',
            legal_address: address, actual_address: address, created_by_id: currentUser.id
          }).select('id').single();
          if (newC) resolvedClientId = newC.id;
        }
      }

      // Sync client to contractors_clients (kartoteka)
      let contactsClientId = '';
      if (offerClientData.client_name.trim()) {
        const nipNorm = offerClientData.nip ? offerClientData.nip.replace(/\D/g, '') : '';
        if (nipNorm) {
          const { data: byNip } = await supabase.from('contractors_clients').select('id')
            .eq('company_id', currentUser.company_id).eq('nip', nipNorm).limit(1);
          if (byNip?.length) contactsClientId = byNip[0].id;
        }
        if (!contactsClientId) {
          const { data: byName } = await supabase.from('contractors_clients').select('id')
            .eq('company_id', currentUser.company_id).ilike('name', offerClientData.client_name.trim()).limit(1);
          if (byName?.length) contactsClientId = byName[0].id;
        }
        if (!contactsClientId) {
          const { data: newCl } = await supabase.from('contractors_clients').insert({
            company_id: currentUser.company_id, name: offerClientData.client_name.trim(),
            nip: nipNorm || null,
            address_street: offerClientData.company_street ? `${offerClientData.company_street} ${offerClientData.company_street_number || ''}`.trim() : null,
            address_city: offerClientData.company_city || null,
            address_postal_code: offerClientData.company_postal_code || null
          }).select('id').single();
          if (newCl) contactsClientId = newCl.id;
        }
      }

      // Save contacts from offerContacts form
      let savedRepId = '';
      if (contactsClientId) {
        const validContacts = offerContacts.filter(c => c.first_name.trim() && c.last_name.trim());
        for (const contact of validContacts) {
          // Check if this contact already exists (by name)
          const { data: existing } = await supabase.from('contractor_client_contacts').select('id')
            .eq('client_id', contactsClientId).ilike('first_name', contact.first_name.trim()).ilike('last_name', contact.last_name.trim()).limit(1);
          if (existing?.length) {
            savedRepId = existing[0].id;
          } else {
            const { data: savedContact } = await supabase.from('contractor_client_contacts').insert({
              client_id: contactsClientId, company_id: currentUser.company_id,
              first_name: contact.first_name.trim(), last_name: contact.last_name.trim(),
              phone: contact.phone || null, email: contact.email || null,
              position: contact.position || null, is_main_contact: contact.is_primary || false
            }).select().single();
            if (savedContact) savedRepId = savedContact.id;
          }
        }
      }

      // Build representative data for print_settings
      const repContact = offerContacts.find(c => c.first_name.trim());
      const repName = repContact ? `${repContact.first_name} ${repContact.last_name}`.trim() : '';
      const repEmail = repContact?.email || '';
      const repPhone = repContact?.phone || '';
      const repPosition = repContact?.position || '';

      // Merge existing print_settings
      const existingPs = editingOffer.print_settings || {};
      const existingClientData = existingPs.client_data || {};

      await supabase
        .from('offers')
        .update({
          name: editForm.name.trim(),
          project_id: editForm.project_id || null,
          client_id: resolvedClientId || null,
          valid_until: editForm.valid_until || null,
          notes: editForm.notes || null,
          print_settings: {
            ...existingPs,
            client_data: {
              ...existingClientData,
              client_name: offerClientData.client_name || existingClientData.client_name,
              nip: offerClientData.nip || existingClientData.nip,
              company_street: offerClientData.company_street || existingClientData.company_street,
              company_street_number: offerClientData.company_street_number || existingClientData.company_street_number,
              company_city: offerClientData.company_city || existingClientData.company_city,
              company_postal_code: offerClientData.company_postal_code || existingClientData.company_postal_code,
              representative_id: savedRepId || existingClientData.representative_id || null,
              representative_name: repName || existingClientData.representative_name || '',
              representative_email: repEmail || existingClientData.representative_email || '',
              representative_phone: repPhone || existingClientData.representative_phone || '',
              representative_position: repPosition || existingClientData.representative_position || ''
            }
          }
        })
        .eq('id', editingOffer.id);

      await loadData();
      setShowEditModal(false);
      setEditingOffer(null);
      // Reload offer details if viewing it
      if (selectedOffer?.id === editingOffer.id) {
        loadOfferDetails(editingOffer.id);
      }
    } catch (err) {
      console.error('Error updating offer:', err);
    } finally {
      setSavingOffer(false);
    }
  };

  const handleSendOffer = async (offer: Offer, channels?: string[], coverLetter?: string): Promise<{ success: boolean; errors: string[] }> => {
    if (!currentUser) return { success: false, errors: ['Brak zalogowanego użytkownika'] };
    const errors: string[] = [];
    try {
      const offerUrl = offer.public_url
        ? window.location.origin + offer.public_url
        : `${window.location.origin}/#/offer/${offer.public_token || offer.id?.substring(0, 8) || ''}`;

      // Generate public token if not exists
      if (!offer.public_token) {
        const token = offer.id.substring(0, 8);
        await supabase.from('offers').update({ public_token: token }).eq('id', offer.id);
      }

      const activeChannels = channels || sendChannels;
      const letter = coverLetter || sendCoverLetter;

      // Find representative contact (fallback to manual input)
      const rep = offerClientContacts.find((c: any) => c.id === sendRepresentativeId) || offerClientContacts[0];
      const repEmail = rep?.email || sendManualContact.email || '';
      const repPhone = (rep?.phone || sendManualContact.phone || '').replace(/\s/g, '');

      // Send via selected channels
      for (const channel of activeChannels) {
        if (channel === 'email' && repEmail) {
          try {
            await supabase.functions.invoke('send-email', {
              body: {
                to: repEmail,
                subject: `Oferta ${offer.number} — ${offer.name}`,
                html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
                  <div style="background:linear-gradient(135deg,#3b82f6 0%,#1d4ed8 100%);padding:30px;text-align:center;">
                    <h1 style="color:white;margin:0;">${state.currentCompany?.name || 'Firma'}</h1>
                  </div>
                  <div style="padding:30px;background:#f8fafc;">
                    <p style="color:#475569;">${letter.replace(/\n/g, '<br/>')}</p>
                    <div style="margin:20px 0;padding:20px;background:white;border-radius:8px;border:1px solid #e2e8f0;">
                      <p style="margin:0;font-weight:bold;color:#1e293b;">${offer.name}</p>
                      <p style="margin:5px 0 0;color:#64748b;">Nr: ${offer.number}</p>
                    </div>
                    <a href="${offerUrl}" style="display:inline-block;background:#3b82f6;color:white;padding:12px 24px;text-decoration:none;border-radius:8px;">Zobacz ofertę online</a>
                  </div>
                  <div style="padding:15px;text-align:center;color:#94a3b8;font-size:11px;">
                    <p>Wygenerowano w MaxMaster</p>
                  </div>
                </div>`,
                template: 'CUSTOM'
              }
            });
          } catch (e) {
            errors.push(`E-mail: ${e instanceof Error ? e.message : 'błąd wysyłki'}`);
          }
        } else if (channel === 'email' && !repEmail) {
          errors.push('E-mail: brak adresu e-mail przedstawiciela');
        }

        if (channel === 'sms' && repPhone) {
          const smsText = `Oferta ${offer.number} od ${state.currentCompany?.name || 'firmy'} jest gotowa. Zobacz: ${offerUrl}`;
          try {
            await supabase.functions.invoke('send-sms', {
              body: { phoneNumber: repPhone, message: smsText }
            });
          } catch (e) {
            errors.push(`SMS: ${e instanceof Error ? e.message : 'błąd wysyłki'}`);
          }
        } else if (channel === 'sms' && !repPhone) {
          errors.push('SMS: brak numeru telefonu przedstawiciela');
        }

        if (channel === 'whatsapp' && repPhone) {
          const phone = repPhone.startsWith('+') ? repPhone.substring(1) : (repPhone.startsWith('48') ? repPhone : '48' + repPhone);
          const waText = encodeURIComponent(`${letter}\n\nZobacz ofertę: ${offerUrl}`);
          window.open(`https://wa.me/${phone}?text=${waText}`, '_blank');
        }

        if (channel === 'telegram' && repPhone) {
          const tgText = encodeURIComponent(`${letter}\n\nZobacz ofertę: ${offerUrl}`);
          window.open(`https://t.me/share/url?url=${encodeURIComponent(offerUrl)}&text=${tgText}`, '_blank');
        }
      }

      // Update offer status
      await supabase
        .from('offers')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString()
        })
        .eq('id', offer.id);

      await loadData();
      if (selectedOffer?.id === offer.id) {
        await loadOfferDetails(offer.id);
      }
      return { success: errors.length === 0, errors };
    } catch (err) {
      console.error('Error sending offer:', err);
      return { success: false, errors: [err instanceof Error ? err.message : 'Nieznany błąd'] };
    }
  };

  const handleAcceptOffer = async (offer: Offer) => {
    showConfirm({
      title: 'Zaakceptować ofertę?',
      message: `Status oferty "${offer.name}" zostanie zmieniony na "Zaakceptowana".`,
      confirmLabel: 'Zaakceptuj',
      onConfirm: async () => {
        try {
          await supabase
            .from('offers')
            .update({
              status: 'accepted',
              accepted_at: new Date().toISOString()
            })
            .eq('id', offer.id);
          await loadData();
          if (selectedOffer?.id === offer.id) {
            await loadOfferDetails(offer.id);
          }
          showToast('Oferta została zaakceptowana', 'success');
        } catch (err) {
          console.error('Error accepting offer:', err);
          showToast('Błąd podczas akceptacji oferty', 'error');
        }
      }
    });
  };

  const handleRejectOffer = async (offer: Offer) => {
    showConfirm({
      title: 'Odrzucić ofertę?',
      message: 'Podaj powód odrzucenia (opcjonalnie):',
      confirmLabel: 'Odrzuć',
      destructive: true,
      showInput: true,
      inputPlaceholder: 'Powód odrzucenia...',
      inputValue: '',
      onConfirm: async (inputVal?: string) => {
        const reason = inputVal || '';
        try {
          await supabase
            .from('offers')
            .update({
              status: 'rejected',
              rejected_at: new Date().toISOString(),
              internal_notes: offer.internal_notes
                ? `${offer.internal_notes}\n\nPowód odrzucenia: ${reason || 'Brak'}`
                : `Powód odrzucenia: ${reason || 'Brak'}`
            })
            .eq('id', offer.id);
          await loadData();
          if (selectedOffer?.id === offer.id) {
            await loadOfferDetails(offer.id);
          }
          showToast('Oferta została odrzucona', 'info');
        } catch (err) {
          console.error('Error rejecting offer:', err);
          showToast('Błąd podczas odrzucania oferty', 'error');
        }
      }
    });
  };

  const copyPublicLink = (offer: Offer) => {
    const url = offer.public_url
      ? window.location.origin + offer.public_url
      : `${window.location.origin}/#/offer/${offer.public_token || offer.id.substring(0, 8)}`;
    navigator.clipboard.writeText(url);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  // ============================================
  // IMPORT FROM ESTIMATE
  // ============================================
  const handleImportFromEstimate = async () => {
    if (!selectedEstimateId || !currentUser) return;
    setImportLoading(true);
    try {
      // First get the estimate to find the project_id
      const { data: estimate } = await supabase
        .from('estimates')
        .select('*')
        .eq('id', selectedEstimateId)
        .single();

      if (!estimate) {
        showToast('Nie znaleziono kosztorysu', 'error');
        setImportLoading(false);
        return;
      }

      // Load stages, tasks, resources using project_id (as Estimates module saves them)
      const [stagesRes, tasksRes, resourcesRes] = await Promise.all([
        supabase
          .from('estimate_stages')
          .select('*')
          .eq('project_id', estimate.project_id)
          .order('sort_order'),
        supabase
          .from('estimate_tasks')
          .select('*')
          .eq('project_id', estimate.project_id)
          .order('sort_order'),
        supabase
          .from('estimate_resources')
          .select('*')
          .eq('project_id', estimate.project_id)
          .order('sort_order')
      ]);

      const stages = stagesRes.data || [];
      const tasks = tasksRes.data || [];
      const resources = resourcesRes.data || [];

      // Set offer data from estimate
      setOfferData(prev => ({
        ...prev,
        name: `Oferta - ${estimate.name}`,
        project_id: estimate.project_id || '',
        notes: estimate.notes || ''
      }));

      // Build sections from stages
      const newSections: LocalOfferSection[] = stages.map((stage, sIndex) => {
        // Get tasks for this stage
        const stageTasks = tasks.filter((t: EstimateTask) => t.stage_id === stage.id);

        // Get all resources for this stage's tasks
        const stageItems: LocalOfferItem[] = [];
        stageTasks.forEach((task: EstimateTask) => {
          const taskResources = resources.filter((r: EstimateResource) => r.task_id === task.id);
          taskResources.forEach((resource: EstimateResource, rIndex: number) => {
            const qty = resource.volume || 1;
            const unitPrice = resource.price_with_markup || resource.price || 0;
            stageItems.push({
              id: `new-${stage.id}-${resource.id}`,
              offer_id: '',
              section_id: stage.id,
              source_resource_id: resource.id,
              name: resource.name,
              description: `${task.name}`,
              quantity: qty,
              unit_price: unitPrice,
              total_price: qty * unitPrice,
              sort_order: rIndex,
              is_optional: false,
              created_at: '',
              updated_at: '',
              isNew: true
            });
          });
        });

        return {
          id: `new-section-${sIndex}`,
          offer_id: '',
          name: stage.name,
          description: stage.description || '',
          sort_order: sIndex,
          created_at: '',
          updated_at: '',
          isExpanded: true,
          items: stageItems
        };
      });

      // Add resources without stage/task
      const unsectionedResources = resources.filter((r: EstimateResource) => !r.task_id);
      if (unsectionedResources.length > 0) {
        newSections.unshift({
          id: 'unsectioned',
          offer_id: '',
          name: 'Inne pozycje',
          description: '',
          sort_order: -1,
          created_at: '',
          updated_at: '',
          isExpanded: true,
          items: unsectionedResources.map((r: EstimateResource, i: number) => {
            const qty = r.volume || 1;
            const unitPrice = r.price_with_markup || r.price || 0;
            return {
              id: `new-unsectioned-${r.id}`,
              offer_id: '',
              section_id: undefined,
              source_resource_id: r.id,
              name: r.name,
              description: '',
              quantity: qty,
              unit_price: unitPrice,
              total_price: qty * unitPrice,
              sort_order: i,
              is_optional: false,
              created_at: '',
              updated_at: '',
              isNew: true
            };
          })
        });
      }

      setSections(newSections);
      setShowImportFromEstimate(false);
      setSelectedEstimateId('');
    } catch (err) {
      console.error('Error importing from estimate:', err);
      showToast('Błąd podczas importu z kosztorysu', 'error');
    } finally {
      setImportLoading(false);
    }
  };

  // Import from Kosztorys module (ElektroSmeta)
  const handleImportFromKosztorys = async () => {
    if (!selectedKosztorysId || !currentUser) return;
    setImportLoading(true);
    setImportedKosztorysName(null);
    try {
      // First get the estimate to find request_id
      const { data: estimate, error: estError } = await supabase
        .from('kosztorys_estimates')
        .select('id, request_id, version')
        .eq('id', selectedKosztorysId)
        .single();

      if (estError || !estimate) {
        console.error('Error loading estimate:', estError);
        showToast('Nie można załadować kosztorysu', 'error');
        setImportLoading(false);
        return;
      }

      // Load request data separately
      let req: any = null;
      if (estimate.request_id) {
        const { data: requestData } = await supabase
          .from('kosztorys_requests')
          .select('*')
          .eq('id', estimate.request_id)
          .single();
        req = requestData;
      }

      // Set offer name from kosztorys
      const investmentName = req?.investment_name || 'Kosztorys';
      const clientName = req?.client_name || '';
      setOfferData(prev => ({
        ...prev,
        name: `Oferta - ${investmentName}`,
      }));

      // Pre-fill client data from kosztorys request
      if (req) {
        setOfferClientData(prev => ({
          ...prev,
          client_name: req.client_name || prev.client_name,
          nip: req.nip || prev.nip,
          company_street: req.company_street || prev.company_street,
          company_street_number: req.company_street_number || prev.company_street_number,
          company_city: req.company_city || prev.company_city,
          company_postal_code: req.company_postal_code || prev.company_postal_code,
          company_country: req.company_country || prev.company_country,
          investment_name: req.investment_name || prev.investment_name,
          object_street: req.object_street || prev.object_street,
          object_street_number: req.object_street_number || prev.object_street_number,
          object_city: req.object_city || prev.object_city,
          object_postal_code: req.object_postal_code || prev.object_postal_code,
          object_country: req.object_country || prev.object_country,
          object_type: req.object_type || prev.object_type,
          main_material_side: req.main_material_side || prev.main_material_side,
          minor_material_side: req.minor_material_side || prev.minor_material_side,
          internal_notes: req.internal_notes || prev.internal_notes,
          request_source: req.request_source || prev.request_source,
          notes: req.notes || prev.notes,
          assigned_user_id: req.assigned_user_id || prev.assigned_user_id,
          // FIX: import representative (contact_person)
          contact_person: req.contact_person || prev.contact_person,
          phone: req.phone || prev.phone,
          email: req.email || prev.email,
        }));

        // Pre-fill new offer fields from kosztorys request
        setObjectName(req.investment_name || req.address || '');
        const objAddr = [req.object_street, req.object_street_number, req.object_postal_code, req.object_city].filter(Boolean).join(', ');
        setObjectAddress(objAddr || req.address || '');
        if (req.planned_start_date) setWorkStartDate(req.planned_start_date.split('T')[0]);
        if (req.planned_end_date) setWorkEndDate(req.planned_end_date.split('T')[0]);

        // FIX: set project_id if available (match by object_code or investment_name)
        if (req.object_code) {
          // Try to find matching project by object_code
          const { data: matchedProjects } = await supabase
            .from('projects')
            .select('id, name')
            .eq('object_code', req.object_code)
            .limit(1);
          if (matchedProjects && matchedProjects.length > 0) {
            setOfferData(prev => ({ ...prev, project_id: matchedProjects[0].id }));
          }
        }

        // Try to load contacts for the client + auto-set representative
        if (req.nip) {
          await offerFindAndLoadContacts(req.nip, req.client_name);
        } else if (req.client_name) {
          await offerFindAndLoadContacts(undefined, req.client_name);
        }

        // FIX: auto-select representative by contact_person name match
        if (req.contact_person) {
          // contacts are loaded by offerFindAndLoadContacts above
          // We'll try to match after a small delay (contacts load async)
          setTimeout(() => {
            // Access contacts from closure - find by name match
            const nameToFind = req.contact_person.toLowerCase().trim();
            // contacts state is updated by offerFindAndLoadContacts
            // Try to find in the DOM contacts list (the state is set by the function)
          }, 500);
        }

        setOfferClientSelected(true);
      }

      // Load items from kosztorys data_json
      const { convertEstimateToOfferData } = await import('../../lib/proposalGenerator');
      const result = await convertEstimateToOfferData(selectedKosztorysId);
      if (result && result.sections.length > 0) {
        const normalizedSections = result.sections.map((s: any) => ({
          ...s,
          children: s.children || [],
          items: (s.items || []).map((i: any) => ({
            ...i,
            isEditing: false,
            isExpanded: false,
            components: i.components || [],
            markup_percent: 0,
            cost_price: 0,
            discount_percent: i.discount_percent || 0,
            vat_rate: i.vat_rate ?? 23,
            selected: false
          }))
        }));
        setSections(normalizedSections);
        // Progressive render for imported sections
        setSectionsReady(0);
        let rev = 0;
        const revNext = () => { rev++; setSectionsReady(rev); if (rev < normalizedSections.length) requestAnimationFrame(revNext); };
        if (normalizedSections.length > 0) requestAnimationFrame(revNext);
        showToast(`Zaimportowano ${normalizedSections.length} sekcji z kosztorysu`, 'success');
      } else {
        showToast('Kosztorys nie zawiera pozycji do importu', 'warning');
      }

      setImportedKosztorysName(investmentName + (clientName ? ` — ${clientName}` : ''));
      setShowImportFromEstimate(false);
      setSelectedKosztorysId('');
    } catch (err) {
      console.error('Error importing from kosztorys:', err);
      showToast('Błąd podczas importu z modułu kosztorysowania', 'error');
    } finally {
      setImportLoading(false);
    }
  };

  // ============================================
  // SECTION & ITEM MANAGEMENT
  // ============================================
  // Deep update helper for nested sections
  const updateSectionsDeep = (secs: LocalOfferSection[], sectionId: string, updater: (s: LocalOfferSection) => LocalOfferSection | null): LocalOfferSection[] => {
    return secs.reduce<LocalOfferSection[]>((acc, s) => {
      if (s.id === sectionId) {
        const result = updater(s);
        if (result) acc.push(result);
      } else {
        const updatedChildren = s.children ? updateSectionsDeep(s.children, sectionId, updater) : s.children;
        acc.push({ ...s, children: updatedChildren });
      }
      return acc;
    }, []);
  };

  const addSection = (afterSectionId?: string, parentId?: string) => {
    const newSection: LocalOfferSection = {
      id: `new-section-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      offer_id: '',
      name: 'Nowa sekcja',
      description: '',
      sort_order: 0,
      created_at: '',
      updated_at: '',
      isExpanded: true,
      items: [],
      children: [],
      parent_id: parentId
    };

    if (parentId) {
      // Add as child of parent section
      setSections(prev => updateSectionsDeep(prev, parentId, s => ({
        ...s,
        children: [...(s.children || []), newSection]
      })));
    } else if (afterSectionId) {
      setSections(prev => {
        const idx = prev.findIndex(s => s.id === afterSectionId);
        const updated = [...prev];
        updated.splice(idx + 1, 0, newSection);
        return updated;
      });
    } else {
      setSections(prev => [...prev, newSection]);
    }
  };

  const updateSection = (sectionId: string, updates: Partial<LocalOfferSection>) => {
    setSections(prev => updateSectionsDeep(prev, sectionId, s => ({ ...s, ...updates })));
  };

  const deleteSection = (sectionId: string) => {
    showConfirm({
      title: 'Usunąć sekcję?',
      message: 'Sekcja wraz ze wszystkimi pozycjami zostanie usunięta.',
      confirmLabel: 'Usuń',
      destructive: true,
      onConfirm: () => {
        setSections(prev => updateSectionsDeep(prev, sectionId, () => null));
        showToast('Sekcja została usunięta', 'success');
      }
    });
  };

  const addItem = (sectionId: string) => {
    const newItem: LocalOfferItem = {
      id: `new-item-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      offer_id: '',
      section_id: sectionId === 'unsectioned' ? undefined : sectionId,
      name: '',
      description: '',
      unit: 'szt.',
      quantity: 1,
      unit_price: 0,
      total_price: 0,
      sort_order: 0,
      is_optional: false,
      created_at: '',
      updated_at: '',
      isEditing: true,
      isNew: true,
      isExpanded: false,
      components: [],
      markup_percent: 0,
      cost_price: 0,
      discount_percent: 0,
      vat_rate: 23,
      selected: false
    };
    setSections(prev => updateSectionsDeep(prev, sectionId, s => ({
      ...s, items: [...s.items, newItem]
    })));
  };

  const updateItem = (sectionId: string, itemId: string, updates: Partial<LocalOfferItem>) => {
    setSections(prev => updateSectionsDeep(prev, sectionId, s => ({
      ...s,
      items: s.items.map(i => {
        if (i.id === itemId) {
          const updated = { ...i, ...updates };
          if (calculationMode === 'markup' && updated.cost_price !== undefined && updated.cost_price > 0 && updated.markup_percent !== undefined) {
            updated.unit_price = updated.cost_price * (1 + (updated.markup_percent || 0) / 100);
          }
          updated.total_price = updated.quantity * updated.unit_price;
          return updated;
        }
        return i;
      })
    })));
  };

  const deleteItem = (sectionId: string, itemId: string) => {
    setSections(prev => updateSectionsDeep(prev, sectionId, s => ({
      ...s, items: s.items.filter(i => i.id !== itemId)
    })));
  };

  const addComponent = (sectionId: string, itemId: string, component: Omit<OfferComponent, 'id'>) => {
    const newComp: OfferComponent = { ...component, id: `comp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` };
    setSections(prev => updateSectionsDeep(prev, sectionId, s => ({
      ...s,
      items: s.items.map(i => i.id === itemId ? { ...i, components: [...(i.components || []), newComp] } : i)
    })));
  };

  const updateComponent = (sectionId: string, itemId: string, componentId: string, updates: Partial<OfferComponent>) => {
    setSections(prev => updateSectionsDeep(prev, sectionId, s => ({
      ...s,
      items: s.items.map(i => i.id === itemId ? {
        ...i,
        components: (i.components || []).map(c => {
          if (c.id !== componentId) return c;
          const upd = { ...c, ...updates };
          upd.total_price = upd.quantity * upd.unit_price;
          return upd;
        })
      } : i)
    })));
  };

  const deleteComponent = (sectionId: string, itemId: string, componentId: string) => {
    setSections(prev => updateSectionsDeep(prev, sectionId, s => ({
      ...s,
      items: s.items.map(i => i.id === itemId ? { ...i, components: (i.components || []).filter(c => c.id !== componentId) } : i)
    })));
  };

  const toggleSelectAll = (selected: boolean) => {
    const updateItems = (secs: LocalOfferSection[]): LocalOfferSection[] =>
      secs.map(s => ({
        ...s,
        items: s.items.map(i => ({ ...i, selected })),
        children: s.children ? updateItems(s.children) : s.children
      }));
    setSections(prev => updateItems(prev));
  };

  const applyBulkDiscount = () => {
    const updateItems = (secs: LocalOfferSection[]): LocalOfferSection[] =>
      secs.map(s => ({
        ...s,
        items: s.items.map(i => i.selected ? { ...i, discount_percent: bulkRabatValue } : i),
        children: s.children ? updateItems(s.children) : s.children
      }));
    setSections(prev => updateItems(prev));
    setShowBulkRabatModal(false);
    setShowBulkBar(false);
  };

  const applyBulkVat = (rate: number) => {
    const updateItems = (secs: LocalOfferSection[]): LocalOfferSection[] =>
      secs.map(s => ({
        ...s,
        items: s.items.map(i => i.selected ? { ...i, vat_rate: rate } : i),
        children: s.children ? updateItems(s.children) : s.children
      }));
    setSections(prev => updateItems(prev));
  };

  // Load kartoteka data when search modal opens
  useEffect(() => {
    if (!showSearchLabourModal && !showSearchMaterialModal && !showSearchEquipmentModal) return;
    if (!currentUser) return;
    const loadKartoteka = async () => {
      setKartotekaLoading(true);
      try {
        const tableName = showSearchLabourModal ? 'kosztorys_own_labours' :
          showSearchMaterialModal ? 'kosztorys_materials' : 'kosztorys_equipment';
        const systemTableName = showSearchLabourModal ? 'kosztorys_system_labours' :
          showSearchMaterialModal ? 'kosztorys_materials' : 'kosztorys_equipment';

        const [ownRes, systemRes, categoriesRes] = await Promise.all([
          supabase.from(tableName).select('*').eq('company_id', currentUser.company_id).order('name'),
          showSearchLabourModal
            ? supabase.from(systemTableName).select('*').eq('is_active', true).order('name').limit(500)
            : Promise.resolve({ data: [] }),
          supabase.from('kosztorys_custom_categories').select('*').eq('company_id', currentUser.company_id).order('sort_order')
        ]);
        setKartotekaOwnData(ownRes.data || []);
        setKartotekaData((systemRes as any).data || []);
        setKartotekaCategories(categoriesRes.data || []);
      } catch (err) {
        console.error('Error loading kartoteka:', err);
      } finally {
        setKartotekaLoading(false);
      }
    };
    loadKartoteka();
  }, [showSearchLabourModal, showSearchMaterialModal, showSearchEquipmentModal, currentUser]);

  // Load wholesaler integrations when kartoteka opens
  useEffect(() => {
    if ((showSearchMaterialModal || showSearchEquipmentModal) && currentUser?.company_id && wholesalerIntegrations.length === 0) {
      supabase.from('wholesaler_integrations').select('*').eq('company_id', currentUser.company_id)
        .then(res => { if (res.data) setWholesalerIntegrations(res.data.filter((w: any) => !w.wholesaler_name?.toLowerCase().includes('speckable') && !w.wholesaler_id?.toLowerCase?.().includes('speckable'))); });
    }
  }, [showSearchMaterialModal, showSearchEquipmentModal, currentUser?.company_id]);

  const handleWholesalerSearch = async (query: string) => {
    if (!query.trim() || !currentUser) return;
    setWholesalerSearching(true);
    try {
      const proxyName = wholesalerProvider === 'tim' ? 'tim-proxy' : 'oninen-proxy';
      const { data, error } = await supabase.functions.invoke(proxyName, {
        body: { action: 'search', query: query.trim(), limit: 50 }
      });
      if (data?.products) {
        setWholesalerResults(data.products);
      } else {
        setWholesalerResults([]);
      }
    } catch (err) {
      console.error('Wholesaler search error:', err);
      setWholesalerResults([]);
    } finally {
      setWholesalerSearching(false);
    }
  };

  const resetOfferForm = () => {
    setOfferData({
      name: '',
      number: '',
      project_id: '',
      client_id: '',
      valid_until: '',
      discount_percent: 0,
      discount_amount: 0,
      notes: '',
      internal_notes: ''
    });
    setSections([]);
    setSelectedEstimateId('');
    setSelectedKosztorysId('');
    setImportedKosztorysName(null);
    resetOfferClientData();
    setObjectName('');
    setObjectAddress('');
    setWorkStartDate('');
    setWorkEndDate('');
  };

  // ============================================
  // EXPORT
  // ============================================
  const exportToCSV = () => {
    if (!selectedOffer) return;
    const rows: string[] = [];
    rows.push(['Sekcja', 'Pozycja', 'Opis', 'Ilość', 'Cena jedn.', 'Wartość netto', 'Rabat %', 'VAT %'].join(';'));

    const exportSection = (sec: LocalOfferSection, prefix: string = '') => {
      sec.items.forEach(item => {
        rows.push([
          prefix + sec.name,
          item.name,
          item.description || '',
          item.quantity.toString().replace('.', ','),
          item.unit_price.toFixed(2).replace('.', ','),
          (item.quantity * item.unit_price).toFixed(2).replace('.', ','),
          (item.discount_percent || 0).toString(),
          (item.vat_rate ?? 23).toString()
        ].join(';'));
      });
      (sec.children || []).forEach(child => exportSection(child, prefix + sec.name + ' > '));
    };

    sections.forEach(sec => exportSection(sec));

    rows.push('');
    rows.push(['', '', '', '', 'Suma pozycji netto:', totals.total.toFixed(2).replace('.', ','), '', ''].join(';'));
    if (totals.relatedCostsTotal > 0) {
      rows.push(['', '', '', '', 'Koszty powiązane:', totals.relatedCostsTotal.toFixed(2).replace('.', ','), '', ''].join(';'));
    }
    if (totals.surchargePercent !== 0) {
      rows.push(['', '', '', '', `Warunki istotne (${totals.surchargePercent}%):`, totals.surchargeAmount.toFixed(2).replace('.', ','), '', ''].join(';'));
    }
    rows.push(['', '', '', '', 'Łącznie netto:', (totals.total + totals.surchargeAmount).toFixed(2).replace('.', ','), '', ''].join(';'));
    if (totals.totalDiscount > 0) {
      rows.push(['', '', '', '', 'Rabat:', (-totals.totalDiscount).toFixed(2).replace('.', ','), '', ''].join(';'));
      rows.push(['', '', '', '', 'Netto po rabacie:', totals.nettoAfterSurcharges.toFixed(2).replace('.', ','), '', ''].join(';'));
    }
    rows.push(['', '', '', '', 'VAT:', totals.totalVat.toFixed(2).replace('.', ','), '', ''].join(';'));
    rows.push(['', '', '', '', 'BRUTTO:', totals.totalBrutto.toFixed(2).replace('.', ','), '', ''].join(';'));

    const blob = new Blob(['\ufeff' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedOffer.number || 'oferta'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const generateOfferHTML = (): string => {
    if (!selectedOffer) return '';
    const company = state.currentCompany as any;
    const companyName = company?.name || '';
    const companyLogo = company?.logo_url || '';
    const companyNip = company?.nip || company?.tax_id || '';
    const companyAddress = [company?.street, company?.building_number].filter(Boolean).join(' ') || company?.address_street || '';
    const companyCity = [company?.postal_code || company?.address_postal_code, company?.city || company?.address_city].filter(Boolean).join(' ');
    const companyPhone = company?.phone || company?.contact_phone || '';
    const companyEmail = company?.email || company?.contact_email || '';
    const client = (selectedOffer as any).client;
    const ps = selectedOffer.print_settings || {};
    const cd = ps.client_data || {};
    const clientName = cd.client_name || client?.name || offerClientData.client_name || '';
    const clientNip = cd.nip || client?.nip || offerClientData.nip || '';
    const clientStreet = cd.company_street || offerClientData.company_street || '';
    const clientStreetNum = cd.company_street_number || offerClientData.company_street_number || '';
    const clientPostal = cd.company_postal_code || offerClientData.company_postal_code || '';
    const clientCity = cd.company_city || offerClientData.company_city || '';
    const clientFullAddress = [clientStreet, clientStreetNum, clientPostal, clientCity].filter(Boolean).join(', ') || client?.legal_address || '';
    // Find representative - try by ID, fallback to first contact, fallback to saved data
    const repId = cd.representative_id || sendRepresentativeId;
    const representative = repId
      ? offerClientContacts.find((c: any) => c.id === repId) || offerClientContacts[0]
      : offerClientContacts[0] || null;
    const repName = representative ? `${representative.first_name || ''} ${representative.last_name || ''}`.trim()
      : cd.representative_name || '';
    const repEmail = representative?.email || cd.representative_email || client?.email || '';
    const repPhone = representative?.phone || cd.representative_phone || client?.phone || '';
    const fmtCur = (v: number) => v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    const isBrutto = previewTemplate === 'brutto';
    const priceLabel = isBrutto ? 'brutto' : 'netto';

    const colCount = previewTemplate === 'no_prices' ? 2 : (previewTemplate === 'full' ? 6 : (previewTemplate === 'rabat' ? 5 : 4));
    const calcHtmlSecTotal = (sec: LocalOfferSection): number => {
      let total = sec.items.reduce((s, item) => {
        const val = item.quantity * item.unit_price;
        const disc = val * ((item.discount_percent || 0) / 100);
        const netVal = val - disc;
        return s + (isBrutto ? netVal * (1 + (item.vat_rate ?? 23) / 100) : netVal);
      }, 0);
      (sec.children || []).forEach(child => { total += calcHtmlSecTotal(child); });
      return total;
    };
    const renderSectionHTML = (sec: LocalOfferSection, depth: number = 0): string => {
      let html = '';
      const hSize = depth === 0 ? '14px' : '12px';
      const hBorder = depth === 0 ? 'border-bottom:2px solid #2c3e50;' : 'border-bottom:1px solid #cbd5e1;';
      const indent = depth > 0 ? `margin-left:${depth * 16}px;` : '';
      const secTotal = calcHtmlSecTotal(sec);
      const totalLabel = previewTemplate !== 'no_prices' ? `<span style="float:right;font-size:12px;color:#475569;">${fmtCur(secTotal)} zł</span>` : '';
      html += `<div style="font-size:${hSize};font-weight:600;color:#2c3e50;margin:${depth > 0 ? '8px' : '16px'} 0 6px;padding-bottom:3px;${hBorder}${indent}">${sec.name}${totalLabel}</div>`;
      if (sec.items.length > 0 && previewTemplate !== 'no_prices') {
        const headerBg = depth === 0 ? '#2c3e50' : '#475569';
        html += `<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:8px;${indent}">
          <thead><tr style="background:${headerBg};color:white;">
            <th style="padding:8px 6px;text-align:left;font-weight:600;">Produkty/Usługi</th>
            <th style="padding:8px 6px;text-align:right;font-weight:600;">Ilość</th>
            <th style="padding:8px 6px;text-align:right;font-weight:600;">Cena ${priceLabel}<br/>[zł]</th>
            ${previewTemplate === 'rabat' || previewTemplate === 'full' ? `<th style="padding:8px 6px;text-align:right;font-weight:600;">Rabat</th>` : ''}
            <th style="padding:8px 6px;text-align:right;font-weight:600;">Wartość ${priceLabel}<br/>[zł]</th>
            ${previewTemplate === 'full' ? `<th style="padding:8px 6px;text-align:right;font-weight:600;">VAT</th>` : ''}
          </tr></thead><tbody>`;
        sec.items.forEach((item) => {
          const val = item.quantity * item.unit_price;
          const disc = val * ((item.discount_percent || 0) / 100);
          const netVal = val - disc;
          const vatMult = 1 + (item.vat_rate ?? 23) / 100;
          const displayPrice = isBrutto ? item.unit_price * vatMult : item.unit_price;
          const displayVal = isBrutto ? netVal * vatMult : netVal;
          html += `<tr style="border-bottom:1px solid #e2e8f0;">
            <td style="padding:10px 8px;">${item.name}${item.is_optional ? ' <span style="background:#fef9c3;color:#a16207;font-size:10px;padding:1px 4px;border-radius:3px;">opcja</span>' : ''}</td>
            <td style="padding:10px 8px;text-align:right;">${item.quantity}</td>
            <td style="padding:10px 8px;text-align:right;">${fmtCur(displayPrice)}</td>
            ${previewTemplate === 'rabat' || previewTemplate === 'full' ? `<td style="padding:10px 8px;text-align:right;color:#dc2626;">${item.discount_percent ? `-${item.discount_percent}%` : '-'}</td>` : ''}
            <td style="padding:10px 8px;text-align:right;font-weight:500;">${fmtCur(displayVal)}</td>
            ${previewTemplate === 'full' ? `<td style="padding:10px 8px;text-align:right;color:#64748b;">${item.vat_rate ?? 23}%</td>` : ''}
          </tr>`;
          // R/M/S components
          if (showComponentsInPrint && item.components && item.components.length > 0) {
            item.components.forEach(comp => {
              const typeColor = comp.type === 'labor' ? '#3b82f6' : comp.type === 'material' ? '#f59e0b' : '#10b981';
              const typeLabel = comp.type === 'labor' ? 'R' : comp.type === 'material' ? 'M' : 'S';
              html += `<tr style="background:#f8fafc;border-bottom:1px solid #f1f5f9;">
                <td style="padding:4px 8px 4px 24px;font-size:11px;color:#64748b;"><span style="display:inline-block;width:16px;height:16px;border-radius:3px;background:${typeColor};color:white;text-align:center;font-size:9px;line-height:16px;font-weight:600;margin-right:6px;">${typeLabel}</span>${comp.name}${comp.code ? ` <span style="color:#94a3b8;">[${comp.code}]</span>` : ''}</td>
                <td style="padding:4px 8px;text-align:right;font-size:11px;color:#94a3b8;">${comp.quantity}</td>
                <td style="padding:4px 8px;text-align:right;font-size:11px;color:#94a3b8;">${fmtCur(comp.unit_price)}</td>
                ${previewTemplate === 'rabat' || previewTemplate === 'full' ? `<td style="padding:4px 8px;"></td>` : ''}
                <td style="padding:4px 8px;text-align:right;font-size:11px;color:#94a3b8;">${fmtCur(comp.total_price)}</td>
                ${previewTemplate === 'full' ? `<td style="padding:4px 8px;"></td>` : ''}
              </tr>`;
            });
          }
        });
        html += '</tbody></table>';
      } else if (sec.items.length > 0) {
        html += `<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:8px;${indent}">
          <thead><tr style="background:#2c3e50;color:white;">
            <th style="padding:10px 8px;text-align:left;font-weight:600;">Produkty/Usługi</th>
            <th style="padding:10px 8px;text-align:right;font-weight:600;">Ilość</th>
          </tr></thead><tbody>`;
        sec.items.forEach((item) => {
          html += `<tr style="border-bottom:1px solid #e2e8f0;">
            <td style="padding:10px 8px;">${item.name}</td>
            <td style="padding:10px 8px;text-align:right;">${item.quantity}</td>
          </tr>`;
        });
        html += '</tbody></table>';
      }
      (sec.children || []).forEach(child => { html += renderSectionHTML(child, depth + 1); });
      return html;
    };

    let totalsSectionHTML = '';
    if (previewTemplate !== 'no_prices') {
      if (isBrutto) {
        totalsSectionHTML = `
          <div style="margin-top:24px;padding-top:12px;border-top:2px solid #2c3e50;text-align:right;">
            <div style="font-size:16px;font-weight:bold;">Suma brutto: ${fmtCur(totals.totalBrutto)} zł</div>
          </div>`;
      } else {
        const htmlLacznieNetto = totals.total + totals.surchargeAmount;
        totalsSectionHTML = `
          <div style="margin-top:24px;padding-top:12px;border-top:2px solid #2c3e50;">
            <h3 style="font-size:14px;font-weight:600;margin:0 0 8px;color:#2c3e50;">Podsumowanie</h3>
            <table style="width:300px;margin-left:auto;font-size:13px;">
              <tr><td style="padding:3px 0;">Suma pozycji netto:</td><td style="padding:3px 0;text-align:right;font-weight:500;">${fmtCur(totals.total)} zł</td></tr>
              ${totals.relatedCostsTotal > 0 ? `<tr style="color:#64748b;"><td style="padding:3px 0;">Koszty powiązane:</td><td style="padding:3px 0;text-align:right;">${fmtCur(totals.relatedCostsTotal)} zł</td></tr>` : ''}
              ${totals.surchargePercent !== 0 ? `<tr style="color:${totals.surchargePercent > 0 ? '#dc2626' : '#16a34a'};"><td style="padding:3px 0;">Warunki istotne (${totals.surchargePercent > 0 ? '+' : ''}${totals.surchargePercent}%):</td><td style="padding:3px 0;text-align:right;">${totals.surchargePercent > 0 ? '+' : ''}${fmtCur(totals.surchargeAmount)} zł</td></tr>` : ''}
              <tr><td style="padding:3px 0;font-weight:600;">Łącznie netto:</td><td style="padding:3px 0;text-align:right;font-weight:600;">${fmtCur(htmlLacznieNetto)} zł</td></tr>
              ${totals.totalDiscount > 0 && previewTemplate !== 'netto' ? `<tr style="color:#dc2626;"><td style="padding:3px 0;">Rabat:</td><td style="padding:3px 0;text-align:right;">-${fmtCur(totals.totalDiscount)} zł</td></tr>` : ''}
              ${totals.totalDiscount > 0 ? `<tr><td style="padding:3px 0;font-weight:600;">Netto po rabacie:</td><td style="padding:3px 0;text-align:right;font-weight:600;">${fmtCur(totals.nettoAfterSurcharges)} zł</td></tr>` : ''}
              <tr><td style="padding:3px 0;">VAT:</td><td style="padding:3px 0;text-align:right;">${fmtCur(totals.totalVat)} zł</td></tr>
              <tr style="font-weight:bold;font-size:15px;border-top:1px solid #cbd5e1;"><td style="padding:6px 0;">Brutto:</td><td style="padding:6px 0;text-align:right;">${fmtCur(totals.totalBrutto)} zł</td></tr>
            </table>
          </div>`;
      }
    }

    return `<!DOCTYPE html>
<html lang="pl">
<head><meta charset="UTF-8"><title>Oferta ${selectedOffer.number}</title>
<style>
body{font-family:Arial,Helvetica,sans-serif;margin:0;padding:15mm 20mm;color:#1e293b;font-size:13px;box-sizing:border-box;}
@media print{
  body{padding:0;margin:0;}
  @page{margin:15mm 20mm;size:A4;}
}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;}
.info-table{width:100%;border-collapse:collapse;margin-bottom:24px;}
.info-table td{padding:10px 12px;vertical-align:top;border:1px solid #e2e8f0;}
.info-table .label{background:#2c3e50;color:white;font-weight:600;text-align:center;padding:8px;}
table{page-break-inside:auto;}
tr{page-break-inside:avoid;page-break-after:auto;}
</style></head>
<body>
  <div class="header">
    <div>
      <h2 style="margin:0 0 4px;font-size:18px;">${selectedOffer.name}</h2>
      <p style="margin:0;color:#64748b;font-size:12px;">Data wystawienia oferty: ${formatDate(issueDate)}</p>
      <p style="margin:0;color:#64748b;font-size:12px;">Oferta ważna do: ${formatDate(selectedOffer.valid_until)}</p>
      ${objectName ? `<p style="margin:4px 0 0;color:#64748b;font-size:12px;">Obiekt: ${objectName}</p>` : ''}
      ${objectAddress ? `<p style="margin:0;color:#64748b;font-size:12px;">Adres obiektu: ${objectAddress}</p>` : ''}
      ${workStartDate || workEndDate ? `<p style="margin:0;color:#64748b;font-size:12px;">Terminy Realizacji: ${workStartDate ? formatDate(workStartDate) : '?'} — ${workEndDate ? formatDate(workEndDate) : '?'}</p>` : ''}
    </div>
    ${showLogoInPreview && companyLogo ? `<img src="${companyLogo}" alt="" style="max-height:50px;" />` : ''}
  </div>

  <table class="info-table">
    <tr>
      <td class="label" style="width:50%;">Zamawiający</td>
      <td class="label" style="width:50%;">Wykonawca</td>
    </tr>
    <tr>
      <td>
        ${clientName ? `<strong>${clientName}</strong><br/>
        ${clientNip ? `NIP: ${clientNip}<br/>` : ''}
        ${clientFullAddress ? `${clientFullAddress}<br/>` : ''}
        ${repName ? `<br/>Przedstawiciel: ${repName}<br/>` : ''}
        ${repEmail ? `email: ${repEmail}<br/>` : ''}
        ${repPhone ? `tel. ${repPhone}` : ''}` : '<em>Brak danych klienta</em>'}
      </td>
      <td>
        <strong>${companyName}</strong><br/>
        ${companyNip ? `NIP: ${companyNip}<br/>` : ''}
        ${companyAddress ? `${companyAddress}<br/>` : ''}
        ${companyCity ? `${companyCity}<br/>` : ''}
        ${companyPhone ? `tel. ${companyPhone}<br/>` : ''}
        ${companyEmail ? `email: ${companyEmail}` : ''}
      </td>
    </tr>
  </table>

  ${sections.map(sec => renderSectionHTML(sec)).join('')}

  ${(() => {
    // Warunki istotne block (before totals)
    const hasWarunki = paymentTerm || invoiceFrequency || warrantyPeriod;
    let warunkiHTML = '';
    if (hasWarunki) {
      warunkiHTML = `<div style="margin-top:20px;padding:12px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px;">
        <h3 style="font-size:13px;font-weight:600;margin:0 0 8px;color:#2c3e50;">Warunki istotne</h3>
        <table style="width:100%;font-size:12px;border-collapse:collapse;">`;
      if (paymentTerm) {
        const ptRule = paymentTermRules.find(r => String(r.value) === paymentTerm);
        warunkiHTML += `<tr><td style="padding:4px 0;color:#64748b;width:200px;">Termin płatności:</td><td style="padding:4px 0;font-weight:500;">${paymentTerm} dni${ptRule && ptRule.surcharge !== 0 ? ` <span style="color:${paymentTermApply ? (ptRule.surcharge > 0 ? '#dc2626' : '#16a34a') : '#94a3b8'};font-size:11px;">(${ptRule.surcharge > 0 ? '+' : ''}${ptRule.surcharge}%${!paymentTermApply ? ' - nie uwzgl.' : ''})</span>` : ''}</td></tr>`;
      }
      if (invoiceFrequency) {
        const ifRule = invoiceFreqRules.find(r => String(r.value) === invoiceFrequency);
        warunkiHTML += `<tr><td style="padding:4px 0;color:#64748b;">Wystawienie faktur:</td><td style="padding:4px 0;font-weight:500;">co ${invoiceFrequency} dni${ifRule && ifRule.surcharge !== 0 ? ` <span style="color:${invoiceFreqApply ? (ifRule.surcharge > 0 ? '#dc2626' : '#16a34a') : '#94a3b8'};font-size:11px;">(${ifRule.surcharge > 0 ? '+' : ''}${ifRule.surcharge}%${!invoiceFreqApply ? ' - nie uwzgl.' : ''})</span>` : ''}</td></tr>`;
      }
      if (warrantyPeriod) {
        const wrRule = warrantyRules.find(r => String(r.value) === warrantyPeriod);
        warunkiHTML += `<tr><td style="padding:4px 0;color:#64748b;">Okres gwarancyjny:</td><td style="padding:4px 0;font-weight:500;">${warrantyPeriod} miesięcy${wrRule && wrRule.surcharge !== 0 ? ` <span style="color:${warrantyApply ? (wrRule.surcharge > 0 ? '#dc2626' : '#16a34a') : '#94a3b8'};font-size:11px;">(${wrRule.surcharge > 0 ? '+' : ''}${wrRule.surcharge}%${!warrantyApply ? ' - nie uwzgl.' : ''})</span>` : ''}</td></tr>`;
      }
      warunkiHTML += `</table></div>`;
    }

    // Koszty powiązane block
    const visibleCosts = relatedCosts.filter(c => c.value > 0);
    let kosztyHTML = '';
    if (visibleCosts.length > 0) {
      const shownCosts = visibleCosts.filter(c => c.show_on_offer);
      const hiddenCosts = visibleCosts.filter(c => !c.show_on_offer);
      const hiddenTotal = hiddenCosts.reduce((s, c) => s + (c.mode === 'percent' ? totals.nettoAfterDiscount * (c.value / 100) : c.value), 0);

      kosztyHTML = `<div style="margin-top:16px;padding:12px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px;">
        <h3 style="font-size:13px;font-weight:600;margin:0 0 8px;color:#2c3e50;">Koszty powiązane</h3>
        <table style="width:100%;font-size:12px;border-collapse:collapse;">`;
      shownCosts.forEach(c => {
        const val = c.mode === 'percent' ? totals.nettoAfterDiscount * (c.value / 100) : c.value;
        kosztyHTML += `<tr><td style="padding:3px 0;color:#475569;">${c.name}${c.mode === 'percent' ? ` (${c.value}%)` : ''}${c.frequency === 'monthly' ? ' (mies.)' : ''}</td><td style="padding:3px 0;text-align:right;font-weight:500;">${fmtCur(val)} zł</td></tr>`;
      });
      if (hiddenTotal > 0) {
        kosztyHTML += `<tr><td style="padding:3px 0;color:#475569;">Koszty powiązane</td><td style="padding:3px 0;text-align:right;font-weight:500;">${fmtCur(hiddenTotal)} zł</td></tr>`;
      }
      const totalRC = visibleCosts.reduce((s, c) => s + (c.mode === 'percent' ? totals.nettoAfterDiscount * (c.value / 100) : c.value), 0);
      kosztyHTML += `<tr style="border-top:1px solid #cbd5e1;font-weight:600;"><td style="padding:6px 0;">Suma kosztów powiązanych:</td><td style="padding:6px 0;text-align:right;">${fmtCur(totalRC)} zł</td></tr>`;
      kosztyHTML += `</table></div>`;
    }
    return warunkiHTML + kosztyHTML;
  })()}

  ${totalsSectionHTML}

  ${selectedOffer.notes ? `<div style="margin-top:24px;padding:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px;font-size:12px;"><strong>Uwagi:</strong><br/><span style="white-space:pre-wrap;">${selectedOffer.notes}</span></div>` : ''}
</body></html>`;
  };

  // ============================================
  // RENDER: CLIENT FORM (kosztorys-style, reusable)
  // ============================================
  const renderClientFormSection = () => (
    <div className="space-y-4">
      <h3 className="font-semibold text-slate-900 flex items-center gap-2">
        <Building2 className="w-5 h-5 text-slate-400" />
        Dane klienta
      </h3>

      {/* NIP with GUS button */}
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="block text-sm font-medium text-slate-700 mb-1">NIP</label>
          <input
            type="text"
            value={offerClientData.nip}
            onChange={e => {
              setOfferClientData(prev => ({ ...prev, nip: e.target.value }));
              setOfferGusError(null);
              setOfferGusSuccess(null);
            }}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
            placeholder="XXX-XXX-XX-XX"
          />
        </div>
        <div className="flex items-end">
          <button
            type="button"
            onClick={handleOfferFetchGus}
            disabled={offerGusLoading || !offerClientData.nip}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
          >
            {offerGusLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Pobierz z GUS
          </button>
        </div>
      </div>
      {offerGusError && <p className="text-sm text-red-600">{offerGusError}</p>}
      {offerGusSuccess && <p className="text-sm text-green-600">{offerGusSuccess}</p>}

      {/* Company name with autocomplete */}
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2 relative">
          <label className="block text-sm font-medium text-slate-700 mb-1">Nazwa firmy *</label>
          <input
            type="text"
            value={offerClientData.client_name}
            onChange={e => {
              setOfferClientData(prev => ({ ...prev, client_name: e.target.value }));
              setOfferClientSearchQuery(e.target.value);
            }}
            onFocus={() => {
              if (offerClientData.client_name.length >= 2) setOfferClientSearchQuery(offerClientData.client_name);
            }}
            onBlur={() => { setTimeout(() => setOfferShowClientDropdown(false), 200); }}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
            placeholder="Wyszukaj istniejącego lub wpisz nową nazwę..."
          />
          {offerShowClientDropdown && (
            <div className="absolute z-20 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
              {offerFilteredClients.length > 0 ? (
                <>
                  {offerFilteredClients.some(c => c.source === 'contractor') && (
                    <div className="px-3 py-2 text-xs font-bold text-slate-700 bg-slate-50 border-b">Kontrahenci z bazy</div>
                  )}
                  {offerFilteredClients.filter(c => c.source === 'contractor').map((client, i) => (
                    <button key={`c-${i}`} type="button" onClick={() => selectOfferExistingClient(client)}
                      className="w-full px-3 py-2 text-left hover:bg-blue-50 border-b border-slate-100 last:border-0">
                      <div className="font-medium text-slate-900">{client.client_name}</div>
                      <div className="text-xs text-slate-500 flex gap-2">
                        {client.nip && <span>NIP: {client.nip}</span>}
                        {client.company_city && <span>{client.company_city}</span>}
                      </div>
                    </button>
                  ))}
                  {offerFilteredClients.some(c => c.source === 'request_history') && (
                    <div className="px-3 py-2 text-xs font-semibold text-slate-400 bg-slate-50 border-b border-t">Z historii zapytań</div>
                  )}
                  {offerFilteredClients.filter(c => c.source === 'request_history').map((client, i) => (
                    <button key={`h-${i}`} type="button" onClick={() => selectOfferExistingClient(client)}
                      className="w-full px-3 py-2 text-left hover:bg-blue-50 border-b border-slate-100 last:border-0 opacity-75">
                      <div className="font-medium text-slate-900">{client.client_name}</div>
                      <div className="text-xs text-slate-500 flex gap-2">
                        {client.nip && <span>NIP: {client.nip}</span>}
                        {client.company_city && <span>{client.company_city}</span>}
                      </div>
                    </button>
                  ))}
                </>
              ) : offerClientSearchQuery.length >= 2 && (
                <div className="px-3 py-3 text-sm text-slate-500 text-center">
                  Nie znaleziono klienta. Możesz dodać nowego lub wyszukać w GUS.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Company address */}
      <div className="grid grid-cols-4 gap-4">
        <div className="col-span-2 relative">
          <label className="block text-sm font-medium text-slate-700 mb-1">Ulica</label>
          <input
            type="text"
            value={offerClientData.company_street}
            onChange={e => handleOfferCompanyStreetChange(e.target.value)}
            onFocus={() => offerCompanyAddressSuggestions.length > 0 && setOfferShowCompanyAddressSuggestions(true)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
            placeholder="ul. Przykładowa"
          />
          {offerShowCompanyAddressSuggestions && offerCompanyAddressSuggestions.length > 0 && (
            <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
              {offerCompanyAddressSuggestions.map((addr, i) => (
                <button key={i} type="button" onClick={() => selectOfferCompanyAddress(addr)}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 border-b border-slate-100 last:border-0">
                  <div className="font-medium">{addr.street} {addr.streetNumber}</div>
                  <div className="text-slate-500 text-xs">{addr.postalCode} {addr.city}</div>
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Numer</label>
          <input type="text" value={offerClientData.company_street_number}
            onChange={e => setOfferClientData(prev => ({ ...prev, company_street_number: e.target.value }))}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="12A" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Kod pocztowy</label>
          <input type="text" value={offerClientData.company_postal_code}
            onChange={e => setOfferClientData(prev => ({ ...prev, company_postal_code: e.target.value }))}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="00-000" />
        </div>
        <div className="col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-1">Miasto</label>
          <input type="text" value={offerClientData.company_city}
            onChange={e => setOfferClientData(prev => ({ ...prev, company_city: e.target.value }))}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="Warszawa" />
        </div>
        <div className="col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-1">Źródło zapytania</label>
          <div className="flex gap-1">
            <select value={offerClientData.request_source}
              onChange={e => setOfferClientData(prev => ({ ...prev, request_source: e.target.value as KosztorysRequestSource }))}
              className="flex-1 px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500">
              {Object.entries(OFFER_SOURCE_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
              {offerCustomSources.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <button onClick={() => setOfferShowAddSource(true)} className="px-2 py-2 text-blue-600 border border-blue-200 bg-blue-50 rounded-lg hover:bg-blue-100 flex-shrink-0" title="Dodaj nowe źródło">
              <Plus className="w-4 h-4" />
            </button>
          </div>
          {offerShowAddSource && (
            <div className="flex gap-1 mt-1">
              <input type="text" value={offerNewSourceOption} onChange={e => setOfferNewSourceOption(e.target.value)} placeholder="Nowe źródło..." className="flex-1 px-3 py-1.5 border border-slate-200 rounded-lg text-sm" autoFocus onKeyDown={e => { if (e.key === 'Enter' && offerNewSourceOption.trim()) { setOfferCustomSources(prev => [...prev, offerNewSourceOption.trim()]); setOfferClientData(prev => ({ ...prev, request_source: offerNewSourceOption.trim() as any })); setOfferNewSourceOption(''); setOfferShowAddSource(false); } if (e.key === 'Escape') setOfferShowAddSource(false); }} />
              <button onClick={() => { if (offerNewSourceOption.trim()) { setOfferCustomSources(prev => [...prev, offerNewSourceOption.trim()]); setOfferClientData(prev => ({ ...prev, request_source: offerNewSourceOption.trim() as any })); setOfferNewSourceOption(''); } setOfferShowAddSource(false); }} className="px-2 py-1.5 bg-blue-600 text-white rounded-lg text-xs">OK</button>
              <button onClick={() => setOfferShowAddSource(false)} className="px-2 py-1.5 text-slate-600 border border-slate-200 rounded-lg text-xs">✕</button>
            </div>
          )}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Notatka wewnętrzna</label>
        <textarea value={offerClientData.internal_notes}
          onChange={e => setOfferClientData(prev => ({ ...prev, internal_notes: e.target.value }))}
          rows={2} className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
          placeholder="Notatki widoczne tylko dla zespołu..." />
      </div>

      {/* Przedstawiciele firmy — 1:1 copy from kosztorys */}
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="font-semibold text-slate-900 flex items-center gap-2">
            <User className="w-5 h-5 text-slate-400" />
            Przedstawiciele firmy
          </h3>
          <button
            type="button"
            onClick={() => {
              if (!offerShowAddContactForm) {
                if (offerContacts.length === 0) {
                  offerAddContact();
                }
              }
              setOfferShowAddContactForm(!offerShowAddContactForm);
            }}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-slate-100 hover:bg-slate-200 rounded-lg"
          >
            <UserPlus className="w-4 h-4" />
            Dodaj
          </button>
        </div>

        {/* Dropdown to select existing contact */}
        {offerClientContacts.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Wybierz istniejącego przedstawiciela</label>
            <select
              value={offerSelectedContactId}
              onChange={e => offerSelectExistingContact(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
            >
              <option value="">— Wybierz z listy —</option>
              {offerClientContacts.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.is_main_contact ? '★ ' : ''}{c.first_name} {c.last_name}{c.position ? ` — ${c.position}` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* No representatives info */}
        {offerClientSelected && offerClientContacts.length === 0 && !offerShowAddContactForm && (
          <p className="text-sm text-slate-500 italic">Brak przedstawicieli w bazie dla tego klienta. Kliknij "Dodaj" aby dodać.</p>
        )}

        {/* Manual add contact form */}
        {offerShowAddContactForm && (
          <div className="space-y-4">
            {offerContacts.map((contact, index) => (
              <div key={index} className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={contact.is_primary}
                        onChange={() => offerUpdateContact(index, 'is_primary', true)}
                        className="w-4 h-4 text-blue-600 rounded"
                      />
                      <span className="text-sm font-medium text-slate-700 flex items-center gap-1">
                        {contact.is_primary && <Star className="w-4 h-4 text-amber-500" />}
                        Główny kontakt
                      </span>
                    </label>
                  </div>
                  {offerContacts.length > 1 && (
                    <button
                      type="button"
                      onClick={() => offerRemoveContact(index)}
                      className="p-1 text-red-500 hover:bg-red-50 rounded"
                      title="Usuń kontakt"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Imię *</label>
                    <input
                      type="text"
                      value={contact.first_name}
                      onChange={e => offerUpdateContact(index, 'first_name', e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                      placeholder="Jan"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Nazwisko *</label>
                    <input
                      type="text"
                      value={contact.last_name}
                      onChange={e => offerUpdateContact(index, 'last_name', e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                      placeholder="Kowalski"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Telefon</label>
                    <input
                      type="tel"
                      value={contact.phone}
                      onChange={e => offerUpdateContact(index, 'phone', formatPhoneNumber(e.target.value))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                      placeholder="+48 XXX XXX XXX"
                      maxLength={16}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Stanowisko</label>
                    <input
                      type="text"
                      value={contact.position}
                      onChange={e => offerUpdateContact(index, 'position', e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                      placeholder="Kierownik projektu"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-slate-600 mb-1">E-mail</label>
                    <input
                      type="email"
                      value={contact.email}
                      onChange={e => offerUpdateContact(index, 'email', e.target.value)}
                      className={`w-full px-3 py-2 border rounded-lg text-sm ${
                        contact.email && !isValidEmail(contact.email)
                          ? 'border-red-300 focus:ring-red-500'
                          : 'border-slate-200 focus:ring-blue-500'
                      }`}
                      placeholder="email@firma.pl"
                    />
                    {contact.email && !isValidEmail(contact.email) && (
                      <p className="text-xs text-red-500 mt-1">Nieprawidłowy format e-mail</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() => offerAddContact()}
              className="flex items-center gap-1 px-3 py-1.5 text-xs text-blue-600 hover:bg-blue-50 rounded-lg"
            >
              <Plus className="w-3.5 h-3.5" />
              Dodaj kolejny kontakt
            </button>
          </div>
        )}

        {/* Show selected contact summary if selected from dropdown and form is hidden */}
        {!offerShowAddContactForm && offerSelectedContactId && offerContacts.length > 0 && offerContacts[0].first_name && (
          <div className="p-3 bg-blue-50 rounded-lg border border-blue-200 text-sm">
            <span className="font-medium text-blue-800">{offerContacts[0].first_name} {offerContacts[0].last_name}</span>
            {offerContacts[0].position && <span className="text-blue-600 ml-2">({offerContacts[0].position})</span>}
            {offerContacts[0].phone && <span className="text-blue-600 ml-2">{offerContacts[0].phone}</span>}
          </div>
        )}
      </div>

      {/* 3. Obiekt — 1:1 from kosztorys */}
      <div className="space-y-4">
        <h3 className="font-semibold text-slate-900 flex items-center gap-2">
          <Building2 className="w-5 h-5 text-slate-400" />
          Obiekt
        </h3>
        <div className="grid grid-cols-6 gap-4">
          <div className="col-span-3">
            <label className="block text-sm font-medium text-slate-700 mb-1">Nazwa obiektu *</label>
            <input
              type="text"
              value={offerClientData.investment_name}
              onChange={e => setOfferClientData(prev => ({ ...prev, investment_name: e.target.value }))}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="np. Osiedle Słoneczne - Etap II"
            />
          </div>
          <div className="col-span-1">
            <label className="block text-sm font-medium text-slate-700 mb-1">Kod obiektu</label>
            <div className="flex gap-1">
              <input
                type="text"
                value={offerClientData.object_code}
                onChange={e => setOfferClientData(prev => ({ ...prev, object_code: e.target.value }))}
                disabled={!offerEditingObjectCode}
                className="w-full px-2 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 font-mono"
                placeholder="WC26"
              />
              <button
                type="button"
                onClick={() => setOfferEditingObjectCode(!offerEditingObjectCode)}
                className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg flex-shrink-0"
                title={offerEditingObjectCode ? 'Auto-generuj' : 'Edytuj ręcznie'}
              >
                <Pencil className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="col-span-2 relative">
            <label className="block text-sm font-medium text-slate-700 mb-1">Rodzaj prac *</label>
            <div className="relative">
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setOfferShowWorkTypesDropdown(!offerShowWorkTypesDropdown)}
                  className="flex-1 px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white text-left flex items-center justify-between"
                >
                  <span className={offerSelectedWorkTypes.length === 0 ? 'text-slate-400' : 'text-slate-900'}>
                    {offerSelectedWorkTypes.length === 0
                      ? 'Wybierz rodzaj prac...'
                      : offerWorkTypes
                          .filter(wt => offerSelectedWorkTypes.includes(wt.id))
                          .map(wt => wt.code)
                          .join(', ')}
                  </span>
                  <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${offerShowWorkTypesDropdown ? 'rotate-180' : ''}`} />
                </button>
                <button
                  type="button"
                  onClick={() => { setOfferShowAddWorkType(true); setOfferShowWorkTypesDropdown(false); }}
                  className="px-2 py-2 text-blue-600 border border-blue-200 bg-blue-50 rounded-lg hover:bg-blue-100 flex-shrink-0"
                  title="Dodaj nowy rodzaj prac"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              {offerShowWorkTypesDropdown && (
                <div className="absolute z-20 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg py-1">
                  {offerWorkTypes.map(wt => (
                    <label
                      key={wt.id}
                      className="flex items-center px-3 py-2 hover:bg-slate-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={offerSelectedWorkTypes.includes(wt.id)}
                        onChange={e => {
                          if (e.target.checked) {
                            setOfferSelectedWorkTypes(prev => [...prev, wt.id]);
                          } else {
                            setOfferSelectedWorkTypes(prev => prev.filter(id => id !== wt.id));
                          }
                        }}
                        className="mr-3 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm text-slate-700">{wt.name}</span>
                    </label>
                  ))}
                  {offerWorkTypes.length === 0 && (
                    <div className="px-3 py-2 text-sm text-slate-500">Brak typów prac</div>
                  )}
                </div>
              )}
              {offerShowAddWorkType && (
                <div className="flex flex-wrap gap-1 mt-1">
                  <input
                    type="text"
                    value={offerNewWorkTypeCode}
                    onChange={e => setOfferNewWorkTypeCode(e.target.value.toUpperCase())}
                    placeholder="Kod (np. IE)"
                    className="w-16 px-2 py-1.5 border border-slate-200 rounded-lg text-sm"
                    autoFocus
                  />
                  <input
                    type="text"
                    value={offerNewWorkTypeName}
                    onChange={e => setOfferNewWorkTypeName(e.target.value)}
                    placeholder="Nazwa (np. Elektryka)"
                    className="flex-1 min-w-[120px] px-2 py-1.5 border border-slate-200 rounded-lg text-sm"
                    onKeyDown={async e => {
                      if (e.key === 'Enter' && offerNewWorkTypeCode.trim() && offerNewWorkTypeName.trim()) {
                        const fullName = `${offerNewWorkTypeCode.trim()} - ${offerNewWorkTypeName.trim()}`;
                        const { data } = await supabase.from('kosztorys_work_types').insert({
                          code: offerNewWorkTypeCode.trim(),
                          name: fullName,
                          category: offerNewWorkTypeCode.trim(),
                          company_id: currentUser?.company_id,
                          is_active: true
                        }).select('id, code, name').single();
                        if (data) {
                          setOfferWorkTypes(prev => [...prev, data]);
                          setOfferSelectedWorkTypes(prev => [...prev, data.id]);
                        }
                        setOfferNewWorkTypeCode('');
                        setOfferNewWorkTypeName('');
                        setOfferShowAddWorkType(false);
                      }
                      if (e.key === 'Escape') { setOfferShowAddWorkType(false); setOfferNewWorkTypeCode(''); setOfferNewWorkTypeName(''); }
                    }}
                  />
                  <button
                    onClick={async () => {
                      if (offerNewWorkTypeCode.trim() && offerNewWorkTypeName.trim()) {
                        const fullName = `${offerNewWorkTypeCode.trim()} - ${offerNewWorkTypeName.trim()}`;
                        const { data } = await supabase.from('kosztorys_work_types').insert({
                          code: offerNewWorkTypeCode.trim(),
                          name: fullName,
                          category: offerNewWorkTypeCode.trim(),
                          company_id: currentUser?.company_id,
                          is_active: true
                        }).select('id, code, name').single();
                        if (data) {
                          setOfferWorkTypes(prev => [...prev, data]);
                          setOfferSelectedWorkTypes(prev => [...prev, data.id]);
                        }
                      }
                      setOfferNewWorkTypeCode('');
                      setOfferNewWorkTypeName('');
                      setOfferShowAddWorkType(false);
                    }}
                    className="px-2 py-1.5 bg-blue-600 text-white rounded-lg text-xs"
                  >OK</button>
                  <button
                    onClick={() => { setOfferShowAddWorkType(false); setOfferNewWorkTypeCode(''); setOfferNewWorkTypeName(''); }}
                    className="px-2 py-1.5 text-slate-600 border border-slate-200 rounded-lg text-xs"
                  >✕</button>
                </div>
              )}
            </div>
          </div>
          <div className="col-span-6">
            <label className="block text-sm font-medium text-slate-700 mb-1">Typ obiektu</label>
            <div className="flex gap-1">
              <select
                value={offerClientData.object_category_id}
                onChange={e => setOfferClientData(prev => ({ ...prev, object_category_id: e.target.value }))}
                className="flex-1 px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="">-- Wybierz (opcjonalnie) --</option>
                {offerObjectCategories.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <button onClick={() => setOfferShowAddObjectCategory(true)} className="px-2 py-2 text-blue-600 border border-blue-200 bg-blue-50 rounded-lg hover:bg-blue-100 flex-shrink-0" title="Dodaj nowy typ obiektu">
                <Plus className="w-4 h-4" />
              </button>
            </div>
            {offerShowAddObjectCategory && (
              <div className="flex gap-1 mt-1">
                <input type="text" value={offerNewObjectCategoryOption} onChange={e => setOfferNewObjectCategoryOption(e.target.value)} placeholder="Nowy typ obiektu..." className="flex-1 px-3 py-1.5 border border-slate-200 rounded-lg text-sm" autoFocus onKeyDown={async e => { if (e.key === 'Enter' && offerNewObjectCategoryOption.trim()) { const code = offerNewObjectCategoryOption.trim().toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 50) || `cat_${Date.now()}`; const { data } = await supabase.from('kosztorys_object_categories').insert({ name: offerNewObjectCategoryOption.trim(), code, company_id: currentUser?.company_id, is_active: true }).select().single(); if (data) { setOfferObjectCategories((prev: any) => [...prev, data]); setOfferClientData(prev => ({ ...prev, object_category_id: data.id })); } setOfferNewObjectCategoryOption(''); setOfferShowAddObjectCategory(false); } if (e.key === 'Escape') setOfferShowAddObjectCategory(false); }} />
                <button onClick={async () => { if (offerNewObjectCategoryOption.trim()) { const code = offerNewObjectCategoryOption.trim().toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 50) || `cat_${Date.now()}`; const { data } = await supabase.from('kosztorys_object_categories').insert({ name: offerNewObjectCategoryOption.trim(), code, company_id: currentUser?.company_id, is_active: true }).select().single(); if (data) { setOfferObjectCategories((prev: any) => [...prev, data]); setOfferClientData(prev => ({ ...prev, object_category_id: data.id })); } } setOfferNewObjectCategoryOption(''); setOfferShowAddObjectCategory(false); }} className="px-2 py-1.5 bg-blue-600 text-white rounded-lg text-xs">OK</button>
                <button onClick={() => setOfferShowAddObjectCategory(false)} className="px-2 py-1.5 text-slate-600 border border-slate-200 rounded-lg text-xs">✕</button>
              </div>
            )}
          </div>
        </div>

        {/* Object address */}
        <div className="grid grid-cols-4 gap-4">
          <div className="col-span-2 relative">
            <label className="block text-sm font-medium text-slate-700 mb-1">Ulica</label>
            <input
              type="text"
              value={offerClientData.object_street}
              onChange={e => handleOfferObjectStreetChange(e.target.value)}
              onFocus={() => offerObjectAddressSuggestions.length > 0 && setOfferShowObjectAddressSuggestions(true)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="ul. Budowlana"
            />
            {offerShowObjectAddressSuggestions && offerObjectAddressSuggestions.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {offerObjectAddressSuggestions.map((addr, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => selectOfferObjectAddress(addr)}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 border-b border-slate-100 last:border-0"
                  >
                    <div className="font-medium">{addr.street} {addr.streetNumber}</div>
                    <div className="text-slate-500 text-xs">{addr.postalCode} {addr.city}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Numer</label>
            <input
              type="text"
              value={offerClientData.object_street_number}
              onChange={e => setOfferClientData(prev => ({ ...prev, object_street_number: e.target.value }))}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="1"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Kod pocztowy</label>
            <input
              type="text"
              value={offerClientData.object_postal_code}
              onChange={e => setOfferClientData(prev => ({ ...prev, object_postal_code: e.target.value }))}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="00-000"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-1">Miasto</label>
            <input
              type="text"
              value={offerClientData.object_city}
              onChange={e => setOfferClientData(prev => ({ ...prev, object_city: e.target.value }))}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="Warszawa"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-1">Kraj</label>
            <input
              type="text"
              value={offerClientData.object_country}
              onChange={e => setOfferClientData(prev => ({ ...prev, object_country: e.target.value }))}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="Polska"
            />
          </div>
        </div>
      </div>

      {/* 4. Materiały — 1:1 from kosztorys */}
      <div className="space-y-4">
        <h3 className="font-semibold text-slate-900 flex items-center gap-2">
          <FileText className="w-5 h-5 text-slate-400" />
          Materiały
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Materiał Główny</label>
            <select
              value={offerClientData.main_material_side}
              onChange={e => setOfferClientData(prev => ({ ...prev, main_material_side: e.target.value }))}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="">-- Wybierz --</option>
              <option value="investor">Po stronie Inwestora</option>
              <option value="client">Po stronie {offerClientData.client_name || 'Klienta'}</option>
              <option value="company">Po stronie Firmy</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Materiał Drobny</label>
            <select
              value={offerClientData.minor_material_side}
              onChange={e => setOfferClientData(prev => ({ ...prev, minor_material_side: e.target.value }))}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="">-- Wybierz --</option>
              <option value="investor">Po stronie Inwestora</option>
              <option value="client">Po stronie {offerClientData.client_name || 'Klienta'}</option>
              <option value="company">Po stronie Firmy</option>
            </select>
          </div>
        </div>
      </div>

      {/* 5. Odpowiedzialny — 1:1 from kosztorys */}
      <div className="space-y-4">
        <h3 className="font-semibold text-slate-900 flex items-center gap-2">
          <Briefcase className="w-5 h-5 text-slate-400" />
          Odpowiedzialny
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Odpowiedzialny</label>
            <select
              value={offerClientData.assigned_user_id}
              onChange={e => setOfferClientData(prev => ({ ...prev, assigned_user_id: e.target.value }))}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="">-- Wybierz --</option>
              {offerUsers.map(user => (
                <option key={user.id} value={user.id}>
                  {user.first_name} {user.last_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Planowana data odpowiedzi</label>
            <input
              type="date"
              value={offerClientData.planned_response_date}
              onChange={e => setOfferClientData(prev => ({ ...prev, planned_response_date: e.target.value }))}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
              min={new Date().toISOString().split('T')[0]}
            />
          </div>
        </div>
      </div>

      {/* 6. Uwagi od klienta — 1:1 from kosztorys */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Uwagi od klienta</label>
        <textarea
          value={offerClientData.notes}
          onChange={e => setOfferClientData(prev => ({ ...prev, notes: e.target.value }))}
          rows={3}
          className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
          placeholder="Dodatkowe informacje od klienta..."
        />
      </div>
    </div>
  );

  // ============================================
  // RENDER: CREATE MODAL
  // ============================================
  const renderCreateModal = () => (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-slate-200 flex justify-between items-center">
          <h2 className="text-xl font-bold text-slate-900">Nowa oferta</h2>
          <button onClick={() => { setShowCreateModal(false); resetOfferForm(); }} className="p-2 hover:bg-slate-100 rounded-lg" title="Zamknij">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* 1. Client (kosztorys-style) — FIRST, like in kosztorys */}
          {renderClientFormSection()}

          {/* 2. Offer details */}
          <div className="space-y-4">
            <h3 className="font-semibold text-slate-900 flex items-center gap-2">
              <FileText className="w-5 h-5 text-slate-400" />
              Dane oferty
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">Nazwa oferty *</label>
                <input
                  type="text"
                  value={offerData.name}
                  onChange={e => setOfferData({ ...offerData, name: e.target.value })}
                  placeholder="np. Oferta na instalację elektryczną"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Projekt</label>
                <select
                  value={offerData.project_id}
                  onChange={e => setOfferData({ ...offerData, project_id: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">-- Wybierz projekt --</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Ważna do</label>
                <input
                  type="date"
                  value={offerData.valid_until}
                  onChange={e => setOfferData({ ...offerData, valid_until: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* 3. Import from estimate */}
          {importedKosztorysName ? (
            <div className="p-4 bg-green-50 rounded-lg border border-green-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  <div>
                    <span className="font-medium text-green-900">Zaimportowano z kosztorysu</span>
                    <p className="text-sm text-green-700 mt-0.5">{importedKosztorysName}</p>
                  </div>
                </div>
                <button
                  onClick={() => { setImportedKosztorysName(null); setShowImportFromEstimate(true); }}
                  className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 transition"
                >
                  Zmień kosztorys
                </button>
              </div>
            </div>
          ) : (
            <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="w-5 h-5 text-blue-600" />
                  <span className="font-medium text-blue-900">Importuj dane z kosztorysu</span>
                </div>
                <button
                  onClick={() => setShowImportFromEstimate(true)}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition"
                >
                  Wybierz kosztorys
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-slate-200 flex justify-end gap-3">
          <button
            onClick={() => { setShowCreateModal(false); resetOfferForm(); }}
            className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg"
          >
            Anuluj
          </button>
          <button
            onClick={handleCreateOffer}
            disabled={!offerData.name.trim() || savingOffer}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
          >
            {savingOffer && <Loader2 className="w-4 h-4 animate-spin" />}
            Utwórz i przejdź do oferty
          </button>
        </div>
      </div>
    </div>
  );

  // ============================================
  // RENDER: IMPORT FROM ESTIMATE MODAL
  // ============================================
  const renderImportFromEstimateModal = () => (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-xl w-full max-w-lg">
        <div className="p-4 border-b border-slate-200 flex justify-between items-center">
          <h2 className="text-lg font-semibold">Importuj z kosztorysu</h2>
          <button onClick={() => setShowImportFromEstimate(false)} className="p-1 hover:bg-slate-100 rounded" title="Zamknij">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4">
          {kosztorysEstimates.length === 0 ? (
            <div className="text-center py-8 text-slate-500">
              <FileSpreadsheet className="w-12 h-12 mx-auto mb-3 text-slate-300" />
              <p>Brak dostępnych kosztorysów.</p>
              <p className="text-sm mt-1">Najpierw utwórz kosztorys w module Kosztorysowanie.</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {kosztorysEstimates.map(est => (
                <label
                  key={est.id}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition ${
                    selectedKosztorysId === est.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="kosztorys"
                    checked={selectedKosztorysId === est.id}
                    onChange={() => setSelectedKosztorysId(est.id)}
                    className="w-4 h-4 text-blue-600"
                  />
                  <div className="flex-1">
                    <p className="font-medium text-slate-900">
                      {est.request?.investment_name || 'Kosztorys'}
                    </p>
                    <p className="text-sm text-slate-500">
                      {est.request?.client_name || 'Klient'}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="p-4 border-t border-slate-200 flex justify-end gap-3">
          <button
            onClick={() => setShowImportFromEstimate(false)}
            className="px-4 py-2 border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            Anuluj
          </button>
          <button
            onClick={handleImportFromKosztorys}
            disabled={!selectedKosztorysId || importLoading}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {importLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
            Importuj
          </button>
        </div>
      </div>
    </div>
  );

  // ============================================
  // RENDER: SECTION (recursive for nested subsections)
  // ============================================
  const calcSectionTotal = (sec: LocalOfferSection): number => {
    return sec.items.reduce((s, i) => s + i.quantity * i.unit_price, 0)
      + (sec.children || []).reduce((s, child) => s + calcSectionTotal(child), 0);
  };

  const renderSection = (section: LocalOfferSection, depth: number): React.ReactNode => {
    const sectionTotal = calcSectionTotal(section);

    return (
      <div key={section.id} className={`border border-slate-200 rounded-lg overflow-hidden ${depth > 0 ? 'ml-6 mt-2' : ''}`}>
        {/* Section header */}
        <div className={`flex items-center gap-2 p-3 ${depth === 0 ? 'bg-slate-100' : 'bg-slate-50'} border-b border-slate-200`}>
          <button
            onClick={() => updateSection(section.id, { isExpanded: !section.isExpanded })}
            className="p-1 hover:bg-slate-200 rounded"
            title={section.isExpanded ? 'Zwiń sekcję' : 'Rozwiń sekcję'}
          >
            {section.isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
          {editMode ? (
            <input
              type="text"
              value={section.name}
              onChange={e => updateSection(section.id, { name: e.target.value })}
              className="flex-1 px-2 py-1 border border-slate-200 rounded text-sm font-medium bg-white"
            />
          ) : (
            <span className="flex-1 font-medium text-slate-900">{section.name}</span>
          )}
          <span className="text-sm text-slate-500 mr-2">
            {formatCurrency(sectionTotal)}
          </span>
          {editMode && (
            <>
              <button
                onClick={() => {
                  const cloneItems = (items: LocalOfferItem[]): LocalOfferItem[] =>
                    items.map(item => ({ ...item, id: `new-item-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, components: item.components ? item.components.map(c => ({ ...c, id: `new-comp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` })) : [] }));
                  const cloneSec = (sec: LocalOfferSection): LocalOfferSection => ({
                    ...sec, id: `new-sec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, name: `${sec.name} (kopia)`,
                    items: cloneItems(sec.items), children: sec.children ? sec.children.map(cloneSec) : []
                  });
                  const newSec = cloneSec(section);
                  setSections(prev => { const idx = prev.findIndex(s => s.id === section.id); const arr = [...prev]; arr.splice(idx + 1, 0, newSec); return arr; });
                  showToast('Sekcja została zduplikowana', 'success');
                }}
                className="p-1 hover:bg-blue-100 rounded text-blue-600"
                title="Duplikuj sekcję"
              >
                <Copy className="w-4 h-4" />
              </button>
              <button
                onClick={() => deleteSection(section.id)}
                className="p-1 hover:bg-red-100 rounded text-red-600"
                title="Usuń sekcję"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}
        </div>

        {section.isExpanded && (
          <div>
            {/* Items table */}
            {section.items.length > 0 && (
              <div>
                <div className={`grid gap-2 px-4 py-2 text-xs text-slate-500 font-medium bg-slate-50/50 ${editMode && showBulkBar ? (calculationMode === 'markup' ? 'grid-cols-[24px_50px_1fr_60px_80px_100px_80px_100px_100px_60px_60px_32px]' : 'grid-cols-[24px_50px_1fr_60px_80px_100px_100px_60px_60px_32px]') : editMode ? (calculationMode === 'markup' ? 'grid-cols-[50px_1fr_60px_80px_100px_80px_100px_100px_60px_60px_32px]' : 'grid-cols-[50px_1fr_60px_80px_100px_100px_60px_60px_32px]') : 'grid-cols-[50px_1fr_60px_80px_100px_100px_60px_60px]'}`}>
                  {editMode && showBulkBar && <div></div>}
                  <div></div>
                  <div>Nazwa</div>
                  <div className="text-center">Jedn.</div>
                  <div className="text-right">Ilość</div>
                  {calculationMode === 'markup' && editMode && <div className="text-right">Koszt</div>}
                  {calculationMode === 'markup' && editMode && <div className="text-right">Narzut %</div>}
                  <div className="text-right">Cena jedn.</div>
                  <div className="text-right">Rabat%</div>
                  <div className="text-right">Wartość</div>
                  <div className="text-right">VAT</div>
                  {editMode && <div></div>}
                </div>
                {section.items
                  .filter(item => {
                    if (!itemSearchQuery) return true;
                    const q = itemSearchQuery.toLowerCase();
                    return item.name?.toLowerCase().includes(q) || item.description?.toLowerCase().includes(q);
                  })
                  .map(item => renderItem(section.id, item))}
              </div>
            )}

            {/* Add position divider */}
            {editMode && (
              <div className="flex items-center gap-3 px-4 py-2">
                <div className="flex-1 border-t border-dashed border-slate-200" />
                <button
                  onClick={() => addItem(section.id)}
                  className="flex items-center gap-1 px-3 py-1 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-full text-xs border border-dashed border-slate-300 hover:border-blue-300 transition"
                >
                  <Plus className="w-3 h-3" />
                  Dodaj pozycję
                </button>
                <div className="flex-1 border-t border-dashed border-slate-200" />
              </div>
            )}

            {/* Child subsections */}
            {(section.children || []).map(child => renderSection(child, depth + 1))}

            {/* Add subsection divider (inside section) */}
            {editMode && (
              <div className="flex items-center gap-3 px-4 py-2 ml-4">
                <div className="flex-1 border-t border-dashed border-slate-200" />
                <button
                  onClick={() => addSection(undefined, section.id)}
                  className="flex items-center gap-1 px-3 py-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-full text-xs border border-dashed border-slate-200 hover:border-blue-300 transition"
                >
                  <FolderPlus className="w-3 h-3" />
                  Dodaj podsekcję
                </button>
                <div className="flex-1 border-t border-dashed border-slate-200" />
              </div>
            )}

            {section.items.length === 0 && (!section.children || section.children.length === 0) && !editMode && (
              <div className="p-4 text-center text-slate-500 text-sm">
                Brak pozycji w tej sekcji
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // ============================================
  // RENDER: ITEM (position row with expandable components)
  // ============================================
  const renderItem = (sectionId: string, item: LocalOfferItem): React.ReactNode => {
    const itemTotal = item.quantity * item.unit_price;
    const itemDiscount = itemTotal * ((item.discount_percent || 0) / 100);
    const itemVat = (itemTotal - itemDiscount) * ((item.vat_rate ?? 23) / 100);

    return (
      <div key={item.id} className={`${item.is_optional ? 'bg-yellow-50' : (item.quantity === 0 || item.unit_price === 0) ? 'bg-red-50' : ''}`}>
        {/* Main row */}
        <div className={`grid gap-2 px-4 py-2 items-center text-sm border-b border-slate-50 ${editMode && showBulkBar ? (calculationMode === 'markup' ? 'grid-cols-[24px_50px_1fr_60px_80px_100px_80px_100px_100px_60px_60px_32px]' : 'grid-cols-[24px_50px_1fr_60px_80px_100px_100px_60px_60px_32px]') : editMode ? (calculationMode === 'markup' ? 'grid-cols-[50px_1fr_60px_80px_100px_80px_100px_100px_60px_60px_32px]' : 'grid-cols-[50px_1fr_60px_80px_100px_100px_60px_60px_32px]') : 'grid-cols-[50px_1fr_60px_80px_100px_100px_60px_60px]'}`}>
          {editMode && showBulkBar && (
            <div>
              <input
                type="checkbox"
                checked={item.selected || false}
                onChange={e => updateItem(sectionId, item.id, { selected: e.target.checked })}
                className="w-4 h-4 text-blue-600 rounded"
              />
            </div>
          )}
          {/* Components column - R/M/S icons */}
          <div className="flex gap-0.5">
            {(item.components || []).some(c => c.type === 'labor') && (
              <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-purple-100 text-purple-700" title="Robocizna">R</span>
            )}
            {(item.components || []).some(c => c.type === 'material') && (
              <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-green-100 text-green-700" title="Materiał">M</span>
            )}
            {(item.components || []).some(c => c.type === 'equipment') && (
              <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-orange-100 text-orange-700" title="Sprzęt">S</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {editMode && (
              <button
                onClick={() => updateItem(sectionId, item.id, { isExpanded: !item.isExpanded })}
                className="p-0.5 hover:bg-slate-100 rounded text-slate-400"
                title={item.isExpanded ? 'Zwiń składniki' : 'Rozwiń składniki'}
              >
                {item.isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>
            )}
            {editMode ? (
              <div className="flex-1 flex items-center gap-1">
                <input
                  type="text"
                  value={item.name}
                  onChange={e => updateItem(sectionId, item.id, { name: e.target.value })}
                  placeholder="Nazwa pozycji..."
                  className="flex-1 px-2 py-1 border border-slate-200 rounded text-sm"
                />
                <button
                  onClick={() => {
                    setKartotekaMode('fill_item');
                    setSearchPositionTarget({ sectionId });
                    setSearchComponentTarget({ sectionId, itemId: item.id, type: 'labor' });
                    setKartotekaSearchText('');
                    setKartotekaDetailItem(null);
                    setShowSearchLabourModal(true);
                  }}
                  className="p-1 hover:bg-blue-50 rounded text-blue-500 shrink-0"
                  title="Wybierz z kartoteki"
                >
                  <FolderOpen className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div>
                <p className="font-medium text-slate-900">{item.name}</p>
                {item.description && <p className="text-xs text-slate-500">{item.description}</p>}
              </div>
            )}
          </div>
          {/* Unit column */}
          <div className="text-center">
            {editMode ? (
              <select
                value={item.unit || 'szt.'}
                onChange={e => updateItem(sectionId, item.id, { unit: e.target.value })}
                className="w-full px-1 py-1 border border-slate-200 rounded text-xs"
              >
                {DEFAULT_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            ) : (
              <span className="text-xs text-slate-500">{item.unit || 'szt.'}</span>
            )}
          </div>
          <div className="text-right">
            {editMode ? (
              <input
                type="number"
                value={item.quantity}
                onChange={e => updateItem(sectionId, item.id, { quantity: parseFloat(e.target.value) || 0 })}
                className="w-full px-2 py-1 border border-slate-200 rounded text-right text-sm"
                step="0.01"
              />
            ) : (
              <span>{item.quantity}</span>
            )}
          </div>
          {calculationMode === 'markup' && editMode && (
            <div className="text-right">
              <input
                type="number"
                value={item.cost_price || 0}
                onChange={e => updateItem(sectionId, item.id, { cost_price: parseFloat(e.target.value) || 0 })}
                className="w-full px-2 py-1 border border-slate-200 rounded text-right text-sm"
                step="0.01"
              />
            </div>
          )}
          {calculationMode === 'markup' && editMode && (
            <div className="text-right">
              <input
                type="number"
                value={item.markup_percent || 0}
                onChange={e => updateItem(sectionId, item.id, { markup_percent: parseFloat(e.target.value) || 0 })}
                className="w-full px-2 py-1 border border-slate-200 rounded text-right text-sm"
                step="1"
              />
            </div>
          )}
          <div className="text-right">
            {editMode && calculationMode === 'fixed' ? (
              <input
                type="number"
                value={item.unit_price}
                onChange={e => updateItem(sectionId, item.id, { unit_price: parseFloat(e.target.value) || 0 })}
                className="w-full px-2 py-1 border border-slate-200 rounded text-right text-sm"
                step="0.01"
              />
            ) : (
              <span className={editMode ? 'text-slate-500' : ''}>{formatCurrency(item.unit_price)}</span>
            )}
          </div>
          {/* Rabat% column */}
          <div className="text-right">
            {editMode ? (
              <input
                type="number"
                value={item.discount_percent || 0}
                onChange={e => updateItem(sectionId, item.id, { discount_percent: parseFloat(e.target.value) || 0 })}
                className="w-full px-1 py-1 border border-slate-200 rounded text-right text-xs"
                step="1"
                min="0"
                max="100"
              />
            ) : (
              <span className={`text-xs ${(item.discount_percent || 0) > 0 ? 'text-red-500 font-medium' : 'text-slate-400'}`}>
                {(item.discount_percent || 0) > 0 ? `${item.discount_percent}%` : '-'}
              </span>
            )}
          </div>
          {/* Wartość (after discount) */}
          <div className="text-right font-medium text-slate-900">
            {formatCurrency(itemTotal - itemDiscount)}
          </div>
          {/* VAT column — click to cycle in edit mode */}
          <div className="text-right text-xs text-slate-500">
            {editMode ? (
              <button
                onClick={() => {
                  const current = item.vat_rate ?? 23;
                  const cycle = [23, 8, 5, 0];
                  const nextIdx = (cycle.indexOf(current) + 1) % cycle.length;
                  updateItem(sectionId, item.id, { vat_rate: cycle[nextIdx] });
                }}
                className="px-2 py-1 rounded hover:bg-slate-100 cursor-pointer text-xs font-medium"
                title="Kliknij aby zmienić stawkę VAT"
              >
                {item.vat_rate ?? 23}%
              </button>
            ) : (
              <span>{item.vat_rate ?? 23}%</span>
            )}
          </div>
          {editMode && (
            <div className="flex justify-end">
              <button
                onClick={() => deleteItem(sectionId, item.id)}
                className="p-1 hover:bg-red-50 rounded text-red-500"
                title="Usuń pozycję"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Expanded: components (Robocizna/Materiał/Sprzęt) + discount */}
        {item.isExpanded && editMode && (
          <div className="bg-slate-50/50 border-t border-slate-100 px-6 py-3 space-y-3">
            {/* Components list */}
            <div className="space-y-1">
              <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">Składniki</div>
              {(item.components || []).length === 0 ? (
                <p className="text-xs text-slate-400 italic">Brak składników</p>
              ) : (
                <div className="space-y-1">
                  {/* Component header row */}
                  <div className="grid grid-cols-[28px_1fr_55px_65px_80px_60px_80px_60px_80px_28px] gap-1 px-2 py-1 text-[10px] text-slate-400 font-medium uppercase">
                    <div></div>
                    <div>Nazwa</div>
                    <div className="text-center">Jedn.</div>
                    <div className="text-right">Ilość</div>
                    <div className="text-right">{calculationMode === 'markup' ? 'Koszt' : 'Cena'}</div>
                    <div className="text-right">Narzut%</div>
                    <div className="text-right">Cena jedn.</div>
                    <div className="text-right">Rabat%</div>
                    <div className="text-right">Wartość</div>
                    <div></div>
                  </div>
                  {(item.components || []).map(comp => {
                    const compMarkup = comp.markup_percent || 0;
                    const compPrice = calculationMode === 'markup' && compMarkup > 0
                      ? comp.unit_price * (1 + compMarkup / 100)
                      : comp.unit_price;
                    const compDisc = comp.discount_percent || 0;
                    const compTotal = comp.quantity * compPrice;
                    const compValue = compTotal - compTotal * (compDisc / 100);
                    return (
                    <div key={comp.id} className="grid grid-cols-[28px_1fr_55px_65px_80px_60px_80px_60px_80px_28px] gap-1 items-center text-sm bg-white rounded px-2 py-1 border border-slate-100">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase text-center ${
                        comp.type === 'labor' ? 'bg-purple-100 text-purple-700' :
                        comp.type === 'material' ? 'bg-green-100 text-green-700' :
                        'bg-orange-100 text-orange-700'
                      }`}>
                        {comp.type === 'labor' ? 'R' : comp.type === 'material' ? 'M' : 'S'}
                      </span>
                      <span className="text-xs text-slate-700 truncate" title={comp.name}>{comp.name}</span>
                      <div className="text-center">
                        <select
                          value={comp.unit || 'szt.'}
                          onChange={e => updateComponent(sectionId, item.id, comp.id, { unit: e.target.value })}
                          className="w-full px-0.5 py-0.5 border border-slate-200 rounded text-[10px]"
                        >
                          {DEFAULT_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                        </select>
                      </div>
                      <div className="text-right">
                        <input
                          type="number"
                          value={comp.quantity}
                          onChange={e => updateComponent(sectionId, item.id, comp.id, { quantity: parseFloat(e.target.value) || 0 })}
                          className="w-full px-1 py-0.5 border border-slate-200 rounded text-right text-xs"
                          step="0.01"
                        />
                      </div>
                      <div className="text-right">
                        <input
                          type="number"
                          value={comp.unit_price}
                          onChange={e => updateComponent(sectionId, item.id, comp.id, { unit_price: parseFloat(e.target.value) || 0 })}
                          className="w-full px-1 py-0.5 border border-slate-200 rounded text-right text-xs"
                          step="0.01"
                        />
                      </div>
                      <div className="text-right">
                        <input
                          type="number"
                          value={comp.markup_percent || 0}
                          onChange={e => updateComponent(sectionId, item.id, comp.id, { markup_percent: parseFloat(e.target.value) || 0 })}
                          className="w-full px-1 py-0.5 border border-slate-200 rounded text-right text-xs"
                          step="1"
                        />
                      </div>
                      <div className="text-right text-xs text-slate-500">{formatCurrency(compPrice)}</div>
                      <div className="text-right">
                        <input
                          type="number"
                          value={comp.discount_percent || 0}
                          onChange={e => updateComponent(sectionId, item.id, comp.id, { discount_percent: parseFloat(e.target.value) || 0 })}
                          className="w-full px-1 py-0.5 border border-slate-200 rounded text-right text-xs"
                          step="1"
                          min="0"
                          max="100"
                        />
                      </div>
                      <div className="text-right text-xs font-medium">{formatCurrency(compValue)}</div>
                      <button
                        onClick={() => deleteComponent(sectionId, item.id, comp.id)}
                        className="p-0.5 hover:bg-red-50 rounded text-red-400"
                        title="Usuń składnik"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );})}
                </div>
              )}
            </div>

            {/* Add component buttons */}
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setKartotekaMode('add_component');
                  setSearchComponentTarget({ sectionId, itemId: item.id, type: 'labor' });
                  setKartotekaSearchText('');
                  setKartotekaDetailItem(null);
                  setShowSearchLabourModal(true);
                }}
                className="flex items-center gap-1 px-2.5 py-1 bg-purple-50 text-purple-600 border border-purple-200 rounded text-xs hover:bg-purple-100"
              >
                <Hammer className="w-3 h-3" />
                Robocizna
              </button>
              <button
                onClick={() => {
                  setKartotekaMode('add_component');
                  setSearchComponentTarget({ sectionId, itemId: item.id, type: 'material' });
                  setKartotekaSearchText('');
                  setKartotekaDetailItem(null);
                  setKartotekaMainTab('katalog');
                  setShowSearchMaterialModal(true);
                }}
                className="flex items-center gap-1 px-2.5 py-1 bg-green-50 text-green-600 border border-green-200 rounded text-xs hover:bg-green-100"
              >
                <Package className="w-3 h-3" />
                Materiał
              </button>
              <button
                onClick={() => {
                  setKartotekaMode('add_component');
                  setSearchComponentTarget({ sectionId, itemId: item.id, type: 'equipment' });
                  setKartotekaSearchText('');
                  setKartotekaDetailItem(null);
                  setKartotekaMainTab('katalog');
                  setShowSearchEquipmentModal(true);
                }}
                className="flex items-center gap-1 px-2.5 py-1 bg-orange-50 text-orange-600 border border-orange-200 rounded text-xs hover:bg-orange-100"
              >
                <Wrench className="w-3 h-3" />
                Sprzęt
              </button>
            </div>
          </div>
        )}

        {/* View mode: show components read-only with full fields */}
        {!editMode && (item.components || []).length > 0 && (
          <div className="bg-slate-50/30 border-t border-slate-100 px-6 py-2">
            <div className="space-y-0.5">
              {(item.components || []).map(comp => (
                <div key={comp.id} className="grid grid-cols-[28px_1fr_50px_60px_80px_80px] gap-2 items-center text-xs py-0.5">
                  <span className={`px-1 py-0.5 rounded text-[9px] font-medium uppercase text-center ${
                    comp.type === 'labor' ? 'bg-purple-100 text-purple-700' :
                    comp.type === 'material' ? 'bg-green-100 text-green-700' :
                    'bg-orange-100 text-orange-700'
                  }`}>
                    {comp.type === 'labor' ? 'R' : comp.type === 'material' ? 'M' : 'S'}
                  </span>
                  <span className="text-slate-600 truncate">{comp.name}</span>
                  <span className="text-slate-400 text-center">{comp.unit}</span>
                  <span className="text-right text-slate-600">{comp.quantity}</span>
                  <span className="text-right text-slate-600">{formatCurrency(comp.unit_price)}</span>
                  <span className="text-right font-medium text-slate-700">{formatCurrency(comp.quantity * comp.unit_price)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  // ============================================
  // RENDER: OFFER DETAIL VIEW
  // ============================================
  const renderOfferDetail = () => {
    if (!selectedOffer) return null;

    return (
      <div className="p-6 pb-20">
        <button
          onClick={() => { setSelectedOffer(null); setEditMode(false); }}
          className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-4"
        >
          <ArrowLeft className="w-5 h-5" />
          Powrót do listy
        </button>

        <div className="bg-white rounded-xl border border-slate-200">
          {/* Header */}
          <div className="p-6 border-b border-slate-200">
            <div className="flex justify-between items-start">
              <div>
                {editMode ? (
                  <input
                    type="text"
                    value={offerData.name}
                    onChange={e => setOfferData({ ...offerData, name: e.target.value })}
                    className="text-2xl font-bold text-slate-900 px-2 py-1 border border-slate-200 rounded-lg"
                  />
                ) : (
                  <h1 className="text-2xl font-bold text-slate-900">{selectedOffer.name}</h1>
                )}
                {editMode ? (
                  <input
                    type="text"
                    value={offerData.number || selectedOffer.number || ''}
                    onChange={e => setOfferData({ ...offerData, number: e.target.value })}
                    className="text-slate-500 mt-1 px-2 py-0.5 border border-slate-200 rounded text-sm"
                  />
                ) : (
                  <p className="text-slate-500 mt-1">{selectedOffer.number || 'Brak numeru'}</p>
                )}
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <StatusBadge status={selectedOffer.status} />
                <button
                  onClick={() => setShowSettingsModal(true)}
                  className={`p-1.5 border border-slate-200 rounded-lg ${selectedOffer.status === 'accepted' ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-50'}`}
                  title={selectedOffer.status === 'accepted' ? 'Ustawienia zablokowane — oferta zaakceptowana' : 'Ustawienia oferty'}
                  disabled={selectedOffer.status === 'accepted'}
                >
                  <Settings className="w-4 h-4 text-slate-500" />
                </button>
                {!editMode && (
                  <button
                    onClick={() => {
                      setRequestType('all');
                      setRequestStep('type');
                      setRequestOfferId(selectedOffer.id);
                      setRequestName(`Zapytanie — ${selectedOffer.name || selectedOffer.number || ''}`);
                      setRequestSubcontractorId('');
                      setRequestSections([]);
                      setSelectedSubcontractor(null);
                      setSelectedSupplier(null);
                      setSubcontractorSearch('');
                      setSupplierSearch('');
                      setShowCreateRequestModal(true);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 border border-indigo-200 bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 text-sm"
                    title="Utwórz zapytanie ofertowe dla podwykonawcy"
                  >
                    <FileText className="w-4 h-4" />
                    Zapytanie ofertowe
                  </button>
                )}
                {selectedOffer.status === 'draft' && (
                  <div className="flex gap-2">
                    {!editMode ? (
                      <>
                        <button
                          onClick={() => setEditMode(true)}
                          className="flex items-center gap-1 px-3 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 text-sm"
                        >
                          <Pencil className="w-4 h-4" />
                          Edytuj
                        </button>
                        <button
                          onClick={() => setShowSendModal(true)}
                          className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
                        >
                          <Send className="w-4 h-4" />
                          Wyślij
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => { setEditMode(false); loadOfferDetails(selectedOffer.id); }}
                          className="flex items-center gap-1 px-3 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 text-sm"
                        >
                          <X className="w-4 h-4" />
                          Anuluj
                        </button>
                        <button
                          onClick={handleUpdateOffer}
                          disabled={savingOffer}
                          className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
                          title="Zapisz ofertę (Ctrl+S)"
                        >
                          {savingOffer ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                          Zapisz
                        </button>
                      </>
                    )}
                  </div>
                )}
                {selectedOffer.status === 'sent' && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleAcceptOffer(selectedOffer)}
                      className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
                    >
                      <CheckCircle className="w-4 h-4" />
                      Akceptuj
                    </button>
                    <button
                      onClick={() => handleRejectOffer(selectedOffer)}
                      className="flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm"
                    >
                      <XCircle className="w-4 h-4" />
                      Odrzuć
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Client search block (edit mode) */}
          {editMode && (
            <div className="p-6 border-b border-slate-200 space-y-4 bg-blue-50/30">
              <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                <Building2 className="w-5 h-5 text-blue-500" />
                Zamawiający
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* NIP + GUS */}
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">NIP</label>
                  <div className="flex gap-1">
                    <input
                      type="text"
                      value={offerClientData.nip}
                      onChange={e => {
                        const val = e.target.value;
                        setOfferClientData(prev => ({ ...prev, nip: val }));
                        setOfferGusError(null);
                        setOfferGusSuccess(null);
                        // Search clients by NIP
                        if (val.replace(/\D/g, '').length >= 3) {
                          const q = val.replace(/\D/g, '');
                          const filtered = offerExistingClients.filter(c => c.nip && c.nip.replace(/\D/g, '').includes(q));
                          setOfferFilteredClients(filtered);
                          setOfferShowClientDropdown(filtered.length > 0);
                        }
                      }}
                      className="flex-1 px-2 py-1.5 border border-slate-200 rounded text-sm"
                      placeholder="NIP..."
                    />
                    <button
                      type="button"
                      onClick={handleOfferFetchGus}
                      disabled={offerGusLoading || !offerClientData.nip || offerExistingClients.some(c => c.nip && c.nip.replace(/\D/g, '') === offerClientData.nip.replace(/\D/g, ''))}
                      className="px-2 py-1.5 bg-green-600 text-white rounded text-xs hover:bg-green-700 disabled:opacity-50 flex items-center gap-1 whitespace-nowrap"
                    >
                      {offerGusLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                      GUS
                    </button>
                  </div>
                  {offerGusError && <p className="text-xs text-red-600 mt-1">{offerGusError}</p>}
                  {offerGusSuccess && <p className="text-xs text-green-600 mt-1">{offerGusSuccess}</p>}
                </div>

                {/* Company name with search */}
                <div className="relative">
                  <label className="block text-xs font-medium text-slate-500 mb-1">Nazwa firmy</label>
                  <input
                    type="text"
                    value={offerClientData.client_name}
                    onChange={e => {
                      const val = e.target.value;
                      setOfferClientData(prev => ({ ...prev, client_name: val }));
                      setOfferClientSearchQuery(val);
                      if (val.length >= 2) {
                        const q = val.toLowerCase();
                        const filtered = offerExistingClients.filter(c =>
                          c.client_name.toLowerCase().includes(q) ||
                          (c.nip && c.nip.includes(q)) ||
                          (c.company_city && c.company_city.toLowerCase().includes(q))
                        );
                        setOfferFilteredClients(filtered);
                        setOfferShowClientDropdown(filtered.length > 0);
                      } else {
                        setOfferShowClientDropdown(false);
                      }
                    }}
                    onBlur={() => setTimeout(() => setOfferShowClientDropdown(false), 200)}
                    className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm"
                    placeholder="Wyszukaj lub wpisz..."
                  />
                  {offerShowClientDropdown && offerFilteredClients.length > 0 && (
                    <div className="absolute z-20 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {offerFilteredClients.slice(0, 10).map((client, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => {
                            selectOfferExistingClient(client);
                            // Also set client_id in offerData
                            if (client.contractor_id) {
                              setOfferData(prev => ({ ...prev, client_id: client.contractor_id || '' }));
                            }
                          }}
                          className="w-full px-3 py-2 text-left hover:bg-blue-50 border-b border-slate-100 last:border-0"
                        >
                          <div className="font-medium text-sm text-slate-900">{client.client_name}</div>
                          <div className="text-xs text-slate-500 flex gap-2">
                            {client.nip && <span>NIP: {client.nip}</span>}
                            {client.company_city && <span>{client.company_city}</span>}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Address */}
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Adres</label>
                  <input
                    type="text"
                    value={[offerClientData.company_street, offerClientData.company_street_number, offerClientData.company_postal_code, offerClientData.company_city].filter(Boolean).join(', ') || ''}
                    onChange={e => {
                      const val = e.target.value;
                      // Simple search by address
                      if (val.length >= 2) {
                        const q = val.toLowerCase();
                        const filtered = offerExistingClients.filter(c =>
                          (c.company_city && c.company_city.toLowerCase().includes(q)) ||
                          (c.company_street && c.company_street.toLowerCase().includes(q))
                        );
                        setOfferFilteredClients(filtered);
                        setOfferShowClientDropdown(filtered.length > 0);
                      }
                    }}
                    className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm bg-slate-50"
                    placeholder="Adres..."
                    readOnly={offerClientSelected}
                  />
                </div>
              </div>

            </div>
          )}

          {/* Info cards */}
          <div className={`grid grid-cols-1 ${editMode ? 'md:grid-cols-4' : 'md:grid-cols-3 lg:grid-cols-6'} gap-4 p-6 border-b border-slate-200`}>
            {!editMode && (
              <div className="p-4 bg-slate-50 rounded-lg">
                <p className="text-sm text-slate-500 mb-1">Zamawiający</p>
                {(selectedOffer as any).client ? (
                  <div>
                    <p className="font-medium text-slate-900">{(selectedOffer as any).client.name}</p>
                    {(selectedOffer as any).client.nip && <p className="text-xs text-slate-500">NIP: {(selectedOffer as any).client.nip}</p>}
                    {(selectedOffer as any).client.legal_address && <p className="text-xs text-slate-500">{(selectedOffer as any).client.legal_address}</p>}
                  </div>
                ) : offerClientData.client_name ? (
                  <div>
                    <p className="font-medium text-slate-900">{offerClientData.client_name}</p>
                    {offerClientData.nip && <p className="text-xs text-slate-500">NIP: {offerClientData.nip}</p>}
                    {(offerClientData.company_street || offerClientData.company_city) && (
                      <p className="text-xs text-slate-500">{[offerClientData.company_street, offerClientData.company_street_number, offerClientData.company_postal_code, offerClientData.company_city].filter(Boolean).join(', ')}</p>
                    )}
                  </div>
                ) : (
                  <p className="font-medium text-slate-900">Nie przypisano</p>
                )}
              </div>
            )}
            {/* Przedstawiciel Zamawiającego tile */}
            {!editMode && (() => {
              const ps = selectedOffer?.print_settings?.client_data;
              const rep = offerClientContacts.find((c: any) => c.id === sendRepresentativeId) || offerClientContacts[0];
              const repName = rep ? `${rep.first_name || ''} ${rep.last_name || ''}`.trim() : ps?.representative_name || '';
              const repPosition = rep?.position || ps?.representative_position || '';
              const repEmail = rep?.email || ps?.representative_email || '';
              const repPhone = rep?.phone || ps?.representative_phone || '';
              return (
                <div className="p-4 bg-slate-50 rounded-lg">
                  <p className="text-sm text-slate-500 mb-1">Przedstawiciel</p>
                  {repName ? (
                    <div>
                      <p className="font-medium text-slate-900">{repName}</p>
                      {repPosition && <p className="text-xs text-slate-500">{repPosition}</p>}
                      {repPhone && <p className="text-xs text-slate-500">{repPhone}</p>}
                      {repEmail && <p className="text-xs text-slate-500">{repEmail}</p>}
                      {rep?.is_main_contact && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full mt-1">
                          <Star className="w-3 h-3" />
                          Główny kontakt
                        </span>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-400 italic">Nie przypisano</p>
                  )}
                </div>
              );
            })()}
            {/* Przedstawiciel Zamawiającego — edit mode */}
            {editMode && (
              <div className="p-4 bg-slate-50 rounded-lg">
                <label className="block text-sm font-medium text-slate-700 mb-1">Przedstawiciel</label>
                {offerClientContacts.length > 0 && !showAddRepInline ? (
                  <>
                    <select
                      value={sendRepresentativeId}
                      onChange={e => { setSendRepresentativeId(e.target.value); setShowAddRepInline(false); }}
                      className="w-full px-2 py-1 border border-slate-200 rounded text-sm"
                    >
                      <option value="">-- Wybierz --</option>
                      {offerClientContacts.map((c: any) => (
                        <option key={c.id} value={c.id}>
                          {c.is_main_contact ? '★ ' : ''}{c.first_name} {c.last_name}{c.position ? ` — ${c.position}` : ''}
                        </option>
                      ))}
                    </select>
                    {(() => {
                      const rep = offerClientContacts.find((c: any) => c.id === sendRepresentativeId);
                      if (!rep) return null;
                      return (
                        <div className="mt-2 text-xs text-slate-500 space-y-0.5">
                          {rep.position && <p>{rep.position}</p>}
                          {rep.phone && <p>{rep.phone}</p>}
                          {rep.email && <p>{rep.email}</p>}
                          {rep.is_main_contact && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">
                              <Star className="w-3 h-3" />
                              Główny kontakt
                            </span>
                          )}
                        </div>
                      );
                    })()}
                    <button
                      type="button"
                      onClick={() => { setSendRepresentativeId(''); setShowAddRepInline(true); setNewRepData({ first_name: '', last_name: '', phone: '', email: '', position: '', is_main_contact: false }); }}
                      className="mt-2 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                    >
                      <UserPlus className="w-3 h-3" />
                      Dodaj nowego
                    </button>
                  </>
                ) : showAddRepInline ? (
                  <div className="mt-2 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <input type="text" value={newRepData.first_name} onChange={e => setNewRepData(p => ({ ...p, first_name: e.target.value }))} className="px-2 py-1.5 border border-slate-200 rounded text-sm" placeholder="Imię *" />
                      <input type="text" value={newRepData.last_name} onChange={e => setNewRepData(p => ({ ...p, last_name: e.target.value }))} className="px-2 py-1.5 border border-slate-200 rounded text-sm" placeholder="Nazwisko *" />
                    </div>
                    <input type="tel" value={newRepData.phone} onChange={e => setNewRepData(p => ({ ...p, phone: formatPhoneNumber(e.target.value) }))} className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm" placeholder="Telefon" maxLength={16} />
                    <input type="email" value={newRepData.email} onChange={e => setNewRepData(p => ({ ...p, email: e.target.value }))} className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm" placeholder="E-mail" />
                    <input type="text" value={newRepData.position} onChange={e => setNewRepData(p => ({ ...p, position: e.target.value }))} className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm" placeholder="Stanowisko" />
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={newRepData.is_main_contact} onChange={e => setNewRepData(p => ({ ...p, is_main_contact: e.target.checked }))} className="w-3.5 h-3.5 text-amber-600 rounded" />
                      <span className="text-xs text-slate-600 flex items-center gap-1"><Star className="w-3 h-3 text-amber-500" /> Główny kontakt</span>
                    </label>
                    {offerClientContacts.length > 0 && (
                      <button type="button" onClick={() => setShowAddRepInline(false)} className="text-xs text-slate-500 hover:text-slate-700">
                        Wybierz z istniejących
                      </button>
                    )}
                    <p className="text-[10px] text-slate-400 italic">Kontakt zostanie zapisany przy zapisie oferty</p>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => { setShowAddRepInline(true); setNewRepData({ first_name: '', last_name: '', phone: '', email: '', position: '', is_main_contact: true }); }}
                    className="mt-1 flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    <UserPlus className="w-3 h-3" />
                    Dodaj przedstawiciela
                  </button>
                )}
              </div>
            )}
            <div className="p-4 bg-slate-50 rounded-lg">
              <p className="text-sm text-slate-500 mb-1">Projekt</p>
              {editMode ? (
                <select
                  value={offerData.project_id}
                  onChange={e => setOfferData({ ...offerData, project_id: e.target.value })}
                  className="w-full px-2 py-1 border border-slate-200 rounded text-sm"
                >
                  <option value="">-- Wybierz --</option>
                  {projects
                    .filter(p => !offerData.client_id || (p as any).contractor_client_id === offerData.client_id || !(p as any).contractor_client_id)
                    .map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              ) : (selectedOffer as any).project?.name ? (
                <p className="font-medium text-slate-900">{(selectedOffer as any).project.name}</p>
              ) : (
                <div>
                  <p className="text-sm text-slate-400 mb-2">Nie przypisano</p>
                  <button
                    onClick={async () => {
                      if (!currentUser) return;
                      try {
                        const { data: newProj } = await supabase.from('projects').insert({
                          company_id: currentUser.company_id,
                          name: selectedOffer.name || selectedOffer.number || 'Nowy projekt',
                          status: 'active',
                          contractor_client_id: (selectedOffer as any).client_id || null,
                          color: '#3b82f6'
                        }).select('*').single();
                        if (newProj) {
                          await supabase.from('offers').update({ project_id: newProj.id }).eq('id', selectedOffer.id);
                          setProjects(prev => [...prev, newProj]);
                          loadOfferDetails(selectedOffer.id);
                        }
                      } catch (err) { console.error('Error creating project:', err); }
                    }}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    <Plus className="w-3 h-3" />
                    Utwórz projekt
                  </button>
                </div>
              )}
            </div>
            <div className="p-4 bg-slate-50 rounded-lg">
              <p className="text-sm text-slate-500 mb-1">Data wystawienia</p>
              {editMode ? (
                <input
                  type="date"
                  value={issueDate}
                  onChange={e => setIssueDate(e.target.value)}
                  className="w-full px-2 py-1 border border-slate-200 rounded text-sm"
                />
              ) : (
                <p className="font-medium text-slate-900">{formatDate(issueDate)}</p>
              )}
            </div>
            <div className="p-4 bg-slate-50 rounded-lg">
              <p className="text-sm text-slate-500 mb-1">Ważna do</p>
              {editMode ? (
                <input
                  type="date"
                  value={offerData.valid_until}
                  onChange={e => setOfferData({ ...offerData, valid_until: e.target.value })}
                  className="w-full px-2 py-1 border border-slate-200 rounded text-sm"
                />
              ) : (
                <p className="font-medium text-slate-900">{formatDate(selectedOffer.valid_until)}</p>
              )}
            </div>
          </div>

          {/* Object info block */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 px-6 py-4 border-b border-slate-200 bg-slate-50/50">
            <div>
              <p className="text-xs font-medium text-slate-500 mb-1">Nazwa obiektu</p>
              {editMode ? (
                <input
                  type="text"
                  value={objectName}
                  onChange={e => setObjectName(e.target.value)}
                  className="w-full px-2 py-1 border border-slate-200 rounded text-sm"
                  placeholder="Nazwa obiektu..."
                />
              ) : (
                <p className="text-sm font-medium text-slate-900">{objectName || '-'}</p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500 mb-1">Adres obiektu</p>
              {editMode ? (
                <input
                  type="text"
                  value={objectAddress}
                  onChange={e => setObjectAddress(e.target.value)}
                  className="w-full px-2 py-1 border border-slate-200 rounded text-sm"
                  placeholder="Adres obiektu..."
                />
              ) : (
                <p className="text-sm font-medium text-slate-900">{objectAddress || '-'}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-xs font-medium text-slate-500 mb-1">Rozpoczęcie robót</p>
                {editMode ? (
                  <input
                    type="date"
                    value={workStartDate}
                    onChange={e => setWorkStartDate(e.target.value)}
                    className="w-full px-2 py-1 border border-slate-200 rounded text-sm"
                  />
                ) : (
                  <p className="text-sm font-medium text-slate-900">{workStartDate ? formatDate(workStartDate) : '-'}</p>
                )}
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500 mb-1">Zakończenie robót</p>
                {editMode ? (
                  <input
                    type="date"
                    value={workEndDate}
                    onChange={e => setWorkEndDate(e.target.value)}
                    className="w-full px-2 py-1 border border-slate-200 rounded text-sm"
                  />
                ) : (
                  <p className="text-sm font-medium text-slate-900">{workEndDate ? formatDate(workEndDate) : '-'}</p>
                )}
              </div>
            </div>
          </div>

          {/* Warunki istotne block */}
          <div className="px-6 py-4 border-b border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <ListChecks className="w-4 h-4 text-slate-400" />
                Warunki istotne
              </h3>
              {(() => {
                const ptRule = paymentTermRules.find(r => String(r.value) === paymentTerm);
                const wrRule = warrantyRules.find(r => String(r.value) === warrantyPeriod);
                const ifRule = invoiceFreqRules.find(r => String(r.value) === invoiceFrequency);
                const totalSurcharge = (paymentTermApply ? (ptRule?.surcharge || 0) : 0) + (warrantyApply ? (wrRule?.surcharge || 0) : 0) + (invoiceFreqApply ? (ifRule?.surcharge || 0) : 0);
                return totalSurcharge !== 0 ? (
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${totalSurcharge > 0 ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-green-50 text-green-600 border border-green-100'}`}>
                    {totalSurcharge > 0 ? '+' : ''}{totalSurcharge}% {totalSurcharge > 0 ? 'narzut' : 'rabat'}
                  </span>
                ) : null;
              })()}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Payment term */}
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Termin płatności</p>
                  {paymentTerm && (
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1 cursor-pointer" title={paymentTermShowOnOffer ? 'Widoczny na ofercie' : 'Ukryty na ofercie'}>
                        <input type="checkbox" checked={paymentTermShowOnOffer} onChange={e => setPaymentTermShowOnOffer(e.target.checked)} className="w-3 h-3 text-green-600 rounded" disabled={!editMode} />
                        <span className={`text-[10px] font-medium ${paymentTermShowOnOffer ? 'text-green-600' : 'text-slate-400'}`}>Na ofercie</span>
                      </label>
                      <label className="flex items-center gap-1 cursor-pointer" title={paymentTermApply ? 'Uwzględniony w kalkulacji' : 'Tylko informacyjnie'}>
                        <input type="checkbox" checked={paymentTermApply} onChange={e => setPaymentTermApply(e.target.checked)} className="w-3 h-3 text-blue-600 rounded" disabled={!editMode} />
                        <span className={`text-[10px] font-medium ${paymentTermApply ? 'text-blue-600' : 'text-slate-400'}`}>Uwzgl.</span>
                      </label>
                    </div>
                  )}
                </div>
                {editMode ? (
                  <select value={paymentTerm} onChange={e => setPaymentTerm(e.target.value)} className="w-full px-2.5 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-200 focus:border-blue-400">
                    <option value="">— Wybierz —</option>
                    {(paymentTermRules.length > 0 ? paymentTermRules.map(r => r.value) : paymentTermOptions).map(v => {
                      const rule = paymentTermRules.find(r => r.value === v);
                      return <option key={v} value={String(v)}>{v} dni{rule && rule.surcharge !== 0 ? ` (${rule.surcharge > 0 ? '+' : ''}${rule.surcharge}%)` : ''}</option>;
                    })}
                  </select>
                ) : (
                  <p className="text-sm font-medium text-slate-900">{paymentTerm ? `${paymentTerm} dni` : '-'}</p>
                )}
                {paymentTerm && (() => { const r = paymentTermRules.find(r => String(r.value) === paymentTerm); return r && r.surcharge !== 0 ? <p className={`text-xs mt-1.5 ${paymentTermApply ? (r.surcharge > 0 ? 'text-red-500' : 'text-green-600') : 'text-slate-400 italic'}`}>{r.surcharge > 0 ? 'Narzut' : 'Rabat'}: {r.surcharge > 0 ? '+' : ''}{r.surcharge}%{!paymentTermApply ? ' (informacyjnie)' : ''}</p> : null; })()}
              </div>
              {/* Invoice frequency */}
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Fakturowanie</p>
                  {invoiceFrequency && (
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1 cursor-pointer" title={invoiceFreqShowOnOffer ? 'Widoczny na ofercie' : 'Ukryty na ofercie'}>
                        <input type="checkbox" checked={invoiceFreqShowOnOffer} onChange={e => setInvoiceFreqShowOnOffer(e.target.checked)} className="w-3 h-3 text-green-600 rounded" disabled={!editMode} />
                        <span className={`text-[10px] font-medium ${invoiceFreqShowOnOffer ? 'text-green-600' : 'text-slate-400'}`}>Na ofercie</span>
                      </label>
                      <label className="flex items-center gap-1 cursor-pointer" title={invoiceFreqApply ? 'Uwzględniony w kalkulacji' : 'Tylko informacyjnie'}>
                        <input type="checkbox" checked={invoiceFreqApply} onChange={e => setInvoiceFreqApply(e.target.checked)} className="w-3 h-3 text-blue-600 rounded" disabled={!editMode} />
                        <span className={`text-[10px] font-medium ${invoiceFreqApply ? 'text-blue-600' : 'text-slate-400'}`}>Uwzgl.</span>
                      </label>
                    </div>
                  )}
                </div>
                {editMode ? (
                  <select value={invoiceFrequency} onChange={e => setInvoiceFrequency(e.target.value)} className="w-full px-2.5 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-200 focus:border-blue-400">
                    <option value="">— Wybierz —</option>
                    {(invoiceFreqRules.length > 0 ? invoiceFreqRules.map(r => r.value) : invoiceFreqOptions).map(v => {
                      const rule = invoiceFreqRules.find(r => r.value === v);
                      return <option key={v} value={String(v)}>co {v} dni{rule && rule.surcharge !== 0 ? ` (${rule.surcharge > 0 ? '+' : ''}${rule.surcharge}%)` : ''}</option>;
                    })}
                  </select>
                ) : (
                  <p className="text-sm font-medium text-slate-900">{invoiceFrequency ? `co ${invoiceFrequency} dni` : '-'}</p>
                )}
                {invoiceFrequency && (() => { const r = invoiceFreqRules.find(r => String(r.value) === invoiceFrequency); return r && r.surcharge !== 0 ? <p className={`text-xs mt-1.5 ${invoiceFreqApply ? (r.surcharge > 0 ? 'text-red-500' : 'text-green-600') : 'text-slate-400 italic'}`}>{r.surcharge > 0 ? 'Narzut' : 'Rabat'}: {r.surcharge > 0 ? '+' : ''}{r.surcharge}%{!invoiceFreqApply ? ' (informacyjnie)' : ''}</p> : null; })()}
              </div>
              {/* Warranty */}
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Gwarancja</p>
                  {warrantyPeriod && (
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1 cursor-pointer" title={warrantyShowOnOffer ? 'Widoczny na ofercie' : 'Ukryty na ofercie'}>
                        <input type="checkbox" checked={warrantyShowOnOffer} onChange={e => setWarrantyShowOnOffer(e.target.checked)} className="w-3 h-3 text-green-600 rounded" disabled={!editMode} />
                        <span className={`text-[10px] font-medium ${warrantyShowOnOffer ? 'text-green-600' : 'text-slate-400'}`}>Na ofercie</span>
                      </label>
                      <label className="flex items-center gap-1 cursor-pointer" title={warrantyApply ? 'Uwzględniony w kalkulacji' : 'Tylko informacyjnie'}>
                        <input type="checkbox" checked={warrantyApply} onChange={e => setWarrantyApply(e.target.checked)} className="w-3 h-3 text-blue-600 rounded" disabled={!editMode} />
                        <span className={`text-[10px] font-medium ${warrantyApply ? 'text-blue-600' : 'text-slate-400'}`}>Uwzgl.</span>
                      </label>
                    </div>
                  )}
                </div>
                {editMode ? (
                  <select value={warrantyPeriod} onChange={e => setWarrantyPeriod(e.target.value)} className="w-full px-2.5 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-200 focus:border-blue-400">
                    <option value="">— Wybierz —</option>
                    {(warrantyRules.length > 0 ? warrantyRules.map(r => r.value) : warrantyOptions).map(v => {
                      const rule = warrantyRules.find(r => r.value === v);
                      return <option key={v} value={String(v)}>{v} mies.{rule && rule.surcharge !== 0 ? ` (${rule.surcharge > 0 ? '+' : ''}${rule.surcharge}%)` : ''}</option>;
                    })}
                  </select>
                ) : (
                  <p className="text-sm font-medium text-slate-900">{warrantyPeriod ? `${warrantyPeriod} mies.` : '-'}</p>
                )}
                {warrantyPeriod && (() => { const r = warrantyRules.find(r => String(r.value) === warrantyPeriod); return r && r.surcharge !== 0 ? <p className={`text-xs mt-1.5 ${warrantyApply ? (r.surcharge > 0 ? 'text-red-500' : 'text-green-600') : 'text-slate-400 italic'}`}>{r.surcharge > 0 ? 'Narzut' : 'Rabat'}: {r.surcharge > 0 ? '+' : ''}{r.surcharge}%{!warrantyApply ? ' (informacyjnie)' : ''}</p> : null; })()}
              </div>
            </div>
            {/* Custom warunki */}
            {customWarunki.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                {customWarunki.map(cw => (
                  <div key={cw.id} className="p-3 bg-amber-50/50 rounded-lg border border-amber-100">
                    <div className="flex items-center justify-between mb-2">
                      {editMode ? (
                        <input type="text" value={cw.name} onChange={e => setCustomWarunki(prev => prev.map(w => w.id === cw.id ? { ...w, name: e.target.value } : w))} className="text-xs font-semibold text-slate-500 uppercase tracking-wider bg-transparent border-none p-0 flex-1 focus:outline-none" placeholder="Nazwa warunku..." />
                      ) : (
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{cw.name}</p>
                      )}
                      <div className="flex items-center gap-1.5 shrink-0 ml-1">
                        <label className="flex items-center gap-1 cursor-pointer" title={cw.show_on_offer ? 'Widoczny na ofercie' : 'Ukryty na ofercie'}>
                          <input type="checkbox" checked={cw.show_on_offer} onChange={e => setCustomWarunki(prev => prev.map(w => w.id === cw.id ? { ...w, show_on_offer: e.target.checked } : w))} className="w-3 h-3 text-green-600 rounded" disabled={!editMode} />
                          <span className={`text-[10px] font-medium ${cw.show_on_offer ? 'text-green-600' : 'text-slate-400'}`}>Na ofercie</span>
                        </label>
                        <label className="flex items-center gap-1 cursor-pointer" title={cw.apply ? 'Uwzględniony w kalkulacji' : 'Tylko informacyjnie'}>
                          <input type="checkbox" checked={cw.apply} onChange={e => setCustomWarunki(prev => prev.map(w => w.id === cw.id ? { ...w, apply: e.target.checked } : w))} className="w-3 h-3 text-blue-600 rounded" disabled={!editMode} />
                          <span className={`text-[10px] font-medium ${cw.apply ? 'text-blue-600' : 'text-slate-400'}`}>Uwzgl.</span>
                        </label>
                        {editMode && (
                          <button onClick={() => setCustomWarunki(prev => prev.filter(w => w.id !== cw.id))} className="p-0.5 hover:bg-red-50 rounded text-red-400" title="Usuń warunek"><X className="w-3.5 h-3.5" /></button>
                        )}
                      </div>
                    </div>
                    {editMode ? (
                      <div className="flex gap-2">
                        <input type="text" value={cw.value} onChange={e => setCustomWarunki(prev => prev.map(w => w.id === cw.id ? { ...w, value: e.target.value } : w))} className="flex-1 px-2.5 py-2 border border-slate-200 rounded-lg text-sm bg-white" placeholder="Wartość..." />
                        <div className="flex items-center gap-1">
                          <input type="number" value={cw.surcharge} onChange={e => setCustomWarunki(prev => prev.map(w => w.id === cw.id ? { ...w, surcharge: parseFloat(e.target.value) || 0 } : w))} className="w-16 px-1.5 py-2 border border-slate-200 rounded-lg text-sm text-center" step="0.5" />
                          <span className="text-xs text-slate-400">%</span>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm font-medium text-slate-900">{cw.value || '-'}</p>
                    )}
                    {cw.surcharge !== 0 && <p className={`text-xs mt-1.5 ${cw.apply ? (cw.surcharge > 0 ? 'text-red-500' : 'text-green-600') : 'text-slate-400 italic'}`}>{cw.surcharge > 0 ? 'Narzut' : 'Rabat'}: {cw.surcharge > 0 ? '+' : ''}{cw.surcharge}%{!cw.apply ? ' (informacyjnie)' : ''}</p>}
                  </div>
                ))}
              </div>
            )}
            {editMode && (
              <button
                onClick={() => setCustomWarunki(prev => [...prev, { id: `cw_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`, name: '', value: '', surcharge: 0, apply: true, show_on_offer: true }])}
                className="mt-3 flex items-center gap-1 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded border border-dashed border-blue-300"
              >
                <Plus className="w-3.5 h-3.5" />
                Dodaj warunek
              </button>
            )}
          </div>

          {/* Bulk operations bar */}
          {editMode && showBulkBar && (
            <div className="px-6 py-3 bg-amber-50 border-b border-amber-200 flex items-center gap-4">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedItemsCount > 0 && selectedItemsCount === getAllItems(sections).length}
                  onChange={e => toggleSelectAll(e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded"
                />
                <span className="text-sm text-amber-900 font-medium">
                  Zaznaczono: {selectedItemsCount} pozycji
                </span>
              </div>
              <div className="flex gap-2 ml-auto">
                <button
                  onClick={() => setShowBulkRabatModal(true)}
                  disabled={selectedItemsCount === 0}
                  className="flex items-center gap-1 px-3 py-1.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 text-sm disabled:opacity-50"
                >
                  <Percent className="w-4 h-4" />
                  Rabat
                </button>
                <select
                  onChange={e => { if (e.target.value) applyBulkVat(Number(e.target.value)); }}
                  disabled={selectedItemsCount === 0}
                  className="px-3 py-1.5 border border-amber-300 rounded-lg text-sm bg-white disabled:opacity-50"
                  defaultValue=""
                >
                  <option value="" disabled>VAT</option>
                  <option value="23">23%</option>
                  <option value="8">8%</option>
                  <option value="5">5%</option>
                  <option value="0">0%</option>
                </select>
                <button
                  onClick={() => { setShowBulkBar(false); toggleSelectAll(false); }}
                  className="flex items-center gap-1 px-3 py-1.5 border border-amber-300 rounded-lg hover:bg-amber-100 text-sm text-amber-900"
                >
                  <X className="w-4 h-4" />
                  Zamknij
                </button>
              </div>
            </div>
          )}

          {/* Sections & Items */}
          <div className="p-6 border-b border-slate-200">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-4">
                <h2 className="text-lg font-semibold text-slate-900">Pozycje oferty</h2>
                {editMode ? (
                  <button
                    onClick={() => setCalculationMode(prev => prev === 'markup' ? 'fixed' : 'markup')}
                    className="flex items-center gap-1.5 px-3 py-1 bg-slate-100 rounded-lg hover:bg-slate-200 transition"
                  >
                    {calculationMode === 'markup' ? (
                      <ToggleLeft className="w-5 h-5 text-blue-600" />
                    ) : (
                      <ToggleRight className="w-5 h-5 text-green-600" />
                    )}
                    <span className="text-sm font-medium text-slate-700">
                      {calculationMode === 'markup' ? 'Narzut' : 'Wartość stała'}
                    </span>
                  </button>
                ) : (
                  <span className="flex items-center gap-1.5 px-3 py-1 bg-slate-100 rounded-lg text-sm font-medium text-slate-700">
                    {calculationMode === 'markup' ? (
                      <ToggleLeft className="w-5 h-5 text-blue-600" />
                    ) : (
                      <ToggleRight className="w-5 h-5 text-green-600" />
                    )}
                    {calculationMode === 'markup' ? 'Narzut' : 'Wartość stała'}
                  </span>
                )}
              </div>
              <div className="flex gap-2 items-center">
                {sections.length > 0 && (
                  <>
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        value={itemSearchQuery}
                        onChange={e => setItemSearchQuery(e.target.value)}
                        placeholder="Szukaj pozycji..."
                        className="pl-8 pr-2 py-1.5 border border-slate-200 rounded-lg text-sm w-48 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      {itemSearchQuery && (
                        <button onClick={() => setItemSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    {sections.length > 1 && (
                      <select
                        value={itemFilterSection}
                        onChange={e => setItemFilterSection(e.target.value)}
                        className="px-2 py-1.5 border border-slate-200 rounded-lg text-sm"
                      >
                        <option value="">Wszystkie sekcje</option>
                        {sections.map(s => <option key={s.id} value={s.id}>{s.name || 'Bez nazwy'}</option>)}
                      </select>
                    )}
                    <button
                      onClick={() => {
                        const allExpanded = sections.every(s => s.isExpanded);
                        setSections(prev => {
                          const toggleAll = (secs: LocalOfferSection[]): LocalOfferSection[] =>
                            secs.map(s => ({ ...s, isExpanded: !allExpanded, children: s.children ? toggleAll(s.children) : [] }));
                          return toggleAll(prev);
                        });
                      }}
                      className="flex items-center gap-1 px-3 py-1.5 border border-slate-200 rounded-lg text-sm hover:bg-slate-50"
                      title={sections.every(s => s.isExpanded) ? 'Zwiń wszystkie sekcje' : 'Rozwiń wszystkie sekcje'}
                    >
                      {sections.every(s => s.isExpanded) ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      {sections.every(s => s.isExpanded) ? 'Zwiń' : 'Rozwiń'} wszystko
                    </button>
                  </>
                )}
                {editMode && (
                  <>
                    <button
                      onClick={() => setShowBulkBar(!showBulkBar)}
                      className={`flex items-center gap-1 px-3 py-1.5 border rounded-lg text-sm ${showBulkBar ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-slate-200 hover:bg-slate-50'}`}
                      title="Zaznacz pozycje do edycji masowej"
                    >
                      <ListChecks className="w-4 h-4" />
                      Zmiany masowe
                    </button>
                  </>
                )}
              </div>
            </div>

            {sections.length === 0 && !editMode ? (
              <div className="text-center py-12 text-slate-500">
                <Package className="w-16 h-16 mx-auto mb-4 text-slate-200" />
                <p className="text-lg font-medium text-slate-600 mb-1">Brak pozycji w ofercie</p>
                <p className="text-sm text-slate-400 mb-4">Przejdź do trybu edycji, aby dodać sekcje i pozycje.</p>
                {selectedOffer.status === 'draft' && (
                  <button
                    onClick={() => setEditMode(true)}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
                  >
                    <Pencil className="w-4 h-4" />
                    Rozpocznij edycję
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-0">
                {/* Initial add-section divider (before any sections) */}
                {editMode && sections.length === 0 && (
                  <div className="flex items-center gap-3 py-3">
                    <div className="flex-1 border-t border-dashed border-slate-300" />
                    <button
                      onClick={() => addSection()}
                      className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-50 text-blue-600 border border-blue-200 rounded-full text-sm hover:bg-blue-100 transition"
                    >
                      <Plus className="w-4 h-4" />
                      Dodaj sekcję
                    </button>
                    <div className="flex-1 border-t border-dashed border-slate-300" />
                  </div>
                )}

                {/* Progressive loading bar */}
                {sectionsReady < sections.length && sections.length > 0 && (
                  <div className="mb-3 px-2">
                    <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                      <span>Ładowanie sekcji: {sectionsReady}/{sections.length}</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                      <div className="bg-blue-500 h-1.5 rounded-full transition-all duration-200" style={{ width: `${(sectionsReady / sections.length) * 100}%` }} />
                    </div>
                  </div>
                )}
                {sections
                  .slice(0, sectionsReady)
                  .filter(section => !itemFilterSection || section.id === itemFilterSection)
                  .filter(section => {
                    if (!itemSearchQuery) return true;
                    const q = itemSearchQuery.toLowerCase();
                    if (section.name?.toLowerCase().includes(q)) return true;
                    return section.items?.some((item: any) => item.name?.toLowerCase().includes(q) || item.description?.toLowerCase().includes(q));
                  })
                  .map((section, sIdx) => (
                  <React.Fragment key={section.id}>
                    {renderSection(section, 0)}
                    {/* Divider after each section */}
                    {editMode && (
                      <div className="flex items-center gap-3 py-3">
                        <div className="flex-1 border-t border-dashed border-slate-300" />
                        <button
                          onClick={() => addSection(section.id)}
                          className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-50 text-blue-600 border border-blue-200 rounded-full text-sm hover:bg-blue-100 transition"
                        >
                          <Plus className="w-4 h-4" />
                          Dodaj sekcję
                        </button>
                        <div className="flex-1 border-t border-dashed border-slate-300" />
                      </div>
                    )}
                  </React.Fragment>
                ))}
              </div>
            )}
          </div>

          {/* Koszty powiązane */}
          <div className="p-6 border-b border-slate-200">
            <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <Briefcase className="w-5 h-5 text-slate-400" />
              Koszty powiązane
            </h2>
            <div className="space-y-2">
              {relatedCosts.map(cost => {
                const monthCount = cost.frequency === 'monthly' ? calculateMonthsBetween(cost.date_from || workStartDate, cost.date_to || workEndDate) : 1;
                const resolvedValue = cost.mode === 'percent' ? totals.nettoAfterDiscount * (cost.value / 100) : cost.value * monthCount;
                return (
                <div key={cost.id} className="space-y-1">
                  <div className="flex items-center gap-2">
                    {editMode ? (
                      <>
                        <label className="flex items-center gap-1 shrink-0" title="Pokaż na ofercie">
                          <input
                            type="checkbox"
                            checked={cost.show_on_offer}
                            onChange={e => setRelatedCosts(prev => prev.map(c => c.id === cost.id ? { ...c, show_on_offer: e.target.checked } : c))}
                            className="w-3.5 h-3.5 text-blue-600 rounded"
                          />
                          <span className="text-[10px] text-slate-500">Na ofercie</span>
                        </label>
                        <input
                          type="text"
                          value={cost.name}
                          onChange={e => setRelatedCosts(prev => prev.map(c => c.id === cost.id ? { ...c, name: e.target.value } : c))}
                          className="flex-1 px-2 py-1.5 border border-slate-200 rounded text-sm"
                        />
                        <select
                          value={cost.mode}
                          onChange={e => setRelatedCosts(prev => prev.map(c => c.id === cost.id ? { ...c, mode: e.target.value as 'fixed' | 'percent' } : c))}
                          className="w-20 px-1 py-1.5 border border-slate-200 rounded text-xs"
                        >
                          <option value="fixed">Kwota</option>
                          <option value="percent">%</option>
                        </select>
                        <input
                          type="number"
                          value={cost.value}
                          onChange={e => setRelatedCosts(prev => prev.map(c => c.id === cost.id ? { ...c, value: parseFloat(e.target.value) || 0 } : c))}
                          className="w-24 px-2 py-1.5 border border-slate-200 rounded text-right text-sm"
                          step="0.01"
                        />
                        <span className="text-xs text-slate-500 w-8">{cost.mode === 'percent' ? '%' : 'zł'}</span>
                        {cost.mode === 'fixed' && (
                          <select
                            value={cost.frequency}
                            onChange={e => setRelatedCosts(prev => prev.map(c => c.id === cost.id ? { ...c, frequency: e.target.value as 'one_time' | 'monthly' } : c))}
                            className="w-28 px-1 py-1.5 border border-slate-200 rounded text-xs"
                          >
                            <option value="one_time">Jednorazowo</option>
                            <option value="monthly">Miesięcznie</option>
                          </select>
                        )}
                        <button
                          onClick={() => setRelatedCosts(prev => prev.filter(c => c.id !== cost.id))}
                          className="p-1 hover:bg-red-50 rounded text-red-400"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 text-sm text-slate-700">
                          {cost.name}
                          {cost.mode === 'percent' && <span className="text-xs text-slate-400 ml-1">({cost.value}%)</span>}
                          {cost.mode === 'fixed' && cost.frequency === 'monthly' && <span className="text-xs text-slate-400 ml-1">({cost.value} zł × {monthCount} mies.)</span>}
                        </span>
                        <span className="text-sm font-medium text-slate-900">{formatCurrency(resolvedValue)}</span>
                      </>
                    )}
                  </div>
                  {/* Monthly date range inputs */}
                  {editMode && cost.mode === 'fixed' && cost.frequency === 'monthly' && (
                    <div className="flex items-center gap-2 ml-16 mt-1">
                      <span className="text-xs text-slate-500">od:</span>
                      <input
                        type="date"
                        value={cost.date_from || workStartDate}
                        onChange={e => setRelatedCosts(prev => prev.map(c => c.id === cost.id ? { ...c, date_from: e.target.value } : c))}
                        className="px-2 py-1 border border-slate-200 rounded text-xs"
                      />
                      <span className="text-xs text-slate-500">do:</span>
                      <input
                        type="date"
                        value={cost.date_to || workEndDate}
                        onChange={e => setRelatedCosts(prev => prev.map(c => c.id === cost.id ? { ...c, date_to: e.target.value } : c))}
                        className="px-2 py-1 border border-slate-200 rounded text-xs"
                      />
                      <span className="text-xs text-blue-600 font-medium">= {monthCount} mies.</span>
                    </div>
                  )}
                </div>
              );})}
              {editMode && (
                <button
                  onClick={() => setRelatedCosts(prev => [...prev, { id: `custom_${Date.now()}`, name: '', value: 0, mode: 'fixed', frequency: 'one_time', show_on_offer: false }])}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded border border-dashed border-blue-300"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Dodaj koszt
                </button>
              )}
              {relatedCosts.some(c => c.value > 0) && (
                <div className="flex justify-between pt-2 border-t border-slate-200">
                  <span className="text-sm font-medium text-slate-700">Suma kosztów powiązanych:</span>
                  <span className="text-sm font-bold text-slate-900">
                    {formatCurrency(totals.relatedCostsTotal)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Financial summary */}
          <div className="p-6 border-b border-slate-200">
            <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-blue-500" />
              Podsumowanie finansowe
            </h2>
            <div className="bg-gradient-to-r from-slate-50 to-blue-50/30 rounded-xl p-5 space-y-2 border border-slate-100">
              <div className="flex justify-between">
                <span className="text-slate-600">Suma pozycji netto:</span>
                <span className="font-medium">{formatCurrency(totals.total)}</span>
              </div>
              {totals.totalCost > 0 && (
                <div className="flex justify-between text-slate-500">
                  <span className="text-sm">Koszty:</span>
                  <span className="text-sm">{formatCurrency(totals.totalCost)}</span>
                </div>
              )}
              {totals.relatedCostsTotal > 0 && (
                <div className="flex justify-between text-sm text-slate-500">
                  <span>Koszty powiązane:</span>
                  <span>{formatCurrency(totals.relatedCostsTotal)}</span>
                </div>
              )}
              {/* Surcharges from warunki */}
              {(() => {
                const ptRule = paymentTermRules.find(r => String(r.value) === paymentTerm);
                const wrRule = warrantyRules.find(r => String(r.value) === warrantyPeriod);
                const ifRule = invoiceFreqRules.find(r => String(r.value) === invoiceFrequency);
                const surcharges: { label: string; pct: number; val: number }[] = [];
                if (ptRule && ptRule.surcharge !== 0 && paymentTermApply) surcharges.push({ label: `Termin płatności (${paymentTerm} dni)`, pct: ptRule.surcharge, val: totals.nettoAfterDiscount * (ptRule.surcharge / 100) });
                if (wrRule && wrRule.surcharge !== 0 && warrantyApply) surcharges.push({ label: `Gwarancja (${warrantyPeriod} mies.)`, pct: wrRule.surcharge, val: totals.nettoAfterDiscount * (wrRule.surcharge / 100) });
                if (ifRule && ifRule.surcharge !== 0 && invoiceFreqApply) surcharges.push({ label: `Fakturowanie (co ${invoiceFrequency} dni)`, pct: ifRule.surcharge, val: totals.nettoAfterDiscount * (ifRule.surcharge / 100) });
                return surcharges.length > 0 ? surcharges.map((s, i) => (
                  <div key={i} className={`flex justify-between text-sm ${s.pct > 0 ? 'text-red-500' : 'text-green-600'}`}>
                    <span>{s.label} ({s.pct > 0 ? '+' : ''}{s.pct}%):</span>
                    <span>{s.pct > 0 ? '+' : ''}{formatCurrency(s.val)}</span>
                  </div>
                )) : null;
              })()}
              <div className="flex justify-between font-semibold">
                <span className="text-slate-700">Łącznie netto:</span>
                <span className="text-blue-700">{formatCurrency(totals.total + totals.surchargeAmount)}</span>
              </div>
              {totals.totalDiscount > 0 && (
                <div className="flex justify-between text-red-600">
                  <span>Rabat ({totals.discountPercent.toFixed(1)}%):</span>
                  <span>-{formatCurrency(totals.totalDiscount)}</span>
                </div>
              )}
              {totals.totalDiscount > 0 && (
                <div className="flex justify-between font-semibold">
                  <span className="text-slate-700">Netto po rabacie:</span>
                  <span className="text-blue-700">{formatCurrency(totals.nettoAfterSurcharges)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-600">VAT:</span>
                <span className="font-medium">{formatCurrency(totals.totalVat)}</span>
              </div>
              <div className="flex justify-between pt-3 border-t border-slate-300">
                <span className="text-lg font-medium">Brutto:</span>
                <span className="text-lg font-medium text-slate-900">{formatCurrency(totals.totalBrutto)}</span>
              </div>
            </div>
            {totals.profit !== 0 && (
              <div className="mt-3 flex justify-between items-center px-2 py-2 rounded-lg bg-slate-50 border border-dashed border-slate-200">
                <span className="text-sm text-slate-500">Zysk netto:</span>
                <span className={`text-sm font-bold ${totals.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(totals.profit)}</span>
              </div>
            )}
          </div>

          {/* Negotiation panel (owner view) */}
          {selectedOffer.status === 'negotiation' && negotiationData && (
            <div className="p-6 border-b border-amber-200 bg-amber-50/50">
              <h2 className="text-lg font-semibold text-amber-800 mb-4 flex items-center gap-2">
                <MessageSquare className="w-5 h-5" />
                Propozycja negocjacyjna (runda {negotiationData.round})
              </h2>
              {negotiationData.message && (
                <div className="mb-4 p-3 bg-white rounded-lg border border-amber-200 text-sm text-slate-700">
                  <p className="text-xs text-slate-400 mb-1">Wiadomość od odbiorcy:</p>
                  <p>{negotiationData.message}</p>
                </div>
              )}
              {negotiationData.items && negotiationData.items.length > 0 && (
                <div className="space-y-2 mb-4">
                  <p className="text-sm font-semibold text-slate-700">Zmienione pozycje:</p>
                  <div className="space-y-1.5">
                    {negotiationData.items.map((ni: any) => {
                      const originalItem = getAllItems(sections).find(i => i.id === ni.offer_item_id);
                      if (!originalItem) return null;
                      const origTotal = (ni.original_quantity || 0) * (ni.original_unit_price || 0);
                      const propTotal = (ni.proposed_quantity || 0) * (ni.proposed_unit_price || 0);
                      return (
                        <div key={ni.id} className="flex items-center gap-3 p-2.5 bg-white rounded-lg border border-slate-200">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-900 truncate">{originalItem.name}</p>
                            <p className="text-xs text-slate-500">
                              Oryginał: {ni.original_quantity} × {formatCurrency(ni.original_unit_price)} = {formatCurrency(origTotal)}
                            </p>
                            <p className="text-xs text-amber-700 font-medium">
                              Propozycja: {ni.proposed_quantity} × {formatCurrency(ni.proposed_unit_price)} = {formatCurrency(propTotal)}
                              <span className={`ml-2 ${propTotal < origTotal ? 'text-red-500' : 'text-green-600'}`}>
                                ({propTotal >= origTotal ? '+' : ''}{formatCurrency(propTotal - origTotal)})
                              </span>
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {ni.status === 'pending' ? (
                              <>
                                <button
                                  onClick={async () => {
                                    await supabase.from('offer_negotiation_items').update({ status: 'accepted' }).eq('id', ni.id);
                                    loadOfferDetails(selectedOffer.id);
                                    showToast('Pozycja zaakceptowana', 'success');
                                  }}
                                  className="p-1.5 bg-green-100 text-green-700 rounded hover:bg-green-200 transition"
                                  title="Akceptuj"
                                >
                                  <CheckCircle className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={async () => {
                                    await supabase.from('offer_negotiation_items').update({ status: 'rejected' }).eq('id', ni.id);
                                    loadOfferDetails(selectedOffer.id);
                                    showToast('Pozycja odrzucona', 'info');
                                  }}
                                  className="p-1.5 bg-red-100 text-red-700 rounded hover:bg-red-200 transition"
                                  title="Odrzuć"
                                >
                                  <XCircle className="w-4 h-4" />
                                </button>
                              </>
                            ) : (
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                ni.status === 'accepted' ? 'bg-green-100 text-green-700' :
                                ni.status === 'rejected' ? 'bg-red-100 text-red-700' :
                                'bg-blue-100 text-blue-700'
                              }`}>
                                {ni.status === 'accepted' ? '✓ Zaakceptowano' : ni.status === 'rejected' ? '✗ Odrzucono' : '✎ Kontr-propozycja'}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {/* Send response button */}
              {negotiationData.items?.some((ni: any) => ni.status !== 'pending') && (
                <div className="flex items-center gap-3 mt-4">
                  <button
                    disabled={negotiationResponding}
                    onClick={async () => {
                      setNegotiationResponding(true);
                      try {
                        await supabase.from('offer_negotiations').update({ status: 'responded', updated_at: new Date().toISOString() }).eq('id', negotiationData.id);
                        // Check if all items are resolved and all accepted → status back to sent, otherwise stay in negotiation
                        const allResolved = negotiationData.items.every((ni: any) => ni.status !== 'pending');
                        const allAccepted = negotiationData.items.every((ni: any) => ni.status === 'accepted');
                        if (allResolved) {
                          // Apply accepted changes to offer items
                          for (const ni of negotiationData.items.filter((n: any) => n.status === 'accepted')) {
                            await supabase.from('offer_items').update({
                              quantity: ni.proposed_quantity,
                              unit_price: ni.proposed_unit_price
                            }).eq('id', ni.offer_item_id);
                          }
                          await supabase.from('offers').update({ status: allAccepted ? 'sent' : 'sent' }).eq('id', selectedOffer.id);
                        }
                        showToast('Odpowiedź wysłana', 'success');
                        loadData();
                        loadOfferDetails(selectedOffer.id);
                      } catch (err) {
                        showToast('Błąd wysyłania odpowiedzi', 'error');
                      } finally {
                        setNegotiationResponding(false);
                      }
                    }}
                    className="px-4 py-2 bg-amber-600 text-white rounded-lg font-medium hover:bg-amber-700 transition disabled:opacity-50"
                  >
                    {negotiationResponding ? <Loader2 className="w-4 h-4 inline-block mr-1 animate-spin" /> : <Send className="w-4 h-4 inline-block mr-1" />}
                    Wyślij odpowiedź
                  </button>
                  <span className="text-xs text-slate-500">
                    {negotiationData.items.filter((ni: any) => ni.status === 'pending').length} pozycji oczekuje na decyzję
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Public link */}
          {selectedOffer.public_url && (
            <div className="p-6 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Link publiczny</h2>
              <div className="flex items-center gap-2 p-4 bg-blue-50 rounded-lg">
                <LinkIcon className="w-5 h-5 text-blue-600" />
                <input
                  type="text"
                  readOnly
                  value={window.location.origin + selectedOffer.public_url}
                  className="flex-1 px-3 py-2 bg-white border border-blue-200 rounded-lg text-sm"
                />
                <button
                  onClick={() => copyPublicLink(selectedOffer)}
                  className="flex items-center gap-1 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  <Copy className="w-4 h-4" />
                  Kopiuj
                </button>
                <a
                  href={selectedOffer.public_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 px-3 py-2 border border-blue-200 text-blue-600 rounded-lg hover:bg-blue-50"
                >
                  <ExternalLink className="w-4 h-4" />
                  Otwórz
                </a>
              </div>
              {/* Offer flags: SMS & Negotiation */}
              {editMode && (
                <div className="mt-4 flex items-center gap-6">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={negotiationEnabled} onChange={e => setNegotiationEnabled(e.target.checked)} className="w-4 h-4 text-amber-600 rounded" />
                    <span className="text-sm text-slate-700 font-medium">Do negocjacji</span>
                    <span className="text-xs text-slate-400">— odbiorca może złożyć kontrpropozycję</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={smsAcceptance} onChange={e => setSmsAcceptance(e.target.checked)} className="w-4 h-4 text-green-600 rounded" />
                    <span className="text-sm text-slate-700 font-medium">Akceptacja SMS</span>
                    <span className="text-xs text-slate-400">— wymaga kodu SMS do zaakceptowania</span>
                  </label>
                </div>
              )}
              {!editMode && (negotiationEnabled || smsAcceptance) && (
                <div className="mt-4 flex items-center gap-4">
                  {negotiationEnabled && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 text-amber-700 text-xs font-medium rounded-full border border-amber-200">
                      <MessageSquare className="w-3.5 h-3.5" />
                      Do negocjacji
                    </span>
                  )}
                  {smsAcceptance && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-green-50 text-green-700 text-xs font-medium rounded-full border border-green-200">
                      <Phone className="w-3.5 h-3.5" />
                      Akceptacja SMS
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="font-medium text-slate-900 mb-2">Uwagi dla klienta</h3>
                {editMode ? (
                  <textarea
                    value={offerData.notes}
                    onChange={e => setOfferData({ ...offerData, notes: e.target.value })}
                    rows={4}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  />
                ) : (
                  <p className="text-slate-600 whitespace-pre-wrap">{selectedOffer.notes || '-'}</p>
                )}
              </div>
              <div>
                <h3 className="font-medium text-slate-900 mb-2">Notatki wewnętrzne</h3>
                {editMode ? (
                  <textarea
                    value={offerData.internal_notes}
                    onChange={e => setOfferData({ ...offerData, internal_notes: e.target.value })}
                    rows={4}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  />
                ) : (
                  <p className="text-slate-600 whitespace-pre-wrap">{selectedOffer.internal_notes || '-'}</p>
                )}
              </div>
            </div>
          </div>

          {/* Bottom action buttons */}
          <div className="p-4 bg-slate-50 border-t border-slate-200">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleDeleteOffer(selectedOffer)}
                  className="flex items-center gap-1 px-3 py-1.5 text-red-600 hover:bg-red-50 rounded-lg text-sm"
                  title="Usuń ofertę"
                >
                  <Trash2 className="w-4 h-4" />
                  Usuń
                </button>
                <button
                  onClick={() => handleDuplicateOffer(selectedOffer)}
                  className="flex items-center gap-1 px-3 py-1.5 text-slate-600 hover:bg-slate-100 rounded-lg text-sm"
                  title="Utwórz kopię oferty"
                >
                  <Copy className="w-4 h-4" />
                  Duplikuj
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    if (editMode) {
                      await handleUpdateOffer();
                    }
                    setShowPreviewModal(true);
                  }}
                  disabled={savingOffer}
                  className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm disabled:opacity-50"
                >
                  {savingOffer ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                  Podgląd i wysyłka
                </button>
                <button
                  onClick={() => setShowSendModal(true)}
                  className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
                >
                  <Send className="w-4 h-4" />
                  Wyślij ofertę do klienta
                </button>
                <button
                  onClick={() => { setSelectedOffer(null); setEditMode(false); }}
                  className="flex items-center gap-1 px-3 py-2 border border-slate-200 rounded-lg hover:bg-slate-50 text-sm"
                >
                  Zamknij
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Comments toggle button */}
        <button
          onClick={() => setShowCommentsPanel(!showCommentsPanel)}
          className="fixed right-4 top-20 z-50 flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-lg shadow-lg hover:bg-slate-50 transition"
        >
          <MessageSquare className="w-4 h-4 text-blue-600" />
          <span className="text-sm font-medium text-slate-700">Komentarze</span>
          {getUnreadCount() > 0 && (
            <span className="ml-1 px-1.5 py-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full">{getUnreadCount()}</span>
          )}
        </button>

        {/* Comments sliding panel */}
        {showCommentsPanel && (
          <div className="fixed right-0 top-0 bottom-0 w-[350px] bg-white border-l border-slate-200 shadow-2xl z-50 flex flex-col">
            {/* Panel header */}
            <div className="p-4 border-b border-slate-200 flex items-center justify-between shrink-0">
              <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-blue-600" />
                Komentarze
                {comments.length > 0 && <span className="text-xs text-slate-400">({comments.length})</span>}
              </h3>
              <button onClick={() => setShowCommentsPanel(false)} className="p-1 hover:bg-slate-100 rounded">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            {/* Filter tabs */}
            <div className="px-4 py-2 border-b border-slate-100 flex gap-1 shrink-0">
              {(['all', 'unread', 'unanswered'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setCommentsFilter(f)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition ${commentsFilter === f ? 'bg-blue-100 text-blue-700' : 'text-slate-500 hover:bg-slate-100'}`}
                >
                  {f === 'all' ? 'Wszystkie' : f === 'unread' ? 'Nieprzeczytane' : 'Bez odpowiedzi'}
                </button>
              ))}
            </div>
            {/* Item filter */}
            {commentItemId && (
              <div className="px-4 py-2 border-b border-slate-100 bg-blue-50 flex items-center justify-between shrink-0">
                <span className="text-xs text-blue-700">Filtr: pozycja</span>
                <button onClick={() => setCommentItemId(null)} className="text-xs text-blue-600 hover:underline">Pokaż wszystkie</button>
              </div>
            )}
            {/* Comments list */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {filteredComments.filter(c => !c.parent_id).length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">Brak komentarzy</p>
              ) : (
                filteredComments.filter(c => !c.parent_id).map(comment => {
                  const replies = comments.filter(c => c.parent_id === comment.id);
                  const isCollapsed = collapsedThreads.has(comment.id);
                  return (
                    <div key={comment.id} className={`rounded-lg border ${comment.author_type === 'recipient' && !comment.is_read ? 'border-blue-200 bg-blue-50/30' : 'border-slate-200'}`}>
                      <div className="p-3">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-1.5">
                            {comment.author_type === 'recipient' && !comment.is_read && (
                              <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                            )}
                            <span className={`text-xs font-medium ${comment.author_type === 'owner' ? 'text-blue-700' : 'text-amber-700'}`}>
                              {comment.author_type === 'owner' ? (state.currentCompany?.name || comment.author_name || 'Ty') : (comment.author_name || 'Odbiorca')}
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-400">
                            {new Date(comment.created_at).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <p className="text-sm text-slate-700">{comment.content}</p>
                        <div className="flex items-center gap-2 mt-2">
                          <button
                            onClick={() => { setReplyingTo(replyingTo === comment.id ? null : comment.id); setReplyText(''); }}
                            className="text-[11px] text-blue-600 hover:underline"
                          >
                            Odpowiedz
                          </button>
                          {replies.length > 0 && (
                            <button
                              onClick={() => setCollapsedThreads(prev => {
                                const next = new Set(prev);
                                if (next.has(comment.id)) next.delete(comment.id);
                                else next.add(comment.id);
                                return next;
                              })}
                              className="text-[11px] text-slate-500 hover:underline"
                            >
                              {isCollapsed ? `▸ ${replies.length} odp.` : `▾ ${replies.length} odp.`}
                            </button>
                          )}
                          {comment.author_type === 'recipient' && !comment.is_read && (
                            <button
                              onClick={async () => {
                                await supabase.from('offer_comments').update({ is_read: true }).eq('id', comment.id);
                                setComments(prev => prev.map(c => c.id === comment.id ? { ...c, is_read: true } : c));
                              }}
                              className="text-[11px] text-slate-400 hover:underline"
                            >
                              Oznacz jako przeczytane
                            </button>
                          )}
                        </div>
                      </div>
                      {/* Replies */}
                      {!isCollapsed && replies.map(reply => (
                        <div key={reply.id} className="ml-4 p-2.5 border-t border-slate-100">
                          <div className="flex items-center justify-between mb-1">
                            <span className={`text-xs font-medium ${reply.author_type === 'owner' ? 'text-blue-700' : 'text-amber-700'}`}>
                              {reply.author_type === 'owner' ? (state.currentCompany?.name || reply.author_name || 'Ty') : (reply.author_name || 'Odbiorca')}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              {new Date(reply.created_at).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600">{reply.content}</p>
                        </div>
                      ))}
                      {/* Reply form */}
                      {replyingTo === comment.id && (
                        <div className="p-2 border-t border-slate-100">
                          <textarea
                            value={replyText}
                            onChange={e => setReplyText(e.target.value)}
                            placeholder="Napisz odpowiedź..."
                            className="w-full px-2 py-1.5 border border-slate-200 rounded text-xs resize-none"
                            rows={2}
                          />
                          <div className="flex justify-end gap-1 mt-1">
                            <button onClick={() => setReplyingTo(null)} className="px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 rounded">Anuluj</button>
                            <button
                              onClick={() => selectedOffer && handleAddComment(selectedOffer.id, comment.offer_item_id, comment.id, replyText)}
                              className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                              disabled={!replyText.trim()}
                            >
                              Wyślij
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
            {/* New comment form */}
            <div className="p-4 border-t border-slate-200 shrink-0">
              <textarea
                value={newCommentText}
                onChange={e => setNewCommentText(e.target.value)}
                placeholder="Napisz komentarz..."
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm resize-none"
                rows={2}
              />
              <button
                onClick={() => selectedOffer && handleAddComment(selectedOffer.id, commentItemId, null, newCommentText)}
                className="mt-2 w-full px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
                disabled={!newCommentText.trim()}
              >
                Dodaj komentarz
              </button>
            </div>
          </div>
        )}

        {/* Sticky bottom summary bar */}
        <div className="fixed bottom-0 left-0 lg:left-64 right-0 bg-white border-t-2 border-blue-200 shadow-[0_-4px_12px_rgba(0,0,0,0.08)] z-40">
          <div className="px-4 lg:px-6 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3 lg:gap-5 text-xs lg:text-sm overflow-x-auto">
                <div className="whitespace-nowrap">
                  <span className="text-slate-400 hidden lg:inline">Netto:</span>
                  <span className="text-slate-400 lg:hidden">N:</span>
                  <span className="ml-1 font-bold text-blue-600">{formatCurrency(totals.total)}</span>
                </div>
                <div className="h-4 w-px bg-slate-200 shrink-0" />
                {totals.totalDiscount > 0 && (
                  <>
                    <div className="whitespace-nowrap">
                      <span className="text-slate-400 hidden lg:inline">Rabat:</span>
                      <span className="text-slate-400 lg:hidden">R:</span>
                      <span className="ml-1 font-medium text-red-500">-{formatCurrency(totals.totalDiscount)}</span>
                    </div>
                    <div className="h-4 w-px bg-slate-200 shrink-0" />
                  </>
                )}
                {totals.surchargePercent !== 0 && (
                  <>
                    <div className="whitespace-nowrap">
                      <span className="text-slate-400 hidden lg:inline">Warunki/Rabat:</span>
                      <span className="text-slate-400 lg:hidden">W/R:</span>
                      <span className={`ml-1 font-medium ${totals.surchargePercent > 0 ? 'text-red-500' : 'text-green-600'}`}>
                        {totals.surchargePercent > 0 ? '+' : ''}{totals.surchargePercent.toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-4 w-px bg-slate-200 shrink-0" />
                  </>
                )}
                <div className="whitespace-nowrap">
                  <span className="text-slate-400 hidden lg:inline">Netto po rab.:</span>
                  <span className="text-slate-400 lg:hidden">NR:</span>
                  <span className="ml-1 font-bold text-blue-700">{formatCurrency(totals.nettoAfterSurcharges)}</span>
                </div>
                <div className="h-4 w-px bg-slate-200 shrink-0" />
                {totals.relatedCostsTotal > 0 && (
                  <>
                    <div className="whitespace-nowrap">
                      <span className="text-slate-400 hidden lg:inline">Koszty pow.:</span>
                      <span className="text-slate-400 lg:hidden">KP:</span>
                      <span className="ml-1 font-medium text-slate-600">{formatCurrency(totals.relatedCostsTotal)}</span>
                    </div>
                    <div className="h-4 w-px bg-slate-200 shrink-0" />
                  </>
                )}
                <div className="whitespace-nowrap">
                  <span className="text-slate-400 hidden lg:inline">Łącznie netto:</span>
                  <span className="text-slate-400 lg:hidden">ŁN:</span>
                  <span className="ml-1 font-bold text-blue-700">
                    {formatCurrency(totals.nettoAfterSurcharges - totals.relatedCostsTotal)}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {selectedOffer?.status === 'draft' && (
                  editMode ? (
                    <button
                      onClick={handleUpdateOffer}
                      disabled={savingOffer}
                      className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-xs font-medium"
                    >
                      {savingOffer ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                      Zapisz
                    </button>
                  ) : (
                    <button
                      onClick={() => setEditMode(true)}
                      className="flex items-center gap-1 px-3 py-1.5 border border-slate-300 rounded-lg hover:bg-slate-50 text-xs font-medium text-slate-700"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Edytuj
                    </button>
                  )
                )}
                <div className={`flex items-center gap-1.5 ${totals.profit >= 0 ? 'bg-green-600' : 'bg-red-600'} text-white px-3 py-1.5 rounded-lg`}>
                  <span className="text-sm font-bold">{formatCurrency(totals.profit)}</span>
                  <span className="text-[10px] opacity-75">zysk netto</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ============================================
  // RENDER: LIST VIEW
  // ============================================
  const RequestStatusBadge = ({ status }: { status: string }) => {
    const cfg: Record<string, { bg: string; text: string; label: string }> = {
      draft: { bg: 'bg-slate-100', text: 'text-slate-700', label: 'Szkic' },
      sent: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Wysłane' },
      viewed: { bg: 'bg-cyan-100', text: 'text-cyan-700', label: 'Wyświetlone' },
      responded: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Odpowiedziane' },
      accepted: { bg: 'bg-green-100', text: 'text-green-700', label: 'Zaakceptowane' },
      rejected: { bg: 'bg-red-100', text: 'text-red-700', label: 'Odrzucone' },
    };
    const c = cfg[status] || cfg.draft;
    return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${c.bg} ${c.text}`}>{c.label}</span>;
  };

  const RequestTypeBadge = ({ type }: { type: string }) => {
    const cfg: Record<string, { bg: string; text: string; label: string }> = {
      robota: { bg: 'bg-blue-50', text: 'text-blue-700', label: 'Robota' },
      materialy: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Materiały' },
      sprzet: { bg: 'bg-green-50', text: 'text-green-700', label: 'Sprzęt' },
      all: { bg: 'bg-indigo-50', text: 'text-indigo-700', label: 'Cały zakres' },
    };
    const c = cfg[type] || cfg.all;
    return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${c.bg} ${c.text}`}>{c.label}</span>;
  };

  const renderListView = () => (
    <div className="p-6">
      {/* Tabs */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex border-b border-slate-200">
          <button
            onClick={() => { setOffersTab('offers'); setSelectedRequest(null); }}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition ${offersTab === 'offers' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            Oferty dla klientów
            {offers.length > 0 && <span className="ml-1.5 text-xs text-slate-400">({offers.length})</span>}
          </button>
          <button
            onClick={() => { setOffersTab('requests'); setSelectedRequest(null); }}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition ${offersTab === 'requests' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            Zapytania dla podwykonawców
            {offerRequests.length > 0 && <span className="ml-1.5 text-xs text-slate-400">({offerRequests.length})</span>}
          </button>
        </div>
        {offersTab === 'offers' ? (
          <button
            onClick={() => { resetOfferForm(); setShowCreateModal(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
          >
            <Plus className="w-5 h-5" />
            Nowa oferta
          </button>
        ) : (
          <button
            onClick={() => {
              setRequestType('all');
              setRequestStep('type');
              setRequestOfferId('');
              setRequestName('');
              setRequestSubcontractorId('');
              setRequestSections([]);
              setSelectedSubcontractor(null);
              setSelectedSupplier(null);
              setSubcontractorSearch('');
              setSupplierSearch('');
              setShowCreateRequestModal(true);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
          >
            <Plus className="w-5 h-5" />
            Nowe zapytanie
          </button>
        )}
      </div>

      {offersTab === 'offers' ? (
        <>
          {/* Filters & List */}
          <div className="bg-white rounded-xl border border-slate-200">
            <div className="p-4 border-b border-slate-200 flex gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Szukaj oferty..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value as OfferStatus | 'all')}
                className="px-4 py-2 border border-slate-200 rounded-lg"
              >
                <option value="all">Wszystkie statusy</option>
                <option value="draft">Wersja robocza</option>
                <option value="sent">Wysłane</option>
                <option value="accepted">Zaakceptowane</option>
                <option value="rejected">Odrzucone</option>
              </select>
            </div>

            {loading ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
              </div>
            ) : filteredOffers.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="w-16 h-16 text-slate-200 mx-auto mb-4" />
                <p className="text-lg font-medium text-slate-600 mb-1">Brak ofert</p>
                <p className="text-sm text-slate-400 mb-4">Utwórz swoją pierwszą ofertę, aby rozpocząć ofertowanie.</p>
                <button
                  onClick={() => { resetOfferForm(); setShowCreateModal(true); }}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white hover:bg-blue-700 rounded-lg transition text-sm font-medium"
                >
                  <Plus className="w-4 h-4" />
                  Utwórz ofertę
                </button>
              </div>
            ) : (
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Nr</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Nazwa</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Klient</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Status</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Wartość netto</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Ważna do</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-slate-500 uppercase">Akcje</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredOffers.map(offer => (
                    <tr
                      key={offer.id}
                      className="hover:bg-slate-50 cursor-pointer"
                      onClick={() => { setSelectedOffer(offer); setItemSearchQuery(''); setItemFilterSection(''); loadOfferDetails(offer.id); }}
                    >
                      <td className="px-4 py-3 text-sm font-medium text-slate-900">{offer.number || '-'}</td>
                      <td className="px-4 py-3 text-sm text-slate-700">{offer.name}</td>
                      <td className="px-4 py-3 text-sm text-slate-600">{(offer as any).client?.name || '-'}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={offer.status} />
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-slate-900 text-right">
                        {formatCurrency(offer.final_amount)}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-500">
                        {offer.valid_until ? formatDate(offer.valid_until) : '-'}
                      </td>
                      <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => handleOpenEditOffer(offer)}
                            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                            title="Edytuj"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDuplicateOffer(offer)}
                            className="p-1.5 text-slate-400 hover:text-green-600 hover:bg-green-50 rounded"
                            title="Duplikuj ofertę"
                          >
                            <Copy className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteOffer(offer)}
                            className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded"
                            title="Usuń"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : (
        /* Requests tab */
        <div className="bg-white rounded-xl border border-slate-200">
          {offerRequests.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="w-16 h-16 text-slate-200 mx-auto mb-4" />
              <p className="text-lg font-medium text-slate-600 mb-1">Brak zapytań ofertowych</p>
              <p className="text-sm text-slate-400 mb-4">Kliknij „Nowe zapytanie" powyżej, aby utworzyć zapytanie ofertowe.</p>
            </div>
          ) : (
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Nazwa</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Typ zapytania</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Podwykonawca</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Oferta źródłowa</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Data</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-slate-500 uppercase">Akcje</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {offerRequests.map(req => (
                  <tr
                    key={req.id}
                    className="hover:bg-slate-50 cursor-pointer"
                    onClick={() => setSelectedRequest(req)}
                  >
                    <td className="px-4 py-3 text-sm font-medium text-slate-900">{req.name || '-'}</td>
                    <td className="px-4 py-3"><RequestTypeBadge type={req.request_type} /></td>
                    <td className="px-4 py-3 text-sm text-slate-600">{req.subcontractor?.name || '-'}</td>
                    <td className="px-4 py-3 text-sm text-slate-500">{req.offer?.name || req.offer?.number || '-'}</td>
                    <td className="px-4 py-3"><RequestStatusBadge status={req.status} /></td>
                    <td className="px-4 py-3 text-sm text-slate-500">
                      {new Date(req.created_at).toLocaleDateString('pl-PL')}
                    </td>
                    <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => {
                            const url = `${window.location.origin}/#/offer-request/${req.share_token}`;
                            navigator.clipboard.writeText(url);
                            showToast('Link skopiowany', 'success');
                          }}
                          className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                          title="Kopiuj link"
                        >
                          <LinkIcon className="w-4 h-4" />
                        </button>
                        <button
                          onClick={async () => {
                            if (!confirm('Usunąć zapytanie?')) return;
                            try {
                              const { error: delErr } = await supabase.from('offer_requests').delete().eq('id', req.id);
                              if (delErr) throw delErr;
                              setOfferRequests(prev => prev.filter(r => r.id !== req.id));
                              showToast('Zapytanie usunięte', 'info');
                            } catch (err) {
                              console.error('Error deleting request:', err);
                              showToast('Błąd usuwania zapytania', 'error');
                            }
                          }}
                          className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded"
                          title="Usuń"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );

  // Request detail modal
  const renderRequestDetail = () => {
    if (!selectedRequest) return null;
    const items = selectedRequest.print_settings?.items || [];
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
        <div className="bg-white rounded-xl w-full max-w-3xl max-h-[85vh] flex flex-col">
          <div className="p-4 border-b border-slate-200 flex justify-between items-center">
            <div>
              <h2 className="text-lg font-semibold">{selectedRequest.name}</h2>
              <div className="flex items-center gap-2 mt-1">
                <RequestTypeBadge type={selectedRequest.request_type} />
                <RequestStatusBadge status={selectedRequest.status} />
              </div>
            </div>
            <button onClick={() => setSelectedRequest(null)} className="p-1 hover:bg-slate-100 rounded">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="p-6 overflow-y-auto flex-1 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-500 mb-1">Oferta źródłowa</p>
                <p className="text-sm font-medium">{selectedRequest.offer?.name || selectedRequest.offer?.number || '-'}</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-500 mb-1">Podwykonawca</p>
                <p className="text-sm font-medium">{selectedRequest.subcontractor?.name || 'Nie przypisano'}</p>
              </div>
            </div>

            {selectedRequest.response_data?.notes && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="text-sm font-medium text-green-800 mb-1">Uwagi podwykonawcy</p>
                <p className="text-sm text-green-700 whitespace-pre-wrap">{selectedRequest.response_data.notes}</p>
              </div>
            )}

            {(() => {
              const responsePrices = selectedRequest.response_data?.prices || {};
              const hasResponse = Object.keys(responsePrices).length > 0;
              return (
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="text-left p-2 text-slate-600">Lp.</th>
                        <th className="text-left p-2 text-slate-600">Sekcja</th>
                        <th className="text-left p-2 text-slate-600">Nazwa</th>
                        <th className="text-left p-2 text-slate-600">Jedn.</th>
                        <th className="text-right p-2 text-slate-600">Ilość</th>
                        {hasResponse && <th className="text-right p-2 text-green-700">Cena jedn.</th>}
                        {hasResponse && <th className="text-right p-2 text-green-700">Wartość</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item: any, i: number) => {
                        const unitPrice = parseFloat(responsePrices[item.id] || '0') || 0;
                        const totalPrice = unitPrice * (item.quantity || 0);
                        return (
                          <tr key={item.id || i} className="border-t border-slate-100">
                            <td className="p-2 text-slate-500">{i + 1}</td>
                            <td className="p-2 text-slate-500">{item.section_name || '-'}</td>
                            <td className="p-2 font-medium text-slate-900">{item.name}</td>
                            <td className="p-2 text-slate-500">{item.unit || 'szt.'}</td>
                            <td className="p-2 text-right text-slate-700">{item.quantity}</td>
                            {hasResponse && <td className="p-2 text-right text-green-700">{unitPrice > 0 ? unitPrice.toFixed(2) : '-'}</td>}
                            {hasResponse && <td className="p-2 text-right font-medium text-green-800">{totalPrice > 0 ? totalPrice.toFixed(2) : '-'}</td>}
                          </tr>
                        );
                      })}
                    </tbody>
                    {hasResponse && (
                      <tfoot className="bg-green-50">
                        <tr className="border-t-2 border-green-200">
                          <td colSpan={6} className="p-2 text-right font-semibold text-green-800">Razem netto:</td>
                          <td className="p-2 text-right font-bold text-green-900">
                            {items.reduce((sum: number, item: any) => {
                              const p = parseFloat(responsePrices[item.id] || '0') || 0;
                              return sum + p * (item.quantity || 0);
                            }, 0).toFixed(2)} zł
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              );
            })()}
          </div>
          <div className="p-4 border-t border-slate-200 flex justify-between">
            <button
              onClick={() => {
                const url = `${window.location.origin}/#/offer-request/${selectedRequest.share_token}`;
                navigator.clipboard.writeText(url);
                showToast('Link skopiowany do schowka', 'success');
              }}
              className="flex items-center gap-1.5 px-4 py-2 border border-slate-200 rounded-lg text-sm hover:bg-slate-50"
            >
              <LinkIcon className="w-4 h-4" />
              Kopiuj link
            </button>
            <div className="flex items-center gap-2">
              {selectedRequest.status === 'draft' && (
                <button
                  onClick={async () => {
                    try {
                      const { error } = await supabase.from('offer_requests').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', selectedRequest.id);
                      if (error) throw error;
                      setOfferRequests(prev => prev.map(r => r.id === selectedRequest.id ? { ...r, status: 'sent', sent_at: new Date().toISOString() } : r));
                      setSelectedRequest((prev: any) => prev ? { ...prev, status: 'sent' } : null);
                      const url = `${window.location.origin}/#/offer-request/${selectedRequest.share_token}`;
                      await navigator.clipboard.writeText(url);
                      showToast('Zapytanie oznaczone jako wysłane — link skopiowany', 'success');
                    } catch (err) {
                      console.error('Error sending request:', err);
                      showToast('Błąd wysyłania zapytania', 'error');
                    }
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm"
                >
                  <Send className="w-4 h-4" />
                  Wyślij
                </button>
              )}
              {selectedRequest.status === 'responded' && (
                <>
                  <button
                    onClick={async () => {
                      try {
                        const { error } = await supabase.from('offer_requests').update({ status: 'rejected' }).eq('id', selectedRequest.id);
                        if (error) throw error;
                        setOfferRequests(prev => prev.map(r => r.id === selectedRequest.id ? { ...r, status: 'rejected' } : r));
                        setSelectedRequest((prev: any) => prev ? { ...prev, status: 'rejected' } : null);
                        showToast('Oferta podwykonawcy odrzucona', 'info');
                      } catch (err) {
                        console.error('Error rejecting request:', err);
                        showToast('Błąd odrzucania', 'error');
                      }
                    }}
                    className="flex items-center gap-1.5 px-4 py-2 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 text-sm"
                  >
                    <XCircle className="w-4 h-4" />
                    Odrzuć
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        const { error } = await supabase.from('offer_requests').update({ status: 'accepted' }).eq('id', selectedRequest.id);
                        if (error) throw error;
                        setOfferRequests(prev => prev.map(r => r.id === selectedRequest.id ? { ...r, status: 'accepted' } : r));
                        setSelectedRequest((prev: any) => prev ? { ...prev, status: 'accepted' } : null);
                        showToast('Oferta podwykonawcy zaakceptowana', 'success');
                      } catch (err) {
                        console.error('Error accepting request:', err);
                        showToast('Błąd akceptacji', 'error');
                      }
                    }}
                    className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
                  >
                    <CheckCircle className="w-4 h-4" />
                    Zaakceptuj
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ============================================
  // MAIN RENDER
  // ============================================
  return (
    <>
      {selectedOffer ? renderOfferDetail() : renderListView()}
      {selectedRequest && renderRequestDetail()}
      {showCreateModal && renderCreateModal()}
      {showImportFromEstimate && renderImportFromEstimateModal()}

      {/* Edit offer modal */}
      {showEditModal && editingOffer && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b border-slate-200 flex justify-between items-center">
              <h2 className="text-xl font-bold text-slate-900">Edytuj ofertę</h2>
              <button onClick={() => { setShowEditModal(false); setEditingOffer(null); }} className="p-2 hover:bg-slate-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1 space-y-6">
              {/* 1. Client (kosztorys-style) — FIRST, like in kosztorys */}
              {renderClientFormSection()}

              {/* 2. Offer details */}
              <div className="space-y-4">
                <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-slate-400" />
                  Dane oferty
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-slate-700 mb-1">Nazwa oferty *</label>
                    <input
                      type="text"
                      value={editForm.name}
                      onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Projekt</label>
                    <select
                      value={editForm.project_id}
                      onChange={e => setEditForm({ ...editForm, project_id: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">-- Wybierz projekt --</option>
                      {projects.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Ważna do</label>
                    <input
                      type="date"
                      value={editForm.valid_until}
                      onChange={e => setEditForm({ ...editForm, valid_until: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="p-6 border-t border-slate-200 flex justify-end gap-3">
              <button
                onClick={() => { setShowEditModal(false); setEditingOffer(null); }}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Anuluj
              </button>
              <button
                onClick={handleSaveEditOffer}
                disabled={savingOffer || !editForm.name.trim()}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                {savingOffer && <Loader2 className="w-4 h-4 animate-spin" />}
                Zapisz zmiany
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Rabat Modal */}
      {/* Settings Modal */}
      {showSettingsModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70] p-4">
          <div className="bg-white rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            <div className="p-4 border-b border-slate-200 flex justify-between items-center">
              <h2 className="text-lg font-semibold">Ustawienia oferty</h2>
              <button onClick={() => setShowSettingsModal(false)} className="p-1 hover:bg-slate-100 rounded" title="Zamknij">
                <X className="w-5 h-5" />
              </button>
            </div>
            {/* Tabs */}
            <div className="flex border-b border-slate-200">
              <button
                onClick={() => setSettingsTab('dodatki')}
                className={`flex-1 py-3 text-sm font-medium text-center ${settingsTab === 'dodatki' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Dodatki
              </button>
              <button
                onClick={() => setSettingsTab('widok')}
                className={`flex-1 py-3 text-sm font-medium text-center ${settingsTab === 'widok' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Widok
              </button>
            </div>
            <div className="p-4 space-y-5 overflow-y-auto flex-1">
              {settingsTab === 'dodatki' && (
                <div className="space-y-6">
                  <p className="text-sm text-slate-600">Ustaw narzut (+) lub rabat (-) w zależności od wybranych warunków. Wartość w % od netto.</p>

                  {/* Payment term rules */}
                  <div>
                    <h4 className="text-sm font-semibold text-slate-700 mb-2">Termin płatności (dni)</h4>
                    <div className="space-y-1.5">
                      {paymentTermRules.map((rule, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <select
                            value={rule.value}
                            onChange={e => setPaymentTermRules(prev => prev.map((r, i) => i === idx ? { ...r, value: Number(e.target.value) } : r))}
                            className="w-24 px-2 py-1.5 border border-slate-200 rounded text-sm"
                          >
                            {paymentTermOptions.map(v => <option key={v} value={v}>{v} dni</option>)}
                          </select>
                          <span className="text-xs text-slate-400">=</span>
                          <input
                            type="number"
                            value={rule.surcharge}
                            onChange={e => setPaymentTermRules(prev => prev.map((r, i) => i === idx ? { ...r, surcharge: parseFloat(e.target.value) || 0 } : r))}
                            className="w-20 px-2 py-1.5 border border-slate-200 rounded text-sm text-right"
                            step="0.5"
                          />
                          <span className="text-xs text-slate-500">%</span>
                          <span className={`text-xs ${rule.surcharge > 0 ? 'text-red-500' : rule.surcharge < 0 ? 'text-green-500' : 'text-slate-400'}`}>
                            {rule.surcharge > 0 ? 'narzut' : rule.surcharge < 0 ? 'rabat' : '-'}
                          </span>
                          <button onClick={() => setPaymentTermRules(prev => prev.filter((_, i) => i !== idx))} className="p-0.5 hover:bg-red-50 rounded text-red-400 ml-auto" title="Usuń regułę">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => setPaymentTermRules(prev => [...prev, { value: paymentTermOptions[0] || 30, surcharge: 0 }])}
                        className="text-xs text-blue-600 hover:underline"
                      >+ Dodaj regułę</button>
                    </div>
                    <div className="mt-2 flex items-center gap-1">
                      <input
                        type="number"
                        id="newPaymentTerm"
                        placeholder="Nowa wartość"
                        className="w-28 px-2 py-1 border border-slate-200 rounded text-xs"
                      />
                      <button
                        onClick={() => {
                          const inp = document.getElementById('newPaymentTerm') as HTMLInputElement;
                          const v = parseInt(inp?.value);
                          if (v > 0 && !paymentTermOptions.includes(v)) {
                            setPaymentTermOptions(prev => [...prev, v].sort((a, b) => a - b));
                            inp.value = '';
                          }
                        }}
                        className="text-xs text-blue-600 hover:underline"
                      >+ Dodaj opcję</button>
                    </div>
                  </div>

                  {/* Warranty rules */}
                  <div>
                    <h4 className="text-sm font-semibold text-slate-700 mb-2">Okres gwarancyjny (miesięcy)</h4>
                    <div className="space-y-1.5">
                      {warrantyRules.map((rule, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <select
                            value={rule.value}
                            onChange={e => setWarrantyRules(prev => prev.map((r, i) => i === idx ? { ...r, value: Number(e.target.value) } : r))}
                            className="w-24 px-2 py-1.5 border border-slate-200 rounded text-sm"
                          >
                            {warrantyOptions.map(v => <option key={v} value={v}>{v} mies.</option>)}
                          </select>
                          <span className="text-xs text-slate-400">=</span>
                          <input
                            type="number"
                            value={rule.surcharge}
                            onChange={e => setWarrantyRules(prev => prev.map((r, i) => i === idx ? { ...r, surcharge: parseFloat(e.target.value) || 0 } : r))}
                            className="w-20 px-2 py-1.5 border border-slate-200 rounded text-sm text-right"
                            step="0.5"
                          />
                          <span className="text-xs text-slate-500">%</span>
                          <span className={`text-xs ${rule.surcharge > 0 ? 'text-red-500' : rule.surcharge < 0 ? 'text-green-500' : 'text-slate-400'}`}>
                            {rule.surcharge > 0 ? 'narzut' : rule.surcharge < 0 ? 'rabat' : '-'}
                          </span>
                          <button onClick={() => setWarrantyRules(prev => prev.filter((_, i) => i !== idx))} className="p-0.5 hover:bg-red-50 rounded text-red-400 ml-auto" title="Usuń regułę">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => setWarrantyRules(prev => [...prev, { value: warrantyOptions[0] || 24, surcharge: 0 }])}
                        className="text-xs text-blue-600 hover:underline"
                      >+ Dodaj regułę</button>
                    </div>
                    <div className="mt-2 flex items-center gap-1">
                      <input type="number" id="newWarranty" placeholder="Nowa wartość" className="w-28 px-2 py-1 border border-slate-200 rounded text-xs" />
                      <button
                        onClick={() => {
                          const inp = document.getElementById('newWarranty') as HTMLInputElement;
                          const v = parseInt(inp?.value);
                          if (v > 0 && !warrantyOptions.includes(v)) {
                            setWarrantyOptions(prev => [...prev, v].sort((a, b) => a - b));
                            inp.value = '';
                          }
                        }}
                        className="text-xs text-blue-600 hover:underline"
                      >+ Dodaj opcję</button>
                    </div>
                  </div>

                  {/* Invoice frequency rules */}
                  <div>
                    <h4 className="text-sm font-semibold text-slate-700 mb-2">Wystawienie faktur (co ile dni)</h4>
                    <div className="space-y-1.5">
                      {invoiceFreqRules.map((rule, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <select
                            value={rule.value}
                            onChange={e => setInvoiceFreqRules(prev => prev.map((r, i) => i === idx ? { ...r, value: Number(e.target.value) } : r))}
                            className="w-24 px-2 py-1.5 border border-slate-200 rounded text-sm"
                          >
                            {invoiceFreqOptions.map(v => <option key={v} value={v}>co {v} dni</option>)}
                          </select>
                          <span className="text-xs text-slate-400">=</span>
                          <input
                            type="number"
                            value={rule.surcharge}
                            onChange={e => setInvoiceFreqRules(prev => prev.map((r, i) => i === idx ? { ...r, surcharge: parseFloat(e.target.value) || 0 } : r))}
                            className="w-20 px-2 py-1.5 border border-slate-200 rounded text-sm text-right"
                            step="0.5"
                          />
                          <span className="text-xs text-slate-500">%</span>
                          <span className={`text-xs ${rule.surcharge > 0 ? 'text-red-500' : rule.surcharge < 0 ? 'text-green-500' : 'text-slate-400'}`}>
                            {rule.surcharge > 0 ? 'narzut' : rule.surcharge < 0 ? 'rabat' : '-'}
                          </span>
                          <button onClick={() => setInvoiceFreqRules(prev => prev.filter((_, i) => i !== idx))} className="p-0.5 hover:bg-red-50 rounded text-red-400 ml-auto" title="Usuń regułę">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => setInvoiceFreqRules(prev => [...prev, { value: invoiceFreqOptions[0] || 30, surcharge: 0 }])}
                        className="text-xs text-blue-600 hover:underline"
                      >+ Dodaj regułę</button>
                    </div>
                    <div className="mt-2 flex items-center gap-1">
                      <input type="number" id="newInvoiceFreq" placeholder="Nowa wartość" className="w-28 px-2 py-1 border border-slate-200 rounded text-xs" />
                      <button
                        onClick={() => {
                          const inp = document.getElementById('newInvoiceFreq') as HTMLInputElement;
                          const v = parseInt(inp?.value);
                          if (v > 0 && !invoiceFreqOptions.includes(v)) {
                            setInvoiceFreqOptions(prev => [...prev, v].sort((a, b) => a - b));
                            inp.value = '';
                          }
                        }}
                        className="text-xs text-blue-600 hover:underline"
                      >+ Dodaj opcję</button>
                    </div>
                  </div>
                </div>
              )}
              {settingsTab === 'widok' && (
                <div className="space-y-4">
                  <p className="text-sm text-slate-600">Widoczność elementów w druku i generacji dokumentu.</p>
                  <label className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg cursor-pointer hover:bg-slate-100">
                    <input
                      type="checkbox"
                      checked={showComponentsInPrint}
                      onChange={e => setShowComponentsInPrint(e.target.checked)}
                      className="w-4 h-4 text-blue-600 rounded"
                    />
                    <div>
                      <p className="text-sm font-medium text-slate-700">Pokaż składniki (R/M/S) w druku</p>
                      <p className="text-xs text-slate-500">Wyświetla robociznę, materiały i sprzęt pod pozycjami</p>
                    </div>
                  </label>
                </div>
              )}
            </div>
            <div className="p-4 border-t border-slate-200 flex justify-end">
              <button
                onClick={() => setShowSettingsModal(false)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
              >
                Zamknij
              </button>
            </div>
          </div>
        </div>
      )}

      {showBulkRabatModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70] p-4">
          <div className="bg-white rounded-xl w-full max-w-sm">
            <div className="p-4 border-b border-slate-200 flex justify-between items-center">
              <h2 className="text-lg font-semibold">Ustaw rabat masowo</h2>
              <button onClick={() => setShowBulkRabatModal(false)} className="p-1 hover:bg-slate-100 rounded" title="Zamknij">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <p className="text-sm text-slate-600">
                Zastosuj rabat do {selectedItemsCount} zaznaczonych pozycji:
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={bulkRabatValue}
                  onChange={e => setBulkRabatValue(parseFloat(e.target.value) || 0)}
                  className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-lg text-center"
                  min="0"
                  max="100"
                  step="1"
                />
                <span className="text-lg font-medium text-slate-600">%</span>
              </div>
            </div>
            <div className="p-4 border-t border-slate-200 flex justify-end gap-3">
              <button onClick={() => setShowBulkRabatModal(false)} className="px-4 py-2 border border-slate-200 rounded-lg hover:bg-slate-50">
                Anuluj
              </button>
              <button
                onClick={applyBulkDiscount}
                className="px-6 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700"
              >
                Zastosuj
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {showPreviewModal && selectedOffer && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b border-slate-200 flex justify-between items-center">
              <h2 className="text-xl font-bold text-slate-900">Podgląd oferty</h2>
              <button onClick={() => setShowPreviewModal(false)} className="p-2 hover:bg-slate-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Template selection + logo toggle */}
            <div className="px-6 py-3 border-b border-slate-200 flex items-center gap-3">
              {/* Logo toggle */}
              <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer mr-2">
                <input
                  type="checkbox"
                  checked={showLogoInPreview}
                  onChange={e => setShowLogoInPreview(e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded"
                />
                Pokazywać logo
              </label>
              <div className="h-4 w-px bg-slate-300" />
              <span className="text-sm font-medium text-slate-500">Szablony:</span>
              {[
                { id: 'netto' as const, label: 'Tylko netto' },
                { id: 'brutto' as const, label: 'Tylko brutto' },
                { id: 'rabat' as const, label: 'Rabat od ceny katalogowej' },
                { id: 'no_prices' as const, label: 'Bez cen' },
                { id: 'full' as const, label: 'Wszystko' }
              ].map(tmpl => (
                <button
                  key={tmpl.id}
                  onClick={() => setPreviewTemplate(tmpl.id)}
                  className={`px-4 py-2 rounded-lg text-sm transition ${
                    previewTemplate === tmpl.id
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {tmpl.label}
                </button>
              ))}
            </div>

            {/* Preview content */}
            <div className="flex-1 overflow-y-auto p-6">
              <div className="max-w-3xl mx-auto bg-white border border-slate-200 rounded-lg shadow-sm p-8">
                {/* Offer header with optional logo */}
                <div className="flex justify-between items-start mb-8">
                  <div>
                    {showLogoInPreview && (state.currentCompany as any)?.logo_url && (
                      <img
                        src={(state.currentCompany as any).logo_url}
                        alt=""
                        className="h-12 mb-2 object-contain"
                      />
                    )}
                    <h1 className="text-2xl font-bold text-slate-900">{selectedOffer.name}</h1>
                    <p className="text-slate-500 mt-1">{selectedOffer.number}</p>
                  </div>
                  <div className="text-right text-sm text-slate-600">
                    <p>Data wystawienia: {formatDate(issueDate)}</p>
                    <p>Ważna do: {formatDate(selectedOffer.valid_until)}</p>
                  </div>
                </div>

                {/* Zamawiający / Wykonawca */}
                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div className="p-4 bg-slate-50 rounded-lg">
                    <p className="text-xs font-semibold text-slate-400 uppercase mb-1">Zamawiający</p>
                    {(() => {
                      const cd = selectedOffer.print_settings?.client_data || {};
                      const cn = cd.client_name || (selectedOffer as any).client?.name || offerClientData.client_name || '';
                      return cn ? (
                        <div className="text-sm text-slate-700 space-y-0.5">
                          <p className="font-semibold text-slate-900">{cn}</p>
                          {(cd.nip || (selectedOffer as any).client?.nip) && <p>NIP: {cd.nip || (selectedOffer as any).client?.nip}</p>}
                          {(cd.company_street || cd.company_city) && <p>{[cd.company_street, cd.company_street_number, cd.company_postal_code, cd.company_city].filter(Boolean).join(', ')}</p>}
                          {cd.representative_name && <p className="mt-1">Przedstawiciel: {cd.representative_name}</p>}
                          {cd.representative_email && <p>email: {cd.representative_email}</p>}
                          {cd.representative_phone && <p>tel. {cd.representative_phone}</p>}
                        </div>
                      ) : <p className="text-sm text-slate-400 italic">Brak danych</p>;
                    })()}
                  </div>
                  <div className="p-4 bg-slate-50 rounded-lg">
                    <p className="text-xs font-semibold text-slate-400 uppercase mb-1">Wykonawca</p>
                    {state.currentCompany ? (
                      <div className="text-sm text-slate-700 space-y-0.5">
                        <p className="font-semibold text-slate-900">{state.currentCompany.name}</p>
                        {((state.currentCompany as any)?.nip || (state.currentCompany as any)?.tax_id) && <p>NIP: {(state.currentCompany as any)?.nip || (state.currentCompany as any)?.tax_id}</p>}
                        {((state.currentCompany as any)?.street || (state.currentCompany as any)?.city) && <p>{[(state.currentCompany as any)?.street, (state.currentCompany as any)?.building_number, (state.currentCompany as any)?.postal_code, (state.currentCompany as any)?.city].filter(Boolean).join(', ')}</p>}
                        {((state.currentCompany as any)?.phone || (state.currentCompany as any)?.contact_phone) && <p>tel. {(state.currentCompany as any)?.phone || (state.currentCompany as any)?.contact_phone}</p>}
                        {((state.currentCompany as any)?.email || (state.currentCompany as any)?.contact_email) && <p>email: {(state.currentCompany as any)?.email || (state.currentCompany as any)?.contact_email}</p>}
                      </div>
                    ) : <p className="text-sm text-slate-400 italic">Brak danych</p>}
                  </div>
                </div>

                {/* Sections preview (recursive) */}
                {(() => {
                  const calcPreviewSecTotal = (sec: LocalOfferSection): number => {
                    const isBruttoP = previewTemplate === 'brutto';
                    let total = sec.items.reduce((s, item) => {
                      const val = item.quantity * item.unit_price;
                      const disc = val * ((item.discount_percent || 0) / 100);
                      const netVal = val - disc;
                      return s + (isBruttoP ? netVal * (1 + (item.vat_rate ?? 23) / 100) : netVal);
                    }, 0);
                    (sec.children || []).forEach(child => { total += calcPreviewSecTotal(child); });
                    return total;
                  };
                  const renderPreviewSection = (sec: LocalOfferSection, depth: number = 0) => {
                    const secTotal = calcPreviewSecTotal(sec);
                    return (
                    <div key={sec.id} className={`mb-4 ${depth > 0 ? 'ml-6' : ''}`}>
                      <div className={`flex justify-between items-baseline font-semibold text-slate-900 mb-2 pb-1.5 border-b border-slate-200 ${depth === 0 ? 'text-lg' : 'text-base'}`}>
                        <span>{sec.name}</span>
                        {previewTemplate !== 'no_prices' && <span className="text-sm text-slate-500 font-medium">{formatCurrency(secTotal)}</span>}
                      </div>
                      {sec.items.length > 0 && (
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-slate-500 border-b">
                              <th className="py-2 pr-4">Lp.</th>
                              <th className="py-2 pr-4">Nazwa</th>
                              <th className="py-2 pr-4 text-center">Jedn.</th>
                              <th className="py-2 pr-4 text-right">Ilość</th>
                              {previewTemplate !== 'no_prices' && (
                                <>
                                  <th className="py-2 pr-4 text-right">{previewTemplate === 'brutto' ? 'Cena brutto' : 'Cena jedn.'}</th>
                                  {(previewTemplate === 'rabat' || previewTemplate === 'full') && <th className="py-2 pr-4 text-right">Rabat</th>}
                                  <th className="py-2 pr-4 text-right">{previewTemplate === 'brutto' ? 'Wartość brutto' : 'Wartość'}</th>
                                  {previewTemplate === 'full' && <th className="py-2 text-right">VAT</th>}
                                </>
                              )}
                            </tr>
                          </thead>
                          <tbody>
                            {sec.items.map((item, idx) => {
                              const val = item.quantity * item.unit_price;
                              const disc = val * ((item.discount_percent || 0) / 100);
                              return (
                                <React.Fragment key={item.id}>
                                <tr className="border-b border-slate-100">
                                  <td className="py-2 pr-4 text-slate-500">{idx + 1}</td>
                                  <td className="py-2 pr-4">
                                    <span>{item.name}</span>
                                    {item.description && <p className="text-xs text-slate-400 mt-0.5">{item.description}</p>}
                                    {item.is_optional && <span className="ml-1 text-[10px] bg-yellow-100 text-yellow-700 px-1 rounded">opcja</span>}
                                  </td>
                                  <td className="py-2 pr-4 text-center text-slate-500">{item.unit || 'szt.'}</td>
                                  <td className="py-2 pr-4 text-right">{item.quantity}</td>
                                  {previewTemplate !== 'no_prices' && (
                                    <>
                                      <td className="py-2 pr-4 text-right">
                                        {previewTemplate === 'brutto'
                                          ? formatCurrency(item.unit_price * (1 + (item.vat_rate ?? 23) / 100))
                                          : formatCurrency(item.unit_price)}
                                      </td>
                                      {(previewTemplate === 'rabat' || previewTemplate === 'full') && (
                                        <td className="py-2 pr-4 text-right text-red-600">
                                          {item.discount_percent ? `-${item.discount_percent}%` : '-'}
                                        </td>
                                      )}
                                      <td className="py-2 pr-4 text-right font-medium">
                                        {previewTemplate === 'brutto'
                                          ? formatCurrency((val - disc) * (1 + (item.vat_rate ?? 23) / 100))
                                          : formatCurrency(val - disc)}
                                      </td>
                                      {previewTemplate === 'full' && (
                                        <td className="py-2 text-right text-xs text-slate-500">{item.vat_rate ?? 23}%</td>
                                      )}
                                    </>
                                  )}
                                </tr>
                                {showComponentsInPrint && item.components && item.components.length > 0 && item.components.map((comp, ci) => (
                                  <tr key={`comp-${ci}`} className="bg-slate-50/50">
                                    <td className="py-1 pr-4"></td>
                                    <td className="py-1 pr-4">
                                      <span className={`inline-block w-4 h-4 rounded text-[9px] font-bold text-white text-center leading-4 mr-1.5 ${comp.type === 'labor' ? 'bg-blue-500' : comp.type === 'material' ? 'bg-amber-500' : 'bg-emerald-500'}`}>
                                        {comp.type === 'labor' ? 'R' : comp.type === 'material' ? 'M' : 'S'}
                                      </span>
                                      <span className="text-xs text-slate-500">{comp.name}{comp.code ? ` [${comp.code}]` : ''}</span>
                                    </td>
                                    <td className="py-1 pr-4 text-center text-xs text-slate-400">{comp.unit}</td>
                                    <td className="py-1 pr-4 text-right text-xs text-slate-400">{comp.quantity}</td>
                                    {previewTemplate !== 'no_prices' && (
                                      <>
                                        <td className="py-1 pr-4 text-right text-xs text-slate-400">{formatCurrency(comp.unit_price)}</td>
                                        {(previewTemplate === 'rabat' || previewTemplate === 'full') && <td className="py-1 pr-4"></td>}
                                        <td className="py-1 pr-4 text-right text-xs text-slate-400">{formatCurrency(comp.total_price)}</td>
                                        {previewTemplate === 'full' && <td className="py-1"></td>}
                                      </>
                                    )}
                                  </tr>
                                ))}
                                </React.Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                      {(sec.children || []).map(child => renderPreviewSection(child, depth + 1))}
                    </div>
                  );};
                  return sections.map(sec => renderPreviewSection(sec));
                })()}

                {/* Warunki istotne in preview */}
                {(paymentTerm || invoiceFrequency || warrantyPeriod) && (
                  <div className="mt-6 p-4 bg-slate-50 rounded-lg">
                    <h4 className="text-xs font-semibold text-slate-400 uppercase mb-2">Warunki istotne</h4>
                    <div className="grid grid-cols-3 gap-3 text-sm">
                      {paymentTerm && <div><span className="text-slate-500">Termin płatności:</span> <span className="font-medium">{paymentTerm} dni</span>
                        {(() => { const r = paymentTermRules.find(r => String(r.value) === paymentTerm); return r && r.surcharge !== 0 ? <span className={`ml-1 text-xs ${paymentTermApply ? (r.surcharge > 0 ? 'text-red-500' : 'text-green-600') : 'text-slate-400'}`}>({r.surcharge > 0 ? '+' : ''}{r.surcharge}%{!paymentTermApply ? ' - nie uwzględniony' : ''})</span> : null; })()}
                      </div>}
                      {invoiceFrequency && <div><span className="text-slate-500">Wystawienie faktur:</span> <span className="font-medium">co {invoiceFrequency} dni</span>
                        {(() => { const r = invoiceFreqRules.find(r => String(r.value) === invoiceFrequency); return r && r.surcharge !== 0 ? <span className={`ml-1 text-xs ${invoiceFreqApply ? (r.surcharge > 0 ? 'text-red-500' : 'text-green-600') : 'text-slate-400'}`}>({r.surcharge > 0 ? '+' : ''}{r.surcharge}%{!invoiceFreqApply ? ' - nie uwzględniony' : ''})</span> : null; })()}
                      </div>}
                      {warrantyPeriod && <div><span className="text-slate-500">Okres gwarancyjny:</span> <span className="font-medium">{warrantyPeriod} mies.</span>
                        {(() => { const r = warrantyRules.find(r => String(r.value) === warrantyPeriod); return r && r.surcharge !== 0 ? <span className={`ml-1 text-xs ${warrantyApply ? (r.surcharge > 0 ? 'text-red-500' : 'text-green-600') : 'text-slate-400'}`}>({r.surcharge > 0 ? '+' : ''}{r.surcharge}%{!warrantyApply ? ' - nie uwzględniony' : ''})</span> : null; })()}
                      </div>}
                    </div>
                  </div>
                )}
                {/* Koszty powiązane in preview */}
                {relatedCosts.some(c => c.value > 0) && (
                  <div className="mt-3 p-4 bg-slate-50 rounded-lg">
                    <h4 className="text-xs font-semibold text-slate-400 uppercase mb-2">Koszty powiązane</h4>
                    <div className="space-y-1 text-sm">
                      {relatedCosts.filter(c => c.value > 0 && c.show_on_offer).map(c => (
                        <div key={c.id} className="flex justify-between">
                          <span className="text-slate-600">{c.name}{c.mode === 'percent' ? ` (${c.value}%)` : ''}{c.frequency === 'monthly' ? ' (mies.)' : ''}</span>
                          <span className="font-medium">{formatCurrency(c.mode === 'percent' ? totals.nettoAfterDiscount * (c.value / 100) : c.value)}</span>
                        </div>
                      ))}
                      {relatedCosts.filter(c => c.value > 0 && !c.show_on_offer).reduce((s, c) => s + (c.mode === 'percent' ? totals.nettoAfterDiscount * (c.value / 100) : c.value), 0) > 0 && (
                        <div className="flex justify-between">
                          <span className="text-slate-600">Koszty powiązane</span>
                          <span className="font-medium">{formatCurrency(relatedCosts.filter(c => c.value > 0 && !c.show_on_offer).reduce((s, c) => s + (c.mode === 'percent' ? totals.nettoAfterDiscount * (c.value / 100) : c.value), 0))}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {/* Preview totals */}
                {previewTemplate !== 'no_prices' && (
                  <div className="mt-8 pt-4 border-t-2 border-slate-300 space-y-2">
                    <h4 className="text-sm font-semibold text-slate-700">Podsumowanie</h4>
                    {previewTemplate === 'brutto' ? (
                      <div className="flex justify-between text-lg font-bold">
                        <span>Suma brutto:</span>
                        <span className="text-blue-600">{formatCurrency(totals.totalBrutto)}</span>
                      </div>
                    ) : (
                      <>
                        <div className="flex justify-between">
                          <span>Suma netto:</span>
                          <span className="font-medium">{formatCurrency(totals.total)}</span>
                        </div>
                        {totals.totalDiscount > 0 && previewTemplate !== 'netto' && (
                          <div className="flex justify-between text-red-600">
                            <span>Rabat:</span>
                            <span>-{formatCurrency(totals.totalDiscount)}</span>
                          </div>
                        )}
                        {totals.surchargePercent !== 0 && (
                          <div className={`flex justify-between ${totals.surchargePercent > 0 ? 'text-red-600' : 'text-green-600'}`}>
                            <span>Warunki istotne ({totals.surchargePercent > 0 ? '+' : ''}{totals.surchargePercent}%):</span>
                            <span>{totals.surchargePercent > 0 ? '+' : ''}{formatCurrency(totals.surchargeAmount)}</span>
                          </div>
                        )}
                        <div className="flex justify-between font-semibold">
                          <span>Netto po rabacie:</span>
                          <span>{formatCurrency(totals.nettoAfterSurcharges)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>VAT:</span>
                          <span>{formatCurrency(totals.totalVat)}</span>
                        </div>
                        <div className="flex justify-between text-lg font-bold pt-2 border-t border-slate-300">
                          <span>Brutto:</span>
                          <span className="text-blue-600">{formatCurrency(totals.totalBrutto)}</span>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Preview footer */}
            <div className="p-4 border-t border-slate-200 flex justify-between items-center">
              <button onClick={() => setShowPreviewModal(false)} className="px-4 py-2 border border-slate-200 rounded-lg hover:bg-slate-50">
                Zamknij
              </button>
              <div className="flex gap-2">
                {/* Pobierz dropdown */}
                <div className="relative">
                  <button
                    onClick={() => setShowDownloadDropdown(!showDownloadDropdown)}
                    className="flex items-center gap-1 px-4 py-2 border border-slate-200 rounded-lg hover:bg-slate-50"
                  >
                    <Download className="w-4 h-4" />
                    Pobierz
                    <ChevronDown className="w-3 h-3" />
                  </button>
                  {showDownloadDropdown && (
                    <div className="absolute bottom-full mb-1 right-0 bg-white border border-slate-200 rounded-lg shadow-lg z-10 min-w-[160px]">
                      <button
                        onClick={async () => {
                          setShowDownloadDropdown(false);
                          const html = generateOfferHTML();
                          // Create hidden iframe to render HTML for PDF
                          const iframe = document.createElement('iframe');
                          iframe.style.position = 'fixed';
                          iframe.style.left = '-9999px';
                          iframe.style.top = '0';
                          iframe.style.width = '210mm';
                          iframe.style.height = '297mm';
                          document.body.appendChild(iframe);
                          const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
                          if (!iframeDoc) { document.body.removeChild(iframe); return; }
                          iframeDoc.open();
                          iframeDoc.write(html);
                          iframeDoc.close();
                          // Wait for rendering
                          await new Promise(r => setTimeout(r, 800));
                          const body = iframeDoc.body;
                          const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
                          const pageW = 210;
                          const pageH = 297;
                          const margin = 15;
                          const contentW = pageW - margin * 2;
                          try {
                            const html2canvas = (await import('html2canvas')).default;
                            const canvas = await html2canvas(body, { scale: 3, useCORS: true, width: body.scrollWidth, windowWidth: body.scrollWidth, logging: false, backgroundColor: '#ffffff' });
                            const imgData = canvas.toDataURL('image/png');
                            const imgW = contentW;
                            const imgH = (canvas.height * imgW) / canvas.width;
                            let yOffset = 0;
                            const usableH = pageH - margin * 2;
                            while (yOffset < imgH) {
                              if (yOffset > 0) pdf.addPage();
                              pdf.addImage(imgData, 'PNG', margin, margin - yOffset, imgW, imgH);
                              yOffset += usableH;
                            }
                          } catch {
                            // Fallback: simple text-based PDF
                            pdf.setFontSize(12);
                            pdf.text(`Oferta ${selectedOffer?.number || ''}`, margin, 20);
                            pdf.setFontSize(10);
                            pdf.text(selectedOffer?.name || '', margin, 30);
                          }
                          pdf.save(`${selectedOffer?.number || 'oferta'}.pdf`);
                          document.body.removeChild(iframe);
                        }}
                        className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-left hover:bg-slate-50 rounded-t-lg"
                      >
                        <FileText className="w-4 h-4 text-red-500" />
                        Pobierz PDF
                      </button>
                      <button
                        onClick={() => {
                          setShowDownloadDropdown(false);
                          const allItems = getAllItems(sections);
                          const company = state.currentCompany;
                          const client = (selectedOffer as any)?.client;
                          const wsData: any[][] = [
                            ['OFERTA'],
                            [],
                            ['Numer oferty:', selectedOffer?.number || ''],
                            ['Nazwa:', selectedOffer?.name || ''],
                            ['Data wystawienia:', issueDate],
                            ['Ważna do:', selectedOffer?.valid_until || ''],
                            [],
                            ['WYKONAWCA'],
                            ['Firma:', company?.name || ''],
                            ['NIP:', (company as any)?.nip || (company as any)?.tax_id || ''],
                            ['Adres:', [(company as any)?.street, (company as any)?.building_number, (company as any)?.postal_code, (company as any)?.city].filter(Boolean).join(', ')],
                            ['Telefon:', (company as any)?.phone || (company as any)?.contact_phone || ''],
                            ['Email:', (company as any)?.email || (company as any)?.contact_email || ''],
                            [],
                            ['ZAMAWIAJĄCY'],
                            ['Firma:', client?.name || offerClientData.client_name || ''],
                            ['NIP:', client?.nip || offerClientData.nip || ''],
                            ['Adres:', client?.legal_address || [offerClientData.company_street, offerClientData.company_street_number, offerClientData.company_postal_code, offerClientData.company_city].filter(Boolean).join(', ')],
                            [],
                            ['OBIEKT'],
                            ['Nazwa obiektu:', objectName || ''],
                            ['Adres obiektu:', objectAddress || ''],
                            ...(workStartDate ? [['Terminy Realizacji od:', workStartDate]] : []),
                            ...(workEndDate ? [['Terminy Realizacji do:', workEndDate]] : []),
                            [],
                            ['Lp.', 'Sekcja', 'Nazwa', 'Jedn.', 'Ilość', 'Cena jedn.', 'Rabat %', 'VAT %', 'Wartość netto']
                          ];
                          let lp = 1;
                          sections.forEach(sec => {
                            sec.items.forEach(item => {
                              const val = item.quantity * item.unit_price;
                              const disc = val * ((item.discount_percent || 0) / 100);
                              wsData.push([
                                lp++,
                                sec.name || '',
                                item.name || '',
                                item.unit || 'szt.',
                                item.quantity || 0,
                                item.unit_price || 0,
                                item.discount_percent || 0,
                                item.vat_rate ?? 23,
                                +(val - disc).toFixed(2)
                              ]);
                            });
                          });
                          const xlLacznieNetto = totals.total + totals.surchargeAmount;
                          wsData.push([]);
                          wsData.push(['', '', '', '', '', '', '', 'Suma pozycji netto:', totals.total.toFixed(2)]);
                          if (totals.relatedCostsTotal > 0) wsData.push(['', '', '', '', '', '', '', 'Koszty powiązane:', totals.relatedCostsTotal.toFixed(2)]);
                          if (totals.surchargePercent !== 0) wsData.push(['', '', '', '', '', '', '', `Warunki istotne (${totals.surchargePercent > 0 ? '+' : ''}${totals.surchargePercent}%):`, totals.surchargeAmount.toFixed(2)]);
                          wsData.push(['', '', '', '', '', '', '', 'Łącznie netto:', xlLacznieNetto.toFixed(2)]);
                          if (totals.totalDiscount > 0) wsData.push(['', '', '', '', '', '', '', 'Rabat:', (-totals.totalDiscount).toFixed(2)]);
                          if (totals.totalDiscount > 0) wsData.push(['', '', '', '', '', '', '', 'Netto po rabacie:', totals.nettoAfterSurcharges.toFixed(2)]);
                          wsData.push(['', '', '', '', '', '', '', 'VAT:', totals.totalVat.toFixed(2)]);
                          wsData.push(['', '', '', '', '', '', '', 'Brutto:', totals.totalBrutto.toFixed(2)]);
                          if (offerData.notes) {
                            wsData.push([]);
                            wsData.push(['Uwagi:']);
                            wsData.push([offerData.notes]);
                          }

                          const wb = XLSX.utils.book_new();
                          const ws = XLSX.utils.aoa_to_sheet(wsData);
                          ws['!cols'] = [
                            { wch: 5 }, { wch: 20 }, { wch: 40 }, { wch: 8 },
                            { wch: 10 }, { wch: 12 }, { wch: 8 }, { wch: 8 }, { wch: 14 }
                          ];
                          XLSX.utils.book_append_sheet(wb, ws, 'Oferta');
                          XLSX.writeFile(wb, `${selectedOffer?.number || 'oferta'}.xlsx`);
                        }}
                        className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-left hover:bg-slate-50 rounded-b-lg"
                      >
                        <FileSpreadsheet className="w-4 h-4 text-green-600" />
                        Pobierz Excel
                      </button>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => {
                    const html = generateOfferHTML();
                    const printWindow = window.open('', '_blank');
                    if (printWindow) {
                      printWindow.document.write(html);
                      printWindow.document.close();
                      printWindow.focus();
                      setTimeout(() => printWindow.print(), 500);
                    }
                  }}
                  className="flex items-center gap-1 px-4 py-2 border border-slate-200 rounded-lg hover:bg-slate-50"
                >
                  <Printer className="w-4 h-4" />
                  Drukuj
                </button>
                <button
                  onClick={() => { setShowPreviewModal(false); setShowSendModal(true); }}
                  className="flex items-center gap-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  <Send className="w-4 h-4" />
                  Wyślij ofertę do klienta
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Send Offer Modal */}
      {showSendModal && selectedOffer && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b border-slate-200 flex justify-between items-center">
              <h2 className="text-xl font-bold text-slate-900">Wyślij ofertę do klienta</h2>
              <button onClick={() => setShowSendModal(false)} className="p-2 hover:bg-slate-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Representative selection */}
              <div className="space-y-3">
                <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                  <User className="w-5 h-5 text-slate-400" />
                  Przedstawiciel klienta
                </h3>
                {offerClientContacts.length > 0 ? (
                  <div className="space-y-2">
                    {offerClientContacts.map((contact: any) => (
                      <label
                        key={contact.id}
                        className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition ${
                          sendRepresentativeId === contact.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <input
                          type="radio"
                          name="representative"
                          checked={sendRepresentativeId === contact.id}
                          onChange={() => setSendRepresentativeId(contact.id)}
                          className="w-4 h-4 text-blue-600"
                        />
                        <div className="flex-1">
                          <p className="font-medium text-sm">{contact.first_name} {contact.last_name}</p>
                          <p className="text-xs text-slate-500">{contact.email} • {contact.phone}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <p className="text-xs text-slate-500 mb-2">Brak zapisanych kontaktów. Wprowadź dane ręcznie:</p>
                    <div className="grid grid-cols-2 gap-3">
                      <input type="text" placeholder="Imię" value={sendManualContact.first_name}
                        onChange={e => setSendManualContact(prev => ({ ...prev, first_name: e.target.value }))}
                        className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                      <input type="text" placeholder="Nazwisko" value={sendManualContact.last_name}
                        onChange={e => setSendManualContact(prev => ({ ...prev, last_name: e.target.value }))}
                        className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                      <input type="email" placeholder="E-mail" value={sendManualContact.email}
                        onChange={e => setSendManualContact(prev => ({ ...prev, email: e.target.value }))}
                        className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                      <input type="tel" placeholder="Telefon" value={sendManualContact.phone}
                        onChange={e => setSendManualContact(prev => ({ ...prev, phone: e.target.value }))}
                        className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                    </div>
                  </div>
                )}
              </div>

              {/* Cover letter */}
              <div className="space-y-3">
                <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                  <Mail className="w-5 h-5 text-slate-400" />
                  List przewodni
                </h3>
                <textarea
                  value={sendCoverLetter}
                  onChange={e => setSendCoverLetter(e.target.value)}
                  rows={8}
                  className="w-full px-4 py-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                  placeholder="Treść listu przewodniego..."
                />
              </div>

              {/* Communication channels */}
              <div className="space-y-3">
                <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                  <MessageSquare className="w-5 h-5 text-slate-400" />
                  Kanały komunikacji
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { id: 'email', icon: Mail, label: 'E-mail', desc: 'List przewodni + oferta w załączniku', activeClass: 'border-blue-400 bg-blue-50' },
                    { id: 'sms', icon: Phone, label: 'SMS', desc: 'Krótka informacja + link do oferty', activeClass: 'border-green-400 bg-green-50' },
                    { id: 'whatsapp', icon: MessageSquare, label: 'WhatsApp', desc: 'Wiadomość + plik oferty na numer klienta', activeClass: 'border-emerald-400 bg-emerald-50' },
                    { id: 'telegram', icon: Send, label: 'Telegram', desc: 'Wiadomość + plik oferty przez Telegram', activeClass: 'border-sky-400 bg-sky-50' }
                  ].map(channel => (
                    <label
                      key={channel.id}
                      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition ${
                        sendChannels.includes(channel.id) ? channel.activeClass : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={sendChannels.includes(channel.id)}
                        onChange={e => {
                          if (e.target.checked) {
                            setSendChannels([...sendChannels, channel.id]);
                          } else {
                            setSendChannels(sendChannels.filter(c => c !== channel.id));
                          }
                        }}
                        className="w-4 h-4 text-blue-600 mt-0.5"
                      />
                      <div>
                        <div className="flex items-center gap-1.5">
                          <channel.icon className="w-4 h-4 text-slate-600" />
                          <span className="font-medium text-sm">{channel.label}</span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">{channel.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Unique offer link */}
              <div className="space-y-3">
                <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                  <Globe className="w-5 h-5 text-slate-400" />
                  Link do oferty
                </h3>
                <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-lg border border-blue-200">
                  <LinkIcon className="w-5 h-5 text-blue-600 shrink-0" />
                  <input
                    type="text"
                    readOnly
                    value={selectedOffer.public_url
                      ? window.location.origin + selectedOffer.public_url
                      : `${window.location.origin}/#/offer/${selectedOffer.public_token || selectedOffer.id.substring(0, 8)}`}
                    className="flex-1 px-3 py-1.5 bg-white border border-blue-200 rounded text-sm"
                  />
                  <button
                    onClick={() => {
                      const url = selectedOffer.public_url
                        ? window.location.origin + selectedOffer.public_url
                        : `${window.location.origin}/#/offer/${selectedOffer.public_token || selectedOffer.id.substring(0, 8)}`;
                      navigator.clipboard.writeText(url);
                      setLinkCopied(true);
                      setTimeout(() => setLinkCopied(false), 2000);
                    }}
                    className={`px-3 py-1.5 rounded text-sm ${linkCopied ? 'bg-green-600 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                  >
                    {linkCopied ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </button>
                  {linkCopied && <span className="text-xs text-green-600 ml-1">Skopiowano!</span>}
                </div>
                <p className="text-xs text-slate-500">
                  Unikalny link do strony z ofertą. Klient może go otworzyć w przeglądarce.
                </p>
              </div>
            </div>

            {/* Send footer */}
            <div className="p-4 border-t border-slate-200 flex justify-between items-center">
              <button onClick={() => setShowSendModal(false)} className="px-4 py-2 border border-slate-200 rounded-lg hover:bg-slate-50">
                Anuluj
              </button>
              <button
                onClick={() => {
                  showConfirm({
                    title: 'Wysłać ofertę?',
                    message: `Oferta zostanie wysłana przez: ${sendChannels.join(', ')}.`,
                    confirmLabel: 'Wyślij',
                    onConfirm: async () => {
                      setSendingOffer(true);
                      const result = await handleSendOffer(selectedOffer, sendChannels, sendCoverLetter);
                      setSendingOffer(false);
                      if (result.success) {
                        showToast('Oferta została wysłana!', 'success');
                        setShowSendModal(false);
                      } else if (result.errors.length > 0) {
                        showToast(`Wysyłka zakończona z błędami: ${result.errors.join(', ')}`, 'error');
                        setShowSendModal(false);
                      }
                    }
                  });
                }}
                disabled={sendChannels.length === 0 || sendingOffer}
                className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {sendingOffer ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {sendingOffer ? 'Wysyłanie...' : 'Wyślij ofertę'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Kartoteka Search Modal (Labour/Material/Equipment) */}
      {(showSearchLabourModal || showSearchMaterialModal || showSearchEquipmentModal) && (() => {
        const closeKartoteka = () => {
          setShowSearchLabourModal(false);
          setShowSearchMaterialModal(false);
          setShowSearchEquipmentModal(false);
          setSearchComponentTarget(null);
          setSearchPositionTarget(null);
          setKartotekaDetailItem(null);
        };

        const handleKartotekaSelect = (item: any) => {
          const price = item.price || item.default_price || item.price_unit || 0;

          if (kartotekaMode === 'fill_item' && searchComponentTarget) {
            // Fill the item itself (name, unit, unit_price)
            updateItem(searchComponentTarget.sectionId, searchComponentTarget.itemId, {
              name: item.name,
              unit: item.unit || 'szt.',
              unit_price: price
            });
          } else if (kartotekaMode === 'add_component' && searchComponentTarget) {
            // Add as component
            const compType = showSearchLabourModal ? 'labor' : showSearchMaterialModal ? 'material' : 'equipment';
            addComponent(searchComponentTarget.sectionId, searchComponentTarget.itemId, {
              type: compType,
              name: item.name,
              code: item.code || '',
              unit: item.unit || 'szt.',
              quantity: 1,
              unit_price: price,
              total_price: price
            });

            // If own labour has linked materials/equipment, add them too
            if (kartotekaTab === 'own' && showSearchLabourModal) {
              if (item.materials && Array.isArray(item.materials)) {
                item.materials.forEach((m: any) => {
                  addComponent(searchComponentTarget.sectionId, searchComponentTarget.itemId, {
                    type: 'material',
                    name: m.name || m.material_name || '',
                    code: m.code || m.material_code || '',
                    unit: m.unit || 'szt.',
                    quantity: m.quantity || 1,
                    unit_price: m.price || m.default_price || 0,
                    total_price: (m.quantity || 1) * (m.price || m.default_price || 0)
                  });
                });
              }
              if (item.equipment && Array.isArray(item.equipment)) {
                item.equipment.forEach((eq: any) => {
                  addComponent(searchComponentTarget.sectionId, searchComponentTarget.itemId, {
                    type: 'equipment',
                    name: eq.name || eq.equipment_name || '',
                    code: eq.code || eq.equipment_code || '',
                    unit: eq.unit || 'szt.',
                    quantity: eq.quantity || 1,
                    unit_price: eq.price || eq.default_price || 0,
                    total_price: (eq.quantity || 1) * (eq.price || eq.default_price || 0)
                  });
                });
              }
            }
          }
          closeKartoteka();
        };

        // Build category tree
        const rootCats = kartotekaCategories.filter(c => !c.parent_id);
        const childCatsOf = (parentId: string) => kartotekaCategories.filter(c => c.parent_id === parentId);

        // Filter items by search + category
        const currentData = kartotekaTab === 'own' ? kartotekaOwnData : kartotekaData;
        const filteredKartotekaItems = currentData.filter(item => {
          const matchesSearch = !kartotekaSearchText ||
            (item.name || '').toLowerCase().includes(kartotekaSearchText.toLowerCase()) ||
            (item.code || '').toLowerCase().includes(kartotekaSearchText.toLowerCase());
          const matchesCategory = !kartotekaSelectedCategory ||
            item.category_id === kartotekaSelectedCategory;
          return matchesSearch && matchesCategory;
        }).slice(0, 100);

        // Count items per category
        const catCounts = kartotekaCategories.reduce((acc: Record<string, number>, cat: any) => {
          acc[cat.id] = currentData.filter(i => i.category_id === cat.id).length;
          return acc;
        }, {} as Record<string, number>);

        const renderCatTree = (cats: any[], depth: number = 0) => (
          cats.map(cat => {
            const children = childCatsOf(cat.id);
            const isExpanded = kartotekaExpandedCats.has(cat.id);
            const count = catCounts[cat.id] || 0;
            return (
              <div key={cat.id}>
                <button
                  onClick={() => {
                    setKartotekaSelectedCategory(kartotekaSelectedCategory === cat.id ? null : cat.id);
                    if (children.length > 0) {
                      setKartotekaExpandedCats(prev => {
                        const next = new Set(prev);
                        if (next.has(cat.id)) next.delete(cat.id); else next.add(cat.id);
                        return next;
                      });
                    }
                  }}
                  className={`w-full text-left px-2 py-1.5 rounded text-sm flex items-center gap-1 transition ${
                    kartotekaSelectedCategory === cat.id
                      ? 'bg-blue-100 text-blue-700 font-medium'
                      : 'hover:bg-slate-100 text-slate-700'
                  }`}
                  style={{ paddingLeft: `${8 + depth * 16}px` }}
                >
                  {children.length > 0 && (
                    isExpanded ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />
                  )}
                  <span className="flex-1 truncate">{cat.name}</span>
                  {count > 0 && <span className="text-xs text-slate-400">{count}</span>}
                </button>
                {isExpanded && children.length > 0 && renderCatTree(children, depth + 1)}
              </div>
            );
          })
        );

        const kartotekaTypeLabel = showSearchLabourModal ? 'robocizny' :
          showSearchMaterialModal ? 'materiałów' : 'sprzętu';
        const kartotekaTypeAddLabel = showSearchLabourModal ? 'Dodaj robociznę' :
          showSearchMaterialModal ? 'Dodaj materiał' : 'Dodaj sprzęt';

        // Dynamic integration tabs based on type
        const materialIntegrations = wholesalerIntegrations.filter((i: any) => i.is_active && i.branza !== 'sprzet');
        const equipmentIntegrations = wholesalerIntegrations.filter((i: any) => i.is_active && i.branza === 'sprzet');
        const isMaterial = showSearchMaterialModal;
        const isEquipment = showSearchEquipmentModal;

        const handleIntegratorSelect = (product: any) => {
          handleKartotekaSelect({
            name: product.name,
            code: product.sku || '',
            unit: product.unit || 'szt.',
            price: product.price || product.catalogPrice || 0
          });
        };

        return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70]">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-[90vw] h-[90vh] overflow-hidden flex flex-col">

            {/* Tabs bar (matching Dictionaries.tsx layout) */}
            <div className="px-6 pt-4 pb-3 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-1">
                <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
                  <button
                    onClick={() => { setKartotekaMainTab('katalog'); setKartotekaTab('own'); }}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition ${kartotekaMainTab === 'katalog' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                  >
                    Własny katalog
                  </button>
                  {isMaterial && materialIntegrations.map((integ: any) => (
                    <button
                      key={integ.id}
                      onClick={() => setKartotekaMainTab(integ.wholesaler_id)}
                      className={`px-4 py-2 rounded-md text-sm font-medium transition ${kartotekaMainTab === integ.wholesaler_id ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                    >
                      {integ.wholesaler_name}
                    </button>
                  ))}
                  {isEquipment && equipmentIntegrations.map((integ: any) => (
                    <button
                      key={integ.id}
                      onClick={() => setKartotekaMainTab(integ.wholesaler_id)}
                      className={`px-4 py-2 rounded-md text-sm font-medium transition ${kartotekaMainTab === integ.wholesaler_id ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                    >
                      {integ.wholesaler_name}
                    </button>
                  ))}
                </div>
                {isMaterial && (
                  <button
                    onClick={() => setShowWholesalerConfig(true)}
                    className="ml-2 flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                  >
                    <Store className="w-4 h-4" />
                    Integrację
                  </button>
                )}
                {isEquipment && (
                  <button
                    onClick={() => setShowRentalConfig(true)}
                    className="ml-2 flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                  >
                    <Store className="w-4 h-4" />
                    Integracje
                  </button>
                )}
              </div>
              <button onClick={closeKartoteka} className="p-1.5 hover:bg-slate-100 rounded-lg" title="Zamknij kartotekę">
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 flex overflow-hidden">

            {/* TIM integrator tab */}
            {kartotekaMainTab === 'tim' && (
              <div className="flex-1 overflow-y-auto">
                <TIMIntegrator
                  integrationId={wholesalerIntegrations.find((i: any) => i.wholesaler_id === 'tim')?.id}
                  onAddToOwnCatalog={handleIntegratorSelect}
                  catalogButtonLabel="Dodaj do oferty"
                />
              </div>
            )}

            {/* Onninen integrator tab */}
            {kartotekaMainTab === 'oninen' && (
              <div className="flex-1 overflow-y-auto">
                <OninenIntegrator
                  integrationId={wholesalerIntegrations.find((i: any) => i.wholesaler_id === 'oninen')?.id}
                  onAddToOwnCatalog={handleIntegratorSelect}
                  catalogButtonLabel="Dodaj do oferty"
                />
              </div>
            )}

            {/* Atut integrator tab */}
            {kartotekaMainTab === 'atut-rental' && (
              <div className="flex-1 overflow-y-auto">
                <AtutIntegrator
                  integrationId={wholesalerIntegrations.find((i: any) => i.wholesaler_id === 'atut-rental' && i.is_active)?.id}
                  onAddToOwnCatalog={handleIntegratorSelect}
                  catalogButtonLabel="Dodaj do oferty"
                />
              </div>
            )}

            {/* Ramirent integrator tab */}
            {kartotekaMainTab === 'ramirent' && (
              <div className="flex-1 overflow-y-auto">
                <RamirentIntegrator
                  integrationId={wholesalerIntegrations.find((i: any) => i.wholesaler_id === 'ramirent' && i.is_active)?.id}
                  onAddToOwnCatalog={handleIntegratorSelect}
                  catalogButtonLabel="Dodaj do oferty"
                />
              </div>
            )}

            {/* Own catalog tab */}
            {kartotekaMainTab === 'katalog' && <>
              {/* Category sidebar */}
              <div className="w-64 border-r border-slate-200 overflow-y-auto flex flex-col">
                <div className="px-4 py-3 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Kategorie</span>
                  <button className="p-0.5 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600" title="Dodaj kategorię">
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
                <div className="px-2 pb-2 space-y-0.5 flex-1 overflow-y-auto">
                  <button
                    onClick={() => setKartotekaSelectedCategory(null)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition ${
                      !kartotekaSelectedCategory ? 'bg-blue-50 text-blue-700' : 'hover:bg-slate-50 text-slate-600'
                    }`}
                  >
                    <FolderOpen className="w-4 h-4 shrink-0" />
                    <span className="flex-1">Wszystkie</span>
                    <span className={`text-xs ${!kartotekaSelectedCategory ? 'text-blue-500' : 'text-slate-400'}`}>{currentData.length}</span>
                  </button>
                  {rootCats.map(cat => {
                    const children = childCatsOf(cat.id);
                    const isExpanded = kartotekaExpandedCats.has(cat.id);
                    const count = catCounts[cat.id] || 0;
                    return (
                      <div key={cat.id}>
                        <button
                          onClick={() => {
                            setKartotekaSelectedCategory(kartotekaSelectedCategory === cat.id ? null : cat.id);
                            if (children.length > 0) {
                              setKartotekaExpandedCats(prev => {
                                const next = new Set(prev);
                                if (next.has(cat.id)) next.delete(cat.id); else next.add(cat.id);
                                return next;
                              });
                            }
                          }}
                          className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 group transition ${
                            kartotekaSelectedCategory === cat.id
                              ? 'bg-blue-50 text-blue-700 font-medium'
                              : 'hover:bg-slate-50 text-slate-600'
                          }`}
                        >
                          {children.length > 0 ? (
                            isExpanded ? <ChevronDown className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                          ) : (
                            <FolderOpen className="w-4 h-4 shrink-0 text-slate-400" />
                          )}
                          <span className="flex-1 truncate">{cat.name}</span>
                          {count > 0 && <span className="text-xs text-slate-400">{count}</span>}
                        </button>
                        {isExpanded && children.length > 0 && (
                          <div className="ml-4 space-y-0.5">
                            {children.map((child: any) => (
                              <button
                                key={child.id}
                                onClick={() => setKartotekaSelectedCategory(kartotekaSelectedCategory === child.id ? null : child.id)}
                                className={`w-full text-left px-3 py-1.5 rounded-lg text-sm flex items-center gap-2 transition ${
                                  kartotekaSelectedCategory === child.id
                                    ? 'bg-blue-50 text-blue-700 font-medium'
                                    : 'hover:bg-slate-50 text-slate-500'
                                }`}
                              >
                                <FolderOpen className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                                <span className="flex-1 truncate">{child.name}</span>
                                <span className="text-xs text-slate-400">{catCounts[child.id] || 0}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {kartotekaCategories.length === 0 && (
                    <div className="px-3 py-4 text-xs text-slate-400 text-center">Brak kategorii</div>
                  )}
                </div>
              </div>

              {/* Content area */}
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Search + view toggle + count + add button */}
                <div className="px-4 py-3 flex items-center gap-3 border-b border-slate-100">
                  <div className="flex-1 relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      value={kartotekaSearchText}
                      onChange={e => setKartotekaSearchText(e.target.value)}
                      placeholder={`Szukaj ${kartotekaTypeLabel}...`}
                      className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="flex border border-slate-200 rounded-lg overflow-hidden">
                    <button
                      onClick={() => setKartotekaViewMode('grid')}
                      className={`px-2.5 py-2 ${kartotekaViewMode === 'grid' ? 'bg-blue-600 text-white' : 'bg-white text-slate-400 hover:bg-slate-50'}`}
                    >
                      <FileSpreadsheet className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setKartotekaViewMode('list')}
                      className={`px-2.5 py-2 ${kartotekaViewMode === 'list' ? 'bg-blue-600 text-white' : 'bg-white text-slate-400 hover:bg-slate-50'}`}
                    >
                      <ListChecks className="w-4 h-4" />
                    </button>
                  </div>
                  <span className="text-sm text-slate-500 whitespace-nowrap">{filteredKartotekaItems.length} {kartotekaTypeLabel}</span>
                  <button
                    onClick={closeKartoteka}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium flex items-center gap-2 whitespace-nowrap"
                  >
                    <Plus className="w-4 h-4" />
                    {kartotekaTypeAddLabel}
                  </button>
                </div>

                {/* Items area */}
                <div className="flex-1 overflow-y-auto">
                  {kartotekaLoading ? (
                    <div className="flex items-center justify-center h-40">
                      <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                    </div>
                  ) : kartotekaDetailItem ? (
                    /* Detail view */
                    <div className="p-6 space-y-4">
                      <button
                        onClick={() => setKartotekaDetailItem(null)}
                        className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
                      >
                        <ArrowLeft className="w-4 h-4" />
                        Powrót do listy
                      </button>
                      <div className="bg-slate-50 rounded-xl p-6 space-y-4">
                        {kartotekaDetailItem.image_url && (
                          <img src={kartotekaDetailItem.image_url} alt="" className="w-48 h-48 object-contain rounded-lg border border-slate-200 bg-white" />
                        )}
                        <h3 className="text-xl font-bold text-slate-900">{kartotekaDetailItem.name}</h3>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div><span className="text-slate-500">Kod:</span> <span className="font-medium">{kartotekaDetailItem.code || '-'}</span></div>
                          <div><span className="text-slate-500">Jednostka:</span> <span className="font-medium">{kartotekaDetailItem.unit || '-'}</span></div>
                          <div><span className="text-slate-500">Cena:</span> <span className="font-bold text-blue-600">{formatCurrency(kartotekaDetailItem.price || kartotekaDetailItem.default_price || kartotekaDetailItem.price_unit || 0)}</span></div>
                          {kartotekaDetailItem.manufacturer && (
                            <div><span className="text-slate-500">Producent:</span> <span className="font-medium">{kartotekaDetailItem.manufacturer}</span></div>
                          )}
                          {kartotekaDetailItem.description && (
                            <div className="col-span-2"><span className="text-slate-500">Opis:</span> <span>{kartotekaDetailItem.description}</span></div>
                          )}
                        </div>
                        <button
                          onClick={() => handleKartotekaSelect(kartotekaDetailItem)}
                          className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
                        >
                          <Plus className="w-4 h-4" />
                          {kartotekaMode === 'fill_item' ? 'Wybierz tę pozycję' : 'Dodaj jako składnik'}
                        </button>
                      </div>
                    </div>
                  ) : kartotekaViewMode === 'grid' ? (
                    /* Grid view — cards with images */
                    <div className="p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                      {filteredKartotekaItems.map((item: any) => (
                        <div
                          key={item.id}
                          className="border border-slate-200 rounded-xl overflow-hidden hover:border-blue-300 hover:shadow-md cursor-pointer transition group bg-white"
                          onClick={() => handleKartotekaSelect(item)}
                        >
                          {/* Image */}
                          <div className="h-36 bg-slate-50 flex items-center justify-center border-b border-slate-100">
                            {item.image_url ? (
                              <img src={item.image_url} alt="" className="max-h-full max-w-full object-contain p-2" />
                            ) : (
                              <Package className="w-12 h-12 text-slate-200" />
                            )}
                          </div>
                          {/* Info */}
                          <div className="p-3 space-y-1">
                            <div className="text-xs text-slate-400 font-mono">{item.code || '-'}</div>
                            <div className="text-sm font-medium text-slate-900 line-clamp-2 min-h-[2.5rem]">{item.name}</div>
                            {item.manufacturer && (
                              <div className="text-xs text-slate-400">{item.manufacturer}</div>
                            )}
                            <div className="flex items-center justify-between pt-1 border-t border-slate-100 mt-2">
                              <span className="text-sm font-bold text-blue-600">
                                {(item.price || item.default_price || item.price_unit || 0).toFixed(2)} <span className="text-xs font-normal text-slate-400">zł</span>
                              </span>
                              <span className="text-xs text-green-600 bg-green-50 px-1.5 py-0.5 rounded">Aktywny</span>
                            </div>
                          </div>
                        </div>
                      ))}
                      {filteredKartotekaItems.length === 0 && (
                        <div className="col-span-full py-16 text-center text-slate-400 text-sm">
                          Brak wyników
                        </div>
                      )}
                    </div>
                  ) : (
                    /* List view (table) */
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 sticky top-0">
                        <tr>
                          <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500 uppercase">Kod</th>
                          <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500 uppercase">Nazwa</th>
                          <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500 uppercase">Jedn.</th>
                          <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500 uppercase">Cena</th>
                          <th className="px-4 py-2.5 w-20"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredKartotekaItems.map((item: any) => (
                          <tr
                            key={item.id}
                            className="hover:bg-blue-50/50 cursor-pointer transition"
                            onClick={() => handleKartotekaSelect(item)}
                          >
                            <td className="px-4 py-2.5 text-slate-500 font-mono text-xs">{item.code || '-'}</td>
                            <td className="px-4 py-2.5 font-medium">{item.name}</td>
                            <td className="px-4 py-2.5 text-slate-500">{item.unit || '-'}</td>
                            <td className="px-4 py-2.5 text-right font-bold text-blue-600">
                              {formatCurrency(item.price || item.default_price || item.price_unit || 0)}
                            </td>
                            <td className="px-4 py-2.5">
                              <button
                                onClick={(e) => { e.stopPropagation(); handleKartotekaSelect(item); }}
                                className="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
                              >
                                {kartotekaMode === 'fill_item' ? 'Wybierz' : 'Dodaj'}
                              </button>
                            </td>
                          </tr>
                        ))}
                        {filteredKartotekaItems.length === 0 && (
                          <tr>
                            <td colSpan={5} className="px-4 py-16 text-center text-slate-400">
                              Brak danych w kartotece
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </>}
            </div>

            {/* Wholesaler config modal */}
            <WholesalerIntegrationModal
              isOpen={showWholesalerConfig}
              onClose={() => setShowWholesalerConfig(false)}
              companyId={currentUser?.company_id || ''}
              integrations={wholesalerIntegrations}
              onIntegrationChange={() => {
                if (currentUser?.company_id) {
                  supabase.from('wholesaler_integrations').select('*').eq('company_id', currentUser.company_id)
                    .then(res => { if (res.data) setWholesalerIntegrations(res.data); });
                }
              }}
            />
            <RentalIntegrationModal
              isOpen={showRentalConfig}
              onClose={() => setShowRentalConfig(false)}
              companyId={currentUser?.company_id || ''}
              integrations={wholesalerIntegrations}
              onIntegrationChange={() => {
                if (currentUser?.company_id) {
                  supabase.from('wholesaler_integrations').select('*').eq('company_id', currentUser.company_id)
                    .then(res => { if (res.data) setWholesalerIntegrations(res.data); });
                }
              }}
            />
          </div>
        </div>
        );
      })()}
      {/* Toast notifications */}
      {toasts.length > 0 && (
        <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2">
          {toasts.map(toast => (
            <div
              key={toast.id}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg border backdrop-blur-sm transition-all duration-300 ${
                toast.type === 'success' ? 'bg-green-50 border-green-200 text-green-800' :
                toast.type === 'error' ? 'bg-red-50 border-red-200 text-red-800' :
                'bg-blue-50 border-blue-200 text-blue-800'
              }`}
            >
              {toast.type === 'success' ? <CheckCircle className="w-5 h-5 text-green-500 shrink-0" /> :
               toast.type === 'error' ? <AlertCircle className="w-5 h-5 text-red-500 shrink-0" /> :
               <AlertCircle className="w-5 h-5 text-blue-500 shrink-0" />}
              <span className="text-sm font-medium">{toast.text}</span>
              <button onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))} className="p-0.5 hover:bg-black/10 rounded ml-2" title="Zamknij">
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Confirmation modal */}
      {confirmModal.show && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[90] p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm">
            <div className="p-5 space-y-3">
              <h3 className="text-lg font-semibold text-slate-900">{confirmModal.title}</h3>
              <p className="text-sm text-slate-600">{confirmModal.message}</p>
              {confirmModal.showInput && (
                <input
                  type="text"
                  value={confirmModal.inputValue || ''}
                  onChange={e => setConfirmModal(prev => ({ ...prev, inputValue: e.target.value }))}
                  placeholder={confirmModal.inputPlaceholder}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  autoFocus
                />
              )}
            </div>
            <div className="px-5 pb-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirmModal(prev => ({ ...prev, show: false }))}
                className="px-4 py-2 border border-slate-200 rounded-lg text-sm hover:bg-slate-50"
              >
                Anuluj
              </button>
              <button
                onClick={() => { confirmModal.onConfirm(confirmModal.inputValue); setConfirmModal(prev => ({ ...prev, show: false })); }}
                className={`px-4 py-2 rounded-lg text-sm text-white ${confirmModal.destructive ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}
              >
                {confirmModal.confirmLabel || 'Potwierdź'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Offer Request (Zapytanie ofertowe) Modal */}
      {showCreateRequestModal && (() => {
        const reqOffer = selectedOffer || offers.find(o => o.id === requestOfferId) || null;
        const modalSections = selectedOffer ? sections : requestSections;
        return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70] p-4">
          <div className="bg-white rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            <div className="p-4 border-b border-slate-200 flex justify-between items-center">
              <h2 className="text-lg font-semibold">Utwórz zapytanie ofertowe</h2>
              <button onClick={() => { setShowCreateRequestModal(false); setCreatingRequest(false); }} className="p-1 hover:bg-slate-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1 space-y-6">
              {requestStep === 'type' && (
                <>
                  {/* Offer selector (when opened from tab, not from offer detail) */}
                  {!selectedOffer && (
                    <div>
                      <label className="text-sm font-medium text-slate-700 mb-1 block">Oferta źródłowa</label>
                      <select
                        value={requestOfferId}
                        onChange={async e => {
                          const offerId = e.target.value;
                          setRequestOfferId(offerId);
                          const off = offers.find(o => o.id === offerId);
                          if (off) setRequestName(`Zapytanie — ${off.name || off.number || ''}`);
                          if (offerId) {
                            setLoadingRequestSections(true);
                            const [secRes, itemRes] = await Promise.all([
                              supabase.from('offer_sections').select('*').eq('offer_id', offerId).order('sort_order'),
                              supabase.from('offer_items').select('*, components:offer_item_components(*)').eq('offer_id', offerId).order('sort_order')
                            ]);
                            const secs = (secRes.data || []).map((s: any) => ({
                              ...s,
                              items: (itemRes.data || []).filter((i: any) => i.section_id === s.id)
                            }));
                            setRequestSections(secs);
                            setLoadingRequestSections(false);
                          } else {
                            setRequestSections([]);
                          }
                        }}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                      >
                        <option value="">-- Wybierz ofertę --</option>
                        {offers.map(o => <option key={o.id} value={o.id}>{o.name || o.number} {o.status !== 'draft' ? '' : '(szkic)'}</option>)}
                      </select>
                    </div>
                  )}

                  {/* Request name */}
                  <div>
                    <label className="text-sm font-medium text-slate-700 mb-1 block">Nazwa zapytania</label>
                    <input
                      type="text"
                      value={requestName}
                      onChange={e => setRequestName(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                      placeholder="Nazwa zapytania ofertowego"
                    />
                  </div>

                  {/* Request type selection */}
                  <div>
                    <label className="text-sm font-medium text-slate-700 mb-2 block">Typ zapytania</label>
                    <div className="grid grid-cols-2 gap-3">
                      {([
                        { value: 'robota' as const, label: 'Robota', desc: 'Tylko robocizna', icon: Hammer, activeBorder: 'border-blue-500', activeBg: 'bg-blue-50', activeText: 'text-blue-600' },
                        { value: 'materialy' as const, label: 'Materiały', desc: 'Tylko materiały', icon: Package, activeBorder: 'border-amber-500', activeBg: 'bg-amber-50', activeText: 'text-amber-600' },
                        { value: 'sprzet' as const, label: 'Sprzęt', desc: 'Tylko sprzęt', icon: Wrench, activeBorder: 'border-green-500', activeBg: 'bg-green-50', activeText: 'text-green-600' },
                        { value: 'all' as const, label: 'Cały zakres', desc: 'Wszystkie pozycje', icon: Briefcase, activeBorder: 'border-indigo-500', activeBg: 'bg-indigo-50', activeText: 'text-indigo-600' },
                      ]).map(opt => (
                        <button
                          key={opt.value}
                          onClick={() => setRequestType(opt.value)}
                          className={`p-4 rounded-lg border-2 text-left transition ${requestType === opt.value ? `${opt.activeBorder} ${opt.activeBg}` : 'border-slate-200 hover:border-slate-300'}`}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <opt.icon className={`w-5 h-5 ${requestType === opt.value ? opt.activeText : 'text-slate-400'}`} />
                            <span className="font-medium text-slate-900">{opt.label}</span>
                          </div>
                          <p className="text-xs text-slate-500">{opt.desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Subcontractor selection — searchable */}
                  <div className="relative">
                    <label className="text-sm font-medium text-slate-700 mb-1 block">Podwykonawca</label>
                    {selectedSubcontractor ? (
                      <div className="flex items-center gap-2 px-3 py-2 border border-blue-200 bg-blue-50 rounded-lg text-sm">
                        <span className="flex-1 font-medium text-slate-900">{selectedSubcontractor.name}</span>
                        {selectedSubcontractor.nip && <span className="text-slate-500 text-xs">NIP: {selectedSubcontractor.nip}</span>}
                        <button onClick={() => { setSelectedSubcontractor(null); setRequestSubcontractorId(''); setSubcontractorSearch(''); }} className="p-0.5 hover:bg-blue-100 rounded"><X className="w-4 h-4 text-slate-500" /></button>
                      </div>
                    ) : (
                      <>
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                          <input
                            type="text"
                            value={subcontractorSearch}
                            onChange={e => { setSubcontractorSearch(e.target.value); setSubcontractorDropdownOpen(true); }}
                            onFocus={() => setSubcontractorDropdownOpen(true)}
                            placeholder="Szukaj podwykonawcy (nazwa, NIP, telefon)…"
                            className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          />
                        </div>
                        {subcontractorDropdownOpen && (() => {
                          const q = subcontractorSearch.toLowerCase().trim();
                          const filtered = subcontractors.filter(s =>
                            !q || (s.name || '').toLowerCase().includes(q) || (s.nip || '').includes(q) || (s.phone || '').includes(q)
                          );
                          return filtered.length > 0 ? (
                            <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                              {filtered.map(s => (
                                <button
                                  key={s.id}
                                  onClick={() => { setSelectedSubcontractor(s); setRequestSubcontractorId(s.id); setSubcontractorDropdownOpen(false); setSubcontractorSearch(''); }}
                                  className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm border-b border-slate-50 last:border-0"
                                >
                                  <span className="font-medium text-slate-900">{s.name}</span>
                                  {s.nip && <span className="ml-2 text-xs text-slate-500">NIP: {s.nip}</span>}
                                  {s.phone && <span className="ml-2 text-xs text-slate-400">{s.phone}</span>}
                                </button>
                              ))}
                            </div>
                          ) : q ? (
                            <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg p-3 text-sm text-slate-500">
                              Brak wyników dla „{subcontractorSearch}"
                            </div>
                          ) : null;
                        })()}
                      </>
                    )}
                  </div>

                  {/* Supplier selection — searchable */}
                  <div className="relative">
                    <label className="text-sm font-medium text-slate-700 mb-1 block">Dostawca</label>
                    {selectedSupplier ? (
                      <div className="flex items-center gap-2 px-3 py-2 border border-amber-200 bg-amber-50 rounded-lg text-sm">
                        <span className="flex-1 font-medium text-slate-900">{selectedSupplier.name}</span>
                        {selectedSupplier.nip && <span className="text-slate-500 text-xs">NIP: {selectedSupplier.nip}</span>}
                        <button onClick={() => { setSelectedSupplier(null); setSupplierSearch(''); }} className="p-0.5 hover:bg-amber-100 rounded"><X className="w-4 h-4 text-slate-500" /></button>
                      </div>
                    ) : (
                      <>
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                          <input
                            type="text"
                            value={supplierSearch}
                            onChange={e => { setSupplierSearch(e.target.value); setSupplierDropdownOpen(true); }}
                            onFocus={() => setSupplierDropdownOpen(true)}
                            placeholder="Szukaj dostawcy (nazwa, NIP, telefon)…"
                            className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                          />
                        </div>
                        {supplierDropdownOpen && (() => {
                          const q = supplierSearch.toLowerCase().trim();
                          const filtered = suppliers.filter(s =>
                            !q || (s.name || '').toLowerCase().includes(q) || (s.nip || '').includes(q) || (s.phone || '').includes(q)
                          );
                          return filtered.length > 0 ? (
                            <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                              {filtered.map(s => (
                                <button
                                  key={s.id}
                                  onClick={() => { setSelectedSupplier(s); setSupplierDropdownOpen(false); setSupplierSearch(''); }}
                                  className="w-full text-left px-3 py-2 hover:bg-amber-50 text-sm border-b border-slate-50 last:border-0"
                                >
                                  <span className="font-medium text-slate-900">{s.name}</span>
                                  {s.nip && <span className="ml-2 text-xs text-slate-500">NIP: {s.nip}</span>}
                                  {s.phone && <span className="ml-2 text-xs text-slate-400">{s.phone}</span>}
                                </button>
                              ))}
                            </div>
                          ) : q ? (
                            <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg p-3 text-sm text-slate-500">
                              Brak wyników dla „{supplierSearch}"
                            </div>
                          ) : null;
                        })()}
                      </>
                    )}
                  </div>

                  {/* Preview of filtered items count */}
                  <div className="bg-slate-50 rounded-lg p-4">
                    <p className="text-sm text-slate-600">
                      Pozycje w zapytaniu: {' '}
                      <span className="font-bold text-slate-900">
                        {loadingRequestSections ? '…' : (() => {
                          if (requestType === 'all') return modalSections.reduce((acc: number, s: any) => acc + (s.items?.length || 0), 0);
                          const typeMap: Record<string, string> = { robota: 'labor', materialy: 'material', sprzet: 'equipment' };
                          const compType = typeMap[requestType];
                          return modalSections.reduce((acc: number, s: any) => acc + (s.items || []).filter((item: any) =>
                            (item.components || []).some((c: any) => c.type === compType)
                          ).length, 0);
                        })()}
                      </span>
                    </p>
                  </div>
                </>
              )}
            </div>
            <div className="p-4 border-t border-slate-200 flex justify-between">
              <button
                onClick={() => { setShowCreateRequestModal(false); setCreatingRequest(false); setSelectedSubcontractor(null); setSelectedSupplier(null); setSubcontractorSearch(''); setSupplierSearch(''); }}
                className="px-4 py-2 border border-slate-200 rounded-lg text-sm hover:bg-slate-50"
              >
                Anuluj
              </button>
              <button
                onClick={async () => {
                  if (!currentUser || !reqOffer) return;
                  setCreatingRequest(true);
                  try {
                    const token = crypto.randomUUID().replace(/-/g, '').substring(0, 16);
                    const typeMap: Record<string, string> = { robota: 'labor', materialy: 'material', sprzet: 'equipment' };
                    const compType = requestType !== 'all' ? typeMap[requestType] : null;
                    const filteredItems = modalSections.flatMap((sec: any) =>
                      (sec.items || [])
                        .filter((item: any) => !compType || (item.components || []).some((c: any) => c.type === compType))
                        .map((item: any) => ({ ...item, section_name: sec.name }))
                    );
                    const { data: newReq, error } = await supabase.from('offer_requests').insert({
                      company_id: currentUser.company_id,
                      offer_id: reqOffer.id,
                      subcontractor_id: requestSubcontractorId || null,
                      name: requestName || `Zapytanie — ${reqOffer.name}`,
                      request_type: requestType,
                      status: 'draft',
                      share_token: token,
                      created_by_id: currentUser.id,
                      print_settings: {
                        items: filteredItems.map(i => ({ id: i.id, name: i.name, unit: i.unit, quantity: i.quantity, section_name: i.section_name })),
                        offer_name: reqOffer.name,
                        offer_number: reqOffer.number,
                        company_data: {
                          name: state.currentCompany?.name || '',
                          nip: (state.currentCompany as any)?.nip || (state.currentCompany as any)?.tax_id || '',
                          logo_url: (state.currentCompany as any)?.logo_url || '',
                          phone: (state.currentCompany as any)?.phone || '',
                          email: (state.currentCompany as any)?.email || '',
                          street: (state.currentCompany as any)?.street || '',
                          building_number: (state.currentCompany as any)?.building_number || '',
                          city: (state.currentCompany as any)?.city || '',
                          postal_code: (state.currentCompany as any)?.postal_code || '',
                        },
                        subcontractor_data: selectedSubcontractor ? { id: selectedSubcontractor.id, name: selectedSubcontractor.name, nip: selectedSubcontractor.nip, phone: selectedSubcontractor.phone, email: selectedSubcontractor.email } : null,
                        supplier_data: selectedSupplier ? { id: selectedSupplier.id, name: selectedSupplier.name, nip: selectedSupplier.nip, phone: selectedSupplier.phone, email: selectedSupplier.email } : null,
                      }
                    }).select('*, offer:offers(name, number), subcontractor:contractors(name)').single();
                    if (error) throw error;
                    if (newReq) {
                      setOfferRequests(prev => [newReq, ...prev]);
                      const url = `${window.location.origin}/#/offer-request/${token}`;
                      window.open(url, '_blank');
                      showToast('Zapytanie ofertowe utworzone', 'success');
                      setShowCreateRequestModal(false);
                      setSelectedSubcontractor(null);
                      setSelectedSupplier(null);
                      setSubcontractorSearch('');
                      setSupplierSearch('');
                    }
                  } catch (err) {
                    console.error('Error creating request:', err);
                    showToast('Błąd tworzenia zapytania', 'error');
                  } finally {
                    setCreatingRequest(false);
                  }
                }}
                disabled={creatingRequest || !reqOffer}
                className="flex items-center gap-1.5 px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {creatingRequest ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Utwórz
              </button>
            </div>
          </div>
        </div>
        );
      })()}
    </>
  );
};

export default OffersPage;
