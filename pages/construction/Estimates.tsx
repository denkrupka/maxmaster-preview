import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Plus, X, Search, Calculator, ChevronRight, ChevronDown, Loader2,
  FolderOpen, FileText, Package, Users, Wrench, PieChart, Trash2,
  Pencil, Copy, Download, Upload, Eye, Settings, ArrowLeft,
  DollarSign, Percent, GripVertical, Check, AlertCircle,
  Save, XCircle, RotateCcw, Inbox, BookOpen, Wallet, Building2,
  User, Calendar, Phone, Mail, Star, UserPlus, MapPin, Filter, Briefcase
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../../context/AppContext';
import { supabase } from '../../lib/supabase';
import { fetchCompanyByNip, validateNip, normalizeNip } from '../../lib/gusApi';
import { searchAddress, OSMAddress, createDebouncedSearch } from '../../lib/osmAutocomplete';

// Lazy-loaded components for tabs
import { DictionariesPage } from './Dictionaries';
import { PriceListsPage } from './PriceLists';
import { RequestsPage } from './Requests';
import {
  Project, EstimateStage, EstimateTask, EstimateResource,
  EstimateMarkup, UnitMeasure, Valuation, ValuationGroup, ResourceType,
  KosztorysRequest, KosztorysRequestStatus, KosztorysObjectType,
  KosztorysInstallationType, KosztorysRequestSource, User as UserType,
  KosztorysRequestContact
} from '../../types';

// Status configuration
const STATUS_CONFIG: Record<KosztorysRequestStatus, { label: string; color: string; bgColor: string }> = {
  new: { label: 'Nowe', color: 'text-blue-700', bgColor: 'bg-blue-100' },
  in_progress: { label: 'W pracy', color: 'text-amber-700', bgColor: 'bg-amber-100' },
  form_filled: { label: 'Formularz', color: 'text-purple-700', bgColor: 'bg-purple-100' },
  estimate_generated: { label: 'Kosztorys', color: 'text-indigo-700', bgColor: 'bg-indigo-100' },
  estimate_approved: { label: 'Zatwierdzony', color: 'text-green-700', bgColor: 'bg-green-100' },
  estimate_revision: { label: 'Do poprawy', color: 'text-orange-700', bgColor: 'bg-orange-100' },
  kp_sent: { label: 'KP wysłane', color: 'text-cyan-700', bgColor: 'bg-cyan-100' },
  closed: { label: 'Zamknięte', color: 'text-slate-700', bgColor: 'bg-slate-100' },
  cancelled: { label: 'Anulowane', color: 'text-red-700', bgColor: 'bg-red-100' }
};

const OBJECT_TYPE_LABELS: Record<KosztorysObjectType, string> = {
  industrial: 'Przemysłowe',
  residential: 'Mieszkaniowe',
  office: 'Biurowe'
};

const SOURCE_LABELS: Record<KosztorysRequestSource, string> = {
  email: 'E-mail',
  phone: 'Telefon',
  meeting: 'Spotkanie',
  tender: 'Przetarg',
  other: 'Inne'
};

// Phone number formatting
const formatPhoneNumber = (value: string): string => {
  const cleaned = value.replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+48')) {
    const digits = cleaned.slice(3);
    if (digits.length <= 3) return `+48 ${digits}`;
    if (digits.length <= 6) return `+48 ${digits.slice(0, 3)} ${digits.slice(3)}`;
    return `+48 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 9)}`;
  }
  if (cleaned.startsWith('48') && cleaned.length > 2) {
    const digits = cleaned.slice(2);
    if (digits.length <= 3) return `+48 ${digits}`;
    if (digits.length <= 6) return `+48 ${digits.slice(0, 3)} ${digits.slice(3)}`;
    return `+48 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 9)}`;
  }
  if (/^\d+$/.test(cleaned)) {
    if (cleaned.length <= 3) return cleaned;
    if (cleaned.length <= 6) return `${cleaned.slice(0, 3)} ${cleaned.slice(3)}`;
    return `${cleaned.slice(0, 3)} ${cleaned.slice(3, 6)} ${cleaned.slice(6, 9)}`;
  }
  return cleaned;
};

const isValidEmail = (email: string): boolean => {
  if (!email) return true;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// Main tab type
type MainTabType = 'estimates' | 'requests' | 'dictionaries';

// Contact form interface
interface ContactFormData {
  id?: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  position: string;
  is_primary: boolean;
}

interface ExistingClient {
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

interface RequestFormData {
  client_name: string;
  nip: string;
  company_street: string;
  company_street_number: string;
  company_city: string;
  company_postal_code: string;
  company_country: string;
  internal_notes: string;
  contact_person: string;
  phone: string;
  email: string;
  investment_name: string;
  object_code: string;
  object_type: KosztorysObjectType;
  object_type_id: string;
  object_category_id: string;
  installation_types: KosztorysInstallationType;
  object_street: string;
  object_street_number: string;
  object_city: string;
  object_postal_code: string;
  object_country: string;
  main_material_side: string;
  minor_material_side: string;
  planned_response_date: string;
  notes: string;
  request_source: KosztorysRequestSource;
  assigned_user_id: string;
}

const initialFormData: RequestFormData = {
  client_name: '',
  nip: '',
  company_street: '',
  company_street_number: '',
  company_city: '',
  company_postal_code: '',
  company_country: 'Polska',
  internal_notes: '',
  contact_person: '',
  phone: '',
  email: '',
  investment_name: '',
  object_code: '',
  object_type: 'residential',
  object_type_id: '',
  object_category_id: '',
  installation_types: 'IE',
  object_street: '',
  object_street_number: '',
  object_city: '',
  object_postal_code: '',
  object_country: 'Polska',
  main_material_side: '',
  minor_material_side: '',
  planned_response_date: '',
  notes: '',
  request_source: 'email',
  assigned_user_id: ''
};

const initialContactData: ContactFormData = {
  first_name: '',
  last_name: '',
  phone: '',
  email: '',
  position: '',
  is_primary: true
};

// Resource type config
const RESOURCE_TYPE_CONFIG: Record<ResourceType, { label: string; color: string; bgColor: string; icon: React.FC<{className?: string}> }> = {
  labor: { label: 'Robocizna', color: 'text-blue-600', bgColor: 'bg-blue-100', icon: Users },
  material: { label: 'Materiał', color: 'text-green-600', bgColor: 'bg-green-100', icon: Package },
  equipment: { label: 'Sprzęt', color: 'text-orange-600', bgColor: 'bg-orange-100', icon: Wrench },
  overhead: { label: 'Narzuty', color: 'text-gray-600', bgColor: 'bg-gray-100', icon: PieChart }
};

interface StageWithChildren extends EstimateStage {
  children?: StageWithChildren[];
  tasks?: TaskWithResources[];
  isExpanded?: boolean;
}

interface TaskWithResources extends EstimateTask {
  children?: TaskWithResources[];
  resources?: EstimateResource[];
  isExpanded?: boolean;
}

// Inline editable cell component
const EditableCell: React.FC<{
  value: string | number;
  type?: 'text' | 'number';
  onSave: (value: string | number) => void;
  className?: string;
  suffix?: string;
}> = ({ value, type = 'text', onSave, className = '', suffix = '' }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(String(value));

  const handleSave = () => {
    const newValue = type === 'number' ? parseFloat(editValue) || 0 : editValue;
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

  if (isEditing) {
    return (
      <input
        type={type}
        value={editValue}
        onChange={e => setEditValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        autoFocus
        className={`w-full px-1 py-0.5 text-sm border border-blue-400 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 ${className}`}
      />
    );
  }

  return (
    <span
      onClick={() => { setEditValue(String(value)); setIsEditing(true); }}
      className={`cursor-pointer hover:bg-blue-50 px-1 py-0.5 rounded ${className}`}
    >
      {type === 'number' ? Number(value).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : value}
      {suffix}
    </span>
  );
};

export const EstimatesPage: React.FC = () => {
  const { state } = useAppContext();
  const { currentUser } = state;
  const navigate = useNavigate();

  // Main tab state for navigation between sections
  const [activeMainTab, setActiveMainTab] = useState<MainTabType>('estimates');
  const [newRequestsCount, setNewRequestsCount] = useState(0);

  // Kosztorys estimates state
  const [kosztorysEstimates, setKosztorysEstimates] = useState<any[]>([]);
  const [kosztorysLoading, setKosztorysLoading] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);

  // Requests state
  const [requests, setRequests] = useState<KosztorysRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [stages, setStages] = useState<StageWithChildren[]>([]);
  const [unitMeasures, setUnitMeasures] = useState<UnitMeasure[]>([]);
  const [valuationGroups, setValuationGroups] = useState<ValuationGroup[]>([]);
  const [valuations, setValuations] = useState<Valuation[]>([]);
  const [markups, setMarkups] = useState<EstimateMarkup[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [valuationSearch, setValuationSearch] = useState('');

  // New estimate modal state
  const [showNewEstimateModal, setShowNewEstimateModal] = useState(false);
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  const [estimateToDelete, setEstimateToDelete] = useState<any>(null);
  const [editingRequestId, setEditingRequestId] = useState<string | null>(null);
  const [editingEstimateId, setEditingEstimateId] = useState<string | null>(null);

  // Estimate details modal state
  const [showEstimateDetailModal, setShowEstimateDetailModal] = useState(false);
  const [selectedEstimateDetail, setSelectedEstimateDetail] = useState<any>(null);
  const [formData, setFormData] = useState<RequestFormData>(initialFormData);
  const [contacts, setContacts] = useState<ContactFormData[]>([{ ...initialContactData }]);
  const [gusLoading, setGusLoading] = useState(false);
  const [gusError, setGusError] = useState<string | null>(null);
  const [gusSuccess, setGusSuccess] = useState<string | null>(null);
  const [clientSelected, setClientSelected] = useState(false);

  // Users for assignment
  const [users, setUsers] = useState<UserType[]>([]);

  // Work types
  const [workTypes, setWorkTypes] = useState<{ id: string; code: string; name: string }[]>([]);
  const [selectedWorkTypes, setSelectedWorkTypes] = useState<string[]>([]);
  const [showWorkTypesDropdown, setShowWorkTypesDropdown] = useState(false);
  const [showAddWorkType, setShowAddWorkType] = useState(false);
  const [newWorkTypeCode, setNewWorkTypeCode] = useState('');
  const [newWorkTypeName, setNewWorkTypeName] = useState('');

  // Object types and categories
  const [objectTypes, setObjectTypes] = useState<any[]>([]);
  const [objectCategories, setObjectCategories] = useState<any[]>([]);

  // Address autocomplete
  const [companyAddressSuggestions, setCompanyAddressSuggestions] = useState<OSMAddress[]>([]);
  const [objectAddressSuggestions, setObjectAddressSuggestions] = useState<OSMAddress[]>([]);
  const [showCompanyAddressSuggestions, setShowCompanyAddressSuggestions] = useState(false);
  const [showObjectAddressSuggestions, setShowObjectAddressSuggestions] = useState(false);
  const [editingObjectCode, setEditingObjectCode] = useState(false);

  // Existing clients for dropdown
  const [existingClients, setExistingClients] = useState<ExistingClient[]>([]);
  const [clientSearchQuery, setClientSearchQuery] = useState('');
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [filteredClients, setFilteredClients] = useState<ExistingClient[]>([]);

  // Client contacts (existing representatives)
  const [clientContacts, setClientContacts] = useState<any[]>([]);
  const [showAddContactForm, setShowAddContactForm] = useState(false);
  const [selectedContactId, setSelectedContactId] = useState('');

  // Filters
  const [showFilters, setShowFilters] = useState(false);
  const [clientFilter, setClientFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [workTypeFilter, setWorkTypeFilter] = useState<string[]>([]);
  const [valueMinFilter, setValueMinFilter] = useState('');
  const [valueMaxFilter, setValueMaxFilter] = useState('');
  const [dateFromFilter, setDateFromFilter] = useState('');
  const [dateToFilter, setDateToFilter] = useState('');

  // Modal states
  const [showStageModal, setShowStageModal] = useState(false);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showResourceModal, setShowResourceModal] = useState(false);
  const [showMarkupModal, setShowMarkupModal] = useState(false);
  const [showValuationPanel, setShowValuationPanel] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<{ type: 'stage' | 'task' | 'resource'; id: string; name: string } | null>(null);

  // Form states
  const [editingStage, setEditingStage] = useState<EstimateStage | null>(null);
  const [editingTask, setEditingTask] = useState<EstimateTask | null>(null);
  const [editingResource, setEditingResource] = useState<EstimateResource | null>(null);
  const [parentStageId, setParentStageId] = useState<string | null>(null);
  const [currentStageId, setCurrentStageId] = useState<string | null>(null);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);

  // Form data
  const [stageForm, setStageForm] = useState({ name: '', code: '' });
  const [taskForm, setTaskForm] = useState({ name: '', code: '', volume: 1, unit_measure_id: 0, is_group: false });
  const [resourceForm, setResourceForm] = useState({
    name: '', code: '', resource_type: 'material' as ResourceType,
    unit_measure_id: 0, volume: 1, price: 0, markup: 0, url: ''
  });
  const [markupForm, setMarkupForm] = useState({ name: '', value: 0, type: 'percent' as 'percent' | 'fixed', is_nds: false });

  useEffect(() => {
    if (currentUser) {
      loadProjects();
      loadUnitMeasures();
      loadValuations();
      loadKosztorysEstimates();
      loadNewRequestsCount();
      loadUsers();
      loadWorkTypes();
      loadObjectTypes();
      loadObjectCategories();
      loadExistingClients();
    }
  }, [currentUser]);

  useEffect(() => {
    if (selectedProject) {
      loadEstimateData();
    }
  }, [selectedProject]);

  // Filter clients based on search query
  useEffect(() => {
    if (clientSearchQuery.trim().length >= 2) {
      const query = clientSearchQuery.toLowerCase();
      const filtered = existingClients.filter(c =>
        c.client_name.toLowerCase().includes(query) ||
        (c.nip && c.nip.includes(query))
      );
      // Sort: contractors first, then historical; alphabetically within each group
      filtered.sort((a, b) => {
        if (a.source !== b.source) return a.source === 'contractor' ? -1 : 1;
        return a.client_name.localeCompare(b.client_name);
      });
      setFilteredClients(filtered);
      setShowClientDropdown(filtered.length > 0 || clientSearchQuery.trim().length >= 2);
    } else {
      setFilteredClients([]);
      setShowClientDropdown(false);
    }
  }, [clientSearchQuery, existingClients]);

  const loadNewRequestsCount = async () => {
    if (!currentUser) return;
    try {
      const { count } = await supabase
        .from('kosztorys_requests')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', currentUser.company_id)
        .eq('status', 'new');
      setNewRequestsCount(count || 0);
    } catch (err) {
      console.error('Error loading new requests count:', err);
    }
  };

  const loadRequests = async () => {
    if (!currentUser) return;
    setRequestsLoading(true);
    try {
      const { data, error } = await supabase
        .from('kosztorys_requests')
        .select(`
          *,
          assigned_user:users!kosztorys_requests_assigned_user_id_fkey(id, first_name, last_name, email),
          created_by:users!kosztorys_requests_created_by_id_fkey(id, first_name, last_name),
          contacts:kosztorys_request_contacts(*),
          work_types:kosztorys_request_work_types(work_type_id, work_type:kosztorys_work_types(id, code, name))
        `)
        .eq('company_id', currentUser.company_id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setRequests(data || []);
    } catch (err) {
      console.error('Error loading requests:', err);
    } finally {
      setRequestsLoading(false);
    }
  };

  const loadUsers = async () => {
    if (!currentUser) return;
    try {
      const { data } = await supabase
        .from('users')
        .select('id, first_name, last_name, email, role')
        .eq('company_id', currentUser.company_id)
        .in('role', ['company_admin', 'hr', 'coordinator', 'employee'])
        .order('first_name');
      if (data) setUsers(data as any);
    } catch (err) {
      console.error('Error loading users:', err);
    }
  };

  const loadWorkTypes = async () => {
    if (!currentUser) return;
    try {
      const { data } = await supabase
        .from('kosztorys_work_types')
        .select('id, code, name')
        .eq('company_id', currentUser.company_id)
        .eq('is_active', true)
        .order('code');
      if (data) {
        setWorkTypes(data);
      } else {
        setWorkTypes([
          { id: 'ie', code: 'IE', name: 'IE - Elektryka' },
          { id: 'it', code: 'IT', name: 'IT - Teletechnika' }
        ]);
      }
    } catch (err) {
      console.error('Error loading work types:', err);
      setWorkTypes([
        { id: 'ie', code: 'IE', name: 'IE - Elektryka' },
        { id: 'it', code: 'IT', name: 'IT - Teletechnika' }
      ]);
    }
  };

  const loadObjectTypes = async () => {
    if (!currentUser) return;
    try {
      const { data } = await supabase
        .from('kosztorys_object_types')
        .select('*')
        .eq('company_id', currentUser.company_id)
        .eq('is_active', true)
        .order('name');
      if (data) setObjectTypes(data);
    } catch (err) {
      console.error('Error loading object types:', err);
    }
  };

  const loadObjectCategories = async () => {
    if (!currentUser) return;
    try {
      const { data } = await supabase
        .from('kosztorys_object_categories')
        .select('*, object_type:kosztorys_object_types(*)')
        .eq('company_id', currentUser.company_id)
        .eq('is_active', true)
        .order('name');
      if (data) setObjectCategories(data);
    } catch (err) {
      console.error('Error loading object categories:', err);
    }
  };

  const loadExistingClients = async () => {
    if (!currentUser) return;
    try {
      // Load clients/suppliers from contractors_clients portal table
      const { data: portalClients } = await supabase
        .from('contractors_clients')
        .select('id, name, nip, address_street, address_city, address_postal_code, address_country, contractor_type')
        .eq('company_id', currentUser.company_id)
        .eq('is_archived', false)
        .order('name');

      // Also load from previous requests for historical data
      const { data: requestsData } = await supabase
        .from('kosztorys_requests')
        .select('client_name, nip, company_street, company_street_number, company_city, company_postal_code, company_country')
        .eq('company_id', currentUser.company_id)
        .order('client_name');

      const allClients: ExistingClient[] = [];
      const portalByNip = new Map<string, number>();
      const portalByName = new Map<string, number>();

      // Add portal clients (contractors_clients)
      if (portalClients) {
        portalClients.forEach(c => {
          const idx = allClients.length;
          allClients.push({
            contractor_id: c.id,
            client_name: c.name,
            nip: c.nip,
            company_street: c.address_street,
            company_street_number: null,
            company_city: c.address_city,
            company_postal_code: c.address_postal_code,
            company_country: c.address_country === 'PL' ? 'Polska' : (c.address_country || 'Polska'),
            source: 'contractor'
          });
          if (c.nip) portalByNip.set(c.nip.replace(/\D/g, ''), idx);
          portalByName.set(c.name.toLowerCase(), idx);
        });
      }

      // Add clients from requests (if not already in portal list)
      if (requestsData) {
        requestsData.forEach(r => {
          // Skip if exact name match exists in portal
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
          // Skip if NIP match exists in portal
          if (r.nip && portalByNip.has(r.nip.replace(/\D/g, ''))) {
            const idx = portalByNip.get(r.nip.replace(/\D/g, ''))!;
            if (!allClients[idx].company_street && r.company_street) {
              allClients[idx].company_street = r.company_street;
              allClients[idx].company_street_number = r.company_street_number;
              allClients[idx].company_city = r.company_city;
              allClients[idx].company_postal_code = r.company_postal_code;
            }
            return;
          }
          // Add as historical entry
          allClients.push({
            client_name: r.client_name,
            nip: r.nip,
            company_street: r.company_street,
            company_street_number: r.company_street_number,
            company_city: r.company_city,
            company_postal_code: r.company_postal_code,
            company_country: r.company_country,
            source: 'request_history'
          });
        });
      }

      setExistingClients(allClients);
    } catch (err) {
      console.error('Error loading existing clients:', err);
    }
  };

  const loadKosztorysEstimates = async () => {
    if (!currentUser) return;
    setKosztorysLoading(true);
    try {
      let query = supabase
        .from('kosztorys_estimates')
        .select(`
          *,
          request:kosztorys_requests(id, investment_name, client_name, address, work_types:kosztorys_request_work_types(work_type:kosztorys_work_types(id, code, name)))
        `)
        .eq('company_id', currentUser.company_id)
        .eq('is_deleted', showDeleted);

      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) {
        console.error('Error loading kosztorys estimates:', error);
      } else {
        setKosztorysEstimates(data || []);
      }
    } catch (err) {
      console.error('Error loading kosztorys estimates:', err);
    } finally {
      setKosztorysLoading(false);
    }
  };

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

  const loadUnitMeasures = async () => {
    try {
      const { data } = await supabase
        .from('unit_measures')
        .select('*')
        .or(`company_id.eq.${currentUser?.company_id},is_system.eq.true`)
        .order('id');
      if (data) setUnitMeasures(data);
    } catch (err) {
      console.error('Error loading unit measures:', err);
    }
  };

  const loadValuations = async () => {
    if (!currentUser) return;
    try {
      const [groupsRes, valsRes] = await Promise.all([
        supabase.from('valuation_groups').select('*').eq('company_id', currentUser.company_id).order('sort_order'),
        supabase.from('valuations').select('*, unit_measure:unit_measures(*)').eq('company_id', currentUser.company_id).eq('is_active', true)
      ]);
      if (groupsRes.data) setValuationGroups(groupsRes.data);
      if (valsRes.data) setValuations(valsRes.data);
    } catch (err) {
      console.error('Error loading valuations:', err);
    }
  };

  const loadEstimateData = async () => {
    if (!selectedProject) return;
    setLoading(true);
    try {
      const [stagesRes, tasksRes, resourcesRes, markupsRes] = await Promise.all([
        supabase.from('estimate_stages').select('*').eq('project_id', selectedProject.id).order('sort_order'),
        supabase.from('estimate_tasks').select('*').eq('project_id', selectedProject.id).order('sort_order'),
        supabase.from('estimate_resources').select('*').eq('project_id', selectedProject.id).order('sort_order'),
        supabase.from('estimate_markups').select('*').eq('project_id', selectedProject.id).order('sort_order')
      ]);

      const stagesData = stagesRes.data || [];
      const tasksData = tasksRes.data || [];
      const resourcesData = resourcesRes.data || [];

      const stagesWithTasks = buildStageHierarchy(stagesData, tasksData, resourcesData);
      setStages(stagesWithTasks);
      setMarkups(markupsRes.data || []);
    } catch (err) {
      console.error('Error loading estimate data:', err);
    } finally {
      setLoading(false);
    }
  };

  const buildStageHierarchy = (
    stagesData: EstimateStage[],
    tasksData: EstimateTask[],
    resourcesData: EstimateResource[]
  ): StageWithChildren[] => {
    const taskMap = new Map<string, TaskWithResources>();
    tasksData.forEach(task => {
      taskMap.set(task.id, {
        ...task,
        children: [],
        resources: resourcesData.filter(r => r.task_id === task.id),
        isExpanded: true
      });
    });

    tasksData.forEach(task => {
      if (task.parent_id && taskMap.has(task.parent_id)) {
        taskMap.get(task.parent_id)!.children!.push(taskMap.get(task.id)!);
      }
    });

    const rootTasksByStage = new Map<string, TaskWithResources[]>();
    tasksData.forEach(task => {
      if (!task.parent_id) {
        if (!rootTasksByStage.has(task.stage_id)) {
          rootTasksByStage.set(task.stage_id, []);
        }
        rootTasksByStage.get(task.stage_id)!.push(taskMap.get(task.id)!);
      }
    });

    const stageMap = new Map<string, StageWithChildren>();
    stagesData.forEach(stage => {
      stageMap.set(stage.id, {
        ...stage,
        children: [],
        tasks: rootTasksByStage.get(stage.id) || [],
        isExpanded: true
      });
    });

    stagesData.forEach(stage => {
      if (stage.parent_id && stageMap.has(stage.parent_id)) {
        stageMap.get(stage.parent_id)!.children!.push(stageMap.get(stage.id)!);
      }
    });

    return stagesData.filter(s => !s.parent_id).map(s => stageMap.get(s.id)!);
  };

  // CRUD Operations
  const handleSaveStage = async () => {
    if (!selectedProject || !stageForm.name.trim()) return;
    setSaving(true);
    try {
      const stageData = {
        project_id: selectedProject.id,
        parent_id: parentStageId || null,
        name: stageForm.name.trim(),
        code: stageForm.code.trim() || null,
        sort_order: stages.length
      };

      if (editingStage) {
        await supabase.from('estimate_stages').update(stageData).eq('id', editingStage.id);
      } else {
        await supabase.from('estimate_stages').insert(stageData);
      }

      await loadEstimateData();
      setShowStageModal(false);
      setStageForm({ name: '', code: '' });
      setEditingStage(null);
      setParentStageId(null);
    } catch (err) {
      console.error('Error saving stage:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveTask = async () => {
    if (!selectedProject || !currentStageId || !taskForm.name.trim()) return;
    setSaving(true);
    try {
      const taskData = {
        project_id: selectedProject.id,
        stage_id: currentStageId,
        name: taskForm.name.trim(),
        code: taskForm.code.trim() || null,
        volume: taskForm.volume,
        unit_measure_id: taskForm.unit_measure_id || null,
        is_group: taskForm.is_group,
        calculate_mode: 'by_resources' as const,
        sort_order: 0
      };

      if (editingTask) {
        await supabase.from('estimate_tasks').update(taskData).eq('id', editingTask.id);
      } else {
        await supabase.from('estimate_tasks').insert(taskData);
      }

      await loadEstimateData();
      setShowTaskModal(false);
      setTaskForm({ name: '', code: '', volume: 1, unit_measure_id: 0, is_group: false });
      setEditingTask(null);
      setCurrentStageId(null);
    } catch (err) {
      console.error('Error saving task:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveResource = async () => {
    if (!selectedProject || !currentTaskId || !resourceForm.name.trim()) return;
    setSaving(true);
    try {
      const cost = resourceForm.volume * resourceForm.price;
      const priceWithMarkup = resourceForm.price * (1 + resourceForm.markup / 100);
      const costWithMarkup = resourceForm.volume * priceWithMarkup;

      const resourceData = {
        project_id: selectedProject.id,
        task_id: currentTaskId,
        name: resourceForm.name.trim(),
        code: resourceForm.code.trim() || null,
        resource_type: resourceForm.resource_type,
        unit_measure_id: resourceForm.unit_measure_id || null,
        volume: resourceForm.volume,
        price: resourceForm.price,
        markup: resourceForm.markup,
        cost,
        price_with_markup: priceWithMarkup,
        cost_with_markup: costWithMarkup,
        url: resourceForm.url || null,
        sort_order: 0
      };

      if (editingResource) {
        await supabase.from('estimate_resources').update(resourceData).eq('id', editingResource.id);
      } else {
        await supabase.from('estimate_resources').insert(resourceData);
      }

      await loadEstimateData();
      setShowResourceModal(false);
      setResourceForm({ name: '', code: '', resource_type: 'material', unit_measure_id: 0, volume: 1, price: 0, markup: 0, url: '' });
      setEditingResource(null);
      setCurrentTaskId(null);
    } catch (err) {
      console.error('Error saving resource:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateResource = async (resourceId: string, field: string, value: number | string) => {
    const resource = findResourceById(resourceId);
    if (!resource) return;

    const updatedResource = { ...resource, [field]: value };
    const cost = updatedResource.volume * updatedResource.price;
    const priceWithMarkup = updatedResource.price * (1 + updatedResource.markup / 100);
    const costWithMarkup = updatedResource.volume * priceWithMarkup;

    try {
      await supabase.from('estimate_resources').update({
        [field]: value,
        cost,
        price_with_markup: priceWithMarkup,
        cost_with_markup: costWithMarkup
      }).eq('id', resourceId);
      await loadEstimateData();
    } catch (err) {
      console.error('Error updating resource:', err);
    }
  };

  const findResourceById = (id: string): EstimateResource | null => {
    for (const stage of stages) {
      for (const task of stage.tasks || []) {
        const resource = task.resources?.find(r => r.id === id);
        if (resource) return resource;
      }
    }
    return null;
  };

  const handleAddFromValuation = async (valuation: Valuation) => {
    if (!currentTaskId) {
      alert('Najpierw wybierz pozycję, do której chcesz dodać zasób');
      return;
    }

    setResourceForm({
      name: valuation.name,
      code: valuation.code || '',
      resource_type: valuation.resource_type,
      unit_measure_id: valuation.unit_measure_id || 0,
      volume: 1,
      price: valuation.price,
      markup: 15,
      url: ''
    });
    setShowResourceModal(true);
  };

  const handleDelete = async () => {
    if (!showDeleteConfirm) return;
    setSaving(true);
    try {
      const { type, id } = showDeleteConfirm;
      if (type === 'stage') {
        await supabase.from('estimate_stages').delete().eq('id', id);
      } else if (type === 'task') {
        await supabase.from('estimate_tasks').delete().eq('id', id);
      } else if (type === 'resource') {
        await supabase.from('estimate_resources').delete().eq('id', id);
      }
      await loadEstimateData();
      setShowDeleteConfirm(null);
    } catch (err) {
      console.error('Error deleting:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveMarkup = async () => {
    if (!selectedProject || !markupForm.name.trim()) return;
    setSaving(true);
    try {
      const markupData = {
        project_id: selectedProject.id,
        name: markupForm.name.trim(),
        value: markupForm.value,
        type: markupForm.type,
        is_nds: markupForm.is_nds,
        sort_order: markups.length
      };
      await supabase.from('estimate_markups').insert(markupData);
      await loadEstimateData();
      setShowMarkupModal(false);
      setMarkupForm({ name: '', value: 0, type: 'percent', is_nds: false });
    } catch (err) {
      console.error('Error saving markup:', err);
    } finally {
      setSaving(false);
    }
  };

  const calculateStageTotals = useCallback((stage: StageWithChildren): { cost: number; costWithMarkup: number } => {
    let cost = 0;
    let costWithMarkup = 0;

    const calculateTaskTotals = (task: TaskWithResources) => {
      task.resources?.forEach(r => {
        cost += r.cost || 0;
        costWithMarkup += r.cost_with_markup || 0;
      });
      task.children?.forEach(calculateTaskTotals);
    };

    stage.tasks?.forEach(calculateTaskTotals);
    stage.children?.forEach(child => {
      const childTotals = calculateStageTotals(child);
      cost += childTotals.cost;
      costWithMarkup += childTotals.costWithMarkup;
    });

    return { cost, costWithMarkup };
  }, []);

  const grandTotal = useMemo(() => {
    let subtotal = 0;
    let subtotalWithMarkup = 0;

    stages.forEach(stage => {
      const totals = calculateStageTotals(stage);
      subtotal += totals.cost;
      subtotalWithMarkup += totals.costWithMarkup;
    });

    let total = subtotalWithMarkup;
    let nds = 0;

    markups.forEach(m => {
      const markupAmount = m.type === 'percent' ? total * (m.value / 100) : m.value;
      if (m.is_nds) {
        nds += markupAmount;
      } else {
        total += markupAmount;
      }
    });

    return { subtotal, subtotalWithMarkup, nds, total: total + nds };
  }, [stages, markups, calculateStageTotals]);

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(value);

  const toggleStageExpand = (stageId: string) => {
    setStages(prev => {
      const toggle = (items: StageWithChildren[]): StageWithChildren[] =>
        items.map(item => ({
          ...item,
          isExpanded: item.id === stageId ? !item.isExpanded : item.isExpanded,
          children: item.children ? toggle(item.children) : undefined
        }));
      return toggle(prev);
    });
  };

  const filteredValuations = useMemo(() => {
    if (!valuationSearch.trim()) return valuations;
    const search = valuationSearch.toLowerCase();
    return valuations.filter(v =>
      v.name.toLowerCase().includes(search) ||
      (v.code && v.code.toLowerCase().includes(search))
    );
  }, [valuations, valuationSearch]);

  // Export to Excel
  const handleExport = async () => {
    // Simple CSV export for now
    let csv = 'Etap;Pozycja;Zasób;Typ;Jednostka;Ilość;Cena;Narzut %;Suma\n';

    stages.forEach(stage => {
      stage.tasks?.forEach(task => {
        task.resources?.forEach(resource => {
          const unit = unitMeasures.find(u => u.id === resource.unit_measure_id);
          csv += `"${stage.name}";"${task.name}";"${resource.name}";"${RESOURCE_TYPE_CONFIG[resource.resource_type].label}";"${unit?.code || ''}";"${resource.volume}";"${resource.price}";"${resource.markup}";"${resource.cost_with_markup}"\n`;
        });
      });
    });

    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `kosztorys_${selectedProject?.name || 'export'}_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };


  // Address search with debounce
  const debouncedCompanyAddressSearch = useCallback(
    createDebouncedSearch(500),
    []
  );

  const debouncedObjectAddressSearch = useCallback(
    createDebouncedSearch(500),
    []
  );

  const handleCompanyStreetChange = (value: string) => {
    setFormData(prev => ({ ...prev, company_street: value }));
    if (value.length >= 3) {
      const searchQuery = formData.company_city
        ? `${value}, ${formData.company_city}`
        : value;
      debouncedCompanyAddressSearch(
        searchQuery,
        (results: OSMAddress[]) => {
          setCompanyAddressSuggestions(results);
          setShowCompanyAddressSuggestions(results.length > 0);
        }
      );
    } else {
      setShowCompanyAddressSuggestions(false);
    }
  };

  const handleObjectStreetChange = (value: string) => {
    setFormData(prev => ({ ...prev, object_street: value }));
    if (value.length >= 3) {
      const searchQuery = formData.object_city
        ? `${value}, ${formData.object_city}`
        : value;
      debouncedObjectAddressSearch(
        searchQuery,
        (results: OSMAddress[]) => {
          setObjectAddressSuggestions(results);
          setShowObjectAddressSuggestions(results.length > 0);
        }
      );
    } else {
      setShowObjectAddressSuggestions(false);
    }
  };

  const selectCompanyAddress = (addr: OSMAddress) => {
    setFormData(prev => ({
      ...prev,
      company_street: addr.street,
      company_street_number: addr.streetNumber,
      company_city: addr.city,
      company_postal_code: addr.postalCode,
      company_country: addr.country || 'Polska'
    }));
    setShowCompanyAddressSuggestions(false);
  };

  const selectObjectAddress = (addr: OSMAddress) => {
    setFormData(prev => ({
      ...prev,
      object_street: addr.street,
      object_street_number: addr.streetNumber,
      object_city: addr.city,
      object_postal_code: addr.postalCode,
      object_country: addr.country || 'Polska'
    }));
    setShowObjectAddressSuggestions(false);
  };

  const loadClientContactsById = async (contractorId: string) => {
    try {
      const { data } = await supabase
        .from('contractor_client_contacts')
        .select('*')
        .eq('client_id', contractorId)
        .order('last_name');
      const contactsList = data || [];
      setClientContacts(contactsList);

      // Auto-select main contact if available
      const mainContact = contactsList.find((c: any) => c.is_main_contact === true);
      if (mainContact) {
        setSelectedContactId(mainContact.id);
        setContacts([{
          first_name: mainContact.first_name || '',
          last_name: mainContact.last_name || '',
          phone: mainContact.phone || '',
          email: mainContact.email || '',
          position: mainContact.position || '',
          is_primary: true
        }]);
        setShowAddContactForm(false);
      }
    } catch (err) {
      console.error('Error loading client contacts:', err);
      setClientContacts([]);
    }
  };

  // Find contractor by NIP or name and load their contacts
  const findAndLoadContacts = async (nip?: string, name?: string) => {
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
          await loadClientContactsById(match.id);
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
          await loadClientContactsById(data[0].id);
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
            await loadClientContactsById(data2[0].id);
            return;
          }
        }
      }

      setClientContacts([]);
    } catch (err) {
      console.error('Error finding contractor:', err);
      setClientContacts([]);
    }
  };

  const lookupContractorByNip = async (nip: string): Promise<{ contractor_id: string; name: string; street: string; streetNumber: string; city: string; postalCode: string; country: string } | null> => {
    if (!currentUser) return null;
    try {
      const rawNip = nip.replace(/\D/g, '');
      // Search in contractors_clients portal table
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

  const selectExistingClient = (client: ExistingClient) => {
    // If client has contractor_id but no NIP, look up NIP from contractor entries
    let nip = client.nip || '';
    if (!nip && client.contractor_id) {
      const contractorEntry = existingClients.find(c => c.contractor_id === client.contractor_id && c.nip);
      if (contractorEntry) nip = contractorEntry.nip || '';
    }

    setFormData(prev => ({
      ...prev,
      client_name: client.client_name,
      nip,
      company_street: client.company_street || '',
      company_street_number: client.company_street_number || '',
      company_city: client.company_city || '',
      company_postal_code: client.company_postal_code || '',
      company_country: client.company_country || 'Polska'
    }));
    setClientSearchQuery('');
    setShowClientDropdown(false);
    // Load contacts for this client
    if (client.contractor_id) {
      loadClientContactsById(client.contractor_id);
    } else if (nip) {
      findAndLoadContacts(nip);
    } else {
      findAndLoadContacts(undefined, client.client_name);
    }
    setSelectedContactId('');
    setShowAddContactForm(false);
    setClientSelected(true);
  };

  const selectExistingContact = (contactId: string) => {
    setSelectedContactId(contactId);
    const contact = clientContacts.find(c => c.id === contactId);
    if (contact) {
      // Set this contact as the first/only contact in the form
      setContacts([{
        first_name: contact.first_name || '',
        last_name: contact.last_name || '',
        phone: contact.phone || '',
        email: contact.email || '',
        position: contact.position || '',
        is_primary: true
      }]);
      setShowAddContactForm(false);
    }
  };

  // Contact management
  const addContact = () => {
    setContacts(prev => [...prev, { ...initialContactData, is_primary: false }]);
  };

  const removeContact = (index: number) => {
    if (contacts.length <= 1) return;
    setContacts(prev => {
      const newContacts = prev.filter((_, i) => i !== index);
      if (prev[index].is_primary && newContacts.length > 0) {
        newContacts[0].is_primary = true;
      }
      return newContacts;
    });
  };

  const updateContact = (index: number, field: keyof ContactFormData, value: string | boolean) => {
    setContacts(prev => {
      const newContacts = [...prev];
      if (field === 'is_primary' && value === true) {
        newContacts.forEach((c, i) => {
          c.is_primary = i === index;
        });
      } else {
        (newContacts[index] as any)[field] = value;
      }
      return newContacts;
    });
  };

  // Generate object code
  const generateObjectCode = (city: string, investmentName: string): string => {
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

  // Auto-generate object code
  useEffect(() => {
    if (formData.investment_name && !editingObjectCode) {
      setFormData(prev => ({
        ...prev,
        object_code: generateObjectCode(prev.object_city, prev.investment_name)
      }));
    }
  }, [formData.investment_name, formData.object_city, editingObjectCode]);

  // GUS API
  const handleFetchGus = async () => {
    if (!formData.nip) {
      setGusError('Wprowadź NIP');
      return;
    }
    if (!validateNip(formData.nip)) {
      setGusError('Nieprawidłowy format NIP');
      return;
    }
    setGusLoading(true);
    setGusError(null);
    setGusSuccess(null);

    try {
      // Step 1: Check local contractor database first
      const localContractor = await lookupContractorByNip(formData.nip);
      if (localContractor) {
        setFormData(prev => ({
          ...prev,
          client_name: localContractor.name,
          company_street: localContractor.street || prev.company_street,
          company_street_number: localContractor.streetNumber || prev.company_street_number,
          company_city: localContractor.city || prev.company_city,
          company_postal_code: localContractor.postalCode || prev.company_postal_code,
          company_country: localContractor.country || 'Polska'
        }));
        await loadClientContactsById(localContractor.contractor_id);
        setGusSuccess('Klient znaleziony w bazie kontrahentów');
        setClientSelected(true);
        setGusLoading(false);
        return;
      }

      // Step 2: Not found locally - fetch from GUS API
      const result = await fetchCompanyByNip(formData.nip);
      if (result.success && result.data) {
        const data = result.data;
        setFormData(prev => ({
          ...prev,
          client_name: data.name || prev.client_name,
          company_street: data.street || prev.company_street,
          company_street_number: data.streetNumber || prev.company_street_number,
          company_city: data.city || prev.company_city,
          company_postal_code: data.postalCode || prev.company_postal_code,
          company_country: data.country || 'Polska'
        }));
        // Load contacts by NIP
        findAndLoadContacts(formData.nip);
      } else if (result.error === 'ALREADY_REGISTERED') {
        // GUS says company exists in system but local lookup missed it - show helpful message
        setGusSuccess('Klient jest już zarejestrowany w systemie. Wybierz go z listy klientów.');
        findAndLoadContacts(formData.nip);
        setClientSelected(true);
      } else {
        setGusError(result.error || 'Nie udało się pobrać danych');
      }
    } catch (err: any) {
      setGusError(err.message || 'Błąd połączenia');
    } finally {
      setGusLoading(false);
    }
  };

  // Save new estimate request
  const handleSaveNewEstimate = async () => {
    if (!currentUser || !formData.client_name.trim() || !formData.investment_name.trim()) return;

    const validContacts = contacts.filter(c => c.first_name.trim() && c.last_name.trim());
    if (validContacts.length === 0) {
      alert('Dodaj przynajmniej jednego przedstawiciela firmy');
      return;
    }

    setSaving(true);
    try {
      const primaryContact = validContacts.find(c => c.is_primary) || validContacts[0];

      const requestFields = {
        client_name: formData.client_name.trim(),
        nip: normalizeNip(formData.nip) || null,
        company_street: formData.company_street.trim() || null,
        company_street_number: formData.company_street_number.trim() || null,
        company_city: formData.company_city.trim() || null,
        company_postal_code: formData.company_postal_code.trim() || null,
        company_country: formData.company_country || 'Polska',
        internal_notes: formData.internal_notes.trim() || null,
        contact_person: `${primaryContact.first_name} ${primaryContact.last_name}`.trim(),
        phone: primaryContact.phone || '',
        email: primaryContact.email || null,
        investment_name: formData.investment_name.trim(),
        object_code: formData.object_code.trim() || null,
        object_type: formData.object_type,
        object_type_id: formData.object_type_id || null,
        object_category_id: formData.object_category_id || null,
        installation_types: formData.installation_types,
        object_street: formData.object_street.trim() || null,
        object_street_number: formData.object_street_number.trim() || null,
        object_city: formData.object_city.trim() || null,
        object_postal_code: formData.object_postal_code.trim() || null,
        object_country: formData.object_country || 'Polska',
        address: [
          formData.object_street,
          formData.object_street_number,
          formData.object_postal_code,
          formData.object_city
        ].filter(Boolean).join(', ') || null,
        main_material_side: formData.main_material_side || null,
        minor_material_side: formData.minor_material_side || null,
        planned_response_date: formData.planned_response_date || null,
        notes: formData.notes.trim() || null,
        request_source: formData.request_source || null,
        assigned_user_id: formData.assigned_user_id || currentUser.id,
      };

      let requestId: string;

      if (editingRequestId) {
        // UPDATE existing request
        const { error } = await supabase
          .from('kosztorys_requests')
          .update(requestFields)
          .eq('id', editingRequestId);

        if (error) throw error;
        requestId = editingRequestId;

        // Delete old contacts and work types, re-insert
        await supabase.from('kosztorys_request_contacts').delete().eq('request_id', requestId);
        await supabase.from('kosztorys_request_work_types').delete().eq('request_id', requestId);
      } else {
        // CREATE new request
        const { count } = await supabase
          .from('kosztorys_requests')
          .select('*', { count: 'exact', head: true })
          .eq('company_id', currentUser.company_id);

        const requestNumber = `ZAP-${new Date().getFullYear()}-${String((count || 0) + 1).padStart(5, '0')}`;

        const { data: newRequest, error } = await supabase
          .from('kosztorys_requests')
          .insert({
            ...requestFields,
            company_id: currentUser.company_id,
            request_number: requestNumber,
            status: 'in_progress',
            created_by_id: currentUser.id
          })
          .select()
          .single();

        if (error || !newRequest) throw error || new Error('Failed to create request');
        requestId = newRequest.id;
      }

      // Save contacts
      if (validContacts.length > 0) {
        const contactsData = validContacts.map(c => ({
          request_id: requestId,
          first_name: c.first_name.trim(),
          last_name: c.last_name.trim(),
          phone: c.phone?.trim() || null,
          email: c.email?.trim() || null,
          position: c.position?.trim() || null,
          is_primary: c.is_primary
        }));
        await supabase.from('kosztorys_request_contacts').insert(contactsData);
      }

      // Save work types
      if (selectedWorkTypes.length > 0) {
        const workTypesData = selectedWorkTypes.map(workTypeId => ({
          request_id: requestId,
          work_type_id: workTypeId
        }));
        await supabase.from('kosztorys_request_work_types').insert(workTypesData);
      }

      // Close modal and reset
      setShowNewEstimateModal(false);
      setFormData(initialFormData);
      setContacts([{ ...initialContactData }]);
      setSelectedWorkTypes([]);
      setGusSuccess(null);
      setClientSelected(false);
      setClientContacts([]);
      setEditingRequestId(null);
      setEditingEstimateId(null);

      if (editingRequestId) {
        // Reload estimates list after edit
        await loadKosztorysEstimates();
      } else {
        // Navigate to formulary for new estimate
        navigate(`/construction/formulary/${requestId}`);
      }
    } catch (err) {
      console.error('Error saving estimate:', err);
      alert('Błąd podczas zapisywania kosztorysu');
    } finally {
      setSaving(false);
    }
  };

  const handleCloseNewEstimateModal = () => {
    setShowNewEstimateModal(false);
    setFormData(initialFormData);
    setContacts([{ ...initialContactData }]);
    setSelectedWorkTypes([]);
    setGusError(null);
    setGusSuccess(null);
    setClientSelected(false);
    setClientContacts([]);
    setShowCompanyAddressSuggestions(false);
    setShowObjectAddressSuggestions(false);
    setShowWorkTypesDropdown(false);
    setClientSearchQuery('');
    setShowClientDropdown(false);
    setEditingObjectCode(false);
    setEditingRequestId(null);
    setEditingEstimateId(null);
  };

  // Open edit modal for existing estimate
  const handleOpenEditModal = async (estimate: any) => {
    if (!estimate?.request?.id) return;

    try {
      // Load full request data
      const { data: request, error } = await supabase
        .from('kosztorys_requests')
        .select(`
          *,
          contacts:kosztorys_request_contacts(*),
          work_types:kosztorys_request_work_types(work_type_id)
        `)
        .eq('id', estimate.request.id)
        .single();

      if (error || !request) {
        console.error('Error loading request for editing:', error);
        return;
      }

      // Pre-fill form data
      setFormData({
        client_name: request.client_name || '',
        nip: request.nip || '',
        company_street: request.company_street || '',
        company_street_number: request.company_street_number || '',
        company_city: request.company_city || '',
        company_postal_code: request.company_postal_code || '',
        company_country: request.company_country || 'Polska',
        internal_notes: request.internal_notes || '',
        contact_person: request.contact_person || '',
        phone: request.phone || '',
        email: request.email || '',
        investment_name: request.investment_name || '',
        object_code: request.object_code || '',
        object_type: request.object_type || 'residential',
        object_type_id: request.object_type_id || '',
        object_category_id: request.object_category_id || '',
        installation_types: request.installation_types || 'IE',
        object_street: request.object_street || '',
        object_street_number: request.object_street_number || '',
        object_city: request.object_city || '',
        object_postal_code: request.object_postal_code || '',
        object_country: request.object_country || 'Polska',
        main_material_side: request.main_material_side || '',
        minor_material_side: request.minor_material_side || '',
        planned_response_date: request.planned_response_date || '',
        notes: request.notes || '',
        request_source: request.request_source || 'email',
        assigned_user_id: request.assigned_user_id || ''
      });

      // Pre-fill contacts
      if (request.contacts && request.contacts.length > 0) {
        setContacts(request.contacts.map((c: any) => ({
          id: c.id,
          first_name: c.first_name || '',
          last_name: c.last_name || '',
          phone: c.phone || '',
          email: c.email || '',
          position: c.position || '',
          is_primary: c.is_primary || false
        })));
        setShowAddContactForm(true);
      }

      // Pre-fill work types
      if (request.work_types && request.work_types.length > 0) {
        setSelectedWorkTypes(request.work_types.map((wt: any) => wt.work_type_id));
      }

      // Set client search query for display
      setClientSearchQuery(request.client_name || '');

      // Set editing state
      setEditingRequestId(request.id);
      setEditingEstimateId(estimate.id);
      setShowEstimateDetailModal(false);
      setShowNewEstimateModal(true);
    } catch (err) {
      console.error('Error opening edit modal:', err);
    }
  };

  // Soft delete/restore estimate
  const openDeleteConfirm = (estimate: any) => {
    setEstimateToDelete(estimate);
    setShowDeleteConfirmModal(true);
  };

  const handleConfirmDelete = async () => {
    if (!estimateToDelete) return;
    try {
      await supabase
        .from('kosztorys_estimates')
        .update({ is_deleted: true })
        .eq('id', estimateToDelete.id);
      await loadKosztorysEstimates();
    } catch (err) {
      console.error('Error deleting estimate:', err);
    } finally {
      setShowDeleteConfirmModal(false);
      setEstimateToDelete(null);
    }
  };

  const handleRestoreEstimate = async (estimateId: string) => {
    try {
      await supabase
        .from('kosztorys_estimates')
        .update({ is_deleted: false })
        .eq('id', estimateId);
      await loadKosztorysEstimates();
    } catch (err) {
      console.error('Error restoring estimate:', err);
    }
  };

  // Filter estimates
  const filteredEstimates = useMemo(() => {
    let filtered = kosztorysEstimates;

    if (search.trim()) {
      const s = search.toLowerCase();
      filtered = filtered.filter(e =>
        e.estimate_number?.toLowerCase().includes(s) ||
        e.request?.investment_name?.toLowerCase().includes(s) ||
        e.request?.client_name?.toLowerCase().includes(s)
      );
    }

    if (clientFilter.trim()) {
      const c = clientFilter.toLowerCase();
      filtered = filtered.filter(e =>
        e.request?.client_name?.toLowerCase().includes(c)
      );
    }

    if (statusFilter !== 'all') {
      filtered = filtered.filter(e => e.status === statusFilter);
    }

    if (valueMinFilter) {
      const min = parseFloat(valueMinFilter);
      if (!isNaN(min)) {
        filtered = filtered.filter(e => (e.total_gross || 0) >= min);
      }
    }

    if (valueMaxFilter) {
      const max = parseFloat(valueMaxFilter);
      if (!isNaN(max)) {
        filtered = filtered.filter(e => (e.total_gross || 0) <= max);
      }
    }

    if (dateFromFilter) {
      const from = new Date(dateFromFilter);
      filtered = filtered.filter(e => new Date(e.created_at) >= from);
    }

    if (dateToFilter) {
      const to = new Date(dateToFilter);
      to.setHours(23, 59, 59, 999);
      filtered = filtered.filter(e => new Date(e.created_at) <= to);
    }

    return filtered;
  }, [kosztorysEstimates, search, clientFilter, statusFilter, valueMinFilter, valueMaxFilter, dateFromFilter, dateToFilter]);

  // Reload when showDeleted changes
  useEffect(() => {
    if (currentUser) {
      loadKosztorysEstimates();
    }
  }, [showDeleted]);

  // Project selection view
  if (!selectedProject) {
    return (
      <div className="p-6">

        {/* Main Navigation Tabs */}
        <div className="flex gap-1 mb-6 bg-slate-100 p-1 rounded-lg w-fit">
          <button
            onClick={() => setActiveMainTab('estimates')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition flex items-center gap-2 ${
              activeMainTab === 'estimates'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Calculator className="w-4 h-4" />
            Kosztorysy
          </button>
          <button
            onClick={() => { setActiveMainTab('requests'); loadRequests(); }}
            className={`px-4 py-2 rounded-md text-sm font-medium transition flex items-center gap-2 ${
              activeMainTab === 'requests'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Inbox className="w-4 h-4" />
            Zapytania
            {newRequestsCount > 0 && (
              <span className="px-1.5 py-0.5 text-xs font-bold text-white bg-red-500 rounded-full">
                {newRequestsCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveMainTab('dictionaries')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition flex items-center gap-2 ${
              activeMainTab === 'dictionaries'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            Kartoteka
          </button>
        </div>

        {/* Estimates Tab */}
        {activeMainTab === 'estimates' && (
          <>
            {/* Search and actions */}
            <div className="mb-4 flex flex-wrap gap-3 items-center">
              <div className="relative flex-1 min-w-[250px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Szukaj kosztorysu..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border transition ${
                  showFilters || clientFilter || statusFilter !== 'all' || valueMinFilter || valueMaxFilter || dateFromFilter || dateToFilter || showDeleted
                    ? 'bg-blue-50 border-blue-200 text-blue-700'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Filter className="w-4 h-4" />
                Filtry
                {showDeleted && <span className="px-1.5 py-0.5 text-xs bg-red-100 text-red-700 rounded">usunięte</span>}
              </button>

              <button
                onClick={() => setShowNewEstimateModal(true)}
                className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition"
              >
                <Plus className="w-4 h-4" />
                Nowy kosztorys
              </button>
            </div>

            {/* Filters panel */}
            {showFilters && (
              <div className="mb-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Klient</label>
                    <input
                      type="text"
                      value={clientFilter}
                      onChange={e => setClientFilter(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                      placeholder="Nazwa klienta..."
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                    <select
                      value={statusFilter}
                      onChange={e => setStatusFilter(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                    >
                      <option value="all">Wszystkie</option>
                      <option value="draft">Wersja robocza</option>
                      <option value="pending_approval">Do akceptacji</option>
                      <option value="approved">Zaakceptowany</option>
                      <option value="rejected">Odrzucony</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Wartość od</label>
                    <input
                      type="number"
                      value={valueMinFilter}
                      onChange={e => setValueMinFilter(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Wartość do</label>
                    <input
                      type="number"
                      value={valueMaxFilter}
                      onChange={e => setValueMaxFilter(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                      placeholder="1000000"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Data od</label>
                    <input
                      type="date"
                      value={dateFromFilter}
                      onChange={e => setDateFromFilter(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Data do</label>
                    <input
                      type="date"
                      value={dateToFilter}
                      onChange={e => setDateToFilter(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                    />
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showDeleted}
                      onChange={e => setShowDeleted(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-red-600"
                    />
                    <span className={showDeleted ? 'text-red-600 font-medium' : ''}>
                      Pokaż usunięte kosztorysy
                    </span>
                  </label>
                  <button
                    onClick={() => {
                      setClientFilter('');
                      setStatusFilter('all');
                      setValueMinFilter('');
                      setValueMaxFilter('');
                      setDateFromFilter('');
                      setDateToFilter('');
                      setShowDeleted(false);
                    }}
                    className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900"
                  >
                    Wyczyść filtry
                  </button>
                </div>
              </div>
            )}

            {kosztorysLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
              </div>
            ) : filteredEstimates.length === 0 ? (
              <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
                <Calculator className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                <p className="text-slate-500 mb-4">
                  {kosztorysEstimates.length === 0
                    ? 'Brak kosztorysów. Utwórz nowy kosztorys lub wygeneruj z zapytania.'
                    : 'Brak kosztorysów pasujących do kryteriów wyszukiwania.'}
                </p>
                {kosztorysEstimates.length === 0 && (
                  <button
                    onClick={() => setShowNewEstimateModal(true)}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                  >
                    Nowy kosztorys
                  </button>
                )}
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Nr</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Inwestycja</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Klient</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Status</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Netto</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Brutto</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Data</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-slate-500 uppercase">Akcje</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {filteredEstimates.map(estimate => (
                      <tr
                        key={estimate.id}
                        className="hover:bg-slate-50 cursor-pointer"
                        onClick={() => navigate(`/construction/kosztorys/${estimate.id}`)}
                      >
                        <td className="px-4 py-3 text-sm font-medium text-slate-900">{estimate.estimate_number}</td>
                        <td className="px-4 py-3 text-sm text-slate-700">{estimate.request?.investment_name || '-'}</td>
                        <td className="px-4 py-3 text-sm text-slate-600">{estimate.request?.client_name || '-'}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                            estimate.status === 'approved' ? 'bg-green-100 text-green-700' :
                            estimate.status === 'pending_approval' ? 'bg-yellow-100 text-yellow-700' :
                            estimate.status === 'rejected' ? 'bg-red-100 text-red-700' :
                            'bg-slate-100 text-slate-600'
                          }`}>
                            {estimate.status === 'draft' ? 'Wersja robocza' :
                             estimate.status === 'pending_approval' ? 'Do akceptacji' :
                             estimate.status === 'approved' ? 'Zaakceptowany' :
                             estimate.status === 'rejected' ? 'Odrzucony' : estimate.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-900 text-right">
                          {(estimate.subtotal_net || 0).toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' })}
                        </td>
                        <td className="px-4 py-3 text-sm font-medium text-slate-900 text-right">
                          {(estimate.total_gross || 0).toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' })}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-500">
                          {new Date(estimate.created_at).toLocaleDateString('pl-PL')}
                        </td>
                        <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                          {showDeleted ? (
                            <button
                              onClick={() => handleRestoreEstimate(estimate.id)}
                              className="p-1.5 text-green-600 hover:bg-green-50 rounded"
                              title="Przywróć"
                            >
                              <RotateCcw className="w-4 h-4" />
                            </button>
                          ) : (
                            <div className="flex items-center justify-center gap-1">
                              <button
                                onClick={() => handleOpenEditModal(estimate)}
                                className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                                title="Edytuj"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => openDeleteConfirm(estimate)}
                                className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded"
                                title="Usuń"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* Requests Tab - inline content from RequestsPage */}
        {activeMainTab === 'requests' && (
          <div className="-m-6">
            <RequestsPage />
          </div>
        )}

        {/* Dictionaries Tab */}
        {activeMainTab === 'dictionaries' && (
          <div className="-m-6">
            <DictionariesPage />
          </div>
        )}

        {/* Price Lists Tab - removed */}

        {/* New Estimate Modal */}
        {showNewEstimateModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
              <div className="p-6 border-b border-slate-200 flex justify-between items-center">
                <h2 className="text-xl font-bold text-slate-900">{editingRequestId ? 'Edytuj kosztorys' : 'Nowy kosztorys'}</h2>
                <button onClick={handleCloseNewEstimateModal} className="p-2 hover:bg-slate-100 rounded-lg">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 overflow-y-auto flex-1 space-y-6">
                {/* 1. Client info */}
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
                        value={formData.nip}
                        onChange={e => {
                          setFormData(prev => ({ ...prev, nip: e.target.value }));
                          setGusError(null);
                          setGusSuccess(null);
                        }}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                        placeholder="XXX-XXX-XX-XX"
                      />
                    </div>
                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={handleFetchGus}
                        disabled={gusLoading || !formData.nip}
                        className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
                      >
                        {gusLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                        Pobierz z GUS
                      </button>
                    </div>
                  </div>
                  {gusError && (
                    <p className="text-sm text-red-600">{gusError}</p>
                  )}
                  {gusSuccess && (
                    <p className="text-sm text-green-600">{gusSuccess}</p>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2 relative">
                      <label className="block text-sm font-medium text-slate-700 mb-1">Nazwa firmy *</label>
                      <input
                        type="text"
                        value={formData.client_name}
                        onChange={e => {
                          setFormData(prev => ({ ...prev, client_name: e.target.value }));
                          setClientSearchQuery(e.target.value);
                        }}
                        onFocus={() => {
                          if (formData.client_name.length >= 2) {
                            setClientSearchQuery(formData.client_name);
                          }
                        }}
                        onBlur={() => {
                          setTimeout(() => setShowClientDropdown(false), 200);
                        }}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                        placeholder="Wyszukaj istniejącego lub wpisz nową nazwę..."
                      />
                      {showClientDropdown && (
                        <div className="absolute z-20 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                          {filteredClients.length > 0 ? (
                            <>
                              {filteredClients.some(c => c.source === 'contractor') && (
                                <div className="px-3 py-2 text-xs font-bold text-slate-700 bg-slate-50 border-b">
                                  Kontrahenci z bazy
                                </div>
                              )}
                              {filteredClients.filter(c => c.source === 'contractor').map((client, i) => (
                                <button
                                  key={`c-${i}`}
                                  type="button"
                                  onClick={() => selectExistingClient(client)}
                                  className="w-full px-3 py-2 text-left hover:bg-blue-50 border-b border-slate-100 last:border-0"
                                >
                                  <div className="font-medium text-slate-900">{client.client_name}</div>
                                  <div className="text-xs text-slate-500 flex gap-2">
                                    {client.nip && <span>NIP: {client.nip}</span>}
                                    {client.company_city && <span>{client.company_city}</span>}
                                  </div>
                                </button>
                              ))}
                              {filteredClients.some(c => c.source === 'request_history') && (
                                <div className="px-3 py-2 text-xs font-semibold text-slate-400 bg-slate-50 border-b border-t">
                                  Z historii zapytań
                                </div>
                              )}
                              {filteredClients.filter(c => c.source === 'request_history').map((client, i) => (
                                <button
                                  key={`h-${i}`}
                                  type="button"
                                  onClick={() => selectExistingClient(client)}
                                  className="w-full px-3 py-2 text-left hover:bg-blue-50 border-b border-slate-100 last:border-0 opacity-75"
                                >
                                  <div className="font-medium text-slate-900">{client.client_name}</div>
                                  <div className="text-xs text-slate-500 flex gap-2">
                                    {client.nip && <span>NIP: {client.nip}</span>}
                                    {client.company_city && <span>{client.company_city}</span>}
                                  </div>
                                </button>
                              ))}
                            </>
                          ) : clientSearchQuery.length >= 2 && (
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
                        value={formData.company_street}
                        onChange={e => handleCompanyStreetChange(e.target.value)}
                        onFocus={() => companyAddressSuggestions.length > 0 && setShowCompanyAddressSuggestions(true)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                        placeholder="ul. Przykładowa"
                      />
                      {showCompanyAddressSuggestions && companyAddressSuggestions.length > 0 && (
                        <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                          {companyAddressSuggestions.map((addr, i) => (
                            <button
                              key={i}
                              type="button"
                              onClick={() => selectCompanyAddress(addr)}
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
                        value={formData.company_street_number}
                        onChange={e => setFormData(prev => ({ ...prev, company_street_number: e.target.value }))}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                        placeholder="12A"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Kod pocztowy</label>
                      <input
                        type="text"
                        value={formData.company_postal_code}
                        onChange={e => setFormData(prev => ({ ...prev, company_postal_code: e.target.value }))}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                        placeholder="00-000"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-sm font-medium text-slate-700 mb-1">Miasto</label>
                      <input
                        type="text"
                        value={formData.company_city}
                        onChange={e => setFormData(prev => ({ ...prev, company_city: e.target.value }))}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                        placeholder="Warszawa"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-sm font-medium text-slate-700 mb-1">Źródło zapytania</label>
                      <select
                        value={formData.request_source}
                        onChange={e => setFormData(prev => ({ ...prev, request_source: e.target.value as KosztorysRequestSource }))}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                      >
                        {Object.entries(SOURCE_LABELS).map(([key, label]) => (
                          <option key={key} value={key}>{label}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Notatka wewnętrzna</label>
                    <textarea
                      value={formData.internal_notes}
                      onChange={e => setFormData(prev => ({ ...prev, internal_notes: e.target.value }))}
                      rows={2}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="Notatki widoczne tylko dla zespołu..."
                    />
                  </div>
                </div>

                {/* 2. Representatives */}
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                      <User className="w-5 h-5 text-slate-400" />
                      Przedstawiciele firmy
                    </h3>
                    <button
                      type="button"
                      onClick={() => {
                        if (!showAddContactForm) {
                          // Only add new empty contact if contacts array is completely empty
                          if (contacts.length === 0) {
                            addContact();
                          }
                        }
                        setShowAddContactForm(!showAddContactForm);
                      }}
                      className="flex items-center gap-1 px-3 py-1.5 text-sm bg-slate-100 hover:bg-slate-200 rounded-lg"
                    >
                      <UserPlus className="w-4 h-4" />
                      Dodaj
                    </button>
                  </div>

                  {/* Dropdown to select existing contact */}
                  {clientContacts.length > 0 && (
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Wybierz istniejącego przedstawiciela</label>
                      <select
                        value={selectedContactId}
                        onChange={e => selectExistingContact(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
                      >
                        <option value="">— Wybierz z listy —</option>
                        {clientContacts.map(c => (
                          <option key={c.id} value={c.id}>
                            {c.is_main_contact ? '★ ' : ''}{c.first_name} {c.last_name}{c.position ? ` — ${c.position}` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* No representatives info */}
                  {clientSelected && clientContacts.length === 0 && !showAddContactForm && (
                    <p className="text-sm text-slate-500 italic">Brak przedstawicieli w bazie dla tego klienta. Kliknij "Dodaj" aby dodać.</p>
                  )}

                  {/* Manual add contact form - shown only when "Dodaj" is clicked */}
                  {showAddContactForm && (
                    <div className="space-y-4">
                      {contacts.map((contact, index) => (
                        <div key={index} className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                          <div className="flex justify-between items-start mb-3">
                            <div className="flex items-center gap-2">
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={contact.is_primary}
                                  onChange={() => updateContact(index, 'is_primary', true)}
                                  className="w-4 h-4 text-blue-600 rounded"
                                />
                                <span className="text-sm font-medium text-slate-700 flex items-center gap-1">
                                  {contact.is_primary && <Star className="w-4 h-4 text-amber-500" />}
                                  Główny kontakt
                                </span>
                              </label>
                            </div>
                            {contacts.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeContact(index)}
                                className="p-1 text-red-500 hover:bg-red-50 rounded"
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
                                onChange={e => updateContact(index, 'first_name', e.target.value)}
                                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                                placeholder="Jan"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">Nazwisko *</label>
                              <input
                                type="text"
                                value={contact.last_name}
                                onChange={e => updateContact(index, 'last_name', e.target.value)}
                                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                                placeholder="Kowalski"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">Telefon</label>
                              <input
                                type="tel"
                                value={contact.phone}
                                onChange={e => updateContact(index, 'phone', formatPhoneNumber(e.target.value))}
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
                                onChange={e => updateContact(index, 'position', e.target.value)}
                                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                                placeholder="Kierownik projektu"
                              />
                            </div>
                            <div className="col-span-2">
                              <label className="block text-xs font-medium text-slate-600 mb-1">E-mail</label>
                              <input
                                type="email"
                                value={contact.email}
                                onChange={e => updateContact(index, 'email', e.target.value)}
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
                        onClick={() => addContact()}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs text-blue-600 hover:bg-blue-50 rounded-lg"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Dodaj kolejny kontakt
                      </button>
                    </div>
                  )}

                  {/* Show selected contact summary if selected from dropdown and form is hidden */}
                  {!showAddContactForm && selectedContactId && contacts.length > 0 && contacts[0].first_name && (
                    <div className="p-3 bg-blue-50 rounded-lg border border-blue-200 text-sm">
                      <span className="font-medium text-blue-800">{contacts[0].first_name} {contacts[0].last_name}</span>
                      {contacts[0].position && <span className="text-blue-600 ml-2">({contacts[0].position})</span>}
                      {contacts[0].phone && <span className="text-blue-600 ml-2">{contacts[0].phone}</span>}
                    </div>
                  )}
                </div>

                {/* 3. Object info */}
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
                        value={formData.investment_name}
                        onChange={e => setFormData(prev => ({ ...prev, investment_name: e.target.value }))}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                        placeholder="np. Osiedle Słoneczne - Etap II"
                      />
                    </div>
                    <div className="col-span-1">
                      <label className="block text-sm font-medium text-slate-700 mb-1">Kod obiektu</label>
                      <div className="flex gap-1">
                        <input
                          type="text"
                          value={formData.object_code}
                          onChange={e => setFormData(prev => ({ ...prev, object_code: e.target.value }))}
                          disabled={!editingObjectCode}
                          className="w-full px-2 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 font-mono"
                          placeholder="WC26"
                        />
                        <button
                          type="button"
                          onClick={() => setEditingObjectCode(!editingObjectCode)}
                          className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg flex-shrink-0"
                          title={editingObjectCode ? 'Auto-generuj' : 'Edytuj ręcznie'}
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
                            onClick={() => setShowWorkTypesDropdown(!showWorkTypesDropdown)}
                            className="flex-1 px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white text-left flex items-center justify-between"
                          >
                            <span className={selectedWorkTypes.length === 0 ? 'text-slate-400' : 'text-slate-900'}>
                              {selectedWorkTypes.length === 0
                                ? 'Wybierz rodzaj prac...'
                                : workTypes
                                    .filter(wt => selectedWorkTypes.includes(wt.id))
                                    .map(wt => wt.code)
                                    .join(', ')}
                            </span>
                            <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${showWorkTypesDropdown ? 'rotate-180' : ''}`} />
                          </button>
                          <button
                            type="button"
                            onClick={() => { setShowAddWorkType(true); setShowWorkTypesDropdown(false); }}
                            className="px-2 py-2 text-blue-600 border border-blue-200 bg-blue-50 rounded-lg hover:bg-blue-100 flex-shrink-0"
                            title="Dodaj nowy rodzaj prac"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                        {showWorkTypesDropdown && (
                          <div className="absolute z-20 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg py-1">
                            {workTypes.map(wt => (
                              <label
                                key={wt.id}
                                className="flex items-center px-3 py-2 hover:bg-slate-50 cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedWorkTypes.includes(wt.id)}
                                  onChange={e => {
                                    if (e.target.checked) {
                                      setSelectedWorkTypes(prev => [...prev, wt.id]);
                                    } else {
                                      setSelectedWorkTypes(prev => prev.filter(id => id !== wt.id));
                                    }
                                  }}
                                  className="mr-3 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                />
                                <span className="text-sm text-slate-700">{wt.name}</span>
                              </label>
                            ))}
                            {workTypes.length === 0 && (
                              <div className="px-3 py-2 text-sm text-slate-500">Brak typów prac</div>
                            )}
                          </div>
                        )}
                        {showAddWorkType && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            <input
                              type="text"
                              value={newWorkTypeCode}
                              onChange={e => setNewWorkTypeCode(e.target.value.toUpperCase())}
                              placeholder="Kod (np. IE)"
                              className="w-16 px-2 py-1.5 border border-slate-200 rounded-lg text-sm"
                              autoFocus
                            />
                            <input
                              type="text"
                              value={newWorkTypeName}
                              onChange={e => setNewWorkTypeName(e.target.value)}
                              placeholder="Nazwa (np. Elektryka)"
                              className="flex-1 min-w-[120px] px-2 py-1.5 border border-slate-200 rounded-lg text-sm"
                              onKeyDown={async e => {
                                if (e.key === 'Enter' && newWorkTypeCode.trim() && newWorkTypeName.trim()) {
                                  const fullName = `${newWorkTypeCode.trim()} - ${newWorkTypeName.trim()}`;
                                  const { data } = await supabase.from('kosztorys_work_types').insert({
                                    code: newWorkTypeCode.trim(),
                                    name: fullName,
                                    category: newWorkTypeCode.trim(),
                                    company_id: currentUser?.company_id,
                                    is_active: true
                                  }).select('id, code, name').single();
                                  if (data) {
                                    setWorkTypes(prev => [...prev, data]);
                                    setSelectedWorkTypes(prev => [...prev, data.id]);
                                  }
                                  setNewWorkTypeCode('');
                                  setNewWorkTypeName('');
                                  setShowAddWorkType(false);
                                }
                                if (e.key === 'Escape') { setShowAddWorkType(false); setNewWorkTypeCode(''); setNewWorkTypeName(''); }
                              }}
                            />
                            <button
                              onClick={async () => {
                                if (newWorkTypeCode.trim() && newWorkTypeName.trim()) {
                                  const fullName = `${newWorkTypeCode.trim()} - ${newWorkTypeName.trim()}`;
                                  const { data } = await supabase.from('kosztorys_work_types').insert({
                                    code: newWorkTypeCode.trim(),
                                    name: fullName,
                                    category: newWorkTypeCode.trim(),
                                    company_id: currentUser?.company_id,
                                    is_active: true
                                  }).select('id, code, name').single();
                                  if (data) {
                                    setWorkTypes(prev => [...prev, data]);
                                    setSelectedWorkTypes(prev => [...prev, data.id]);
                                  }
                                }
                                setNewWorkTypeCode('');
                                setNewWorkTypeName('');
                                setShowAddWorkType(false);
                              }}
                              className="px-2 py-1.5 bg-blue-600 text-white rounded-lg text-xs"
                            >OK</button>
                            <button
                              onClick={() => { setShowAddWorkType(false); setNewWorkTypeCode(''); setNewWorkTypeName(''); }}
                              className="px-2 py-1.5 text-slate-600 border border-slate-200 rounded-lg text-xs"
                            >&#10005;</button>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="col-span-6">
                      <label className="block text-sm font-medium text-slate-700 mb-1">Typ obiektu</label>
                      <select
                        value={formData.object_category_id}
                        onChange={e => setFormData(prev => ({ ...prev, object_category_id: e.target.value }))}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">-- Wybierz (opcjonalnie) --</option>
                        {objectCategories.map((c: any) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Object address */}
                  <div className="grid grid-cols-4 gap-4">
                    <div className="col-span-2 relative">
                      <label className="block text-sm font-medium text-slate-700 mb-1">Ulica</label>
                      <input
                        type="text"
                        value={formData.object_street}
                        onChange={e => handleObjectStreetChange(e.target.value)}
                        onFocus={() => objectAddressSuggestions.length > 0 && setShowObjectAddressSuggestions(true)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                        placeholder="ul. Budowlana"
                      />
                      {showObjectAddressSuggestions && objectAddressSuggestions.length > 0 && (
                        <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                          {objectAddressSuggestions.map((addr, i) => (
                            <button
                              key={i}
                              type="button"
                              onClick={() => selectObjectAddress(addr)}
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
                        value={formData.object_street_number}
                        onChange={e => setFormData(prev => ({ ...prev, object_street_number: e.target.value }))}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                        placeholder="1"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Kod pocztowy</label>
                      <input
                        type="text"
                        value={formData.object_postal_code}
                        onChange={e => setFormData(prev => ({ ...prev, object_postal_code: e.target.value }))}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                        placeholder="00-000"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-sm font-medium text-slate-700 mb-1">Miasto</label>
                      <input
                        type="text"
                        value={formData.object_city}
                        onChange={e => setFormData(prev => ({ ...prev, object_city: e.target.value }))}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                        placeholder="Warszawa"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-sm font-medium text-slate-700 mb-1">Kraj</label>
                      <input
                        type="text"
                        value={formData.object_country}
                        onChange={e => setFormData(prev => ({ ...prev, object_country: e.target.value }))}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                        placeholder="Polska"
                      />
                    </div>
                  </div>
                </div>

                {/* 4. Materials */}
                <div className="space-y-4">
                  <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                    <FileText className="w-5 h-5 text-slate-400" />
                    Materiały
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Materiał Główny</label>
                      <select
                        value={formData.main_material_side}
                        onChange={e => setFormData(prev => ({ ...prev, main_material_side: e.target.value }))}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">-- Wybierz --</option>
                        <option value="investor">Po stronie Inwestora</option>
                        <option value="client">Po stronie {formData.client_name || 'Klienta'}</option>
                        <option value="company">Po stronie Firmy</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Materiał Drobny</label>
                      <select
                        value={formData.minor_material_side}
                        onChange={e => setFormData(prev => ({ ...prev, minor_material_side: e.target.value }))}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">-- Wybierz --</option>
                        <option value="investor">Po stronie Inwestora</option>
                        <option value="client">Po stronie {formData.client_name || 'Klienta'}</option>
                        <option value="company">Po stronie Firmy</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* 5. Assignment */}
                <div className="space-y-4">
                  <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                    <Briefcase className="w-5 h-5 text-slate-400" />
                    Odpowiedzialny
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Odpowiedzialny</label>
                      <select
                        value={formData.assigned_user_id}
                        onChange={e => setFormData(prev => ({ ...prev, assigned_user_id: e.target.value }))}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">-- Wybierz --</option>
                        {users.map(user => (
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
                        value={formData.planned_response_date}
                        onChange={e => setFormData(prev => ({ ...prev, planned_response_date: e.target.value }))}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                        min={new Date().toISOString().split('T')[0]}
                      />
                    </div>
                  </div>
                </div>

                {/* 6. Notes */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Uwagi od klienta</label>
                  <textarea
                    value={formData.notes}
                    onChange={e => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                    rows={3}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="Dodatkowe informacje od klienta..."
                  />
                </div>
              </div>

              <div className="p-6 border-t border-slate-200 flex justify-end gap-3">
                <button
                  onClick={handleCloseNewEstimateModal}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Anuluj
                </button>
                <button
                  onClick={handleSaveNewEstimate}
                  disabled={saving || !formData.client_name.trim() || !formData.investment_name.trim()}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  {editingRequestId ? 'Zapisz zmiany' : 'Utwórz Kosztorys'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {showDeleteConfirmModal && estimateToDelete && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70] p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
              <div className="p-6">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                    <Trash2 className="w-6 h-6 text-red-600" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">Usunąć kosztorys?</h3>
                    <p className="text-sm text-slate-500">Ta operacja przeniesie kosztorys do usuniętych</p>
                  </div>
                </div>
                <div className="bg-slate-50 rounded-lg p-3 mb-4">
                  <p className="text-sm font-medium text-slate-900">{estimateToDelete.estimate_number}</p>
                  <p className="text-sm text-slate-600">{estimateToDelete.request?.investment_name}</p>
                  <p className="text-sm text-slate-500">{estimateToDelete.request?.client_name}</p>
                </div>
                <p className="text-sm text-slate-600">
                  Kosztorys będzie można przywrócić z poziomu filtrów, zaznaczając opcję "Pokaż usunięte kosztorysy".
                </p>
              </div>
              <div className="p-4 bg-slate-50 flex justify-end gap-3">
                <button
                  onClick={() => {
                    setShowDeleteConfirmModal(false);
                    setEstimateToDelete(null);
                  }}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg transition"
                >
                  Anuluj
                </button>
                <button
                  onClick={handleConfirmDelete}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
                >
                  Usuń kosztorys
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Estimate detail view
  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* Header */}
      <div className="p-4 bg-white border-b border-slate-200 shadow-sm">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setSelectedProject(null)}
            className="p-2 hover:bg-slate-100 rounded-lg transition"
          >
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-slate-900">{selectedProject.name}</h1>
            <p className="text-sm text-slate-500">Kosztorys projektu</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowValuationPanel(!showValuationPanel)}
              className={`p-2 rounded-lg transition ${showValuationPanel ? 'bg-blue-100 text-blue-600' : 'hover:bg-slate-100 text-slate-600'}`}
              title="Cennik"
            >
              <FileText className="w-5 h-5" />
            </button>
            <button
              onClick={() => setShowMarkupModal(true)}
              className="p-2 hover:bg-slate-100 rounded-lg transition text-slate-600"
              title="Dodaj narzut"
            >
              <Percent className="w-5 h-5" />
            </button>
            <button
              onClick={handleExport}
              className="p-2 hover:bg-slate-100 rounded-lg transition text-slate-600"
              title="Eksport CSV"
            >
              <Download className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Main content */}
        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            </div>
          ) : (
            <>
              {/* Action bar */}
              <div className="mb-4 flex flex-wrap gap-2 items-center">
                <button
                  onClick={() => {
                    setEditingStage(null);
                    setParentStageId(null);
                    setStageForm({ name: '', code: '' });
                    setShowStageModal(true);
                  }}
                  className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm"
                >
                  <Plus className="w-4 h-4" />
                  Dodaj etap
                </button>
                <div className="flex-1" />
                <div className="text-sm text-slate-500">
                  {stages.length} etapów • {grandTotal.subtotal > 0 ? formatCurrency(grandTotal.total) : '0 PLN'}
                </div>
              </div>

              {stages.length === 0 ? (
                <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
                  <FolderOpen className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                  <p className="text-slate-500 mb-4">Brak etapów w kosztorysie</p>
                  <button
                    onClick={() => {
                      setEditingStage(null);
                      setParentStageId(null);
                      setStageForm({ name: '', code: '' });
                      setShowStageModal(true);
                    }}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                  >
                    Utwórz pierwszy etap
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {stages.map(stage => (
                    <StageCard
                      key={stage.id}
                      stage={stage}
                      level={0}
                      onToggle={toggleStageExpand}
                      onEditStage={(s) => {
                        setEditingStage(s);
                        setStageForm({ name: s.name, code: s.code || '' });
                        setShowStageModal(true);
                      }}
                      onDeleteStage={(s) => setShowDeleteConfirm({ type: 'stage', id: s.id, name: s.name })}
                      onAddTask={(stageId) => {
                        setCurrentStageId(stageId);
                        setEditingTask(null);
                        setTaskForm({ name: '', code: '', volume: 1, unit_measure_id: 0, is_group: false });
                        setShowTaskModal(true);
                      }}
                      onEditTask={(t) => {
                        setEditingTask(t);
                        setCurrentStageId(t.stage_id);
                        setTaskForm({
                          name: t.name,
                          code: t.code || '',
                          volume: t.volume,
                          unit_measure_id: t.unit_measure_id || 0,
                          is_group: t.is_group
                        });
                        setShowTaskModal(true);
                      }}
                      onDeleteTask={(t) => setShowDeleteConfirm({ type: 'task', id: t.id, name: t.name })}
                      onAddResource={(taskId) => {
                        setCurrentTaskId(taskId);
                        setEditingResource(null);
                        setResourceForm({ name: '', code: '', resource_type: 'material', unit_measure_id: 0, volume: 1, price: 0, markup: 15, url: '' });
                        setShowResourceModal(true);
                      }}
                      onEditResource={(r) => {
                        setEditingResource(r);
                        setCurrentTaskId(r.task_id);
                        setResourceForm({
                          name: r.name,
                          code: r.code || '',
                          resource_type: r.resource_type,
                          unit_measure_id: r.unit_measure_id || 0,
                          volume: r.volume,
                          price: r.price,
                          markup: r.markup,
                          url: r.url || ''
                        });
                        setShowResourceModal(true);
                      }}
                      onDeleteResource={(r) => setShowDeleteConfirm({ type: 'resource', id: r.id, name: r.name })}
                      onUpdateResource={handleUpdateResource}
                      onSelectTask={(taskId) => setCurrentTaskId(taskId)}
                      selectedTaskId={currentTaskId}
                      calculateStageTotals={calculateStageTotals}
                      formatCurrency={formatCurrency}
                      unitMeasures={unitMeasures}
                    />
                  ))}
                </div>
              )}

              {/* Totals panel */}
              {stages.length > 0 && (
                <div className="mt-6 p-5 bg-white rounded-xl border border-slate-200 shadow-sm">
                  <h3 className="font-semibold text-slate-900 mb-4">Podsumowanie kosztorysu</h3>

                  <div className="space-y-2 mb-4">
                    <div className="flex justify-between">
                      <span className="text-slate-600">Suma kosztów:</span>
                      <span className="font-medium">{formatCurrency(grandTotal.subtotal)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">Z narzutami pozycji:</span>
                      <span className="font-medium">{formatCurrency(grandTotal.subtotalWithMarkup)}</span>
                    </div>

                    {markups.length > 0 && (
                      <div className="pt-2 border-t border-slate-100">
                        {markups.map(m => (
                          <div key={m.id} className="flex justify-between items-center py-1">
                            <div className="flex items-center gap-2">
                              <span className="text-slate-600">{m.name}</span>
                              <button
                                onClick={async () => {
                                  await supabase.from('estimate_markups').delete().eq('id', m.id);
                                  await loadEstimateData();
                                }}
                                className="p-1 hover:bg-red-100 rounded text-red-500"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                            <span className="font-medium">
                              {m.type === 'percent' ? `${m.value}%` : formatCurrency(m.value)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {grandTotal.nds > 0 && (
                      <div className="flex justify-between pt-2 border-t border-slate-100">
                        <span className="text-slate-600">VAT:</span>
                        <span className="font-medium">{formatCurrency(grandTotal.nds)}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-between items-center pt-3 border-t-2 border-slate-200">
                    <span className="text-lg font-semibold text-slate-900">RAZEM:</span>
                    <span className="text-2xl font-bold text-blue-600">{formatCurrency(grandTotal.total)}</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Valuation sidebar */}
        {showValuationPanel && (
          <div className="w-80 border-l border-slate-200 bg-white overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-200 flex justify-between items-center">
              <h3 className="font-semibold text-slate-900">Cennik</h3>
              <button
                onClick={() => setShowValuationPanel(false)}
                className="p-1 hover:bg-slate-100 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-3 border-b border-slate-100">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Szukaj wyceny..."
                  value={valuationSearch}
                  onChange={e => setValuationSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              {currentTaskId && (
                <p className="text-xs text-green-600 mt-2">
                  ✓ Kliknij pozycję, aby dodać do wybranej pracy
                </p>
              )}
              {!currentTaskId && (
                <p className="text-xs text-amber-600 mt-2">
                  ⚠ Wybierz najpierw pracę w kosztorysie
                </p>
              )}
            </div>
            <div className="flex-1 overflow-auto p-2">
              {filteredValuations.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-sm">
                  Brak wycen w cenniku
                </div>
              ) : (
                <div className="space-y-1">
                  {filteredValuations.map(val => {
                    const config = RESOURCE_TYPE_CONFIG[val.resource_type];
                    const Icon = config.icon;
                    return (
                      <button
                        key={val.id}
                        onClick={() => handleAddFromValuation(val)}
                        disabled={!currentTaskId}
                        className={`w-full text-left p-2 rounded-lg border transition ${
                          currentTaskId
                            ? 'border-slate-200 hover:border-blue-300 hover:bg-blue-50'
                            : 'border-slate-100 opacity-50 cursor-not-allowed'
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <div className={`p-1 rounded ${config.bgColor}`}>
                            <Icon className={`w-3 h-3 ${config.color}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-700 truncate">{val.name}</p>
                            <p className="text-xs text-slate-500">
                              {val.code && <span className="mr-2">{val.code}</span>}
                              {formatCurrency(val.price)}
                            </p>
                          </div>
                          <Plus className="w-4 h-4 text-slate-400" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Stage Modal */}
      {showStageModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="p-4 border-b border-slate-200 flex justify-between items-center">
              <h3 className="font-semibold text-slate-900">
                {editingStage ? 'Edytuj etap' : 'Nowy etap'}
              </h3>
              <button onClick={() => setShowStageModal(false)} className="p-1 hover:bg-slate-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nazwa etapu *</label>
                <input
                  type="text"
                  value={stageForm.name}
                  onChange={e => setStageForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="np. Elektryka"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Kod</label>
                <input
                  type="text"
                  value={stageForm.code}
                  onChange={e => setStageForm(prev => ({ ...prev, code: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="np. E01"
                />
              </div>
            </div>
            <div className="p-4 border-t border-slate-200 flex justify-end gap-2">
              <button
                onClick={() => setShowStageModal(false)}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Anuluj
              </button>
              <button
                onClick={handleSaveStage}
                disabled={saving || !stageForm.name.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingStage ? 'Zapisz' : 'Utwórz'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Task Modal */}
      {showTaskModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="p-4 border-b border-slate-200 flex justify-between items-center">
              <h3 className="font-semibold text-slate-900">
                {editingTask ? 'Edytuj pozycję' : 'Nowa pozycja'}
              </h3>
              <button onClick={() => setShowTaskModal(false)} className="p-1 hover:bg-slate-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nazwa pozycji *</label>
                <input
                  type="text"
                  value={taskForm.name}
                  onChange={e => setTaskForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="np. Montaż instalacji elektrycznej"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Kod</label>
                  <input
                    type="text"
                    value={taskForm.code}
                    onChange={e => setTaskForm(prev => ({ ...prev, code: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="np. E01-001"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Ilość</label>
                  <input
                    type="number"
                    value={taskForm.volume}
                    onChange={e => setTaskForm(prev => ({ ...prev, volume: parseFloat(e.target.value) || 0 }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                    min="0"
                    step="0.01"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Jednostka</label>
                <select
                  value={taskForm.unit_measure_id}
                  onChange={e => setTaskForm(prev => ({ ...prev, unit_measure_id: parseInt(e.target.value) }))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value={0}>-- Wybierz --</option>
                  {unitMeasures.map(u => (
                    <option key={u.id} value={u.id}>{u.name} ({u.code})</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="p-4 border-t border-slate-200 flex justify-end gap-2">
              <button
                onClick={() => setShowTaskModal(false)}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Anuluj
              </button>
              <button
                onClick={handleSaveTask}
                disabled={saving || !taskForm.name.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingTask ? 'Zapisz' : 'Utwórz'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resource Modal */}
      {showResourceModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
            <div className="p-4 border-b border-slate-200 flex justify-between items-center">
              <h3 className="font-semibold text-slate-900">
                {editingResource ? 'Edytuj zasób' : 'Nowy zasób'}
              </h3>
              <button onClick={() => setShowResourceModal(false)} className="p-1 hover:bg-slate-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nazwa zasobu *</label>
                <input
                  type="text"
                  value={resourceForm.name}
                  onChange={e => setResourceForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="np. Kabel YDY 3x2.5"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Kod</label>
                  <input
                    type="text"
                    value={resourceForm.code}
                    onChange={e => setResourceForm(prev => ({ ...prev, code: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Typ</label>
                  <select
                    value={resourceForm.resource_type}
                    onChange={e => setResourceForm(prev => ({ ...prev, resource_type: e.target.value as ResourceType }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    {Object.entries(RESOURCE_TYPE_CONFIG).map(([key, { label }]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Ilość</label>
                  <input
                    type="number"
                    value={resourceForm.volume}
                    onChange={e => setResourceForm(prev => ({ ...prev, volume: parseFloat(e.target.value) || 0 }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                    min="0"
                    step="0.01"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Cena jedn.</label>
                  <input
                    type="number"
                    value={resourceForm.price}
                    onChange={e => setResourceForm(prev => ({ ...prev, price: parseFloat(e.target.value) || 0 }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                    min="0"
                    step="0.01"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Narzut %</label>
                  <input
                    type="number"
                    value={resourceForm.markup}
                    onChange={e => setResourceForm(prev => ({ ...prev, markup: parseFloat(e.target.value) || 0 }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                    min="0"
                    step="0.1"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Jednostka</label>
                <select
                  value={resourceForm.unit_measure_id}
                  onChange={e => setResourceForm(prev => ({ ...prev, unit_measure_id: parseInt(e.target.value) }))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value={0}>-- Wybierz --</option>
                  {unitMeasures.map(u => (
                    <option key={u.id} value={u.id}>{u.name} ({u.code})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">URL (link do produktu)</label>
                <input
                  type="url"
                  value={resourceForm.url}
                  onChange={e => setResourceForm(prev => ({ ...prev, url: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="https://..."
                />
              </div>
              <div className="bg-slate-50 p-3 rounded-lg">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Koszt:</span>
                  <span className="font-medium">{formatCurrency(resourceForm.volume * resourceForm.price)}</span>
                </div>
                <div className="flex justify-between text-sm mt-1">
                  <span className="text-slate-600">Z narzutem:</span>
                  <span className="font-semibold text-blue-600">
                    {formatCurrency(resourceForm.volume * resourceForm.price * (1 + resourceForm.markup / 100))}
                  </span>
                </div>
              </div>
            </div>
            <div className="p-4 border-t border-slate-200 flex justify-end gap-2">
              <button
                onClick={() => setShowResourceModal(false)}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Anuluj
              </button>
              <button
                onClick={handleSaveResource}
                disabled={saving || !resourceForm.name.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingResource ? 'Zapisz' : 'Dodaj'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Markup Modal */}
      {showMarkupModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="p-4 border-b border-slate-200 flex justify-between items-center">
              <h3 className="font-semibold text-slate-900">Dodaj narzut</h3>
              <button onClick={() => setShowMarkupModal(false)} className="p-1 hover:bg-slate-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nazwa narzutu *</label>
                <input
                  type="text"
                  value={markupForm.name}
                  onChange={e => setMarkupForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="np. VAT 23%"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Wartość</label>
                  <input
                    type="number"
                    value={markupForm.value}
                    onChange={e => setMarkupForm(prev => ({ ...prev, value: parseFloat(e.target.value) || 0 }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                    min="0"
                    step="0.01"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Typ</label>
                  <select
                    value={markupForm.type}
                    onChange={e => setMarkupForm(prev => ({ ...prev, type: e.target.value as 'percent' | 'fixed' }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="percent">Procent (%)</option>
                    <option value="fixed">Kwota stała (PLN)</option>
                  </select>
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={markupForm.is_nds}
                  onChange={e => setMarkupForm(prev => ({ ...prev, is_nds: e.target.checked }))}
                  className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-slate-700">To jest VAT (wyświetlaj osobno)</span>
              </label>
            </div>
            <div className="p-4 border-t border-slate-200 flex justify-end gap-2">
              <button
                onClick={() => setShowMarkupModal(false)}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Anuluj
              </button>
              <button
                onClick={handleSaveMarkup}
                disabled={saving || !markupForm.name.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                Dodaj
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Estimate Detail Modal */}
      {showEstimateDetailModal && selectedEstimateDetail && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-start">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <span className="font-mono text-lg font-bold text-slate-900">
                    {selectedEstimateDetail.estimate_number}
                  </span>
                  <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                    selectedEstimateDetail.status === 'approved' ? 'bg-green-100 text-green-700' :
                    selectedEstimateDetail.status === 'pending_approval' ? 'bg-yellow-100 text-yellow-700' :
                    selectedEstimateDetail.status === 'rejected' ? 'bg-red-100 text-red-700' :
                    'bg-slate-100 text-slate-600'
                  }`}>
                    {selectedEstimateDetail.status === 'draft' ? 'Wersja robocza' :
                     selectedEstimateDetail.status === 'pending_approval' ? 'Do akceptacji' :
                     selectedEstimateDetail.status === 'approved' ? 'Zaakceptowany' :
                     selectedEstimateDetail.status === 'rejected' ? 'Odrzucony' : selectedEstimateDetail.status}
                  </span>
                </div>
                <h2 className="text-lg font-bold text-slate-900">
                  {selectedEstimateDetail.request?.investment_name || selectedEstimateDetail.settings?.name || 'Kosztorys'}
                </h2>
                <p className="text-sm text-slate-500">{selectedEstimateDetail.request?.client_name || '—'}</p>
              </div>
              <button
                onClick={() => setShowEstimateDetailModal(false)}
                className="p-2 hover:bg-slate-100 rounded-lg"
              >
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 overflow-y-auto flex-1">
              <div className="grid grid-cols-2 gap-6">
                {/* Left column */}
                <div className="space-y-5">
                  {/* Dane Klienta */}
                  <div className="bg-slate-50 rounded-xl p-4">
                    <h3 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                      <Building2 className="w-5 h-5 text-blue-500" />
                      Dane Klienta
                    </h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Nazwa firmy:</span>
                        <span className="font-medium">{selectedEstimateDetail.request?.client_name || '—'}</span>
                      </div>
                      {selectedEstimateDetail.request?.address && (
                        <div className="flex justify-between">
                          <span className="text-slate-500">Adres:</span>
                          <span className="font-medium text-right">{selectedEstimateDetail.request.address}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Dane Obiektu */}
                  <div className="bg-slate-50 rounded-xl p-4">
                    <h3 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                      <Building2 className="w-5 h-5 text-amber-500" />
                      Dane Obiektu
                    </h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Inwestycja:</span>
                        <span className="font-medium">{selectedEstimateDetail.request?.investment_name || '—'}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right column */}
                <div className="space-y-5">
                  {/* Parametry */}
                  <div className="bg-slate-50 rounded-xl p-4">
                    <h3 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                      <Settings className="w-5 h-5 text-indigo-500" />
                      Parametry
                    </h3>
                    <div className="space-y-2 text-sm">
                      {selectedEstimateDetail.request?.work_types?.length > 0 && (
                        <div className="flex justify-between">
                          <span className="text-slate-500">Rodzaj prac:</span>
                          <span className="font-medium text-right">
                            {selectedEstimateDetail.request.work_types.map((wt: any) =>
                              `${wt.work_type?.code} - ${wt.work_type?.name}`
                            ).join(', ')}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Terminy */}
                  <div className="bg-slate-50 rounded-xl p-4">
                    <h3 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                      <Calendar className="w-5 h-5 text-orange-500" />
                      Terminy
                    </h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Data utworzenia:</span>
                        <span className="font-medium">
                          {new Date(selectedEstimateDetail.created_at).toLocaleDateString('pl-PL')}
                        </span>
                      </div>
                      {selectedEstimateDetail.updated_at && (
                        <div className="flex justify-between">
                          <span className="text-slate-500">Ostatnia zmiana:</span>
                          <span className="font-medium">
                            {new Date(selectedEstimateDetail.updated_at).toLocaleDateString('pl-PL')}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Wartość */}
                  <div className="bg-slate-50 rounded-xl p-4">
                    <h3 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                      <Wallet className="w-5 h-5 text-green-500" />
                      Wartość
                    </h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Netto:</span>
                        <span className="font-medium">
                          {(selectedEstimateDetail.subtotal_net || 0).toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' })}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Brutto:</span>
                        <span className="font-bold text-green-700">
                          {(selectedEstimateDetail.total_gross || 0).toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' })}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-200 flex justify-between items-center">
              <button
                onClick={() => {
                  setShowEstimateDetailModal(false);
                  navigate(`/construction/kosztorys/${selectedEstimateDetail.id}`);
                }}
                className="flex items-center gap-2 px-4 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-lg"
              >
                <Pencil className="w-4 h-4" />
                Edytuj w formularzu
              </button>
              <button
                onClick={() => setShowEstimateDetailModal(false)}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg border border-slate-200"
              >
                Zamknij
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm">
            <div className="p-4 border-b border-slate-200">
              <h3 className="font-semibold text-slate-900">Potwierdź usunięcie</h3>
            </div>
            <div className="p-4">
              <p className="text-slate-600">
                Czy na pewno chcesz usunąć <strong>{showDeleteConfirm.name}</strong>?
              </p>
              {showDeleteConfirm.type === 'stage' && (
                <p className="text-sm text-red-600 mt-2">
                  ⚠ Wszystkie pozycje i zasoby w tym etapie zostaną również usunięte.
                </p>
              )}
              {showDeleteConfirm.type === 'task' && (
                <p className="text-sm text-red-600 mt-2">
                  ⚠ Wszystkie zasoby w tej pozycji zostaną również usunięte.
                </p>
              )}
            </div>
            <div className="p-4 border-t border-slate-200 flex justify-end gap-2">
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Anuluj
              </button>
              <button
                onClick={handleDelete}
                disabled={saving}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                Usuń
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Estimate Modal */}
      {showNewEstimateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b border-slate-200 flex justify-between items-center">
              <h2 className="text-xl font-bold text-slate-900">{editingRequestId ? 'Edytuj kosztorys' : 'Nowy kosztorys'}</h2>
              <button onClick={handleCloseNewEstimateModal} className="p-2 hover:bg-slate-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 space-y-6">
              {/* 1. Client info */}
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
                      value={formData.nip}
                      onChange={e => {
                        setFormData(prev => ({ ...prev, nip: e.target.value }));
                        setGusError(null);
                        setGusSuccess(null);
                      }}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="XXX-XXX-XX-XX"
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={handleFetchGus}
                      disabled={gusLoading || !formData.nip}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
                    >
                      {gusLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                      Pobierz z GUS
                    </button>
                  </div>
                </div>
                {gusError && (
                  <p className="text-sm text-red-600">{gusError}</p>
                )}
                {gusSuccess && (
                  <p className="text-sm text-green-600">{gusSuccess}</p>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2 relative">
                    <label className="block text-sm font-medium text-slate-700 mb-1">Nazwa firmy *</label>
                    <input
                      type="text"
                      value={formData.client_name}
                      onChange={e => {
                        setFormData(prev => ({ ...prev, client_name: e.target.value }));
                        setClientSearchQuery(e.target.value);
                      }}
                      onFocus={() => {
                        if (formData.client_name.length >= 2) {
                          setClientSearchQuery(formData.client_name);
                        }
                      }}
                      onBlur={() => {
                        setTimeout(() => setShowClientDropdown(false), 200);
                      }}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="Wyszukaj istniejącego lub wpisz nową nazwę..."
                    />
                    {showClientDropdown && (
                      <div className="absolute z-20 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                        {filteredClients.length > 0 ? (
                          <>
                            {filteredClients.some(c => c.source === 'contractor') && (
                              <div className="px-3 py-2 text-xs font-bold text-slate-700 bg-slate-50 border-b">
                                Kontrahenci z bazy
                              </div>
                            )}
                            {filteredClients.filter(c => c.source === 'contractor').map((client, i) => (
                              <button
                                key={`c-${i}`}
                                type="button"
                                onClick={() => selectExistingClient(client)}
                                className="w-full px-3 py-2 text-left hover:bg-blue-50 border-b border-slate-100 last:border-0"
                              >
                                <div className="font-medium text-slate-900">{client.client_name}</div>
                                <div className="text-xs text-slate-500 flex gap-2">
                                  {client.nip && <span>NIP: {client.nip}</span>}
                                  {client.company_city && <span>{client.company_city}</span>}
                                </div>
                              </button>
                            ))}
                            {filteredClients.some(c => c.source === 'request_history') && (
                              <div className="px-3 py-2 text-xs font-semibold text-slate-400 bg-slate-50 border-b border-t">
                                Z historii zapytań
                              </div>
                            )}
                            {filteredClients.filter(c => c.source === 'request_history').map((client, i) => (
                              <button
                                key={`h-${i}`}
                                type="button"
                                onClick={() => selectExistingClient(client)}
                                className="w-full px-3 py-2 text-left hover:bg-blue-50 border-b border-slate-100 last:border-0 opacity-75"
                              >
                                <div className="font-medium text-slate-900">{client.client_name}</div>
                                <div className="text-xs text-slate-500 flex gap-2">
                                  {client.nip && <span>NIP: {client.nip}</span>}
                                  {client.company_city && <span>{client.company_city}</span>}
                                </div>
                              </button>
                            ))}
                          </>
                        ) : clientSearchQuery.length >= 2 && (
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
                      value={formData.company_street}
                      onChange={e => handleCompanyStreetChange(e.target.value)}
                      onFocus={() => companyAddressSuggestions.length > 0 && setShowCompanyAddressSuggestions(true)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="ul. Przykładowa"
                    />
                    {showCompanyAddressSuggestions && companyAddressSuggestions.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {companyAddressSuggestions.map((addr, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => selectCompanyAddress(addr)}
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
                      value={formData.company_street_number}
                      onChange={e => setFormData(prev => ({ ...prev, company_street_number: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="12A"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Kod pocztowy</label>
                    <input
                      type="text"
                      value={formData.company_postal_code}
                      onChange={e => setFormData(prev => ({ ...prev, company_postal_code: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="00-000"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-slate-700 mb-1">Miasto</label>
                    <input
                      type="text"
                      value={formData.company_city}
                      onChange={e => setFormData(prev => ({ ...prev, company_city: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="Warszawa"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-slate-700 mb-1">Źródło zapytania</label>
                    <select
                      value={formData.request_source}
                      onChange={e => setFormData(prev => ({ ...prev, request_source: e.target.value as KosztorysRequestSource }))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                      {Object.entries(SOURCE_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>{label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Notatka wewnętrzna</label>
                  <textarea
                    value={formData.internal_notes}
                    onChange={e => setFormData(prev => ({ ...prev, internal_notes: e.target.value }))}
                    rows={2}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="Notatki widoczne tylko dla zespołu..."
                  />
                </div>
              </div>

              {/* 2. Representatives */}
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                    <User className="w-5 h-5 text-slate-400" />
                    Przedstawiciele firmy
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      if (!showAddContactForm) {
                        if (contacts.length === 0) {
                          addContact();
                        }
                      }
                      setShowAddContactForm(!showAddContactForm);
                    }}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm bg-slate-100 hover:bg-slate-200 rounded-lg"
                  >
                    <UserPlus className="w-4 h-4" />
                    Dodaj
                  </button>
                </div>

                {/* Dropdown to select existing contact */}
                {clientContacts.length > 0 && (
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Wybierz istniejącego przedstawiciela</label>
                    <select
                      value={selectedContactId}
                      onChange={e => selectExistingContact(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
                    >
                      <option value="">— Wybierz z listy —</option>
                      {clientContacts.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.is_main_contact ? '★ ' : ''}{c.first_name} {c.last_name}{c.position ? ` — ${c.position}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* No representatives info */}
                {clientSelected && clientContacts.length === 0 && !showAddContactForm && (
                  <p className="text-sm text-slate-500 italic">Brak przedstawicieli w bazie dla tego klienta. Kliknij "Dodaj" aby dodać.</p>
                )}

                {/* Manual add contact form */}
                {showAddContactForm && (
                  <div className="space-y-4">
                    {contacts.map((contact, index) => (
                      <div key={index} className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                        <div className="flex justify-between items-start mb-3">
                          <div className="flex items-center gap-2">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={contact.is_primary}
                                onChange={() => updateContact(index, 'is_primary', true)}
                                className="w-4 h-4 text-blue-600 rounded"
                              />
                              <span className="text-sm font-medium text-slate-700 flex items-center gap-1">
                                {contact.is_primary && <Star className="w-4 h-4 text-amber-500" />}
                                Główny kontakt
                              </span>
                            </label>
                          </div>
                          {contacts.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeContact(index)}
                              className="p-1 text-red-500 hover:bg-red-50 rounded"
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
                              onChange={e => updateContact(index, 'first_name', e.target.value)}
                              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                              placeholder="Jan"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-600 mb-1">Nazwisko *</label>
                            <input
                              type="text"
                              value={contact.last_name}
                              onChange={e => updateContact(index, 'last_name', e.target.value)}
                              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                              placeholder="Kowalski"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-600 mb-1">Telefon</label>
                            <input
                              type="tel"
                              value={contact.phone}
                              onChange={e => updateContact(index, 'phone', formatPhoneNumber(e.target.value))}
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
                              onChange={e => updateContact(index, 'position', e.target.value)}
                              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                              placeholder="Kierownik projektu"
                            />
                          </div>
                          <div className="col-span-2">
                            <label className="block text-xs font-medium text-slate-600 mb-1">E-mail</label>
                            <input
                              type="email"
                              value={contact.email}
                              onChange={e => updateContact(index, 'email', e.target.value)}
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
                      onClick={() => addContact()}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs text-blue-600 hover:bg-blue-50 rounded-lg"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Dodaj kolejny kontakt
                    </button>
                  </div>
                )}

                {/* Show selected contact summary */}
                {!showAddContactForm && selectedContactId && contacts.length > 0 && contacts[0].first_name && (
                  <div className="p-3 bg-blue-50 rounded-lg border border-blue-200 text-sm">
                    <span className="font-medium text-blue-800">{contacts[0].first_name} {contacts[0].last_name}</span>
                    {contacts[0].position && <span className="text-blue-600 ml-2">({contacts[0].position})</span>}
                    {contacts[0].phone && <span className="text-blue-600 ml-2">{contacts[0].phone}</span>}
                  </div>
                )}
              </div>

              {/* 3. Object info */}
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
                      value={formData.investment_name}
                      onChange={e => setFormData(prev => ({ ...prev, investment_name: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="np. Osiedle Słoneczne - Etap II"
                    />
                  </div>
                  <div className="col-span-1">
                    <label className="block text-sm font-medium text-slate-700 mb-1">Kod obiektu</label>
                    <div className="flex gap-1">
                      <input
                        type="text"
                        value={formData.object_code}
                        onChange={e => setFormData(prev => ({ ...prev, object_code: e.target.value }))}
                        disabled={!editingObjectCode}
                        className="w-full px-2 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 font-mono"
                        placeholder="WC26"
                      />
                      <button
                        type="button"
                        onClick={() => setEditingObjectCode(!editingObjectCode)}
                        className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg flex-shrink-0"
                        title={editingObjectCode ? 'Auto-generuj' : 'Edytuj ręcznie'}
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
                          onClick={() => setShowWorkTypesDropdown(!showWorkTypesDropdown)}
                          className="flex-1 px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white text-left flex items-center justify-between"
                        >
                          <span className={selectedWorkTypes.length === 0 ? 'text-slate-400' : 'text-slate-900'}>
                            {selectedWorkTypes.length === 0
                              ? 'Wybierz rodzaj prac...'
                              : workTypes
                                  .filter(wt => selectedWorkTypes.includes(wt.id))
                                  .map(wt => wt.code)
                                  .join(', ')}
                          </span>
                          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${showWorkTypesDropdown ? 'rotate-180' : ''}`} />
                        </button>
                        <button
                          type="button"
                          onClick={() => { setShowAddWorkType(true); setShowWorkTypesDropdown(false); }}
                          className="px-2 py-2 text-blue-600 border border-blue-200 bg-blue-50 rounded-lg hover:bg-blue-100 flex-shrink-0"
                          title="Dodaj nowy rodzaj prac"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                      {showWorkTypesDropdown && (
                        <div className="absolute z-20 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg py-1">
                          {workTypes.map(wt => (
                            <label
                              key={wt.id}
                              className="flex items-center px-3 py-2 hover:bg-slate-50 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={selectedWorkTypes.includes(wt.id)}
                                onChange={e => {
                                  if (e.target.checked) {
                                    setSelectedWorkTypes(prev => [...prev, wt.id]);
                                  } else {
                                    setSelectedWorkTypes(prev => prev.filter(id => id !== wt.id));
                                  }
                                }}
                                className="mr-3 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                              />
                              <span className="text-sm text-slate-700">{wt.name}</span>
                            </label>
                          ))}
                          {workTypes.length === 0 && (
                            <div className="px-3 py-2 text-sm text-slate-500">Brak typów prac</div>
                          )}
                        </div>
                      )}
                      {showAddWorkType && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          <input
                            type="text"
                            value={newWorkTypeCode}
                            onChange={e => setNewWorkTypeCode(e.target.value.toUpperCase())}
                            placeholder="Kod (np. IE)"
                            className="w-16 px-2 py-1.5 border border-slate-200 rounded-lg text-sm"
                            autoFocus
                          />
                          <input
                            type="text"
                            value={newWorkTypeName}
                            onChange={e => setNewWorkTypeName(e.target.value)}
                            placeholder="Nazwa (np. Elektryka)"
                            className="flex-1 min-w-[120px] px-2 py-1.5 border border-slate-200 rounded-lg text-sm"
                            onKeyDown={async e => {
                              if (e.key === 'Enter' && newWorkTypeCode.trim() && newWorkTypeName.trim()) {
                                const fullName = `${newWorkTypeCode.trim()} - ${newWorkTypeName.trim()}`;
                                const { data } = await supabase.from('kosztorys_work_types').insert({
                                  code: newWorkTypeCode.trim(),
                                  name: fullName,
                                  category: newWorkTypeCode.trim(),
                                  company_id: currentUser?.company_id,
                                  is_active: true
                                }).select('id, code, name').single();
                                if (data) {
                                  setWorkTypes(prev => [...prev, data]);
                                  setSelectedWorkTypes(prev => [...prev, data.id]);
                                }
                                setNewWorkTypeCode('');
                                setNewWorkTypeName('');
                                setShowAddWorkType(false);
                              }
                              if (e.key === 'Escape') { setShowAddWorkType(false); setNewWorkTypeCode(''); setNewWorkTypeName(''); }
                            }}
                          />
                          <button
                            onClick={async () => {
                              if (newWorkTypeCode.trim() && newWorkTypeName.trim()) {
                                const fullName = `${newWorkTypeCode.trim()} - ${newWorkTypeName.trim()}`;
                                const { data } = await supabase.from('kosztorys_work_types').insert({
                                  code: newWorkTypeCode.trim(),
                                  name: fullName,
                                  category: newWorkTypeCode.trim(),
                                  company_id: currentUser?.company_id,
                                  is_active: true
                                }).select('id, code, name').single();
                                if (data) {
                                  setWorkTypes(prev => [...prev, data]);
                                  setSelectedWorkTypes(prev => [...prev, data.id]);
                                }
                              }
                              setNewWorkTypeCode('');
                              setNewWorkTypeName('');
                              setShowAddWorkType(false);
                            }}
                            className="px-2 py-1.5 bg-blue-600 text-white rounded-lg text-xs"
                          >OK</button>
                          <button
                            onClick={() => { setShowAddWorkType(false); setNewWorkTypeCode(''); setNewWorkTypeName(''); }}
                            className="px-2 py-1.5 text-slate-600 border border-slate-200 rounded-lg text-xs"
                          >&#10005;</button>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="col-span-6">
                    <label className="block text-sm font-medium text-slate-700 mb-1">Typ obiektu</label>
                    <select
                      value={formData.object_category_id}
                      onChange={e => setFormData(prev => ({ ...prev, object_category_id: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">-- Wybierz (opcjonalnie) --</option>
                      {objectCategories.map((c: any) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Object address */}
                <div className="grid grid-cols-4 gap-4">
                  <div className="col-span-2 relative">
                    <label className="block text-sm font-medium text-slate-700 mb-1">Ulica</label>
                    <input
                      type="text"
                      value={formData.object_street}
                      onChange={e => handleObjectStreetChange(e.target.value)}
                      onFocus={() => objectAddressSuggestions.length > 0 && setShowObjectAddressSuggestions(true)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="ul. Budowlana"
                    />
                    {showObjectAddressSuggestions && objectAddressSuggestions.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {objectAddressSuggestions.map((addr, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => selectObjectAddress(addr)}
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
                      value={formData.object_street_number}
                      onChange={e => setFormData(prev => ({ ...prev, object_street_number: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="1"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Kod pocztowy</label>
                    <input
                      type="text"
                      value={formData.object_postal_code}
                      onChange={e => setFormData(prev => ({ ...prev, object_postal_code: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="00-000"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-slate-700 mb-1">Miasto</label>
                    <input
                      type="text"
                      value={formData.object_city}
                      onChange={e => setFormData(prev => ({ ...prev, object_city: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="Warszawa"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-slate-700 mb-1">Kraj</label>
                    <input
                      type="text"
                      value={formData.object_country}
                      onChange={e => setFormData(prev => ({ ...prev, object_country: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="Polska"
                    />
                  </div>
                </div>
              </div>

              {/* 4. Materials */}
              <div className="space-y-4">
                <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-slate-400" />
                  Materiały
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Materiał Główny</label>
                    <select
                      value={formData.main_material_side}
                      onChange={e => setFormData(prev => ({ ...prev, main_material_side: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">-- Wybierz --</option>
                      <option value="investor">Po stronie Inwestora</option>
                      <option value="client">Po stronie {formData.client_name || 'Klienta'}</option>
                      <option value="company">Po stronie Firmy</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Materiał Drobny</label>
                    <select
                      value={formData.minor_material_side}
                      onChange={e => setFormData(prev => ({ ...prev, minor_material_side: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">-- Wybierz --</option>
                      <option value="investor">Po stronie Inwestora</option>
                      <option value="client">Po stronie {formData.client_name || 'Klienta'}</option>
                      <option value="company">Po stronie Firmy</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* 5. Assignment */}
              <div className="space-y-4">
                <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                  <Briefcase className="w-5 h-5 text-slate-400" />
                  Odpowiedzialny
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Odpowiedzialny</label>
                    <select
                      value={formData.assigned_user_id}
                      onChange={e => setFormData(prev => ({ ...prev, assigned_user_id: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">-- Wybierz --</option>
                      {users.map(user => (
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
                      value={formData.planned_response_date}
                      onChange={e => setFormData(prev => ({ ...prev, planned_response_date: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                      min={new Date().toISOString().split('T')[0]}
                    />
                  </div>
                </div>
              </div>

              {/* 6. Notes */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Uwagi od klienta</label>
                <textarea
                  value={formData.notes}
                  onChange={e => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                  rows={3}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="Dodatkowe informacje od klienta..."
                />
              </div>
            </div>

            <div className="p-6 border-t border-slate-200 flex justify-end gap-3">
              <button
                onClick={handleCloseNewEstimateModal}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Anuluj
              </button>
              <button
                onClick={handleSaveNewEstimate}
                disabled={saving || !formData.client_name.trim() || !formData.investment_name.trim()}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingRequestId ? 'Zapisz zmiany' : 'Utwórz Kosztorys'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirmModal && estimateToDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70] p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-6">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                  <Trash2 className="w-6 h-6 text-red-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">Usunąć kosztorys?</h3>
                  <p className="text-sm text-slate-500">Ta operacja przeniesie kosztorys do usuniętych</p>
                </div>
              </div>
              <div className="bg-slate-50 rounded-lg p-3 mb-4">
                <p className="text-sm font-medium text-slate-900">{estimateToDelete.estimate_number}</p>
                <p className="text-sm text-slate-600">{estimateToDelete.request?.investment_name}</p>
                <p className="text-sm text-slate-500">{estimateToDelete.request?.client_name}</p>
              </div>
              <p className="text-sm text-slate-600">
                Kosztorys będzie można przywrócić z poziomu filtrów, zaznaczając opcję "Pokaż usunięte kosztorysy".
              </p>
            </div>
            <div className="p-4 bg-slate-50 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowDeleteConfirmModal(false);
                  setEstimateToDelete(null);
                }}
                className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg transition"
              >
                Anuluj
              </button>
              <button
                onClick={handleConfirmDelete}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
              >
                Usuń kosztorys
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Stage Card Component
interface StageCardProps {
  stage: StageWithChildren;
  level: number;
  onToggle: (id: string) => void;
  onEditStage: (stage: EstimateStage) => void;
  onDeleteStage: (stage: EstimateStage) => void;
  onAddTask: (stageId: string) => void;
  onEditTask: (task: EstimateTask) => void;
  onDeleteTask: (task: EstimateTask) => void;
  onAddResource: (taskId: string) => void;
  onEditResource: (resource: EstimateResource) => void;
  onDeleteResource: (resource: EstimateResource) => void;
  onUpdateResource: (resourceId: string, field: string, value: number | string) => void;
  onSelectTask: (taskId: string) => void;
  selectedTaskId: string | null;
  calculateStageTotals: (stage: StageWithChildren) => { cost: number; costWithMarkup: number };
  formatCurrency: (value: number) => string;
  unitMeasures: UnitMeasure[];
}

const StageCard: React.FC<StageCardProps> = ({
  stage, level, onToggle, onEditStage, onDeleteStage, onAddTask, onEditTask, onDeleteTask,
  onAddResource, onEditResource, onDeleteResource, onUpdateResource, onSelectTask, selectedTaskId,
  calculateStageTotals, formatCurrency, unitMeasures
}) => {
  const totals = calculateStageTotals(stage);
  const hasChildren = (stage.children && stage.children.length > 0) || (stage.tasks && stage.tasks.length > 0);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Stage header */}
      <div
        className="flex items-center gap-2 p-3 bg-gradient-to-r from-amber-50 to-orange-50 border-b border-slate-100 cursor-pointer hover:from-amber-100 hover:to-orange-100"
        onClick={() => onToggle(stage.id)}
      >
        {hasChildren ? (
          stage.isExpanded ? (
            <ChevronDown className="w-5 h-5 text-amber-600" />
          ) : (
            <ChevronRight className="w-5 h-5 text-amber-600" />
          )
        ) : (
          <span className="w-5" />
        )}
        <FolderOpen className="w-5 h-5 text-amber-500" />
        <div className="flex-1">
          <span className="font-semibold text-slate-900">{stage.name}</span>
          {stage.code && <span className="ml-2 text-sm text-slate-500">({stage.code})</span>}
        </div>
        <span className="text-sm font-medium text-slate-700">{formatCurrency(totals.costWithMarkup)}</span>
        <div className="flex items-center gap-1 ml-2">
          <button
            onClick={(e) => { e.stopPropagation(); onAddTask(stage.id); }}
            className="p-1.5 hover:bg-white/80 rounded-lg text-slate-500 hover:text-blue-600"
            title="Dodaj pozycję"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onEditStage(stage); }}
            className="p-1.5 hover:bg-white/80 rounded-lg text-slate-500 hover:text-blue-600"
            title="Edytuj"
          >
            <Pencil className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDeleteStage(stage); }}
            className="p-1.5 hover:bg-white/80 rounded-lg text-slate-500 hover:text-red-600"
            title="Usuń"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Stage content */}
      {stage.isExpanded && (
        <div className="divide-y divide-slate-100">
          {/* Child stages */}
          {stage.children?.map(child => (
            <div key={child.id} className="pl-4">
              <StageCard
                stage={child}
                level={level + 1}
                onToggle={onToggle}
                onEditStage={onEditStage}
                onDeleteStage={onDeleteStage}
                onAddTask={onAddTask}
                onEditTask={onEditTask}
                onDeleteTask={onDeleteTask}
                onAddResource={onAddResource}
                onEditResource={onEditResource}
                onDeleteResource={onDeleteResource}
                onUpdateResource={onUpdateResource}
                onSelectTask={onSelectTask}
                selectedTaskId={selectedTaskId}
                calculateStageTotals={calculateStageTotals}
                formatCurrency={formatCurrency}
                unitMeasures={unitMeasures}
              />
            </div>
          ))}

          {/* Tasks */}
          {stage.tasks?.map(task => (
            <TaskRow
              key={task.id}
              task={task}
              onEditTask={onEditTask}
              onDeleteTask={onDeleteTask}
              onAddResource={onAddResource}
              onEditResource={onEditResource}
              onDeleteResource={onDeleteResource}
              onUpdateResource={onUpdateResource}
              onSelectTask={onSelectTask}
              isSelected={selectedTaskId === task.id}
              formatCurrency={formatCurrency}
              unitMeasures={unitMeasures}
            />
          ))}

          {(!stage.tasks || stage.tasks.length === 0) && (!stage.children || stage.children.length === 0) && (
            <div className="p-4 text-center text-slate-400 text-sm">
              Brak pozycji. <button onClick={() => onAddTask(stage.id)} className="text-blue-600 hover:underline">Dodaj pierwszą pozycję</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Task Row Component
interface TaskRowProps {
  task: TaskWithResources;
  onEditTask: (task: EstimateTask) => void;
  onDeleteTask: (task: EstimateTask) => void;
  onAddResource: (taskId: string) => void;
  onEditResource: (resource: EstimateResource) => void;
  onDeleteResource: (resource: EstimateResource) => void;
  onUpdateResource: (resourceId: string, field: string, value: number | string) => void;
  onSelectTask: (taskId: string) => void;
  isSelected: boolean;
  formatCurrency: (value: number) => string;
  unitMeasures: UnitMeasure[];
}

const TaskRow: React.FC<TaskRowProps> = ({
  task, onEditTask, onDeleteTask, onAddResource, onEditResource, onDeleteResource,
  onUpdateResource, onSelectTask, isSelected, formatCurrency, unitMeasures
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const hasResources = task.resources && task.resources.length > 0;
  const unit = unitMeasures.find(u => u.id === task.unit_measure_id);

  const taskTotal = useMemo(() => {
    let total = 0;
    task.resources?.forEach(r => { total += r.cost_with_markup || 0; });
    return total;
  }, [task.resources]);

  return (
    <div className={`${isSelected ? 'bg-blue-50' : ''}`}>
      {/* Task header */}
      <div
        className="flex items-center gap-2 p-2 hover:bg-slate-50 cursor-pointer group"
        onClick={() => { setIsExpanded(!isExpanded); onSelectTask(task.id); }}
      >
        {hasResources ? (
          isExpanded ? (
            <ChevronDown className="w-4 h-4 text-slate-400 ml-4" />
          ) : (
            <ChevronRight className="w-4 h-4 text-slate-400 ml-4" />
          )
        ) : (
          <span className="w-4 ml-4" />
        )}
        <FileText className="w-4 h-4 text-blue-500" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-slate-700">{task.name}</span>
          {task.code && <span className="ml-2 text-xs text-slate-400">{task.code}</span>}
        </div>
        <span className="text-xs text-slate-500 w-16 text-right">{task.volume} {unit?.code || ''}</span>
        <span className="text-sm font-medium text-slate-900 w-28 text-right">{formatCurrency(taskTotal)}</span>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); onAddResource(task.id); }}
            className="p-1 hover:bg-slate-200 rounded text-slate-500 hover:text-blue-600"
            title="Dodaj zasób"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onEditTask(task); }}
            className="p-1 hover:bg-slate-200 rounded text-slate-500 hover:text-blue-600"
            title="Edytuj"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDeleteTask(task); }}
            className="p-1 hover:bg-slate-200 rounded text-slate-500 hover:text-red-600"
            title="Usuń"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Resources */}
      {isExpanded && hasResources && (
        <div className="bg-slate-50 border-t border-slate-100">
          {/* Resource table header */}
          <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-slate-500 border-b border-slate-100">
            <span className="w-5 ml-8"></span>
            <span className="flex-1">Zasób</span>
            <span className="w-16 text-right">Ilość</span>
            <span className="w-20 text-right">Cena</span>
            <span className="w-14 text-right">Narzut</span>
            <span className="w-24 text-right">Suma</span>
            <span className="w-16"></span>
          </div>
          {task.resources?.map(resource => {
            const config = RESOURCE_TYPE_CONFIG[resource.resource_type];
            const Icon = config.icon;
            const resourceUnit = unitMeasures.find(u => u.id === resource.unit_measure_id);

            return (
              <div key={resource.id} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-100 group text-sm">
                <div className={`w-5 h-5 rounded flex items-center justify-center ml-8 ${config.bgColor}`}>
                  <Icon className={`w-3 h-3 ${config.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-slate-700 truncate">{resource.name}</span>
                  {resource.url && (
                    <a href={resource.url} target="_blank" rel="noopener noreferrer" className="ml-2 text-blue-500 hover:underline text-xs">
                      link
                    </a>
                  )}
                </div>
                <EditableCell
                  value={resource.volume}
                  type="number"
                  onSave={(v) => onUpdateResource(resource.id, 'volume', v)}
                  className="w-16 text-right text-slate-600"
                  suffix={` ${resourceUnit?.code || ''}`}
                />
                <EditableCell
                  value={resource.price}
                  type="number"
                  onSave={(v) => onUpdateResource(resource.id, 'price', v)}
                  className="w-20 text-right text-slate-600"
                />
                <EditableCell
                  value={resource.markup}
                  type="number"
                  onSave={(v) => onUpdateResource(resource.id, 'markup', v)}
                  className="w-14 text-right text-slate-600"
                  suffix="%"
                />
                <span className="w-24 text-right font-medium text-slate-800">
                  {formatCurrency(resource.cost_with_markup || 0)}
                </span>
                <div className="w-16 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100">
                  <button
                    onClick={() => onEditResource(resource)}
                    className="p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-blue-600"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => onDeleteResource(resource)}
                    className="p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-red-600"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default EstimatesPage;
