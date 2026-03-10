/**
 * Kosztorys Import Parsers
 * Handles parsing of .ath, .json, .xml files and converting Gemini AI responses
 * into KosztorysCostEstimateData format.
 */

import * as XLSX from 'xlsx';
import type {
  KosztorysCostEstimateData,
  KosztorysSection,
  KosztorysPosition,
} from '../types';

import {
  createNewSection,
  createNewPosition,
  createNewResource,
  createEmptyMeasurements,
  addMeasurementEntry,
  createDefaultFactors,
  createDefaultIndirectCostsOverhead,
  createDefaultProfitOverhead,
  createDefaultPurchaseCostsOverhead,
} from './kosztorysCalculator';

// =====================================================
// Helper: parse Polish number format (comma → dot)
// =====================================================
function parsePolishNumber(str: string): number {
  if (!str || str.trim() === '') return 0;
  const cleaned = str.trim().replace(',', '.');
  const val = parseFloat(cleaned);
  return isNaN(val) ? 0 : val;
}

// =====================================================
// ATH PARSER
// =====================================================

interface AthRmsZestEntry {
  type: 'labor' | 'material' | 'equipment';
  name: string;
  unit: string;
  unitIndex: string;
  id: string;
  quantity: number;
}

interface AthSection {
  header: string;
  lines: string[];
}

/**
 * Tokenize ATH content into [SECTION] blocks with their key=value lines
 */
function tokenizeAth(content: string): AthSection[] {
  const sections: AthSection[] = [];
  let currentHeader = '';
  let currentLines: string[] = [];

  for (const rawLine of content.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const headerMatch = line.match(/^\[(.+)\]$/);
    if (headerMatch) {
      if (currentHeader) {
        sections.push({ header: currentHeader, lines: currentLines });
      }
      currentHeader = headerMatch[1];
      currentLines = [];
    } else if (currentHeader) {
      currentLines.push(line);
    }
  }
  if (currentHeader) {
    sections.push({ header: currentHeader, lines: currentLines });
  }
  return sections;
}

/**
 * Extract a key=value map from section lines
 */
function parseKeyValues(lines: string[]): Record<string, string> {
  const kv: Record<string, string> = {};
  for (const line of lines) {
    const idx = line.indexOf('=');
    if (idx > 0) {
      const key = line.substring(0, idx).trim();
      const value = line.substring(idx + 1);
      kv[key] = value;
    }
  }
  return kv;
}

/**
 * Parse an ATH file buffer into KosztorysCostEstimateData
 */
export function parseAthFile(buffer: ArrayBuffer): KosztorysCostEstimateData {
  // Decode with windows-1250 (Polish encoding used by Athenasoft/KOMA)
  const decoder = new TextDecoder('windows-1250');
  const content = decoder.decode(buffer);
  const athSections = tokenizeAth(content);

  // Phase 1: Build RMS ZEST database (resource catalog)
  const rmsZestDb: Record<number, AthRmsZestEntry> = {};
  for (const sec of athSections) {
    const match = sec.header.match(/^RMS ZEST (\d+)$/);
    if (!match) continue;
    const zestNum = parseInt(match[1], 10);
    const kv = parseKeyValues(sec.lines);

    const tyRaw = (kv['ty'] || '').split('\t')[0].trim().toUpperCase();
    let type: 'labor' | 'material' | 'equipment' = 'material';
    if (tyRaw === 'R') type = 'labor';
    else if (tyRaw === 'S') type = 'equipment';

    const name = (kv['na'] || '').split('\t')[0].trim();
    const jmParts = (kv['jm'] || '').split('\t');
    const unit = jmParts[0]?.trim() || 'szt.';
    const unitIndex = jmParts[1]?.trim() || '020';
    const id = (kv['id'] || '').split('\t')[0].trim();
    const quantity = parsePolishNumber((kv['il'] || '').split('\t')[0]);

    rmsZestDb[zestNum] = { type, name, unit, unitIndex, id, quantity };
  }

  // Phase 2: State machine to build sections, positions, resources
  const data: KosztorysCostEstimateData = {
    root: {
      sectionIds: [],
      positionIds: [],
      factors: createDefaultFactors(),
      overheads: [
        createDefaultIndirectCostsOverhead(65),
        createDefaultProfitOverhead(10),
        createDefaultPurchaseCostsOverhead(5),
      ],
    },
    sections: {},
    positions: {},
  };

  let currentElement1: KosztorysSection | null = null;
  let currentElement2: KosztorysSection | null = null;
  let currentPosition: KosztorysPosition | null = null;
  let element1Counter = 0;
  let element2Counter = 0;
  let positionCounterInSection = 0;

  // Current RMS factors (from MNOŻNIKI RMS blocks that appear after elements/positions)
  let currentFactors = { wr: 1, wm: 1, ws: 1 };

  for (const sec of athSections) {
    const kv = parseKeyValues(sec.lines);

    // --- ELEMENT 1: Top-level section ---
    if (sec.header === 'ELEMENT 1') {
      element1Counter++;
      element2Counter = 0;
      positionCounterInSection = 0;
      const name = (kv['na'] || '').trim() || `Dział ${element1Counter}`;
      const section = createNewSection(name, String(element1Counter));
      currentElement1 = section;
      currentElement2 = null;
      currentPosition = null;
      data.sections[section.id] = section;
      data.root.sectionIds.push(section.id);
    }

    // --- ELEMENT 2: Subsection under current ELEMENT 1 ---
    else if (sec.header === 'ELEMENT 2') {
      if (!currentElement1) continue;
      element2Counter++;
      positionCounterInSection = 0;
      const name = (kv['na'] || '').trim() || `Poddział ${element2Counter}`;
      const ordinal = `${currentElement1.ordinalNumber}.${element2Counter}`;
      const section = createNewSection(name, ordinal);
      currentElement2 = section;
      currentPosition = null;
      data.sections[section.id] = section;
      currentElement1.subsectionIds.push(section.id);
    }

    // --- POZYCJA: Position ---
    else if (sec.header === 'POZYCJA') {
      positionCounterInSection++;
      const pdRaw = kv['pd'] || '';
      // pd= has two known formats:
      //   Old: "\tKNR 4-03 0313-10\t\t\t\t" (full code in field 1)
      //   New: "source\tKNR\t2-01 0122-02\t2-01\t0122-02\t\t1" (type in field 1, number in field 2)
      //   Simple: "\t\t1.1\t\t1.1\t\t0" (no type, just numbering)
      const pdParts = pdRaw.split('\t');
      let base = '';
      if (pdParts.length >= 3) {
        const typeField = (pdParts[1] || '').trim();
        const numField = (pdParts[2] || '').trim();
        // Known short KNR type codes (exact match, no spaces)
        if (typeField && /^(KNR|KNR-W|KNNR|KNNR-W|KSNR|KNP|KNCK|KPRR|KNZ|NNRNKB|S-\d+|E-\d+)$/.test(typeField) && numField) {
          base = `${typeField} ${numField}`;
        } else if (typeField) {
          base = typeField;
        } else if (numField) {
          base = numField;
        }
      } else if (pdParts.length >= 2) {
        base = (pdParts[1] || '').trim();
      }
      const name = (kv['na'] || '').trim().replace(/10+$/g, ' ').trim() || 'Pozycja';
      const jmParts = (kv['jm'] || '').split('\t');
      const unitLabel = jmParts[0]?.trim() || 'szt.';
      const unitIndex = jmParts[1]?.trim() || '020';

      const position = createNewPosition(base, name, unitLabel, unitIndex || '020');
      currentPosition = position;
      data.positions[position.id] = position;

      // Assign to nearest parent section
      const parentSection = currentElement2 || currentElement1;
      if (parentSection) {
        parentSection.positionIds.push(position.id);
      } else {
        data.root.positionIds.push(position.id);
      }
    }

    // --- PRZEDMIAR: Measurement ---
    else if (sec.header === 'PRZEDMIAR') {
      if (!currentPosition) continue;
      // wo format: "7.00\t1\t7\t\t\t\t\t" or "5.00\t1\t5\t\t\t\t\t"
      const woRaw = kv['wo'] || '';
      const woParts = woRaw.split('\t');
      const expression = (woParts[0] || '').trim().replace(',', '.');

      if (expression) {
        currentPosition.measurements = addMeasurementEntry(
          currentPosition.measurements,
          expression,
          null
        );
      }
    }

    // --- MNOŻNIKI RMS: Labor/material/equipment factors ---
    else if (sec.header === 'MNOŻNIKI RMS' || (sec.header.includes('MNO') && sec.header.includes('RMS') && !sec.header.includes('ZEST'))) {
      currentFactors = {
        wr: parsePolishNumber((kv['wr'] || '1').split('\t')[0]),
        wm: parsePolishNumber((kv['wm'] || '1').split('\t')[0]),
        ws: parsePolishNumber((kv['ws'] || '1').split('\t')[0]),
      };
    }

    // --- RMS N (not ZEST): Resource reference ---
    else if (/^RMS \d+$/.test(sec.header)) {
      if (!currentPosition) continue;
      const rmsNum = parseInt(sec.header.replace('RMS ', ''), 10);
      const zestEntry = rmsZestDb[rmsNum];
      if (!zestEntry) continue;

      const normRaw = kv['nz'] || '0';
      const normValue = parsePolishNumber(normRaw.split('\t')[0]);

      // np field: 1 = percentage auxiliary, 2 = regular
      const npVal = parseInt(kv['np'] || '0', 10);

      const resource = createNewResource(
        zestEntry.type,
        zestEntry.name,
        normValue,
        0, // unit price not stored in ATH ślepy (blind estimate)
        zestEntry.unit,
        zestEntry.unitIndex
      );

      // Set resource index for price lookup (from RMS ZEST id field)
      if (zestEntry.id) {
        resource.index = zestEntry.id;
        resource.originIndex = { type: 'knr', index: zestEntry.id };
      }

      // Apply factor from current MNOŻNIKI RMS
      if (zestEntry.type === 'labor' && currentFactors.wr !== 1) {
        resource.factor = currentFactors.wr;
      } else if (zestEntry.type === 'material' && currentFactors.wm !== 1) {
        resource.factor = currentFactors.wm;
      } else if (zestEntry.type === 'equipment' && currentFactors.ws !== 1) {
        resource.factor = currentFactors.ws;
      }

      // If np=1, it's a percentage-type resource (auxiliary materials etc.)
      if (npVal === 1) {
        resource.norm = { type: 'relative', value: normValue };
      }

      currentPosition.resources.push(resource);
    }
  }

  return data;
}

// =====================================================
// JSON PARSER
// =====================================================

/**
 * Parse a JSON file text into KosztorysCostEstimateData
 */
export function parseJsonFile(text: string): KosztorysCostEstimateData {
  const parsed = JSON.parse(text);

  // Validate basic structure
  if (!parsed.root || !parsed.sections || !parsed.positions) {
    throw new Error('Nieprawidłowa struktura pliku JSON. Wymagane pola: root, sections, positions');
  }

  // Ensure root has required fields with defaults
  const data: KosztorysCostEstimateData = {
    root: {
      sectionIds: parsed.root.sectionIds || [],
      positionIds: parsed.root.positionIds || [],
      factors: parsed.root.factors || createDefaultFactors(),
      overheads: parsed.root.overheads || [
        createDefaultIndirectCostsOverhead(65),
        createDefaultProfitOverhead(10),
        createDefaultPurchaseCostsOverhead(5),
      ],
    },
    sections: {},
    positions: {},
  };

  // Copy sections with defaults
  for (const [id, sec] of Object.entries(parsed.sections)) {
    const s = sec as any;
    data.sections[id] = {
      id,
      name: s.name || 'Dział',
      description: s.description || '',
      ordinalNumber: s.ordinalNumber || '1',
      positionIds: s.positionIds || [],
      subsectionIds: s.subsectionIds || [],
      factors: s.factors || createDefaultFactors(),
      overheads: s.overheads || [],
    };
  }

  // Copy positions with defaults
  for (const [id, pos] of Object.entries(parsed.positions)) {
    const p = pos as any;
    data.positions[id] = {
      id,
      base: p.base || '',
      originBase: p.originBase || p.base || '',
      name: p.name || 'Pozycja',
      marker: p.marker || null,
      unit: p.unit || { label: 'szt.', unitIndex: '020' },
      measurements: p.measurements || createEmptyMeasurements(),
      multiplicationFactor: p.multiplicationFactor ?? 1,
      resources: p.resources || [],
      factors: p.factors || createDefaultFactors(),
      overheads: p.overheads || [],
      unitPrice: p.unitPrice || { value: 0, currency: 'PLN' },
    };
  }

  return data;
}

// =====================================================
// XML PARSER
// =====================================================

/**
 * Parse an XML file text into KosztorysCostEstimateData
 */
export function parseXmlFile(text: string): KosztorysCostEstimateData {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'text/xml');

  const data: KosztorysCostEstimateData = {
    root: {
      sectionIds: [],
      positionIds: [],
      factors: createDefaultFactors(),
      overheads: [
        createDefaultIndirectCostsOverhead(65),
        createDefaultProfitOverhead(10),
        createDefaultPurchaseCostsOverhead(5),
      ],
    },
    sections: {},
    positions: {},
  };

  // Try to detect XML format by root element
  const rootEl = doc.documentElement;
  if (!rootEl || rootEl.nodeName === 'parsererror') {
    throw new Error('Nieprawidłowy format pliku XML');
  }

  // Look for common Polish cost estimate XML patterns
  const sectionElements = doc.querySelectorAll('Dzial, Element, Section, dzial, element, section');
  const positionElements = doc.querySelectorAll('Pozycja, Position, pozycja, position');

  if (sectionElements.length === 0 && positionElements.length === 0) {
    throw new Error('Nie znaleziono działów ani pozycji w pliku XML');
  }

  let sectionCounter = 0;

  // Parse sections
  sectionElements.forEach((sectionEl) => {
    sectionCounter++;
    const name = sectionEl.getAttribute('nazwa') || sectionEl.getAttribute('name') ||
      sectionEl.querySelector('Nazwa, nazwa, Name, name')?.textContent?.trim() ||
      `Dział ${sectionCounter}`;
    const ordinal = sectionEl.getAttribute('numer') || sectionEl.getAttribute('ordinal') || String(sectionCounter);

    const section = createNewSection(name, ordinal);
    data.sections[section.id] = section;
    data.root.sectionIds.push(section.id);

    // Parse positions within section
    const innerPositions = sectionEl.querySelectorAll(':scope > Pozycja, :scope > pozycja, :scope > Position, :scope > position');
    innerPositions.forEach((posEl) => {
      const pos = parseXmlPosition(posEl);
      data.positions[pos.id] = pos;
      section.positionIds.push(pos.id);
    });

    // Parse subsections
    const innerSections = sectionEl.querySelectorAll(':scope > Dzial, :scope > dzial, :scope > Element, :scope > element, :scope > Poddzial, :scope > poddzial');
    innerSections.forEach((subEl, subIdx) => {
      const subName = subEl.getAttribute('nazwa') || subEl.getAttribute('name') ||
        subEl.querySelector('Nazwa, nazwa')?.textContent?.trim() ||
        `Poddział ${subIdx + 1}`;
      const sub = createNewSection(subName, `${ordinal}.${subIdx + 1}`);
      data.sections[sub.id] = sub;
      section.subsectionIds.push(sub.id);

      const subPositions = subEl.querySelectorAll(':scope > Pozycja, :scope > pozycja, :scope > Position');
      subPositions.forEach((posEl) => {
        const pos = parseXmlPosition(posEl);
        data.positions[pos.id] = pos;
        sub.positionIds.push(pos.id);
      });
    });
  });

  // Parse standalone positions (not within sections)
  if (sectionElements.length === 0) {
    positionElements.forEach((posEl) => {
      const pos = parseXmlPosition(posEl);
      data.positions[pos.id] = pos;
      data.root.positionIds.push(pos.id);
    });
  }

  return data;
}

function parseXmlPosition(el: Element): KosztorysPosition {
  const base = el.getAttribute('podstawa') || el.getAttribute('base') ||
    el.querySelector('Podstawa, podstawa, Base, base')?.textContent?.trim() || '';
  const name = el.getAttribute('nazwa') || el.getAttribute('name') ||
    el.querySelector('Nazwa, nazwa, Name, name, Opis, opis')?.textContent?.trim() || 'Pozycja';
  const unit = el.getAttribute('jednostka') || el.getAttribute('unit') ||
    el.querySelector('Jednostka, jednostka, Unit, unit, Jm, jm')?.textContent?.trim() || 'szt.';
  const qtyStr = el.getAttribute('ilosc') || el.getAttribute('quantity') ||
    el.querySelector('Ilosc, ilosc, Quantity, quantity, Obmiar')?.textContent?.trim() || '0';

  const position = createNewPosition(base, name, unit);
  const qty = parsePolishNumber(qtyStr);
  if (qty > 0) {
    position.measurements = addMeasurementEntry(position.measurements, String(qty), null);
  }

  // Parse resources within position
  const resourceEls = el.querySelectorAll('Naklad, naklad, Resource, resource, RMS, rms');
  resourceEls.forEach((resEl) => {
    const resTypeRaw = (resEl.getAttribute('typ') || resEl.getAttribute('type') ||
      resEl.querySelector('Typ, typ, Type, type')?.textContent?.trim() || 'M').toUpperCase();
    let resType: 'labor' | 'material' | 'equipment' = 'material';
    if (resTypeRaw === 'R' || resTypeRaw.startsWith('ROBOC') || resTypeRaw === 'LABOR') resType = 'labor';
    else if (resTypeRaw === 'S' || resTypeRaw.startsWith('SPRZ') || resTypeRaw === 'EQUIPMENT') resType = 'equipment';

    const resName = resEl.getAttribute('nazwa') || resEl.getAttribute('name') ||
      resEl.querySelector('Nazwa, nazwa')?.textContent?.trim() || '';
    const normStr = resEl.getAttribute('norma') || resEl.getAttribute('norm') ||
      resEl.querySelector('Norma, norma, Norm')?.textContent?.trim() || '1';
    const resIndex = resEl.getAttribute('indeks') || resEl.getAttribute('index') ||
      resEl.querySelector('Indeks, indeks, Index, index')?.textContent?.trim() || '';

    const resource = createNewResource(resType, resName, parsePolishNumber(normStr));
    if (resIndex) {
      resource.index = resIndex;
      resource.originIndex = { type: 'knr', index: resIndex };
    }
    position.resources.push(resource);
  });

  return position;
}

// =====================================================
// XLSX PARSER — with column mapping preview
// =====================================================

export interface XlsxColumnMapping {
  colLp: number;
  colBase: number;
  colName: number;
  colUnit: number;
  colQty: number;
  headerRowIdx: number;
}

export interface XlsxPreview {
  sheetNames: string[];
  activeSheet: string;
  totalRows: number;
  totalCols: number;
  headerRow: string[];
  previewRows: string[][];  // first 15 data rows
  autoMapping: XlsxColumnMapping;
  allRows: any[][];  // raw rows for later parsing
}

/**
 * Preview XLSX file — returns sheet info, auto-detected columns, and sample rows.
 * The user can then adjust the mapping before final parse.
 */
export function previewXlsxFile(buffer: ArrayBuffer): XlsxPreview {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('Plik XLSX nie zawiera żadnych arkuszy');
  const sheet = workbook.Sheets[sheetName];
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  if (rows.length < 2) throw new Error('Plik XLSX jest pusty lub zawiera zbyt mało danych');

  // Find max column count
  let maxCols = 0;
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    if (rows[r]?.length > maxCols) maxCols = rows[r].length;
  }

  // Auto-detect header row and column indices
  const mapping = autoDetectXlsxColumns(rows, maxCols);

  const headerRow = rows[mapping.headerRowIdx]?.map((c: any) => String(c ?? '').trim()) || [];
  const previewRows: string[][] = [];
  for (let r = mapping.headerRowIdx + 1; r < Math.min(rows.length, mapping.headerRowIdx + 16); r++) {
    if (rows[r]) previewRows.push(rows[r].map((c: any) => String(c ?? '').trim()));
  }

  return {
    sheetNames: workbook.SheetNames,
    activeSheet: sheetName,
    totalRows: rows.length,
    totalCols: maxCols,
    headerRow,
    previewRows,
    autoMapping: mapping,
    allRows: rows,
  };
}

function autoDetectXlsxColumns(rows: any[][], maxCols: number): XlsxColumnMapping {
  let headerRowIdx = -1;
  let colLp = -1, colBase = -1, colName = -1, colUnit = -1, colQty = -1;

  const lpPatterns = /^(lp\.?|nr\.?|l\.?\s?p\.?|numer|poz\.?|nr\s+poz)$/i;
  const basePatterns = /^(podstawa|baza|base|katalog|knnr?|knr|norma|numer\s+kat)$/i;
  const namePatterns = /^(opis|nazwa|name|description|pozycja|tytu[lł]|opis\s+pozycji|opis\s+rob[oó]t|wyszczeg[oó]lnienie|tre[sś][cć])$/i;
  const unitPatterns = /^(j\.?\s?m\.?|jedn\.?|jednostka|unit|jm)$/i;
  const qtyPatterns = /^(ilo[sś][cć]|nak[lł]ad|naklad|quantity|qty|ilosc|przedmiar|obmiar|ilo[sś][cć]\s+rob[oó]t)$/i;

  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const row = rows[r];
    if (!row || row.length < 3) continue;

    // Reset for this candidate header
    let cLp = -1, cBase = -1, cName = -1, cUnit = -1, cQty = -1;
    let matchCount = 0;

    for (let c = 0; c < row.length; c++) {
      const cell = String(row[c] ?? '').trim();
      if (!cell) continue;
      if (lpPatterns.test(cell)) { cLp = c; matchCount++; }
      else if (basePatterns.test(cell)) { cBase = c; matchCount++; }
      else if (namePatterns.test(cell)) { cName = c; matchCount++; }
      else if (unitPatterns.test(cell)) { cUnit = c; matchCount++; }
      else if (qtyPatterns.test(cell)) { cQty = c; matchCount++; }
    }
    if (matchCount >= 2) {
      headerRowIdx = r;
      colLp = cLp; colBase = cBase; colName = cName; colUnit = cUnit; colQty = cQty;
      break;
    }
  }

  // Fallback: use heuristics on data content
  if (headerRowIdx === -1) {
    headerRowIdx = 0;
    // Find the column with longest text strings — likely "name"
    const textLengths: number[] = new Array(maxCols).fill(0);
    const numericCounts: number[] = new Array(maxCols).fill(0);
    const shortTextCounts: number[] = new Array(maxCols).fill(0);

    for (let r = 1; r < Math.min(rows.length, 30); r++) {
      for (let c = 0; c < (rows[r]?.length || 0); c++) {
        const val = rows[r][c];
        const str = String(val ?? '').trim();
        textLengths[c] += str.length;
        if (typeof val === 'number' || /^\d+([.,]\d+)?$/.test(str)) numericCounts[c]++;
        if (str.length > 0 && str.length <= 8) shortTextCounts[c]++;
      }
    }

    // Name = column with highest total text length (excluding pure numeric)
    let maxTextLen = 0;
    for (let c = 0; c < maxCols; c++) {
      if (textLengths[c] > maxTextLen && numericCounts[c] < 10) {
        maxTextLen = textLengths[c];
        colName = c;
      }
    }

    // Unit = short text column (2-5 chars typically) that's not Lp or Name
    for (let c = 0; c < maxCols; c++) {
      if (c === colName) continue;
      const avgLen = textLengths[c] / Math.max(1, Math.min(rows.length - 1, 29));
      if (avgLen >= 1 && avgLen <= 6 && shortTextCounts[c] > 5 && numericCounts[c] < 5) {
        colUnit = c;
        break;
      }
    }

    // Qty = mostly numeric column that's not Lp
    for (let c = maxCols - 1; c >= 0; c--) {
      if (c === colName && c === colUnit) continue;
      if (numericCounts[c] > 10) { colQty = c; break; }
    }

    // Lp = first column or first small-int column
    colLp = 0;
  }

  return { colLp, colBase, colName, colUnit, colQty, headerRowIdx };
}

/**
 * Parse XLSX with explicit column mapping (after user review/adjustment).
 */
export function parseXlsxWithMapping(
  rows: any[][],
  mapping: XlsxColumnMapping
): KosztorysCostEstimateData {
  const { colLp, colBase, colName, colUnit, colQty, headerRowIdx } = mapping;

  interface RawRow {
    lp: string;
    base: string;
    name: string;
    unit: string;
    qty: number;
    rowIdx: number;
  }

  const dataRows: RawRow[] = [];
  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const name = colName >= 0 ? String(row[colName] ?? '').trim() : '';
    if (!name) continue;

    const lp = colLp >= 0 ? String(row[colLp] ?? '').trim() : '';
    const base = colBase >= 0 ? String(row[colBase] ?? '').trim() : '';
    const unit = colUnit >= 0 ? String(row[colUnit] ?? '').trim() : '';
    const qtyRaw = colQty >= 0 ? row[colQty] : 0;
    const qty = typeof qtyRaw === 'number' ? qtyRaw : parsePolishNumber(String(qtyRaw));

    dataRows.push({ lp, base, name, unit, qty, rowIdx: r });
  }

  if (dataRows.length === 0) throw new Error('Nie znaleziono danych w pliku XLSX');

  const result: KosztorysCostEstimateData = {
    root: {
      sectionIds: [],
      positionIds: [],
      factors: createDefaultFactors(),
      overheads: [
        createDefaultIndirectCostsOverhead(65),
        createDefaultProfitOverhead(10),
        createDefaultPurchaseCostsOverhead(5),
      ],
    },
    sections: {},
    positions: {},
  };

  let currentSection: KosztorysSection | null = null;
  let currentSubsection: KosztorysSection | null = null;
  let sectionCounter = 0;
  let subsectionCounter = 0;

  // Detect if a row is a section (dział) or subsection (poddział) header
  type SectionLevel = 'section' | 'subsection' | 'position';
  const classifyRow = (row: RawRow): SectionLevel => {
    const noUnit = !row.unit;
    const noQty = row.qty === 0;
    const noBase = !row.base;

    // Name-based detection: "Dział", "Rozdział", "Element" = section; "Poddział", "Oddział" = subsection
    if (/^(dzia[lł]|rozdzia[lł]|element)\s/i.test(row.name) && noUnit) return 'section';
    if (/^(poddzia[lł]|oddzia[lł]|podrozdzia[lł])\s/i.test(row.name) && noUnit) return 'subsection';

    // Roman numeral without unit/qty/base — top-level section
    if (/^[IVXLCDM]+\.?$/i.test(row.lp) && noUnit && noQty && noBase) return 'section';

    // Hierarchical numbering: "1.1", "2.3" etc — subsection; plain "1", "2" — section
    if (noUnit && noQty && noBase) {
      if (/^\d+\.\d+/.test(row.lp)) return 'subsection';
      if (/^\d+$/.test(row.lp)) return 'section';
    }

    // Long name (>40 chars) without unit/qty/base and no Lp number — could be a section/subsection title
    // Only if inside a section and the name is clearly descriptive (no digits-only name)
    if (noUnit && noQty && noBase && !row.lp && row.name.length > 30 && !/^\d+$/.test(row.name)) {
      // If we already have a section, treat as subsection; otherwise section
      return currentSection ? 'subsection' : 'section';
    }

    return 'position';
  };

  for (const row of dataRows) {
    const level = classifyRow(row);

    if (level === 'section') {
      sectionCounter++;
      subsectionCounter = 0;
      currentSubsection = null;
      const section = createNewSection(row.name, row.lp || String(sectionCounter));
      result.sections[section.id] = section;
      result.root.sectionIds.push(section.id);
      currentSection = section;
    } else if (level === 'subsection') {
      subsectionCounter++;
      if (!currentSection) {
        // Create a parent section if we encounter a subsection without one
        sectionCounter++;
        const section = createNewSection('Dział 1', '1');
        result.sections[section.id] = section;
        result.root.sectionIds.push(section.id);
        currentSection = section;
      }
      const ordinal = row.lp || `${currentSection.ordinalNumber}.${subsectionCounter}`;
      const subsection = createNewSection(row.name, ordinal);
      result.sections[subsection.id] = subsection;
      currentSection.subsectionIds.push(subsection.id);
      currentSubsection = subsection;
    } else {
      // It's a position — add to subsection if exists, otherwise section
      if (!currentSection) {
        sectionCounter++;
        const section = createNewSection('Dział 1', '1');
        result.sections[section.id] = section;
        result.root.sectionIds.push(section.id);
        currentSection = section;
      }

      const position = createNewPosition(
        row.base || '',
        row.name,
        row.unit || 'szt.'
      );

      if (row.qty > 0) {
        position.measurements = addMeasurementEntry(
          position.measurements,
          String(row.qty),
          null
        );
      }

      result.positions[position.id] = position;
      const targetSection = currentSubsection || currentSection;
      targetSection.positionIds.push(position.id);
    }
  }

  return result;
}

/**
 * Backward-compatible wrapper: auto-detect columns and parse in one step.
 */
export function parseXlsxFile(buffer: ArrayBuffer): KosztorysCostEstimateData {
  const preview = previewXlsxFile(buffer);
  return parseXlsxWithMapping(preview.allRows, preview.autoMapping);
}

// =====================================================
// GEMINI RESPONSE CONVERTER
// =====================================================

interface GeminiSection {
  name: string;
  ordinal?: string;
  subsections?: GeminiSection[];
  positions?: GeminiPosition[];
}

interface GeminiPosition {
  base?: string;
  name: string;
  unit?: string;
  quantity?: number;
  resources?: GeminiResource[];
}

interface GeminiResource {
  type?: string;
  name: string;
  norm?: number;
  unit?: string;
}

interface GeminiKosztorysResponse {
  title?: string;
  sections: GeminiSection[];
}

/**
 * Convert Gemini AI response into KosztorysCostEstimateData
 */
export function convertGeminiResponseToEstimate(data: GeminiKosztorysResponse): KosztorysCostEstimateData {
  const result: KosztorysCostEstimateData = {
    root: {
      sectionIds: [],
      positionIds: [],
      factors: createDefaultFactors(),
      overheads: [
        createDefaultIndirectCostsOverhead(65),
        createDefaultProfitOverhead(10),
        createDefaultPurchaseCostsOverhead(5),
      ],
    },
    sections: {},
    positions: {},
  };

  if (!data.sections || !Array.isArray(data.sections)) {
    return result;
  }

  data.sections.forEach((secData, sIdx) => {
    const section = createNewSection(
      secData.name || `Dział ${sIdx + 1}`,
      secData.ordinal || String(sIdx + 1)
    );
    result.sections[section.id] = section;
    result.root.sectionIds.push(section.id);

    // Parse positions within section
    if (secData.positions && Array.isArray(secData.positions)) {
      secData.positions.forEach((posData) => {
        const pos = convertGeminiPosition(posData);
        result.positions[pos.id] = pos;
        section.positionIds.push(pos.id);
      });
    }

    // Parse subsections
    if (secData.subsections && Array.isArray(secData.subsections)) {
      secData.subsections.forEach((subData, subIdx) => {
        const sub = createNewSection(
          subData.name || `Poddział ${subIdx + 1}`,
          `${section.ordinalNumber}.${subIdx + 1}`
        );
        result.sections[sub.id] = sub;
        section.subsectionIds.push(sub.id);

        if (subData.positions && Array.isArray(subData.positions)) {
          subData.positions.forEach((posData) => {
            const pos = convertGeminiPosition(posData);
            result.positions[pos.id] = pos;
            sub.positionIds.push(pos.id);
          });
        }
      });
    }
  });

  return result;
}

function convertGeminiPosition(posData: GeminiPosition): KosztorysPosition {
  const position = createNewPosition(
    posData.base || '',
    posData.name || 'Pozycja',
    posData.unit || 'szt.'
  );

  if (posData.quantity && posData.quantity > 0) {
    position.measurements = addMeasurementEntry(
      position.measurements,
      String(posData.quantity),
      null
    );
  }

  if (posData.resources && Array.isArray(posData.resources)) {
    posData.resources.forEach((resData) => {
      const typeRaw = (resData.type || 'material').toLowerCase();
      let type: 'labor' | 'material' | 'equipment' = 'material';
      if (typeRaw === 'labor' || typeRaw === 'r' || typeRaw.startsWith('roboc')) type = 'labor';
      else if (typeRaw === 'equipment' || typeRaw === 's' || typeRaw.startsWith('sprz')) type = 'equipment';

      const resource = createNewResource(
        type,
        resData.name || '',
        resData.norm ?? 1,
        0,
        resData.unit || undefined
      );
      position.resources.push(resource);
    });
  }

  return position;
}
