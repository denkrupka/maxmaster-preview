
import React, { useState, useEffect, useRef } from 'react';
import {
  Plus, X, Search, Pencil, Trash2, Loader2,
  Building2, Users, Phone, Mail, UserPlus,
  Check, ChevronDown, SearchCheck, AlertCircle, Star
} from 'lucide-react';
import { useAppContext } from '../../context/AppContext';
import { supabase } from '../../lib/supabase';
import {
  ContractorClient, ContractorClientContact,
  ContractorSubcontractor, SubcontractorWorker,
  SkillCategory
} from '../../types';

// ============================================================
// CONSTANTS & HELPERS
// ============================================================

const SUBCONTRACTOR_SKILL_OPTIONS = Object.values(SkillCategory).map(val => ({
  value: val,
  label: val,
}));

const emptyClientForm = {
  name: '', nip: '', address_street: '', address_city: '',
  address_postal_code: '', address_country: 'PL', note: '',
};

const emptyContactForm = {
  first_name: '', last_name: '', phone: '', email: '', position: '', is_main_contact: false,
};

const emptySubcontractorForm = {
  name: '', nip: '', address_street: '', address_city: '',
  address_postal_code: '', address_country: 'PL', note: '',
  workers_count: 0, skills: '' as string,
};

const emptyWorkerForm = {
  first_name: '', last_name: '', phone: '', email: '', position: '', is_main_contact: false,
};

// --- Validation ---
const isValidEmail = (email: string): boolean => {
  if (!email) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

const isValidPhone = (phone: string): boolean => {
  if (!phone) return true;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 9 && digits.length <= 15;
};

const formatPhone = (value: string): string => {
  const hasPlus = value.startsWith('+');
  let digits = value.replace(/\D/g, '');
  if (hasPlus) {
    if (digits.length <= 2) return '+' + digits;
    const cc = digits.slice(0, 2);
    const rest = digits.slice(2);
    const parts = rest.match(/.{1,3}/g) || [];
    return '+' + cc + ' ' + parts.join(' ');
  }
  if (digits.length <= 3) return digits;
  const parts = digits.match(/.{1,3}/g) || [];
  return parts.join(' ');
};

const formatNip = (value: string): string => {
  const digits = value.replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return digits.slice(0, 3) + '-' + digits.slice(3);
  if (digits.length <= 8) return digits.slice(0, 3) + '-' + digits.slice(3, 6) + '-' + digits.slice(6);
  return digits.slice(0, 3) + '-' + digits.slice(3, 6) + '-' + digits.slice(6, 8) + '-' + digits.slice(8);
};

const formatPostalCode = (value: string): string => {
  const digits = value.replace(/\D/g, '').slice(0, 5);
  if (digits.length <= 2) return digits;
  return digits.slice(0, 2) + '-' + digits.slice(2);
};

const formatEmail = (value: string): string => {
  return value.replace(/\s/g, '').toLowerCase();
};

// Shared input class
const inputCls = 'w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors';
const inputErrCls = 'w-full px-3 py-1.5 border border-red-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-400 transition-colors bg-red-50/30';
const labelCls = 'block text-xs font-medium text-slate-500 mb-0.5';

// ============================================================
// MAIN PAGE
// ============================================================

export const ContractorsPage: React.FC = () => {
  const { state } = useAppContext();
  const { currentUser } = state;

  const [activeMainTab, setActiveMainTab] = useState<'clients' | 'subcontractors' | 'suppliers'>('clients');
  const [loading, setLoading] = useState(true);

  // --- Clients state ---
  const [clients, setClients] = useState<ContractorClient[]>([]);
  const [clientSearch, setClientSearch] = useState('');
  const [showClientModal, setShowClientModal] = useState(false);
  const [editingClient, setEditingClient] = useState<ContractorClient | null>(null);
  const [clientForm, setClientForm] = useState(emptyClientForm);
  const [savingClient, setSavingClient] = useState(false);
  const [clientFormErrors, setClientFormErrors] = useState<Record<string, string>>({});

  // Client detail modal
  const [selectedClient, setSelectedClient] = useState<ContractorClient | null>(null);
  const [clientDetailTab, setClientDetailTab] = useState<'dane' | 'kontakty' | 'notatka'>('dane');
  const [clientContacts, setClientContacts] = useState<ContractorClientContact[]>([]);
  const [showAddContact, setShowAddContact] = useState(false);
  const [contactForm, setContactForm] = useState(emptyContactForm);
  const [savingContact, setSavingContact] = useState(false);
  const [contactFormErrors, setContactFormErrors] = useState<Record<string, string>>({});

  // NIP lookup (shared for both clients and subs)
  const [nipLoading, setNipLoading] = useState(false);
  const [nipError, setNipError] = useState('');

  // Invite modal
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteTarget, setInviteTarget] = useState<{ companyName: string; firstName: string; lastName: string; phone: string; type: 'client' | 'sub' } | null>(null);
  const [inviting, setInviting] = useState(false);

  // Main contacts cache for table display
  const [clientMainContacts, setClientMainContacts] = useState<Record<string, ContractorClientContact>>({});
  const [subMainContacts, setSubMainContacts] = useState<Record<string, SubcontractorWorker>>({});
  const [supplierMainContacts, setSupplierMainContacts] = useState<Record<string, ContractorClientContact>>({});

  // --- Suppliers state (same structure as clients, different type) ---
  const [suppliers, setSuppliers] = useState<ContractorClient[]>([]);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<ContractorClient | null>(null);
  const [supplierForm, setSupplierForm] = useState(emptyClientForm);
  const [savingSupplier, setSavingSupplier] = useState(false);
  const [supplierFormErrors, setSupplierFormErrors] = useState<Record<string, string>>({});
  const [supplierNipLoading, setSupplierNipLoading] = useState(false);
  const [supplierNipError, setSupplierNipError] = useState('');

  // Supplier detail modal
  const [selectedSupplier, setSelectedSupplier] = useState<ContractorClient | null>(null);
  const [supplierDetailTab, setSupplierDetailTab] = useState<'dane' | 'kontakty' | 'notatka'>('dane');
  const [supplierContacts, setSupplierContacts] = useState<ContractorClientContact[]>([]);
  const [showAddSupplierContact, setShowAddSupplierContact] = useState(false);
  const [supplierContactForm, setSupplierContactForm] = useState(emptyContactForm);
  const [savingSupplierContact, setSavingSupplierContact] = useState(false);
  const [supplierContactFormErrors, setSupplierContactFormErrors] = useState<Record<string, string>>({});

  // --- Subcontractors state ---
  const [subcontractors, setSubcontractors] = useState<ContractorSubcontractor[]>([]);
  const [subSearch, setSubSearch] = useState('');
  const [showSubModal, setShowSubModal] = useState(false);
  const [editingSub, setEditingSub] = useState<ContractorSubcontractor | null>(null);
  const [subForm, setSubForm] = useState(emptySubcontractorForm);
  const [savingSub, setSavingSub] = useState(false);
  const [subFormErrors, setSubFormErrors] = useState<Record<string, string>>({});

  // Sub NIP lookup
  const [subNipLoading, setSubNipLoading] = useState(false);
  const [subNipError, setSubNipError] = useState('');

  // Subcontractor detail modal
  const [selectedSub, setSelectedSub] = useState<ContractorSubcontractor | null>(null);
  const [subDetailTab, setSubDetailTab] = useState<'dane' | 'przedstawiciele' | 'notatka'>('dane');
  const [subWorkers, setSubWorkers] = useState<SubcontractorWorker[]>([]);
  const [showAddWorker, setShowAddWorker] = useState(false);
  const [workerForm, setWorkerForm] = useState(emptyWorkerForm);
  const [savingWorker, setSavingWorker] = useState(false);
  const [workerFormErrors, setWorkerFormErrors] = useState<Record<string, string>>({});

  // Editing existing contacts / workers (missing CRUD — fix)
  const [editingContact, setEditingContact] = useState<ContractorClientContact | null>(null);
  const [editingSupplierContact, setEditingSupplierContact] = useState<ContractorClientContact | null>(null);
  const [editingWorker, setEditingWorker] = useState<SubcontractorWorker | null>(null);

  // Skills dropdown
  const [showSkillsDropdown, setShowSkillsDropdown] = useState(false);
  const skillsDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (skillsDropdownRef.current && !skillsDropdownRef.current.contains(e.target as Node)) {
        setShowSkillsDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getSelectedSkills = (): string[] => {
    if (!subForm.skills) return [];
    return subForm.skills.split(',').map(s => s.trim()).filter(Boolean);
  };

  const toggleSkill = (skill: string) => {
    const current = getSelectedSkills();
    const updated = current.includes(skill)
      ? current.filter(s => s !== skill)
      : [...current, skill];
    setSubForm({ ...subForm, skills: updated.join(', ') });
  };

  // ============================================================
  // DATA LOADING
  // ============================================================

  useEffect(() => {
    if (currentUser) loadData();
  }, [currentUser]);

  const loadData = async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      const [clientsRes, suppliersRes, subsRes, mainContactsRes, mainWorkersRes] = await Promise.all([
        supabase.from('contractors_clients').select('*').eq('company_id', currentUser.company_id).eq('is_archived', false).or('contractor_type.eq.client,contractor_type.is.null').order('name'),
        supabase.from('contractors_clients').select('*').eq('company_id', currentUser.company_id).eq('is_archived', false).eq('contractor_type', 'supplier').order('name'),
        supabase.from('contractors_subcontractors').select('*').eq('company_id', currentUser.company_id).eq('is_archived', false).order('name'),
        supabase.from('contractor_client_contacts').select('*').eq('company_id', currentUser.company_id).eq('is_main_contact', true),
        supabase.from('subcontractor_workers').select('*').eq('company_id', currentUser.company_id).eq('is_main_contact', true),
      ]);
      if (clientsRes.data) setClients(clientsRes.data);
      if (suppliersRes.data) setSuppliers(suppliersRes.data);
      if (subsRes.data) setSubcontractors(subsRes.data);
      if (mainContactsRes.data) {
        const map: Record<string, ContractorClientContact> = {};
        const smap: Record<string, ContractorClientContact> = {};
        mainContactsRes.data.forEach((c: ContractorClientContact) => {
          // Check if this contact belongs to a supplier or client
          const isSupplier = suppliersRes.data?.some((s: ContractorClient) => s.id === c.client_id);
          if (isSupplier) { smap[c.client_id] = c; }
          else { map[c.client_id] = c; }
        });
        setClientMainContacts(map);
        setSupplierMainContacts(smap);
      }
      if (mainWorkersRes.data) {
        const map: Record<string, SubcontractorWorker> = {};
        mainWorkersRes.data.forEach((w: SubcontractorWorker) => { map[w.subcontractor_id] = w; });
        setSubMainContacts(map);
      }
    } catch (err) {
      console.error('Error loading contractors:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadClientContacts = async (clientId: string) => {
    const { data } = await supabase.from('contractor_client_contacts').select('*').eq('client_id', clientId).order('last_name');
    if (data) setClientContacts(data);
  };

  const loadSubWorkers = async (subId: string) => {
    const { data } = await supabase.from('subcontractor_workers').select('*').eq('subcontractor_id', subId).order('last_name');
    if (data) setSubWorkers(data);
  };

  const refreshMainContacts = async () => {
    if (!currentUser) return;
    const [mainContactsRes, mainWorkersRes] = await Promise.all([
      supabase.from('contractor_client_contacts').select('*').eq('company_id', currentUser.company_id).eq('is_main_contact', true),
      supabase.from('subcontractor_workers').select('*').eq('company_id', currentUser.company_id).eq('is_main_contact', true),
    ]);
    if (mainContactsRes.data) {
      const cmap: Record<string, ContractorClientContact> = {};
      const smap: Record<string, ContractorClientContact> = {};
      const supplierIds = new Set(suppliers.map(s => s.id));
      mainContactsRes.data.forEach((c: ContractorClientContact) => {
        if (supplierIds.has(c.client_id)) { smap[c.client_id] = c; }
        else { cmap[c.client_id] = c; }
      });
      setClientMainContacts(cmap);
      setSupplierMainContacts(smap);
    }
    if (mainWorkersRes.data) {
      const map: Record<string, SubcontractorWorker> = {};
      mainWorkersRes.data.forEach((w: SubcontractorWorker) => { map[w.subcontractor_id] = w; });
      setSubMainContacts(map);
    }
  };

  // ============================================================
  // NIP LOOKUP (Biała Lista VAT - MF API)
  // ============================================================

  const lookupNip = async (formType: 'client' | 'sub') => {
    const nip = formType === 'client' ? clientForm.nip : subForm.nip;
    const rawNip = nip.replace(/\D/g, '');
    if (rawNip.length !== 10) {
      if (formType === 'client') setNipError('NIP musi mieć 10 cyfr');
      else setSubNipError('NIP musi mieć 10 cyfr');
      return;
    }
    if (formType === 'client') { setNipLoading(true); setNipError(''); }
    else { setSubNipLoading(true); setSubNipError(''); }

    try {
      const today = new Date().toISOString().slice(0, 10);
      const res = await fetch(`https://wl-api.mf.gov.pl/api/search/nip/${rawNip}?date=${today}`);
      const json = await res.json();
      if (json.result?.subject) {
        const s = json.result.subject;
        const fullAddress = s.residenceAddress || s.workingAddress || '';
        let street = '', city = '', postal = '';
        const parts = fullAddress.split(',').map((p: string) => p.trim());
        if (parts.length >= 2) {
          street = parts[0];
          const cityPart = parts[parts.length - 1];
          const postalMatch = cityPart.match(/^(\d{2}-\d{3})\s+(.+)/);
          if (postalMatch) {
            postal = postalMatch[1];
            city = postalMatch[2];
          } else {
            city = cityPart;
          }
        } else if (parts.length === 1) {
          city = parts[0];
        }

        if (formType === 'client') {
          setClientForm(prev => ({
            ...prev,
            name: s.name || prev.name,
            address_street: street || prev.address_street,
            address_city: city || prev.address_city,
            address_postal_code: postal || prev.address_postal_code,
          }));
        } else {
          setSubForm(prev => ({
            ...prev,
            name: s.name || prev.name,
            address_street: street || prev.address_street,
            address_city: city || prev.address_city,
            address_postal_code: postal || prev.address_postal_code,
          }));
        }
      } else {
        if (formType === 'client') setNipError('Nie znaleziono podmiotu');
        else setSubNipError('Nie znaleziono podmiotu');
      }
    } catch {
      if (formType === 'client') setNipError('Błąd połączenia z API');
      else setSubNipError('Błąd połączenia z API');
    } finally {
      if (formType === 'client') setNipLoading(false);
      else setSubNipLoading(false);
    }
  };

  // ============================================================
  // INVITE MODAL (SMS invitation)
  // ============================================================

  const handleInvite = async () => {
    if (!inviteTarget || !currentUser) return;
    setInviting(true);
    try {
      // Call edge function to send SMS invitation
      const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL || '';
      await fetch(`${supabaseUrl}/functions/v1/invite-representative`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
        },
        body: JSON.stringify({
          phone: inviteTarget.phone,
          first_name: inviteTarget.firstName,
          last_name: inviteTarget.lastName,
          company_name: inviteTarget.companyName,
          role: 'Client',
          inviting_company_id: currentUser.company_id,
        }),
      });
    } catch (err) {
      console.error('Error sending invite:', err);
    } finally {
      setInviting(false);
      setShowInviteModal(false);
      setInviteTarget(null);
    }
  };

  // ============================================================
  // CLIENT CRUD
  // ============================================================

  const openCreateClient = () => {
    setEditingClient(null);
    setClientForm(emptyClientForm);
    setClientFormErrors({});
    setNipError('');
    setShowClientModal(true);
  };

  const openEditClient = (client: ContractorClient) => {
    setEditingClient(client);
    setClientForm({
      name: client.name, nip: client.nip || '', address_street: client.address_street || '',
      address_city: client.address_city || '', address_postal_code: client.address_postal_code || '',
      address_country: client.address_country || 'PL', note: client.note || '',
    });
    setClientFormErrors({});
    setNipError('');
    setShowClientModal(true);
  };

  const validateClientForm = (): boolean => {
    const errors: Record<string, string> = {};
    if (!clientForm.name.trim()) errors.name = 'Wymagane';
    setClientFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const saveClient = async () => {
    if (!currentUser || !validateClientForm()) return;
    setSavingClient(true);
    try {
      const payload = { ...clientForm, contractor_type: 'client', company_id: currentUser.company_id, updated_at: new Date().toISOString() };
      if (editingClient) {
        const { data } = await supabase.from('contractors_clients').update(payload).eq('id', editingClient.id).select().single();
        if (data) setClients(prev => prev.map(c => c.id === data.id ? data : c));
      } else {
        const { data } = await supabase.from('contractors_clients').insert(payload).select().single();
        if (data) setClients(prev => [data, ...prev]);
      }
      setShowClientModal(false);
    } catch (err) {
      console.error('Error saving client:', err);
    } finally {
      setSavingClient(false);
    }
  };

  const deleteClient = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć tego klienta?')) return;
    await supabase.from('contractors_clients').update({ is_archived: true, updated_at: new Date().toISOString() }).eq('id', id);
    setClients(prev => prev.filter(c => c.id !== id));
  };

  const openClientDetail = (client: ContractorClient) => {
    setSelectedClient(client);
    setClientDetailTab('dane');
    loadClientContacts(client.id);
  };

  // ============================================================
  // CLIENT CONTACTS (PRZEDSTAWICIELE) CRUD
  // ============================================================

  const openEditContact = (contact: ContractorClientContact) => {
    setEditingContact(contact);
    setContactForm({
      first_name: contact.first_name, last_name: contact.last_name,
      phone: contact.phone || '', email: contact.email || '',
      position: contact.position || '', is_main_contact: contact.is_main_contact || false,
    });
    setContactFormErrors({});
    setShowAddContact(true);
  };

  const validateContactForm = (): boolean => {
    const errors: Record<string, string> = {};
    if (!contactForm.first_name.trim()) errors.first_name = 'Wymagane';
    if (!contactForm.last_name.trim()) errors.last_name = 'Wymagane';
    if (!contactForm.phone.trim()) errors.phone = 'Wymagane';
    else if (!isValidPhone(contactForm.phone)) errors.phone = 'Min. 9 cyfr';
    if (!contactForm.email.trim()) errors.email = 'Wymagane';
    else if (!isValidEmail(contactForm.email)) errors.email = 'Nieprawidłowy email';
    setContactFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const saveContact = async () => {
    if (!currentUser || !selectedClient || !validateContactForm()) return;
    setSavingContact(true);
    try {
      if (editingContact) {
        // UPDATE existing contact
        if (contactForm.is_main_contact && !editingContact.is_main_contact) {
          await supabase.from('contractor_client_contacts').update({ is_main_contact: false }).eq('client_id', selectedClient.id).eq('is_main_contact', true);
        }
        const { data } = await supabase.from('contractor_client_contacts')
          .update({ first_name: contactForm.first_name, last_name: contactForm.last_name, phone: contactForm.phone, email: contactForm.email, position: contactForm.position, is_main_contact: contactForm.is_main_contact })
          .eq('id', editingContact.id).select().single();
        if (data) {
          setClientContacts(prev => contactForm.is_main_contact
            ? prev.map(c => c.id === data.id ? data : { ...c, is_main_contact: false })
            : prev.map(c => c.id === data.id ? data : c));
          await refreshMainContacts();
        }
        setEditingContact(null);
      } else {
        // INSERT new contact
        if (contactForm.is_main_contact) {
          await supabase.from('contractor_client_contacts').update({ is_main_contact: false }).eq('client_id', selectedClient.id).eq('is_main_contact', true);
        }
        const payload = { ...contactForm, client_id: selectedClient.id, company_id: currentUser.company_id };
        const { data } = await supabase.from('contractor_client_contacts').insert(payload).select().single();
        if (data) {
          setClientContacts(prev => contactForm.is_main_contact
            ? [...prev.map(c => ({ ...c, is_main_contact: false })), data]
            : [...prev, data]);
          setInviteTarget({ companyName: selectedClient.name, firstName: contactForm.first_name, lastName: contactForm.last_name, phone: contactForm.phone, type: 'client' });
          setShowInviteModal(true);
          await refreshMainContacts();
        }
      }
      setContactForm(emptyContactForm);
      setContactFormErrors({});
      setShowAddContact(false);
    } catch (err) {
      console.error('Error saving contact:', err);
    } finally {
      setSavingContact(false);
    }
  };

  const toggleMainContact = async (contact: ContractorClientContact) => {
    if (!selectedClient) return;
    if (contact.is_main_contact) {
      // Unset
      await supabase.from('contractor_client_contacts').update({ is_main_contact: false }).eq('id', contact.id);
      setClientContacts(prev => prev.map(c => c.id === contact.id ? { ...c, is_main_contact: false } : c));
    } else {
      // Set this as main, unset others
      await supabase.from('contractor_client_contacts').update({ is_main_contact: false }).eq('client_id', selectedClient.id).eq('is_main_contact', true);
      await supabase.from('contractor_client_contacts').update({ is_main_contact: true }).eq('id', contact.id);
      setClientContacts(prev => prev.map(c => ({ ...c, is_main_contact: c.id === contact.id })));
    }
    await refreshMainContacts();
  };

  const deleteContact = async (id: string) => {
    await supabase.from('contractor_client_contacts').delete().eq('id', id);
    setClientContacts(prev => prev.filter(c => c.id !== id));
    await refreshMainContacts();
  };

  const saveClientNote = async (note: string) => {
    if (!selectedClient) return;
    await supabase.from('contractors_clients').update({ note, updated_at: new Date().toISOString() }).eq('id', selectedClient.id);
    setSelectedClient({ ...selectedClient, note });
    setClients(prev => prev.map(c => c.id === selectedClient.id ? { ...c, note } : c));
  };

  // ============================================================
  // SUPPLIER CRUD (same as clients, contractor_type = 'supplier')
  // ============================================================

  const loadSupplierContacts = async (supplierId: string) => {
    const { data } = await supabase.from('contractor_client_contacts').select('*').eq('client_id', supplierId).order('last_name');
    if (data) setSupplierContacts(data);
  };

  const openCreateSupplier = () => {
    setEditingSupplier(null);
    setSupplierForm(emptyClientForm);
    setSupplierFormErrors({});
    setSupplierNipError('');
    setShowSupplierModal(true);
  };

  const openEditSupplier = (s: ContractorClient) => {
    setEditingSupplier(s);
    setSupplierForm({
      name: s.name, nip: s.nip || '', address_street: s.address_street || '',
      address_city: s.address_city || '', address_postal_code: s.address_postal_code || '',
      address_country: s.address_country || 'PL', note: s.note || '',
    });
    setSupplierFormErrors({});
    setSupplierNipError('');
    setShowSupplierModal(true);
  };

  const saveSupplier = async () => {
    if (!currentUser || !supplierForm.name.trim()) return;
    const errors: Record<string, string> = {};
    if (!supplierForm.name.trim()) errors.name = 'Wymagane';
    setSupplierFormErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setSavingSupplier(true);
    try {
      const payload = { ...supplierForm, contractor_type: 'supplier', company_id: currentUser.company_id, updated_at: new Date().toISOString() };
      if (editingSupplier) {
        const { data } = await supabase.from('contractors_clients').update(payload).eq('id', editingSupplier.id).select().single();
        if (data) setSuppliers(prev => prev.map(s => s.id === data.id ? data : s));
      } else {
        const { data } = await supabase.from('contractors_clients').insert(payload).select().single();
        if (data) setSuppliers(prev => [data, ...prev]);
      }
      setShowSupplierModal(false);
    } catch (err) {
      console.error('Error saving supplier:', err);
    } finally {
      setSavingSupplier(false);
    }
  };

  const deleteSupplier = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć tego dostawcę?')) return;
    await supabase.from('contractors_clients').update({ is_archived: true, updated_at: new Date().toISOString() }).eq('id', id);
    setSuppliers(prev => prev.filter(s => s.id !== id));
  };

  const openSupplierDetail = (s: ContractorClient) => {
    setSelectedSupplier(s);
    setSupplierDetailTab('dane');
    loadSupplierContacts(s.id);
  };

  const openEditSupplierContact = (contact: ContractorClientContact) => {
    setEditingSupplierContact(contact);
    setSupplierContactForm({
      first_name: contact.first_name, last_name: contact.last_name,
      phone: contact.phone || '', email: contact.email || '',
      position: contact.position || '', is_main_contact: contact.is_main_contact || false,
    });
    setSupplierContactFormErrors({});
    setShowAddSupplierContact(true);
  };

  const validateSupplierContactForm = (): boolean => {
    const errors: Record<string, string> = {};
    if (!supplierContactForm.first_name.trim()) errors.first_name = 'Wymagane';
    if (!supplierContactForm.last_name.trim()) errors.last_name = 'Wymagane';
    if (!supplierContactForm.phone.trim()) errors.phone = 'Wymagane';
    else if (!isValidPhone(supplierContactForm.phone)) errors.phone = 'Min. 9 cyfr';
    if (!supplierContactForm.email.trim()) errors.email = 'Wymagane';
    else if (!isValidEmail(supplierContactForm.email)) errors.email = 'Nieprawidłowy email';
    setSupplierContactFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const saveSupplierContact = async () => {
    if (!currentUser || !selectedSupplier || !validateSupplierContactForm()) return;
    setSavingSupplierContact(true);
    try {
      if (editingSupplierContact) {
        // UPDATE existing supplier contact
        if (supplierContactForm.is_main_contact && !editingSupplierContact.is_main_contact) {
          await supabase.from('contractor_client_contacts').update({ is_main_contact: false }).eq('client_id', selectedSupplier.id).eq('is_main_contact', true);
        }
        const { data } = await supabase.from('contractor_client_contacts')
          .update({ first_name: supplierContactForm.first_name, last_name: supplierContactForm.last_name, phone: supplierContactForm.phone, email: supplierContactForm.email, position: supplierContactForm.position, is_main_contact: supplierContactForm.is_main_contact })
          .eq('id', editingSupplierContact.id).select().single();
        if (data) {
          setSupplierContacts(prev => supplierContactForm.is_main_contact
            ? prev.map(c => c.id === data.id ? data : { ...c, is_main_contact: false })
            : prev.map(c => c.id === data.id ? data : c));
          await refreshMainContacts();
        }
        setEditingSupplierContact(null);
      } else {
        // INSERT new supplier contact
        if (supplierContactForm.is_main_contact) {
          await supabase.from('contractor_client_contacts').update({ is_main_contact: false }).eq('client_id', selectedSupplier.id).eq('is_main_contact', true);
        }
        const payload = { ...supplierContactForm, client_id: selectedSupplier.id, company_id: currentUser.company_id };
        const { data } = await supabase.from('contractor_client_contacts').insert(payload).select().single();
        if (data) {
          setSupplierContacts(prev => supplierContactForm.is_main_contact ? [...prev.map(c => ({ ...c, is_main_contact: false })), data] : [...prev, data]);
          setInviteTarget({ companyName: selectedSupplier.name, firstName: supplierContactForm.first_name, lastName: supplierContactForm.last_name, phone: supplierContactForm.phone, type: 'client' });
          setShowInviteModal(true);
          await refreshMainContacts();
        }
      }
      setSupplierContactForm(emptyContactForm);
      setSupplierContactFormErrors({});
      setShowAddSupplierContact(false);
    } catch (err) {
      console.error('Error saving supplier contact:', err);
    } finally {
      setSavingSupplierContact(false);
    }
  };

  const toggleSupplierMainContact = async (contact: ContractorClientContact) => {
    if (!selectedSupplier) return;
    if (contact.is_main_contact) {
      await supabase.from('contractor_client_contacts').update({ is_main_contact: false }).eq('id', contact.id);
      setSupplierContacts(prev => prev.map(c => c.id === contact.id ? { ...c, is_main_contact: false } : c));
    } else {
      await supabase.from('contractor_client_contacts').update({ is_main_contact: false }).eq('client_id', selectedSupplier.id).eq('is_main_contact', true);
      await supabase.from('contractor_client_contacts').update({ is_main_contact: true }).eq('id', contact.id);
      setSupplierContacts(prev => prev.map(c => ({ ...c, is_main_contact: c.id === contact.id })));
    }
    await refreshMainContacts();
  };

  const deleteSupplierContact = async (id: string) => {
    await supabase.from('contractor_client_contacts').delete().eq('id', id);
    setSupplierContacts(prev => prev.filter(c => c.id !== id));
    await refreshMainContacts();
  };

  const saveSupplierNote = async (note: string) => {
    if (!selectedSupplier) return;
    await supabase.from('contractors_clients').update({ note, updated_at: new Date().toISOString() }).eq('id', selectedSupplier.id);
    setSelectedSupplier({ ...selectedSupplier, note });
    setSuppliers(prev => prev.map(s => s.id === selectedSupplier.id ? { ...s, note } : s));
  };

  // ============================================================
  // SUBCONTRACTOR CRUD
  // ============================================================

  const openCreateSub = () => {
    setEditingSub(null);
    setSubForm(emptySubcontractorForm);
    setSubFormErrors({});
    setSubNipError('');
    setShowSubModal(true);
  };

  const openEditSub = (sub: ContractorSubcontractor) => {
    setEditingSub(sub);
    setSubForm({
      name: sub.name, nip: sub.nip || '',
      address_street: sub.address_street || '', address_city: sub.address_city || '',
      address_postal_code: sub.address_postal_code || '', address_country: sub.address_country || 'PL',
      note: sub.note || '', workers_count: sub.workers_count || 0, skills: sub.skills || '',
    });
    setSubFormErrors({});
    setSubNipError('');
    setShowSubModal(true);
  };

  const validateSubForm = (): boolean => {
    const errors: Record<string, string> = {};
    if (!subForm.name.trim()) errors.name = 'Wymagane';
    setSubFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const saveSub = async () => {
    if (!currentUser || !validateSubForm()) return;
    setSavingSub(true);
    try {
      const payload = { ...subForm, company_id: currentUser.company_id, updated_at: new Date().toISOString() };
      if (editingSub) {
        const { data } = await supabase.from('contractors_subcontractors').update(payload).eq('id', editingSub.id).select().single();
        if (data) setSubcontractors(prev => prev.map(s => s.id === data.id ? data : s));
      } else {
        const { data } = await supabase.from('contractors_subcontractors').insert(payload).select().single();
        if (data) setSubcontractors(prev => [data, ...prev]);
      }
      setShowSubModal(false);
    } catch (err) {
      console.error('Error saving subcontractor:', err);
    } finally {
      setSavingSub(false);
    }
  };

  const deleteSub = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć tego podwykonawcę?')) return;
    await supabase.from('contractors_subcontractors').update({ is_archived: true, updated_at: new Date().toISOString() }).eq('id', id);
    setSubcontractors(prev => prev.filter(s => s.id !== id));
  };

  const openSubDetail = (sub: ContractorSubcontractor) => {
    setSelectedSub(sub);
    setSubDetailTab('dane');
    loadSubWorkers(sub.id);
  };

  // ============================================================
  // SUBCONTRACTOR WORKERS (PRZEDSTAWICIELE) CRUD
  // ============================================================

  const openEditWorker = (worker: SubcontractorWorker) => {
    setEditingWorker(worker);
    setWorkerForm({
      first_name: worker.first_name, last_name: worker.last_name,
      phone: worker.phone || '', email: worker.email || '',
      position: worker.position || '', is_main_contact: worker.is_main_contact || false,
    });
    setWorkerFormErrors({});
    setShowAddWorker(true);
  };

  const validateWorkerForm = (): boolean => {
    const errors: Record<string, string> = {};
    if (!workerForm.first_name.trim()) errors.first_name = 'Wymagane';
    if (!workerForm.last_name.trim()) errors.last_name = 'Wymagane';
    if (!workerForm.phone.trim()) errors.phone = 'Wymagane';
    else if (!isValidPhone(workerForm.phone)) errors.phone = 'Min. 9 cyfr';
    if (!workerForm.email.trim()) errors.email = 'Wymagane';
    else if (!isValidEmail(workerForm.email)) errors.email = 'Nieprawidłowy email';
    setWorkerFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const saveWorker = async () => {
    if (!currentUser || !selectedSub || !validateWorkerForm()) return;
    setSavingWorker(true);
    try {
      if (editingWorker) {
        // UPDATE existing worker
        if (workerForm.is_main_contact && !editingWorker.is_main_contact) {
          await supabase.from('subcontractor_workers').update({ is_main_contact: false }).eq('subcontractor_id', selectedSub.id).eq('is_main_contact', true);
        }
        const { data } = await supabase.from('subcontractor_workers')
          .update({ first_name: workerForm.first_name, last_name: workerForm.last_name, phone: workerForm.phone, email: workerForm.email, position: workerForm.position, is_main_contact: workerForm.is_main_contact })
          .eq('id', editingWorker.id).select().single();
        if (data) {
          setSubWorkers(prev => workerForm.is_main_contact
            ? prev.map(w => w.id === data.id ? data : { ...w, is_main_contact: false })
            : prev.map(w => w.id === data.id ? data : w));
          await refreshMainContacts();
        }
        setEditingWorker(null);
      } else {
        // INSERT new worker
        if (workerForm.is_main_contact) {
          await supabase.from('subcontractor_workers').update({ is_main_contact: false }).eq('subcontractor_id', selectedSub.id).eq('is_main_contact', true);
        }
        const payload = { ...workerForm, subcontractor_id: selectedSub.id, company_id: currentUser.company_id };
        const { data } = await supabase.from('subcontractor_workers').insert(payload).select().single();
        if (data) {
          setSubWorkers(prev => workerForm.is_main_contact
            ? [...prev.map(w => ({ ...w, is_main_contact: false })), data]
            : [...prev, data]);
          setInviteTarget({ companyName: selectedSub.name, firstName: workerForm.first_name, lastName: workerForm.last_name, phone: workerForm.phone, type: 'sub' });
          setShowInviteModal(true);
          await refreshMainContacts();
        }
      }
      setWorkerForm(emptyWorkerForm);
      setWorkerFormErrors({});
      setShowAddWorker(false);
    } catch (err) {
      console.error('Error saving worker:', err);
    } finally {
      setSavingWorker(false);
    }
  };

  const toggleMainWorker = async (worker: SubcontractorWorker) => {
    if (!selectedSub) return;
    if (worker.is_main_contact) {
      await supabase.from('subcontractor_workers').update({ is_main_contact: false }).eq('id', worker.id);
      setSubWorkers(prev => prev.map(w => w.id === worker.id ? { ...w, is_main_contact: false } : w));
    } else {
      await supabase.from('subcontractor_workers').update({ is_main_contact: false }).eq('subcontractor_id', selectedSub.id).eq('is_main_contact', true);
      await supabase.from('subcontractor_workers').update({ is_main_contact: true }).eq('id', worker.id);
      setSubWorkers(prev => prev.map(w => ({ ...w, is_main_contact: w.id === worker.id })));
    }
    await refreshMainContacts();
  };

  const deleteWorker = async (id: string) => {
    await supabase.from('subcontractor_workers').delete().eq('id', id);
    setSubWorkers(prev => prev.filter(w => w.id !== id));
    await refreshMainContacts();
  };

  const saveSubNote = async (note: string) => {
    if (!selectedSub) return;
    await supabase.from('contractors_subcontractors').update({ note, updated_at: new Date().toISOString() }).eq('id', selectedSub.id);
    setSelectedSub({ ...selectedSub, note });
    setSubcontractors(prev => prev.map(s => s.id === selectedSub.id ? { ...s, note } : s));
  };

  // ============================================================
  // FILTERED DATA
  // ============================================================

  const filteredClients = clients.filter(c => {
    const q = clientSearch.toLowerCase();
    const mc = clientMainContacts[c.id];
    return (
      c.name.toLowerCase().includes(q) ||
      (c.nip || '').replace(/\D/g, '').includes(clientSearch.replace(/\D/g, '')) ||
      (c.address_city || '').toLowerCase().includes(q) ||
      (mc ? `${mc.first_name} ${mc.last_name}`.toLowerCase().includes(q) : false) ||
      (mc?.email || '').toLowerCase().includes(q) ||
      (mc?.phone || '').replace(/\D/g, '').includes(clientSearch.replace(/\D/g, ''))
    );
  });

  const filteredSubs = subcontractors.filter(s => {
    const q = subSearch.toLowerCase();
    const mw = subMainContacts[s.id];
    return (
      s.name.toLowerCase().includes(q) ||
      (s.nip || '').replace(/\D/g, '').includes(subSearch.replace(/\D/g, '')) ||
      (s.skills || '').toLowerCase().includes(q) ||
      (s.address_city || '').toLowerCase().includes(q) ||
      (mw ? `${mw.first_name} ${mw.last_name}`.toLowerCase().includes(q) : false) ||
      (mw?.email || '').toLowerCase().includes(q)
    );
  });

  const filteredSuppliers = suppliers.filter(s => {
    const q = supplierSearch.toLowerCase();
    const mc = supplierMainContacts[s.id];
    return (
      s.name.toLowerCase().includes(q) ||
      (s.nip || '').replace(/\D/g, '').includes(supplierSearch.replace(/\D/g, '')) ||
      (s.address_city || '').toLowerCase().includes(q) ||
      (mc ? `${mc.first_name} ${mc.last_name}`.toLowerCase().includes(q) : false) ||
      (mc?.email || '').toLowerCase().includes(q)
    );
  });

  // ============================================================
  // RENDER
  // ============================================================

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-blue-500" size={32} />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      {/* Tabs */}
      <div className="flex space-x-1 bg-slate-100 rounded-xl p-1 mb-6">
        <button
          onClick={() => setActiveMainTab('clients')}
          className={`flex-1 flex items-center justify-center space-x-2 py-2.5 rounded-lg text-sm font-medium transition-colors ${
            activeMainTab === 'clients' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-800'
          }`}
        >
          <Building2 size={18} />
          <span>Klienci ({clients.length})</span>
        </button>
        <button
          onClick={() => setActiveMainTab('subcontractors')}
          className={`flex-1 flex items-center justify-center space-x-2 py-2.5 rounded-lg text-sm font-medium transition-colors ${
            activeMainTab === 'subcontractors' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-800'
          }`}
        >
          <Users size={18} />
          <span>Podwykonawcy ({subcontractors.length})</span>
        </button>
        <button
          onClick={() => setActiveMainTab('suppliers')}
          className={`flex-1 flex items-center justify-center space-x-2 py-2.5 rounded-lg text-sm font-medium transition-colors ${
            activeMainTab === 'suppliers' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-800'
          }`}
        >
          <Building2 size={18} />
          <span>Dostawcy ({suppliers.length})</span>
        </button>
      </div>

      {/* ============ TAB: KLIENCI ============ */}
      {activeMainTab === 'clients' && (
        <div>
          <div className="flex items-center justify-between mb-4 gap-4">
            <div className="relative flex-1 max-w-md">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input type="text" placeholder="Szukaj po nazwie lub NIP..."
                value={clientSearch} onChange={e => setClientSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <button onClick={openCreateClient} className="flex items-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium">
              <Plus size={18} /><span>Dodaj klienta</span>
            </button>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold text-slate-500 uppercase whitespace-nowrap">Nazwa firmy</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-500 uppercase whitespace-nowrap">NIP</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-500 uppercase whitespace-nowrap">Kontakt</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-500 uppercase whitespace-nowrap">Stanowisko</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-500 uppercase whitespace-nowrap">Email</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-500 uppercase whitespace-nowrap">Telefon</th>
                  <th className="text-right px-3 py-2 font-semibold text-slate-500 uppercase w-16"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredClients.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-12 text-slate-400 text-sm">Brak klientów</td></tr>
                ) : filteredClients.map(client => {
                  const mc = clientMainContacts[client.id];
                  return (
                    <tr key={client.id} className="hover:bg-slate-50 cursor-pointer transition-colors" onClick={() => openClientDetail(client)}>
                      <td className="px-3 py-2 max-w-[220px]">
                        <div className="flex items-center space-x-1.5">
                          <Building2 size={14} className="text-slate-400 shrink-0" />
                          <span className="font-medium text-slate-800 truncate">{client.name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-slate-500 font-mono whitespace-nowrap">{client.nip || '—'}</td>
                      <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{mc ? `${mc.first_name} ${mc.last_name}` : '—'}</td>
                      <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{mc?.position || '—'}</td>
                      <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{mc?.email || '—'}</td>
                      <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{mc?.phone || '—'}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end space-x-0.5">
                          <button onClick={e => { e.stopPropagation(); openEditClient(client); }}
                            className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"><Pencil size={14} /></button>
                          <button onClick={e => { e.stopPropagation(); deleteClient(client.id); }}
                            className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"><Trash2 size={14} /></button>
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

      {/* ============ TAB: PODWYKONAWCY ============ */}
      {activeMainTab === 'subcontractors' && (
        <div>
          <div className="flex items-center justify-between mb-4 gap-4">
            <div className="relative flex-1 max-w-md">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input type="text" placeholder="Szukaj podwykonawcy..."
                value={subSearch} onChange={e => setSubSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <button onClick={openCreateSub} className="flex items-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium">
              <Plus size={18} /><span>Dodaj podwykonawcę</span>
            </button>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold text-slate-500 uppercase whitespace-nowrap">Nazwa firmy</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-500 uppercase whitespace-nowrap">NIP</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-500 uppercase whitespace-nowrap">Kontakt</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-500 uppercase whitespace-nowrap">Stanowisko</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-500 uppercase whitespace-nowrap">Email</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-500 uppercase whitespace-nowrap">Telefon</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-500 uppercase whitespace-nowrap">Pracownicy</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-500 uppercase whitespace-nowrap">Umiejętności</th>
                  <th className="text-right px-3 py-2 font-semibold text-slate-500 uppercase w-16"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredSubs.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-12 text-slate-400 text-sm">Brak podwykonawców</td></tr>
                ) : filteredSubs.map(sub => {
                  const mw = subMainContacts[sub.id];
                  return (
                    <tr key={sub.id} className="hover:bg-slate-50 cursor-pointer transition-colors" onClick={() => openSubDetail(sub)}>
                      <td className="px-3 py-2 max-w-[220px]">
                        <div className="flex items-center space-x-1.5">
                          <Users size={14} className="text-slate-400 shrink-0" />
                          <span className="font-medium text-slate-800 truncate">{sub.name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-slate-500 font-mono whitespace-nowrap">{sub.nip || '—'}</td>
                      <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{mw ? `${mw.first_name} ${mw.last_name}` : '—'}</td>
                      <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{mw?.position || '—'}</td>
                      <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{mw?.email || '—'}</td>
                      <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{mw?.phone || '—'}</td>
                      <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{sub.workers_count || '—'}</td>
                      <td className="px-3 py-2 text-slate-600 max-w-[180px]">
                        {sub.skills ? (
                          <div className="flex flex-wrap gap-0.5">
                            {sub.skills.split(',').map(s => s.trim()).filter(Boolean).slice(0, 2).map(skill => (
                              <span key={skill} className="inline-block bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full truncate max-w-[120px]">{skill}</span>
                            ))}
                            {sub.skills.split(',').filter(s => s.trim()).length > 2 && (
                              <span className="inline-block text-slate-400">+{sub.skills.split(',').filter(s => s.trim()).length - 2}</span>
                            )}
                          </div>
                        ) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end space-x-0.5">
                          <button onClick={e => { e.stopPropagation(); openEditSub(sub); }}
                            className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"><Pencil size={14} /></button>
                          <button onClick={e => { e.stopPropagation(); deleteSub(sub.id); }}
                            className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"><Trash2 size={14} /></button>
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

      {/* ============ TAB: DOSTAWCY ============ */}
      {activeMainTab === 'suppliers' && (
        <div>
          <div className="flex items-center justify-between mb-4 gap-4">
            <div className="relative flex-1 max-w-md">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input type="text" placeholder="Szukaj po nazwie lub NIP..."
                value={supplierSearch} onChange={e => setSupplierSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <button onClick={openCreateSupplier} className="flex items-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium">
              <Plus size={18} /><span>Dodaj dostawcę</span>
            </button>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold text-slate-500 uppercase whitespace-nowrap">Nazwa firmy</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-500 uppercase whitespace-nowrap">NIP</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-500 uppercase whitespace-nowrap">Kontakt</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-500 uppercase whitespace-nowrap">Stanowisko</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-500 uppercase whitespace-nowrap">Email</th>
                  <th className="text-left px-3 py-2 font-semibold text-slate-500 uppercase whitespace-nowrap">Telefon</th>
                  <th className="text-right px-3 py-2 font-semibold text-slate-500 uppercase w-16"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredSuppliers.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-12 text-slate-400 text-sm">Brak dostawców</td></tr>
                ) : filteredSuppliers.map(supplier => {
                  const mc = supplierMainContacts[supplier.id];
                  return (
                    <tr key={supplier.id} className="hover:bg-slate-50 cursor-pointer transition-colors" onClick={() => openSupplierDetail(supplier)}>
                      <td className="px-3 py-2 max-w-[220px]">
                        <div className="flex items-center space-x-1.5">
                          <Building2 size={14} className="text-slate-400 shrink-0" />
                          <span className="font-medium text-slate-800 truncate">{supplier.name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-slate-500 font-mono whitespace-nowrap">{supplier.nip || '—'}</td>
                      <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{mc ? `${mc.first_name} ${mc.last_name}` : '—'}</td>
                      <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{mc?.position || '—'}</td>
                      <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{mc?.email || '—'}</td>
                      <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{mc?.phone || '—'}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end space-x-0.5">
                          <button onClick={e => { e.stopPropagation(); openEditSupplier(supplier); }}
                            className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"><Pencil size={14} /></button>
                          <button onClick={e => { e.stopPropagation(); deleteSupplier(supplier.id); }}
                            className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"><Trash2 size={14} /></button>
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

      {/* ============================================================ */}
      {/* MODAL: CREATE/EDIT CLIENT (compact, no email/phone) */}
      {/* ============================================================ */}
      {showClientModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowClientModal(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
              <h2 className="text-base font-bold text-slate-800">{editingClient ? 'Edytuj klienta' : 'Nowy klient'}</h2>
              <button onClick={() => setShowClientModal(false)} className="text-slate-400 hover:text-slate-600 p-1"><X size={18} /></button>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
              {/* NIP + GUS lookup */}
              <div>
                <label className={labelCls}>NIP</label>
                <div className="flex space-x-2">
                  <input type="text"
                    value={clientForm.nip}
                    onChange={e => setClientForm({ ...clientForm, nip: formatNip(e.target.value) })}
                    className={`flex-1 ${inputCls}`}
                    placeholder="000-000-00-00"
                    maxLength={13}
                  />
                  <button
                    type="button"
                    onClick={() => lookupNip('client')}
                    disabled={nipLoading}
                    className="flex items-center space-x-1 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-sm font-medium hover:bg-emerald-100 transition-colors disabled:opacity-50 border border-emerald-200 whitespace-nowrap"
                    title="Pobierz dane z GUS"
                  >
                    {nipLoading ? <Loader2 size={14} className="animate-spin" /> : <SearchCheck size={14} />}
                    <span>GUS</span>
                  </button>
                </div>
                {nipError && <p className="text-xs text-red-500 mt-0.5 flex items-center space-x-1"><AlertCircle size={12} /><span>{nipError}</span></p>}
              </div>

              {/* Nazwa firmy */}
              <div>
                <label className={labelCls}>Nazwa firmy *</label>
                <input type="text" value={clientForm.name}
                  onChange={e => setClientForm({ ...clientForm, name: e.target.value })}
                  className={clientFormErrors.name ? inputErrCls : inputCls}
                  placeholder="Nazwa firmy" />
                {clientFormErrors.name && <p className="text-xs text-red-500 mt-0.5">{clientFormErrors.name}</p>}
              </div>

              {/* Adres: ulica */}
              <div>
                <label className={labelCls}>Ulica</label>
                <input type="text" value={clientForm.address_street}
                  onChange={e => setClientForm({ ...clientForm, address_street: e.target.value })}
                  className={inputCls} placeholder="Ulica i numer" />
              </div>

              {/* Miasto + Kod + Kraj */}
              <div className="grid grid-cols-5 gap-2">
                <div className="col-span-2">
                  <label className={labelCls}>Miasto</label>
                  <input type="text" value={clientForm.address_city}
                    onChange={e => setClientForm({ ...clientForm, address_city: e.target.value })}
                    className={inputCls} placeholder="Miasto" />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>Kod pocztowy</label>
                  <input type="text" value={clientForm.address_postal_code}
                    onChange={e => setClientForm({ ...clientForm, address_postal_code: formatPostalCode(e.target.value) })}
                    className={inputCls} placeholder="00-000" maxLength={6} />
                </div>
                <div>
                  <label className={labelCls}>Kraj</label>
                  <input type="text" value={clientForm.address_country}
                    onChange={e => setClientForm({ ...clientForm, address_country: e.target.value.toUpperCase().slice(0, 2) })}
                    className={inputCls} placeholder="PL" maxLength={2} />
                </div>
              </div>

              {/* Notatka */}
              <div>
                <label className={labelCls}>Notatka wewnętrzna</label>
                <textarea value={clientForm.note}
                  onChange={e => setClientForm({ ...clientForm, note: e.target.value })}
                  rows={2} className={inputCls} placeholder="Notatka..." />
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end space-x-2 px-5 py-3 border-t border-slate-100 bg-slate-50/50 rounded-b-xl">
              <button onClick={() => setShowClientModal(false)} className="px-4 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">Anuluj</button>
              <button onClick={saveClient} disabled={savingClient || !clientForm.name.trim()}
                className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 flex items-center space-x-1.5">
                {savingClient && <Loader2 size={14} className="animate-spin" />}
                <span>{editingClient ? 'Zapisz' : 'Dodaj'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODAL: CLIENT DETAIL (tabs: dane, przedstawiciele, notatka) */}
      {/* ============================================================ */}
      {selectedClient && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setSelectedClient(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 shrink-0">
              <div className="min-w-0">
                <h2 className="text-base font-bold text-slate-800 truncate">{selectedClient.name}</h2>
                {selectedClient.nip && <p className="text-xs text-slate-500 font-mono">NIP: {selectedClient.nip}</p>}
              </div>
              <button onClick={() => setSelectedClient(null)} className="text-slate-400 hover:text-slate-600 p-1 shrink-0"><X size={18} /></button>
            </div>

            {/* Detail tabs */}
            <div className="flex space-x-1 bg-slate-100 mx-4 mt-3 rounded-lg p-0.5 shrink-0">
              {(['dane', 'kontakty', 'notatka'] as const).map(tab => (
                <button key={tab} onClick={() => setClientDetailTab(tab)}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    clientDetailTab === tab ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-800'
                  }`}
                >
                  {tab === 'dane' ? 'Dane firmy' : tab === 'kontakty' ? 'Przedstawiciele firmy' : 'Notatka'}
                </button>
              ))}
            </div>

            <div className="px-5 py-4 overflow-y-auto flex-1">
              {/* Tab: Dane firmy (no email/phone) */}
              {clientDetailTab === 'dane' && (
                <div className="space-y-2">
                  <InfoRow label="Nazwa" value={selectedClient.name} />
                  <InfoRow label="NIP" value={selectedClient.nip} />
                  <InfoRow label="Ulica" value={selectedClient.address_street} />
                  <InfoRow label="Miasto" value={selectedClient.address_city} />
                  <InfoRow label="Kod pocztowy" value={selectedClient.address_postal_code} />
                  <InfoRow label="Kraj" value={selectedClient.address_country} />
                </div>
              )}

              {/* Tab: Przedstawiciele firmy */}
              {clientDetailTab === 'kontakty' && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-medium text-slate-500">{clientContacts.length} przedstawicieli</span>
                    <button onClick={() => { setEditingContact(null); setContactForm(emptyContactForm); setContactFormErrors({}); setShowAddContact(true); }}
                      className="flex items-center space-x-1 text-xs text-blue-600 hover:text-blue-700 font-medium">
                      <UserPlus size={14} /><span>Dodaj</span>
                    </button>
                  </div>

                  {showAddContact && (
                    <div className="bg-blue-50/70 rounded-lg p-3 mb-3 space-y-2 border border-blue-100">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <input type="text" value={contactForm.first_name} onChange={e => setContactForm({ ...contactForm, first_name: e.target.value })}
                            className={contactFormErrors.first_name ? inputErrCls : inputCls} placeholder="Imię *" />
                          {contactFormErrors.first_name && <p className="text-xs text-red-500 mt-0.5">{contactFormErrors.first_name}</p>}
                        </div>
                        <div>
                          <input type="text" value={contactForm.last_name} onChange={e => setContactForm({ ...contactForm, last_name: e.target.value })}
                            className={contactFormErrors.last_name ? inputErrCls : inputCls} placeholder="Nazwisko *" />
                          {contactFormErrors.last_name && <p className="text-xs text-red-500 mt-0.5">{contactFormErrors.last_name}</p>}
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <input type="tel" value={contactForm.phone}
                            onChange={e => setContactForm({ ...contactForm, phone: formatPhone(e.target.value) })}
                            className={contactFormErrors.phone ? inputErrCls : inputCls} placeholder="+48 ... *" />
                          {contactFormErrors.phone && <p className="text-xs text-red-500 mt-0.5">{contactFormErrors.phone}</p>}
                        </div>
                        <div>
                          <input type="email" value={contactForm.email}
                            onChange={e => setContactForm({ ...contactForm, email: formatEmail(e.target.value) })}
                            className={contactFormErrors.email ? inputErrCls : inputCls} placeholder="Email *" />
                          {contactFormErrors.email && <p className="text-xs text-red-500 mt-0.5">{contactFormErrors.email}</p>}
                        </div>
                        <input type="text" value={contactForm.position} onChange={e => setContactForm({ ...contactForm, position: e.target.value })}
                          className={inputCls} placeholder="Stanowisko" />
                      </div>
                      <div className="flex items-center justify-between">
                        <label className="flex items-center space-x-2 cursor-pointer">
                          <input type="checkbox" checked={contactForm.is_main_contact}
                            onChange={e => setContactForm({ ...contactForm, is_main_contact: e.target.checked })}
                            className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500" />
                          <span className="text-xs font-medium text-slate-600 flex items-center space-x-1">
                            <Star size={12} className="text-amber-500" /><span>Główny kontakt</span>
                          </span>
                        </label>
                        <div className="flex space-x-2">
                          <button onClick={() => { setShowAddContact(false); setEditingContact(null); setContactFormErrors({}); }} className="px-3 py-1 text-xs text-slate-600 hover:bg-slate-100 rounded-lg">Anuluj</button>
                          <button onClick={saveContact} disabled={savingContact}
                            className="px-3 py-1 text-xs text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 flex items-center space-x-1">
                            {savingContact && <Loader2 size={12} className="animate-spin" />}
                            <span>{editingContact ? 'Zapisz' : 'Dodaj'}</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    {clientContacts.map(contact => (
                      <div key={contact.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center space-x-2">
                            <p className="font-medium text-sm text-slate-800">{contact.first_name} {contact.last_name}</p>
                            {contact.is_main_contact && (
                              <span className="inline-flex items-center space-x-0.5 bg-amber-100 text-amber-700 text-xs px-1.5 py-0.5 rounded-full">
                                <Star size={10} /><span>Główny</span>
                              </span>
                            )}
                          </div>
                          <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500 mt-0.5">
                            {contact.position && <span className="text-blue-600">{contact.position}</span>}
                            {contact.phone && <span className="flex items-center space-x-1"><Phone size={11} /><span>{contact.phone}</span></span>}
                            {contact.email && <span className="flex items-center space-x-1"><Mail size={11} /><span>{contact.email}</span></span>}
                          </div>
                        </div>
                        <div className="flex items-center space-x-1 shrink-0">
                          <button onClick={() => openEditContact(contact)} title="Edytuj kontakt" className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"><Pencil size={14} /></button>
                          <button onClick={() => toggleMainContact(contact)}
                            title={contact.is_main_contact ? 'Usuń jako główny kontakt' : 'Ustaw jako główny kontakt'}
                            className={`p-1 rounded-lg transition-colors ${contact.is_main_contact ? 'text-amber-500 hover:text-amber-600 hover:bg-amber-50' : 'text-slate-300 hover:text-amber-500 hover:bg-amber-50'}`}>
                            <Star size={14} />
                          </button>
                          <button onClick={() => deleteContact(contact.id)}
                            className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                    {clientContacts.length === 0 && !showAddContact && (
                      <p className="text-center text-xs text-slate-400 py-6">Brak przedstawicieli firmy</p>
                    )}
                  </div>
                </div>
              )}

              {/* Tab: Notatka */}
              {clientDetailTab === 'notatka' && (
                <div>
                  <textarea
                    defaultValue={selectedClient.note || ''}
                    onBlur={e => saveClientNote(e.target.value)}
                    rows={6}
                    className={inputCls}
                    placeholder="Wpisz notatki wewnętrzne dotyczące tego klienta..."
                  />
                  <p className="text-xs text-slate-400 mt-1">Zapisuje się automatycznie po opuszczeniu pola.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODAL: CREATE/EDIT SUBCONTRACTOR (with NIP/GUS, address, no email/phone) */}
      {/* ============================================================ */}
      {showSubModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowSubModal(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
              <h2 className="text-base font-bold text-slate-800">{editingSub ? 'Edytuj podwykonawcę' : 'Nowy podwykonawca'}</h2>
              <button onClick={() => setShowSubModal(false)} className="text-slate-400 hover:text-slate-600 p-1"><X size={18} /></button>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
              {/* NIP + GUS lookup */}
              <div>
                <label className={labelCls}>NIP</label>
                <div className="flex space-x-2">
                  <input type="text"
                    value={subForm.nip}
                    onChange={e => setSubForm({ ...subForm, nip: formatNip(e.target.value) })}
                    className={`flex-1 ${inputCls}`}
                    placeholder="000-000-00-00"
                    maxLength={13}
                  />
                  <button
                    type="button"
                    onClick={() => lookupNip('sub')}
                    disabled={subNipLoading}
                    className="flex items-center space-x-1 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-sm font-medium hover:bg-emerald-100 transition-colors disabled:opacity-50 border border-emerald-200 whitespace-nowrap"
                    title="Pobierz dane z GUS"
                  >
                    {subNipLoading ? <Loader2 size={14} className="animate-spin" /> : <SearchCheck size={14} />}
                    <span>GUS</span>
                  </button>
                </div>
                {subNipError && <p className="text-xs text-red-500 mt-0.5 flex items-center space-x-1"><AlertCircle size={12} /><span>{subNipError}</span></p>}
              </div>

              {/* Nazwa firmy */}
              <div>
                <label className={labelCls}>Nazwa firmy *</label>
                <input type="text" value={subForm.name}
                  onChange={e => setSubForm({ ...subForm, name: e.target.value })}
                  className={subFormErrors.name ? inputErrCls : inputCls}
                  placeholder="Nazwa podwykonawcy" />
                {subFormErrors.name && <p className="text-xs text-red-500 mt-0.5">{subFormErrors.name}</p>}
              </div>

              {/* Adres: ulica */}
              <div>
                <label className={labelCls}>Ulica</label>
                <input type="text" value={subForm.address_street}
                  onChange={e => setSubForm({ ...subForm, address_street: e.target.value })}
                  className={inputCls} placeholder="Ulica i numer" />
              </div>

              {/* Miasto + Kod + Kraj */}
              <div className="grid grid-cols-5 gap-2">
                <div className="col-span-2">
                  <label className={labelCls}>Miasto</label>
                  <input type="text" value={subForm.address_city}
                    onChange={e => setSubForm({ ...subForm, address_city: e.target.value })}
                    className={inputCls} placeholder="Miasto" />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>Kod pocztowy</label>
                  <input type="text" value={subForm.address_postal_code}
                    onChange={e => setSubForm({ ...subForm, address_postal_code: formatPostalCode(e.target.value) })}
                    className={inputCls} placeholder="00-000" maxLength={6} />
                </div>
                <div>
                  <label className={labelCls}>Kraj</label>
                  <input type="text" value={subForm.address_country}
                    onChange={e => setSubForm({ ...subForm, address_country: e.target.value.toUpperCase().slice(0, 2) })}
                    className={inputCls} placeholder="PL" maxLength={2} />
                </div>
              </div>

              {/* Ilość pracowników */}
              <div>
                <label className={labelCls}>Ilość pracowników</label>
                <input type="number" min={0} value={subForm.workers_count}
                  onChange={e => setSubForm({ ...subForm, workers_count: parseInt(e.target.value) || 0 })}
                  className={inputCls} />
              </div>

              {/* Skills multi-select */}
              <div ref={skillsDropdownRef}>
                <label className={labelCls}>Umiejętności (zakres działania)</label>
                <div className="relative">
                  <button type="button" onClick={() => setShowSkillsDropdown(!showSkillsDropdown)}
                    className={`${inputCls} text-left flex items-center justify-between`}>
                    <span className={getSelectedSkills().length > 0 ? 'text-slate-800' : 'text-slate-400'}>
                      {getSelectedSkills().length > 0 ? `Wybrano: ${getSelectedSkills().length}` : 'Wybierz zakres...'}
                    </span>
                    <ChevronDown size={14} className={`text-slate-400 transition-transform ${showSkillsDropdown ? 'rotate-180' : ''}`} />
                  </button>
                  {showSkillsDropdown && (
                    <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-52 overflow-y-auto">
                      {SUBCONTRACTOR_SKILL_OPTIONS.map(opt => {
                        const selected = getSelectedSkills().includes(opt.value);
                        return (
                          <button key={opt.value} type="button" onClick={() => toggleSkill(opt.value)}
                            className={`w-full flex items-center space-x-2 px-3 py-1.5 text-sm text-left hover:bg-blue-50 transition-colors ${
                              selected ? 'bg-blue-50 text-blue-700' : 'text-slate-700'
                            }`}>
                            <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                              selected ? 'bg-blue-600 border-blue-600' : 'border-slate-300'
                            }`}>
                              {selected && <Check size={10} className="text-white" />}
                            </div>
                            <span className="text-xs">{opt.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                {getSelectedSkills().length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {getSelectedSkills().map(skill => (
                      <span key={skill} className="inline-flex items-center space-x-0.5 bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full">
                        <span>{skill}</span>
                        <button type="button" onClick={() => toggleSkill(skill)} className="hover:text-blue-900 ml-0.5"><X size={11} /></button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Notatka */}
              <div>
                <label className={labelCls}>Notatka wewnętrzna</label>
                <textarea value={subForm.note}
                  onChange={e => setSubForm({ ...subForm, note: e.target.value })}
                  rows={2} className={inputCls} placeholder="Notatka..." />
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end space-x-2 px-5 py-3 border-t border-slate-100 bg-slate-50/50 rounded-b-xl">
              <button onClick={() => setShowSubModal(false)} className="px-4 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">Anuluj</button>
              <button onClick={saveSub} disabled={savingSub || !subForm.name.trim()}
                className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 flex items-center space-x-1.5">
                {savingSub && <Loader2 size={14} className="animate-spin" />}
                <span>{editingSub ? 'Zapisz' : 'Dodaj'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODAL: SUBCONTRACTOR DETAIL (tabs: dane, przedstawiciele, notatka) */}
      {/* ============================================================ */}
      {selectedSub && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setSelectedSub(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 shrink-0">
              <div className="min-w-0">
                <h2 className="text-base font-bold text-slate-800 truncate">{selectedSub.name}</h2>
                {selectedSub.nip && <p className="text-xs text-slate-500 font-mono">NIP: {selectedSub.nip}</p>}
              </div>
              <button onClick={() => setSelectedSub(null)} className="text-slate-400 hover:text-slate-600 p-1 shrink-0"><X size={18} /></button>
            </div>

            {/* Detail tabs */}
            <div className="flex space-x-1 bg-slate-100 mx-4 mt-3 rounded-lg p-0.5 shrink-0">
              {(['dane', 'przedstawiciele', 'notatka'] as const).map(tab => (
                <button key={tab} onClick={() => setSubDetailTab(tab)}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    subDetailTab === tab ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-800'
                  }`}
                >
                  {tab === 'dane' ? 'Dane firmy' : tab === 'przedstawiciele' ? 'Przedstawiciele firmy' : 'Notatka'}
                </button>
              ))}
            </div>

            <div className="px-5 py-4 overflow-y-auto flex-1">
              {/* Tab: Dane firmy */}
              {subDetailTab === 'dane' && (
                <div className="space-y-2">
                  <InfoRow label="Nazwa" value={selectedSub.name} />
                  <InfoRow label="NIP" value={selectedSub.nip} />
                  <InfoRow label="Ulica" value={selectedSub.address_street} />
                  <InfoRow label="Miasto" value={selectedSub.address_city} />
                  <InfoRow label="Kod pocztowy" value={selectedSub.address_postal_code} />
                  <InfoRow label="Kraj" value={selectedSub.address_country} />
                  {selectedSub.skills && (
                    <div className="flex items-center py-1.5 border-b border-slate-50 last:border-0">
                      <span className="text-xs font-medium text-slate-400 w-28 shrink-0">Umiejętności</span>
                      <div className="flex flex-wrap gap-1">
                        {selectedSub.skills.split(',').map(s => s.trim()).filter(Boolean).map(skill => (
                          <span key={skill} className="inline-block bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full">{skill}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Tab: Przedstawiciele firmy */}
              {subDetailTab === 'przedstawiciele' && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-medium text-slate-500">{subWorkers.length} przedstawicieli</span>
                    <button onClick={() => { setEditingWorker(null); setWorkerForm(emptyWorkerForm); setWorkerFormErrors({}); setShowAddWorker(true); }}
                      className="flex items-center space-x-1 text-xs text-blue-600 hover:text-blue-700 font-medium">
                      <UserPlus size={14} /><span>Dodaj</span>
                    </button>
                  </div>

                  {showAddWorker && (
                    <div className="bg-blue-50/70 rounded-lg p-3 mb-3 space-y-2 border border-blue-100">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <input type="text" value={workerForm.first_name} onChange={e => setWorkerForm({ ...workerForm, first_name: e.target.value })}
                            className={workerFormErrors.first_name ? inputErrCls : inputCls} placeholder="Imię *" />
                          {workerFormErrors.first_name && <p className="text-xs text-red-500 mt-0.5">{workerFormErrors.first_name}</p>}
                        </div>
                        <div>
                          <input type="text" value={workerForm.last_name} onChange={e => setWorkerForm({ ...workerForm, last_name: e.target.value })}
                            className={workerFormErrors.last_name ? inputErrCls : inputCls} placeholder="Nazwisko *" />
                          {workerFormErrors.last_name && <p className="text-xs text-red-500 mt-0.5">{workerFormErrors.last_name}</p>}
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <input type="tel" value={workerForm.phone}
                            onChange={e => setWorkerForm({ ...workerForm, phone: formatPhone(e.target.value) })}
                            className={workerFormErrors.phone ? inputErrCls : inputCls} placeholder="+48 ... *" />
                          {workerFormErrors.phone && <p className="text-xs text-red-500 mt-0.5">{workerFormErrors.phone}</p>}
                        </div>
                        <div>
                          <input type="email" value={workerForm.email}
                            onChange={e => setWorkerForm({ ...workerForm, email: formatEmail(e.target.value) })}
                            className={workerFormErrors.email ? inputErrCls : inputCls} placeholder="Email *" />
                          {workerFormErrors.email && <p className="text-xs text-red-500 mt-0.5">{workerFormErrors.email}</p>}
                        </div>
                        <input type="text" value={workerForm.position} onChange={e => setWorkerForm({ ...workerForm, position: e.target.value })}
                          className={inputCls} placeholder="Stanowisko" />
                      </div>
                      <div className="flex items-center justify-between">
                        <label className="flex items-center space-x-2 cursor-pointer">
                          <input type="checkbox" checked={workerForm.is_main_contact}
                            onChange={e => setWorkerForm({ ...workerForm, is_main_contact: e.target.checked })}
                            className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500" />
                          <span className="text-xs font-medium text-slate-600 flex items-center space-x-1">
                            <Star size={12} className="text-amber-500" /><span>Główny kontakt</span>
                          </span>
                        </label>
                        <div className="flex space-x-2">
                          <button onClick={() => { setShowAddWorker(false); setEditingWorker(null); setWorkerFormErrors({}); }} className="px-3 py-1 text-xs text-slate-600 hover:bg-slate-100 rounded-lg">Anuluj</button>
                          <button onClick={saveWorker} disabled={savingWorker}
                            className="px-3 py-1 text-xs text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 flex items-center space-x-1">
                            {savingWorker && <Loader2 size={12} className="animate-spin" />}
                            <span>{editingWorker ? 'Zapisz' : 'Dodaj'}</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    {subWorkers.map(worker => (
                      <div key={worker.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center space-x-2">
                            <p className="font-medium text-sm text-slate-800">{worker.first_name} {worker.last_name}</p>
                            {worker.is_main_contact && (
                              <span className="inline-flex items-center space-x-0.5 bg-amber-100 text-amber-700 text-xs px-1.5 py-0.5 rounded-full">
                                <Star size={10} /><span>Główny</span>
                              </span>
                            )}
                          </div>
                          <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500 mt-0.5">
                            {worker.position && <span className="text-blue-600">{worker.position}</span>}
                            {worker.phone && <span className="flex items-center space-x-1"><Phone size={11} /><span>{worker.phone}</span></span>}
                            {worker.email && <span className="flex items-center space-x-1"><Mail size={11} /><span>{worker.email}</span></span>}
                          </div>
                        </div>
                        <div className="flex items-center space-x-1 shrink-0">
                          <button onClick={() => openEditWorker(worker)} title="Edytuj pracownika" className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"><Pencil size={14} /></button>
                          <button onClick={() => toggleMainWorker(worker)}
                            title={worker.is_main_contact ? 'Usuń jako główny kontakt' : 'Ustaw jako główny kontakt'}
                            className={`p-1 rounded-lg transition-colors ${worker.is_main_contact ? 'text-amber-500 hover:text-amber-600 hover:bg-amber-50' : 'text-slate-300 hover:text-amber-500 hover:bg-amber-50'}`}>
                            <Star size={14} />
                          </button>
                          <button onClick={() => deleteWorker(worker.id)}
                            className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                    {subWorkers.length === 0 && !showAddWorker && (
                      <p className="text-center text-xs text-slate-400 py-6">Brak przedstawicieli firmy</p>
                    )}
                  </div>
                </div>
              )}

              {/* Tab: Notatka */}
              {subDetailTab === 'notatka' && (
                <div>
                  <textarea
                    defaultValue={selectedSub.note || ''}
                    onBlur={e => saveSubNote(e.target.value)}
                    rows={6}
                    className={inputCls}
                    placeholder="Wpisz notatki wewnętrzne dotyczące tego podwykonawcy..."
                  />
                  <p className="text-xs text-slate-400 mt-1">Zapisuje się automatycznie po opuszczeniu pola.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODAL: CREATE/EDIT SUPPLIER */}
      {/* ============================================================ */}
      {showSupplierModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowSupplierModal(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
              <h2 className="text-base font-bold text-slate-800">{editingSupplier ? 'Edytuj dostawcę' : 'Nowy dostawca'}</h2>
              <button onClick={() => setShowSupplierModal(false)} className="text-slate-400 hover:text-slate-600 p-1"><X size={18} /></button>
            </div>
            <div className="px-5 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
              <div>
                <label className={labelCls}>NIP</label>
                <div className="flex space-x-2">
                  <input type="text" value={supplierForm.nip}
                    onChange={e => setSupplierForm({ ...supplierForm, nip: formatNip(e.target.value) })}
                    className={`flex-1 ${inputCls}`} placeholder="000-000-00-00" maxLength={13} />
                  <button type="button" onClick={() => {
                    const rawNip = supplierForm.nip.replace(/\D/g, '');
                    if (rawNip.length !== 10) { setSupplierNipError('NIP musi mieć 10 cyfr'); return; }
                    setSupplierNipLoading(true); setSupplierNipError('');
                    const today = new Date().toISOString().slice(0, 10);
                    fetch(`https://wl-api.mf.gov.pl/api/search/nip/${rawNip}?date=${today}`)
                      .then(r => r.json())
                      .then(json => {
                        if (json.result?.subject) {
                          const s = json.result.subject;
                          const fullAddress = s.residenceAddress || s.workingAddress || '';
                          let street = '', city = '', postal = '';
                          const parts = fullAddress.split(',').map((p: string) => p.trim());
                          if (parts.length >= 2) {
                            street = parts[0];
                            const cityPart = parts[parts.length - 1];
                            const postalMatch = cityPart.match(/^(\d{2}-\d{3})\s+(.+)/);
                            if (postalMatch) { postal = postalMatch[1]; city = postalMatch[2]; }
                            else { city = cityPart; }
                          } else if (parts.length === 1) { city = parts[0]; }
                          setSupplierForm(prev => ({ ...prev, name: s.name || prev.name, address_street: street || prev.address_street, address_city: city || prev.address_city, address_postal_code: postal || prev.address_postal_code }));
                        } else { setSupplierNipError('Nie znaleziono podmiotu'); }
                      })
                      .catch(() => setSupplierNipError('Błąd połączenia z API'))
                      .finally(() => setSupplierNipLoading(false));
                  }} disabled={supplierNipLoading}
                    className="flex items-center space-x-1 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-sm font-medium hover:bg-emerald-100 transition-colors disabled:opacity-50 border border-emerald-200 whitespace-nowrap"
                    title="Pobierz dane z GUS">
                    {supplierNipLoading ? <Loader2 size={14} className="animate-spin" /> : <SearchCheck size={14} />}
                    <span>GUS</span>
                  </button>
                </div>
                {supplierNipError && <p className="text-xs text-red-500 mt-0.5 flex items-center space-x-1"><AlertCircle size={12} /><span>{supplierNipError}</span></p>}
              </div>
              <div>
                <label className={labelCls}>Nazwa firmy *</label>
                <input type="text" value={supplierForm.name}
                  onChange={e => setSupplierForm({ ...supplierForm, name: e.target.value })}
                  className={supplierFormErrors.name ? inputErrCls : inputCls} placeholder="Nazwa dostawcy" />
                {supplierFormErrors.name && <p className="text-xs text-red-500 mt-0.5">{supplierFormErrors.name}</p>}
              </div>
              <div>
                <label className={labelCls}>Ulica</label>
                <input type="text" value={supplierForm.address_street}
                  onChange={e => setSupplierForm({ ...supplierForm, address_street: e.target.value })}
                  className={inputCls} placeholder="Ulica i numer" />
              </div>
              <div className="grid grid-cols-5 gap-2">
                <div className="col-span-2">
                  <label className={labelCls}>Miasto</label>
                  <input type="text" value={supplierForm.address_city}
                    onChange={e => setSupplierForm({ ...supplierForm, address_city: e.target.value })}
                    className={inputCls} placeholder="Miasto" />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>Kod pocztowy</label>
                  <input type="text" value={supplierForm.address_postal_code}
                    onChange={e => setSupplierForm({ ...supplierForm, address_postal_code: formatPostalCode(e.target.value) })}
                    className={inputCls} placeholder="00-000" maxLength={6} />
                </div>
                <div>
                  <label className={labelCls}>Kraj</label>
                  <input type="text" value={supplierForm.address_country}
                    onChange={e => setSupplierForm({ ...supplierForm, address_country: e.target.value.toUpperCase().slice(0, 2) })}
                    className={inputCls} placeholder="PL" maxLength={2} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Notatka wewnętrzna</label>
                <textarea value={supplierForm.note}
                  onChange={e => setSupplierForm({ ...supplierForm, note: e.target.value })}
                  rows={2} className={inputCls} placeholder="Notatka..." />
              </div>
            </div>
            <div className="flex justify-end space-x-2 px-5 py-3 border-t border-slate-100 bg-slate-50/50 rounded-b-xl">
              <button onClick={() => setShowSupplierModal(false)} className="px-4 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">Anuluj</button>
              <button onClick={saveSupplier} disabled={savingSupplier || !supplierForm.name.trim()}
                className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 flex items-center space-x-1.5">
                {savingSupplier && <Loader2 size={14} className="animate-spin" />}
                <span>{editingSupplier ? 'Zapisz' : 'Dodaj'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODAL: SUPPLIER DETAIL (tabs: dane, przedstawiciele, notatka) */}
      {/* ============================================================ */}
      {selectedSupplier && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setSelectedSupplier(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 shrink-0">
              <div className="min-w-0">
                <h2 className="text-base font-bold text-slate-800 truncate">{selectedSupplier.name}</h2>
                {selectedSupplier.nip && <p className="text-xs text-slate-500 font-mono">NIP: {selectedSupplier.nip}</p>}
              </div>
              <button onClick={() => setSelectedSupplier(null)} className="text-slate-400 hover:text-slate-600 p-1 shrink-0"><X size={18} /></button>
            </div>
            <div className="flex space-x-1 bg-slate-100 mx-4 mt-3 rounded-lg p-0.5 shrink-0">
              {(['dane', 'kontakty', 'notatka'] as const).map(tab => (
                <button key={tab} onClick={() => setSupplierDetailTab(tab)}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    supplierDetailTab === tab ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-800'
                  }`}>
                  {tab === 'dane' ? 'Dane firmy' : tab === 'kontakty' ? 'Przedstawiciele firmy' : 'Notatka'}
                </button>
              ))}
            </div>
            <div className="px-5 py-4 overflow-y-auto flex-1">
              {supplierDetailTab === 'dane' && (
                <div className="space-y-2">
                  <InfoRow label="Nazwa" value={selectedSupplier.name} />
                  <InfoRow label="NIP" value={selectedSupplier.nip} />
                  <InfoRow label="Ulica" value={selectedSupplier.address_street} />
                  <InfoRow label="Miasto" value={selectedSupplier.address_city} />
                  <InfoRow label="Kod pocztowy" value={selectedSupplier.address_postal_code} />
                  <InfoRow label="Kraj" value={selectedSupplier.address_country} />
                </div>
              )}
              {supplierDetailTab === 'kontakty' && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-medium text-slate-500">{supplierContacts.length} przedstawicieli</span>
                    <button onClick={() => { setEditingSupplierContact(null); setSupplierContactForm(emptyContactForm); setSupplierContactFormErrors({}); setShowAddSupplierContact(true); }}
                      className="flex items-center space-x-1 text-xs text-blue-600 hover:text-blue-700 font-medium">
                      <UserPlus size={14} /><span>Dodaj</span>
                    </button>
                  </div>
                  {showAddSupplierContact && (
                    <div className="bg-blue-50/70 rounded-lg p-3 mb-3 space-y-2 border border-blue-100">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <input type="text" value={supplierContactForm.first_name} onChange={e => setSupplierContactForm({ ...supplierContactForm, first_name: e.target.value })}
                            className={supplierContactFormErrors.first_name ? inputErrCls : inputCls} placeholder="Imię *" />
                          {supplierContactFormErrors.first_name && <p className="text-xs text-red-500 mt-0.5">{supplierContactFormErrors.first_name}</p>}
                        </div>
                        <div>
                          <input type="text" value={supplierContactForm.last_name} onChange={e => setSupplierContactForm({ ...supplierContactForm, last_name: e.target.value })}
                            className={supplierContactFormErrors.last_name ? inputErrCls : inputCls} placeholder="Nazwisko *" />
                          {supplierContactFormErrors.last_name && <p className="text-xs text-red-500 mt-0.5">{supplierContactFormErrors.last_name}</p>}
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <input type="tel" value={supplierContactForm.phone}
                            onChange={e => setSupplierContactForm({ ...supplierContactForm, phone: formatPhone(e.target.value) })}
                            className={supplierContactFormErrors.phone ? inputErrCls : inputCls} placeholder="+48 ... *" />
                          {supplierContactFormErrors.phone && <p className="text-xs text-red-500 mt-0.5">{supplierContactFormErrors.phone}</p>}
                        </div>
                        <div>
                          <input type="email" value={supplierContactForm.email}
                            onChange={e => setSupplierContactForm({ ...supplierContactForm, email: formatEmail(e.target.value) })}
                            className={supplierContactFormErrors.email ? inputErrCls : inputCls} placeholder="Email *" />
                          {supplierContactFormErrors.email && <p className="text-xs text-red-500 mt-0.5">{supplierContactFormErrors.email}</p>}
                        </div>
                        <input type="text" value={supplierContactForm.position} onChange={e => setSupplierContactForm({ ...supplierContactForm, position: e.target.value })}
                          className={inputCls} placeholder="Stanowisko" />
                      </div>
                      <div className="flex items-center justify-between">
                        <label className="flex items-center space-x-2 cursor-pointer">
                          <input type="checkbox" checked={supplierContactForm.is_main_contact}
                            onChange={e => setSupplierContactForm({ ...supplierContactForm, is_main_contact: e.target.checked })}
                            className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500" />
                          <span className="text-xs font-medium text-slate-600 flex items-center space-x-1">
                            <Star size={12} className="text-amber-500" /><span>Główny kontakt</span>
                          </span>
                        </label>
                        <div className="flex space-x-2">
                          <button onClick={() => { setShowAddSupplierContact(false); setEditingSupplierContact(null); setSupplierContactFormErrors({}); }} className="px-3 py-1 text-xs text-slate-600 hover:bg-slate-100 rounded-lg">Anuluj</button>
                          <button onClick={saveSupplierContact} disabled={savingSupplierContact}
                            className="px-3 py-1 text-xs text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 flex items-center space-x-1">
                            {savingSupplierContact && <Loader2 size={12} className="animate-spin" />}
                            <span>{editingSupplierContact ? 'Zapisz' : 'Dodaj'}</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="space-y-1.5">
                    {supplierContacts.map(contact => (
                      <div key={contact.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center space-x-2">
                            <p className="font-medium text-sm text-slate-800">{contact.first_name} {contact.last_name}</p>
                            {contact.is_main_contact && (
                              <span className="inline-flex items-center space-x-0.5 bg-amber-100 text-amber-700 text-xs px-1.5 py-0.5 rounded-full">
                                <Star size={10} /><span>Główny</span>
                              </span>
                            )}
                          </div>
                          <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500 mt-0.5">
                            {contact.position && <span className="text-blue-600">{contact.position}</span>}
                            {contact.phone && <span className="flex items-center space-x-1"><Phone size={11} /><span>{contact.phone}</span></span>}
                            {contact.email && <span className="flex items-center space-x-1"><Mail size={11} /><span>{contact.email}</span></span>}
                          </div>
                        </div>
                        <div className="flex items-center space-x-1 shrink-0">
                          <button onClick={() => openEditSupplierContact(contact)} title="Edytuj kontakt" className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"><Pencil size={14} /></button>
                          <button onClick={() => toggleSupplierMainContact(contact)}
                            title={contact.is_main_contact ? 'Usuń jako główny kontakt' : 'Ustaw jako główny kontakt'}
                            className={`p-1 rounded-lg transition-colors ${contact.is_main_contact ? 'text-amber-500 hover:text-amber-600 hover:bg-amber-50' : 'text-slate-300 hover:text-amber-500 hover:bg-amber-50'}`}>
                            <Star size={14} />
                          </button>
                          <button onClick={() => deleteSupplierContact(contact.id)}
                            className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                    {supplierContacts.length === 0 && !showAddSupplierContact && (
                      <p className="text-center text-xs text-slate-400 py-6">Brak przedstawicieli firmy</p>
                    )}
                  </div>
                </div>
              )}
              {supplierDetailTab === 'notatka' && (
                <div>
                  <textarea
                    defaultValue={selectedSupplier.note || ''}
                    onBlur={e => saveSupplierNote(e.target.value)}
                    rows={6}
                    className={inputCls}
                    placeholder="Wpisz notatki wewnętrzne dotyczące tego dostawcy..."
                  />
                  <p className="text-xs text-slate-400 mt-1">Zapisuje się automatycznie po opuszczeniu pola.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODAL: INVITE REPRESENTATIVE */}
      {/* ============================================================ */}
      {showInviteModal && inviteTarget && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={() => { setShowInviteModal(false); setInviteTarget(null); }}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4">
              <h3 className="text-base font-bold text-slate-800 mb-3">Zaproszenie do portalu</h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                Zaprosić przedstawiciela firmy <strong>{inviteTarget.companyName}</strong>,{' '}
                Pana/Panią <strong>{inviteTarget.firstName} {inviteTarget.lastName}</strong> do portalu?
              </p>
              <p className="text-xs text-slate-400 mt-2">
                Na numer {inviteTarget.phone} zostanie wysłany SMS z linkiem do rejestracji.
              </p>
            </div>
            <div className="flex justify-end space-x-2 px-5 py-3 border-t border-slate-100 bg-slate-50/50 rounded-b-xl">
              <button onClick={() => { setShowInviteModal(false); setInviteTarget(null); }}
                className="px-4 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">Nie</button>
              <button onClick={handleInvite} disabled={inviting}
                className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 flex items-center space-x-1.5">
                {inviting && <Loader2 size={14} className="animate-spin" />}
                <span>Tak</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Helper component
const InfoRow = ({ label, value, icon }: { label: string; value?: string | null; icon?: React.ReactNode }) => (
  <div className="flex items-center py-1.5 border-b border-slate-50 last:border-0">
    <span className="text-xs font-medium text-slate-400 w-28 shrink-0">{label}</span>
    <div className="flex items-center space-x-1.5 text-sm text-slate-800 min-w-0">
      {icon}
      <span className="truncate">{value || '—'}</span>
    </div>
  </div>
);
