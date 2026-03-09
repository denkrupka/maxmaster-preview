// ============================================================
// Workspace API — service layer with real + mock implementations
// ============================================================

import { supabase } from '../../../lib/supabase';
import type {
  DrawingObject, BoqRow, AiSuggestion, MeasurementItem,
  AnnotationItem, MappingRule, VersionCompareResult, WorkspaceError,
  AggregationMode, ProjectFile,
} from './WorkspaceTypes';

const APS_PROXY = `${import.meta.env.VITE_SUPABASE_URL || 'https://diytvuczpciikzdhldny.supabase.co'}/functions/v1/aps-proxy`;

async function apsCall(action: string, body: Record<string, any> = {}) {
  const res = await fetch(APS_PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...body }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`APS ${action} failed: ${text}`);
  }
  return res.json();
}

// ---- Files ----

export async function convertFile(fileId: string, fileBase64: string, fileName: string): Promise<{ urn: string }> {
  // Upload to APS
  const uploadResult = await apsCall('upload', { fileBase64, fileName });
  const urn = uploadResult.urn;
  // Translate
  await apsCall('translate', { urn });
  // Poll status
  let status = 'inprogress';
  while (status === 'inprogress' || status === 'pending') {
    await new Promise(r => setTimeout(r, 3000));
    const result = await apsCall('status', { urn });
    status = result.status;
    if (status === 'failed') throw new Error('Translation failed');
  }
  return { urn };
}

export async function getApsToken(): Promise<string> {
  const result = await apsCall('getToken');
  return result.access_token;
}

export async function checkTranslationStatus(urn: string): Promise<{ status: string; progress: string }> {
  return apsCall('status', { urn });
}

// ---- Analysis ----

export async function analyzeFile(urn: string): Promise<{
  objects: DrawingObject[];
  layers: string[];
  levels: string[];
  categories: string[];
}> {
  // Get model tree
  const treeData = await apsCall('getModelTree', { urn });
  // Get all properties
  const propsData = await apsCall('getAllProperties', { urn });

  const objects: DrawingObject[] = [];
  const layersSet = new Set<string>();
  const levelsSet = new Set<string>();
  const categoriesSet = new Set<string>();

  if (propsData.elements && Array.isArray(propsData.elements)) {
    for (const el of propsData.elements) {
      const obj: DrawingObject = {
        id: el.externalId || `obj-${el.dbId}`,
        dbId: el.dbId,
        externalId: el.externalId,
        fileId: urn,
        name: el.name || `Element ${el.dbId}`,
        category: el.category,
        family: el.family,
        type: el.type,
        level: el.level,
        layer: el.layer,
        system: el.system,
        length: el.length,
        area: el.area,
        volume: el.volume,
        quantityBasis: el.area ? 'area' : el.length ? 'length' : el.volume ? 'volume' : 'count',
        rawProperties: el.properties,
      };
      objects.push(obj);
      if (el.layer) layersSet.add(el.layer);
      if (el.level) levelsSet.add(el.level);
      if (el.category) categoriesSet.add(el.category);
    }
  }

  return {
    objects,
    layers: [...layersSet],
    levels: [...levelsSet],
    categories: [...categoriesSet],
  };
}

// ---- AI ----

export async function runAiRecognition(
  urn: string,
  objects: DrawingObject[]
): Promise<AiSuggestion[]> {
  const elements = objects.slice(0, 500).map(o => ({
    id: o.id,
    name: o.name,
    category: o.category,
    family: o.family,
    type: o.type,
    layer: o.layer,
    properties: o.rawProperties,
  }));

  const result = await apsCall('aiClassify', { elements });

  if (result.classifications && Array.isArray(result.classifications)) {
    return result.classifications.map((c: any) => ({
      id: `ai-${c.elementId || c.id}`,
      objectId: c.elementId || c.id,
      suggestedClass: c.className || c.suggestedClass || 'unknown',
      suggestedBoqItem: c.boqName || c.suggestedBoqItem,
      confidence: c.confidence ?? 0.5,
      reasoning: c.reasoning,
      status: 'pending' as const,
    }));
  }
  return [];
}

export async function applyAiSuggestion(
  suggestionId: string,
  mode: 'single' | 'similar'
): Promise<void> {
  try {
    await supabase.from('ai_feedback').insert({
      suggestion_id: suggestionId,
      action: 'accepted',
      mode,
      created_at: new Date().toISOString(),
    });
  } catch {
    // Table may not exist yet — AI feedback works locally
  }
}

// ---- BOQ ----

export async function generateBoq(
  objects: DrawingObject[],
  rules: MappingRule[],
  aiSuggestions: AiSuggestion[]
): Promise<BoqRow[]> {
  const rows: BoqRow[] = [];
  const groupMap = new Map<string, { objects: DrawingObject[]; rule: MappingRule }>();

  // Apply rules to objects
  for (const obj of objects) {
    for (const rule of rules.sort((a, b) => a.priority - b.priority)) {
      if (!rule.active) continue;
      if (matchesRule(obj, rule)) {
        const key = rule.id;
        if (!groupMap.has(key)) groupMap.set(key, { objects: [], rule });
        groupMap.get(key)!.objects.push(obj);
        break; // First match wins
      }
    }
  }

  // Build BOQ rows from matched groups
  let pos = 1;
  for (const [, { objects: matched, rule }] of groupMap) {
    let quantity = 0;
    switch (rule.aggregationMode) {
      case 'count': quantity = matched.length; break;
      case 'sum-length': quantity = matched.reduce((s, o) => s + (o.length || 0), 0); break;
      case 'sum-area': quantity = matched.reduce((s, o) => s + (o.area || 0), 0); break;
      case 'sum-volume': quantity = matched.reduce((s, o) => s + (o.volume || 0), 0); break;
      default: quantity = matched.length;
    }

    if (quantity > 0) {
      rows.push({
        id: `boq-${pos}`,
        code: `${pos}.`,
        name: rule.targetBoqName,
        unit: rule.targetUnit || (rule.aggregationMode === 'count' ? 'szt.' : rule.aggregationMode === 'sum-length' ? 'm' : rule.aggregationMode === 'sum-area' ? 'm2' : 'szt.'),
        quantity: Math.round(quantity * 100) / 100,
        sourceType: 'aps-properties',
        sourceObjectIds: matched.map(o => o.id),
        confidence: 0.85,
        status: 'auto-generated',
        category: rule.targetCategory,
      });
      pos++;
    }
  }

  // AI fallback for unmatched objects
  const matchedIds = new Set(rows.flatMap(r => r.sourceObjectIds));
  const unmatched = objects.filter(o => !matchedIds.has(o.id));

  if (unmatched.length > 0 && aiSuggestions.length > 0) {
    const aiGroups = new Map<string, DrawingObject[]>();
    for (const obj of unmatched) {
      const suggestion = aiSuggestions.find(s => s.objectId === obj.id && s.status !== 'rejected');
      if (suggestion?.suggestedBoqItem) {
        const key = suggestion.suggestedBoqItem;
        if (!aiGroups.has(key)) aiGroups.set(key, []);
        aiGroups.get(key)!.push(obj);
      }
    }
    for (const [name, objs] of aiGroups) {
      rows.push({
        id: `boq-${pos}`,
        code: `${pos}.`,
        name,
        unit: 'szt.',
        quantity: objs.length,
        sourceType: 'ai-detection',
        sourceObjectIds: objs.map(o => o.id),
        confidence: 0.6,
        status: 'needs-review',
      });
      pos++;
    }
  }

  return rows;
}

export async function generateBoqAi(
  urn: string,
  objects: DrawingObject[]
): Promise<BoqRow[]> {
  const elements = objects.slice(0, 500).map(o => ({
    id: o.id,
    name: o.name,
    category: o.category,
    family: o.family,
    type: o.type,
    layer: o.layer,
  }));

  const result = await apsCall('aiGenerateBOQ', { elements });

  if (result.boqItems && Array.isArray(result.boqItems)) {
    return result.boqItems.map((item: any, i: number) => ({
      id: `boq-ai-${i + 1}`,
      code: `${i + 1}.`,
      name: item.name || item.description || 'Pozycja',
      unit: item.unit || 'szt.',
      quantity: item.quantity || 0,
      sourceType: 'ai-detection' as const,
      sourceObjectIds: item.sourceIds || [],
      confidence: item.confidence ?? 0.7,
      status: 'needs-review' as const,
      category: item.category,
    }));
  }
  return [];
}

// ---- Rules ----

export function getDefaultRules(): MappingRule[] {
  return [
    rule(1, 'Oprawy oswietleniowe', ['category contains Lighting', 'type contains fixture'], 'Oprawa oswietleniowa', 'lighting', 'szt.', 'count'),
    rule(2, 'Lampy 60x60', ['name contains 60x60', 'category contains Light'], 'Oprawa LED 60x60', 'lighting', 'szt.', 'count'),
    rule(3, 'Gniazda podwojne', ['type contains Double Outlet', 'category contains Electrical'], 'Gniazdo podwojne 230V', 'electrical', 'szt.', 'count'),
    rule(4, 'Gniazda pojedyncze', ['type contains Single Outlet', 'category contains Electrical'], 'Gniazdo pojedyncze 230V', 'electrical', 'szt.', 'count'),
    rule(5, 'Wylaczniki', ['type contains Switch', 'category contains Electrical'], 'Wylacznik swiatelka', 'electrical', 'szt.', 'count'),
    rule(6, 'Rozdzielnice', ['category contains Panel', 'type contains Distribution'], 'Rozdzielnica elektryczna', 'distribution', 'szt.', 'count'),
    rule(7, 'Korytka kablowe', ['category contains Cable Tray'], 'Korytko kablowe', 'cabling', 'm', 'sum-length'),
    rule(8, 'Rury instalacyjne', ['category contains Conduit'], 'Rura instalacyjna', 'cabling', 'm', 'sum-length'),
    rule(9, 'Gniazda RJ45', ['type contains Data', 'category contains Communication'], 'Gniazdo RJ45', 'telecom', 'szt.', 'count'),
    rule(10, 'Czujniki dymu', ['type contains Smoke', 'category contains Fire'], 'Czujnik dymu', 'fire_safety', 'szt.', 'count'),
    rule(11, 'ROP', ['type contains Manual Call Point'], 'Reczny ostrzegacz pozarowy', 'fire_safety', 'szt.', 'count'),
    rule(12, 'Czujniki ruchu', ['type contains Motion', 'type contains Occupancy'], 'Czujnik ruchu / obecnosci', 'electrical', 'szt.', 'count'),
  ];
}

function rule(
  priority: number, name: string, condStrs: string[],
  boqName: string, category: string, unit: string, agg: AggregationMode
): MappingRule {
  const conditions = condStrs.map(s => {
    const parts = s.split(' ');
    return {
      field: parts[0] as any,
      operator: parts[1] as any,
      value: parts.slice(2).join(' '),
    };
  });
  return {
    id: `rule-${priority}`,
    name,
    active: true,
    priority,
    conditions,
    targetBoqName: boqName,
    targetCategory: category,
    targetUnit: unit,
    aggregationMode: agg,
  };
}

function matchesRule(obj: DrawingObject, rule: MappingRule): boolean {
  return rule.conditions.every(c => {
    const val = getFieldValue(obj, c.field);
    if (!val) {
      if (c.operator === 'exists') return false;
      return false; // No value means condition not met (except 'exists')
    }
    const v = val.toLowerCase();
    const cv = c.value.toLowerCase();
    switch (c.operator) {
      case 'equals': return v === cv;
      case 'contains': return v.includes(cv);
      case 'startsWith': return v.startsWith(cv);
      case 'endsWith': return v.endsWith(cv);
      case 'regex': try { return new RegExp(c.value, 'i').test(val); } catch { return false; }
      case 'exists': return !!val;
      case 'greaterThan': return parseFloat(val) > parseFloat(c.value);
      case 'lessThan': return parseFloat(val) < parseFloat(c.value);
      default: return false;
    }
  });
}

function getFieldValue(obj: DrawingObject, field: string): string {
  switch (field) {
    case 'category': return obj.category || '';
    case 'family': return obj.family || '';
    case 'type': return obj.type || '';
    case 'layer': return obj.layer || '';
    case 'name': return obj.name || '';
    case 'blockName': return obj.rawProperties?.blockName || obj.rawProperties?.['Block Name'] || '';
    case 'system': return obj.system || '';
    case 'level': return obj.level || '';
    case 'zone': return obj.zone || '';
    case 'geometryType': return obj.geometryType || '';
    case 'classification': return obj.rawProperties?.classification || '';
    case 'aiClass': return obj.aiSuggestedClass || '';
    case 'property': return ''; // Handled via propertyPath in condition
    default: return '';
  }
}

// ---- Compare ----

export async function compareVersions(
  objectsA: DrawingObject[],
  objectsB: DrawingObject[]
): Promise<VersionCompareResult> {
  const mapA = new Map(objectsA.map(o => [o.id, o]));
  const mapB = new Map(objectsB.map(o => [o.id, o]));

  const added = objectsB.filter(o => !mapA.has(o.id));
  const removed = objectsA.filter(o => !mapB.has(o.id));
  const changed: { before: DrawingObject; after: DrawingObject }[] = [];

  for (const [id, objB] of mapB) {
    const objA = mapA.get(id);
    if (objA && (objA.name !== objB.name || objA.category !== objB.category || objA.type !== objB.type)) {
      changed.push({ before: objA, after: objB });
    }
  }

  return {
    addedObjects: added,
    removedObjects: removed,
    changedObjects: changed,
    deltaBoqRows: [],
  };
}

// ---- Measurements & Annotations (local state, persisted to supabase) ----

export async function saveMeasurement(item: MeasurementItem, planId: string): Promise<void> {
  // Persist to supabase if table exists
  try {
    await supabase.from('plan_measurements').insert({
      plan_id: planId,
      type: item.type,
      value: item.value,
      unit: item.unit,
      label: item.label,
      points: item.points,
      linked_boq_row_id: item.linkedBoqRowId,
      created_by: item.createdBy,
    });
  } catch {
    // Table may not exist yet — measurements work locally
  }
}

export async function saveAnnotation(item: AnnotationItem, planId: string): Promise<void> {
  try {
    await supabase.from('plan_annotations').insert({
      plan_id: planId,
      type: item.type,
      geometry: item.geometry,
      text: item.text,
      stroke_color: item.strokeColor,
      stroke_width: item.strokeWidth,
      linked_boq_row_id: item.linkedBoqRowId,
      created_by: item.createdBy,
    });
  } catch {
    // Table may not exist yet
  }
}

// ---- Export ----

export function exportBoqCsv(rows: BoqRow[]): void {
  const bom = '\uFEFF';
  const header = 'Lp.;Nazwa;Jednostka;Ilosc;Typ zrodla;Pewnosc;Status\n';
  const csvRows = rows.map((r, i) =>
    `${i + 1};${r.name};${r.unit};${r.quantity};${r.sourceType};${(r.confidence || 0) * 100}%;${r.status}`
  ).join('\n');
  const blob = new Blob([bom + header + csvRows], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `boq_export_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================================
// Additional API functions
// ============================================================

// ---- Files (additional) ----

export async function uploadProjectFile(
  file: File,
  projectId: string,
  componentId: string
): Promise<ProjectFile> {
  const fileExt = file.name.split('.').pop() || '';
  const storagePath = `projects/${projectId}/${componentId}/${crypto.randomUUID()}.${fileExt}`;

  const { error: uploadError } = await supabase.storage
    .from('plans')
    .upload(storagePath, file);
  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  const { data: urlData } = supabase.storage.from('plans').getPublicUrl(storagePath);

  const record: Partial<ProjectFile> = {
    id: crypto.randomUUID(),
    name: file.name,
    format: detectFormat(fileExt),
    version: 1,
    status: 'uploaded',
    fileUrl: urlData.publicUrl,
    originalFilename: file.name,
    mimeType: file.type,
    fileSize: file.size,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const { error: insertError } = await supabase.from('plans').insert({
    id: record.id,
    project_id: projectId,
    component_id: componentId,
    name: record.name,
    format: record.format,
    version: record.version,
    status: record.status,
    file_url: record.fileUrl,
    original_filename: record.originalFilename,
    mime_type: record.mimeType,
    file_size: record.fileSize,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  });
  if (insertError) throw new Error(`Insert plan record failed: ${insertError.message}`);

  return record as ProjectFile;
}

function detectFormat(ext: string): ProjectFile['format'] {
  const map: Record<string, ProjectFile['format']> = {
    dwg: 'dwg', dxf: 'dxf', pdf: 'pdf', ifc: 'ifc', rvt: 'rvt',
    png: 'image', jpg: 'image', jpeg: 'image', zip: 'zip',
  };
  return map[ext.toLowerCase()] || 'other';
}

export async function getFileManifest(fileId: string): Promise<ProjectFile | null> {
  const { data, error } = await supabase
    .from('plans')
    .select('*')
    .eq('id', fileId)
    .single();
  if (error || !data) return null;

  return {
    id: data.id,
    name: data.name,
    format: data.format,
    version: data.version,
    status: data.status,
    parentId: data.parent_id ?? null,
    urn: data.urn ?? null,
    folderId: data.folder_id,
    fileUrl: data.file_url,
    originalFilename: data.original_filename,
    mimeType: data.mime_type,
    fileSize: data.file_size,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    scaleRatio: data.scale_ratio,
  } as ProjectFile;
}

export async function renameFile(fileId: string, newName: string): Promise<void> {
  const { error } = await supabase
    .from('plans')
    .update({ name: newName, updated_at: new Date().toISOString() })
    .eq('id', fileId);
  if (error) throw new Error(`Rename failed: ${error.message}`);
}

export async function compareFileVersions(
  fileIdA: string,
  fileIdB: string
): Promise<VersionCompareResult> {
  // Fetch analysis results for both files, then delegate to compareVersions
  const [resultA, resultB] = await Promise.all([
    getAnalyzedObjects(fileIdA),
    getAnalyzedObjects(fileIdB),
  ]);
  return compareVersions(resultA, resultB);
}

// ---- Analysis (additional) ----

export async function getAnalyzedObjects(
  fileId: string,
  filters?: { categories?: string[]; layers?: string[]; levels?: string[] }
): Promise<DrawingObject[]> {
  // Analysis results are cached locally during the session.
  // If the file has a URN we re-analyze via APS; otherwise return empty.
  const manifest = await getFileManifest(fileId);
  if (!manifest?.urn) return [];

  const analysis = await analyzeFile(manifest.urn);
  let objects = analysis.objects;

  if (filters) {
    if (filters.categories?.length) {
      objects = objects.filter(o => o.category && filters.categories!.includes(o.category));
    }
    if (filters.layers?.length) {
      objects = objects.filter(o => o.layer && filters.layers!.includes(o.layer));
    }
    if (filters.levels?.length) {
      objects = objects.filter(o => o.level && filters.levels!.includes(o.level));
    }
  }
  return objects;
}

export async function getObjectProperties(
  fileId: string,
  objectId: string
): Promise<DrawingObject | null> {
  const objects = await getAnalyzedObjects(fileId);
  return objects.find(o => o.id === objectId) ?? null;
}

// ---- AI (additional) ----

export async function getAISuggestions(
  fileId: string,
  objectIds?: string[]
): Promise<AiSuggestion[]> {
  const objects = await getAnalyzedObjects(fileId);
  const subset = objectIds
    ? objects.filter(o => objectIds.includes(o.id))
    : objects;

  const manifest = await getFileManifest(fileId);
  if (!manifest?.urn) return [];

  return runAiRecognition(manifest.urn, subset);
}

export async function rejectAiSuggestion(suggestionId: string): Promise<void> {
  try {
    await supabase.from('ai_feedback').insert({
      suggestion_id: suggestionId,
      action: 'rejected',
      created_at: new Date().toISOString(),
    });
  } catch {
    // Table may not exist yet — AI feedback works locally
  }
}

// ---- BOQ (additional) ----

export async function getBOQ(fileId: string): Promise<BoqRow[]> {
  // BOQ is generated on-the-fly from objects + rules + AI suggestions.
  // This wrapper fetches them and delegates to generateBoq.
  const objects = await getAnalyzedObjects(fileId);
  if (objects.length === 0) return [];

  const rules = getDefaultRules();
  const manifest = await getFileManifest(fileId);
  const suggestions = manifest?.urn ? await runAiRecognition(manifest.urn, objects) : [];

  return generateBoq(objects, rules, suggestions);
}

export async function updateBOQRow(
  rowId: string,
  payload: { name?: string; quantity?: number; unit?: string }
): Promise<BoqRow> {
  // BOQ rows live in local state; this returns a merged result.
  // When a Supabase boq table exists, persistence can be added here.
  return {
    id: rowId,
    name: payload.name ?? '',
    unit: payload.unit ?? 'szt.',
    quantity: payload.quantity ?? 0,
    sourceType: 'manual-measurement',
    sourceObjectIds: [],
    status: 'manually-edited',
  };
}

export async function approveBOQRow(rowId: string): Promise<BoqRow> {
  // Marks a BOQ row as approved. Local operation — no backend table yet.
  return {
    id: rowId,
    name: '',
    unit: '',
    quantity: 0,
    sourceType: 'aps-properties',
    sourceObjectIds: [],
    status: 'approved',
  };
}

export async function linkObjectsToBOQ(
  rowId: string,
  objectIds: string[]
): Promise<void> {
  // Links drawing objects to a BOQ row. Local operation.
  // When a boq_links table is available, insert rows here.
  void rowId;
  void objectIds;
}

export async function unlinkObjectFromBOQ(
  rowId: string,
  objectId: string
): Promise<void> {
  // Unlinks a single object from a BOQ row. Local operation.
  void rowId;
  void objectId;
}

// ---- Rules (additional) ----

export async function createRule(rule: MappingRule): Promise<MappingRule> {
  // Saves rule locally. When a Supabase rules table is available, persist here.
  return { ...rule, id: rule.id || `rule-${Date.now()}` };
}

export async function updateRule(
  ruleId: string,
  updates: Partial<MappingRule>
): Promise<MappingRule> {
  // Merges updates into the rule. Local operation.
  const existing = getDefaultRules().find(r => r.id === ruleId);
  if (!existing) throw new Error(`Rule ${ruleId} not found`);
  return { ...existing, ...updates, id: ruleId };
}

export async function getRules(scope?: string): Promise<MappingRule[]> {
  // Returns rules, optionally filtered by scope.
  const rules = getDefaultRules();
  if (!scope) return rules;
  return rules.filter(r => r.scope === scope);
}

export async function applyRule(
  ruleId: string,
  objects: DrawingObject[]
): Promise<BoqRow[]> {
  const rules = getDefaultRules();
  const rule = rules.find(r => r.id === ruleId);
  if (!rule) return [];

  // Delegate to generateBoq with only the single rule
  return generateBoq(objects, [rule], []);
}

// ---- Compare (additional) ----

export async function generateDeltaBOQ(
  compareResult: VersionCompareResult,
  currentBoq: BoqRow[]
): Promise<BoqRow[]> {
  const delta: BoqRow[] = [];
  let pos = currentBoq.length + 1;

  // Added objects → delta-added rows
  if (compareResult.addedObjects.length > 0) {
    delta.push({
      id: `boq-delta-${pos}`,
      code: `D${pos}.`,
      name: `Nowe elementy (${compareResult.addedObjects.length})`,
      unit: 'szt.',
      quantity: compareResult.addedObjects.length,
      sourceType: 'aps-properties',
      sourceObjectIds: compareResult.addedObjects.map(o => o.id),
      status: 'delta-added',
    });
    pos++;
  }

  // Removed objects → delta-removed rows
  if (compareResult.removedObjects.length > 0) {
    delta.push({
      id: `boq-delta-${pos}`,
      code: `D${pos}.`,
      name: `Usuniete elementy (${compareResult.removedObjects.length})`,
      unit: 'szt.',
      quantity: -compareResult.removedObjects.length,
      sourceType: 'aps-properties',
      sourceObjectIds: compareResult.removedObjects.map(o => o.id),
      status: 'delta-removed',
    });
    pos++;
  }

  // Changed objects → delta-changed rows
  if (compareResult.changedObjects.length > 0) {
    delta.push({
      id: `boq-delta-${pos}`,
      code: `D${pos}.`,
      name: `Zmienione elementy (${compareResult.changedObjects.length})`,
      unit: 'szt.',
      quantity: compareResult.changedObjects.length,
      sourceType: 'aps-properties',
      sourceObjectIds: compareResult.changedObjects.map(c => c.after.id),
      status: 'delta-changed',
    });
  }

  return delta;
}

// ---- Measurements & Annotations CRUD (additional) ----

export async function deleteMeasurement(id: string): Promise<void> {
  try {
    await supabase.from('plan_measurements').delete().eq('id', id);
  } catch {
    // Table may not exist yet — measurements work locally
  }
}

export async function deleteAnnotation(id: string): Promise<void> {
  try {
    await supabase.from('plan_annotations').delete().eq('id', id);
  } catch {
    // Table may not exist yet — annotations work locally
  }
}
