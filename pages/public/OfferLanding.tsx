import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import {
  FileText, CheckCircle, XCircle, Clock, Building2, Calendar,
  Download, Loader2, ExternalLink, Shield, Star, Phone, Mail
} from 'lucide-react';

interface PublicOffer {
  id: string;
  name: string;
  number: string;
  valid_until: string;
  total_amount: number;
  discount_percent: number;
  discount_amount: number;
  final_amount: number;
  notes: string;
  status: string;
  created_at: string;
  print_settings: any;
  object_name: string | null;
  object_address: string | null;
  work_start_date: string | null;
  work_end_date: string | null;
  company: {
    id: string;
    name: string;
    logo_url: string | null;
    nip: string;
    phone: string | null;
    email: string | null;
    street: string | null;
    building_number: string | null;
    city: string | null;
    postal_code: string | null;
  } | null;
  client: {
    name: string;
    nip: string | null;
    legal_address: string | null;
    phone: string | null;
    email: string | null;
  } | null;
  sections: {
    id: string;
    name: string;
    sort_order: number;
    items: {
      id: string;
      name: string;
      description: string;
      unit: string;
      quantity: number;
      unit_price: number;
      discount_percent: number;
      vat_rate: number;
      sort_order: number;
      is_optional: boolean;
      components?: {
        id: string;
        type: 'labor' | 'material' | 'equipment';
        name: string;
        code: string;
        unit: string;
        quantity: number;
        unit_price: number;
        total_price: number;
      }[];
    }[];
  }[];
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(value);

const formatDate = (date: string | null | undefined) => {
  if (!date) return '-';
  return new Date(date).toLocaleDateString('pl-PL', { year: 'numeric', month: 'long', day: 'numeric' });
};

export const OfferLandingPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [offer, setOffer] = useState<PublicOffer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (token) loadOffer(token);
  }, [token]);

  const loadOffer = async (publicToken: string) => {
    setLoading(true);
    try {
      // Find offer by public token
      let offerData: any = null;
      let offerErr: any = null;

      // Try exact public_token match first
      const res1 = await supabase
        .from('offers')
        .select('*')
        .eq('public_token', publicToken)
        .is('deleted_at', null)
        .maybeSingle();

      if (res1.data) {
        offerData = res1.data;
      } else {
        // Fallback: try matching by ID prefix (cast to text)
        const res2 = await supabase
          .from('offers')
          .select('*')
          .filter('id::text', 'ilike', `${publicToken}%`)
          .is('deleted_at', null)
          .limit(1);
        if (res2.data && res2.data.length > 0) {
          offerData = res2.data[0];
        } else {
          offerErr = res1.error || res2.error;
        }
      }

      if (offerErr || !offerData) {
        setError('Oferta nie została znaleziona lub link wygasł.');
        setLoading(false);
        return;
      }

      // Load company data separately (avoids RLS join issues)
      if (offerData.company_id) {
        const { data: companyData } = await supabase
          .from('companies')
          .select('id, name, logo_url, nip, phone, email, street, building_number, city, postal_code')
          .eq('id', offerData.company_id)
          .single();
        offerData.company = companyData;
      }

      // Fallback: use company_data from print_settings if company query failed (RLS)
      if (!offerData.company && offerData.print_settings?.company_data) {
        const cd = offerData.print_settings.company_data;
        offerData.company = {
          id: offerData.company_id || '',
          name: cd.name || '',
          logo_url: cd.logo_url || null,
          nip: cd.nip || null,
          phone: cd.phone || null,
          email: cd.email || null,
          street: cd.street || null,
          building_number: cd.building_number || null,
          city: cd.city || null,
          postal_code: cd.postal_code || null,
        };
      }

      // Track view
      await supabase
        .from('offers')
        .update({
          viewed_at: new Date().toISOString(),
          viewed_count: (offerData.viewed_count || 0) + 1
        })
        .eq('id', offerData.id);

      // Load sections, items, components and client
      const [sectionsRes, itemsRes, clientRes] = await Promise.all([
        supabase
          .from('offer_sections')
          .select('*')
          .eq('offer_id', offerData.id)
          .order('sort_order'),
        supabase
          .from('offer_items')
          .select('*')
          .eq('offer_id', offerData.id)
          .order('sort_order'),
        offerData.client_id
          ? supabase.from('contractors').select('name, nip, legal_address, phone, email').eq('id', offerData.client_id).single()
          : Promise.resolve({ data: null })
      ]);

      // Load components for items (R/M/S)
      const itemIds = (itemsRes.data || []).map((i: any) => i.id);
      let componentsMap: Record<string, any[]> = {};
      if (itemIds.length > 0) {
        const { data: comps } = await supabase
          .from('offer_item_components')
          .select('*')
          .in('offer_item_id', itemIds)
          .order('sort_order');
        (comps || []).forEach((c: any) => {
          if (!componentsMap[c.offer_item_id]) componentsMap[c.offer_item_id] = [];
          componentsMap[c.offer_item_id].push(c);
        });
      }

      const sections = (sectionsRes.data || []).map(s => ({
        ...s,
        items: (itemsRes.data || []).filter((i: any) => i.section_id === s.id).map((i: any) => ({
          ...i,
          components: componentsMap[i.id] || []
        }))
      }));

      // Add unsectioned items
      const unsectionedItems = (itemsRes.data || []).filter((i: any) => !i.section_id).map((i: any) => ({
        ...i,
        components: componentsMap[i.id] || []
      }));
      if (unsectionedItems.length > 0) {
        sections.unshift({
          id: 'unsectioned',
          name: 'Pozycje',
          sort_order: -1,
          items: unsectionedItems
        });
      }

      setOffer({
        ...offerData,
        client: clientRes.data as { name: string } | null,
        sections
      });
    } catch (err) {
      setError('Wystąpił błąd podczas ładowania oferty.');
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = async () => {
    if (!offer) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const { error: updateErr } = await supabase
        .from('offers')
        .update({
          status: 'accepted',
          accepted_at: new Date().toISOString()
        })
        .eq('id', offer.id);
      if (updateErr) throw updateErr;
      setAccepted(true);
    } catch (err: any) {
      setActionError('Nie udało się zaakceptować oferty. Spróbuj ponownie.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    if (!offer) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const { error: updateErr } = await supabase
        .from('offers')
        .update({
          status: 'rejected',
          rejection_reason: rejectionReason || null
        })
        .eq('id', offer.id);
      if (updateErr) throw updateErr;
      setRejected(true);
      setShowRejectForm(false);
    } catch (err: any) {
      setActionError('Nie udało się odrzucić oferty. Spróbuj ponownie.');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin text-blue-500 mx-auto mb-4" />
          <p className="text-slate-500">Ładowanie oferty...</p>
        </div>
      </div>
    );
  }

  if (error || !offer) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md text-center">
          <FileText className="w-16 h-16 text-slate-300 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-slate-900 mb-2">Oferta niedostępna</h1>
          <p className="text-slate-500">{error || 'Nie udało się załadować oferty.'}</p>
        </div>
      </div>
    );
  }

  const issueDate = offer.print_settings?.issue_date || offer.created_at;
  const isExpired = offer.valid_until && new Date(offer.valid_until) < new Date();

  // Show expired page with company contact info
  if (isExpired && offer.status !== 'accepted') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-lg text-center space-y-6">
          <Clock className="w-16 h-16 text-red-400 mx-auto" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 mb-2">Oferta nieważna</h1>
            <p className="text-slate-500">
              Oferta <strong>{offer.number}</strong> straciła ważność dnia {formatDate(offer.valid_until)}.
            </p>
          </div>
          {offer.company && (
            <div className="bg-slate-50 rounded-xl p-6 text-left space-y-3">
              <p className="text-sm text-slate-500">Skontaktuj się z:</p>
              <p className="text-lg font-bold text-slate-900">{offer.company.name}</p>
              {offer.company.nip && (
                <p className="text-sm text-slate-600">NIP: {offer.company.nip}</p>
              )}
              {(offer.company.street || offer.company.city) && (
                <p className="text-sm text-slate-600 flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-slate-400 shrink-0" />
                  {[offer.company.street, offer.company.building_number].filter(Boolean).join(' ')}
                  {offer.company.city && `, ${[offer.company.postal_code, offer.company.city].filter(Boolean).join(' ')}`}
                </p>
              )}
              {offer.company.email && (
                <p className="text-sm text-slate-600 flex items-center gap-2">
                  <Mail className="w-4 h-4 text-slate-400 shrink-0" />
                  <a href={`mailto:${offer.company.email}`} className="text-blue-600 hover:underline">{offer.company.email}</a>
                </p>
              )}
              {offer.company.phone && (
                <p className="text-sm text-slate-600 flex items-center gap-2">
                  <Phone className="w-4 h-4 text-slate-400 shrink-0" />
                  <a href={`tel:${offer.company.phone}`} className="text-blue-600 hover:underline">{offer.company.phone}</a>
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }
  const totalNetto = offer.sections.reduce((sum, s) =>
    sum + s.items.reduce((si, i) => si + i.quantity * i.unit_price, 0), 0);
  const totalDiscount = offer.sections.reduce((sum, s) =>
    sum + s.items.reduce((si, i) => {
      const itemTotal = i.quantity * i.unit_price;
      return si + itemTotal * ((i.discount_percent || 0) / 100);
    }, 0), 0);
  const nettoAfterDiscount = totalNetto - totalDiscount;

  // Calculate surcharges from warunki (respecting apply flags)
  const warunki = offer.print_settings?.warunki;
  const surchargePercent = (() => {
    if (!warunki) return 0;
    const ptRule = (warunki.payment_term_rules || []).find((r: any) => String(r.value) === String(warunki.payment_term));
    const wrRule = (warunki.warranty_rules || []).find((r: any) => String(r.value) === String(warunki.warranty_period));
    const ifRule = (warunki.invoice_freq_rules || []).find((r: any) => String(r.value) === String(warunki.invoice_frequency));
    return (warunki.payment_term_apply !== false ? (ptRule?.surcharge || 0) : 0) +
      (warunki.warranty_apply !== false ? (wrRule?.surcharge || 0) : 0) +
      (warunki.invoice_freq_apply !== false ? (ifRule?.surcharge || 0) : 0);
  })();
  const surchargeAmount = nettoAfterDiscount * (surchargePercent / 100);
  const nettoAfterSurcharges = nettoAfterDiscount + surchargeAmount;

  const vatAmount = offer.sections.reduce((sum, s) =>
    sum + s.items.reduce((si, i) => {
      const itemTotal = i.quantity * i.unit_price;
      const itemDiscount = itemTotal * ((i.discount_percent || 0) / 100);
      return si + (itemTotal - itemDiscount) * ((i.vat_rate ?? 23) / 100);
    }, 0), 0);
  // VAT should be based on nettoAfterSurcharges for proper total
  const vatOnSurcharges = surchargeAmount * 0.23;
  const brutto = nettoAfterSurcharges + vatAmount + vatOnSurcharges;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50">
      {/* Hero header */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-800 text-white">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {offer.company?.logo_url ? (
                <img
                  src={offer.company.logo_url}
                  alt={offer.company.name}
                  className="w-14 h-14 rounded-xl bg-white/10 object-contain p-1"
                />
              ) : (
                <div className="w-14 h-14 rounded-xl bg-white/10 flex items-center justify-center">
                  <Building2 className="w-7 h-7" />
                </div>
              )}
              <div>
                <h1 className="text-2xl font-bold">{offer.company?.name || 'Firma'}</h1>
                {offer.company?.nip && <p className="text-blue-200 text-sm">NIP: {offer.company.nip}</p>}
              </div>
            </div>
            <div className="text-right">
              <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${
                accepted || offer.status === 'accepted' ? 'bg-green-500/20 text-green-100' :
                rejected || offer.status === 'rejected' ? 'bg-red-500/20 text-red-200' :
                isExpired ? 'bg-red-500/20 text-red-200' :
                'bg-white/20 text-white'
              }`}>
                {accepted || offer.status === 'accepted' ? (
                  <><CheckCircle className="w-4 h-4" /> Zaakceptowana</>
                ) : rejected || offer.status === 'rejected' ? (
                  <><XCircle className="w-4 h-4" /> Odrzucona</>
                ) : isExpired ? (
                  <><Clock className="w-4 h-4" /> Wygasła</>
                ) : (
                  <><Clock className="w-4 h-4" /> Aktywna</>
                )}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="max-w-4xl mx-auto px-6 -mt-4">
        {/* Offer card */}
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
          {/* Offer header */}
          <div className="p-8 border-b border-slate-100">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-sm text-blue-600 font-medium mb-1">{offer.number}</p>
                <h2 className="text-2xl font-bold text-slate-900">{offer.name}</h2>
                {offer.client && (
                  <p className="text-slate-500 mt-2">Dla: <span className="font-medium text-slate-700">{offer.client.name}</span></p>
                )}
              </div>
              <div className="text-right text-sm text-slate-500 space-y-1">
                <div className="flex items-center gap-2 justify-end">
                  <Calendar className="w-4 h-4" />
                  <span>Wystawiona: {formatDate(issueDate)}</span>
                </div>
                <div className="flex items-center gap-2 justify-end">
                  <Clock className="w-4 h-4" />
                  <span>Ważna do: <span className={isExpired ? 'text-red-500 font-medium' : 'font-medium text-slate-700'}>{formatDate(offer.valid_until)}</span></span>
                </div>
                {offer.object_name && (
                  <div className="flex items-center gap-2 justify-end">
                    <Building2 className="w-4 h-4" />
                    <span>Obiekt: <span className="font-medium text-slate-700">{offer.object_name}</span></span>
                  </div>
                )}
                {offer.object_address && (
                  <div className="flex items-center gap-2 justify-end">
                    <ExternalLink className="w-4 h-4" />
                    <span>{offer.object_address}</span>
                  </div>
                )}
                {(offer.work_start_date || offer.work_end_date) && (
                  <div className="flex items-center gap-2 justify-end">
                    <Calendar className="w-4 h-4" />
                    <span>Termin: {offer.work_start_date ? formatDate(offer.work_start_date) : '?'} — {offer.work_end_date ? formatDate(offer.work_end_date) : '?'}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Zamawiający / Wykonawca */}
          <div className="px-8 py-6 border-b border-slate-100">
          {(offer.client || offer.company || offer.print_settings?.client_data) && (
            <div>
              <div className="grid grid-cols-2 gap-8">
                <div>
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Zamawiający</h4>
                  {(() => {
                    const cd = offer.print_settings?.client_data || {};
                    const clientName = offer.client?.name || cd.client_name || '';
                    const clientNip = offer.client?.nip || cd.nip || '';
                    const clientAddr = offer.client?.legal_address || [cd.company_street, cd.company_street_number, cd.company_postal_code, cd.company_city].filter(Boolean).join(', ');
                    const repName = cd.representative_name || '';
                    const repEmail = cd.representative_email || offer.client?.email || '';
                    const repPhone = cd.representative_phone || offer.client?.phone || '';
                    return clientName ? (
                      <div className="text-sm text-slate-700 space-y-0.5">
                        <p className="font-semibold text-slate-900">{clientName}</p>
                        {clientNip && <p>NIP: {clientNip}</p>}
                        {clientAddr && <p>{clientAddr}</p>}
                        {repName && <p className="mt-1">Przedstawiciel: {repName}</p>}
                        {repEmail && <p>email: {repEmail}</p>}
                        {repPhone && <p>tel. {repPhone}</p>}
                      </div>
                    ) : (
                      <p className="text-sm text-slate-400 italic">Brak danych</p>
                    );
                  })()}
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Wykonawca</h4>
                  {offer.company ? (
                    <div className="text-sm text-slate-700 space-y-0.5">
                      <p className="font-semibold text-slate-900">{offer.company.name}</p>
                      {offer.company.nip && <p>NIP: {offer.company.nip}</p>}
                      {(offer.company.street || offer.company.city) && (
                        <p>{[offer.company.street, offer.company.building_number, offer.company.postal_code, offer.company.city].filter(Boolean).join(', ')}</p>
                      )}
                      {offer.company.phone && <p>tel. {offer.company.phone}</p>}
                      {offer.company.email && <p>email: {offer.company.email}</p>}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-400 italic">Brak danych</p>
                  )}
                </div>
              </div>
            </div>
          )}
          </div>

          {/* Sections & Items */}
          <div className="p-8">
            {offer.sections.map(section => (
              <div key={section.id} className="mb-8 last:mb-0">
                <h3 className="text-lg font-semibold text-slate-900 mb-4 pb-2 border-b-2 border-blue-100">
                  {section.name}
                </h3>
                <table className="w-full">
                  <thead>
                    <tr className="text-left text-sm text-slate-500">
                      <th className="pb-3 pr-4 w-10">Lp.</th>
                      <th className="pb-3 pr-4">Nazwa</th>
                      <th className="pb-3 pr-4 text-center w-16">Jedn.</th>
                      <th className="pb-3 pr-4 text-right w-20">Ilość</th>
                      <th className="pb-3 pr-4 text-right w-28">Cena jedn.</th>
                      <th className="pb-3 text-right w-28">Wartość</th>
                    </tr>
                  </thead>
                  <tbody>
                    {section.items.map((item, idx) => {
                      const itemTotal = item.quantity * item.unit_price;
                      const itemDiscount = itemTotal * ((item.discount_percent || 0) / 100);
                      const showRMS = offer.print_settings?.show_components_in_print && item.components && item.components.length > 0;
                      return (
                        <React.Fragment key={item.id}>
                        <tr className="border-t border-slate-50 hover:bg-slate-50/50">
                          <td className="py-3 pr-4 text-sm text-slate-400">{idx + 1}</td>
                          <td className="py-3 pr-4">
                            <p className="text-sm font-medium text-slate-900">{item.name}</p>
                            {item.description && <p className="text-xs text-slate-500 mt-0.5">{item.description}</p>}
                            {item.is_optional && <span className="text-[10px] bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded ml-1">opcja</span>}
                            {(item.discount_percent || 0) > 0 && (
                              <span className="text-xs text-red-500 ml-1">-{item.discount_percent}%</span>
                            )}
                          </td>
                          <td className="py-3 pr-4 text-sm text-center text-slate-500">{item.unit || 'szt.'}</td>
                          <td className="py-3 pr-4 text-sm text-right text-slate-600">{item.quantity}</td>
                          <td className="py-3 pr-4 text-sm text-right text-slate-600">{formatCurrency(item.unit_price)}</td>
                          <td className="py-3 text-sm text-right font-medium text-slate-900">
                            {formatCurrency(itemTotal - itemDiscount)}
                          </td>
                        </tr>
                        {showRMS && item.components!.map((comp, ci) => (
                          <tr key={`comp-${ci}`} className="bg-slate-50/50 border-t border-slate-50">
                            <td className="py-1 pr-4"></td>
                            <td className="py-1 pr-4" colSpan={2}>
                              <span className={`inline-block w-4 h-4 rounded text-[9px] font-bold text-white text-center leading-4 mr-1.5 ${comp.type === 'labor' ? 'bg-blue-500' : comp.type === 'material' ? 'bg-amber-500' : 'bg-emerald-500'}`}>
                                {comp.type === 'labor' ? 'R' : comp.type === 'material' ? 'M' : 'S'}
                              </span>
                              <span className="text-xs text-slate-500">{comp.name}{comp.code ? ` [${comp.code}]` : ''}</span>
                            </td>
                            <td className="py-1 pr-4 text-xs text-right text-slate-400">{comp.quantity}</td>
                            <td className="py-1 pr-4 text-xs text-right text-slate-400">{formatCurrency(comp.unit_price)}</td>
                            <td className="py-1 text-xs text-right text-slate-400">{formatCurrency(comp.total_price)}</td>
                          </tr>
                        ))}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>

          {/* Warunki istotne */}
          {(() => {
            const warunki = offer.print_settings?.warunki;
            if (!warunki) return null;
            const { payment_term, invoice_frequency, warranty_period, payment_term_rules, warranty_rules, invoice_freq_rules } = warunki;
            if (!payment_term && !invoice_frequency && !warranty_period) return null;
            return (
              <div className="px-8 py-6 border-t border-slate-100">
                <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Warunki istotne</h3>
                <div className="grid grid-cols-3 gap-4">
                  {payment_term && (
                    <div>
                      <p className="text-xs text-slate-500 mb-1">Termin płatności</p>
                      <p className="text-sm font-medium text-slate-900">{payment_term} dni
                        {(() => { const r = (payment_term_rules || []).find((r: any) => String(r.value) === String(payment_term)); const applied = warunki.payment_term_apply !== false; return r && r.surcharge !== 0 ? <span className={`ml-1 text-xs ${applied ? (r.surcharge > 0 ? 'text-red-500' : 'text-green-600') : 'text-slate-400'}`}>({r.surcharge > 0 ? '+' : ''}{r.surcharge}%{!applied ? ' - nie uwzgl.' : ''})</span> : null; })()}
                      </p>
                    </div>
                  )}
                  {invoice_frequency && (
                    <div>
                      <p className="text-xs text-slate-500 mb-1">Wystawienie faktur</p>
                      <p className="text-sm font-medium text-slate-900">co {invoice_frequency} dni
                        {(() => { const r = (invoice_freq_rules || []).find((r: any) => String(r.value) === String(invoice_frequency)); const applied = warunki.invoice_freq_apply !== false; return r && r.surcharge !== 0 ? <span className={`ml-1 text-xs ${applied ? (r.surcharge > 0 ? 'text-red-500' : 'text-green-600') : 'text-slate-400'}`}>({r.surcharge > 0 ? '+' : ''}{r.surcharge}%{!applied ? ' - nie uwzgl.' : ''})</span> : null; })()}
                      </p>
                    </div>
                  )}
                  {warranty_period && (
                    <div>
                      <p className="text-xs text-slate-500 mb-1">Okres gwarancyjny</p>
                      <p className="text-sm font-medium text-slate-900">{warranty_period} miesięcy
                        {(() => { const r = (warranty_rules || []).find((r: any) => String(r.value) === String(warranty_period)); const applied = warunki.warranty_apply !== false; return r && r.surcharge !== 0 ? <span className={`ml-1 text-xs ${applied ? (r.surcharge > 0 ? 'text-red-500' : 'text-green-600') : 'text-slate-400'}`}>({r.surcharge > 0 ? '+' : ''}{r.surcharge}%{!applied ? ' - nie uwzgl.' : ''})</span> : null; })()}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Koszty powiązane */}
          {(() => {
            const costs: any[] = offer.print_settings?.related_costs || [];
            const visibleCosts = costs.filter((c: any) => c.value > 0);
            if (visibleCosts.length === 0) return null;
            const shownCosts = visibleCosts.filter((c: any) => c.show_on_offer);
            const hiddenCosts = visibleCosts.filter((c: any) => !c.show_on_offer);
            const hiddenTotal = hiddenCosts.reduce((s: number, c: any) => s + (c.mode === 'percent' ? nettoAfterDiscount * (c.value / 100) : c.value), 0);
            const allTotal = visibleCosts.reduce((s: number, c: any) => s + (c.mode === 'percent' ? nettoAfterDiscount * (c.value / 100) : c.value), 0);
            return (
              <div className="px-8 py-6 border-t border-slate-100">
                <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Koszty powiązane</h3>
                <div className="space-y-1.5">
                  {shownCosts.map((c: any) => {
                    const val = c.mode === 'percent' ? nettoAfterDiscount * (c.value / 100) : c.value;
                    return (
                      <div key={c.id} className="flex justify-between text-sm">
                        <span className="text-slate-600">{c.name}{c.mode === 'percent' ? ` (${c.value}%)` : ''}{c.frequency === 'monthly' ? ' (mies.)' : ''}</span>
                        <span className="font-medium">{formatCurrency(val)}</span>
                      </div>
                    );
                  })}
                  {hiddenTotal > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600">Koszty powiązane</span>
                      <span className="font-medium">{formatCurrency(hiddenTotal)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm pt-1.5 border-t border-slate-200 font-semibold">
                    <span className="text-slate-700">Suma kosztów powiązanych:</span>
                    <span>{formatCurrency(allTotal)}</span>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Totals */}
          <div className="p-8 bg-gradient-to-r from-slate-50 to-blue-50/30 border-t border-slate-100">
            <div className="max-w-xs ml-auto space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">Suma netto:</span>
                <span className="font-medium">{formatCurrency(totalNetto)}</span>
              </div>
              {totalDiscount > 0 && (
                <div className="flex justify-between text-sm text-red-600">
                  <span>Rabat:</span>
                  <span>-{formatCurrency(totalDiscount)}</span>
                </div>
              )}
              {totalDiscount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Netto po rabacie:</span>
                  <span className="font-medium">{formatCurrency(nettoAfterDiscount)}</span>
                </div>
              )}
              {/* Surcharges from warunki (respecting apply flags) */}
              {(() => {
                const warunki = offer.print_settings?.warunki;
                if (!warunki) return null;
                const ptRule = (warunki.payment_term_rules || []).find((r: any) => String(r.value) === String(warunki.payment_term));
                const wrRule = (warunki.warranty_rules || []).find((r: any) => String(r.value) === String(warunki.warranty_period));
                const ifRule = (warunki.invoice_freq_rules || []).find((r: any) => String(r.value) === String(warunki.invoice_frequency));
                const totalSurcharge =
                  (warunki.payment_term_apply !== false ? (ptRule?.surcharge || 0) : 0) +
                  (warunki.warranty_apply !== false ? (wrRule?.surcharge || 0) : 0) +
                  (warunki.invoice_freq_apply !== false ? (ifRule?.surcharge || 0) : 0);
                if (totalSurcharge === 0) return null;
                const surchargeVal = nettoAfterDiscount * (totalSurcharge / 100);
                return (
                  <>
                    <div className={`flex justify-between text-sm ${totalSurcharge > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      <span>Warunki istotne ({totalSurcharge > 0 ? '+' : ''}{totalSurcharge}%):</span>
                      <span>{totalSurcharge > 0 ? '+' : ''}{formatCurrency(surchargeVal)}</span>
                    </div>
                    <div className="flex justify-between text-sm font-semibold">
                      <span className="text-slate-600">Netto po rabacie:</span>
                      <span>{formatCurrency(nettoAfterDiscount + surchargeVal)}</span>
                    </div>
                  </>
                );
              })()}
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">VAT:</span>
                <span className="font-medium">{formatCurrency(vatAmount + vatOnSurcharges)}</span>
              </div>
              <div className="flex justify-between pt-3 border-t-2 border-blue-200">
                <span className="text-lg font-bold text-slate-900">Brutto:</span>
                <span className="text-2xl font-bold text-blue-600">{formatCurrency(brutto)}</span>
              </div>
            </div>
          </div>

          {/* Notes */}
          {offer.notes && (
            <div className="p-8 border-t border-slate-100">
              <h3 className="font-semibold text-slate-900 mb-2">Uwagi</h3>
              <p className="text-sm text-slate-600 whitespace-pre-wrap">{offer.notes}</p>
            </div>
          )}

          {/* Action buttons */}
          {!accepted && !rejected && offer.status !== 'accepted' && offer.status !== 'rejected' && !isExpired && (
            <div className="p-8 border-t border-slate-100 text-center">
              {actionError && (
                <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg">{actionError}</div>
              )}
              <div className="flex items-center justify-center gap-4">
                <button
                  onClick={handleAccept}
                  disabled={actionLoading}
                  className="px-8 py-3 bg-green-600 text-white rounded-xl text-lg font-semibold hover:bg-green-700 transition shadow-lg shadow-green-200 disabled:opacity-50"
                >
                  {actionLoading ? <Loader2 className="w-5 h-5 inline-block mr-2 -mt-0.5 animate-spin" /> : <CheckCircle className="w-5 h-5 inline-block mr-2 -mt-0.5" />}
                  Akceptuję ofertę
                </button>
                <button
                  onClick={() => setShowRejectForm(!showRejectForm)}
                  disabled={actionLoading}
                  className="px-6 py-3 bg-white border border-slate-300 text-slate-700 rounded-xl font-medium hover:bg-slate-50 transition disabled:opacity-50"
                >
                  Odrzuć
                </button>
              </div>
              {showRejectForm && (
                <div className="mt-4 max-w-md mx-auto">
                  <textarea
                    value={rejectionReason}
                    onChange={e => setRejectionReason(e.target.value)}
                    placeholder="Powód odrzucenia (opcjonalnie)..."
                    className="w-full px-4 py-3 border border-slate-300 rounded-lg text-sm resize-none focus:ring-2 focus:ring-red-200 focus:border-red-400"
                    rows={3}
                  />
                  <button
                    onClick={handleReject}
                    disabled={actionLoading}
                    className="mt-2 px-6 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition disabled:opacity-50"
                  >
                    {actionLoading ? <Loader2 className="w-4 h-4 inline-block mr-1 animate-spin" /> : null}
                    Potwierdź odrzucenie
                  </button>
                </div>
              )}
              <p className="text-xs text-slate-400 mt-3">Klikając powyższy przycisk, akceptujesz warunki przedstawione w ofercie.</p>
            </div>
          )}

          {accepted && (
            <div className="p-8 border-t border-slate-100 text-center bg-green-50">
              <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
              <h3 className="text-xl font-bold text-green-800">Oferta zaakceptowana!</h3>
              <p className="text-green-600 mt-1">Dziękujemy za akceptację. Skontaktujemy się z Tobą wkrótce.</p>
            </div>
          )}

          {rejected && (
            <div className="p-8 border-t border-slate-100 text-center bg-red-50">
              <XCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
              <h3 className="text-xl font-bold text-red-800">Oferta odrzucona</h3>
              <p className="text-red-600 mt-1">Dziękujemy za informację. Skontaktujemy się, aby omówić alternatywne rozwiązania.</p>
            </div>
          )}
        </div>

        {/* Footer - marketing */}
        <div className="mt-8 mb-12 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/80 rounded-full shadow-sm border border-slate-100">
            <Shield className="w-4 h-4 text-blue-500" />
            <span className="text-sm text-slate-500">Oferta wygenerowana w</span>
            <span className="text-sm font-semibold text-blue-600">MaxMaster</span>
            <Star className="w-3 h-3 text-amber-400" />
          </div>
          <p className="text-xs text-slate-400 mt-3">
            Profesjonalne narzędzie do zarządzania firmą
          </p>
        </div>
      </div>
    </div>
  );
};

export default OfferLandingPage;
