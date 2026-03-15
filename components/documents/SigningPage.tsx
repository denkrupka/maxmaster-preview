import React, { useState, useEffect } from 'react';
import { X, Check, Loader2, AlertCircle, FileText, User, Calendar, Shield } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface SigningPageProps {
  token: string;
}

interface SignatureRequest {
  id: string;
  document_id: string;
  recipient_email: string;
  recipient_name: string;
  status: string;
  expires_at: string;
  documents: {
    name: string;
    number?: string;
    data: any;
  };
}

export const SigningPage: React.FC<SigningPageProps> = ({ token }) => {
  const [request, setRequest] = useState<SignatureRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [signing, setSigning] = useState(false);
  const [signed, setSigned] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [showDeclineForm, setShowDeclineForm] = useState(false);

  useEffect(() => {
    loadRequest();
  }, [token]);

  const loadRequest = async () => {
    try {
      const { data, error } = await supabase
        .from('signature_requests')
        .select('*, documents(*)')
        .eq('token', token)
        .single();

      if (error) throw error;

      if (!data) {
        setError('Nieprawidłowy lub wygasły link do podpisu');
        return;
      }

      if (data.status !== 'pending' && data.status !== 'viewed') {
        setError(
          data.status === 'signed'
            ? 'Ten dokument został już podpisany'
            : data.status === 'declined'
            ? 'Ten dokument został odrzucony'
            : 'Link do podpisu wygasł'
        );
        return;
      }

      if (new Date(data.expires_at) < new Date()) {
        setError('Link do podpisu wygasł');
        return;
      }

      setRequest(data);

      // Update status to viewed if pending
      if (data.status === 'pending') {
        await supabase
          .from('signature_requests')
          .update({ status: 'viewed', viewed_at: new Date().toISOString() })
          .eq('id', data.id);
      }
    } catch (err: any) {
      setError('Nie udało się załadować dokumentu do podpisu');
    } finally {
      setLoading(false);
    }
  };

  const handleSign = async () => {
    if (!request) return;

    setSigning(true);
    try {
      // Update signature request
      const { error: updateError } = await supabase
        .from('signature_requests')
        .update({
          status: 'signed',
          completed_at: new Date().toISOString(),
        })
        .eq('id', request.id);

      if (updateError) throw updateError;

      // Create digital signature record
      await supabase.from('digital_signatures').insert({
        document_id: request.document_id,
        signer_email: request.recipient_email,
        signer_name: request.recipient_name,
        signer_type: 'external',
        status: 'signed',
        signed_at: new Date().toISOString(),
        request_id: request.id,
      });

      // Log event
      await supabase.rpc('log_document_event', {
        p_document_id: request.document_id,
        p_action: 'signed',
        p_actor_type: 'external',
        p_actor_name: request.recipient_name,
        p_actor_email: request.recipient_email,
        p_metadata: { signature_request_id: request.id },
      });

      setSigned(true);
    } catch (err: any) {
      setError('Wystąpił błąd podczas podpisywania. Spróbuj ponownie.');
    } finally {
      setSigning(false);
    }
  };

  const handleDecline = async () => {
    if (!request || !declineReason.trim()) return;

    setDeclining(true);
    try {
      await supabase
        .from('signature_requests')
        .update({
          status: 'declined',
          completed_at: new Date().toISOString(),
          decline_reason: declineReason.trim(),
        })
        .eq('id', request.id);

      // Log event
      await supabase.rpc('log_document_event', {
        p_document_id: request.document_id,
        p_action: 'signature_declined',
        p_actor_type: 'external',
        p_actor_name: request.recipient_name,
        p_actor_email: request.recipient_email,
        p_metadata: { reason: declineReason.trim() },
      });

      setError('Dokument został odrzucony');
      setShowDeclineForm(false);
    } catch (err: any) {
      setError('Wystąpił błąd. Spróbuj ponownie.');
    } finally {
      setDeclining(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex items-center gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
          <span className="text-slate-600">Ładowanie...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 text-center">
          <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-red-500" />
          </div>
          <h1 className="text-xl font-semibold text-slate-800 mb-2">Błąd</h1>
          <p className="text-slate-600">{error}</p>
        </div>
      </div>
    );
  }

  if (signed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 text-center">
          <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <Check className="w-8 h-8 text-green-500" />
          </div>
          <h1 className="text-xl font-semibold text-slate-800 mb-2">
            Dokument podpisany!
          </h1>
          <p className="text-slate-600 mb-4">
            Dziękujemy za podpisanie dokumentu "{request?.documents?.name}".
          </p>
          <p className="text-sm text-slate-500">
            Potwierdzenie zostało wysłane na adres {request?.recipient_email}
          </p>
        </div>
      </div>
    );
  }

  if (!request) return null;

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
              <FileText className="w-6 h-6 text-blue-600" />
            </div>
            <div className="flex-1">
              <h1 className="text-lg font-semibold text-slate-800">
                {request.documents?.name}
              </h1>
              {request.documents?.number && (
                <p className="text-sm text-slate-500">
                  Nr dokumentu: {request.documents.number}
                </p>
              )}
              <div className="flex items-center gap-4 mt-3 text-xs text-slate-500">
                <span className="flex items-center gap-1">
                  <User className="w-3.5 h-3.5" />
                  {request.recipient_name}
                </span>
                <span className="flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" />
                  Wygasa: {new Date(request.expires_at).toLocaleDateString('pl-PL')}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Document Preview */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-4">
          <h2 className="text-sm font-medium text-slate-700 mb-4">Podgląd dokumentu</h2>
          <div className="bg-slate-50 rounded-lg p-4 text-sm text-slate-600 max-h-96 overflow-y-auto">
            {/* Render document content here */}
            <p className="text-center text-slate-400 py-8">
              Podgląd treści dokumentu...
            </p>
          </div>
        </div>

        {/* Signature Actions */}
        {!showDeclineForm ? (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center gap-3 mb-4">
              <Shield className="w-5 h-5 text-blue-600" />
              <h2 className="font-medium text-slate-800">Podpisz dokument</h2>
            </div>
            <p className="text-sm text-slate-600 mb-6">
              Klikając "Podpisz dokument", potwierdzasz, że zapoznałeś się z treścią
              dokumentu i akceptujesz jego warunki.
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleSign}
                disabled={signing}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
              >
                {signing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                Podpisz dokument
              </button>
              <button
                onClick={() => setShowDeclineForm(true)}
                className="px-4 py-3 text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
              >
                Odrzuć
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <h2 className="font-medium text-slate-800 mb-4">Odrzuć dokument</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Powód odrzucenia <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                  placeholder="Podaj powód odrzucenia dokumentu..."
                  rows={3}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-y"
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleDecline}
                  disabled={declining || !declineReason.trim()}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-60 transition-colors"
                >
                  {declining ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <X className="w-4 h-4" />
                  )}
                  Odrzuć dokument
                </button>
                <button
                  onClick={() => setShowDeclineForm(false)}
                  className="px-4 py-3 text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  Anuluj
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SigningPage;
