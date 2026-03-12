
import React, { useState, useEffect, useCallback } from 'react';
import { Building2, Save, AlertTriangle, Clock, CalendarDays, Plus, Trash2, Download, Moon, Sun, HardHat, Percent, Upload, X, Camera, User, Mail, Phone, Loader2 } from 'lucide-react';
import { useAppContext } from '../../context/AppContext';
import { WorkingHours, WorkingHoursDay, RoundTime, HolidayDay } from '../../types';
import { supabase } from '../../lib/supabase';

// ─── Constants ───────────────────────────────────────────────────────────────

type TabKey = 'company' | 'working_time' | 'holidays' | 'construction';

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'company', label: 'Dane firmy', icon: <Building2 className="w-4 h-4" /> },
  { key: 'working_time', label: 'Czas pracy', icon: <Clock className="w-4 h-4" /> },
  { key: 'holidays', label: 'Dni wolne', icon: <CalendarDays className="w-4 h-4" /> },
  { key: 'construction', label: 'Budowlanka', icon: <HardHat className="w-4 h-4" /> },
];

const TIMEZONES = [
  'Europe/Warsaw',
  'Europe/Berlin',
  'Europe/London',
  'Europe/Paris',
  'Europe/Rome',
  'Europe/Madrid',
  'Europe/Prague',
  'Europe/Bratislava',
  'Europe/Vilnius',
  'Europe/Riga',
  'Europe/Tallinn',
  'Europe/Kiev',
  'Europe/Bucharest',
  'Europe/Sofia',
  'Europe/Helsinki',
  'Europe/Stockholm',
  'Europe/Oslo',
  'Europe/Copenhagen',
  'Europe/Amsterdam',
  'Europe/Brussels',
  'Europe/Vienna',
  'Europe/Zurich',
  'Europe/Lisbon',
  'Europe/Athens',
  'Europe/Moscow',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'UTC',
];

const CURRENCIES = ['PLN', 'EUR', 'USD', 'UAH'];

const DAY_KEYS: (keyof WorkingHours)[] = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
];

const DAY_LABELS: Record<keyof WorkingHours, string> = {
  monday: 'Poniedziałek',
  tuesday: 'Wtorek',
  wednesday: 'Środa',
  thursday: 'Czwartek',
  friday: 'Piątek',
  saturday: 'Sobota',
  sunday: 'Niedziela',
};

const ROUND_PRECISIONS = [0, 5, 10, 15, 30];
const ROUND_METHODS: { value: RoundTime['method']; label: string }[] = [
  { value: 'ceil', label: 'W górę' },
  { value: 'floor', label: 'W dół' },
];

const DEFAULT_WORKING_HOURS: WorkingHours = {
  monday:    { enabled: true, start_time: '08:00', end_time: '16:00' },
  tuesday:   { enabled: true, start_time: '08:00', end_time: '16:00' },
  wednesday: { enabled: true, start_time: '08:00', end_time: '16:00' },
  thursday:  { enabled: true, start_time: '08:00', end_time: '16:00' },
  friday:    { enabled: true, start_time: '08:00', end_time: '16:00' },
  saturday:  { enabled: false, start_time: null, end_time: null },
  sunday:    { enabled: false, start_time: null, end_time: null },
};

const DEFAULT_ROUND_TIME: RoundTime = { precision: 0, method: 'none' };

const POLISH_HOLIDAYS: { monthDay: string; name: string }[] = [
  { monthDay: '01-01', name: 'Nowy Rok' },
  { monthDay: '01-06', name: 'Trzech Króli' },
  { monthDay: '05-01', name: 'Święto Pracy' },
  { monthDay: '05-03', name: 'Święto Konstytucji 3 Maja' },
  { monthDay: '08-15', name: 'Wniebowzięcie Najświętszej Maryi Panny' },
  { monthDay: '11-01', name: 'Wszystkich Świętych' },
  { monthDay: '11-11', name: 'Święto Niepodległości' },
  { monthDay: '12-25', name: 'Boże Narodzenie (dzień pierwszy)' },
  { monthDay: '12-26', name: 'Boże Narodzenie (dzień drugi)' },
];

// Easter-based movable holidays helper
function getEasterDate(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function getPolishMovableHolidays(year: number): { date: string; name: string }[] {
  const easter = getEasterDate(year);
  const addDays = (d: Date, n: number) => {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
  };
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  return [
    { date: fmt(addDays(easter, 0)), name: 'Wielkanoc' },
    { date: fmt(addDays(easter, 1)), name: 'Poniedziałek Wielkanocny' },
    { date: fmt(addDays(easter, 49)), name: 'Zielone Świątki' },
    { date: fmt(addDays(easter, 60)), name: 'Boże Ciało' },
  ];
}

// ─── Component ───────────────────────────────────────────────────────────────

export const CompanySettingsPage: React.FC = () => {
  const { state, updateCompany } = useAppContext();
  const { currentCompany, currentUser } = state;

  const [activeTab, setActiveTab] = useState<TabKey>('company');
  const [isSaving, setIsSaving] = useState(false);

  // ═══ Toast notifications ═══
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  // ═══ Tab 1: Dane firmy ═══
  const [formData, setFormData] = useState({
    name: currentCompany?.name || '',
    legal_name: currentCompany?.legal_name || '',
    tax_id: currentCompany?.tax_id || '',
    regon: currentCompany?.regon || '',
    address_street: currentCompany?.address_street || '',
    address_city: currentCompany?.address_city || '',
    address_postal_code: currentCompany?.address_postal_code || '',
    address_country: currentCompany?.address_country || 'Polska',
    contact_email: currentCompany?.contact_email || '',
    contact_phone: currentCompany?.contact_phone || '',
    billing_email: currentCompany?.billing_email || ''
  });

  // Logo upload state
  const [logoUrl, setLogoUrl] = useState(currentCompany?.logo_url || '');
  const [logoUploading, setLogoUploading] = useState(false);

  // Contact person state
  const [contactFirstName, setContactFirstName] = useState(currentUser?.first_name || '');
  const [contactLastName, setContactLastName] = useState(currentUser?.last_name || '');
  const [contactPhone, setContactPhone] = useState(currentUser?.phone || '');

  useEffect(() => {
    if (currentUser) {
      setContactFirstName(currentUser.first_name || '');
      setContactLastName(currentUser.last_name || '');
      setContactPhone(currentUser.phone || '');
    }
  }, [currentUser]);

  useEffect(() => {
    if (currentCompany?.logo_url) setLogoUrl(currentCompany.logo_url);
  }, [currentCompany?.logo_url]);

  const handleLogoUpload = async (file: File) => {
    if (!currentCompany) return;
    if (!file.type.startsWith('image/')) {
      showToast('error', 'Wybierz plik obrazu (PNG, JPG, SVG)');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      showToast('error', 'Maksymalny rozmiar pliku to 2 MB');
      return;
    }
    setLogoUploading(true);
    try {
      const ext = file.name.split('.').pop() || 'png';
      const filePath = `logos/${currentCompany.id}/logo_${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(filePath, file, { upsert: true });
      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('documents')
        .getPublicUrl(filePath);

      const { error: updateError } = await supabase
        .from('companies')
        .update({ logo_url: publicUrl })
        .eq('id', currentCompany.id);
      if (updateError) throw updateError;

      setLogoUrl(publicUrl);
    } catch (err) {
      console.error('Error uploading logo:', err);
      showToast('error', 'Błąd podczas przesyłania logotypu');
    } finally {
      setLogoUploading(false);
    }
  };

  const handleRemoveLogo = async () => {
    if (!currentCompany) return;
    try {
      await supabase.from('companies').update({ logo_url: null }).eq('id', currentCompany.id);
      setLogoUrl('');
    } catch (err) {
      console.error('Error removing logo:', err);
    }
  };

  const handleSaveContact = async () => {
    if (!currentUser) return;
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('users')
        .update({ first_name: contactFirstName, last_name: contactLastName, phone: contactPhone })
        .eq('id', currentUser.id);
      if (error) throw error;
      showToast('success', 'Dane kontaktowe zapisane pomyślnie');
    } catch (err) {
      console.error('Error saving contact data:', err);
      showToast('error', 'Błąd podczas zapisywania danych kontaktowych');
    } finally {
      setIsSaving(false);
    }
  };

  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSave = async () => {
    if (!currentCompany) return;
    setIsSaving(true);
    try {
      await updateCompany(currentCompany.id, formData);
      showToast('success', 'Dane zapisane pomyślnie');
    } catch (error) {
      console.error('Error saving company data:', error);
      showToast('error', 'Błąd podczas zapisywania danych');
    } finally {
      setIsSaving(false);
    }
  };

  // ═══ Tab 2: Czas pracy ═══
  const [timezone, setTimezone] = useState(currentCompany?.timezone || 'Europe/Warsaw');
  const [currency, setCurrency] = useState(currentCompany?.currency || 'PLN');
  const [allowWeekendAccess, setAllowWeekendAccess] = useState(currentCompany?.allow_weekend_access ?? false);
  const [maxWorkingTimeMinutes, setMaxWorkingTimeMinutes] = useState<number | ''>(currentCompany?.max_working_time_minutes ?? 480);
  const [delayToleranceMinutes, setDelayToleranceMinutes] = useState<number | ''>(currentCompany?.delay_tolerance_minutes ?? '');
  const [nightTimeFrom, setNightTimeFrom] = useState(currentCompany?.night_time_from || '22:00');
  const [nightTimeTo, setNightTimeTo] = useState(currentCompany?.night_time_to || '06:00');
  const [workingHours, setWorkingHours] = useState<WorkingHours>(currentCompany?.working_hours || DEFAULT_WORKING_HOURS);
  const [startRoundTime, setStartRoundTime] = useState<RoundTime>(currentCompany?.start_round_time || { ...DEFAULT_ROUND_TIME });
  const [finishRoundTime, setFinishRoundTime] = useState<RoundTime>(currentCompany?.finish_round_time || { ...DEFAULT_ROUND_TIME });
  const [isSavingWorkTime, setIsSavingWorkTime] = useState(false);

  // ═══ Tab 4: Budowlanka ═══
  const [constructionSettings, setConstructionSettings] = useState({
    default_overhead_percent: currentCompany?.settings?.default_overhead_percent ?? 65,
    default_profit_percent: currentCompany?.settings?.default_profit_percent ?? 10,
    default_material_purchase_percent: currentCompany?.settings?.default_material_purchase_percent ?? 5,
    default_equipment_purchase_percent: currentCompany?.settings?.default_equipment_purchase_percent ?? 3,
    estimate_number_pattern: currentCompany?.settings?.estimate_number_pattern ?? 'KE/{YYYY}/{NR}',
    offer_number_pattern: currentCompany?.settings?.offer_number_pattern ?? 'OF/{YYYY}/{NR}',
    order_number_pattern: currentCompany?.settings?.order_number_pattern ?? 'ZM/{YYYY}/{NR}',
    act_number_pattern: currentCompany?.settings?.act_number_pattern ?? 'AKT/{YYYY}/{MM}/{NR}',
    gantt_hours_per_day: currentCompany?.settings?.gantt_hours_per_day ?? 8,
    gantt_work_days_per_week: currentCompany?.settings?.gantt_work_days_per_week ?? '5',
    gantt_default_view: currentCompany?.settings?.gantt_default_view ?? 'week',
  });
  const [isSavingConstruction, setIsSavingConstruction] = useState(false);

  const handleConstructionChange = (field: string, value: any) => {
    setConstructionSettings(prev => ({ ...prev, [field]: value }));
  };

  const handleSaveConstruction = async () => {
    if (!currentCompany) return;
    setIsSavingConstruction(true);
    try {
      const updatedSettings = { ...(currentCompany.settings || {}), ...constructionSettings };
      const { error } = await supabase
        .from('companies')
        .update({ settings: updatedSettings })
        .eq('id', currentCompany.id);
      if (error) throw error;
      showToast('success', 'Ustawienia budowlane zapisane pomyślnie');
    } catch (err) {
      console.error('Error saving construction settings:', err);
      showToast('error', 'Błąd podczas zapisywania ustawień budowlanych');
    } finally {
      setIsSavingConstruction(false);
    }
  };

  const handleDayChange = (day: keyof WorkingHours, field: keyof WorkingHoursDay, value: any) => {
    setWorkingHours(prev => ({
      ...prev,
      [day]: {
        ...prev[day],
        [field]: value,
        ...(field === 'enabled' && !value ? { start_time: null, end_time: null } : {}),
        ...(field === 'enabled' && value ? { start_time: '08:00', end_time: '16:00' } : {}),
      },
    }));
  };

  const handleRoundTimeChange = (
    setter: React.Dispatch<React.SetStateAction<RoundTime>>,
    field: 'precision' | 'method',
    value: number | string
  ) => {
    setter(prev => {
      if (field === 'precision') {
        const precision = Number(value);
        return {
          precision,
          method: precision === 0 ? 'none' : (prev.method === 'none' ? 'ceil' : prev.method),
        };
      }
      return { ...prev, method: value as RoundTime['method'] };
    });
  };

  const handleSaveWorkTime = async () => {
    if (!currentCompany) return;
    setIsSavingWorkTime(true);
    try {
      const payload = {
        timezone,
        currency,
        allow_weekend_access: allowWeekendAccess,
        max_working_time_minutes: maxWorkingTimeMinutes === '' ? null : Number(maxWorkingTimeMinutes),
        delay_tolerance_minutes: delayToleranceMinutes === '' ? null : Number(delayToleranceMinutes),
        night_time_from: nightTimeFrom,
        night_time_to: nightTimeTo,
        working_hours: workingHours,
        start_round_time: startRoundTime,
        finish_round_time: finishRoundTime,
      };

      const { error } = await supabase
        .from('companies')
        .update(payload)
        .eq('id', currentCompany.id);

      if (error) throw error;
      showToast('success', 'Ustawienia czasu pracy zapisane pomyślnie');
    } catch (error) {
      console.error('Error saving working time settings:', error);
      showToast('error', 'Błąd podczas zapisywania ustawień czasu pracy');
    } finally {
      setIsSavingWorkTime(false);
    }
  };

  // ═══ Tab 3: Dni wolne ═══
  const [holidays, setHolidays] = useState<HolidayDay[]>([]);
  const [isLoadingHolidays, setIsLoadingHolidays] = useState(false);
  const [newHolidayDate, setNewHolidayDate] = useState('');
  const [newHolidayName, setNewHolidayName] = useState('');
  const [newHolidayRecurring, setNewHolidayRecurring] = useState(false);
  const [holidayYear, setHolidayYear] = useState(new Date().getFullYear());

  const fetchHolidays = useCallback(async () => {
    if (!currentCompany) return;
    setIsLoadingHolidays(true);
    try {
      const { data, error } = await supabase
        .from('holiday_days')
        .select('*')
        .eq('company_id', currentCompany.id)
        .order('date', { ascending: true });

      if (error) throw error;
      setHolidays(data || []);
    } catch (error) {
      console.error('Error fetching holidays:', error);
    } finally {
      setIsLoadingHolidays(false);
    }
  }, [currentCompany]);

  useEffect(() => {
    if (activeTab === 'holidays') {
      fetchHolidays();
    }
  }, [activeTab, fetchHolidays]);

  const handleAddHoliday = async () => {
    if (!currentCompany || !newHolidayDate || !newHolidayName.trim()) return;
    try {
      const { error } = await supabase
        .from('holiday_days')
        .insert({
          company_id: currentCompany.id,
          date: newHolidayDate,
          name: newHolidayName.trim(),
          is_recurring: newHolidayRecurring,
          country_code: 'PL',
        });

      if (error) throw error;
      setNewHolidayDate('');
      setNewHolidayName('');
      setNewHolidayRecurring(false);
      await fetchHolidays();
    } catch (error) {
      console.error('Error adding holiday:', error);
      showToast('error', 'Błąd podczas dodawania dnia wolnego');
    }
  };

  const handleDeleteHoliday = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć ten dzień wolny?')) return;
    try {
      const { error } = await supabase
        .from('holiday_days')
        .delete()
        .eq('id', id);

      if (error) throw error;
      await fetchHolidays();
    } catch (error) {
      console.error('Error deleting holiday:', error);
      showToast('error', 'Błąd podczas usuwania dnia wolnego');
    }
  };

  const handleLoadPolishHolidays = async () => {
    if (!currentCompany) return;
    if (!confirm(`Załadować polskie dni wolne na rok ${holidayYear}? Istniejące wpisy nie zostaną duplikowane.`)) return;

    try {
      // Fixed holidays
      const fixed = POLISH_HOLIDAYS.map(h => ({
        company_id: currentCompany.id,
        date: `${holidayYear}-${h.monthDay}`,
        name: h.name,
        is_recurring: true,
        country_code: 'PL',
      }));

      // Movable holidays
      const movable = getPolishMovableHolidays(holidayYear).map(h => ({
        company_id: currentCompany.id,
        date: h.date,
        name: h.name,
        is_recurring: false,
        country_code: 'PL',
      }));

      const allHolidays = [...fixed, ...movable];

      // Check existing dates to avoid duplicates
      const { data: existing } = await supabase
        .from('holiday_days')
        .select('date')
        .eq('company_id', currentCompany.id)
        .in('date', allHolidays.map(h => h.date));

      const existingDates = new Set((existing || []).map(e => e.date));
      const toInsert = allHolidays.filter(h => !existingDates.has(h.date));

      if (toInsert.length === 0) {
        showToast('error', `Wszystkie polskie święta na rok ${holidayYear} już istnieją.`);
        return;
      }

      const { error } = await supabase
        .from('holiday_days')
        .insert(toInsert);

      if (error) throw error;
      showToast('success', `Dodano ${toInsert.length} dni wolnych na rok ${holidayYear}.`);
      await fetchHolidays();
    } catch (error) {
      console.error('Error loading Polish holidays:', error);
      showToast('error', 'Błąd podczas ładowania polskich dni wolnych');
    }
  };

  // ═══ Guard ═══
  if (!currentCompany) {
    return (
      <div className="p-6">
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 text-center">
          <AlertTriangle className="w-12 h-12 text-yellow-500 mx-auto mb-3" />
          <p className="text-yellow-800">Brak przypisanej firmy</p>
        </div>
      </div>
    );
  }

  // ═══ Render ═══
  return (
    <div className="p-4 lg:p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Ustawienia firmy</h1>
        <p className="text-slate-500 mt-1">Zarządzaj danymi i ustawieniami swojej firmy</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-slate-100 rounded-lg p-1 w-fit">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition ${
              activeTab === tab.key
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          Tab 1: Dane firmy
          ════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'company' && (
        <>
          {/* Company Info Form */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                <Building2 className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Dane firmy</h2>
                <p className="text-sm text-slate-500">Te dane będą wykorzystywane na fakturach</p>
              </div>
            </div>

            {/* Logo Upload */}
            <div className="mb-6 pb-6 border-b border-slate-100">
              <label className="block text-sm font-medium text-slate-700 mb-3">Logotyp firmy</label>
              <div className="flex items-center gap-5">
                <div className="relative group">
                  {logoUrl ? (
                    <div className="w-24 h-24 rounded-xl border-2 border-slate-200 overflow-hidden bg-white flex items-center justify-center">
                      <img src={logoUrl} alt="Logo firmy" className="max-w-full max-h-full object-contain" />
                    </div>
                  ) : (
                    <div className="w-24 h-24 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 flex items-center justify-center">
                      <Camera className="w-8 h-8 text-slate-300" />
                    </div>
                  )}
                  {logoUploading && (
                    <div className="absolute inset-0 bg-white/80 rounded-xl flex items-center justify-center">
                      <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 cursor-pointer transition">
                    <Upload className="w-4 h-4" />
                    {logoUrl ? 'Zmień logo' : 'Wgraj logo'}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleLogoUpload(file);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  {logoUrl && (
                    <button
                      onClick={handleRemoveLogo}
                      className="flex items-center gap-2 px-4 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition"
                    >
                      <X className="w-4 h-4" />
                      Usuń logo
                    </button>
                  )}
                  <p className="text-xs text-slate-400">PNG, JPG lub SVG. Maks. 2 MB</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">Nazwa firmy *</label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleFormChange}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">Nazwa prawna (do faktur)</label>
                <input
                  type="text"
                  name="legal_name"
                  value={formData.legal_name}
                  onChange={handleFormChange}
                  placeholder="np. Firma Sp. z o.o."
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">NIP</label>
                <input
                  type="text"
                  name="tax_id"
                  value={formData.tax_id}
                  onChange={handleFormChange}
                  placeholder="np. 1234567890"
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">REGON</label>
                <input
                  type="text"
                  name="regon"
                  value={formData.regon}
                  onChange={handleFormChange}
                  placeholder="np. 123456789"
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">Ulica i numer</label>
                <input
                  type="text"
                  name="address_street"
                  value={formData.address_street}
                  onChange={handleFormChange}
                  placeholder="np. ul. Przykładowa 123"
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Kod pocztowy</label>
                <input
                  type="text"
                  name="address_postal_code"
                  value={formData.address_postal_code}
                  onChange={handleFormChange}
                  placeholder="np. 00-000"
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Miasto</label>
                <input
                  type="text"
                  name="address_city"
                  value={formData.address_city}
                  onChange={handleFormChange}
                  placeholder="np. Warszawa"
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Kraj</label>
                <input
                  type="text"
                  name="address_country"
                  value={formData.address_country}
                  onChange={handleFormChange}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Contact Info — company */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Dane kontaktowe firmy</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Email kontaktowy</label>
                <input
                  type="email"
                  name="contact_email"
                  value={formData.contact_email}
                  onChange={handleFormChange}
                  placeholder="kontakt@firma.pl"
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Telefon</label>
                <input
                  type="tel"
                  name="contact_phone"
                  value={formData.contact_phone}
                  onChange={handleFormChange}
                  placeholder="+48 123 456 789"
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">Email do faktur</label>
                <input
                  type="email"
                  name="billing_email"
                  value={formData.billing_email}
                  onChange={handleFormChange}
                  placeholder="faktury@firma.pl"
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="text-xs text-slate-500 mt-1">Na ten adres będą wysyłane faktury</p>
              </div>
            </div>
          </div>

          {/* Save Button — company data */}
          <div className="flex justify-end mb-6">
            <button
              onClick={handleSave}
              disabled={isSaving || !formData.name}
              className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition"
            >
              <Save className="w-5 h-5" />
              {isSaving ? 'Zapisywanie...' : 'Zapisz zmiany'}
            </button>
          </div>

          {/* User Contact Data */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center">
                <User className="w-6 h-6 text-emerald-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Dane kontaktowe użytkownika</h2>
                <p className="text-sm text-slate-500">Twoje dane osobowe</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Imię</label>
                <input
                  type="text"
                  value={contactFirstName}
                  onChange={(e) => setContactFirstName(e.target.value)}
                  placeholder="Jan"
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nazwisko</label>
                <input
                  type="text"
                  value={contactLastName}
                  onChange={(e) => setContactLastName(e.target.value)}
                  placeholder="Kowalski"
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Numer telefonu</label>
                <input
                  type="tel"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="+48 123 456 789"
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  <span className="flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-slate-400" />
                    Adres email
                  </span>
                </label>
                <input
                  type="email"
                  value={currentUser?.email || ''}
                  disabled
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-500 cursor-not-allowed"
                />
                <p className="text-xs text-slate-400 mt-1">Adres email nie może być zmieniony</p>
              </div>
            </div>

            <div className="flex justify-end mt-6">
              <button
                onClick={handleSaveContact}
                disabled={isSaving}
                className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition"
              >
                <Save className="w-5 h-5" />
                {isSaving ? 'Zapisywanie...' : 'Zapisz dane kontaktowe'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          Tab 2: Czas pracy
          ════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'working_time' && (
        <>
          {/* Basic Settings */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center">
                <Clock className="w-6 h-6 text-indigo-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Podstawowe ustawienia</h2>
                <p className="text-sm text-slate-500">Strefa czasowa, waluta i ogólne parametry</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* Timezone */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Strefa czasowa</label>
                <select
                  value={timezone}
                  onChange={e => setTimezone(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                >
                  {TIMEZONES.map(tz => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </select>
              </div>

              {/* Currency */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Waluta</label>
                <select
                  value={currency}
                  onChange={e => setCurrency(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                >
                  {CURRENCIES.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              {/* Allow Weekend Access */}
              <div className="flex items-end">
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <div
                    className={`relative w-11 h-6 rounded-full transition-colors ${
                      allowWeekendAccess ? 'bg-blue-600' : 'bg-slate-300'
                    }`}
                    onClick={() => setAllowWeekendAccess(!allowWeekendAccess)}
                  >
                    <div
                      className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                        allowWeekendAccess ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </div>
                  <span className="text-sm font-medium text-slate-700">Dostęp w weekendy</span>
                </label>
              </div>

              {/* Max Working Time */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Maks. czas pracy (min.)</label>
                <input
                  type="number"
                  value={maxWorkingTimeMinutes}
                  onChange={e => setMaxWorkingTimeMinutes(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="np. 480"
                  min={0}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="text-xs text-slate-500 mt-1">480 min. = 8 godzin</p>
              </div>

              {/* Delay Tolerance */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Tolerancja spóźnienia (min.)</label>
                <input
                  type="number"
                  value={delayToleranceMinutes}
                  onChange={e => setDelayToleranceMinutes(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="puste = brak tolerancji"
                  min={0}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="text-xs text-slate-500 mt-1">Pozostaw puste, aby wyłączyć</p>
              </div>
            </div>
          </div>

          {/* Night Shift */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 bg-violet-100 rounded-xl flex items-center justify-center">
                <Moon className="w-6 h-6 text-violet-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Pora nocna</h2>
                <p className="text-sm text-slate-500">Godziny uznawane za pracę nocną (dodatek nocny)</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-lg">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Od godziny</label>
                <input
                  type="time"
                  value={nightTimeFrom}
                  onChange={e => setNightTimeFrom(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Do godziny</label>
                <input
                  type="time"
                  value={nightTimeTo}
                  onChange={e => setNightTimeTo(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Working Hours by Day */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center">
                <Sun className="w-6 h-6 text-emerald-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Godziny pracy</h2>
                <p className="text-sm text-slate-500">Domyślne godziny pracy dla każdego dnia tygodnia</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left text-sm font-medium text-slate-600 py-3 pr-4 w-40">Dzień</th>
                    <th className="text-center text-sm font-medium text-slate-600 py-3 px-4 w-24">Aktywny</th>
                    <th className="text-left text-sm font-medium text-slate-600 py-3 px-4 w-40">Początek</th>
                    <th className="text-left text-sm font-medium text-slate-600 py-3 px-4 w-40">Koniec</th>
                  </tr>
                </thead>
                <tbody>
                  {DAY_KEYS.map(day => {
                    const d = workingHours[day];
                    return (
                      <tr key={day} className="border-b border-slate-100 last:border-b-0">
                        <td className="py-3 pr-4">
                          <span className="text-sm font-medium text-slate-800">{DAY_LABELS[day]}</span>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <div
                            className={`relative inline-block w-11 h-6 rounded-full transition-colors cursor-pointer ${
                              d.enabled ? 'bg-blue-600' : 'bg-slate-300'
                            }`}
                            onClick={() => handleDayChange(day, 'enabled', !d.enabled)}
                          >
                            <div
                              className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                                d.enabled ? 'translate-x-5' : 'translate-x-0'
                              }`}
                            />
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <input
                            type="time"
                            value={d.start_time || ''}
                            onChange={e => handleDayChange(day, 'start_time', e.target.value)}
                            disabled={!d.enabled}
                            className="w-full px-3 py-1.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-slate-50 disabled:text-slate-400"
                          />
                        </td>
                        <td className="py-3 px-4">
                          <input
                            type="time"
                            value={d.end_time || ''}
                            onChange={e => handleDayChange(day, 'end_time', e.target.value)}
                            disabled={!d.enabled}
                            className="w-full px-3 py-1.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-slate-50 disabled:text-slate-400"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Time Rounding */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center">
                <Clock className="w-6 h-6 text-amber-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Zaokrąglanie czasu</h2>
                <p className="text-sm text-slate-500">Reguły zaokrąglania czasu wejścia i wyjścia</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Start Round Time */}
              <div>
                <h3 className="text-sm font-semibold text-slate-800 mb-3">Zaokrąglanie wejścia</h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm text-slate-600 mb-1">Precyzja (minuty)</label>
                    <select
                      value={startRoundTime.precision}
                      onChange={e => handleRoundTimeChange(setStartRoundTime, 'precision', e.target.value)}
                      className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                    >
                      {ROUND_PRECISIONS.map(p => (
                        <option key={p} value={p}>{p === 0 ? 'Brak zaokrąglania' : `${p} min`}</option>
                      ))}
                    </select>
                  </div>
                  {startRoundTime.precision > 0 && (
                    <div>
                      <label className="block text-sm text-slate-600 mb-1">Metoda</label>
                      <select
                        value={startRoundTime.method}
                        onChange={e => handleRoundTimeChange(setStartRoundTime, 'method', e.target.value)}
                        className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                      >
                        {ROUND_METHODS.map(m => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>

              {/* Finish Round Time */}
              <div>
                <h3 className="text-sm font-semibold text-slate-800 mb-3">Zaokrąglanie wyjścia</h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm text-slate-600 mb-1">Precyzja (minuty)</label>
                    <select
                      value={finishRoundTime.precision}
                      onChange={e => handleRoundTimeChange(setFinishRoundTime, 'precision', e.target.value)}
                      className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                    >
                      {ROUND_PRECISIONS.map(p => (
                        <option key={p} value={p}>{p === 0 ? 'Brak zaokrąglania' : `${p} min`}</option>
                      ))}
                    </select>
                  </div>
                  {finishRoundTime.precision > 0 && (
                    <div>
                      <label className="block text-sm text-slate-600 mb-1">Metoda</label>
                      <select
                        value={finishRoundTime.method}
                        onChange={e => handleRoundTimeChange(setFinishRoundTime, 'method', e.target.value)}
                        className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                      >
                        {ROUND_METHODS.map(m => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Save Button */}
          <div className="flex justify-end">
            <button
              onClick={handleSaveWorkTime}
              disabled={isSavingWorkTime}
              className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition"
            >
              <Save className="w-5 h-5" />
              {isSavingWorkTime ? 'Zapisywanie...' : 'Zapisz ustawienia czasu pracy'}
            </button>
          </div>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          Tab 3: Dni wolne
          ════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'holidays' && (
        <>
          {/* Add Holiday Form */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 bg-rose-100 rounded-xl flex items-center justify-center">
                <CalendarDays className="w-6 h-6 text-rose-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Dodaj dzień wolny</h2>
                <p className="text-sm text-slate-500">Dodaj własne święta lub dni wolne od pracy</p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 items-end">
              <div className="flex-1 min-w-0">
                <label className="block text-sm font-medium text-slate-700 mb-1">Data</label>
                <input
                  type="date"
                  value={newHolidayDate}
                  onChange={e => setNewHolidayDate(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div className="flex-[2] min-w-0">
                <label className="block text-sm font-medium text-slate-700 mb-1">Nazwa</label>
                <input
                  type="text"
                  value={newHolidayName}
                  onChange={e => setNewHolidayName(e.target.value)}
                  placeholder="np. Wigilia"
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer select-none whitespace-nowrap pb-0.5">
                <input
                  type="checkbox"
                  checked={newHolidayRecurring}
                  onChange={e => setNewHolidayRecurring(e.target.checked)}
                  className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                />
                <span className="text-sm text-slate-700">Cykliczny</span>
              </label>
              <button
                onClick={handleAddHoliday}
                disabled={!newHolidayDate || !newHolidayName.trim()}
                className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition whitespace-nowrap"
              >
                <Plus className="w-4 h-4" />
                Dodaj
              </button>
            </div>
          </div>

          {/* Load Polish Holidays */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
            <h3 className="text-sm font-semibold text-slate-800 mb-3">Załaduj polskie święta</h3>
            <div className="flex items-center gap-4">
              <div>
                <label className="block text-sm text-slate-600 mb-1">Rok</label>
                <input
                  type="number"
                  value={holidayYear}
                  onChange={e => setHolidayYear(Number(e.target.value))}
                  min={2020}
                  max={2050}
                  className="w-28 px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <button
                onClick={handleLoadPolishHolidays}
                className="flex items-center gap-2 px-5 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition mt-5"
              >
                <Download className="w-4 h-4" />
                Załaduj święta na {holidayYear}
              </button>
            </div>
          </div>

          {/* Holidays Table */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">
                Lista dni wolnych
                {holidays.length > 0 && (
                  <span className="text-sm font-normal text-slate-500 ml-2">({holidays.length})</span>
                )}
              </h2>
            </div>

            {isLoadingHolidays ? (
              <div className="p-12 text-center text-slate-500">Ładowanie...</div>
            ) : holidays.length === 0 ? (
              <div className="p-12 text-center text-slate-500">
                Brak zdefiniowanych dni wolnych. Dodaj własne lub załaduj polskie święta.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="text-left text-sm font-medium text-slate-600 py-3 px-6">Data</th>
                      <th className="text-left text-sm font-medium text-slate-600 py-3 px-6">Nazwa</th>
                      <th className="text-center text-sm font-medium text-slate-600 py-3 px-6">Cykliczny</th>
                      <th className="text-right text-sm font-medium text-slate-600 py-3 px-6">Akcja</th>
                    </tr>
                  </thead>
                  <tbody>
                    {holidays.map(h => (
                      <tr key={h.id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50 transition">
                        <td className="py-3 px-6">
                          <span className="text-sm text-slate-800 font-mono">{h.date}</span>
                        </td>
                        <td className="py-3 px-6">
                          <span className="text-sm text-slate-800">{h.name}</span>
                        </td>
                        <td className="py-3 px-6 text-center">
                          {h.is_recurring ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                              Tak
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500">
                              Nie
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-6 text-right">
                          <button
                            onClick={() => handleDeleteHoliday(h.id)}
                            className="inline-flex items-center gap-1 px-3 py-1 text-sm text-red-600 hover:bg-red-50 rounded-lg transition"
                          >
                            <Trash2 className="w-4 h-4" />
                            Usuń
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          Tab 4: Budowlanka (Construction Settings)
          ════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'construction' && (
        <>
          {/* Default Markups */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center">
                <Percent className="w-6 h-6 text-amber-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Domyślne narzuty kosztorysowe</h2>
                <p className="text-sm text-slate-500">Ustawienia narzutów dla nowych kosztorysów</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Koszty pośrednie (%)</label>
                <input
                  type="number"
                  step="0.1"
                  value={constructionSettings.default_overhead_percent}
                  onChange={e => handleConstructionChange('default_overhead_percent', parseFloat(e.target.value) || 0)}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="text-xs text-slate-500 mt-1">Narzut na koszty ogólne budowy</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Zysk (%)</label>
                <input
                  type="number"
                  step="0.1"
                  value={constructionSettings.default_profit_percent}
                  onChange={e => handleConstructionChange('default_profit_percent', parseFloat(e.target.value) || 0)}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="text-xs text-slate-500 mt-1">Marża zysku</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Koszty zakupu materiałów (%)</label>
                <input
                  type="number"
                  step="0.1"
                  value={constructionSettings.default_material_purchase_percent}
                  onChange={e => handleConstructionChange('default_material_purchase_percent', parseFloat(e.target.value) || 0)}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="text-xs text-slate-500 mt-1">Kp materiałów</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Koszty zakupu sprzętu (%)</label>
                <input
                  type="number"
                  step="0.1"
                  value={constructionSettings.default_equipment_purchase_percent}
                  onChange={e => handleConstructionChange('default_equipment_purchase_percent', parseFloat(e.target.value) || 0)}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="text-xs text-slate-500 mt-1">Kp sprzętu</p>
              </div>
            </div>
          </div>

          {/* Number Formatting */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                <HardHat className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Numeracja dokumentów</h2>
                <p className="text-sm text-slate-500">Wzorce numeracji dla dokumentów budowlanych</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Wzorzec numeru kosztorysu</label>
                <input
                  type="text"
                  value={constructionSettings.estimate_number_pattern}
                  onChange={e => handleConstructionChange('estimate_number_pattern', e.target.value)}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="text-xs text-slate-500 mt-1">Dostępne zmienne: {'{YYYY}'}, {'{MM}'}, {'{NR}'}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Wzorzec numeru oferty</label>
                <input
                  type="text"
                  value={constructionSettings.offer_number_pattern}
                  onChange={e => handleConstructionChange('offer_number_pattern', e.target.value)}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Wzorzec numeru zamówienia</label>
                <input
                  type="text"
                  value={constructionSettings.order_number_pattern}
                  onChange={e => handleConstructionChange('order_number_pattern', e.target.value)}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Wzorzec numeru aktu</label>
                <input
                  type="text"
                  value={constructionSettings.act_number_pattern}
                  onChange={e => handleConstructionChange('act_number_pattern', e.target.value)}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Working Calendar */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center">
                <CalendarDays className="w-6 h-6 text-emerald-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Kalendarz roboczy budowy</h2>
                <p className="text-sm text-slate-500">Domyślne ustawienia dla harmonogramów Gantta</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Godziny pracy dziennie</label>
                <input
                  type="number"
                  value={constructionSettings.gantt_hours_per_day}
                  onChange={e => handleConstructionChange('gantt_hours_per_day', parseInt(e.target.value) || 8)}
                  min={1}
                  max={24}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Dni robocze w tygodniu</label>
                <select
                  value={constructionSettings.gantt_work_days_per_week}
                  onChange={e => handleConstructionChange('gantt_work_days_per_week', e.target.value)}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                >
                  <option value="5">5 dni (Pon-Pt)</option>
                  <option value="6">6 dni (Pon-Sob)</option>
                  <option value="7">7 dni</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Domyślny widok Gantta</label>
                <select
                  value={constructionSettings.gantt_default_view}
                  onChange={e => handleConstructionChange('gantt_default_view', e.target.value)}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                >
                  <option value="day">Dzienny</option>
                  <option value="week">Tygodniowy</option>
                  <option value="month">Miesięczny</option>
                </select>
              </div>
            </div>
          </div>

          {/* Save Button */}
          <div className="flex justify-end">
            <button
              onClick={handleSaveConstruction}
              disabled={isSavingConstruction}
              className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition"
            >
              <Save className="w-5 h-5" />
              {isSavingConstruction ? 'Zapisywanie...' : 'Zapisz ustawienia budowlane'}
            </button>
          </div>
        </>
      )}
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3.5 rounded-xl shadow-xl text-white text-sm font-medium animate-in slide-in-from-bottom-4 duration-300 ${
          toast.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'
        }`}>
          {toast.type === 'success' ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          )}
          {toast.message}
        </div>
      )}
    </div>
  );
};
