import React, { useState } from 'react';
import { X, Send, Paperclip, Link as LinkIcon, Loader2, Check, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { logDocumentEvent } from '../../lib/documentService';

interface EmailSendModalProps {
  isOpen: boolean;
  onClose: () => void;
  document: {
    id: string;
    name: string;
    number?: string;
    company_id: string;
  };
  userId: string;
  userName: string;
  onSent: () => void;
}

export const EmailSendModal: React.FC<EmailSendModalProps> = ({
  isOpen,
  onClose,
  document,
  userId,
  userName,
  onSent,
}) => {
  const [recipients, setRecipients] = useState('');
  const [subject, setSubject] = useState(`Dokument: ${document.name}`);
  const [message, setMessage] = useState('');
  const [attachPdf, setAttachPdf] = useState(true);
  const [includeLink, setIncludeLink] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSend = async () => {
    const emailList = recipients.split(',').map(e => e.trim()).filter(Boolean);
    
    if (emailList.length === 0) {
      setError('Podaj przynajmniej jeden adres email');
      return;
    }

    if (!subject.trim()) {
      setError('Temat wiadomości jest wymagany');
      return;
    }

    // Validate emails
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalidEmails = emailList.filter(e => !emailRegex.test(e));
    if (invalidEmails.length > 0) {
      setError(`Nieprawidłowe adresy: ${invalidEmails.join(', ')}`);
      return;
    }

    setSending(true);
    setError('');

    try {
      // Create email records for each recipient
      const emailRecords = emailList.map(email => ({
        document_id: document.id,
        company_id: document.company_id,
        recipient_email: email,
        recipient_name: '',
        subject: subject.trim(),
        body: message.trim(),
        attach_pdf: attachPdf,
        include_public_link: includeLink,
        status: 'queued',
        created_by: userId,
      }));

      const { error: insertError } = await supabase
        .from('document_emails')
        .insert(emailRecords);

      if (insertError) throw insertError;

      // Log event
      await logDocumentEvent(document.id, 'email_sent', {
        recipients: emailList,
        subject: subject.trim(),
        attach_pdf: attachPdf,
        include_link: includeLink,
      });

      setSuccess(true);
      setTimeout(() => {
        onSent();
        onClose();
        // Reset form
        setRecipients('');
        setMessage('');
        setSuccess(false);
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'Wystąpił błąd podczas wysyłania');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-800">
            Wyślij dokument email
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
            aria-label="Zamknij"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {success ? (
            <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">
              <Check className="w-5 h-5" />
              <span>Email został wysłany!</span>
            </div>
          ) : (
            <>
              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {error}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Adresaci <span className="text-red-500">*</span>
                  <span className="text-slate-400 font-normal ml-1">(oddziel przecinkami)</span>
                </label>
                <input
                  type="text"
                  value={recipients}
                  onChange={(e) => setRecipients(e.target.value)}
                  placeholder="jan.kowalski@firma.pl, anna.nowak@firma.pl"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Temat <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Wiadomość
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Dzień dobry,\n\nW załączeniu przesyłam dokument..."
                  rows={5}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-500"
                />
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={attachPdf}
                    onChange={(e) => setAttachPdf(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <Paperclip className="w-4 h-4 text-slate-500" />
                  <span className="text-sm text-slate-600">Dołącz PDF dokumentu</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeLink}
                    onChange={(e) => setIncludeLink(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <LinkIcon className="w-4 h-4 text-slate-500" />
                  <span className="text-sm text-slate-600">Dołącz link do podglądu online</span>
                </label>
              </div>

              <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-700">
                <p className="font-medium mb-1">Dokument:</p>
                <p>{document.name}</p>
                {document.number && <p className="text-slate-500">Nr: {document.number}</p>}
              </div>
            </>
          )}
        </div>

        {!success && (
          <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-200">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Anuluj
            </button>
            <button
              onClick={handleSend}
              disabled={sending}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
            >
              {sending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              Wyślij
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default EmailSendModal;
