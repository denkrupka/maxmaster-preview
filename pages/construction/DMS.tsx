import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FileText, Plus, Search, Eye, Download, Pencil, Trash2, Archive,
  ChevronLeft, ChevronRight, Check, X, Loader2,
} from 'lucide-react';
import { useAppContext } from '../../context/AppContext';
import { supabase } from '../../lib/supabase';
import {
  fetchTemplates, fetchTemplate, createTemplate, updateTemplate, deleteTemplate,
  fetchDocuments, fetchDocument, createDocument, updateDocument,
  getAutofillData, applyAutofill, renderTemplate, generatePDF,
  fetchDocumentSettings, updateDocumentSettings, generateDocumentNumber,
  getDocumentVersions, restoreDocumentVersion, getDocumentAuditLog, logDocumentEvent,
  createPublicLink, getPublicLinks, deactivatePublicLink,
  createSignatureRequest, getSignatureRequests,
  getVersionDiff, getDocumentComments, addDocumentComment, resolveComment, analyzeDocument, getDocumentAnalyses,
  getDocumentStats, exportDocumentsCSV, downloadCSV, duplicateDocument,
} from '../../lib/documentService';
import type {
  DocumentTemplate, DocumentRecord, TemplateVariable,
  DocumentTemplateType, DocumentStatus, TemplateSection,
  CreateTemplateInput, CreateDocumentInput,
  DocumentSettings, NumberingConfig,
} from '../../types';

// ── helpers ──────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<DocumentTemplateType, string> = {
  contract: 'Umowa', protocol: 'Protokół', annex: 'Aneks', other: 'Inne',
};
const STATUS_LABELS: Record<DocumentStatus, string> = {
  draft: 'Szkic', completed: 'Gotowy', archived: 'Zarchiwizowany',
};
const STATUS_COLORS: Record<DocumentStatus, string> = {
  draft: 'bg-yellow-100 text-yellow-800',
  completed: 'bg-green-100 text-green-800',
  archived: 'bg-slate-100 text-slate-500',
};

const fmt = (iso: string) => new Date(iso).toLocaleDateString('pl-PL');

// Highlight {{placeholder}} in text
const HighlightedContent = ({ text }: { text: string }) => {
  const parts = text.split(/({{[^}]+}})/g);
  return (
    <span>
      {parts.map((p, i) =>
        /^{{.+}}$/.test(p)
          ? <mark key={i} className="bg-blue-100 text-blue-700 rounded px-0.5 font-mono text-xs">{p}</mark>
          : <span key={i}>{p}</span>
      )}
    </span>
  );
};

const Spinner = () => (
  <div className="flex justify-center py-12">
    <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
  </div>
);

const Empty = ({ label, action }: { label: string; action?: { text: string; onClick: () => void } }) => (
  <div className="flex flex-col items-center gap-3 py-16 text-slate-400">
    <FileText className="w-12 h-12" />
    <p className="text-sm">{label}</p>
    {action && <button onClick={action.onClick} className="flex items-center gap-1 text-sm text-blue-600 hover:underline"><Plus className="w-4 h-4" /> {action.text}</button>}
  </div>
);

// ── Template Modal ────────────────────────────────────────────────────────────

interface TemplateMeta { name: string; type: DocumentTemplateType; description: string; }

const TemplateModal = ({
  companyId, userId, existing, onClose, onSaved,
}: {
  companyId: string; userId: string;
  existing?: DocumentTemplate;
  onClose: () => void; onSaved: () => void;
}) => {
  const [meta, setMeta] = useState<TemplateMeta>({
    name: existing?.name ?? '', type: existing?.type ?? 'contract', description: existing?.description ?? '',
  });
  const [sections, setSections] = useState<TemplateSection[]>(
    existing?.content ?? [{ title: '', body: '' }]
  );
  const [variables, setVariables] = useState<TemplateVariable[]>(existing?.variables ?? []);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, []);

  const updateSection = (i: number, field: keyof TemplateSection, val: string) =>
    setSections(s => s.map((sec, idx) => idx === i ? { ...sec, [field]: val } : sec));
  const moveSection = (i: number, dir: -1 | 1) => {
    const arr = [...sections]; const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]]; setSections(arr);
  };
  const updateVar = (i: number, field: keyof TemplateVariable, val: string) =>
    setVariables(v => v.map((vr, idx) => idx === i ? { ...vr, [field]: val } : vr));

  const save = async () => {
    if (!meta.name.trim()) { setErr('Nazwa jest wymagana'); return; }
    setSaving(true); setErr('');
    try {
      const payload = { ...meta, content: sections, variables, is_active: true };
      if (existing) {
        await updateTemplate(existing.id, payload);
      } else {
        const inp: CreateTemplateInput = { ...payload, company_id: companyId, created_by: userId };
        await createTemplate(inp);
      }
      onSaved();
    } catch (e: any) { setErr(e.message ?? 'Wystąpił błąd podczas zapisu. Spróbuj ponownie.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto" role="dialog" aria-modal="true">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl my-8">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold text-slate-800">
            {existing ? 'Edytuj szablon' : 'Nowy szablon'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Zamknij" title="Zamknij"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-6 py-4 space-y-4">
          {/* Meta */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Nazwa *</label>
              <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                value={meta.name} onChange={e => setMeta(m => ({ ...m, name: e.target.value }))}
                placeholder="Np. Umowa o dzieło" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Typ</label>
              <select className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                value={meta.type} onChange={e => setMeta(m => ({ ...m, type: e.target.value as DocumentTemplateType }))}>
                {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Opis</label>
            <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              value={meta.description} onChange={e => setMeta(m => ({ ...m, description: e.target.value }))}
              placeholder="Opcjonalny opis szablonu" />
          </div>
          {/* Sections */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-slate-500">Sekcje szablonu</span>
              <button onClick={() => setSections(s => [...s, { title: '', body: '' }])}
                className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                <Plus className="w-3 h-3" /> Dodaj sekcję
              </button>
            </div>
            <div className="space-y-3">
              {sections.map((sec, i) => (
                <div key={i} className="border border-slate-200 rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <input className="flex-1 border border-slate-200 rounded px-2 py-1 text-sm"
                      placeholder="Tytuł sekcji (opcjonalny)" value={sec.title ?? ''}
                      onChange={e => updateSection(i, 'title', e.target.value)} />
                    <button onClick={() => moveSection(i, -1)} disabled={i === 0}
                      className="text-slate-400 hover:text-slate-600 disabled:opacity-30">
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button onClick={() => moveSection(i, 1)} disabled={i === sections.length - 1}
                      className="text-slate-400 hover:text-slate-600 disabled:opacity-30">
                      <ChevronRight className="w-4 h-4" />
                    </button>
                    <button onClick={() => setSections(s => s.filter((_, idx) => idx !== i))}
                      className="text-red-400 hover:text-red-600" aria-label="Usuń" title="Usuń">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <textarea className="w-full border border-slate-200 rounded px-2 py-1 text-sm font-mono h-24 resize-y"
                    placeholder="Treść sekcji, użyj {{zmienna}} jako placeholder"
                    value={sec.body} onChange={e => updateSection(i, 'body', e.target.value)} />
                  <div className="text-xs text-slate-400">
                    <HighlightedContent text={sec.body.slice(0, 120) + (sec.body.length > 120 ? '…' : '')} />
                  </div>
                </div>
              ))}
            </div>
          </div>
          {/* Variables */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-slate-500">Zmienne</span>
              <button onClick={() => setVariables(v => [...v, { key: '', label: '', source: 'manual', type: 'text' }])}
                className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                <Plus className="w-3 h-3" /> Dodaj zmienną
              </button>
            </div>
            {variables.length > 0 && (
              <div className="space-y-2">
                {variables.map((vr, i) => (
                  <div key={i} className="grid grid-cols-4 gap-2 items-center">
                    <input className="border border-slate-200 rounded px-2 py-1 text-xs font-mono"
                      placeholder="klucz" value={vr.key} onChange={e => updateVar(i, 'key', e.target.value)} />
                    <input className="border border-slate-200 rounded px-2 py-1 text-xs"
                      placeholder="etykieta" value={vr.label} onChange={e => updateVar(i, 'label', e.target.value)} />
                    <select className="border border-slate-200 rounded px-2 py-1 text-xs"
                      value={vr.source} onChange={e => updateVar(i, 'source', e.target.value as any)}>
                      <option value="manual">Ręcznie</option>
                      <option value="contractors">Kontrahent</option>
                      <option value="projects">Projekt</option>
                      <option value="companies">Firma</option>
                      <option value="employees">Pracownik</option>
                    </select>
                    <div className="flex items-center gap-1">
                      <select className="flex-1 border border-slate-200 rounded px-2 py-1 text-xs"
                        value={vr.type} onChange={e => updateVar(i, 'type', e.target.value as any)}>
                        <option value="text">Tekst</option>
                        <option value="date">Data</option>
                        <option value="number">Liczba</option>
                      </select>
                      <button onClick={() => setVariables(v => v.filter((_, idx) => idx !== i))}
                        className="text-red-400 hover:text-red-600"><X className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {err && <p className="text-red-600 text-sm">{err}</p>}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">Anuluj</button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60 flex items-center gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Zapisz
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Document Create Wizard ────────────────────────────────────────────────────

const DocumentWizard = ({
  companyId, userId, templates, contractors, projects, onClose, onSaved,
}: {
  companyId: string; userId: string;
  templates: DocumentTemplate[];
  contractors: any[]; projects: any[];
  onClose: () => void; onSaved: () => void;
}) => {
  const [step, setStep] = useState(1);
  const [templateId, setTemplateId] = useState('');
  const [contractorId, setContractorId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState('');
  const [saving, setSaving] = useState(false);
  const [stepLoading, setStepLoading] = useState(false);
  const [err, setErr] = useState('');

  const tpl = templates.find(t => t.id === templateId);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, []);

  // Step 1 → 2 or 3 (auto-skip if all vars are autofill)
  const handleStep1Next = async () => {
    if (!tpl) return;
    setStepLoading(true);
    try {
      const autofill = await getAutofillData(companyId, contractorId || undefined, projectId || undefined);
      const filled = applyAutofill(tpl.variables, autofill);
      setFormData(filled);
      // Auto-skip variables step if all variables are autofilled
      if (tpl.variables.length > 0 && tpl.variables.every(v => v.source !== 'manual')) {
        setPreview(renderTemplate(tpl, filled));
        setStep(3);
      } else {
        setStep(2);
      }
    } finally {
      setStepLoading(false);
    }
  };

  // Step 2 → 3
  const handleStep2Next = () => {
    if (!tpl) return;
    setStepLoading(true);
    setPreview(renderTemplate(tpl, formData));
    setStep(3);
    setStepLoading(false);
  };

  const save = async (status: 'draft' | 'completed') => {
    if (!tpl) return;
    setSaving(true); setErr('');
    try {
      const docName = formData['contract_name'] || formData['document_name'] || `${TYPE_LABELS[tpl.type]} — ${tpl.name}`;
      const number = await generateDocumentNumber(companyId, tpl.type, projectId || undefined);
      const inp: CreateDocumentInput = {
        company_id: companyId, template_id: templateId, created_by: userId,
        name: docName, status, data: formData,
        number,
        contractor_id: contractorId || undefined,
        project_id: projectId || undefined,
      };
      await createDocument(inp);
      onSaved();
    } catch (e: any) { setErr(e.message ?? 'Wystąpił błąd podczas zapisu. Spróbuj ponownie.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto" role="dialog" aria-modal="true">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-xl my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-slate-800">Nowy dokument</h2>
            <p className="text-xs text-slate-400">Krok {step} z 3</p>
            {/* Progress bar */}
            <div className="flex gap-1.5 mt-2">
              {[1, 2, 3].map(n => (
                <div key={n} className={`h-1.5 flex-1 rounded-full transition-colors ${n < step ? 'bg-blue-600' : n === step ? 'bg-blue-400' : 'bg-slate-200'}`} />
              ))}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 ml-4" aria-label="Zamknij" title="Zamknij"><X className="w-5 h-5" /></button>
        </div>
        {/* Steps */}
        <div className="px-6 py-4 min-h-[200px]">
          {/* Step 1: select template + contractor + project */}
          {step === 1 && (
            <div className="space-y-4">
              {templates.filter(t => t.is_active).length === 0 && (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  Brak aktywnych szablonów. Najpierw utwórz szablon w zakładce <strong>Szablony</strong>.
                </p>
              )}
              <div>
                <p className="text-sm font-medium text-slate-700 mb-2">Wybierz szablon</p>
                <select className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  value={templateId} onChange={e => setTemplateId(e.target.value)}>
                  <option value="">-- wybierz szablon --</option>
                  {templates.filter(t => t.is_active).map(t => (
                    <option key={t.id} value={t.id}>{t.name} ({TYPE_LABELS[t.type]})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Kontrahent</label>
                <select className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  value={contractorId} onChange={e => setContractorId(e.target.value)}>
                  <option value="">-- brak --</option>
                  {contractors.map(c => <option key={c.id} value={c.id}>{c.name ?? c.company_name ?? c.id}</option>)}
                </select>
                {contractorId && (() => {
                  const c = contractors.find(x => x.id === contractorId);
                  return c ? (
                    <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-slate-600 space-y-0.5">
                      <p className="font-medium text-blue-700">Dane kontrahenta</p>
                      {c.company_name && <p>Firma: {c.company_name}</p>}
                      {c.nip && <p>NIP: {c.nip}</p>}
                      {c.address && <p>Adres: {c.address}</p>}
                    </div>
                  ) : null;
                })()}
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Projekt</label>
                <select className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  value={projectId} onChange={e => setProjectId(e.target.value)}>
                  <option value="">-- brak --</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name ?? p.id}</option>)}
                </select>
              </div>
            </div>
          )}
          {/* Step 2: fill variables */}
          {step === 2 && tpl && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-slate-700">Uzupełnij zmienne</p>
              {tpl.variables.length === 0 && <p className="text-sm text-slate-400">Brak zmiennych w szablonie.</p>}
              {tpl.variables.map(v => (
                <div key={v.key}>
                  <label className="block text-xs text-slate-500 mb-1">
                    {v.label || v.key}
                    {v.source !== 'manual' && <span className="ml-1 text-blue-500">(autouzupełnione)</span>}
                  </label>
                  <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                    type={v.type === 'date' ? 'date' : v.type === 'number' ? 'number' : 'text'}
                    value={formData[v.key] ?? ''}
                    onChange={e => setFormData(d => ({ ...d, [v.key]: e.target.value }))}
                    placeholder={v.defaultValue ?? v.label} />
                </div>
              ))}
            </div>
          )}
          {/* Step 3: preview */}
          {step === 3 && (
            <div>
              {tpl && (
                <div className="mb-3 text-sm text-slate-500 space-y-0.5">
                  <p><span className="font-medium text-slate-700">Szablon:</span> {tpl.name}</p>
                  {contractorId && (() => {
                    const c = contractors.find(x => x.id === contractorId);
                    return c ? <p><span className="font-medium text-slate-700">Kontrahent:</span> {c.name ?? c.company_name}</p> : null;
                  })()}
                </div>
              )}
              <p className="text-sm font-medium text-slate-700 mb-3">Podgląd dokumentu</p>
              <div className="border border-slate-200 rounded-lg p-4 text-sm text-slate-700 max-h-[480px] overflow-y-auto prose prose-sm"
                dangerouslySetInnerHTML={{ __html: preview }} />
            </div>
          )}
          {err && <p className="text-red-600 text-sm mt-2">{err}</p>}
        </div>
        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t">
          <button onClick={() => setStep(s => s - 1)} disabled={step === 1}
            className="flex items-center gap-1 text-sm text-slate-600 hover:text-slate-800 disabled:opacity-30">
            <ChevronLeft className="w-4 h-4" /> Wstecz
          </button>
          <div className="flex gap-2">
            {step === 3 && (
              <>
                <button onClick={() => save('draft')} disabled={saving}
                  className="px-3 py-2 text-sm border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin inline" /> : null} Zapisz jako szkic
                </button>
                <button onClick={() => save('completed')} disabled={saving}
                  className="px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 flex items-center gap-1">
                  <Check className="w-4 h-4" /> Zatwierdź
                </button>
              </>
            )}
            {step < 3 && (
              <button
                onClick={() => {
                  if (step === 1 && !templateId) { setErr('Wybierz szablon'); return; }
                  setErr('');
                  if (step === 1) { handleStep1Next(); return; }
                  if (step === 2) { handleStep2Next(); return; }
                }}
                disabled={stepLoading || (step === 1 && !templateId) || (step === 2 && !!tpl && tpl.variables.some(v => v.source === 'manual' && !formData[v.key]))}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60">
                {stepLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Dalej <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Document View Modal ───────────────────────────────────────────────────────

const DocumentView = ({ docId, onClose, onRefresh }: { docId: string; onClose: () => void; onRefresh: () => void }) => {
  const [doc, setDoc] = useState<DocumentRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewError, setViewError] = useState<string | null>(null);

  useEffect(() => {
    fetchDocument(docId)
      .then(d => { setDoc(d); setLoading(false); })
      .catch(() => { setViewError('Nie udało się załadować dokumentu'); setLoading(false); });
  }, [docId]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, []);

  const archive = async () => {
    if (!doc) return;
    try {
      await updateDocument(doc.id, { status: 'archived' });
      onRefresh(); onClose();
    } catch {
      setViewError('Nie udało się zarchiwizować dokumentu');
    }
  };

  const [pdfLoading, setPdfLoading] = useState(false);

  const handleDownloadPDF = async (id: string) => {
    try {
      setPdfLoading(true);
      const url = await generatePDF(id);
      window.open(url, '_blank');
    } catch {
      setViewError('Nie udało się wygenerować PDF');
    } finally {
      setPdfLoading(false);
    }
  };

  const renderedHtml = doc?.document_templates
    ? renderTemplate(doc.document_templates as DocumentTemplate, doc.data)
    : '';

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto" role="dialog" aria-modal="true">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl my-8">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">{doc?.name ?? '...'}</h2>
            {doc && <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[doc.status]}`}>{STATUS_LABELS[doc.status]}</span>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Zamknij" title="Zamknij"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-6 py-4">
          {viewError && (
            <div className="mb-3 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg flex items-center justify-between">
              <span>{viewError}</span>
              <button onClick={() => setViewError(null)} className="text-red-500 hover:text-red-700"><X className="w-4 h-4" /></button>
            </div>
          )}
          {loading ? <Spinner /> : (
            <div className="border border-slate-200 rounded-lg p-4 prose prose-sm max-h-96 overflow-y-auto text-slate-700"
              dangerouslySetInnerHTML={{ __html: renderedHtml }} />
          )}
        </div>
        <div className="flex justify-between px-6 py-4 border-t">
          <button
            onClick={() => doc && handleDownloadPDF(doc.id)}
            disabled={pdfLoading || !doc}
            aria-label="Pobierz PDF" title="Pobierz PDF"
            className="flex items-center gap-2 px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed">
            {pdfLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Pobierz PDF
          </button>
          {doc?.status !== 'archived' && (
            <button onClick={archive}
              className="flex items-center gap-2 px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">
              <Archive className="w-4 h-4" /> Archiwizuj
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Settings Tab ─────────────────────────────────────────────────────────────

const DOC_TYPE_LABELS: Record<DocumentTemplateType, string> = {
  contract: 'Umowa',
  protocol: 'Protokół',
  annex: 'Aneks',
  other: 'Inne',
};

const DEFAULT_NUMBERING: Record<DocumentTemplateType, NumberingConfig> = {
  contract:  { prefix: 'CON', separator: '/', digits: 3, reset: 'yearly', includeProjectCode: false, includeMonth: false },
  protocol:  { prefix: 'PRO', separator: '/', digits: 3, reset: 'yearly', includeProjectCode: false, includeMonth: false },
  annex:     { prefix: 'ANX', separator: '/', digits: 3, reset: 'yearly', includeProjectCode: false, includeMonth: false },
  other:     { prefix: 'DOC', separator: '/', digits: 3, reset: 'yearly', includeProjectCode: false, includeMonth: false },
};

const buildPreview = (cfg: NumberingConfig): string => {
  const num = '1'.padStart(cfg.digits, '0');
  const parts: string[] = [cfg.prefix];
  if (cfg.includeProjectCode) {
    parts.push('ZD-II'); // пример кода объекта (уже содержит год)
    if (cfg.includeMonth) parts.push('03');
  } else {
    parts.push('2026');
    if (cfg.includeMonth) parts.push('03');
  }
  parts.push(num);
  return parts.join(cfg.separator);
};

const SettingsTab = ({ companyId }: { companyId: string }) => {
  const [numbering, setNumbering] = useState<Record<DocumentTemplateType, NumberingConfig>>(DEFAULT_NUMBERING);
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [success,   setSuccess]   = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) return;
    fetchDocumentSettings(companyId)
      .then(data => {
        if (data?.numbering_config) setNumbering({ ...DEFAULT_NUMBERING, ...data.numbering_config });
      })
      .catch(() => { /* use defaults silently */ })
      .finally(() => setLoading(false));
  }, [companyId]);

  const updateField = (
    type: DocumentTemplateType,
    field: keyof NumberingConfig,
    value: string | number | boolean,
  ) => {
    setNumbering(prev => ({
      ...prev,
      [type]: { ...prev[type], [field]: value },
    }));
  };

  const handleSave = async () => {
    setSaving(true); setSettingsError(null);
    try {
      await updateDocumentSettings(companyId, numbering as unknown as NumberingConfig);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e: any) {
      setSettingsError(e.message ?? 'Wystąpił błąd podczas zapisu ustawień. Spróbuj ponownie.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spinner />;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-lg font-semibold text-slate-800">Numeracja dokumentów</h2>
        <p className="text-sm text-slate-500 mt-0.5">Skonfiguruj format numerów dla każdego typu dokumentu.</p>
      </div>

      {success && (
        <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">
          <Check className="w-4 h-4 flex-shrink-0" />
          Ustawienia zapisane
        </div>
      )}
      {settingsError && (
        <div className="flex items-center justify-between p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          <span>{settingsError}</span>
          <button onClick={() => setSettingsError(null)} className="text-red-500 hover:text-red-700"><X className="w-4 h-4" /></button>
        </div>
      )}

      <div className="space-y-4">
        {(Object.keys(DOC_TYPE_LABELS) as DocumentTemplateType[]).map(type => {
          const cfg = numbering[type];
          return (
            <div key={type} className="border border-slate-200 rounded-xl p-4 space-y-3 bg-white">
              {/* Row header */}
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-700">{DOC_TYPE_LABELS[type]}</span>
                <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full font-mono">
                  {buildPreview(cfg)}
                </span>
              </div>

              {/* Fields — grid on desktop, stack on mobile */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {/* Prefiks */}
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Prefiks</label>
                  <input
                    type="text"
                    minLength={2} maxLength={5}
                    value={cfg.prefix}
                    onChange={e => updateField(type, 'prefix', e.target.value.toUpperCase())}
                    placeholder="np. CON"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-blue-200"
                  />
                </div>

                {/* Separator */}
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Separator</label>
                  <select
                    value={cfg.separator}
                    onChange={e => updateField(type, 'separator', e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                  >
                    <option value="/">/</option>
                    <option value="-">-</option>
                  </select>
                </div>

                {/* Ilość cyfr */}
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Ilość cyfr</label>
                  <input
                    type="number"
                    min={1} max={5}
                    value={cfg.digits}
                    onChange={e => updateField(type, 'digits', Math.min(5, Math.max(1, Number(e.target.value))))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                  />
                </div>

                {/* Reset */}
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Reset</label>
                  <select
                    value={cfg.reset}
                    onChange={e => updateField(type, 'reset', e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                  >
                    <option value="yearly">co roku</option>
                    <option value="monthly">co miesiąc</option>
                    <option value="never">nigdy</option>
                  </select>
                </div>
              </div>

              {/* Include month checkbox */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id={`${type}-month`}
                  checked={cfg.includeMonth || false}
                  onChange={e => updateField(type, 'includeMonth', e.target.checked)}
                  className="rounded border-slate-300 text-blue-600"
                />
                <label htmlFor={`${type}-month`} className="text-xs text-slate-500">Dołącz miesiąc</label>
              </div>

              {/* Include project code checkbox */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id={`${type}-project`}
                  checked={cfg.includeProjectCode || false}
                  onChange={e => updateField(type, 'includeProjectCode', e.target.checked)}
                  className="rounded border-slate-300 text-blue-600"
                />
                <label htmlFor={`${type}-project`} className="text-xs text-slate-500">Dołącz kod obiektu</label>
              </div>

              {/* Preview */}
              <p className="text-xs text-slate-400">
                Podgląd: <span className="font-mono text-slate-600">{buildPreview(cfg)}</span>
              </p>
            </div>
          );
        })}
      </div>

      <div className="pt-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Zapisz ustawienia
        </button>
      </div>
    </div>
  );
};

// ── Error Boundary ───────────────────────────────────────────────────────────

class DocumentsErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: string }> {
  constructor(props: any) { super(props); this.state = { hasError: false, error: '' }; }
  static getDerivedStateFromError(error: Error) { return { hasError: true, error: error.message }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center py-20 text-slate-500">
          <p className="text-lg font-medium mb-2">Coś poszło nie tak</p>
          <p className="text-sm mb-4">{this.state.error}</p>
          <button onClick={() => this.setState({ hasError: false, error: '' })}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Spróbuj ponownie</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function Toast({ message, type = 'success', onClose }: { message: string; type?: 'success'|'error'|'info'; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t); }, [onClose]);
  const colors = { success: 'bg-green-500', error: 'bg-red-500', info: 'bg-blue-500' };
  return (
    <div className={`fixed bottom-4 right-4 z-[60] px-4 py-3 rounded-lg text-white text-sm shadow-lg ${colors[type]} animate-slide-up`}>
      {message}
    </div>
  );
}

// ── Document Details Panel ────────────────────────────────────────────────────

function DocumentDetailsPanel({ doc, companyId, userId, onClose, onToast }: {
  doc: DocumentRecord; companyId: string; userId: string; onClose: () => void;
  onToast: (t: { message: string; type: 'success'|'error'|'info' }) => void;
}) {
  const [detailTab, setDetailTab] = useState<'versions'|'signatures'|'comments'|'ai'|'audit'|'links'>('versions');
  const [versions, setVersions] = useState<any[]>([]);
  const [signatures, setSignatures] = useState<any[]>([]);
  const [auditLog, setAuditLog] = useState<any[]>([]);
  const [publicLinks, setPublicLinks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [comments, setComments] = useState<any[]>([]);
  const [analyses, setAnalyses] = useState<any[]>([]);
  const [newComment, setNewComment] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<string | null>(null);

  useEffect(() => { loadData(); }, [detailTab, doc.id]);

  async function loadData() {
    setLoading(true);
    try {
      if (detailTab === 'versions') setVersions(await getDocumentVersions(doc.id));
      else if (detailTab === 'signatures') setSignatures(await getSignatureRequests(doc.id));
      else if (detailTab === 'audit') setAuditLog(await getDocumentAuditLog(doc.id));
      else if (detailTab === 'links') setPublicLinks(await getPublicLinks(doc.id));
      else if (detailTab === 'comments') setComments(await getDocumentComments(doc.id));
      else if (detailTab === 'ai') setAnalyses(await getDocumentAnalyses(doc.id));
    } finally { setLoading(false); }
  }

  const tabs = [
    { key: 'versions' as const, label: 'Wersje', icon: '📋' },
    { key: 'signatures' as const, label: 'Podpisy', icon: '✍️' },
    { key: 'comments' as const, label: 'Komentarze', icon: '💬' },
    { key: 'ai' as const, label: 'AI', icon: '🤖' },
    { key: 'audit' as const, label: 'Historia', icon: '📜' },
    { key: 'links' as const, label: 'Linki', icon: '🔗' },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h3 className="font-semibold text-lg">{doc.name}</h3>
            <p className="text-xs text-slate-500">{doc.number} · v{doc.current_version || 1}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={async () => {
              try {
                const url = await generatePDF(doc.id, doc.company_id);
                window.open(url, '_blank');
                await logDocumentEvent(doc.id, 'pdf_downloaded');
              } catch (err: any) {
                onToast({ message: 'Błąd generowania PDF: ' + err.message, type: 'error' });
              }
            }} className="text-xs px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg" aria-label="Pobierz PDF">
              📄 PDF
            </button>
            <button onClick={async () => {
              const link = await createPublicLink(doc.id, companyId, userId, { expiresInDays: 7 });
              navigator.clipboard.writeText(link.url);
              onToast({ message: 'Link skopiowany do schowka', type: 'success' });
            }} className="text-xs px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg" aria-label="Udostępnij">
              🔗 Udostępnij
            </button>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg" aria-label="Zamknij">✕</button>
          </div>
        </div>

        <div className="flex border-b px-4 gap-1">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setDetailTab(t.key)}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                detailTab === t.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="animate-spin h-6 w-6 text-blue-500" />
            </div>
          ) : detailTab === 'versions' ? (
            <div className="space-y-3">
              {versions.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">Brak wersji</p>
              ) : versions.map(v => (
                <div key={v.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                  <div>
                    <p className="text-sm font-medium">Wersja {v.version_number}</p>
                    <p className="text-xs text-slate-500">{new Date(v.created_at).toLocaleString('pl-PL')}</p>
                    {v.change_summary && <p className="text-xs text-slate-400 mt-0.5">{v.change_summary}</p>}
                  </div>
                  <button onClick={async () => {
                    if (confirm(`Przywrócić wersję ${v.version_number}?`)) {
                      await restoreDocumentVersion(doc.id, v.version_number, userId);
                      loadData();
                    }
                  }} className="text-xs text-blue-600 hover:underline">Przywróć</button>
                </div>
              ))}
            </div>
          ) : detailTab === 'signatures' ? (
            <div className="space-y-3">
              <div className="mb-4 p-3 bg-blue-50 rounded-lg space-y-2">
                <p className="text-sm font-medium text-blue-700">Wyślij zapytanie o podpis</p>
                <div className="flex gap-2">
                  <input type="text" placeholder="Imię i nazwisko" id="signer-name"
                    className="flex-1 px-3 py-1.5 text-sm border rounded-lg" />
                  <input type="email" placeholder="Email" id="signer-email"
                    className="flex-1 px-3 py-1.5 text-sm border rounded-lg" />
                  <button onClick={async () => {
                    const nameEl = document.getElementById('signer-name') as HTMLInputElement;
                    const emailEl = document.getElementById('signer-email') as HTMLInputElement;
                    if (!nameEl.value || !emailEl.value) return;
                    await createSignatureRequest(doc.id, companyId, userId, [
                      { name: nameEl.value, email: emailEl.value }
                    ]);
                    nameEl.value = ''; emailEl.value = '';
                    loadData();
                  }} className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
                    Wyślij
                  </button>
                </div>
              </div>
              {signatures.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">Brak zapytań o podpis</p>
              ) : signatures.map(s => (
                <div key={s.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                  <div>
                    <p className="text-sm font-medium">{s.signer_name}</p>
                    <p className="text-xs text-slate-500">{s.signer_email}</p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    s.status === 'signed' ? 'bg-green-100 text-green-700' :
                    s.status === 'declined' ? 'bg-red-100 text-red-700' :
                    s.status === 'expired' ? 'bg-slate-100 text-slate-500' :
                    'bg-yellow-100 text-yellow-700'
                  }`}>{s.status === 'signed' ? 'Podpisano' : s.status === 'declined' ? 'Odrzucono' : s.status === 'expired' ? 'Wygasło' : 'Oczekuje'}</span>
                </div>
              ))}
            </div>
          ) : detailTab === 'audit' ? (
            <div className="space-y-2">
              {auditLog.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">Brak historii</p>
              ) : auditLog.map(a => (
                <div key={a.id} className="flex items-start gap-3 p-2 text-xs">
                  <span className="text-slate-400 whitespace-nowrap">{new Date(a.created_at).toLocaleString('pl-PL')}</span>
                  <span className="text-slate-600">{a.actor_name || 'System'}</span>
                  <span className="text-slate-800 font-medium">{a.action.replace(/_/g, ' ')}</span>
                </div>
              ))}
            </div>
          ) : detailTab === 'comments' ? (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input type="text" value={newComment} onChange={e => setNewComment(e.target.value)}
                  placeholder="Napisz komentarz..." className="flex-1 px-3 py-2 text-sm border rounded-lg"
                  onKeyDown={e => { if (e.key === 'Enter' && newComment.trim()) {
                    addDocumentComment(doc.id, companyId, userId, 'Admin', newComment.trim())
                      .then(() => { setNewComment(''); loadData(); });
                  }}} />
                <button onClick={async () => {
                  if (!newComment.trim()) return;
                  await addDocumentComment(doc.id, companyId, userId, 'Admin', newComment.trim());
                  setNewComment(''); loadData();
                }} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">Wyślij</button>
              </div>
              {comments.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">Brak komentarzy</p>
              ) : comments.map(c => (
                <div key={c.id} className={`p-3 rounded-lg ${c.resolved ? 'bg-green-50 opacity-60' : 'bg-slate-50'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium">{c.author_name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">{new Date(c.created_at).toLocaleString('pl-PL')}</span>
                      {!c.resolved && (
                        <button onClick={() => resolveComment(c.id, userId).then(() => loadData())}
                          className="text-xs text-green-600 hover:underline">✓ Rozwiąż</button>
                      )}
                    </div>
                  </div>
                  <p className="text-sm text-slate-600">{c.content}</p>
                  {c.resolved && <p className="text-xs text-green-600 mt-1">✓ Rozwiązano</p>}
                </div>
              ))}
            </div>
          ) : detailTab === 'ai' ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                {[
                  { type: 'review', label: 'Przegląd dokumentu', icon: '🔍' },
                  { type: 'risk', label: 'Analiza ryzyk', icon: '⚠️' },
                  { type: 'summary', label: 'Podsumowanie', icon: '📝' },
                  { type: 'clause_check', label: 'Sprawdzenie klauzul', icon: '⚖️' },
                ].map(a => (
                  <button key={a.type} onClick={async () => {
                    setAiLoading(true); setAiResult(null);
                    try {
                      const res = await analyzeDocument(doc.id, companyId, a.type, doc.data || {}, doc.name);
                      setAiResult(res.result?.text || 'Brak wyniku');
                      loadData();
                    } catch (err: any) { setAiResult('Błąd: ' + err.message); }
                    finally { setAiLoading(false); }
                  }} disabled={aiLoading}
                    className="p-3 text-left bg-slate-50 hover:bg-blue-50 rounded-lg border hover:border-blue-200 transition-colors disabled:opacity-50">
                    <span className="text-lg">{a.icon}</span>
                    <p className="text-sm font-medium mt-1">{a.label}</p>
                  </button>
                ))}
              </div>
              {aiLoading && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="animate-spin h-6 w-6 text-blue-500 mr-2" />
                  <span className="text-sm text-slate-500">Analizuję dokument...</span>
                </div>
              )}
              {aiResult && (
                <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                  <p className="text-sm font-medium text-blue-700 mb-2">Wynik analizy AI</p>
                  <div className="text-sm text-slate-700 whitespace-pre-wrap">{aiResult}</div>
                </div>
              )}
              {analyses.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-medium text-slate-500 mb-2">Historia analiz</p>
                  {analyses.map(a => (
                    <div key={a.id} className="p-2 border-b text-xs flex justify-between">
                      <span>{a.analysis_type} — {new Date(a.created_at).toLocaleString('pl-PL')}</span>
                      <button onClick={() => setAiResult(a.result?.text)} className="text-blue-600 hover:underline">Pokaż</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <button onClick={async () => {
                const link = await createPublicLink(doc.id, companyId, userId, { expiresInDays: 7 });
                await loadData();
                navigator.clipboard.writeText(link.url);
                onToast({ message: 'Link skopiowany do schowka', type: 'success' });
              }} className="text-sm text-blue-600 hover:underline mb-3">+ Utwórz nowy link (7 dni)</button>
              {publicLinks.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">Brak linków publicznych</p>
              ) : publicLinks.map(l => (
                <div key={l.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                  <div>
                    <p className="text-xs font-mono text-slate-600 truncate max-w-[300px]">{l.token}</p>
                    <p className="text-xs text-slate-400">
                      {l.expires_at ? `Wygasa: ${new Date(l.expires_at).toLocaleDateString('pl-PL')}` : 'Bez limitu czasu'}
                      {l.max_views ? ` · ${l.current_views}/${l.max_views} wyświetleń` : ''}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <span className={`text-xs px-2 py-1 rounded-full ${l.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                      {l.is_active ? 'Aktywny' : 'Nieaktywny'}
                    </span>
                    {l.is_active && (
                      <button onClick={async () => { await deactivatePublicLink(l.id); loadData(); }}
                        className="text-xs text-red-500 hover:underline">Dezaktywuj</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export const DMSPage: React.FC = () => {
  const { state } = useAppContext();
  const companyId = state.currentUser?.company_id ?? '';
  const userId = state.currentUser?.id ?? '';

  const [tab, setTab] = useState<'templates' | 'documents' | 'settings'>('documents');
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success'|'error'|'info' } | null>(null);

  // Templates state
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [tplLoading, setTplLoading] = useState(true);
  const [tplSearch, setTplSearch] = useState('');
  const [tplTypeFilter, setTplTypeFilter] = useState<DocumentTemplateType | ''>('');
  const [showTplModal, setShowTplModal] = useState(false);
  const [editingTpl, setEditingTpl] = useState<DocumentTemplate | undefined>();

  // Documents state
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [docLoading, setDocLoading] = useState(true);
  const [docSearch, setDocSearch] = useState('');
  const [docStatus, setDocStatus] = useState<DocumentStatus | ''>('');
  const [showDocWizard, setShowDocWizard] = useState(false);
  const [viewDocId, setViewDocId] = useState<string | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<DocumentRecord | null>(null);
  const [stats, setStats] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [sortField, setSortField] = useState<'name'|'created_at'|'number'>('created_at');
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('desc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  // Shared
  const [contractors, setContractors] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);

  const loadTemplates = useCallback(async () => {
    if (!companyId) return;
    setTplLoading(true);
    try {
      const data = await fetchTemplates(companyId, tplTypeFilter || undefined);
      setTemplates(data);
    } catch {
      setError('Nie udało się załadować danych');
    } finally { setTplLoading(false); }
  }, [companyId, tplTypeFilter]);

  const loadDocuments = useCallback(async () => {
    if (!companyId) return;
    setDocLoading(true);
    try {
      const data = await fetchDocuments(companyId, { status: docStatus || undefined });
      setDocuments(data);
    } catch {
      setError('Nie udało się załadować danych');
    } finally { setDocLoading(false); }
  }, [companyId, docStatus]);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);
  useEffect(() => { loadDocuments(); }, [loadDocuments]);
  useEffect(() => { if (companyId) getDocumentStats(companyId).then(setStats); }, [companyId, documents]);

  useEffect(() => {
    if (!companyId) return;
    supabase.from('contractor_clients').select('id,name,company_name').eq('company_id', companyId)
      .then(({ data }) => { if (data) setContractors(data); })
      .catch(() => setError('Nie udało się załadować kontrahentów'));
    supabase.from('projects').select('id,name').eq('company_id', companyId)
      .then(({ data }) => { if (data) setProjects(data); })
      .catch(() => setError('Nie udało się załadować projektów'));
  }, [companyId]);

  const deleteTpl = async (id: string) => {
    if (!confirm('Usunąć szablon?')) return;
    try {
      await deleteTemplate(id);
      loadTemplates();
    } catch {
      setError('Nie udało się usunąć szablonu');
    }
  };

  const filteredTemplates = templates.filter(t =>
    t.name.toLowerCase().includes(tplSearch.toLowerCase())
  );
  const filteredDocuments = useMemo(() => {
    let result = documents;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(d => d.name.toLowerCase().includes(q) || (d.number || '').toLowerCase().includes(q));
    }
    if (filterType !== 'all') {
      result = result.filter(d => d.document_templates?.type === filterType);
    }
    if (filterStatus !== 'all') {
      result = result.filter(d => d.status === filterStatus);
    }
    return [...result].sort((a, b) => {
      const aVal = a[sortField] || '';
      const bVal = b[sortField] || '';
      return sortDir === 'asc' ? String(aVal).localeCompare(String(bVal)) : String(bVal).localeCompare(String(aVal));
    });
  }, [documents, searchQuery, filterType, filterStatus, sortField, sortDir]);

  const totalPages = Math.ceil(filteredDocuments.length / PAGE_SIZE);
  const paginatedDocuments = filteredDocuments.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <DocumentsErrorBoundary>
    <div className="p-4 sm:p-6 space-y-6 font-[Inter,sans-serif]">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Dokumenty</h1>
          <p className="text-sm text-slate-500 mt-0.5">Szablony i dokumenty firmowe</p>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-full sm:w-fit overflow-x-auto">
        {([['documents', 'Dokumenty'], ['templates', 'Szablony'], ['settings', 'Ustawienia']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === key ? 'bg-white shadow text-blue-600' : 'text-slate-500 hover:text-slate-700'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── TEMPLATES TAB ── */}
      {tab === 'templates' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm"
                placeholder="Szukaj szablonu…" value={tplSearch} onChange={e => setTplSearch(e.target.value)} />
            </div>
            <select className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
              value={tplTypeFilter} onChange={e => setTplTypeFilter(e.target.value as any)}>
              <option value="">Wszystkie typy</option>
              {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <button onClick={() => { setEditingTpl(undefined); setShowTplModal(true); }}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 whitespace-nowrap">
              <Plus className="w-4 h-4" /> Nowy szablon
            </button>
          </div>

          {tplLoading ? <Spinner /> : filteredTemplates.length === 0 ? <Empty label="Brak szablonów" action={{ text: 'Utwórz pierwszy szablon', onClick: () => setShowTplModal(true) }} /> : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                  <tr>
                    <th className="text-left px-4 py-3">Nazwa</th>
                    <th className="text-left px-4 py-3 hidden sm:table-cell">Typ</th>
                    <th className="text-left px-4 py-3 hidden md:table-cell">Opis</th>
                    <th className="text-left px-4 py-3 hidden lg:table-cell">Data</th>
                    <th className="text-left px-4 py-3">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredTemplates.map(t => (
                    <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-800">{t.name}</td>
                      <td className="px-4 py-3 hidden sm:table-cell text-slate-500">{TYPE_LABELS[t.type]}</td>
                      <td className="px-4 py-3 hidden md:table-cell text-slate-500 max-w-xs truncate">{t.description ?? '—'}</td>
                      <td className="px-4 py-3 hidden lg:table-cell text-slate-400">{fmt(t.created_at)}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${t.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                          {t.is_active ? 'Aktywny' : 'Nieaktywny'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          <button onClick={() => { setEditingTpl(t); setShowTplModal(true); }}
                            aria-label="Edytuj szablon" title="Edytuj szablon"
                            className="p-1.5 text-slate-400 hover:text-blue-600 rounded hover:bg-blue-50 transition-colors">
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button onClick={() => deleteTpl(t.id)}
                            aria-label="Usuń szablon" title="Usuń szablon"
                            className="p-1.5 text-slate-400 hover:text-red-600 rounded hover:bg-red-50 transition-colors">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── DOCUMENTS TAB ── */}
      {tab === 'documents' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setShowDocWizard(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 whitespace-nowrap">
              <Plus className="w-4 h-4" /> Nowy dokument
            </button>
          </div>

          {stats && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
              {[
                { label: 'Wszystkie', value: stats.total, color: 'bg-blue-50 text-blue-700' },
                { label: 'Szkice', value: stats.drafts, color: 'bg-yellow-50 text-yellow-700' },
                { label: 'Gotowe', value: stats.completed, color: 'bg-green-50 text-green-700' },
                { label: 'Archiwum', value: stats.archived, color: 'bg-slate-50 text-slate-500' },
                { label: 'Do podpisu', value: stats.pendingSignatures, color: 'bg-orange-50 text-orange-700' },
                { label: 'Ten miesiąc', value: stats.thisMonth, color: 'bg-purple-50 text-purple-700' },
              ].map(s => (
                <div key={s.label} className={`p-3 rounded-lg ${s.color}`}>
                  <p className="text-2xl font-bold">{s.value}</p>
                  <p className="text-xs">{s.label}</p>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2 mb-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input type="text" value={searchQuery} onChange={e => { setSearchQuery(e.target.value); setPage(1); }}
                placeholder="Szukaj dokumentu..." className="w-full pl-10 pr-3 py-2 text-sm border rounded-lg" />
            </div>
            <select value={filterType} onChange={e => { setFilterType(e.target.value); setPage(1); }}
              className="px-3 py-2 text-sm border rounded-lg bg-white">
              <option value="all">Wszystkie typy</option>
              <option value="contract">Umowy</option>
              <option value="protocol">Protokoły</option>
              <option value="annex">Aneksy</option>
              <option value="other">Inne</option>
            </select>
            <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1); }}
              className="px-3 py-2 text-sm border rounded-lg bg-white">
              <option value="all">Wszystkie statusy</option>
              <option value="draft">Szkice</option>
              <option value="completed">Gotowe</option>
              <option value="archived">Archiwum</option>
            </select>
            <button onClick={() => {
              const csv = exportDocumentsCSV(filteredDocuments);
              downloadCSV(csv, `dokumenty-${new Date().toISOString().slice(0,10)}.csv`);
            }} className="px-3 py-2 text-sm border rounded-lg hover:bg-slate-50" aria-label="Eksport CSV">
              📥 CSV
            </button>
          </div>

          {docLoading ? (
            <div className="space-y-3">
              {[1,2,3,4,5].map(i => (
                <div key={i} className="h-14 bg-slate-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : filteredDocuments.length === 0 ? <Empty label="Brak dokumentów" /> : (
            <>
            {selectedIds.size > 0 && (
              <div className="flex items-center gap-3 mb-3 p-3 bg-blue-50 rounded-lg">
                <span className="text-sm font-medium text-blue-700">Zaznaczono: {selectedIds.size}</span>
                <button onClick={async () => {
                  const count = selectedIds.size;
                  for (const id of selectedIds) {
                    await supabase.from('documents').update({ status: 'archived' }).eq('id', id);
                  }
                  setSelectedIds(new Set()); loadDocuments();
                  setToast({ message: `Zarchiwizowano ${count} dokumentów`, type: 'success' });
                }} className="text-xs px-3 py-1.5 bg-slate-600 text-white rounded-lg hover:bg-slate-700">
                  📦 Archiwizuj
                </button>
                <button onClick={() => setSelectedIds(new Set())} className="text-xs text-slate-500 hover:underline">Anuluj</button>
              </div>
            )}
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                  <tr>
                    <th className="px-4 py-3 w-10">
                      <input type="checkbox" className="rounded border-slate-300"
                        checked={selectedIds.size === filteredDocuments.length && filteredDocuments.length > 0}
                        onChange={e => setSelectedIds(e.target.checked ? new Set(filteredDocuments.map(d => d.id)) : new Set())} />
                    </th>
                    <th className="px-4 py-3 hidden sm:table-cell cursor-pointer hover:text-blue-600 select-none" onClick={() => { setSortField('number'); setSortDir(d => d === 'asc' ? 'desc' : 'asc'); }}>
                      Nr {sortField === 'number' && (sortDir === 'asc' ? '↑' : '↓')}
                    </th>
                    <th className="px-4 py-3 cursor-pointer hover:text-blue-600 select-none" onClick={() => { setSortField('name'); setSortDir(d => d === 'asc' ? 'desc' : 'asc'); }}>
                      Nazwa {sortField === 'name' && (sortDir === 'asc' ? '↑' : '↓')}
                    </th>
                    <th className="text-left px-4 py-3 hidden md:table-cell">Szablon</th>
                    <th className="text-left px-4 py-3">Status</th>
                    <th className="px-4 py-3 hidden lg:table-cell cursor-pointer hover:text-blue-600 select-none" onClick={() => { setSortField('created_at'); setSortDir(d => d === 'asc' ? 'desc' : 'asc'); }}>
                      Data {sortField === 'created_at' && (sortDir === 'asc' ? '↑' : '↓')}
                    </th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paginatedDocuments.map(d => (
                    <tr key={d.id} className="hover:bg-slate-50 transition-colors cursor-pointer" onClick={() => setSelectedDoc(d)}>
                      <td className="px-4 py-3">
                        <input type="checkbox" className="rounded border-slate-300"
                          checked={selectedIds.has(d.id)}
                          onClick={e => e.stopPropagation()}
                          onChange={e => {
                            const next = new Set(selectedIds);
                            e.target.checked ? next.add(d.id) : next.delete(d.id);
                            setSelectedIds(next);
                          }} />
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell text-slate-400 font-mono text-xs">{d.number ?? '—'}</td>
                      <td className="px-4 py-3 font-medium text-slate-800 max-w-xs truncate">{d.name}</td>
                      <td className="px-4 py-3 hidden md:table-cell text-slate-500">
                        {d.document_templates ? `${d.document_templates.name} (${TYPE_LABELS[d.document_templates.type]})` : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[d.status]}`}>
                          {STATUS_LABELS[d.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell text-slate-400">{fmt(d.created_at)}</td>
                      <td className="px-4 py-3">
                        <button onClick={() => setViewDocId(d.id)}
                          aria-label="Podgląd dokumentu" title="Podgląd dokumentu"
                          className="p-1.5 text-slate-400 hover:text-blue-600 rounded hover:bg-blue-50 transition-colors">
                          <Eye className="w-4 h-4" />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); duplicateDocument(d.id, companyId, userId).then(() => loadDocuments()); }}
                          aria-label="Duplikuj dokument" title="Duplikuj"
                          className="p-1.5 text-slate-400 hover:text-green-600 rounded hover:bg-green-50 transition-colors">
                          <FileText className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t">
                <p className="text-xs text-slate-500">{filteredDocuments.length} dokumentów · Strona {page} z {totalPages}</p>
                <div className="flex gap-1">
                  <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1}
                    className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-30"><ChevronLeft className="w-4 h-4" /></button>
                  {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                    const p = totalPages <= 5 ? i + 1 : Math.min(Math.max(page - 2, 1), totalPages - 4) + i;
                    return (
                      <button key={p} onClick={() => setPage(p)}
                        className={`w-8 h-8 text-xs rounded ${p === page ? 'bg-blue-600 text-white' : 'hover:bg-slate-100'}`}>{p}</button>
                    );
                  })}
                  <button onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page === totalPages}
                    className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button>
                </div>
              </div>
            )}
            </>
          )}
        </div>
      )}

      {/* ── SETTINGS TAB ── */}
      {tab === 'settings' && (
        <SettingsTab companyId={companyId} />
      )}

      {/* Modals */}
      {showTplModal && (
        <TemplateModal
          companyId={companyId} userId={userId} existing={editingTpl}
          onClose={() => setShowTplModal(false)}
          onSaved={() => { setShowTplModal(false); loadTemplates(); }}
        />
      )}
      {showDocWizard && (
        <DocumentWizard
          companyId={companyId} userId={userId}
          templates={templates} contractors={contractors} projects={projects}
          onClose={() => setShowDocWizard(false)}
          onSaved={() => { setShowDocWizard(false); loadDocuments(); }}
        />
      )}
      {viewDocId && (
        <DocumentView
          docId={viewDocId}
          onClose={() => setViewDocId(null)}
          onRefresh={loadDocuments}
        />
      )}
      {selectedDoc && (
        <DocumentDetailsPanel
          doc={selectedDoc}
          companyId={companyId}
          userId={userId}
          onClose={() => setSelectedDoc(null)}
          onToast={setToast}
        />
      )}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
    </DocumentsErrorBoundary>
  );
};

export default DMSPage;
