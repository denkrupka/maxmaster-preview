import React, { useState, useEffect } from 'react';
import { X, Loader2, Send, Mail, User, Shield, MessageSquare, Calendar } from 'lucide-react';
import { supabase } from '../../../../lib/supabase';
import { createSignatureRequest, logDocumentEvent } from '../../../../lib/documentService';

interface SignatureRequestModalProps {
  documentId: string;
  documentName: string;
  companyId: string;
  userId: string;
  onClose: () => void;
  onSent: () => void;
}

type SignerRole = 'viewer' | 'approver' | 'signer';

const ROLE_LABELS: Record<SignerRole, string> = {
  viewer: 'Podgląd',
  approver: 'Zatwierdzający',
  signer: 'Podpisujący',
};

const ROLE_COLORS: Record<SignerRole, string> = {
  viewer: 'bg-slate-100 text-slate-600',
  approver: 'bg-amber-100 text-amber-700',
  signer: 'bg-blue-100 text-blue-700',
};

const SignatureRequestModal: React.FC<SignatureRequestModalProps> = ({
  documentId, documentName, companyId, userId, onClose, onSent,
}) => {
  const [signerEmail, setSignerEmail] = useState('');
  const [signerName, setSignerName] = useState('');
  const [role, setRole] = useState<SignerRole>('signer');
  const [message, setMessage] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  // Set default expiration to 7 days from now
  useEffect(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    setExpiresAt(d.toISOString().split('T')[0]);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signerEmail.trim()) {
      setError('Email jest wymagany');
      return;
    }

    setSending(true);
    setError('');

    try {
      // Create signature request in Supabase
      const { data, error: insertError } = await supabase
        .from('signature_requests')
        .insert({
          company_id: companyId,
          document_id: documentId,
          signer_email: signerEmail.trim(),
          signer_name: signerName.trim() || null,
          signer_role: role,
          message: message.trim() || null,
          expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
          created_by: userId,
          status: 'pending',
        })
        .select()
        .single();

      if (insertError) throw insertError;

      // Try to invoke edge function for sending email notification
      try {
        await supabase.functions.invoke('send-signature-request', {
          body: {
            request_id: data.id,
            document_name: documentName,
            signer_email: signerEmail.trim(),
            signer_name: signerName.trim(),
            role,
            message: message.trim(),
            expires_at: expiresAt,
          },
        });
      } catch {
        // Edge function might not exist yet — continue silently
        console.warn('Edge function send-signature-request not available');
      }

      // Log audit event
      await logDocumentEvent(documentId, 'signature_requested', {
        signer: signerEmail.trim(),
        role,
      });

      onSent();
    } catch (err: any) {
      setError(err.message || 'Wystąpił błąd podczas wysyłania');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-lg animate-in fade-in zoom-in duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="bg-blue-100 p-2 rounded-lg">
              <Send className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="font-bold text-slate-900">Wyślij do podpisu</h2>
              <p className="text-xs text-slate-500 mt-0.5 truncate max-w-xs">{documentName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm flex items-center gap-2">
              <X className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Email */}
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">
              <Mail className="w-3.5 h-3.5 inline mr-1" />
              Email podpisującego *
            </label>
            <input
              type="email"
              required
              value={signerEmail}
              onChange={(e) => setSignerEmail(e.target.value)}
              placeholder="jan.kowalski@firma.pl"
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Name */}
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">
              <User className="w-3.5 h-3.5 inline mr-1" />
              Imię i nazwisko
            </label>
            <input
              type="text"
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              placeholder="Jan Kowalski"
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Role */}
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">
              <Shield className="w-3.5 h-3.5 inline mr-1" />
              Rola
            </label>
            <div className="flex gap-2">
              {(Object.keys(ROLE_LABELS) as SignerRole[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg border-2 transition-all ${
                    role === r
                      ? `${ROLE_COLORS[r]} border-current shadow-sm`
                      : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                  }`}
                >
                  {ROLE_LABELS[r]}
                </button>
              ))}
            </div>
          </div>

          {/* Message */}
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">
              <MessageSquare className="w-3.5 h-3.5 inline mr-1" />
              Wiadomość (opcjonalnie)
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Proszę o podpisanie dokumentu do końca tygodnia..."
              rows={3}
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
            />
          </div>

          {/* Expiration */}
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">
              <Calendar className="w-3.5 h-3.5 inline mr-1" />
              Termin ważności
            </label>
            <input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              min={new Date().toISOString().split('T')[0]}
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={sending || !signerEmail.trim()}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {sending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Wysyłanie...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Wyślij na podpis
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SignatureRequestModal;
