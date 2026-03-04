import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import {
  FileText, Building2, Loader2, Shield, Package, Hammer, Wrench,
  Briefcase, CheckCircle, Send, AlertCircle
} from 'lucide-react';

interface RequestItem {
  id: string;
  name: string;
  unit: string;
  quantity: number;
  section_name: string;
}

export const OfferRequestLandingPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [request, setRequest] = useState<any>(null);
  const [error, setError] = useState('');
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!token) return;
    loadRequest();
  }, [token]);

  const loadRequest = async () => {
    try {
      const { data, error: err } = await supabase
        .from('offer_requests')
        .select('*')
        .eq('share_token', token)
        .single();

      if (err || !data) {
        setError('Nie znaleziono zapytania ofertowego lub link jest nieprawidłowy.');
        return;
      }

      setRequest(data);

      // Mark as viewed
      if (data.status === 'sent') {
        await supabase
          .from('offer_requests')
          .update({ status: 'viewed', viewed_at: new Date().toISOString() })
          .eq('id', data.id);
        setRequest((prev: any) => prev ? { ...prev, status: 'viewed' } : null);
      }

      if (data.response_data?.prices) {
        setPrices(data.response_data.prices);
      }
      if (data.response_data?.notes) {
        setNotes(data.response_data.notes);
      }
      if (data.status === 'responded' || data.status === 'accepted' || data.status === 'rejected') {
        setSubmitted(true);
      }
    } catch (e) {
      setError('Wystąpił błąd podczas ładowania zapytania.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!request) return;
    setSubmitting(true);
    try {
      const { error: err } = await supabase
        .from('offer_requests')
        .update({
          status: 'responded',
          responded_at: new Date().toISOString(),
          response_data: { prices, notes }
        })
        .eq('id', request.id);

      if (err) throw err;
      setSubmitted(true);
      setRequest((prev: any) => prev ? { ...prev, status: 'responded' } : null);
    } catch (e) {
      alert('Błąd podczas wysyłania odpowiedzi. Spróbuj ponownie.');
    } finally {
      setSubmitting(false);
    }
  };

  const items: RequestItem[] = request?.print_settings?.items || [];
  const companyName = request?.print_settings?.company_data?.name || '';
  const offerName = request?.print_settings?.offer_name || '';

  const typeLabels: Record<string, { label: string; icon: React.ElementType; color: string }> = {
    robota: { label: 'Robota', icon: Hammer, color: 'text-blue-600' },
    materialy: { label: 'Materiały', icon: Package, color: 'text-amber-600' },
    sprzet: { label: 'Sprzęt', icon: Wrench, color: 'text-green-600' },
    all: { label: 'Cały zakres', icon: Briefcase, color: 'text-indigo-600' },
  };
  const typeInfo = typeLabels[request?.request_type] || typeLabels.all;
  const TypeIcon = typeInfo.icon;

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin text-indigo-500 mx-auto mb-3" />
          <p className="text-slate-500">Ładowanie zapytania ofertowego…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-slate-900 mb-2">Błąd</h1>
          <p className="text-slate-500">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <div className="flex items-center gap-3 mb-2">
            <Shield className="w-5 h-5 text-indigo-500" />
            <span className="text-sm text-slate-500">Zapytanie ofertowe</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-1">{request?.name || 'Zapytanie ofertowe'}</h1>
          <div className="flex items-center gap-4 text-sm text-slate-500">
            {companyName && (
              <span className="flex items-center gap-1.5">
                <Building2 className="w-4 h-4" />
                {companyName}
              </span>
            )}
            {offerName && (
              <span className="flex items-center gap-1.5">
                <FileText className="w-4 h-4" />
                {offerName}
              </span>
            )}
            <span className={`flex items-center gap-1.5 ${typeInfo.color}`}>
              <TypeIcon className="w-4 h-4" />
              {typeInfo.label}
            </span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-8">
        {submitted ? (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center">
            <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-slate-900 mb-2">Odpowiedź wysłana</h2>
            <p className="text-slate-500">Dziękujemy za przesłanie wyceny. Wykonawca otrzymał Twoją odpowiedź.</p>
          </div>
        ) : (
          <>
            {/* Items table */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-6">
              <div className="p-4 border-b border-slate-200">
                <h2 className="text-lg font-semibold text-slate-900">Pozycje do wyceny</h2>
                <p className="text-sm text-slate-500 mt-1">Wpisz cenę jednostkową netto dla każdej pozycji.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="text-left p-3 text-slate-600 font-medium">Lp.</th>
                      <th className="text-left p-3 text-slate-600 font-medium">Sekcja</th>
                      <th className="text-left p-3 text-slate-600 font-medium">Nazwa</th>
                      <th className="text-left p-3 text-slate-600 font-medium">Jedn.</th>
                      <th className="text-right p-3 text-slate-600 font-medium">Ilość</th>
                      <th className="text-right p-3 text-slate-600 font-medium w-40">Cena jedn. netto (zł)</th>
                      <th className="text-right p-3 text-slate-600 font-medium">Wartość netto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, i) => {
                      const price = parseFloat(prices[item.id] || '0') || 0;
                      const value = price * (item.quantity || 0);
                      return (
                        <tr key={item.id || i} className="border-t border-slate-100">
                          <td className="p-3 text-slate-500">{i + 1}</td>
                          <td className="p-3 text-slate-500">{item.section_name || '-'}</td>
                          <td className="p-3 font-medium text-slate-900">{item.name}</td>
                          <td className="p-3 text-slate-500">{item.unit || 'szt.'}</td>
                          <td className="p-3 text-right text-slate-700">{item.quantity}</td>
                          <td className="p-3 text-right">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={prices[item.id] || ''}
                              onChange={e => setPrices(prev => ({ ...prev, [item.id]: e.target.value }))}
                              className="w-full px-2 py-1.5 border border-slate-200 rounded text-right text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                              placeholder="0.00"
                            />
                          </td>
                          <td className="p-3 text-right font-medium text-slate-900">
                            {value > 0 ? value.toFixed(2) : '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-slate-50">
                    <tr className="border-t-2 border-slate-200">
                      <td colSpan={6} className="p-3 text-right font-semibold text-slate-700">Razem netto:</td>
                      <td className="p-3 text-right font-bold text-indigo-700">
                        {items.reduce((sum, item) => {
                          const price = parseFloat(prices[item.id] || '0') || 0;
                          return sum + price * (item.quantity || 0);
                        }, 0).toFixed(2)} zł
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Notes */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-6">
              <label className="text-sm font-medium text-slate-700 mb-2 block">Uwagi (opcjonalnie)</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="Dodatkowe informacje, warunki, terminy realizacji…"
              />
            </div>

            {/* Submit */}
            <div className="flex justify-end">
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium disabled:opacity-50 transition"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Wyślij wycenę
              </button>
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-slate-200 mt-12">
        <div className="max-w-4xl mx-auto px-4 py-6 text-center text-xs text-slate-400">
          Zapytanie ofertowe wygenerowane przez MaxMaster
        </div>
      </div>
    </div>
  );
};
