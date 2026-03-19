import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, FileText, Clock, ChevronLeft, ChevronRight } from 'lucide-react';
import { getDocumentAuditLog } from '../../../../lib/documentService';

interface AuditLogListProps {
  documentId: string;
}

const ACTION_LABELS: Record<string, string> = {
  created: 'Utworzono dokument',
  updated: 'Zaktualizowano dokument',
  status_changed: 'Zmieniono status',
  version_created: 'Utworzono nową wersję',
  version_restored: 'Przywrócono wersję',
  pdf_generated: 'Wygenerowano PDF',
  pdf_downloaded: 'Pobrano PDF',
  email_sent: 'Wysłano email',
  signature_requested: 'Wysłano do podpisu',
  signed: 'Podpisano',
  declined: 'Odrzucono podpis',
  reminder_sent: 'Wysłano przypomnienie',
  comment_added: 'Dodano komentarz',
  link_created: 'Utworzono link publiczny',
  link_deactivated: 'Dezaktywowano link',
  linked_invoice: 'Powiązano z fakturą',
  archived: 'Zarchiwizowano',
  deleted: 'Usunięto',
};

const ACTION_ICONS: Record<string, string> = {
  created: '📄',
  updated: '✏️',
  signed: '✍️',
  signature_requested: '📩',
  email_sent: '📧',
  pdf_generated: '📋',
  pdf_downloaded: '⬇️',
  comment_added: '💬',
  reminder_sent: '🔔',
  declined: '❌',
  archived: '📦',
  deleted: '🗑️',
};

const PAGE_SIZE = 15;

const AuditLogList: React.FC<AuditLogListProps> = ({ documentId }) => {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getDocumentAuditLog(documentId);
      setLogs(data ?? []);
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-slate-400">
        <FileText className="w-10 h-10" />
        <p className="text-sm font-medium">Brak historii działań</p>
      </div>
    );
  }

  const totalPages = Math.ceil(logs.length / PAGE_SIZE);
  const paginated = logs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-3">
      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="px-4 py-3 text-left w-10"></th>
              <th className="px-4 py-3 text-left">Działanie</th>
              <th className="px-4 py-3 text-left">Wykonał</th>
              <th className="px-4 py-3 text-left">Data</th>
              <th className="px-4 py-3 text-left">Szczegóły</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {paginated.map((log) => {
              const actionKey = log.action || '';
              const icon = ACTION_ICONS[actionKey] || '📝';
              const label = ACTION_LABELS[actionKey] || actionKey.replace(/_/g, ' ');
              const details = log.details ? (typeof log.details === 'object' ? JSON.stringify(log.details) : log.details) : '—';

              return (
                <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 text-center">
                    <span className="text-base">{icon}</span>
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {label}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {log.actor_name || 'System'}
                  </td>
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(log.created_at).toLocaleString('pl-PL', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs max-w-xs truncate" title={details}>
                    {details !== '—' ? (
                      <span className="bg-slate-100 px-2 py-0.5 rounded text-slate-600 font-mono">
                        {details.length > 60 ? details.slice(0, 60) + '…' : details}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-2 py-2">
          <p className="text-xs text-slate-500">
            {logs.length} wpisów · Strona {page} z {totalPages}
          </p>
          <div className="flex gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-30"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              const p = totalPages <= 5 ? i + 1 : Math.min(Math.max(page - 2, 1), totalPages - 4) + i;
              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`w-8 h-8 text-xs rounded ${
                    p === page ? 'bg-blue-600 text-white' : 'hover:bg-slate-100'
                  }`}
                >
                  {p}
                </button>
              );
            })}
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-30"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AuditLogList;
