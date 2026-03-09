/**
 * APS Takeoff Engine — Rule-based BOQ generation from Autodesk APS model data
 *
 * Architecture:
 * 1. Model Properties extraction (object tree + properties) via APS APIs
 * 2. Rule Engine — maps model elements to BOQ positions
 * 3. AI classification — normalizes messy names/families
 * 4. Zone/floor breakdown
 * 5. Delta estimation — compare versions
 */

// ── Types ────────────────────────────────────────────────

export interface ModelElement {
  dbId: number;
  name: string;
  externalId?: string;
  category?: string;
  family?: string;
  type?: string;
  layer?: string;
  blockName?: string;
  level?: string;
  system?: string;
  classification?: string;
  properties: Record<string, string | number>;
  // Geometry
  length?: number;
  area?: number;
  volume?: number;
  boundingBox?: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
}

export interface BOQItem {
  id: string;
  position: number;
  name: string;
  description?: string;
  category: BOQCategory;
  subcategory?: string;
  unit: string;
  quantity: number;
  // Traceability
  dbIds: number[];
  ruleId?: string;
  confidence: number; // 0-1, how confident we are in classification
  needsReview: boolean;
  // Metadata
  layer?: string;
  level?: string;
  zone?: string;
  blockName?: string;
  family?: string;
  type?: string;
  // Aggregates
  totalLength?: number;
  totalArea?: number;
  totalVolume?: number;
}

export type BOQCategory =
  | 'electrical_fixtures'    // gniazdka, wylaczniki
  | 'lighting'              // oswietlenie
  | 'cabling'               // okablowanie, trasy kablowe
  | 'distribution'          // rozdzielnice, tablice
  | 'telecom'               // teletechnika, LAN, CCTV
  | 'fire_safety'           // p.poz, czujki, ROP
  | 'hvac'                  // klimatyzacja, wentylacja
  | 'plumbing'              // hydraulika
  | 'structure'             // konstrukcja
  | 'architecture'          // architektura
  | 'equipment'             // urzadzenia
  | 'other';

export interface MappingRule {
  id: string;
  name: string;
  priority: number; // lower = higher priority
  conditions: RuleCondition[];
  output: {
    boqName: string;
    category: BOQCategory;
    subcategory?: string;
    unit: string;
    quantitySource: 'count' | 'length' | 'area' | 'volume' | 'property';
    quantityProperty?: string;
    description?: string;
  };
  enabled: boolean;
}

export interface RuleCondition {
  field: 'category' | 'family' | 'type' | 'layer' | 'blockName' | 'name' | 'system' | 'classification' | 'property';
  operator: 'equals' | 'contains' | 'startsWith' | 'endsWith' | 'regex' | 'exists';
  value: string;
  propertyName?: string; // for field === 'property'
  caseSensitive?: boolean;
}

export interface BOQSummary {
  items: BOQItem[];
  totalItems: number;
  totalElements: number;
  byCategory: Record<BOQCategory, { count: number; items: number }>;
  byLevel: Record<string, BOQItem[]>;
  byZone: Record<string, BOQItem[]>;
  needsReview: number;
  generatedAt: string;
  confidence: number; // average confidence
}

export interface VersionDelta {
  added: BOQItem[];
  removed: BOQItem[];
  changed: { item: BOQItem; previousQuantity: number; delta: number }[];
  summary: string;
}

// ── Default Rules (electrical projects) ──────────────────

export function getDefaultElectricalRules(): MappingRule[] {
  return [
    // Lighting
    {
      id: 'r_light_600x600',
      name: 'Oprawa LED 600x600',
      priority: 10,
      conditions: [
        { field: 'category', operator: 'contains', value: 'Lighting' },
        { field: 'name', operator: 'regex', value: '600.?x.?600|60x60|panel.?led' },
      ],
      output: { boqName: 'Oprawa LED panel 600x600', category: 'lighting', unit: 'szt.', quantitySource: 'count' },
      enabled: true,
    },
    {
      id: 'r_light_downlight',
      name: 'Downlight LED',
      priority: 11,
      conditions: [
        { field: 'category', operator: 'contains', value: 'Lighting' },
        { field: 'name', operator: 'regex', value: 'downlight|spot|oczko|wpust' },
      ],
      output: { boqName: 'Oprawa downlight LED', category: 'lighting', unit: 'szt.', quantitySource: 'count' },
      enabled: true,
    },
    {
      id: 'r_light_emergency',
      name: 'Oswietlenie awaryjne',
      priority: 12,
      conditions: [
        { field: 'name', operator: 'regex', value: 'emergency|awaryjn|ewakuac|EXIT' },
      ],
      output: { boqName: 'Oprawa oswietlenia awaryjnego', category: 'lighting', unit: 'szt.', quantitySource: 'count' },
      enabled: true,
    },
    {
      id: 'r_light_generic',
      name: 'Oprawa (ogolna)',
      priority: 19,
      conditions: [
        { field: 'category', operator: 'contains', value: 'Lighting' },
      ],
      output: { boqName: 'Oprawa oswietleniowa', category: 'lighting', unit: 'szt.', quantitySource: 'count' },
      enabled: true,
    },
    // Electrical fixtures
    {
      id: 'r_socket_double',
      name: 'Gniazdko podwojne',
      priority: 20,
      conditions: [
        { field: 'name', operator: 'regex', value: 'socket.?double|gniazd.?podw|2.?gang|duplex' },
      ],
      output: { boqName: 'Gniazdko podwojne 230V', category: 'electrical_fixtures', unit: 'szt.', quantitySource: 'count' },
      enabled: true,
    },
    {
      id: 'r_socket_single',
      name: 'Gniazdko pojedyncze',
      priority: 21,
      conditions: [
        { field: 'name', operator: 'regex', value: 'socket|gniazd|outlet|receptacle' },
      ],
      output: { boqName: 'Gniazdko 230V', category: 'electrical_fixtures', unit: 'szt.', quantitySource: 'count' },
      enabled: true,
    },
    {
      id: 'r_switch',
      name: 'Wylacznik',
      priority: 22,
      conditions: [
        { field: 'name', operator: 'regex', value: 'switch|wylacz|przycisk|przelacz' },
      ],
      output: { boqName: 'Wylacznik oswietlenia', category: 'electrical_fixtures', unit: 'szt.', quantitySource: 'count' },
      enabled: true,
    },
    // Distribution
    {
      id: 'r_panel',
      name: 'Rozdzielnica',
      priority: 30,
      conditions: [
        { field: 'name', operator: 'regex', value: 'panel|rozdziel|tablica|switchboard|distribution' },
      ],
      output: { boqName: 'Rozdzielnica elektryczna', category: 'distribution', unit: 'szt.', quantitySource: 'count' },
      enabled: true,
    },
    // Cable trays
    {
      id: 'r_cable_tray',
      name: 'Korytko kablowe',
      priority: 40,
      conditions: [
        { field: 'name', operator: 'regex', value: 'cable.?tray|korytko|koryto|drabink|tray' },
      ],
      output: { boqName: 'Korytko/drabinka kablowa', category: 'cabling', unit: 'mb', quantitySource: 'length' },
      enabled: true,
    },
    {
      id: 'r_conduit',
      name: 'Rura kablowa',
      priority: 41,
      conditions: [
        { field: 'name', operator: 'regex', value: 'conduit|rura|peszl|kana.?kab' },
      ],
      output: { boqName: 'Rura instalacyjna', category: 'cabling', unit: 'mb', quantitySource: 'length' },
      enabled: true,
    },
    // Telecom
    {
      id: 'r_data_outlet',
      name: 'Gniazdo RJ45',
      priority: 50,
      conditions: [
        { field: 'name', operator: 'regex', value: 'data|rj45|lan|ethernet|siec' },
      ],
      output: { boqName: 'Gniazdo RJ45 kat.6', category: 'telecom', unit: 'szt.', quantitySource: 'count' },
      enabled: true,
    },
    {
      id: 'r_ap',
      name: 'Access Point WiFi',
      priority: 51,
      conditions: [
        { field: 'name', operator: 'regex', value: 'access.?point|wifi|ap|wlan' },
      ],
      output: { boqName: 'Access Point WiFi', category: 'telecom', unit: 'szt.', quantitySource: 'count' },
      enabled: true,
    },
    {
      id: 'r_cctv',
      name: 'Kamera CCTV',
      priority: 52,
      conditions: [
        { field: 'name', operator: 'regex', value: 'cctv|camera|kamera|monitoring' },
      ],
      output: { boqName: 'Kamera CCTV', category: 'telecom', unit: 'szt.', quantitySource: 'count' },
      enabled: true,
    },
    // Fire safety
    {
      id: 'r_smoke_detector',
      name: 'Czujka dymu',
      priority: 60,
      conditions: [
        { field: 'name', operator: 'regex', value: 'smoke|dym|czujk|detector|czujnik.?po' },
      ],
      output: { boqName: 'Czujka dymu', category: 'fire_safety', unit: 'szt.', quantitySource: 'count' },
      enabled: true,
    },
    {
      id: 'r_manual_call_point',
      name: 'ROP (reczny ostrzegacz)',
      priority: 61,
      conditions: [
        { field: 'name', operator: 'regex', value: 'manual.?call|rop|reczny.?ostrz|break.?glass' },
      ],
      output: { boqName: 'Reczny ostrzegacz pozarowy (ROP)', category: 'fire_safety', unit: 'szt.', quantitySource: 'count' },
      enabled: true,
    },
    // Sensors
    {
      id: 'r_motion_sensor',
      name: 'Czujnik ruchu',
      priority: 70,
      conditions: [
        { field: 'name', operator: 'regex', value: 'motion|ruch|pir|occupancy|obecnosc' },
      ],
      output: { boqName: 'Czujnik ruchu/obecnosci', category: 'electrical_fixtures', unit: 'szt.', quantitySource: 'count' },
      enabled: true,
    },
  ];
}

// ── Rule Engine ──────────────────────────────────────────

function testCondition(element: ModelElement, condition: RuleCondition): boolean {
  let fieldValue = '';
  switch (condition.field) {
    case 'category': fieldValue = element.category || ''; break;
    case 'family': fieldValue = element.family || ''; break;
    case 'type': fieldValue = element.type || ''; break;
    case 'layer': fieldValue = element.layer || ''; break;
    case 'blockName': fieldValue = element.blockName || ''; break;
    case 'name': fieldValue = element.name || ''; break;
    case 'system': fieldValue = element.system || ''; break;
    case 'classification': fieldValue = element.classification || ''; break;
    case 'property': {
      const v = element.properties[condition.propertyName || ''];
      fieldValue = v != null ? String(v) : '';
      break;
    }
  }

  const val = condition.caseSensitive ? condition.value : condition.value.toLowerCase();
  const fv = condition.caseSensitive ? fieldValue : fieldValue.toLowerCase();

  switch (condition.operator) {
    case 'equals': return fv === val;
    case 'contains': return fv.includes(val);
    case 'startsWith': return fv.startsWith(val);
    case 'endsWith': return fv.endsWith(val);
    case 'exists': return fv.length > 0;
    case 'regex': {
      try {
        const flags = condition.caseSensitive ? '' : 'i';
        return new RegExp(condition.value, flags).test(fieldValue);
      } catch { return false; }
    }
  }
  return false;
}

function matchRule(element: ModelElement, rule: MappingRule): boolean {
  if (!rule.enabled) return false;
  return rule.conditions.every(c => testCondition(element, c));
}

export function applyRulesToElements(
  elements: ModelElement[],
  rules: MappingRule[]
): BOQSummary {
  const sortedRules = [...rules].sort((a, b) => a.priority - b.priority);
  const boqMap = new Map<string, BOQItem>();
  let unmatchedCount = 0;
  const matched = new Set<number>();

  for (const el of elements) {
    let foundRule: MappingRule | null = null;
    for (const rule of sortedRules) {
      if (matchRule(el, rule)) {
        foundRule = rule;
        break;
      }
    }

    if (!foundRule) {
      unmatchedCount++;
      // Auto-group unmatched by blockName or name
      const key = `_auto_${el.blockName || el.category || el.name || 'unknown'}`;
      if (!boqMap.has(key)) {
        boqMap.set(key, {
          id: key,
          position: 0,
          name: el.blockName || el.name || 'Element nierozpoznany',
          category: guessCategory(el),
          unit: 'szt.',
          quantity: 0,
          dbIds: [],
          confidence: 0.3,
          needsReview: true,
          layer: el.layer,
          level: el.level,
          blockName: el.blockName,
          family: el.family,
          type: el.type,
        });
      }
      const item = boqMap.get(key)!;
      item.quantity++;
      item.dbIds.push(el.dbId);
      matched.add(el.dbId);
      continue;
    }

    const key = foundRule.id + (el.level ? `__${el.level}` : '');
    if (!boqMap.has(key)) {
      boqMap.set(key, {
        id: key,
        position: 0,
        name: foundRule.output.boqName,
        description: foundRule.output.description,
        category: foundRule.output.category,
        subcategory: foundRule.output.subcategory,
        unit: foundRule.output.unit,
        quantity: 0,
        dbIds: [],
        ruleId: foundRule.id,
        confidence: 0.85,
        needsReview: false,
        level: el.level,
        blockName: el.blockName,
        family: el.family,
        type: el.type,
      });
    }

    const item = boqMap.get(key)!;
    item.dbIds.push(el.dbId);
    matched.add(el.dbId);

    switch (foundRule.output.quantitySource) {
      case 'count':
        item.quantity++;
        break;
      case 'length':
        item.quantity += el.length || 0;
        item.totalLength = (item.totalLength || 0) + (el.length || 0);
        break;
      case 'area':
        item.quantity += el.area || 0;
        item.totalArea = (item.totalArea || 0) + (el.area || 0);
        break;
      case 'volume':
        item.quantity += el.volume || 0;
        item.totalVolume = (item.totalVolume || 0) + (el.volume || 0);
        break;
      case 'property': {
        const pv = parseFloat(String(el.properties[foundRule.output.quantityProperty || ''] || 0));
        item.quantity += isNaN(pv) ? 0 : pv;
        break;
      }
    }
  }

  // Build sorted items
  const items = Array.from(boqMap.values())
    .filter(i => i.quantity > 0)
    .sort((a, b) => {
      const catOrder = getCategoryOrder(a.category) - getCategoryOrder(b.category);
      if (catOrder !== 0) return catOrder;
      return b.quantity - a.quantity;
    })
    .map((item, idx) => ({ ...item, position: idx + 1 }));

  // Build summary
  const byCategory: Record<string, { count: number; items: number }> = {};
  const byLevel: Record<string, BOQItem[]> = {};

  for (const item of items) {
    if (!byCategory[item.category]) byCategory[item.category] = { count: 0, items: 0 };
    byCategory[item.category].count += item.quantity;
    byCategory[item.category].items++;

    const lvl = item.level || 'Brak poziomu';
    if (!byLevel[lvl]) byLevel[lvl] = [];
    byLevel[lvl].push(item);
  }

  const avgConfidence = items.length > 0
    ? items.reduce((s, i) => s + i.confidence, 0) / items.length
    : 0;

  return {
    items,
    totalItems: items.length,
    totalElements: matched.size,
    byCategory: byCategory as any,
    byLevel,
    byZone: {},
    needsReview: items.filter(i => i.needsReview).length,
    generatedAt: new Date().toISOString(),
    confidence: avgConfidence,
  };
}

function getCategoryOrder(cat: BOQCategory): number {
  const order: Record<BOQCategory, number> = {
    lighting: 1,
    electrical_fixtures: 2,
    distribution: 3,
    cabling: 4,
    telecom: 5,
    fire_safety: 6,
    hvac: 7,
    plumbing: 8,
    equipment: 9,
    structure: 10,
    architecture: 11,
    other: 99,
  };
  return order[cat] || 99;
}

function guessCategory(el: ModelElement): BOQCategory {
  const text = `${el.name} ${el.category} ${el.family} ${el.layer} ${el.blockName}`.toLowerCase();
  if (/light|lamp|oprawa|led|lumin/.test(text)) return 'lighting';
  if (/socket|gniazd|outlet|switch|wylacz/.test(text)) return 'electrical_fixtures';
  if (/cable|kabel|tray|korytk|conduit|rura/.test(text)) return 'cabling';
  if (/panel|rozdziel|tablica|distribution/.test(text)) return 'distribution';
  if (/data|rj45|lan|wifi|cctv|kamera|ap|tele/.test(text)) return 'telecom';
  if (/smoke|fire|dym|poz|rop|czuj/.test(text)) return 'fire_safety';
  if (/hvac|vent|klima|air/.test(text)) return 'hvac';
  if (/pipe|plumb|hydr|wod/.test(text)) return 'plumbing';
  return 'other';
}

// ── Category Labels ──────────────────────────────────────

export const CATEGORY_LABELS: Record<BOQCategory, string> = {
  lighting: 'Oswietlenie',
  electrical_fixtures: 'Osprzet elektryczny',
  distribution: 'Rozdzielnice',
  cabling: 'Okablowanie i trasy',
  telecom: 'Teletechnika',
  fire_safety: 'Ochrona przeciwpozarowa',
  hvac: 'Klimatyzacja i wentylacja',
  plumbing: 'Instalacja wodna',
  equipment: 'Urzadzenia',
  structure: 'Konstrukcja',
  architecture: 'Architektura',
  other: 'Inne',
};

// ── Version Delta ────────────────────────────────────────

export function computeDelta(current: BOQSummary, previous: BOQSummary): VersionDelta {
  const prevMap = new Map(previous.items.map(i => [i.id, i]));
  const currMap = new Map(current.items.map(i => [i.id, i]));

  const added: BOQItem[] = [];
  const removed: BOQItem[] = [];
  const changed: { item: BOQItem; previousQuantity: number; delta: number }[] = [];

  for (const item of current.items) {
    const prev = prevMap.get(item.id);
    if (!prev) {
      added.push(item);
    } else if (Math.abs(item.quantity - prev.quantity) > 0.01) {
      changed.push({ item, previousQuantity: prev.quantity, delta: item.quantity - prev.quantity });
    }
  }

  for (const item of previous.items) {
    if (!currMap.has(item.id)) {
      removed.push(item);
    }
  }

  const parts: string[] = [];
  if (added.length) parts.push(`Dodano ${added.length} pozycji`);
  if (removed.length) parts.push(`Usunieto ${removed.length} pozycji`);
  if (changed.length) parts.push(`Zmieniono ${changed.length} pozycji`);

  return { added, removed, changed, summary: parts.join(', ') || 'Brak zmian' };
}

// ── Export Helpers ────────────────────────────────────────

export function exportBOQtoCSV(summary: BOQSummary, fileName?: string): void {
  const BOM = '\uFEFF';
  const header = 'Lp.;Nazwa;Kategoria;Podkategoria;Jednostka;Ilosc;Poziom;Warstwa;Blok/Rodzina;Pewnosc;Wymaga sprawdzenia\n';
  const rows = summary.items.map(item =>
    `${item.position};${item.name};${CATEGORY_LABELS[item.category] || item.category};${item.subcategory || ''};${item.unit};${formatQty(item.quantity)};${item.level || ''};${item.layer || ''};${item.blockName || item.family || ''};${Math.round(item.confidence * 100)}%;${item.needsReview ? 'TAK' : ''}`
  ).join('\n');

  const csv = BOM + header + rows;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName || `przedmiar_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function formatQty(v: number): string {
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(2);
}

// ── Anomaly Detection ────────────────────────────────────

export interface Anomaly {
  type: 'missing_related' | 'unusual_count' | 'no_cables' | 'no_distribution';
  severity: 'info' | 'warning' | 'error';
  message: string;
  relatedItems?: string[];
}

export function detectAnomalies(summary: BOQSummary): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const cats = summary.byCategory;

  // Switches but suspiciously few lights
  const switchCount = summary.items.filter(i => /wylacz|switch/i.test(i.name)).reduce((s, i) => s + i.quantity, 0);
  const lightCount = cats.lighting?.count || 0;
  if (switchCount > 0 && lightCount < switchCount * 0.5) {
    anomalies.push({
      type: 'missing_related',
      severity: 'warning',
      message: `Znaleziono ${switchCount} wylacznikow, ale tylko ${lightCount} opraw oswietleniowych. Moze brakuje opraw w modelu?`,
    });
  }

  // Outlets but no distribution
  const outletCount = cats.electrical_fixtures?.count || 0;
  const distCount = cats.distribution?.count || 0;
  if (outletCount > 10 && distCount === 0) {
    anomalies.push({
      type: 'no_distribution',
      severity: 'warning',
      message: `Znaleziono ${outletCount} punktow osprzetu, ale brak rozdzielnic w modelu.`,
    });
  }

  // Equipment but no cable trays
  const totalElectrical = (cats.lighting?.count || 0) + outletCount + (cats.telecom?.count || 0);
  const cableCount = cats.cabling?.count || 0;
  if (totalElectrical > 20 && cableCount === 0) {
    anomalies.push({
      type: 'no_cables',
      severity: 'info',
      message: `Znaleziono ${totalElectrical} urzadzen elektrycznych, ale brak tras kablowych. Czy trasy sa w osobnym pliku?`,
    });
  }

  // AP but no data points
  const apCount = summary.items.filter(i => /access.?point|wifi|ap/i.test(i.name)).reduce((s, i) => s + i.quantity, 0);
  const dataCount = summary.items.filter(i => /rj45|data|lan/i.test(i.name)).reduce((s, i) => s + i.quantity, 0);
  if (apCount > 0 && dataCount === 0) {
    anomalies.push({
      type: 'missing_related',
      severity: 'info',
      message: `Znaleziono ${apCount} Access Pointow, ale brak gniazd RJ45. Czy gniazda danych sa w modelu?`,
    });
  }

  return anomalies;
}
