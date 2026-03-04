import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import {
  FileText, CheckCircle, XCircle, Clock, Building2, Calendar,
  Download, Loader2, ExternalLink, Shield, Star, Phone, Mail,
  ChevronDown, ChevronRight, MapPin, MessageSquare
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
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  // SMS verification state
  const [showSmsModal, setShowSmsModal] = useState(false);
  const [smsStep, setSmsStep] = useState<'phone' | 'code' | 'verified'>('phone');
  const [smsPhone, setSmsPhone] = useState('');
  const [smsMaskedPhone, setSmsMaskedPhone] = useState('');
  const [smsCode, setSmsCode] = useState(['', '', '', '', '', '']);
  const [smsLoading, setSmsLoading] = useState(false);
  const [smsError, setSmsError] = useState('');
  const [smsRecipientName, setSmsRecipientName] = useState('');
  const smsInputRefs = [
    React.useRef<HTMLInputElement>(null),
    React.useRef<HTMLInputElement>(null),
    React.useRef<HTMLInputElement>(null),
    React.useRef<HTMLInputElement>(null),
    React.useRef<HTMLInputElement>(null),
    React.useRef<HTMLInputElement>(null),
  ];

  // Comments state
  const [showComments, setShowComments] = useState(false);
  const [offerComments, setOfferComments] = useState<any[]>([]);
  const [newComment, setNewComment] = useState('');
  const [commentReplyTo, setCommentReplyTo] = useState<string | null>(null);
  const [commentReplyText, setCommentReplyText] = useState('');
  const [commentAuthorName, setCommentAuthorName] = useState('');

  // Negotiation state
  const [negotiationMode, setNegotiationMode] = useState(false);
  const [negotiationItems, setNegotiationItems] = useState<Record<string, { quantity?: number; unit_price?: number }>>({});
  const [negotiationCosts, setNegotiationCosts] = useState<Record<string, { value?: number }>>({});
  const [negotiationMessage, setNegotiationMessage] = useState('');
  const [negotiationSubmitting, setNegotiationSubmitting] = useState(false);
  const [negotiationSubmitted, setNegotiationSubmitted] = useState(false);
  const [existingNegotiation, setExistingNegotiation] = useState<any>(null);

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

      const fullOffer = {
        ...offerData,
        client: clientRes.data as { name: string } | null,
        sections
      };
      setOffer(fullOffer);

      // Auto-fill comment author name from representative or client
      const repName = offerData.print_settings?.client_data?.representative_name || (clientRes.data as any)?.name || '';
      if (repName) setCommentAuthorName(repName);

      // Load comments
      const { data: commentsData } = await supabase
        .from('offer_comments')
        .select('*')
        .eq('offer_id', offerData.id)
        .order('created_at', { ascending: true });
      setOfferComments(commentsData || []);

      // Load existing negotiation if status is 'negotiation'
      if (offerData.status === 'negotiation') {
        const { data: negData } = await supabase
          .from('offer_negotiations')
          .select('*, items:offer_negotiation_items(*), costs:offer_negotiation_costs(*)')
          .eq('offer_id', offerData.id)
          .order('round', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (negData) {
          setExistingNegotiation(negData);
          // Pre-populate items with response statuses
          const itemMap: Record<string, any> = {};
          (negData.items || []).forEach((ni: any) => {
            itemMap[ni.offer_item_id] = {
              quantity: ni.proposed_quantity,
              unit_price: ni.proposed_unit_price,
              status: ni.status,
              counter_quantity: ni.counter_quantity,
              counter_unit_price: ni.counter_unit_price
            };
          });
          setNegotiationItems(itemMap);
        }
      }
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

  const handleSendSmsCode = async () => {
    if (!offer || !smsPhone.trim()) return;
    setSmsLoading(true);
    setSmsError('');
    try {
      const res = await fetch(`https://diytvuczpciikzdhldny.supabase.co/functions/v1/verify-offer-sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send-code',
          offer_id: offer.id,
          phone_number: smsPhone,
          recipient_name: smsRecipientName
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Błąd wysyłki');
      setSmsMaskedPhone(data.masked_phone || smsPhone);
      setSmsStep('code');
      setSmsCode(['', '', '', '', '', '']);
      setTimeout(() => smsInputRefs[0].current?.focus(), 100);
    } catch (err: any) {
      setSmsError(err.message || 'Nie udało się wysłać kodu');
    } finally {
      setSmsLoading(false);
    }
  };

  const handleVerifySmsCode = async () => {
    if (!offer) return;
    const codeStr = smsCode.join('');
    if (codeStr.length !== 6) return;
    setSmsLoading(true);
    setSmsError('');
    try {
      const res = await fetch(`https://diytvuczpciikzdhldny.supabase.co/functions/v1/verify-offer-sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'verify-code',
          offer_id: offer.id,
          code: codeStr
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Nieprawidłowy kod');
      setSmsStep('verified');
      setAccepted(true);
      setShowSmsModal(false);
    } catch (err: any) {
      setSmsError(err.message || 'Weryfikacja nieudana');
      setSmsCode(['', '', '', '', '', '']);
      setTimeout(() => smsInputRefs[0].current?.focus(), 100);
    } finally {
      setSmsLoading(false);
    }
  };

  const handleAcceptWithSmsCheck = () => {
    if (offer?.print_settings?.sms_acceptance) {
      // Pre-fill phone from representative data
      const cd = offer.print_settings?.client_data;
      setSmsPhone(cd?.representative_phone || offer.client?.phone || '');
      setSmsRecipientName(cd?.representative_name || '');
      setShowSmsModal(true);
      setSmsStep('phone');
      setSmsError('');
      setSmsCode(['', '', '', '', '', '']);
    } else {
      handleAccept();
    }
  };

  const handleStartNegotiation = () => {
    setNegotiationMode(true);
    // Pre-populate negotiation items with original values
    if (offer) {
      const items: Record<string, { quantity?: number; unit_price?: number }> = {};
      offer.sections.forEach(s => s.items.forEach(i => {
        items[i.id] = { quantity: i.quantity, unit_price: i.unit_price };
      }));
      setNegotiationItems(items);
    }
  };

  const handleSubmitNegotiation = async () => {
    if (!offer) return;
    setNegotiationSubmitting(true);
    try {
      // Update offer status to negotiation
      await supabase.from('offers').update({ status: 'negotiation' }).eq('id', offer.id);

      // Create negotiation record
      const { data: negRecord, error: negErr } = await supabase
        .from('offer_negotiations')
        .insert({
          offer_id: offer.id,
          round: 1,
          initiated_by: 'recipient',
          status: 'submitted',
          message: negotiationMessage || null
        })
        .select()
        .single();

      if (negErr || !negRecord) throw negErr;

      // Save negotiation items (only those that changed)
      const changedItems = Object.entries(negotiationItems)
        .filter(([itemId, vals]) => {
          const original = offer.sections.flatMap(s => s.items).find(i => i.id === itemId);
          return original && (vals.quantity !== original.quantity || vals.unit_price !== original.unit_price);
        })
        .map(([itemId, vals]) => {
          const original = offer.sections.flatMap(s => s.items).find(i => i.id === itemId);
          return {
            negotiation_id: negRecord.id,
            offer_item_id: itemId,
            proposed_quantity: vals.quantity,
            proposed_unit_price: vals.unit_price,
            original_quantity: original!.quantity,
            original_unit_price: original!.unit_price,
            status: 'pending'
          };
        });

      if (changedItems.length > 0) {
        await supabase.from('offer_negotiation_items').insert(changedItems);
      }

      // Save negotiation costs (only changed ones)
      const changedCosts = Object.entries(negotiationCosts)
        .filter(([_, vals]) => vals.value !== undefined)
        .map(([costId, vals]) => ({
          negotiation_id: negRecord.id,
          cost_id: costId,
          proposed_value: vals.value,
          original_value: (offer.print_settings?.related_costs || []).find((c: any) => c.id === costId)?.value || 0,
          status: 'pending'
        }));

      if (changedCosts.length > 0) {
        await supabase.from('offer_negotiation_costs').insert(changedCosts);
      }

      setNegotiationSubmitted(true);
      setNegotiationMode(false);
      setExistingNegotiation(negRecord);
    } catch (err) {
      console.error('Error submitting negotiation:', err);
      setActionError('Nie udało się wysłać propozycji negocjacyjnej.');
    } finally {
      setNegotiationSubmitting(false);
    }
  };

  const handleAddRecipientComment = async (parentId: string | null, text: string) => {
    if (!offer || !text.trim()) return;
    const name = commentAuthorName.trim() || 'Odbiorca';
    await supabase.from('offer_comments').insert({
      offer_id: offer.id,
      offer_item_id: null,
      parent_id: parentId || null,
      author_type: 'recipient',
      author_name: name,
      content: text.trim()
    });
    if (parentId) {
      await supabase.from('offer_comments').update({ is_answered: true }).eq('id', parentId);
    }
    const { data } = await supabase
      .from('offer_comments')
      .select('*')
      .eq('offer_id', offer.id)
      .order('created_at', { ascending: true });
    setOfferComments(data || []);
    setNewComment('');
    setCommentReplyText('');
    setCommentReplyTo(null);
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
                offer.status === 'negotiation' || negotiationSubmitted ? 'bg-amber-500/20 text-amber-100' :
                isExpired ? 'bg-red-500/20 text-red-200' :
                'bg-white/20 text-white'
              }`}>
                {accepted || offer.status === 'accepted' ? (
                  <><CheckCircle className="w-4 h-4" /> Zaakceptowana</>
                ) : rejected || offer.status === 'rejected' ? (
                  <><XCircle className="w-4 h-4" /> Odrzucona</>
                ) : offer.status === 'negotiation' || negotiationSubmitted ? (
                  <><Clock className="w-4 h-4" /> W negocjacji</>
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
                    <MapPin className="w-4 h-4" />
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
                <div>
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Zamawiający</h4>
                  {(() => {
                    const cd = offer.print_settings?.client_data || {};
                    const clientName = offer.client?.name || cd.client_name || '';
                    const clientNip = offer.client?.nip || cd.nip || '';
                    const clientAddr = offer.client?.legal_address || [cd.company_street, cd.company_street_number, cd.company_postal_code, cd.company_city].filter(Boolean).join(', ');
                    const repName = cd.representative_name || '';
                    const repPosition = cd.representative_position || '';
                    const repEmail = cd.representative_email || offer.client?.email || '';
                    const repPhone = cd.representative_phone || offer.client?.phone || '';
                    return clientName ? (
                      <div className="text-sm text-slate-700 space-y-0.5">
                        <p className="font-semibold text-slate-900">{clientName}</p>
                        {clientNip && <p>NIP: {clientNip}</p>}
                        {clientAddr && <p>{clientAddr}</p>}
                        {repName && (
                          <div className="mt-2 pt-2 border-t border-slate-100">
                            <p className="text-xs text-slate-400 uppercase tracking-wider mb-0.5">Przedstawiciel</p>
                            <p className="font-medium text-slate-800">{repName}</p>
                            {repPosition && <p className="text-xs text-slate-500">{repPosition}</p>}
                            {repEmail && <p className="text-xs text-slate-500">{repEmail}</p>}
                            {repPhone && <p className="text-xs text-slate-500">tel. {repPhone}</p>}
                          </div>
                        )}
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
          <div className="p-4 sm:p-8">
            {offer.sections.length > 1 && (
              <div className="flex justify-end mb-4">
                <button
                  onClick={() => {
                    if (collapsedSections.size === 0) {
                      setCollapsedSections(new Set(offer.sections.map(s => s.id)));
                    } else {
                      setCollapsedSections(new Set());
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"
                >
                  {collapsedSections.size === 0 ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  {collapsedSections.size === 0 ? 'Zwiń wszystkie' : 'Rozwiń wszystkie'}
                </button>
              </div>
            )}
            {offer.sections.map(section => {
              const sectionTotal = section.items.reduce((s, i) => {
                const val = i.quantity * i.unit_price;
                return s + val - val * ((i.discount_percent || 0) / 100);
              }, 0);
              const isCollapsed = collapsedSections.has(section.id);
              const toggleSection = () => {
                setCollapsedSections(prev => {
                  const next = new Set(prev);
                  if (next.has(section.id)) next.delete(section.id);
                  else next.add(section.id);
                  return next;
                });
              };
              return (
              <div key={section.id} className="mb-8 last:mb-0">
                <button
                  onClick={toggleSection}
                  className="w-full flex items-center justify-between text-lg font-semibold text-slate-900 mb-4 pb-2 border-b-2 border-blue-100 hover:text-blue-700 transition cursor-pointer text-left"
                >
                  <span className="flex items-center gap-2">
                    {isCollapsed ? <ChevronRight className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
                    {section.name}
                  </span>
                  <span className="text-sm font-medium text-slate-500">{formatCurrency(sectionTotal)}</span>
                </button>
                {!isCollapsed && (
                <div className="overflow-x-auto -mx-2 px-2">
                <table className="w-full min-w-[600px]">
                  <thead>
                    <tr className="text-left text-sm text-slate-500">
                      <th className="pb-3 pr-4 w-10">Lp.</th>
                      <th className="pb-3 pr-4">Nazwa</th>
                      <th className="pb-3 pr-4 text-center w-16">Jedn.</th>
                      <th className="pb-3 pr-4 text-right w-20">Ilość</th>
                      <th className="pb-3 pr-4 text-right w-28">Cena jedn.</th>
                      <th className="pb-3 text-right w-28">Wartość</th>
                      {negotiationMode && (
                        <>
                          <th className="pb-3 pr-4 text-right w-24 text-amber-600">Ilość (neg.)</th>
                          <th className="pb-3 pr-4 text-right w-28 text-amber-600">Cena (neg.)</th>
                          <th className="pb-3 text-right w-28 text-amber-600">Wartość (neg.)</th>
                        </>
                      )}
                      {existingNegotiation && !negotiationMode && existingNegotiation.items?.some((ni: any) => ni.offer_item_id) && (
                        <>
                          <th className="pb-3 pr-4 text-right w-28 text-amber-600">Propozycja</th>
                          <th className="pb-3 text-center w-20 text-amber-600">Status</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {section.items.map((item, idx) => {
                      const itemTotal = item.quantity * item.unit_price;
                      const itemDiscount = itemTotal * ((item.discount_percent || 0) / 100);
                      const hasRMS = offer.print_settings?.show_components_in_print && item.components && item.components.length > 0;
                      const isItemExpanded = expandedItems.has(item.id);
                      const toggleItem = () => {
                        setExpandedItems(prev => {
                          const next = new Set(prev);
                          if (next.has(item.id)) next.delete(item.id);
                          else next.add(item.id);
                          return next;
                        });
                      };
                      return (
                        <React.Fragment key={item.id}>
                        <tr className={`border-t border-slate-50 hover:bg-slate-50/50 ${hasRMS ? 'cursor-pointer' : ''}`} onClick={hasRMS ? toggleItem : undefined}>
                          <td className="py-3 pr-4 text-sm text-slate-400">{idx + 1}</td>
                          <td className="py-3 pr-4">
                            <div className="flex items-center gap-1">
                              {hasRMS && (
                                isItemExpanded
                                  ? <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                  : <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              )}
                              <div>
                                <p className="text-sm font-medium text-slate-900">{item.name}</p>
                                {item.description && <p className="text-xs text-slate-500 mt-0.5">{item.description}</p>}
                                {item.is_optional && <span className="text-[10px] bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded ml-1">opcja</span>}
                                {(item.discount_percent || 0) > 0 && (
                                  <span className="text-xs text-red-500 ml-1">-{item.discount_percent}%</span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="py-3 pr-4 text-sm text-center text-slate-500">{item.unit || 'szt.'}</td>
                          <td className="py-3 pr-4 text-sm text-right text-slate-600">{item.quantity}</td>
                          <td className="py-3 pr-4 text-sm text-right text-slate-600">{formatCurrency(item.unit_price)}</td>
                          <td className="py-3 text-sm text-right font-medium text-slate-900">
                            {formatCurrency(itemTotal - itemDiscount)}
                          </td>
                          {negotiationMode && (() => {
                            const neg = negotiationItems[item.id] || { quantity: item.quantity, unit_price: item.unit_price };
                            const negTotal = (neg.quantity || 0) * (neg.unit_price || 0);
                            const changed = neg.quantity !== item.quantity || neg.unit_price !== item.unit_price;
                            return (
                              <>
                                <td className="py-3 pr-4">
                                  <input
                                    type="number"
                                    value={neg.quantity ?? item.quantity}
                                    onChange={e => setNegotiationItems(prev => ({
                                      ...prev,
                                      [item.id]: { ...prev[item.id], quantity: parseFloat(e.target.value) || 0, unit_price: prev[item.id]?.unit_price ?? item.unit_price }
                                    }))}
                                    className={`w-20 px-2 py-1 border rounded text-sm text-right ${changed ? 'border-amber-400 bg-amber-50' : 'border-slate-200'}`}
                                    step="0.01"
                                  />
                                </td>
                                <td className="py-3 pr-4">
                                  <input
                                    type="number"
                                    value={neg.unit_price ?? item.unit_price}
                                    onChange={e => setNegotiationItems(prev => ({
                                      ...prev,
                                      [item.id]: { ...prev[item.id], unit_price: parseFloat(e.target.value) || 0, quantity: prev[item.id]?.quantity ?? item.quantity }
                                    }))}
                                    className={`w-24 px-2 py-1 border rounded text-sm text-right ${changed ? 'border-amber-400 bg-amber-50' : 'border-slate-200'}`}
                                    step="0.01"
                                  />
                                </td>
                                <td className={`py-3 text-sm text-right font-medium ${changed ? 'text-amber-700' : 'text-slate-900'}`}>
                                  {formatCurrency(negTotal)}
                                </td>
                              </>
                            );
                          })()}
                          {existingNegotiation && !negotiationMode && (() => {
                            const ni = (existingNegotiation.items || []).find((n: any) => n.offer_item_id === item.id);
                            if (!ni) return <><td></td><td></td></>;
                            const negTotal = (ni.proposed_quantity || 0) * (ni.proposed_unit_price || 0);
                            return (
                              <>
                                <td className="py-3 pr-4 text-sm text-right text-amber-700 font-medium">{formatCurrency(negTotal)}</td>
                                <td className="py-3 text-center">
                                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                                    ni.status === 'accepted' ? 'bg-green-100 text-green-700' :
                                    ni.status === 'rejected' ? 'bg-red-100 text-red-700' :
                                    ni.status === 'counter' ? 'bg-blue-100 text-blue-700' :
                                    'bg-amber-100 text-amber-700'
                                  }`}>
                                    {ni.status === 'accepted' ? '✓' : ni.status === 'rejected' ? '✗' : ni.status === 'counter' ? '✎' : '⏳'}
                                  </span>
                                </td>
                              </>
                            );
                          })()}
                        </tr>
                        {hasRMS && isItemExpanded && item.components!.map((comp, ci) => (
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
                )}
              </div>
              );
            })}
          </div>

          {/* Warunki istotne */}
          {(() => {
            const warunki = offer.print_settings?.warunki;
            if (!warunki) return null;
            const { payment_term, invoice_frequency, warranty_period, payment_term_rules, warranty_rules, invoice_freq_rules, custom_warunki } = warunki;
            const showPT = payment_term && warunki.payment_term_show_on_offer !== false;
            const showIF = invoice_frequency && warunki.invoice_freq_show_on_offer !== false;
            const showWR = warranty_period && warunki.warranty_show_on_offer !== false;
            const visibleCustom = (custom_warunki || []).filter((cw: any) => cw.show_on_offer !== false && cw.name && cw.value);
            if (!showPT && !showIF && !showWR && visibleCustom.length === 0) return null;
            return (
              <div className="px-8 py-6 border-t border-slate-100">
                <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Warunki istotne</h3>
                <div className="grid grid-cols-3 gap-4">
                  {showPT && (
                    <div>
                      <p className="text-xs text-slate-500 mb-1">Termin płatności</p>
                      <p className="text-sm font-medium text-slate-900">{payment_term} dni
                        {(() => { const r = (payment_term_rules || []).find((r: any) => String(r.value) === String(payment_term)); const applied = warunki.payment_term_apply !== false; return r && r.surcharge !== 0 ? <span className={`ml-1 text-xs ${applied ? (r.surcharge > 0 ? 'text-red-500' : 'text-green-600') : 'text-slate-400'}`}>({r.surcharge > 0 ? '+' : ''}{r.surcharge}%{!applied ? ' - nie uwzgl.' : ''})</span> : null; })()}
                      </p>
                    </div>
                  )}
                  {showIF && (
                    <div>
                      <p className="text-xs text-slate-500 mb-1">Wystawienie faktur</p>
                      <p className="text-sm font-medium text-slate-900">co {invoice_frequency} dni
                        {(() => { const r = (invoice_freq_rules || []).find((r: any) => String(r.value) === String(invoice_frequency)); const applied = warunki.invoice_freq_apply !== false; return r && r.surcharge !== 0 ? <span className={`ml-1 text-xs ${applied ? (r.surcharge > 0 ? 'text-red-500' : 'text-green-600') : 'text-slate-400'}`}>({r.surcharge > 0 ? '+' : ''}{r.surcharge}%{!applied ? ' - nie uwzgl.' : ''})</span> : null; })()}
                      </p>
                    </div>
                  )}
                  {showWR && (
                    <div>
                      <p className="text-xs text-slate-500 mb-1">Okres gwarancyjny</p>
                      <p className="text-sm font-medium text-slate-900">{warranty_period} miesięcy
                        {(() => { const r = (warranty_rules || []).find((r: any) => String(r.value) === String(warranty_period)); const applied = warunki.warranty_apply !== false; return r && r.surcharge !== 0 ? <span className={`ml-1 text-xs ${applied ? (r.surcharge > 0 ? 'text-red-500' : 'text-green-600') : 'text-slate-400'}`}>({r.surcharge > 0 ? '+' : ''}{r.surcharge}%{!applied ? ' - nie uwzgl.' : ''})</span> : null; })()}
                      </p>
                    </div>
                  )}
                  {visibleCustom.map((cw: any) => (
                    <div key={cw.id}>
                      <p className="text-xs text-slate-500 mb-1">{cw.name}</p>
                      <p className="text-sm font-medium text-slate-900">{cw.value}
                        {cw.surcharge !== 0 && cw.apply ? <span className={`ml-1 text-xs ${cw.surcharge > 0 ? 'text-red-500' : 'text-green-600'}`}>({cw.surcharge > 0 ? '+' : ''}{cw.surcharge}%)</span> : null}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Koszty powiązane */}
          {(() => {
            const costs: any[] = offer.print_settings?.related_costs || [];
            const visibleCosts = costs.filter((c: any) => c.value > 0);
            if (visibleCosts.length === 0) return null;
            const calcMonths = (c: any) => {
              if (c.frequency !== 'monthly') return 1;
              const from = c.date_from || offer.work_start_date;
              const to = c.date_to || offer.work_end_date;
              if (!from || !to) return 1;
              const d1 = new Date(from);
              const d2 = new Date(to);
              const m = (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth()) + (d2.getDate() > d1.getDate() ? 1 : 0);
              return Math.max(1, Math.ceil(m));
            };
            const costVal = (c: any) => c.mode === 'percent' ? nettoAfterDiscount * (c.value / 100) : c.value * calcMonths(c);
            const shownCosts = visibleCosts.filter((c: any) => c.show_on_offer);
            const hiddenCosts = visibleCosts.filter((c: any) => !c.show_on_offer);
            const hiddenTotal = hiddenCosts.reduce((s: number, c: any) => s + costVal(c), 0);
            const allTotal = visibleCosts.reduce((s: number, c: any) => s + costVal(c), 0);
            return (
              <div className="px-8 py-6 border-t border-slate-100">
                <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Koszty powiązane</h3>
                <div className="space-y-1.5">
                  {shownCosts.map((c: any) => {
                    const months = calcMonths(c);
                    const val = costVal(c);
                    return (
                      <div key={c.id} className="flex justify-between text-sm">
                        <span className="text-slate-600">
                          {c.name}
                          {c.mode === 'percent' ? ` (${c.value}%)` : ''}
                          {c.frequency === 'monthly' ? ` (${c.value} zł × ${months} mies.)` : ''}
                        </span>
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

          {/* Negotiation mode: summary + submit */}
          {negotiationMode && (
            <div className="p-8 border-t border-amber-200 bg-amber-50/50">
              <h3 className="font-semibold text-amber-800 mb-3">Twoja propozycja negocjacyjna</h3>
              {(() => {
                const changedCount = Object.entries(negotiationItems).filter(([itemId, vals]) => {
                  const original = offer.sections.flatMap(s => s.items).find(i => i.id === itemId);
                  return original && (vals.quantity !== original.quantity || vals.unit_price !== original.unit_price);
                }).length;
                const negTotal = Object.entries(negotiationItems).reduce((sum, [itemId, vals]) => {
                  return sum + (vals.quantity || 0) * (vals.unit_price || 0);
                }, 0);
                return (
                  <div className="space-y-3">
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-slate-600">Zmienione pozycje: <span className="font-bold text-amber-700">{changedCount}</span></span>
                      <span className="text-slate-600">Nowa suma netto: <span className="font-bold text-amber-700">{formatCurrency(negTotal)}</span></span>
                      <span className="text-slate-600">Różnica: <span className={`font-bold ${negTotal < totalNetto ? 'text-red-600' : 'text-green-600'}`}>{formatCurrency(negTotal - totalNetto)}</span></span>
                    </div>
                    <textarea
                      value={negotiationMessage}
                      onChange={e => setNegotiationMessage(e.target.value)}
                      placeholder="Dodaj wiadomość do propozycji (opcjonalnie)..."
                      className="w-full px-4 py-3 border border-amber-300 rounded-lg text-sm resize-none focus:ring-2 focus:ring-amber-200"
                      rows={3}
                    />
                    <div className="flex items-center gap-3">
                      <button
                        onClick={handleSubmitNegotiation}
                        disabled={negotiationSubmitting || changedCount === 0}
                        className="px-6 py-2.5 bg-amber-600 text-white rounded-lg font-semibold hover:bg-amber-700 transition disabled:opacity-50"
                      >
                        {negotiationSubmitting ? <Loader2 className="w-4 h-4 inline-block mr-1 animate-spin" /> : null}
                        Wyślij propozycję
                      </button>
                      <button
                        onClick={() => setNegotiationMode(false)}
                        className="px-4 py-2.5 border border-slate-300 text-slate-600 rounded-lg hover:bg-slate-50 transition"
                      >
                        Anuluj
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Action buttons */}
          {!accepted && !rejected && !negotiationMode && !negotiationSubmitted && offer.status !== 'accepted' && offer.status !== 'rejected' && offer.status !== 'negotiation' && !isExpired && (
            <div className="p-8 border-t border-slate-100 text-center">
              {actionError && (
                <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg">{actionError}</div>
              )}
              <div className="flex items-center justify-center gap-4">
                <button
                  onClick={handleAcceptWithSmsCheck}
                  disabled={actionLoading}
                  className="px-8 py-3 bg-green-600 text-white rounded-xl text-lg font-semibold hover:bg-green-700 transition shadow-lg shadow-green-200 disabled:opacity-50"
                >
                  {actionLoading ? <Loader2 className="w-5 h-5 inline-block mr-2 -mt-0.5 animate-spin" /> : <CheckCircle className="w-5 h-5 inline-block mr-2 -mt-0.5" />}
                  Akceptuję ofertę
                </button>
                {offer.print_settings?.negotiation_enabled && (
                  <button
                    onClick={handleStartNegotiation}
                    className="px-6 py-3 bg-amber-500 text-white rounded-xl font-semibold hover:bg-amber-600 transition shadow-lg shadow-amber-200"
                  >
                    Negocjuj
                  </button>
                )}
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

          {/* Negotiation submitted confirmation */}
          {(negotiationSubmitted || offer.status === 'negotiation') && !accepted && !rejected && (
            <div className="p-8 border-t border-slate-100 text-center bg-amber-50">
              <Clock className="w-12 h-12 text-amber-500 mx-auto mb-3" />
              <h3 className="text-xl font-bold text-amber-800">Propozycja negocjacyjna wysłana</h3>
              <p className="text-amber-600 mt-1">Oczekuj na odpowiedź. Otrzymasz powiadomienie, gdy wykonawca odpowie na Twoją propozycję.</p>
              {existingNegotiation?.items?.some((ni: any) => ni.status !== 'pending') && (
                <p className="text-sm text-amber-700 mt-2 font-medium">Część pozycji otrzymała już odpowiedź — sprawdź status powyżej.</p>
              )}
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

        {/* Comments section */}
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden mt-6">
          <button
            onClick={() => setShowComments(!showComments)}
            className="w-full p-4 flex items-center justify-between hover:bg-slate-50 transition"
          >
            <span className="flex items-center gap-2 font-semibold text-slate-900">
              <MessageSquare className="w-5 h-5 text-blue-600" />
              Komentarze
              {offerComments.length > 0 && <span className="text-xs text-slate-400">({offerComments.length})</span>}
            </span>
            {showComments ? <ChevronDown className="w-5 h-5 text-slate-400" /> : <ChevronRight className="w-5 h-5 text-slate-400" />}
          </button>
          {showComments && (
            <div className="p-6 pt-0 space-y-4">
              {/* Author name */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Komentujesz jako:</span>
                {commentAuthorName ? (
                  <span className="text-sm font-medium text-slate-700">{commentAuthorName}</span>
                ) : (
                  <input
                    type="text"
                    value={commentAuthorName}
                    onChange={e => setCommentAuthorName(e.target.value)}
                    placeholder="Imię / Firma"
                    className="flex-1 px-2 py-1 border border-slate-200 rounded text-sm"
                  />
                )}
              </div>
              {/* Comment list */}
              <div className="space-y-3">
                {offerComments.filter(c => !c.parent_id).map(comment => {
                  const replies = offerComments.filter(c => c.parent_id === comment.id);
                  return (
                    <div key={comment.id} className="rounded-lg border border-slate-200 overflow-hidden">
                      <div className="p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-xs font-medium ${comment.author_type === 'owner' ? 'text-blue-700' : 'text-amber-700'}`}>
                            {comment.author_type === 'owner' ? (offer?.company?.name || comment.author_name || 'Wykonawca') : (comment.author_name || 'Ja')}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {new Date(comment.created_at).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <p className="text-sm text-slate-700">{comment.content}</p>
                        <button
                          onClick={() => { setCommentReplyTo(commentReplyTo === comment.id ? null : comment.id); setCommentReplyText(''); }}
                          className="text-xs text-blue-600 mt-1 hover:underline"
                        >
                          Odpowiedz
                        </button>
                      </div>
                      {replies.map(r => (
                        <div key={r.id} className="ml-4 p-2 border-t border-slate-100">
                          <div className="flex items-center justify-between mb-0.5">
                            <span className={`text-xs font-medium ${r.author_type === 'owner' ? 'text-blue-700' : 'text-amber-700'}`}>
                              {r.author_type === 'owner' ? (offer?.company?.name || r.author_name || 'Wykonawca') : (r.author_name || 'Ja')}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              {new Date(r.created_at).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600">{r.content}</p>
                        </div>
                      ))}
                      {commentReplyTo === comment.id && (
                        <div className="p-2 border-t border-slate-100">
                          <textarea
                            value={commentReplyText}
                            onChange={e => setCommentReplyText(e.target.value)}
                            placeholder="Twoja odpowiedź..."
                            className="w-full px-2 py-1.5 border border-slate-200 rounded text-xs resize-none"
                            rows={2}
                          />
                          <div className="flex justify-end gap-1 mt-1">
                            <button onClick={() => setCommentReplyTo(null)} className="px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 rounded">Anuluj</button>
                            <button
                              onClick={() => handleAddRecipientComment(comment.id, commentReplyText)}
                              className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                              disabled={!commentReplyText.trim()}
                            >
                              Wyślij
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {/* New comment */}
              <div>
                <textarea
                  value={newComment}
                  onChange={e => setNewComment(e.target.value)}
                  placeholder="Napisz komentarz..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm resize-none"
                  rows={2}
                />
                <button
                  onClick={() => handleAddRecipientComment(null, newComment)}
                  className="mt-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
                  disabled={!newComment.trim()}
                >
                  Dodaj komentarz
                </button>
              </div>
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

      {/* SMS Verification Modal */}
      {showSmsModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Phone className="w-8 h-8 text-green-600" />
              </div>
              <h3 className="text-xl font-bold text-slate-900">Weryfikacja SMS</h3>
              <p className="text-sm text-slate-500 mt-1">
                {smsStep === 'phone'
                  ? 'Podaj numer telefonu, na który wyślemy kod weryfikacyjny'
                  : `Wpisz 6-cyfrowy kod wysłany na numer ${smsMaskedPhone}`}
              </p>
            </div>

            {smsError && (
              <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg text-center">{smsError}</div>
            )}

            {smsStep === 'phone' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Imię i nazwisko</label>
                  <input
                    type="text"
                    value={smsRecipientName}
                    onChange={e => setSmsRecipientName(e.target.value)}
                    className="w-full px-4 py-3 border border-slate-200 rounded-lg text-sm"
                    placeholder="Jan Kowalski"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Numer telefonu</label>
                  <input
                    type="tel"
                    value={smsPhone}
                    onChange={e => setSmsPhone(e.target.value)}
                    className="w-full px-4 py-3 border border-slate-200 rounded-lg text-sm text-center text-lg tracking-wider"
                    placeholder="+48 123 456 789"
                  />
                </div>
                <button
                  onClick={handleSendSmsCode}
                  disabled={smsLoading || !smsPhone.trim()}
                  className="w-full py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 transition disabled:opacity-50"
                >
                  {smsLoading ? <Loader2 className="w-5 h-5 inline-block mr-2 animate-spin" /> : null}
                  Wyślij kod SMS
                </button>
              </div>
            )}

            {smsStep === 'code' && (
              <div className="space-y-4">
                <div className="flex justify-center gap-2">
                  {smsCode.map((digit, idx) => (
                    <input
                      key={idx}
                      ref={smsInputRefs[idx]}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={e => {
                        const val = e.target.value.replace(/\D/g, '');
                        const newCode = [...smsCode];
                        newCode[idx] = val;
                        setSmsCode(newCode);
                        if (val && idx < 5) {
                          smsInputRefs[idx + 1].current?.focus();
                        }
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Backspace' && !smsCode[idx] && idx > 0) {
                          smsInputRefs[idx - 1].current?.focus();
                        }
                      }}
                      className="w-12 h-14 text-center text-2xl font-bold border-2 border-slate-200 rounded-lg focus:border-green-500 focus:ring-2 focus:ring-green-200"
                    />
                  ))}
                </div>
                <button
                  onClick={handleVerifySmsCode}
                  disabled={smsLoading || smsCode.join('').length !== 6}
                  className="w-full py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 transition disabled:opacity-50"
                >
                  {smsLoading ? <Loader2 className="w-5 h-5 inline-block mr-2 animate-spin" /> : null}
                  Weryfikuj i akceptuj ofertę
                </button>
                <button
                  onClick={() => { setSmsStep('phone'); setSmsError(''); }}
                  className="w-full py-2 text-sm text-slate-500 hover:text-slate-700"
                >
                  Wyślij kod ponownie
                </button>
              </div>
            )}

            <button
              onClick={() => setShowSmsModal(false)}
              className="mt-4 w-full py-2 text-sm text-slate-400 hover:text-slate-600"
            >
              Anuluj
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default OfferLandingPage;
