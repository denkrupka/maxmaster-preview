/**
 * Document Module — Service Layer
 *
 * Handles CRUD for templates, documents, contractor categories,
 * autofill logic, and template rendering with XSS sanitization.
 */

import { supabase } from './supabase';
import type {
  DocumentTemplate,
  DocumentRecord,
  ContractorCategory,
  TemplateVariable,
  DocumentFilters,
  AutofillData,
  CreateTemplateInput,
  UpdateTemplateInput,
  CreateDocumentInput,
  UpdateDocumentInput,
  NumberingConfig,
  DocumentSettings,
} from '../types';

// =====================================================
// UTILITIES
// =====================================================

/**
 * HTML-escape all values to prevent XSS when rendering templates.
 */
export function sanitizeData(data: Record<string, string>): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    clean[key] = String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }
  return clean;
}

/**
 * Replace {{placeholder}} tokens inside every section of a template.
 * Data values are sanitized before substitution.
 */
export function renderTemplate(
  template: DocumentTemplate,
  data: Record<string, string>,
): string {
  const safe = sanitizeData(data);
  const sections: Array<{ title?: string; body?: string }> =
    (template.content as any) ?? [];

  return sections
    .map((section) => {
      let body = section.body ?? '';
      for (const [key, value] of Object.entries(safe)) {
        body = body.replaceAll(`{{${key}}}`, value);
      }
      const title = section.title ? `<h2>${sanitizeData({ t: section.title }).t}</h2>` : '';
      return `${title}\n${body}`;
    })
    .join('\n\n');
}

// =====================================================
// TEMPLATES
// =====================================================

export async function fetchTemplates(
  companyId: string,
  type?: string,
): Promise<DocumentTemplate[]> {
  let query = supabase
    .from('document_templates')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });

  if (type) {
    query = query.eq('type', type);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as DocumentTemplate[];
}

export async function fetchTemplate(id: string): Promise<DocumentTemplate> {
  const { data, error } = await supabase
    .from('document_templates')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw error;
  return data as DocumentTemplate;
}

export async function createTemplate(
  template: CreateTemplateInput,
): Promise<DocumentTemplate> {
  const { data, error } = await supabase
    .from('document_templates')
    .insert(template)
    .select()
    .single();

  if (error) throw error;
  return data as DocumentTemplate;
}

export async function updateTemplate(
  id: string,
  updates: UpdateTemplateInput,
): Promise<DocumentTemplate> {
  const { data, error } = await supabase
    .from('document_templates')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data as DocumentTemplate;
}

export async function deleteTemplate(id: string): Promise<void> {
  const { error } = await supabase
    .from('document_templates')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

// =====================================================
// DOCUMENTS
// =====================================================

export async function fetchDocuments(
  companyId: string,
  filters?: DocumentFilters,
): Promise<DocumentRecord[]> {
  let query = supabase
    .from('documents')
    .select('*, document_templates(name, type)')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });

  if (filters?.status) {
    query = query.eq('status', filters.status);
  }
  if (filters?.templateType) {
    query = query.eq('document_templates.type', filters.templateType);
  }
  if (filters?.projectId) {
    query = query.eq('project_id', filters.projectId);
  }
  if (filters?.contractorId) {
    query = query.eq('contractor_id', filters.contractorId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as DocumentRecord[];
}

export async function fetchDocument(id: string): Promise<DocumentRecord> {
  const { data, error } = await supabase
    .from('documents')
    .select('*, document_templates(name, type, content, variables)')
    .eq('id', id)
    .single();

  if (error) throw error;
  return data as DocumentRecord;
}

export async function createDocument(
  doc: CreateDocumentInput,
): Promise<DocumentRecord> {
  const { data, error } = await supabase
    .from('documents')
    .insert(doc)
    .select()
    .single();

  if (error) throw error;
  return data as DocumentRecord;
}

export async function updateDocument(
  id: string,
  updates: UpdateDocumentInput,
): Promise<DocumentRecord> {
  const { data, error } = await supabase
    .from('documents')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data as DocumentRecord;
}

export async function deleteDocument(id: string): Promise<void> {
  const { error } = await supabase
    .from('documents')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

// =====================================================
// AUTOFILL
// =====================================================

/**
 * Fetch data sources for autofill:
 *  - contractor (from contractor_clients table)
 *  - project (from projects table)
 *  - company (from companies table)
 */
export async function getAutofillData(
  companyId: string,
  contractorId?: string,
  projectId?: string,
): Promise<AutofillData> {
  const result: AutofillData = {};

  // Fetch contractor data
  if (contractorId) {
    const { data: contractor } = await supabase
      .from('contractor_clients')
      .select('*')
      .eq('id', contractorId)
      .single();
    result.contractor = contractor ?? undefined;

    // Fallback: try the contractors table if contractor_clients returned nothing
    if (!result.contractor) {
      const { data: contractorAlt } = await supabase
        .from('contractors')
        .select('*')
        .eq('id', contractorId)
        .single();
      result.contractor = contractorAlt ?? undefined;
    }
  }

  // Fetch project data
  if (projectId) {
    const { data: project } = await supabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .single();
    result.project = project ?? undefined;
  }

  // Fetch company data
  const { data: company } = await supabase
    .from('companies')
    .select('*')
    .eq('id', companyId)
    .single();
  result.company = company ?? undefined;

  return result;
}

/**
 * Match template variables against autofill sources and return
 * a key→value map for every variable that can be resolved.
 *
 * Variables with source === 'manual' are skipped.
 */
export function applyAutofill(
  variables: TemplateVariable[],
  autofillData: AutofillData,
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const v of variables) {
    const key = v.key;
    let value: string | undefined;

    switch (v.source) {
      case 'contractors': {
        const c = autofillData.contractor;
        if (c) {
          value = resolveField(c, key);
        }
        break;
      }
      case 'projects': {
        const p = autofillData.project;
        if (p) {
          value = resolveField(p, key);
        }
        break;
      }
      case 'companies': {
        const co = autofillData.company;
        if (co) {
          value = resolveField(co, key);
        }
        break;
      }
      case 'employees':
        // Employees autofill can be extended when employee context is available
        break;
      case 'manual':
      default:
        break;
    }

    if (value !== undefined) {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Resolve a placeholder key against a data object.
 *
 * Supports patterns like:
 *   contractor_name  → obj.name
 *   project_name     → obj.name
 *   company_nip      → obj.nip
 *   contract_date    → today's date
 */
function resolveField(obj: Record<string, any>, key: string): string | undefined {
  // Direct match: exact key exists in the object
  if (obj[key] !== undefined && obj[key] !== null) {
    return String(obj[key]);
  }

  // Strip common prefixes and try again
  const prefixes = ['contractor_', 'project_', 'company_', 'employee_'];
  for (const prefix of prefixes) {
    if (key.startsWith(prefix)) {
      const field = key.slice(prefix.length);
      if (obj[field] !== undefined && obj[field] !== null) {
        return String(obj[field]);
      }
    }
  }

  // Special date placeholder
  if (key === 'contract_date' || key === 'document_date' || key === 'current_date') {
    return new Date().toLocaleDateString('pl-PL');
  }

  return undefined;
}

// =====================================================
// CONTRACTOR CATEGORIES
// =====================================================

export async function fetchContractorCategories(
  companyId: string,
  contractorId?: string,
): Promise<ContractorCategory[]> {
  let query = supabase
    .from('contractor_categories')
    .select('*')
    .eq('company_id', companyId);

  if (contractorId) {
    query = query.eq('contractor_id', contractorId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as ContractorCategory[];
}

export async function setContractorCategory(
  companyId: string,
  contractorId: string,
  category: string,
): Promise<void> {
  const { error } = await supabase
    .from('contractor_categories')
    .upsert(
      {
        company_id: companyId,
        contractor_id: contractorId,
        category,
      },
      { onConflict: 'company_id,contractor_id,category' },
    );

  if (error) throw error;
}

export async function removeContractorCategory(
  companyId: string,
  contractorId: string,
  category: string,
): Promise<void> {
  const { error } = await supabase
    .from('contractor_categories')
    .delete()
    .eq('company_id', companyId)
    .eq('contractor_id', contractorId)
    .eq('category', category);

  if (error) throw error;
}

// =====================================================
// DOCUMENT NUMBERING
// =====================================================

/**
 * Generate the next document number.
 *
 * In production this calls a Supabase Edge Function that atomically
 * increments document_numbering.last_number.
 *
 * Until the Edge Function is deployed, returns a "DRAFT" placeholder
 * and falls back to reading the current counter from
 * document_numbering (SELECT only — no increment on the client).
 */
export async function generateDocumentNumber(companyId: string, templateType: string, projectId?: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('generate-document-number', {
    body: { template_type: templateType, project_id: projectId }
  });
  if (error || !data?.number) {
    // Fallback: DRAFT номер
    const ts = Date.now().toString(36).toUpperCase();
    return `DRAFT-${ts}`;
  }
  return data.number;
}

// =====================================================
// DOCUMENT SETTINGS (NUMBERING CONFIG)
// =====================================================

/**
 * Fetch numbering settings for a company.
 */
export async function fetchDocumentSettings(
  companyId: string,
): Promise<DocumentSettings | null> {
  const { data, error } = await supabase
    .from('document_settings')
    .select('*')
    .eq('company_id', companyId)
    .single();

  if (error) {
    // PGRST116 = no rows — not an error, just no settings yet
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data as DocumentSettings;
}

/**
 * Create or update numbering configuration for a company.
 */
export async function updateDocumentSettings(
  companyId: string,
  config: NumberingConfig,
): Promise<void> {
  const existing = await fetchDocumentSettings(companyId);

  if (existing) {
    const { error } = await supabase
      .from('document_settings')
      .update({
        numbering_config: config,
        updated_at: new Date().toISOString(),
      })
      .eq('company_id', companyId);

    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('document_settings')
      .insert({
        company_id: companyId,
        numbering_config: config,
      });

    if (error) throw error;
  }
}

// =====================================================
// PDF GENERATION
// =====================================================

/**
 * Generate a PDF for a document by calling the Edge Function.
 * Returns a signed URL valid for 30 minutes.
 */
export async function generatePDF(documentId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('generate-document-pdf', {
    body: { document_id: documentId },
  });

  if (error) {
    throw new Error(error.message ?? 'PDF generation failed');
  }

  if (!data?.url) {
    throw new Error('No URL returned from PDF generation');
  }

  return data.url;
}

// =====================================================
// DOCUMENT VERSIONING
// =====================================================

/**
 * Create a new version of a document.
 * Call this on every save to maintain version history.
 */
export async function createDocumentVersion(
  documentId: string,
  companyId: string,
  data: Record<string, any>,
  pdfPath: string | null,
  changeSummary: string,
  userId: string,
): Promise<{ version_number: number }> {
  // 1. Get current version from documents
  const { data: doc, error: docError } = await supabase
    .from('documents')
    .select('current_version')
    .eq('id', documentId)
    .single();

  if (docError) throw docError;

  const currentVersion = doc?.current_version ?? 0;
  const newVersion = currentVersion + 1;

  // 2. Insert into document_versions
  const { error: insertError } = await supabase
    .from('document_versions')
    .insert({
      document_id: documentId,
      company_id: companyId,
      version_number: newVersion,
      data,
      pdf_path: pdfPath,
      change_summary: changeSummary,
      created_by: userId,
    });

  if (insertError) throw insertError;

  // 3. Update current_version on the document
  const { error: updateError } = await supabase
    .from('documents')
    .update({ current_version: newVersion, updated_at: new Date().toISOString() })
    .eq('id', documentId);

  if (updateError) throw updateError;

  return { version_number: newVersion };
}

/**
 * Get all versions of a document, newest first.
 */
export async function getDocumentVersions(documentId: string): Promise<any[]> {
  const { data } = await supabase
    .from('document_versions')
    .select('*')
    .eq('document_id', documentId)
    .order('version_number', { ascending: false });
  return data || [];
}

/**
 * Restore a previous version by copying its data into a new version.
 */
export async function restoreDocumentVersion(
  documentId: string,
  versionNumber: number,
  userId: string,
): Promise<void> {
  // 1. Get data from the target version
  const { data: version, error: versionError } = await supabase
    .from('document_versions')
    .select('data, company_id')
    .eq('document_id', documentId)
    .eq('version_number', versionNumber)
    .single();

  if (versionError) throw versionError;
  if (!version) throw new Error(`Version ${versionNumber} not found`);

  // 2. Create a new version with the restored data
  await createDocumentVersion(
    documentId,
    version.company_id,
    version.data,
    null,
    `Przywrócono wersję ${versionNumber}`,
    userId,
  );

  // 3. Update document data to the restored version
  const { error: updateError } = await supabase
    .from('documents')
    .update({ data: version.data, updated_at: new Date().toISOString() })
    .eq('id', documentId);

  if (updateError) throw updateError;
}

// =====================================================
// AUDIT LOG
// =====================================================

/**
 * Get audit log entries for a document, newest first (max 100).
 */
export async function getDocumentAuditLog(documentId: string): Promise<any[]> {
  const { data } = await supabase
    .from('document_audit_log')
    .select('*')
    .eq('document_id', documentId)
    .order('created_at', { ascending: false })
    .limit(100);
  return data || [];
}

/**
 * Log a document event via Edge Function (SECURITY DEFINER).
 */
export async function logDocumentEvent(
  documentId: string,
  action: string,
  metadata?: Record<string, any>,
): Promise<void> {
  await supabase.functions.invoke('log-document-event', {
    body: { document_id: documentId, action, metadata: metadata || {} },
  });
}

// =====================================================
// PUBLIC LINKS
// =====================================================

/**
 * Create a public sharing link for a document.
 */
export async function createPublicLink(
  documentId: string,
  companyId: string,
  userId: string,
  options?: { expiresInDays?: number; maxViews?: number; pin?: string },
): Promise<{ token: string; url: string }> {
  const { data, error } = await supabase
    .from('document_public_links')
    .insert({
      company_id: companyId,
      document_id: documentId,
      expires_at: options?.expiresInDays
        ? new Date(Date.now() + options.expiresInDays * 86400000).toISOString()
        : null,
      max_views: options?.maxViews || null,
      pin_hash: options?.pin || null, // hashed server-side via Edge Function
      created_by: userId,
    })
    .select('token')
    .single();

  if (error) throw error;
  return {
    token: data.token,
    url: `${window.location.origin}/public/doc/${data.token}`,
  };
}

/**
 * Get all public links for a document, newest first.
 */
export async function getPublicLinks(documentId: string): Promise<any[]> {
  const { data } = await supabase
    .from('document_public_links')
    .select('*')
    .eq('document_id', documentId)
    .order('created_at', { ascending: false });
  return data || [];
}

/**
 * Deactivate a public link.
 */
export async function deactivatePublicLink(linkId: string): Promise<void> {
  await supabase
    .from('document_public_links')
    .update({ is_active: false })
    .eq('id', linkId);
}

// =====================================================
// SIGNATURE REQUESTS
// =====================================================

/**
 * Create signature requests for one or more signers.
 */
export async function createSignatureRequest(
  documentId: string,
  companyId: string,
  userId: string,
  signers: Array<{ name: string; email: string; message?: string }>,
): Promise<any[]> {
  const requests = signers.map((s) => ({
    company_id: companyId,
    document_id: documentId,
    signer_name: s.name,
    signer_email: s.email,
    message: s.message || null,
    created_by: userId,
  }));

  const { data, error } = await supabase
    .from('signature_requests')
    .insert(requests)
    .select();

  if (error) throw error;
  return data;
}

/**
 * Get all signature requests for a document, newest first.
 */
export async function getSignatureRequests(documentId: string): Promise<any[]> {
  const { data } = await supabase
    .from('signature_requests')
    .select('*')
    .eq('document_id', documentId)
    .order('created_at', { ascending: false });
  return data || [];
}

// ===== ЭТАП 3: Track Changes + Комментарии =====

// Получить diff между двумя версиями документа
export function getVersionDiff(
  oldData: Record<string, any>, newData: Record<string, any>
): Array<{ key: string; old: any; new: any; type: 'added' | 'removed' | 'changed' }> {
  const changes: Array<{ key: string; old: any; new: any; type: 'added' | 'removed' | 'changed' }> = [];
  const allKeys = new Set([...Object.keys(oldData || {}), ...Object.keys(newData || {})]);
  for (const key of allKeys) {
    const oldVal = oldData?.[key];
    const newVal = newData?.[key];
    if (oldVal === undefined && newVal !== undefined) {
      changes.push({ key, old: null, new: newVal, type: 'added' });
    } else if (oldVal !== undefined && newVal === undefined) {
      changes.push({ key, old: oldVal, new: null, type: 'removed' });
    } else if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      changes.push({ key, old: oldVal, new: newVal, type: 'changed' });
    }
  }
  return changes;
}

// Комментарии к документу
export async function getDocumentComments(documentId: string): Promise<any[]> {
  const { data } = await supabase
    .from('document_comments')
    .select('*')
    .eq('document_id', documentId)
    .order('created_at', { ascending: true });
  return data || [];
}

export async function addDocumentComment(
  documentId: string, companyId: string, authorId: string, authorName: string,
  content: string, fieldKey?: string, parentId?: string
): Promise<any> {
  const { data, error } = await supabase
    .from('document_comments')
    .insert({
      company_id: companyId,
      document_id: documentId,
      author_id: authorId,
      author_name: authorName,
      content,
      field_key: fieldKey || null,
      parent_id: parentId || null
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function resolveComment(commentId: string, userId: string): Promise<void> {
  await supabase
    .from('document_comments')
    .update({ resolved: true, resolved_by: userId, resolved_at: new Date().toISOString() })
    .eq('id', commentId);
}

// ===== ЭТАП 4: AI Анализ =====

// Анализ документа через Gemini (Edge Function)
export async function analyzeDocument(
  documentId: string, companyId: string, analysisType: string,
  documentContent: Record<string, any>, templateName: string
): Promise<{ result: any; id: string }> {
  const { data, error } = await supabase.functions.invoke('analyze-document', {
    body: {
      document_id: documentId,
      company_id: companyId,
      analysis_type: analysisType,
      document_content: documentContent,
      template_name: templateName
    }
  });
  if (error) throw error;
  return data;
}

// Получить историю AI анализов
export async function getDocumentAnalyses(documentId: string): Promise<any[]> {
  const { data } = await supabase
    .from('document_ai_analyses')
    .select('*')
    .eq('document_id', documentId)
    .order('created_at', { ascending: false });
  return data || [];
}

// Автогенерация документа на основе контекста
export async function generateDocumentContent(
  templateId: string, context: Record<string, any>
): Promise<Record<string, any>> {
  const { data, error } = await supabase.functions.invoke('generate-document-content', {
    body: { template_id: templateId, context }
  });
  if (error) throw error;
  return data;
}

// Получить автоматизации компании
export async function getDocumentAutomations(companyId: string): Promise<any[]> {
  const { data } = await supabase
    .from('document_automations')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  return data || [];
}

export async function saveDocumentAutomation(
  companyId: string, userId: string,
  automation: { name: string; trigger_type: string; trigger_config: any; action_type: string; action_config: any }
): Promise<any> {
  const { data, error } = await supabase
    .from('document_automations')
    .insert({ ...automation, company_id: companyId, created_by: userId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function toggleAutomation(automationId: string, isActive: boolean): Promise<void> {
  await supabase
    .from('document_automations')
    .update({ is_active: isActive })
    .eq('id', automationId);
}

// ===== ДОПОЛНИТЕЛЬНЫЕ ФУНКЦИИ =====

// Дублирование документа
export async function duplicateDocument(
  docId: string, companyId: string, userId: string
): Promise<DocumentRecord> {
  const { data: original, error: fetchErr } = await supabase
    .from('documents')
    .select('*')
    .eq('id', docId)
    .single();
  if (fetchErr || !original) throw fetchErr || new Error('Document not found');

  const { data: newDoc, error: insertErr } = await supabase
    .from('documents')
    .insert({
      company_id: companyId,
      template_id: original.template_id,
      project_id: original.project_id,
      contractor_id: original.contractor_id,
      name: `${original.name} (kopia)`,
      status: 'draft' as DocumentStatus,
      data: original.data,
      created_by: userId,
    })
    .select()
    .single();
  if (insertErr) throw insertErr;
  return newDoc;
}

// Статистика документов
export async function getDocumentStats(companyId: string): Promise<{
  total: number; drafts: number; completed: number; archived: number;
  pendingSignatures: number; thisMonth: number;
}> {
  const { data: docs } = await supabase
    .from('documents')
    .select('id, status, created_at')
    .eq('company_id', companyId);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const all = docs || [];
  const { data: pendingSigs } = await supabase
    .from('signature_requests')
    .select('id')
    .eq('company_id', companyId)
    .eq('status', 'pending');

  return {
    total: all.length,
    drafts: all.filter(d => d.status === 'draft').length,
    completed: all.filter(d => d.status === 'completed').length,
    archived: all.filter(d => d.status === 'archived').length,
    pendingSignatures: (pendingSigs || []).length,
    thisMonth: all.filter(d => d.created_at >= monthStart).length,
  };
}

// Экспорт документов в CSV
export function exportDocumentsCSV(documents: any[]): string {
  const headers = ['Numer', 'Nazwa', 'Typ', 'Status', 'Data utworzenia'];
  const rows = documents.map(d => [
    d.number || '',
    d.name,
    d.document_templates?.type || '',
    d.status,
    new Date(d.created_at).toLocaleDateString('pl-PL'),
  ]);
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  return csv;
}

// Скачать CSV файл
export function downloadCSV(csv: string, filename: string): void {
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ============================================================
// Публичная верификация подписи
// ============================================================

export async function verifySignatureRequest(requestId: string): Promise<any> {
  const { data, error } = await supabase
    .from('signature_requests')
    .select('*, documents(*)')
    .eq('id', requestId)
    .single();
  if (error) throw error;
  return data;
}

export async function signDocument(requestId: string, signatureData: {
  pin: string;
  ip_address?: string;
  user_agent?: string;
}): Promise<void> {
  // Verify PIN
  const { data: request } = await supabase
    .from('signature_requests')
    .select('pin_hash')
    .eq('id', requestId)
    .single();

  if (!request) throw new Error('Signature request not found');

  // Update signature request
  const { error } = await supabase
    .from('signature_requests')
    .update({
      status: 'signed',
      signed_at: new Date().toISOString(),
      ip_address: signatureData.ip_address || null,
      user_agent: signatureData.user_agent || null
    })
    .eq('id', requestId)
    .eq('status', 'pending');

  if (error) throw error;

  // Create digital signature record
  const { data: req } = await supabase
    .from('signature_requests')
    .select('document_id, signer_email, signer_name')
    .eq('id', requestId)
    .single();

  if (req) {
    await supabase.from('digital_signatures').insert({
      document_id: req.document_id,
      signer_email: req.signer_email,
      signer_name: req.signer_name,
      signature_type: 'electronic',
      signed_at: new Date().toISOString(),
      ip_address: signatureData.ip_address,
      verification_code: requestId.slice(0, 8).toUpperCase()
    });

    await logDocumentEvent(req.document_id, 'signed', { signer: req.signer_email });
  }
}

// ============================================================
// QR-код верификации
// ============================================================

export function generateVerificationQR(documentId: string, verificationCode: string): string {
  const verifyUrl = `${window.location.origin}/verify/${documentId}?code=${verificationCode}`;
  return `https://chart.googleapis.com/chart?cht=qr&chs=200x200&chl=${encodeURIComponent(verifyUrl)}`;
}

export async function verifyDocument(documentId: string, code: string): Promise<{valid: boolean; document?: any}> {
  const { data } = await supabase
    .from('digital_signatures')
    .select('*, documents(name, document_number)')
    .eq('document_id', documentId)
    .eq('verification_code', code)
    .single();

  return { valid: !!data, document: data?.documents };
}

// ============================================================
// Напоминания о неподписанных документах
// ============================================================

export async function getUnsignedDocuments(companyId: string): Promise<any[]> {
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('signature_requests')
    .select('*, documents(name, document_number)')
    .eq('status', 'pending')
    .lt('created_at', threeDaysAgo)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function sendSignatureReminder(requestId: string): Promise<void> {
  const { data: request } = await supabase
    .from('signature_requests')
    .select('*, documents(name)')
    .eq('id', requestId)
    .single();

  if (request) {
    await supabase.from('document_emails').insert({
      document_id: request.document_id,
      to_email: request.signer_email,
      subject: `Przypomnienie: Podpis dokumentu "${request.documents?.name}"`,
      body: `Szanowny/a ${request.signer_name},\n\nPrzypominamy o oczekującym podpisie dokumentu "${request.documents?.name}".\n\nLink do podpisu: ${window.location.origin}/sign/${requestId}`,
      status: 'pending'
    });

    await logDocumentEvent(request.document_id, 'reminder_sent', { to: request.signer_email });
  }
}

// ============================================================
// Привязка документ ↔ фактура
// ============================================================

export async function linkDocumentToInvoice(documentId: string, invoiceId: string): Promise<void> {
  const { error } = await supabase
    .from('documents')
    .update({ linked_invoice_id: invoiceId })
    .eq('id', documentId);
  if (error) throw error;
  await logDocumentEvent(documentId, 'linked_invoice', { invoice_id: invoiceId });
}

export async function getLinkedInvoice(documentId: string): Promise<any> {
  const { data } = await supabase
    .from('documents')
    .select('linked_invoice_id')
    .eq('id', documentId)
    .single();
  return data?.linked_invoice_id || null;
}
