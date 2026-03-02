import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Plus, Search, Filter, Loader2, ChevronRight, ChevronLeft, Phone, Mail,
  Calendar, User, Building2, FileText, Clock, AlertCircle,
  CheckCircle2, XCircle, Send, Eye, Pencil, Trash2, X, Check,
  ChevronDown, MoreVertical, MapPin, FileSpreadsheet, Play,
  Calculator, ClipboardList, ArrowLeft, Download, UserPlus,
  Star, Briefcase, Hash, Zap, Settings, RotateCcw
} from 'lucide-react';
import { useAppContext } from '../../context/AppContext';
import { supabase } from '../../lib/supabase';
import {
  KosztorysRequest, KosztorysRequestStatus, KosztorysObjectType,
  KosztorysInstallationType, KosztorysRequestSource, User as UserType,
  KosztorysRequestContact, KosztorysObjectTypeRecord, KosztorysObjectCategoryRecord
} from '../../types';
import { fetchCompanyByNip, validateNip, formatNip, normalizeNip } from '../../lib/gusApi';
import { searchAddress, OSMAddress, createDebouncedSearch } from '../../lib/osmAutocomplete';

// Phone number formatting - Polish format: +48 XXX XXX XXX
const formatPhoneNumber = (value: string): string => {
  // Remove all non-digits except +
  const cleaned = value.replace(/[^\d+]/g, '');

  // If starts with +48, format accordingly
  if (cleaned.startsWith('+48')) {
    const digits = cleaned.slice(3);
    if (digits.length <= 3) return `+48 ${digits}`;
    if (digits.length <= 6) return `+48 ${digits.slice(0, 3)} ${digits.slice(3)}`;
    return `+48 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 9)}`;
  }

  // If starts with 48, add +
  if (cleaned.startsWith('48') && cleaned.length > 2) {
    const digits = cleaned.slice(2);
    if (digits.length <= 3) return `+48 ${digits}`;
    if (digits.length <= 6) return `+48 ${digits.slice(0, 3)} ${digits.slice(3)}`;
    return `+48 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 9)}`;
  }

  // If just digits (Polish number without prefix)
  if (/^\d+$/.test(cleaned)) {
    if (cleaned.length <= 3) return cleaned;
    if (cleaned.length <= 6) return `${cleaned.slice(0, 3)} ${cleaned.slice(3)}`;
    return `${cleaned.slice(0, 3)} ${cleaned.slice(3, 6)} ${cleaned.slice(6, 9)}`;
  }

  return cleaned;
};

// Email validation
const isValidEmail = (email: string): boolean => {
  if (!email) return true; // Empty is OK (not required)
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// Status configuration
const STATUS_CONFIG: Record<KosztorysRequestStatus, { label: string; color: string; bgColor: string; icon: React.FC<{ className?: string }> }> = {
  new: { label: 'Nowe', color: 'text-blue-700', bgColor: 'bg-blue-100', icon: FileText },
  in_progress: { label: 'W pracy', color: 'text-amber-700', bgColor: 'bg-amber-100', icon: Clock },
  form_filled: { label: 'Formularz', color: 'text-purple-700', bgColor: 'bg-purple-100', icon: FileSpreadsheet },
  estimate_generated: { label: 'Kosztorys', color: 'text-indigo-700', bgColor: 'bg-indigo-100', icon: FileText },
  estimate_approved: { label: 'Zatwierdzony', color: 'text-green-700', bgColor: 'bg-green-100', icon: CheckCircle2 },
  estimate_revision: { label: 'Do poprawy', color: 'text-orange-700', bgColor: 'bg-orange-100', icon: AlertCircle },
  kp_sent: { label: 'KP wysłane', color: 'text-cyan-700', bgColor: 'bg-cyan-100', icon: Send },
  closed: { label: 'Zamknięte', color: 'text-slate-700', bgColor: 'bg-slate-100', icon: CheckCircle2 },
  cancelled: { label: 'Anulowane', color: 'text-red-700', bgColor: 'bg-red-100', icon: XCircle }
};

const OBJECT_TYPE_LABELS: Record<KosztorysObjectType, string> = {
  industrial: 'Przemysłowe',
  residential: 'Mieszkaniowe',
  office: 'Biurowe'
};

const INSTALLATION_TYPE_LABELS: Record<KosztorysInstallationType, string> = {
  'IE': 'IE - Elektryka',
  'IT': 'IT - Teletechnika',
  'IE,IT': 'IE + IT'
};

const SOURCE_LABELS: Record<KosztorysRequestSource, string> = {
  email: 'E-mail',
  phone: 'Telefon',
  meeting: 'Spotkanie',
  tender: 'Przetarg',
  other: 'Inne'
};

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
  // Client data
  client_name: string;
  nip: string;
  company_street: string;
  company_street_number: string;
  company_city: string;
  company_postal_code: string;
  company_country: string;
  internal_notes: string;
  // Legacy contact (for backward compatibility)
  contact_person: string;
  phone: string;
  email: string;
  // Object data
  investment_name: string;
  object_code: string;
  object_type: KosztorysObjectType;
  object_type_id: string;
  object_category_id: string;
  installation_types: KosztorysInstallationType;
  // Object address
  object_street: string;
  object_street_number: string;
  object_city: string;
  object_postal_code: string;
  object_country: string;
  // Materials
  main_material_side: string;
  minor_material_side: string;
  // Other
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

export const RequestsPage: React.FC = () => {
  const { state } = useAppContext();
  const { currentUser, currentCompany } = state;

  const [requests, setRequests] = useState<KosztorysRequest[]>([]);
  const [users, setUsers] = useState<UserType[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<KosztorysRequestStatus | 'all' | 'not_cancelled'>('not_cancelled');
  const [objectTypeFilter, setObjectTypeFilter] = useState<KosztorysObjectType | 'all'>('all');
  const [showFilters, setShowFilters] = useState(false);
  const [showPrepareOfferModal, setShowPrepareOfferModal] = useState(false);
  const [showFormSelectionModal, setShowFormSelectionModal] = useState(false);
  const [checkingForm, setCheckingForm] = useState(false);
  // Template selection per work type (for multi-work-type requests)
  const [workTypeTemplates, setWorkTypeTemplates] = useState<Record<string, string>>({});
  // Wizard step for multi-work-type selection (0 = main menu, 1+ = work type index)
  const [wizardStep, setWizardStep] = useState(0);
  // Template management
  const [showTemplateManagement, setShowTemplateManagement] = useState(false);
  const [savedTemplates, setSavedTemplates] = useState<any[]>([]);
  const [hiddenSystemTemplates, setHiddenSystemTemplates] = useState<string[]>([]);
  const [editingTemplate, setEditingTemplate] = useState<any | null>(null);
  const [templateFormData, setTemplateFormData] = useState({
    name: '',
    description: '',
    work_types: [] as string[],
    object_type: ''
  });

  // Modal states
  const [showModal, setShowModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<KosztorysRequest | null>(null);
  const [editingRequest, setEditingRequest] = useState<KosztorysRequest | null>(null);
  const [formData, setFormData] = useState<RequestFormData>(initialFormData);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<KosztorysRequest | null>(null);

  // Contacts management
  const [contacts, setContacts] = useState<ContactFormData[]>([{ ...initialContactData }]);

  // GUS API state
  const [gusLoading, setGusLoading] = useState(false);
  const [gusError, setGusError] = useState<string | null>(null);
  const [gusSuccess, setGusSuccess] = useState<string | null>(null);
  const [clientSelected, setClientSelected] = useState(false);

  // Object types and categories
  const [objectTypes, setObjectTypes] = useState<KosztorysObjectTypeRecord[]>([]);
  const [objectCategories, setObjectCategories] = useState<KosztorysObjectCategoryRecord[]>([]);

  // Work types (Rodzaj prac) - multi-select
  const [workTypes, setWorkTypes] = useState<{ id: string; code: string; name: string }[]>([]);
  const [selectedWorkTypes, setSelectedWorkTypes] = useState<string[]>([]); // Selected work type IDs
  const [showWorkTypesDropdown, setShowWorkTypesDropdown] = useState(false);
  const [newSourceOption, setNewSourceOption] = useState('');
  const [showAddSource, setShowAddSource] = useState(false);
  const [customSources, setCustomSources] = useState<string[]>([]);
  const [newObjectCategoryOption, setNewObjectCategoryOption] = useState('');
  const [showAddObjectCategory, setShowAddObjectCategory] = useState(false);

  // Address autocomplete
  const [companyAddressSuggestions, setCompanyAddressSuggestions] = useState<OSMAddress[]>([]);
  const [objectAddressSuggestions, setObjectAddressSuggestions] = useState<OSMAddress[]>([]);
  const [showCompanyAddressSuggestions, setShowCompanyAddressSuggestions] = useState(false);
  const [showObjectAddressSuggestions, setShowObjectAddressSuggestions] = useState(false);

  // Object code editing
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

  useEffect(() => {
    if (currentUser) {
      loadRequests();
      loadUsers();
      loadObjectTypes();
      loadObjectCategories();
      loadWorkTypes();
      loadExistingClients();
    }
  }, [currentUser]);

  const loadRequests = async () => {
    if (!currentUser) return;
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
      setRequests([]);
    } finally {
      setLoading(false);
    }
  };

  const handleGoToFormulary = async () => {
    if (!selectedRequest) return;
    setCheckingForm(true);
    try {
      // Check if any forms already exist for this request
      const { data: existingForms } = await supabase
        .from('kosztorys_forms')
        .select('id')
        .eq('request_id', selectedRequest.id)
        .eq('is_current', true)
        .limit(1);

      if (existingForms && existingForms.length > 0) {
        // Form exists, go directly to formulary
        setShowPrepareOfferModal(false);
        window.location.hash = `#/construction/formulary/${selectedRequest.id}`;
      } else {
        // No form exists, show selection modal
        setShowPrepareOfferModal(false);
        setShowFormSelectionModal(true);
      }
    } catch (err) {
      console.error('Error checking form:', err);
      setShowPrepareOfferModal(false);
      setShowFormSelectionModal(true);
    } finally {
      setCheckingForm(false);
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
        // Fallback to default work types if table doesn't exist or is empty
        setWorkTypes([
          { id: 'ie', code: 'IE', name: 'IE - Elektryka' },
          { id: 'it', code: 'IT', name: 'IT - Teletechnika' }
        ]);
      }
    } catch (err) {
      console.error('Error loading work types:', err);
      // Fallback to default work types
      setWorkTypes([
        { id: 'ie', code: 'IE', name: 'IE - Elektryka' },
        { id: 'it', code: 'IT', name: 'IT - Teletechnika' }
      ]);
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
            // Enrich portal entry with address from request if missing
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

  // Load saved templates from database
  const loadSavedTemplates = async () => {
    if (!currentUser) return;
    try {
      // Load active saved templates
      const { data, error } = await supabase
        .from('kosztorys_form_templates')
        .select('*')
        .eq('company_id', currentUser.company_id)
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setSavedTemplates(data || []);

      // Load hidden system template codes
      const { data: hiddenData } = await supabase
        .from('kosztorys_form_templates')
        .select('form_type')
        .eq('company_id', currentUser.company_id)
        .eq('is_active', false)
        .in('form_type', ['PREM-IE', 'PREM-IT', 'MIESZK-IE', 'MIESZK-IT']);

      setHiddenSystemTemplates(hiddenData?.map(h => h.form_type) || []);
    } catch (err) {
      console.error('Error loading saved templates:', err);
      setSavedTemplates([]);
    }
  };

  // Update template (works for both saved and system templates)
  const handleUpdateTemplate = async () => {
    if (!editingTemplate || !currentUser) return;

    try {
      if (editingTemplate.isSystem) {
        // For system templates, create or update a customization record
        // First check if customization already exists
        const { data: existing } = await supabase
          .from('kosztorys_form_templates')
          .select('id')
          .eq('company_id', currentUser.company_id)
          .eq('form_type', editingTemplate.form_type)
          .eq('is_active', true)
          .maybeSingle();

        if (existing) {
          // Update existing customization
          const { error } = await supabase
            .from('kosztorys_form_templates')
            .update({
              name: templateFormData.name,
              object_type: templateFormData.object_type || null,
              work_type: templateFormData.work_types.length === 1 ? templateFormData.work_types[0] : null,
              template_data: {
                description: templateFormData.description,
                work_types: templateFormData.work_types,
                isSystemCustomization: true
              },
              updated_at: new Date().toISOString()
            })
            .eq('id', existing.id);

          if (error) throw error;
        } else {
          // Create new customization for system template
          const { error } = await supabase
            .from('kosztorys_form_templates')
            .insert({
              company_id: currentUser.company_id,
              name: templateFormData.name,
              form_type: editingTemplate.form_type,
              object_type: templateFormData.object_type || null,
              work_type: templateFormData.work_types.length === 1 ? templateFormData.work_types[0] : null,
              template_data: {
                description: templateFormData.description,
                work_types: templateFormData.work_types,
                isSystemCustomization: true
              },
              is_active: true,
              created_by_id: currentUser.id
            });

          if (error) throw error;
        }
      } else {
        // For saved templates, update normally
        const { error } = await supabase
          .from('kosztorys_form_templates')
          .update({
            name: templateFormData.name,
            object_type: templateFormData.object_type || null,
            work_type: templateFormData.work_types.length === 1 ? templateFormData.work_types[0] : null,
            template_data: {
              ...editingTemplate.template_data,
              description: templateFormData.description,
              work_types: templateFormData.work_types
            },
            updated_at: new Date().toISOString()
          })
          .eq('id', editingTemplate.id);

        if (error) throw error;
      }

      // Reload templates
      await loadSavedTemplates();
      setEditingTemplate(null);
    } catch (err) {
      console.error('Error updating template:', err);
      alert('Błąd podczas aktualizacji szablonu');
    }
  };

  // Delete template
  const handleDeleteTemplate = async (templateId: string) => {
    if (!confirm('Czy na pewno chcesz usunąć ten szablon?')) return;

    try {
      const { error } = await supabase
        .from('kosztorys_form_templates')
        .update({ is_active: false })
        .eq('id', templateId);

      if (error) throw error;

      // Reload templates
      await loadSavedTemplates();
      setEditingTemplate(null);
    } catch (err) {
      console.error('Error deleting template:', err);
      alert('Błąd podczas usuwania szablonu');
    }
  };

  // Open edit template modal
  const openEditTemplate = (template: any) => {
    setEditingTemplate(template);
    setTemplateFormData({
      name: template.name || '',
      description: template.template_data?.description || '',
      work_types: template.template_data?.work_types || (template.work_type ? [template.work_type] : []),
      object_type: template.object_type || ''
    });
  };

  // Open system template for viewing/editing
  const openSystemTemplate = (tmpl: { code: string; name: string; desc: string; forWorkTypes: string[]; forObjectTypes: string[] }) => {
    // Check if there's a customization saved for this system template
    const customization = savedTemplates.find(t =>
      t.form_type === tmpl.code && t.template_data?.isSystemCustomization
    );

    const name = customization?.name || tmpl.name;
    const description = customization?.template_data?.description || tmpl.desc;
    const workTypes = customization?.template_data?.work_types || tmpl.forWorkTypes;
    const objectType = customization?.object_type || tmpl.forObjectTypes[0] || '';

    setEditingTemplate({
      isSystem: true,
      id: tmpl.code,
      form_type: tmpl.code,
      name: name,
      template_data: {
        description: description,
        work_types: workTypes
      },
      object_type: objectType
    });
    setTemplateFormData({
      name: name,
      description: description,
      work_types: workTypes,
      object_type: objectType
    });
  };

  // Hide/delete system template
  const handleHideSystemTemplate = async (templateCode: string) => {
    if (!currentUser) return;
    if (!confirm('Czy na pewno chcesz ukryć ten szablon systemowy?')) return;

    try {
      // Insert a record marking this system template as hidden
      const { error } = await supabase
        .from('kosztorys_form_templates')
        .insert({
          company_id: currentUser.company_id,
          name: `HIDDEN_${templateCode}`,
          form_type: templateCode,
          is_active: false,
          template_data: {}
        });

      if (error) throw error;

      // Reload templates
      await loadSavedTemplates();
    } catch (err) {
      console.error('Error hiding system template:', err);
      alert('Błąd podczas ukrywania szablonu');
    }
  };

  // Restore hidden system template
  const handleRestoreSystemTemplate = async (templateCode: string) => {
    if (!currentUser) return;

    try {
      // Delete the record that marks this template as hidden
      const { error } = await supabase
        .from('kosztorys_form_templates')
        .delete()
        .eq('company_id', currentUser.company_id)
        .eq('form_type', templateCode)
        .eq('is_active', false);

      if (error) throw error;

      // Reload templates
      await loadSavedTemplates();
    } catch (err) {
      console.error('Error restoring system template:', err);
      alert('Błąd podczas przywracania szablonu');
    }
  };

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

  // Load saved templates when template management is opened
  useEffect(() => {
    if (showTemplateManagement) {
      loadSavedTemplates();
    }
  }, [showTemplateManagement]);

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

  const selectExistingContactForRequest = (contactId: string) => {
    setSelectedContactId(contactId);
    const contact = clientContacts.find(c => c.id === contactId);
    if (contact) {
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

  const generateRequestNumber = () => {
    const year = new Date().getFullYear();
    const num = String(requests.length + 1).padStart(5, '0');
    return `ZAP-${year}-${num}`;
  };

  // Generate object code: MIASTO\XXY\RR
  // MIASTO - город из адреса объекта (первые 3 буквы)
  // XX - первые 2 буквы первого слова названия инвестиции
  // Y - первая буква второго слова названия
  // RR - последние 2 цифры года
  // Пример: "Osiedle Słoneczne" в Warszawa -> "WAR\OSS\26"
  const generateObjectCode = (city: string, investmentName: string): string => {
    if (!investmentName) return '';

    // City part - first 3 letters or "XXX" if empty
    const cityPart = city ? city.trim().toUpperCase().slice(0, 3).padEnd(3, 'X') : 'XXX';

    // Name part - XX from first word, Y from second word
    const words = investmentName.trim().split(/\s+/).filter(w => w.length > 0);
    let namePart = '';
    if (words.length >= 2) {
      namePart = (words[0].slice(0, 2) + words[1][0]).toUpperCase();
    } else if (words.length === 1) {
      namePart = words[0].slice(0, 3).toUpperCase();
    }

    // Year part
    const year = String(new Date().getFullYear()).slice(-2);

    return `${cityPart}\\${namePart}\\${year}`;
  };

  // Auto-generate object code when name or city changes
  useEffect(() => {
    if (formData.investment_name && !editingObjectCode && !editingRequest) {
      setFormData(prev => ({
        ...prev,
        object_code: generateObjectCode(prev.object_city, prev.investment_name)
      }));
    }
  }, [formData.investment_name, formData.object_city, editingObjectCode, editingRequest]);

  // Fetch company data from GUS by NIP
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
        (results) => {
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
        (results) => {
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

  // Contact management
  const addContact = () => {
    setContacts(prev => [...prev, { ...initialContactData, is_primary: false }]);
  };

  const removeContact = (index: number) => {
    if (contacts.length <= 1) return;
    setContacts(prev => {
      const newContacts = prev.filter((_, i) => i !== index);
      // If removed contact was primary, make first one primary
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
        // Only one can be primary
        newContacts.forEach((c, i) => {
          c.is_primary = i === index;
        });
      } else {
        (newContacts[index] as any)[field] = value;
      }
      return newContacts;
    });
  };

  const handleSaveRequest = async () => {
    if (!currentUser || !formData.client_name.trim() || !formData.investment_name.trim()) return;

    // Validate at least one contact
    const validContacts = contacts.filter(c => c.first_name.trim() && c.last_name.trim());
    if (validContacts.length === 0) {
      alert('Dodaj przynajmniej jednego przedstawiciela firmy');
      return;
    }

    setSaving(true);
    try {
      // Get primary contact for legacy fields
      const primaryContact = validContacts.find(c => c.is_primary) || validContacts[0];

      const requestData = {
        company_id: currentUser.company_id,
        request_number: editingRequest?.request_number || generateRequestNumber(),
        status: editingRequest?.status || 'new',
        // Client data
        client_name: formData.client_name.trim(),
        nip: normalizeNip(formData.nip) || null,
        company_street: formData.company_street.trim() || null,
        company_street_number: formData.company_street_number.trim() || null,
        company_city: formData.company_city.trim() || null,
        company_postal_code: formData.company_postal_code.trim() || null,
        company_country: formData.company_country || 'Polska',
        internal_notes: formData.internal_notes.trim() || null,
        // Legacy contact fields
        contact_person: `${primaryContact.first_name} ${primaryContact.last_name}`.trim(),
        phone: primaryContact.phone || '',
        email: primaryContact.email || null,
        // Object data
        investment_name: formData.investment_name.trim(),
        object_code: formData.object_code.trim() || null,
        object_type: formData.object_type,
        object_type_id: formData.object_type_id || null,
        object_category_id: formData.object_category_id || null,
        installation_types: formData.installation_types,
        // Object address
        object_street: formData.object_street.trim() || null,
        object_street_number: formData.object_street_number.trim() || null,
        object_city: formData.object_city.trim() || null,
        object_postal_code: formData.object_postal_code.trim() || null,
        object_country: formData.object_country || 'Polska',
        // Build full address string for legacy field
        address: [
          formData.object_street,
          formData.object_street_number,
          formData.object_postal_code,
          formData.object_city
        ].filter(Boolean).join(', ') || null,
        // Materials
        main_material_side: formData.main_material_side || null,
        minor_material_side: formData.minor_material_side || null,
        // Other
        planned_response_date: formData.planned_response_date || null,
        notes: formData.notes.trim() || null,
        request_source: formData.request_source || null,
        assigned_user_id: formData.assigned_user_id || currentUser.id,
        created_by_id: editingRequest?.created_by_id || currentUser.id
      };

      let requestId: string;

      if (editingRequest) {
        await supabase
          .from('kosztorys_requests')
          .update(requestData)
          .eq('id', editingRequest.id);
        requestId = editingRequest.id;

        // Delete existing contacts and re-create
        await supabase
          .from('kosztorys_request_contacts')
          .delete()
          .eq('request_id', requestId);
      } else {
        const { data: newRequest, error } = await supabase
          .from('kosztorys_requests')
          .insert(requestData)
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

      // Save work types to junction table
      // First, delete existing work types for this request
      await supabase
        .from('kosztorys_request_work_types')
        .delete()
        .eq('request_id', requestId);

      // Then insert selected work types
      if (selectedWorkTypes.length > 0) {
        const workTypesData = selectedWorkTypes.map(workTypeId => ({
          request_id: requestId,
          work_type_id: workTypeId
        }));
        await supabase.from('kosztorys_request_work_types').insert(workTypesData);
      }

      await loadRequests();
      handleCloseModal();
    } catch (err) {
      console.error('Error saving request:', err);
      alert('Błąd podczas zapisywania zapytania');
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (request: KosztorysRequest, newStatus: KosztorysRequestStatus) => {
    try {
      await supabase
        .from('kosztorys_requests')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', request.id);
      await loadRequests();
      if (selectedRequest?.id === request.id) {
        setSelectedRequest({ ...request, status: newStatus });
      }
    } catch (err) {
      console.error('Error updating status:', err);
    }
  };

  const handleDelete = async () => {
    if (!showDeleteConfirm) return;
    try {
      await supabase
        .from('kosztorys_requests')
        .delete()
        .eq('id', showDeleteConfirm.id);
      await loadRequests();
      setShowDeleteConfirm(null);
      if (selectedRequest?.id === showDeleteConfirm.id) {
        setSelectedRequest(null);
        setShowDetailModal(false);
      }
    } catch (err) {
      console.error('Error deleting request:', err);
    }
  };

  const handleOpenModal = (request?: KosztorysRequest) => {
    if (request) {
      setEditingRequest(request);
      setEditingObjectCode(!!request.object_code); // If has code, allow editing
      setFormData({
        client_name: request.client_name,
        nip: request.nip || '',
        company_street: request.company_street || '',
        company_street_number: request.company_street_number || '',
        company_city: request.company_city || '',
        company_postal_code: request.company_postal_code || '',
        company_country: request.company_country || 'Polska',
        internal_notes: request.internal_notes || '',
        contact_person: request.contact_person,
        phone: request.phone,
        email: request.email || '',
        investment_name: request.investment_name,
        object_code: request.object_code || '',
        object_type: request.object_type,
        object_type_id: request.object_type_id || '',
        object_category_id: request.object_category_id || '',
        installation_types: request.installation_types,
        object_street: request.object_street || '',
        object_street_number: request.object_street_number || '',
        object_city: request.object_city || '',
        object_postal_code: request.object_postal_code || '',
        object_country: request.object_country || 'Polska',
        main_material_side: (request as any).main_material_side || '',
        minor_material_side: (request as any).minor_material_side || '',
        planned_response_date: request.planned_response_date || '',
        notes: request.notes || '',
        request_source: request.request_source || 'email',
        assigned_user_id: request.assigned_user_id
      });

      // Load contacts or create from legacy fields
      if (request.contacts && request.contacts.length > 0) {
        setContacts(request.contacts.map(c => ({
          id: c.id,
          first_name: c.first_name,
          last_name: c.last_name,
          phone: c.phone || '',
          email: c.email || '',
          position: c.position || '',
          is_primary: c.is_primary
        })));
      } else if (request.contact_person) {
        // Create contact from legacy fields
        const nameParts = request.contact_person.split(' ');
        setContacts([{
          first_name: nameParts[0] || '',
          last_name: nameParts.slice(1).join(' ') || '',
          phone: request.phone || '',
          email: request.email || '',
          position: '',
          is_primary: true
        }]);
      } else {
        setContacts([{ ...initialContactData }]);
      }

      // Load selected work types from junction table
      loadRequestWorkTypes(request.id);
    } else {
      setEditingRequest(null);
      setEditingObjectCode(false);
      setFormData({ ...initialFormData, assigned_user_id: currentUser?.id || '' });
      setContacts([{ ...initialContactData }]);
      setSelectedWorkTypes([]);
    }
    setGusError(null);
    setGusSuccess(null);
    setClientSelected(false);
    setClientContacts([]);
    setShowCompanyAddressSuggestions(false);
    setShowObjectAddressSuggestions(false);
    setShowWorkTypesDropdown(false);
    setShowModal(true);
  };

  const loadRequestWorkTypes = async (requestId: string) => {
    try {
      const { data } = await supabase
        .from('kosztorys_request_work_types')
        .select('work_type_id')
        .eq('request_id', requestId);

      if (data) {
        setSelectedWorkTypes(data.map(d => d.work_type_id));
      } else {
        // Fallback: convert legacy installation_types to work type IDs
        setSelectedWorkTypes([]);
      }
    } catch (err) {
      console.error('Error loading request work types:', err);
      setSelectedWorkTypes([]);
    }
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingRequest(null);
    setEditingObjectCode(false);
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
  };

  const handleViewRequest = (request: KosztorysRequest) => {
    setSelectedRequest(request);
    setShowDetailModal(true);
  };

  const filteredRequests = useMemo(() => {
    let filtered = requests;

    if (search.trim()) {
      const s = search.toLowerCase();
      filtered = filtered.filter(r =>
        r.request_number.toLowerCase().includes(s) ||
        r.client_name.toLowerCase().includes(s) ||
        r.investment_name.toLowerCase().includes(s) ||
        r.contact_person.toLowerCase().includes(s)
      );
    }

    if (statusFilter === 'not_cancelled') {
      filtered = filtered.filter(r => r.status !== 'cancelled');
    } else if (statusFilter !== 'all') {
      filtered = filtered.filter(r => r.status === statusFilter);
    }

    if (objectTypeFilter !== 'all') {
      filtered = filtered.filter(r => r.object_type === objectTypeFilter);
    }

    return filtered;
  }, [requests, search, statusFilter, objectTypeFilter]);

  const stats = useMemo(() => ({
    total: requests.length,
    new: requests.filter(r => r.status === 'new').length,
    in_progress: requests.filter(r => r.status === 'in_progress').length,
    pending_approval: requests.filter(r => r.status === 'estimate_generated').length,
    overdue: requests.filter(r =>
      r.planned_response_date &&
      new Date(r.planned_response_date) < new Date() &&
      !['closed', 'cancelled', 'kp_sent'].includes(r.status)
    ).length
  }), [requests]);

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('pl-PL');
  };

  const isOverdue = (request: KosztorysRequest) => {
    if (!request.planned_response_date) return false;
    if (['closed', 'cancelled', 'kp_sent'].includes(request.status)) return false;
    return new Date(request.planned_response_date) < new Date();
  };

  // Get deadline status for highlighting: 'ok' | 'warning' (<7 days) | 'danger' (<2 days) | 'overdue'
  const getDeadlineStatus = (request: KosztorysRequest): 'ok' | 'warning' | 'danger' | 'overdue' | null => {
    if (!request.planned_response_date) return null;
    if (['closed', 'cancelled', 'kp_sent'].includes(request.status)) return null;

    const deadline = new Date(request.planned_response_date);
    const now = new Date();
    const diffMs = deadline.getTime() - now.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    if (diffDays < 0) return 'overdue';
    if (diffDays < 2) return 'danger';
    if (diffDays < 7) return 'warning';
    return 'ok';
  };

  const getDeadlineStyle = (status: 'ok' | 'warning' | 'danger' | 'overdue' | null) => {
    switch (status) {
      case 'overdue': return 'text-red-600 font-semibold bg-red-50';
      case 'danger': return 'text-pink-600 font-medium bg-pink-50';
      case 'warning': return 'text-amber-600 font-medium bg-amber-50';
      default: return 'text-slate-600';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-2xl font-bold text-slate-900">{stats.total}</div>
          <div className="text-sm text-slate-500">Wszystkie</div>
        </div>
        <div className="bg-blue-50 rounded-xl border border-blue-200 p-4">
          <div className="text-2xl font-bold text-blue-700">{stats.new}</div>
          <div className="text-sm text-blue-600">Nowe</div>
        </div>
        <div className="bg-amber-50 rounded-xl border border-amber-200 p-4">
          <div className="text-2xl font-bold text-amber-700">{stats.in_progress}</div>
          <div className="text-sm text-amber-600">W pracy</div>
        </div>
        <div className="bg-indigo-50 rounded-xl border border-indigo-200 p-4">
          <div className="text-2xl font-bold text-indigo-700">{stats.pending_approval}</div>
          <div className="text-sm text-indigo-600">Do zatwierdzenia</div>
        </div>
        {stats.overdue > 0 && (
          <div className="bg-red-50 rounded-xl border border-red-200 p-4">
            <div className="text-2xl font-bold text-red-700">{stats.overdue}</div>
            <div className="text-sm text-red-600">Przeterminowane</div>
          </div>
        )}
      </div>

      {/* Search and filters */}
      <div className="mb-4 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[250px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input
            type="text"
            placeholder="Szukaj po numerze, kliencie, inwestycji..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border transition ${
            showFilters || statusFilter !== 'all' || objectTypeFilter !== 'all'
              ? 'bg-blue-50 border-blue-200 text-blue-700'
              : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
        >
          <Filter className="w-4 h-4" />
          Filtry
          {(statusFilter !== 'all' || objectTypeFilter !== 'all') && (
            <span className="w-2 h-2 bg-blue-500 rounded-full" />
          )}
        </button>

        <button
          onClick={() => handleOpenModal()}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition"
        >
          <Plus className="w-4 h-4" />
          Nowe zapytanie
        </button>
      </div>

      {/* Filters panel */}
      {showFilters && (
        <div className="mb-4 p-4 bg-slate-50 rounded-xl border border-slate-200 flex flex-wrap gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as KosztorysRequestStatus | 'all' | 'not_cancelled')}
              className="px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="not_cancelled">Aktywne (bez anulowanych)</option>
              <option value="all">Wszystkie</option>
              {Object.entries(STATUS_CONFIG).map(([key, { label }]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Typ obiektu</label>
            <select
              value={objectTypeFilter}
              onChange={e => setObjectTypeFilter(e.target.value as KosztorysObjectType | 'all')}
              className="px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">Wszystkie</option>
              {Object.entries(OBJECT_TYPE_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
          <button
            onClick={() => { setStatusFilter('all'); setObjectTypeFilter('all'); }}
            className="self-end px-3 py-2 text-sm text-slate-600 hover:text-slate-900"
          >
            Wyczyść filtry
          </button>
        </div>
      )}

      {/* Requests list */}
      {filteredRequests.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
          <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <p className="text-slate-500 mb-4">
            {requests.length === 0
              ? 'Brak zapytań. Utwórz pierwsze zapytanie o kosztorys.'
              : 'Brak zapytań pasujących do kryteriów wyszukiwania.'}
          </p>
          {requests.length === 0 && (
            <button
              onClick={() => handleOpenModal()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              Dodaj zapytanie
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-slate-700">Numer</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-slate-700">Klient / Inwestycja</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-slate-700">Typ</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-slate-700">Rodzaj prac</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-slate-700">Status</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-slate-700">Termin</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-slate-700">Odpowiedzialny</th>
                  <th className="w-12"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRequests.map(request => {
                  const statusConfig = STATUS_CONFIG[request.status];
                  const StatusIcon = statusConfig.icon;
                  const deadlineStatus = getDeadlineStatus(request);

                  // Row background based on deadline status
                  const getRowBg = () => {
                    switch (deadlineStatus) {
                      case 'overdue': return 'bg-red-50/70';
                      case 'danger': return 'bg-pink-50/50';
                      case 'warning': return 'bg-amber-50/50';
                      default: return '';
                    }
                  };

                  return (
                    <tr
                      key={request.id}
                      className={`hover:bg-slate-50 cursor-pointer transition ${getRowBg()}`}
                      onClick={() => handleViewRequest(request)}
                    >
                      <td className="px-4 py-3">
                        <span className="font-mono text-sm font-medium text-slate-900">
                          {request.request_number}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{request.client_name}</div>
                        <div className="text-sm text-slate-500 truncate max-w-xs">{request.investment_name}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-slate-600">
                          {OBJECT_TYPE_LABELS[request.object_type]}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-slate-600">
                          {request.work_types && request.work_types.length > 0
                            ? request.work_types.map(wt => wt.work_type?.code || wt.work_type_id).join(', ')
                            : request.installation_types || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${statusConfig.bgColor} ${statusConfig.color}`}>
                          <StatusIcon className="w-3.5 h-3.5" />
                          {statusConfig.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {(() => {
                          const deadlineStatus = getDeadlineStatus(request);
                          return (
                            <span className={`text-sm px-2 py-1 rounded ${getDeadlineStyle(deadlineStatus)}`}>
                              {formatDate(request.planned_response_date)}
                              {deadlineStatus === 'overdue' && <AlertCircle className="inline w-4 h-4 ml-1" />}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-slate-600">
                          {request.assigned_user
                            ? `${request.assigned_user.first_name} ${request.assigned_user.last_name}`
                            : '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {request.status === 'new' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStatusChange(request, 'in_progress');
                                setSelectedRequest(request);
                                setShowPrepareOfferModal(true);
                              }}
                              className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                              title="Weź w pracę"
                            >
                              <Play className="w-4 h-4" />
                            </button>
                          )}
                          {request.status === 'in_progress' && (
                            <>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedRequest(request);
                                  setShowPrepareOfferModal(true);
                                }}
                                className="p-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition"
                                title="Przygotuj ofertę"
                              >
                                <Calculator className="w-4 h-4" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleStatusChange(request, 'cancelled');
                                }}
                                className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition"
                                title="Anuluj zapytanie"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </>
                          )}
                          {request.status === 'cancelled' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStatusChange(request, 'in_progress');
                              }}
                              className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition"
                              title="Przywróć zapytanie"
                            >
                              <RotateCcw className="w-4 h-4" />
                            </button>
                          )}
                          {!['new', 'in_progress'].includes(request.status) && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleViewRequest(request);
                              }}
                              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition"
                              title="Zobacz szczegóły"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create/Edit Modal - z-index higher than detail modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b border-slate-200 flex justify-between items-center">
              <h2 className="text-xl font-bold text-slate-900">
                {editingRequest ? 'Edytuj zapytanie' : 'Nowe zapytanie o kosztorys'}
              </h2>
              <button onClick={handleCloseModal} className="p-2 hover:bg-slate-100 rounded-lg">
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
                        // Delay hiding to allow click on dropdown
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

                {/* Company address with OSM autocomplete */}
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
                    {showAddSource ? (
                      <div className="flex gap-1">
                        <input
                          type="text"
                          value={newSourceOption}
                          onChange={e => setNewSourceOption(e.target.value)}
                          placeholder="Nowe źródło..."
                          className="flex-1 px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                          autoFocus
                          onKeyDown={e => {
                            if (e.key === 'Enter' && newSourceOption.trim()) {
                              setCustomSources(prev => [...prev, newSourceOption.trim()]);
                              setFormData(prev => ({ ...prev, request_source: newSourceOption.trim() as any }));
                              setNewSourceOption('');
                              setShowAddSource(false);
                            }
                            if (e.key === 'Escape') setShowAddSource(false);
                          }}
                        />
                        <button onClick={() => { if (newSourceOption.trim()) { setCustomSources(prev => [...prev, newSourceOption.trim()]); setFormData(prev => ({ ...prev, request_source: newSourceOption.trim() as any })); setNewSourceOption(''); } setShowAddSource(false); }} className="px-2 py-2 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700">OK</button>
                        <button onClick={() => setShowAddSource(false)} className="px-2 py-2 text-slate-600 border border-slate-200 rounded-lg text-xs hover:bg-slate-50">✕</button>
                      </div>
                    ) : (
                      <div className="flex gap-1">
                        <select
                          value={formData.request_source}
                          onChange={e => setFormData(prev => ({ ...prev, request_source: e.target.value as KosztorysRequestSource }))}
                          className="flex-1 px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                        >
                          {Object.entries(SOURCE_LABELS).map(([key, label]) => (
                            <option key={key} value={key}>{label}</option>
                          ))}
                          {customSources.map(s => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                        <button onClick={() => setShowAddSource(true)} className="px-2 py-2 text-blue-600 border border-blue-200 bg-blue-50 rounded-lg hover:bg-blue-100 flex-shrink-0" title="Dodaj nowe źródło">
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    )}
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
                      onChange={e => selectExistingContactForRequest(e.target.value)}
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
                      <button
                        type="button"
                        onClick={() => setShowWorkTypesDropdown(!showWorkTypesDropdown)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white text-left flex items-center justify-between"
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
                    </div>
                  </div>
                  <div className="col-span-6">
                    <label className="block text-sm font-medium text-slate-700 mb-1">Typ obiektu</label>
                    {showAddObjectCategory ? (
                      <div className="flex gap-1">
                        <input
                          type="text"
                          value={newObjectCategoryOption}
                          onChange={e => setNewObjectCategoryOption(e.target.value)}
                          placeholder="Nowy typ obiektu..."
                          className="flex-1 px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                          autoFocus
                          onKeyDown={async e => {
                            if (e.key === 'Enter' && newObjectCategoryOption.trim()) {
                              const code = newObjectCategoryOption.trim().toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 50) || `cat_${Date.now()}`;
                              const { data } = await supabase.from('kosztorys_object_categories').insert({ name: newObjectCategoryOption.trim(), code, company_id: currentUser?.company_id, is_active: true }).select().single();
                              if (data) { setObjectCategories(prev => [...prev, data]); setFormData(prev => ({ ...prev, object_category_id: data.id })); }
                              setNewObjectCategoryOption('');
                              setShowAddObjectCategory(false);
                            }
                            if (e.key === 'Escape') setShowAddObjectCategory(false);
                          }}
                        />
                        <button onClick={async () => { if (newObjectCategoryOption.trim()) { const code = newObjectCategoryOption.trim().toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 50) || `cat_${Date.now()}`; const { data } = await supabase.from('kosztorys_object_categories').insert({ name: newObjectCategoryOption.trim(), code, company_id: currentUser?.company_id, is_active: true }).select().single(); if (data) { setObjectCategories(prev => [...prev, data]); setFormData(prev => ({ ...prev, object_category_id: data.id })); } } setNewObjectCategoryOption(''); setShowAddObjectCategory(false); }} className="px-2 py-2 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700">OK</button>
                        <button onClick={() => setShowAddObjectCategory(false)} className="px-2 py-2 text-slate-600 border border-slate-200 rounded-lg text-xs hover:bg-slate-50">✕</button>
                      </div>
                    ) : (
                      <div className="flex gap-1">
                        <select
                          value={formData.object_category_id}
                          onChange={e => setFormData(prev => ({ ...prev, object_category_id: e.target.value }))}
                          className="flex-1 px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">-- Wybierz (opcjonalnie) --</option>
                          {objectCategories.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                        <button onClick={() => setShowAddObjectCategory(true)} className="px-2 py-2 text-blue-600 border border-blue-200 bg-blue-50 rounded-lg hover:bg-blue-100 flex-shrink-0" title="Dodaj nowy typ obiektu">
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Object address with OSM autocomplete */}
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
                      <option value="company">Po stronie {currentCompany?.name || 'Firmy'}</option>
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
                      <option value="company">Po stronie {currentCompany?.name || 'Firmy'}</option>
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
                onClick={handleCloseModal}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Anuluj
              </button>
              <button
                onClick={handleSaveRequest}
                disabled={saving || !formData.client_name.trim() || !formData.investment_name.trim() || !contacts.some(c => c.first_name.trim() && c.last_name.trim())}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingRequest ? 'Zapisz zmiany' : 'Utwórz zapytanie'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {showDetailModal && selectedRequest && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b border-slate-200">
              <div className="flex justify-between items-start">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="font-mono text-lg font-bold text-slate-900">
                      {selectedRequest.request_number}
                    </span>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_CONFIG[selectedRequest.status].bgColor} ${STATUS_CONFIG[selectedRequest.status].color}`}>
                      {React.createElement(STATUS_CONFIG[selectedRequest.status].icon, { className: 'w-3.5 h-3.5' })}
                      {STATUS_CONFIG[selectedRequest.status].label}
                    </span>
                  </div>
                  <h2 className="text-xl font-bold text-slate-900">{selectedRequest.investment_name}</h2>
                  <p className="text-slate-600">{selectedRequest.client_name}</p>
                </div>
                <button onClick={() => setShowDetailModal(false)} className="p-2 hover:bg-slate-100 rounded-lg">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              {/* Główny przycisk akcji - Weź w pracę otwiera Przygotuj ofertę */}
              {selectedRequest.status === 'new' && (
                <div className="mb-6">
                  <button
                    onClick={() => {
                      handleStatusChange(selectedRequest, 'in_progress');
                      setShowPrepareOfferModal(true);
                    }}
                    className="w-full px-4 py-3 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 flex items-center justify-center gap-2"
                  >
                    <Play className="w-5 h-5" />
                    Weź w pracę
                  </button>
                </div>
              )}

              <div className="grid grid-cols-2 gap-6">
                {/* Left column */}
                <div className="space-y-6">
                  {/* Blok: Dane Klienta */}
                  <div className="bg-slate-50 rounded-xl p-4">
                    <h3 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                      <Building2 className="w-5 h-5 text-blue-500" />
                      Dane Klienta
                    </h3>
                    <div className="space-y-2 text-sm">
                      {selectedRequest.nip && (
                        <div className="flex justify-between">
                          <span className="text-slate-500">NIP:</span>
                          <span className="font-mono font-medium">{selectedRequest.nip}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-slate-500">Nazwa firmy:</span>
                        <span className="font-medium">{selectedRequest.client_name}</span>
                      </div>
                      {(selectedRequest.company_street || selectedRequest.company_city) && (
                        <div className="flex justify-between">
                          <span className="text-slate-500">Adres:</span>
                          <span className="font-medium text-right">
                            {[
                              selectedRequest.company_street,
                              selectedRequest.company_street_number
                            ].filter(Boolean).join(' ')}
                            {selectedRequest.company_city && (
                              <>, {selectedRequest.company_postal_code} {selectedRequest.company_city}</>
                            )}
                          </span>
                        </div>
                      )}
                      {selectedRequest.internal_notes && (
                        <div className="mt-3 pt-3 border-t border-slate-200">
                          <span className="text-slate-500 text-xs block mb-1">Notatka wewnętrzna:</span>
                          <p className="text-slate-700 bg-amber-50 p-2 rounded text-xs">{selectedRequest.internal_notes}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Blok: Przedstawiciel firmy */}
                  <div className="bg-slate-50 rounded-xl p-4">
                    <h3 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                      <User className="w-5 h-5 text-green-500" />
                      Przedstawiciel firmy
                    </h3>
                    {(() => {
                      const primaryContact = selectedRequest.contacts?.find(c => c.is_primary) || selectedRequest.contacts?.[0];
                      if (primaryContact) {
                        return (
                          <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                              <span className="text-slate-500">Imię:</span>
                              <span className="font-medium">{primaryContact.first_name}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-500">Nazwisko:</span>
                              <span className="font-medium">{primaryContact.last_name}</span>
                            </div>
                            {primaryContact.phone && (
                              <div className="flex justify-between">
                                <span className="text-slate-500">Telefon:</span>
                                <a href={`tel:${primaryContact.phone}`} className="text-blue-600 hover:underline font-medium">
                                  {primaryContact.phone}
                                </a>
                              </div>
                            )}
                            {primaryContact.email && (
                              <div className="flex justify-between">
                                <span className="text-slate-500">Email:</span>
                                <a href={`mailto:${primaryContact.email}`} className="text-blue-600 hover:underline font-medium">
                                  {primaryContact.email}
                                </a>
                              </div>
                            )}
                            {primaryContact.position && (
                              <div className="flex justify-between">
                                <span className="text-slate-500">Stanowisko:</span>
                                <span className="font-medium">{primaryContact.position}</span>
                              </div>
                            )}
                          </div>
                        );
                      } else {
                        // Fallback to legacy fields
                        return (
                          <div className="space-y-2 text-sm">
                            <div className="flex items-center gap-2">
                              <span>{selectedRequest.contact_person}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Phone className="w-4 h-4 text-slate-400" />
                              <a href={`tel:${selectedRequest.phone}`} className="text-blue-600 hover:underline">
                                {selectedRequest.phone}
                              </a>
                            </div>
                            {selectedRequest.email && (
                              <div className="flex items-center gap-2">
                                <Mail className="w-4 h-4 text-slate-400" />
                                <a href={`mailto:${selectedRequest.email}`} className="text-blue-600 hover:underline">
                                  {selectedRequest.email}
                                </a>
                              </div>
                            )}
                          </div>
                        );
                      }
                    })()}
                  </div>

                  {/* Blok: Dane Obiektu */}
                  <div className="bg-slate-50 rounded-xl p-4">
                    <h3 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                      <Building2 className="w-5 h-5 text-indigo-500" />
                      Dane Obiektu
                    </h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Nazwa obiektu:</span>
                        <span className="font-medium">{selectedRequest.investment_name}</span>
                      </div>
                      {((selectedRequest as any).object_street || (selectedRequest as any).object_city) && (
                        <div className="flex justify-between">
                          <span className="text-slate-500">Adres:</span>
                          <span className="font-medium text-right">
                            {[
                              (selectedRequest as any).object_street,
                              (selectedRequest as any).object_street_number
                            ].filter(Boolean).join(' ')}
                            {(selectedRequest as any).object_city && (
                              <>, {(selectedRequest as any).object_postal_code} {(selectedRequest as any).object_city}</>
                            )}
                          </span>
                        </div>
                      )}
                      {selectedRequest.object_code && (
                        <div className="flex justify-between">
                          <span className="text-slate-500">Kod obiektu:</span>
                          <span className="font-mono font-medium bg-slate-200 px-2 py-0.5 rounded">{selectedRequest.object_code}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-slate-500">Typ obiektu:</span>
                        <span className="font-medium">{OBJECT_TYPE_LABELS[selectedRequest.object_type]}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right column */}
                <div className="space-y-6">
                  {/* Blok: Parametry */}
                  <div className="bg-slate-50 rounded-xl p-4">
                    <h3 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                      <FileSpreadsheet className="w-5 h-5 text-purple-500" />
                      Parametry
                    </h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Rodzaj prac:</span>
                        <span className="font-medium">
                          {selectedRequest.work_types && selectedRequest.work_types.length > 0
                            ? selectedRequest.work_types.map(wt => wt.work_type?.name || wt.work_type?.code).join(', ')
                            : INSTALLATION_TYPE_LABELS[selectedRequest.installation_types]}
                        </span>
                      </div>
                      {(selectedRequest as any).main_material_side && (
                        <div className="flex justify-between">
                          <span className="text-slate-500">Materiał Główny:</span>
                          <span className="font-medium">
                            {(selectedRequest as any).main_material_side === 'investor' && 'Po stronie Inwestora'}
                            {(selectedRequest as any).main_material_side === 'client' && `Po stronie ${selectedRequest.client_name}`}
                            {(selectedRequest as any).main_material_side === 'company' && `Po stronie ${currentCompany?.name || 'Firmy'}`}
                          </span>
                        </div>
                      )}
                      {(selectedRequest as any).minor_material_side && (
                        <div className="flex justify-between">
                          <span className="text-slate-500">Materiał Drobny:</span>
                          <span className="font-medium">
                            {(selectedRequest as any).minor_material_side === 'investor' && 'Po stronie Inwestora'}
                            {(selectedRequest as any).minor_material_side === 'client' && `Po stronie ${selectedRequest.client_name}`}
                            {(selectedRequest as any).minor_material_side === 'company' && `Po stronie ${currentCompany?.name || 'Firmy'}`}
                          </span>
                        </div>
                      )}
                      {selectedRequest.request_source && (
                        <div className="flex justify-between">
                          <span className="text-slate-500">Źródło zapytania:</span>
                          <span className="font-medium">{SOURCE_LABELS[selectedRequest.request_source]}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Blok: Terminy i odpowiedzialny */}
                  <div className="bg-slate-50 rounded-xl p-4">
                    <h3 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                      <Calendar className="w-5 h-5 text-amber-500" />
                      Terminy
                    </h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Data utworzenia:</span>
                        <span className="font-medium">{formatDate(selectedRequest.created_at)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Planowana odpowiedź:</span>
                        <span className={`font-medium px-2 py-0.5 rounded ${getDeadlineStyle(getDeadlineStatus(selectedRequest))}`}>
                          {formatDate(selectedRequest.planned_response_date)}
                          {isOverdue(selectedRequest) && ' (przeterminowane)'}
                        </span>
                      </div>
                      <div className="flex justify-between items-center pt-2 mt-2 border-t border-slate-200">
                        <span className="text-slate-500">Odpowiedzialny:</span>
                        {selectedRequest.assigned_user ? (
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center">
                              <span className="text-xs font-medium text-blue-700">
                                {selectedRequest.assigned_user.first_name[0]}
                                {selectedRequest.assigned_user.last_name[0]}
                              </span>
                            </div>
                            <span className="font-medium">{selectedRequest.assigned_user.first_name} {selectedRequest.assigned_user.last_name}</span>
                          </div>
                        ) : (
                          <span className="text-slate-400">Nie przypisano</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Uwagi klienta */}
                  {selectedRequest.notes && (
                    <div className="bg-slate-50 rounded-xl p-4">
                      <h3 className="font-semibold text-slate-900 mb-3">Uwagi od klienta</h3>
                      <p className="text-sm text-slate-600 bg-white p-3 rounded-lg border border-slate-200">
                        {selectedRequest.notes}
                      </p>
                    </div>
                  )}
                </div>
              </div>

            </div>

            <div className="p-6 border-t border-slate-200 flex justify-between">
              <div className="flex gap-2">
                <button
                  onClick={() => handleOpenModal(selectedRequest)}
                  className="flex items-center gap-2 px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  <Pencil className="w-4 h-4" />
                  Edytuj
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(selectedRequest)}
                  className="flex items-center gap-2 px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg"
                >
                  <Trash2 className="w-4 h-4" />
                  Usuń
                </button>
              </div>
              <button
                onClick={() => setShowDetailModal(false)}
                className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200"
              >
                Zamknij
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Potwierdź usunięcie</h3>
            <p className="text-slate-600 mb-4">
              Czy na pewno chcesz usunąć zapytanie <strong>{showDeleteConfirm.request_number}</strong>?
              Ta operacja jest nieodwracalna.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Anuluj
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                Usuń
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Prepare Offer Modal */}
      {showPrepareOfferModal && selectedRequest && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70] p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden">
            <div className="p-6 border-b border-slate-200">
              <h2 className="text-xl font-bold text-slate-900">Przygotuj ofertę</h2>
              <p className="text-slate-600 mt-1">Wybierz sposób przygotowania oferty dla zapytania</p>
            </div>

            <div className="p-6 space-y-3">
              <button
                onClick={handleGoToFormulary}
                disabled={checkingForm}
                className="w-full flex items-center gap-4 p-4 rounded-xl border border-slate-200 hover:bg-slate-50 hover:border-blue-300 transition text-left group disabled:opacity-50"
              >
                <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center group-hover:bg-purple-200 transition">
                  {checkingForm ? (
                    <Loader2 className="w-6 h-6 text-purple-600 animate-spin" />
                  ) : (
                    <ClipboardList className="w-6 h-6 text-purple-600" />
                  )}
                </div>
                <div>
                  <div className="font-medium text-slate-900">Przejdź do formularza</div>
                  <div className="text-sm text-slate-500">Wypełnij formularz techniczny i wygeneruj kosztorys automatycznie</div>
                </div>
              </button>

              <button
                onClick={() => {
                  setShowPrepareOfferModal(false);
                  window.location.hash = `#/construction/estimates?request=${selectedRequest.id}`;
                }}
                className="w-full flex items-center gap-4 p-4 rounded-xl border border-slate-200 hover:bg-slate-50 hover:border-blue-300 transition text-left group"
              >
                <div className="w-12 h-12 bg-indigo-100 rounded-lg flex items-center justify-center group-hover:bg-indigo-200 transition">
                  <Calculator className="w-6 h-6 text-indigo-600" />
                </div>
                <div>
                  <div className="font-medium text-slate-900">Przejść do Kosztorysowania</div>
                  <div className="text-sm text-slate-500">Utwórz kosztorys ręcznie w module kosztorysowania</div>
                </div>
              </button>

              <button
                onClick={() => {
                  setShowPrepareOfferModal(false);
                  window.location.hash = `#/construction/offers?request=${selectedRequest.id}`;
                }}
                className="w-full flex items-center gap-4 p-4 rounded-xl border border-slate-200 hover:bg-slate-50 hover:border-blue-300 transition text-left group"
              >
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center group-hover:bg-blue-200 transition">
                  <FileText className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <div className="font-medium text-slate-900">Przejść do Ofertowania</div>
                  <div className="text-sm text-slate-500">Utwórz ofertę handlową bezpośrednio</div>
                </div>
              </button>
            </div>

            <div className="p-6 border-t border-slate-200 flex justify-end">
              <button
                onClick={() => setShowPrepareOfferModal(false)}
                className="flex items-center gap-2 px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                <ArrowLeft className="w-4 h-4" />
                Powrót
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Form Selection Modal - Wizard */}
      {showFormSelectionModal && selectedRequest && (() => {
        // Get work types from relation or fallback to installation_types field
        let requestWorkTypes: { code: string; name: string }[] = [];

        if (selectedRequest.work_types && selectedRequest.work_types.length > 0) {
          requestWorkTypes = selectedRequest.work_types.map((wt: any) => ({
            code: wt.work_type?.code || wt.work_type_id,
            name: wt.work_type?.name || wt.work_type?.code || wt.work_type_id
          }));
        } else if (selectedRequest.installation_types) {
          const types = selectedRequest.installation_types.split(',').map((t: string) => t.trim());
          requestWorkTypes = types.map((t: string) => ({
            code: t,
            name: t === 'IE' ? 'Instalacje elektryczne' : t === 'IT' ? 'Instalacje teletechniczne' : t
          }));
        }

        const hasMultipleWorkTypes = requestWorkTypes.length > 1;
        const isIndustrial = selectedRequest.object_type === 'industrial';

        // All available templates with work type compatibility
        const allTemplates = [
          { code: 'PREM-IE', name: 'Przemysłowe - IE', desc: 'Hale, magazyny, obiekty przemysłowe', forWorkTypes: ['IE'], forObjectTypes: ['industrial'] },
          { code: 'PREM-IT', name: 'Przemysłowe - IT', desc: 'Teletechnika przemysłowa', forWorkTypes: ['IT'], forObjectTypes: ['industrial'] },
          { code: 'MIESZK-IE', name: 'Mieszkania / Biurowce - IE', desc: 'Budynki mieszkalne i biurowe', forWorkTypes: ['IE'], forObjectTypes: ['residential', 'office'] },
          { code: 'MIESZK-IT', name: 'Mieszkania / Biurowce - IT', desc: 'Teletechnika mieszkaniowa', forWorkTypes: ['IT'], forObjectTypes: ['residential', 'office'] }
        ];

        // Get templates compatible with work type and object type (excluding hidden)
        const getCompatibleTemplates = (workTypeCode: string) => {
          const isIE = workTypeCode.toUpperCase().includes('IE');
          const targetWorkType = isIE ? 'IE' : 'IT';
          return allTemplates.filter(t =>
            !hiddenSystemTemplates.includes(t.code) &&
            t.forWorkTypes.includes(targetWorkType) &&
            (t.forObjectTypes.includes(selectedRequest.object_type) || t.forObjectTypes.includes('*'))
          );
        };

        // Get recommended template for a work type
        const getRecommendedTemplate = (workTypeCode: string) => {
          const isIE = workTypeCode.toUpperCase().includes('IE');
          if (isIndustrial) return isIE ? 'PREM-IE' : 'PREM-IT';
          return isIE ? 'MIESZK-IE' : 'MIESZK-IT';
        };

        // Current work type being configured (for wizard)
        const currentWorkType = wizardStep > 0 && wizardStep <= requestWorkTypes.length
          ? requestWorkTypes[wizardStep - 1]
          : null;

        const compatibleTemplates = currentWorkType ? getCompatibleTemplates(currentWorkType.code) : [];

        const closeModal = () => {
          setShowFormSelectionModal(false);
          setWorkTypeTemplates({});
          setWizardStep(0);
          setShowTemplateManagement(false);
          setEditingTemplate(null);
        };

        const handleGoToFormulary = (templates: Record<string, string>) => {
          closeModal();
          if (Object.keys(templates).length > 1) {
            const templatesParam = encodeURIComponent(JSON.stringify(templates));
            window.location.hash = `#/construction/formulary/${selectedRequest.id}?templates=${templatesParam}`;
          } else {
            const template = Object.values(templates)[0] || getRecommendedTemplate(requestWorkTypes[0]?.code || 'IE');
            window.location.hash = `#/construction/formulary/${selectedRequest.id}?template=${template}`;
          }
        };

        const handleSelectRecommended = () => {
          const recommended: Record<string, string> = {};
          requestWorkTypes.forEach(wt => {
            recommended[wt.code] = getRecommendedTemplate(wt.code);
          });
          handleGoToFormulary(recommended);
        };

        const handleSelectTemplate = (templateCode: string) => {
          if (!currentWorkType) return;

          const newTemplates = { ...workTypeTemplates, [currentWorkType.code]: templateCode };
          setWorkTypeTemplates(newTemplates);

          // Move to next step or finish
          if (wizardStep < requestWorkTypes.length) {
            setWizardStep(wizardStep + 1);
          } else {
            handleGoToFormulary(newTemplates);
          }
        };

        // Check if we're on the last step and all templates are selected
        const isLastStepComplete = wizardStep === requestWorkTypes.length &&
          requestWorkTypes.every(wt => workTypeTemplates[wt.code]);

        return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70] p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden">
            {/* Header */}
            <div className="p-6 border-b border-slate-200">
              {showTemplateManagement ? (
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-bold text-slate-900">Zarządzanie szablonami</h2>
                  <button
                    onClick={() => setShowTemplateManagement(false)}
                    className="p-2 hover:bg-slate-100 rounded-lg"
                  >
                    <X className="w-5 h-5 text-slate-500" />
                  </button>
                </div>
              ) : wizardStep === 0 ? (
                <>
                  <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold text-slate-900">Wybierz formularz</h2>
                    <button
                      onClick={() => setShowTemplateManagement(true)}
                      className="flex items-center gap-2 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition"
                      title="Zarządzanie szablonami"
                    >
                      <Settings className="w-4 h-4" />
                      <span className="hidden sm:inline">Szablony</span>
                    </button>
                  </div>
                  <p className="text-slate-600 mt-1">{selectedRequest.investment_name}</p>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold text-slate-900">Wybierz szablon</h2>
                    <span className="text-sm text-slate-500">
                      Krok {wizardStep} z {requestWorkTypes.length}
                    </span>
                  </div>
                  <p className="text-slate-600 mt-1">
                    Dla: <span className="font-semibold text-blue-600">{currentWorkType?.name}</span>
                  </p>
                  {/* Progress dots */}
                  {hasMultipleWorkTypes && (
                    <div className="flex gap-2 mt-3">
                      {requestWorkTypes.map((wt, idx) => (
                        <div
                          key={wt.code}
                          className={`h-2 flex-1 rounded-full transition ${
                            idx < wizardStep - 1 ? 'bg-green-500' :
                            idx === wizardStep - 1 ? 'bg-blue-500' :
                            'bg-slate-200'
                          }`}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Content */}
            <div className="p-6">
              {showTemplateManagement ? (
                /* Template Management View */
                <div className="space-y-3">
                  {editingTemplate ? (
                    /* Edit Template Form - Compact */
                    <div className="space-y-3">
                      {/* System template badge */}
                      {editingTemplate.isSystem && (
                        <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
                          <FileSpreadsheet className="w-4 h-4 text-blue-600" />
                          <span className="text-sm text-blue-700">Szablon systemowy</span>
                        </div>
                      )}

                      {/* Name */}
                      <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1">Nazwa</label>
                        <input
                          type="text"
                          value={templateFormData.name}
                          onChange={(e) => !editingTemplate.isSystem && setTemplateFormData({ ...templateFormData, name: e.target.value })}
                          readOnly={editingTemplate.isSystem}
                          className={`w-full px-3 py-1.5 text-sm border rounded-lg ${
                            editingTemplate.isSystem
                              ? 'border-slate-200 bg-slate-50 text-slate-600'
                              : 'border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500'
                          }`}
                        />
                      </div>

                      {/* Description */}
                      <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1">Opis</label>
                        <textarea
                          value={templateFormData.description}
                          onChange={(e) => !editingTemplate.isSystem && setTemplateFormData({ ...templateFormData, description: e.target.value })}
                          readOnly={editingTemplate.isSystem}
                          rows={2}
                          className={`w-full px-3 py-1.5 text-sm border rounded-lg resize-none ${
                            editingTemplate.isSystem
                              ? 'border-slate-200 bg-slate-50 text-slate-600'
                              : 'border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500'
                          }`}
                          placeholder="Opis szablonu..."
                        />
                      </div>

                      {/* Work Types & Object Type in row */}
                      <div className="flex gap-4">
                        <div className="flex-1">
                          <label className="block text-xs font-medium text-slate-500 mb-1">Typy prac</label>
                          <select
                            value={templateFormData.work_types[0] || ''}
                            onChange={(e) => setTemplateFormData({ ...templateFormData, work_types: e.target.value ? [e.target.value] : [] })}
                            className="w-full px-2 py-1 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="">Wszystkie</option>
                            {workTypes.map((wt) => (
                              <option key={wt.id} value={wt.code}>{wt.code} - {wt.name}</option>
                            ))}
                          </select>
                        </div>
                        <div className="flex-1">
                          <label className="block text-xs font-medium text-slate-500 mb-1">Typ obiektu</label>
                          <select
                            value={templateFormData.object_type}
                            onChange={(e) => setTemplateFormData({ ...templateFormData, object_type: e.target.value })}
                            className="w-full px-2 py-1 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="">Wszystkie</option>
                            <option value="industrial">Przemysłowe</option>
                            <option value="residential">Mieszkaniowe</option>
                            <option value="office">Biurowe</option>
                          </select>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex gap-2 pt-2 border-t border-slate-100">
                        <button
                          onClick={() => setEditingTemplate(null)}
                          className="flex-1 px-3 py-1.5 text-sm border border-slate-300 rounded-lg hover:bg-slate-50 transition"
                        >
                          Anuluj
                        </button>
                        <button
                          onClick={handleUpdateTemplate}
                          className="flex-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                        >
                          Zapisz
                        </button>
                        <button
                          onClick={() => {
                            if (editingTemplate.isSystem) {
                              handleHideSystemTemplate(editingTemplate.form_type);
                              setEditingTemplate(null);
                            } else {
                              handleDeleteTemplate(editingTemplate.id);
                            }
                          }}
                          className="px-3 py-1.5 text-red-600 hover:bg-red-50 rounded-lg transition"
                          title={editingTemplate.isSystem ? 'Ukryj szablon' : 'Usuń szablon'}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Template List - System + Saved */
                    <div className="space-y-4 max-h-[400px] overflow-y-auto">
                      {/* System templates (active) */}
                      {allTemplates.filter(t => !hiddenSystemTemplates.includes(t.code)).length > 0 && (
                        <div>
                          <div className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2 px-1">
                            Szablony systemowe
                          </div>
                          <div className="space-y-2">
                            {allTemplates.filter(t => !hiddenSystemTemplates.includes(t.code)).map((tmpl) => (
                              <button
                                key={tmpl.code}
                                onClick={() => openSystemTemplate(tmpl)}
                                className="w-full flex items-center gap-3 p-2.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-blue-50 hover:border-blue-300 transition text-left group"
                              >
                                <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center group-hover:bg-blue-200 transition">
                                  <FileSpreadsheet className="w-4 h-4 text-blue-600" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-slate-900 text-sm truncate">{tmpl.name}</div>
                                  <div className="text-xs text-slate-500">{tmpl.forWorkTypes.join(', ')}</div>
                                </div>
                                <Eye className="w-4 h-4 text-slate-400 group-hover:text-blue-500" />
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Saved templates (excluding system customizations) */}
                      {savedTemplates.filter(t => !t.template_data?.isSystemCustomization).length > 0 && (
                        <div>
                          <div className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2 px-1">
                            Zapisane szablony
                          </div>
                          <div className="space-y-2">
                            {savedTemplates.filter(t => !t.template_data?.isSystemCustomization).map((tmpl) => (
                              <button
                                key={tmpl.id}
                                onClick={() => openEditTemplate(tmpl)}
                                className="w-full flex items-center gap-3 p-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 hover:border-blue-300 transition text-left group"
                              >
                                <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center group-hover:bg-green-200 transition">
                                  <FileSpreadsheet className="w-4 h-4 text-green-600" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-slate-900 text-sm truncate">{tmpl.name}</div>
                                  <div className="text-xs text-slate-500">
                                    {tmpl.work_type || tmpl.template_data?.work_types?.join(', ') || 'Wszystkie'}
                                  </div>
                                </div>
                                <Pencil className="w-4 h-4 text-slate-400 group-hover:text-blue-500" />
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Hidden system templates */}
                      {hiddenSystemTemplates.length > 0 && (
                        <div>
                          <div className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2 px-1">
                            Ukryte szablony
                          </div>
                          <div className="space-y-2">
                            {allTemplates.filter(t => hiddenSystemTemplates.includes(t.code)).map((tmpl) => (
                              <div
                                key={tmpl.code}
                                className="w-full flex items-center gap-3 p-2.5 rounded-lg border border-slate-200 bg-slate-100 text-left opacity-60"
                              >
                                <div className="w-8 h-8 bg-slate-200 rounded-lg flex items-center justify-center">
                                  <FileSpreadsheet className="w-4 h-4 text-slate-400" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-slate-500 text-sm truncate">{tmpl.name}</div>
                                </div>
                                <button
                                  onClick={() => handleRestoreSystemTemplate(tmpl.code)}
                                  className="p-1.5 text-green-500 hover:text-green-600 hover:bg-green-50 rounded-lg transition"
                                  title="Przywróć szablon"
                                >
                                  <RotateCcw className="w-4 h-4" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : wizardStep === 0 ? (
                /* Main menu */
                <div className="space-y-3">
                  {/* Create new empty form */}
                  <button
                    onClick={() => {
                      closeModal();
                      window.location.hash = `#/construction/formulary/${selectedRequest.id}?new=true`;
                    }}
                    className="w-full flex items-center gap-4 p-4 rounded-xl border border-slate-200 hover:bg-slate-50 hover:border-green-300 transition text-left group"
                  >
                    <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center group-hover:bg-green-200 transition">
                      <Plus className="w-6 h-6 text-green-600" />
                    </div>
                    <div>
                      <div className="font-medium text-slate-900">Utwórz nowy formularz</div>
                      <div className="text-sm text-slate-500">Rozpocznij od pustego formularza</div>
                    </div>
                  </button>

                  {/* Recommended - auto-select */}
                  <button
                    onClick={handleSelectRecommended}
                    className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-blue-200 bg-blue-50 hover:bg-blue-100 hover:border-blue-400 transition text-left group"
                  >
                    <div className="w-12 h-12 bg-blue-200 rounded-lg flex items-center justify-center group-hover:bg-blue-300 transition">
                      <Zap className="w-6 h-6 text-blue-600" />
                    </div>
                    <div>
                      <div className="font-medium text-blue-900 flex items-center gap-2">
                        Zalecany formularz
                        <span className="text-xs px-2 py-0.5 bg-blue-200 text-blue-700 rounded-full">Auto</span>
                      </div>
                      <div className="text-sm text-blue-600">
                        {hasMultipleWorkTypes
                          ? `Automatycznie dopasuje ${requestWorkTypes.length} szablonów`
                          : `Dla: ${OBJECT_TYPE_LABELS[selectedRequest.object_type] || selectedRequest.object_type}`
                        }
                      </div>
                    </div>
                  </button>

                  {/* Manual selection */}
                  {hasMultipleWorkTypes ? (
                    <button
                      onClick={() => setWizardStep(1)}
                      className="w-full flex items-center gap-4 p-4 rounded-xl border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition text-left group"
                    >
                      <div className="w-12 h-12 bg-slate-100 rounded-lg flex items-center justify-center group-hover:bg-slate-200 transition">
                        <FileSpreadsheet className="w-6 h-6 text-slate-600" />
                      </div>
                      <div>
                        <div className="font-medium text-slate-900">Wybierz ręcznie</div>
                        <div className="text-sm text-slate-500">
                          Wybierz szablon dla każdego typu prac osobno
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-slate-400 ml-auto" />
                    </button>
                  ) : (
                    /* Single work type - show template list directly */
                    <div className="pt-2">
                      <div className="text-sm text-slate-500 mb-3 px-1">Lub wybierz inny szablon:</div>
                      <div className="space-y-2">
                        {getCompatibleTemplates(requestWorkTypes[0]?.code || 'IE').map(tmpl => (
                          <button
                            key={tmpl.code}
                            onClick={() => handleGoToFormulary({ [requestWorkTypes[0]?.code || 'IE']: tmpl.code })}
                            className="w-full flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:bg-slate-50 hover:border-blue-300 transition text-left"
                          >
                            <FileSpreadsheet className="w-5 h-5 text-slate-400" />
                            <div>
                              <div className="font-medium text-slate-900 text-sm">{tmpl.name}</div>
                              <div className="text-xs text-slate-500">{tmpl.desc}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* Template selection for current work type */
                <div className="space-y-3">
                  {compatibleTemplates.length > 0 ? (
                    compatibleTemplates.map(tmpl => {
                      const isSelected = workTypeTemplates[currentWorkType?.code || ''] === tmpl.code;
                      const isRecommended = tmpl.code === getRecommendedTemplate(currentWorkType?.code || 'IE');

                      return (
                        <button
                          key={tmpl.code}
                          onClick={() => handleSelectTemplate(tmpl.code)}
                          className={`w-full flex items-center gap-4 p-4 rounded-xl border-2 transition text-left group ${
                            isSelected
                              ? 'border-green-500 bg-green-50'
                              : isRecommended
                              ? 'border-blue-200 bg-blue-50 hover:border-blue-400'
                              : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          <div className={`w-12 h-12 rounded-lg flex items-center justify-center transition ${
                            isSelected ? 'bg-green-200' : isRecommended ? 'bg-blue-200' : 'bg-slate-100 group-hover:bg-slate-200'
                          }`}>
                            {isSelected ? (
                              <Check className="w-6 h-6 text-green-600" />
                            ) : (
                              <FileSpreadsheet className={`w-6 h-6 ${isRecommended ? 'text-blue-600' : 'text-slate-500'}`} />
                            )}
                          </div>
                          <div className="flex-1">
                            <div className="font-medium text-slate-900 flex items-center gap-2">
                              {tmpl.name}
                              {isRecommended && (
                                <span className="text-xs px-2 py-0.5 bg-blue-200 text-blue-700 rounded-full">
                                  Zalecany
                                </span>
                              )}
                            </div>
                            <div className="text-sm text-slate-500">{tmpl.desc}</div>
                          </div>
                          <ChevronRight className={`w-5 h-5 ${isSelected ? 'text-green-500' : 'text-slate-300'}`} />
                        </button>
                      );
                    })
                  ) : (
                    <div className="text-center py-8 text-slate-500">
                      Brak dostępnych szablonów dla tego typu prac
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-slate-200 flex justify-between">
              {showTemplateManagement ? (
                /* Template management footer */
                <button
                  onClick={() => {
                    if (editingTemplate) {
                      setEditingTemplate(null);
                    } else {
                      setShowTemplateManagement(false);
                    }
                  }}
                  className="flex items-center gap-2 px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  <ChevronLeft className="w-4 h-4" />
                  {editingTemplate ? 'Wstecz' : 'Powrót do wyboru'}
                </button>
              ) : (
                /* Regular wizard footer */
                <>
                  <button
                    onClick={() => {
                      if (wizardStep > 0) {
                        setWizardStep(wizardStep - 1);
                      } else {
                        closeModal();
                      }
                    }}
                    className="flex items-center gap-2 px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    {wizardStep > 0 ? 'Wstecz' : 'Anuluj'}
                  </button>
                  {isLastStepComplete && (
                    <button
                      onClick={() => handleGoToFormulary(workTypeTemplates)}
                      className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white hover:bg-green-700 rounded-lg"
                    >
                      <Check className="w-4 h-4" />
                      Przejdź do formularza
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
};

export default RequestsPage;
