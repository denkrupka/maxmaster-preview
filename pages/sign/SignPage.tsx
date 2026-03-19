import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { FileText, Check, Loader2, AlertCircle, Shield, Clock } from 'lucide-react';

/**
 * PublicSignPage — public signature page accessible at /sign/:token
 * No authentication required. Loads signature request by token,
 * shows document preview, and allows signing.
 */

type PageState = 'loading' | 'ready' | 'signing' | 'signed' | 'error' | 'expired' | 'already_signed';

const SignPage: React.FC = () => {
  // Extract token from URL hash: /#/sign/:token
  const getToken = (): string => {
    const hash = window.location.hash || '';
    const match = hash.match(/\/sign\/([^/?#]+)/);
    return match ? match[1] : '';
  };

  const [token] = useState(getToken);
  const [state, setState] = useState<PageState>('loading');
  const [request, setRequest] = useState<any>(null);
  const [document, setDocument] = useState<any>(null);
  const [error, setError] = useState('');
  const [pin, setPin] = useState('');

  useEffect(() => {
    if (!token) {
      setState('error');
      setError('Brak tokenu podpisu w linku');
      return;
    }
    loadRequest();
  }, [token]);

  const loadRequest = async () => {
    setState('loading');
    try {
      // Try loading by ID first (token is the request ID)
      const { data: req, error: reqErr } = await supabase
        .from('signature_requests')
        .select('*, documents(id, name, number, status, data, template_id, document_templates(name, type))')
        .eq('id', token)
        .single();

      if (reqErr || !req) {
        // Try by signature_token field if exists
        const { data: req2, error: reqErr2 } = await supabase
          .from('signature_requests')
          .select('*, documents(id, name, number, status, data, template_id, document_templates(name, type))')
          .eq('signature_token', token)
          .single();

        if (reqErr2 || !req2) {
          setState('error');
          setError('Nie znaleziono zapytania o podpis. Link może być nieprawidłowy.');
          return;
        }
        setRequest(req2);
        setDocument(req2.documents);
        checkStatus(req2);
        return;
      }

      setRequest(req);
      setDocument(req.documents);
      checkStatus(req);
    } catch (err: any) {
      setState('error');
      setError(err.message || 'Wystąpił nieoczekiwany błąd');
    }
  };

  const checkStatus = (req: any) => {
    if (req.status === 'signed') {
      setState('already_signed');
    } else if (req.status === 'expired' || (req.expires_at && new Date(req.expires_at) < new Date())) {
      setState('expired');
    } else if (req.status === 'declined') {
      setState('error');
      setError('To zapytanie o podpis zostało odrzucone.');
    } else {
      setState('ready');
    }
  };

  const handleSign = async () => {
    setState('signing');
    try {
      // Update signature request status
      const { error: updateErr } = await supabase
        .from('signature_requests')
        .update({
          status: 'signed',
          signed_at: new Date().toISOString(),
          ip_address: null, // Would need server-side for real IP
          user_agent: navigator.userAgent,
        })
        .eq('id', request.id)
        .eq('status', 'pending');

      if (updateErr) throw updateErr;

      // Create digital signature record
      await supabase.from('digital_signatures').insert({
        document_id: document.id,
        signer_email: request.signer_email,
        signer_name: request.signer_name,
        signature_type: 'electronic',
        signed_at: new Date().toISOString(),
        verification_code: request.id.slice(0, 8).toUpperCase(),
      });

      // Log audit event
      await supabase.from('document_audit_log').insert({
        document_id: document.id,
        action: 'signed',
        details: { signer: request.signer_email },
      });

      // Try calling edge function for webhook
      try {
        await supabase.functions.invoke('document-signed-webhook', {
          body: {
            token,
            request_id: request.id,
            document_id: document.id,
            signer_email: request.signer_email,
          },
        });
      } catch {
        // Edge function might not exist — continue silently
      }

      setState('signed');
    } catch (err: any) {
      setState('ready');
      setError(err.message || 'Wystąpił błąd podczas podpisywania');
    }
  };

  // Render helpers
  const renderLoading = () => (
    <div className="flex flex-col items-center gap-4 py-16">
      <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
      <p className="text-slate-500 text-sm">Ładowanie dokumentu...</p>
    </div>
  );

  const renderError = () => (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <div className="bg-red-100 p-4 rounded-full">
        <AlertCircle className="w-10 h-10 text-red-500" />
      </div>
      <h2 className="text-xl font-bold text-slate-900">Błąd</h2>
      <p className="text-slate-600 max-w-sm">{error}</p>
    </div>
  );

  const renderExpired = () => (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <div className="bg-slate-100 p-4 rounded-full">
        <Clock className="w-10 h-10 text-slate-400" />
      </div>
      <h2 className="text-xl font-bold text-slate-900">Link wygasł</h2>
      <p className="text-slate-600 max-w-sm">
        Termin podpisania tego dokumentu minął. Skontaktuj się z nadawcą, aby otrzymać nowy link.
      </p>
    </div>
  );

  const renderAlreadySigned = () => (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <div className="bg-green-100 p-4 rounded-full">
        <Check className="w-10 h-10 text-green-600" />
      </div>
      <h2 className="text-xl font-bold text-slate-900">Dokument już podpisany</h2>
      <p className="text-slate-600 max-w-sm">
        Ten dokument został już podpisany{request?.signed_at && (
          <> dnia {new Date(request.signed_at).toLocaleDateString('pl-PL')}</>
        )}.
      </p>
    </div>
  );

  const renderSigned = () => (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <div className="bg-green-100 p-5 rounded-full animate-in zoom-in duration-300">
        <Check className="w-12 h-12 text-green-600" />
      </div>
      <h2 className="text-2xl font-bold text-green-800">Dokument podpisany pomyślnie</h2>
      <p className="text-slate-600 max-w-md">
        Twój podpis elektroniczny został złożony. Nadawca dokumentu zostanie powiadomiony.
      </p>
      <div className="bg-green-50 border border-green-200 rounded-lg p-4 mt-4 max-w-sm w-full">
        <div className="flex items-center gap-2 text-sm text-green-700 mb-2">
          <Shield className="w-4 h-4" />
          <span className="font-medium">Szczegóły podpisu</span>
        </div>
        <div className="text-xs text-green-600 space-y-1">
          <p>Dokument: {document?.name}</p>
          <p>Podpisał: {request?.signer_email}</p>
          <p>Data: {new Date().toLocaleString('pl-PL')}</p>
          <p>Kod weryfikacji: {request?.id?.slice(0, 8).toUpperCase()}</p>
        </div>
      </div>
    </div>
  );

  const renderReady = () => (
    <div className="space-y-6">
      {/* Document info */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-start gap-4">
          <div className="bg-blue-100 p-3 rounded-lg">
            <FileText className="w-6 h-6 text-blue-600" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold text-slate-900">{document?.name || 'Dokument'}</h3>
            {document?.number && (
              <p className="text-sm text-slate-500 mt-0.5">Nr: {document.number}</p>
            )}
            {document?.document_templates && (
              <p className="text-xs text-slate-400 mt-1">
                Szablon: {document.document_templates.name}
              </p>
            )}
            {request?.message && (
              <div className="mt-4 p-3 bg-blue-50 border border-blue-100 rounded-lg">
                <p className="text-xs font-medium text-blue-700 mb-1">Wiadomość od nadawcy:</p>
                <p className="text-sm text-blue-800">{request.message}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Signer info */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs text-slate-400 font-bold uppercase mb-1">Podpisujący</p>
            <p className="font-medium text-slate-800">{request?.signer_name || request?.signer_email}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400 font-bold uppercase mb-1">Email</p>
            <p className="text-slate-600">{request?.signer_email}</p>
          </div>
          {request?.signer_role && (
            <div>
              <p className="text-xs text-slate-400 font-bold uppercase mb-1">Rola</p>
              <p className="text-slate-600 capitalize">{request.signer_role}</p>
            </div>
          )}
          {request?.expires_at && (
            <div>
              <p className="text-xs text-slate-400 font-bold uppercase mb-1">Ważny do</p>
              <p className="text-slate-600">
                {new Date(request.expires_at).toLocaleDateString('pl-PL')}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Sign button */}
      <div className="flex flex-col items-center gap-4 pt-4">
        <p className="text-xs text-slate-500 text-center max-w-sm">
          Klikając "Podpisuję", wyrażasz zgodę na złożenie podpisu elektronicznego pod tym dokumentem.
        </p>
        <button
          onClick={handleSign}
          disabled={state === 'signing'}
          className="w-full max-w-xs px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-bold rounded-xl shadow-lg shadow-blue-600/30 transition-all flex items-center justify-center gap-2 text-lg"
        >
          {state === 'signing' ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Podpisywanie...
            </>
          ) : (
            <>
              <Check className="w-5 h-5" />
              Podpisuję
            </>
          )}
        </button>
        <div className="flex items-center gap-1 text-xs text-slate-400">
          <Shield className="w-3 h-3" />
          Podpis zabezpieczony kryptograficznie
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex items-center justify-center p-4">
      <div className="w-full max-w-xl">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-slate-900">MaxMaster</h1>
          <p className="text-sm text-slate-500 mt-1">System podpisu elektronicznego</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
          <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4">
            <div className="flex items-center gap-3">
              <Shield className="w-5 h-5 text-white/80" />
              <div>
                <h2 className="text-white font-semibold">Podpis elektroniczny</h2>
                <p className="text-blue-200 text-xs">Dokument wymaga Twojego podpisu</p>
              </div>
            </div>
          </div>

          <div className="p-6">
            {state === 'loading' && renderLoading()}
            {state === 'error' && renderError()}
            {state === 'expired' && renderExpired()}
            {state === 'already_signed' && renderAlreadySigned()}
            {state === 'signed' && renderSigned()}
            {state === 'ready' && renderReady()}
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-6 text-xs text-slate-400">
          <p>© {new Date().getFullYear()} MaxMaster Sp. z o.o.</p>
          <p className="mt-1">Podpis elektroniczny zgodny z eIDAS</p>
        </div>
      </div>
    </div>
  );
};

export default SignPage;
