import React, { useState, useEffect, useCallback } from 'react';
import { Check, Clock, Send, XCircle, AlertCircle, Loader2, RefreshCw, Mail, User } from 'lucide-react';
import { getSignatureRequests, sendSignatureReminder } from '../../../../lib/documentService';

interface WorkflowStepsPanelProps {
  documentId: string;
  companyId?: string;
}

type SignatureStatus = 'pending' | 'sent' | 'signed' | 'declined' | 'expired';

const STATUS_CONFIG: Record<SignatureStatus, {
  label: string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  lineColor: string;
}> = {
  pending: {
    label: 'Oczekuje',
    icon: <Clock className="w-4 h-4" />,
    color: 'text-amber-600',
    bgColor: 'bg-amber-100',
    lineColor: 'bg-amber-300',
  },
  sent: {
    label: 'Wysłano',
    icon: <Send className="w-4 h-4" />,
    color: 'text-blue-600',
    bgColor: 'bg-blue-100',
    lineColor: 'bg-blue-300',
  },
  signed: {
    label: 'Podpisano',
    icon: <Check className="w-4 h-4" />,
    color: 'text-green-600',
    bgColor: 'bg-green-100',
    lineColor: 'bg-green-500',
  },
  declined: {
    label: 'Odrzucono',
    icon: <XCircle className="w-4 h-4" />,
    color: 'text-red-600',
    bgColor: 'bg-red-100',
    lineColor: 'bg-red-400',
  },
  expired: {
    label: 'Wygasło',
    icon: <AlertCircle className="w-4 h-4" />,
    color: 'text-slate-500',
    bgColor: 'bg-slate-100',
    lineColor: 'bg-slate-300',
  },
};

const ROLE_LABELS: Record<string, string> = {
  viewer: 'Podgląd',
  approver: 'Zatwierdzający',
  signer: 'Podpisujący',
};

const formatDate = (iso: string) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const WorkflowStepsPanel: React.FC<WorkflowStepsPanelProps> = ({ documentId }) => {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [reminding, setReminding] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getSignatureRequests(documentId);
      setRequests(data ?? []);
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  useEffect(() => { load(); }, [load]);

  const handleRemind = async (requestId: string) => {
    setReminding(requestId);
    try {
      await sendSignatureReminder(requestId);
    } finally {
      setReminding(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
      </div>
    );
  }

  if (requests.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-slate-400">
        <Send className="w-10 h-10" />
        <p className="text-sm font-medium">Brak zapytań o podpis</p>
        <p className="text-xs">Użyj przycisku "Wyślij do podpisu" aby rozpocząć proces</p>
      </div>
    );
  }

  // Summary
  const total = requests.length;
  const signed = requests.filter((r) => r.status === 'signed').length;
  const pending = requests.filter((r) => r.status === 'pending' || r.status === 'sent').length;
  const declined = requests.filter((r) => r.status === 'declined').length;

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex items-center gap-4 p-3 bg-slate-50 rounded-lg border border-slate-200">
        <div className="flex-1">
          <div className="flex items-center gap-1 mb-1.5">
            <div className="h-2 rounded-full bg-slate-200 flex-1 overflow-hidden">
              <div
                className="h-full bg-green-500 rounded-full transition-all duration-500"
                style={{ width: `${total > 0 ? (signed / total) * 100 : 0}%` }}
              />
            </div>
            <span className="text-xs font-bold text-slate-600 ml-2">
              {signed}/{total}
            </span>
          </div>
          <div className="flex gap-3 text-xs text-slate-500">
            {signed > 0 && <span className="text-green-600 font-medium">✓ {signed} podpisanych</span>}
            {pending > 0 && <span className="text-amber-600 font-medium">⏳ {pending} oczekujących</span>}
            {declined > 0 && <span className="text-red-600 font-medium">✕ {declined} odrzuconych</span>}
          </div>
        </div>
        <button
          onClick={load}
          className="p-2 hover:bg-slate-200 rounded-lg transition-colors"
          title="Odśwież"
        >
          <RefreshCw className="w-4 h-4 text-slate-400" />
        </button>
      </div>

      {/* Vertical stepper */}
      <div className="relative">
        {requests.map((req, idx) => {
          const status = (req.status as SignatureStatus) || 'pending';
          const config = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
          const isLast = idx === requests.length - 1;

          return (
            <div key={req.id} className="flex gap-4 relative">
              {/* Vertical line + icon */}
              <div className="flex flex-col items-center">
                <div className={`w-8 h-8 rounded-full ${config.bgColor} ${config.color} flex items-center justify-center z-10 shadow-sm ring-2 ring-white`}>
                  {config.icon}
                </div>
                {!isLast && (
                  <div className={`w-0.5 flex-1 ${config.lineColor} min-h-[40px]`} />
                )}
              </div>

              {/* Content */}
              <div className={`flex-1 pb-6 ${isLast ? '' : ''}`}>
                <div className="bg-white border border-slate-200 rounded-lg p-3 hover:shadow-sm transition-shadow">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-sm font-semibold text-slate-800 truncate">
                          {req.signer_name || req.signer_email}
                        </p>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider ${config.bgColor} ${config.color}`}>
                          {config.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <Mail className="w-3 h-3" />
                        <span className="truncate">{req.signer_email}</span>
                      </div>
                      {req.signer_role && (
                        <div className="flex items-center gap-1 mt-1 text-xs text-slate-400">
                          <User className="w-3 h-3" />
                          {ROLE_LABELS[req.signer_role] || req.signer_role}
                        </div>
                      )}
                      <div className="flex items-center gap-3 mt-1.5 text-[11px] text-slate-400">
                        <span>Wysłano: {formatDate(req.created_at)}</span>
                        {req.signed_at && <span className="text-green-600 font-medium">Podpisano: {formatDate(req.signed_at)}</span>}
                        {req.expires_at && status !== 'signed' && (
                          <span className={new Date(req.expires_at) < new Date() ? 'text-red-500' : ''}>
                            Wygasa: {formatDate(req.expires_at)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    {(status === 'pending' || status === 'sent') && (
                      <button
                        onClick={() => handleRemind(req.id)}
                        disabled={reminding === req.id}
                        className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded-md transition-colors disabled:opacity-50"
                        title="Wyślij przypomnienie"
                      >
                        {reminding === req.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3 h-3" />
                        )}
                        Przypomnij
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default WorkflowStepsPanel;
