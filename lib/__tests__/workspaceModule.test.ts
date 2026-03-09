/**
 * Workspace Module — Comprehensive Tests
 * Tests: Types, Reducer, API logic, Business rules, Data sync, Filters
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  workspaceReducer, INITIAL_WORKSPACE_STATE,
  type WorkspaceState, type DrawingObject, type BoqRow, type AiSuggestion,
  type MeasurementItem, type AnnotationItem, type CommentThread,
  type VersionCompareResult, type WorkspaceError, type MappingRule,
  type WorkspaceFilters, DEFAULT_FILTERS,
} from '../../components/construction/workspace/WorkspaceTypes';
import * as api from '../../components/construction/workspace/workspaceApi';

// ==================== MOCK DATA ====================

const mockObject = (overrides: Partial<DrawingObject> = {}): DrawingObject => ({
  id: `obj-${Math.random().toString(36).slice(2, 8)}`,
  fileId: 'file-1',
  name: 'LED Panel 60x60',
  category: 'Lighting',
  family: 'LED Panel',
  type: 'Recessed',
  level: 'Level 1',
  zone: 'Zone A',
  layer: 'E-LIGHTING',
  system: 'Electrical',
  geometryType: 'block',
  quantityBasis: 'count',
  aiStatus: 'recognized',
  aiConfidence: 0.92,
  rawProperties: { power: '40W', voltage: '230V' },
  ...overrides,
});

const mockBoqRow = (overrides: Partial<BoqRow> = {}): BoqRow => ({
  id: `boq-${Math.random().toString(36).slice(2, 8)}`,
  code: 'E.1.1',
  name: 'Oprawa LED 60x60',
  unit: 'szt',
  quantity: 10,
  sourceType: 'aps-properties',
  sourceObjectIds: ['obj-1', 'obj-2'],
  confidence: 0.85,
  status: 'auto-generated',
  category: 'Lighting',
  ...overrides,
});

const mockRule = (overrides: Partial<MappingRule> = {}): MappingRule => ({
  id: `rule-${Math.random().toString(36).slice(2, 8)}`,
  name: 'LED Panels',
  active: true,
  priority: 1,
  conditions: [{ field: 'category', operator: 'equals', value: 'Lighting' }],
  targetBoqName: 'Oprawa LED',
  targetUnit: 'szt',
  targetCategory: 'Electrical',
  aggregationMode: 'count',
  ...overrides,
});

const mockMeasurement = (overrides: Partial<MeasurementItem> = {}): MeasurementItem => ({
  id: `meas-${Date.now()}`,
  type: 'length',
  value: 5200,
  unit: 'mm',
  label: 'Wall A',
  createdBy: 'user-1',
  createdAt: new Date().toISOString(),
  ...overrides,
});

const mockAnnotation = (overrides: Partial<AnnotationItem> = {}): AnnotationItem => ({
  id: `ann-${Date.now()}`,
  type: 'rectangle',
  geometry: { points: [{ x: 100, y: 100 }, { x: 200, y: 200 }] },
  strokeColor: '#ef4444',
  strokeWidth: 2,
  createdBy: 'user-1',
  createdAt: new Date().toISOString(),
  ...overrides,
});

// ==================== 1. WORKSPACE REDUCER TESTS ====================

describe('workspaceReducer', () => {
  let state: WorkspaceState;

  beforeEach(() => {
    state = { ...INITIAL_WORKSPACE_STATE };
  });

  describe('File selection', () => {
    it('SET_ACTIVE_FILE resets workspace state', () => {
      state.selectedObjectIds = ['obj-1'];
      state.rightTab = 'boq';
      const next = workspaceReducer(state, { type: 'SET_ACTIVE_FILE', fileId: 'file-2' });
      expect(next.activeFileId).toBe('file-2');
      expect(next.selectedObjectIds).toEqual([]);
      expect(next.rightTab).toBe('overview');
    });

    it('SET_ACTIVE_FILE preserves leftPanelOpen', () => {
      state.leftPanelOpen = false;
      const next = workspaceReducer(state, { type: 'SET_ACTIVE_FILE', fileId: 'file-2' });
      expect(next.leftPanelOpen).toBe(false);
    });
  });

  describe('Object selection', () => {
    it('SET_SELECTED_OBJECTS sets ids', () => {
      const next = workspaceReducer(state, { type: 'SET_SELECTED_OBJECTS', ids: ['a', 'b'] });
      expect(next.selectedObjectIds).toEqual(['a', 'b']);
    });

    it('ADD_SELECTED_OBJECT appends', () => {
      state.selectedObjectIds = ['a'];
      const next = workspaceReducer(state, { type: 'ADD_SELECTED_OBJECT', id: 'b' });
      expect(next.selectedObjectIds).toEqual(['a', 'b']);
    });

    it('REMOVE_SELECTED_OBJECT removes', () => {
      state.selectedObjectIds = ['a', 'b', 'c'];
      const next = workspaceReducer(state, { type: 'REMOVE_SELECTED_OBJECT', id: 'b' });
      expect(next.selectedObjectIds).toEqual(['a', 'c']);
    });

    it('SELECT_OBJECT_AND_SHOW_PROPS sets object and switches tab', () => {
      const next = workspaceReducer(state, { type: 'SELECT_OBJECT_AND_SHOW_PROPS', id: 'obj-1' });
      expect(next.selectedObjectIds).toEqual(['obj-1']);
      expect(next.rightTab).toBe('properties');
      expect(next.rightPanelOpen).toBe(true);
    });
  });

  describe('BOQ row selection sync', () => {
    it('SELECT_BOQ_ROW_AND_HIGHLIGHT sets row and objects', () => {
      const next = workspaceReducer(state, {
        type: 'SELECT_BOQ_ROW_AND_HIGHLIGHT',
        rowId: 'boq-1',
        sourceObjectIds: ['obj-1', 'obj-2'],
      });
      expect(next.selectedBoqRowId).toBe('boq-1');
      expect(next.selectedObjectIds).toEqual(['obj-1', 'obj-2']);
      expect(next.rightTab).toBe('boq');
    });
  });

  describe('Viewer mode', () => {
    it('SET_VIEWER_MODE changes mode', () => {
      const next = workspaceReducer(state, { type: 'SET_VIEWER_MODE', mode: 'ai-overlay' });
      expect(next.viewerMode).toBe('ai-overlay');
    });
  });

  describe('Filters', () => {
    it('SET_FILTERS merges partial filters', () => {
      const next = workspaceReducer(state, { type: 'SET_FILTERS', filters: { onlyAiRecognized: true } });
      expect(next.filters.onlyAiRecognized).toBe(true);
      expect(next.filters.onlyBoqLinked).toBe(false); // unchanged
    });

    it('SET_FILTERS can update multiple fields', () => {
      const next = workspaceReducer(state, {
        type: 'SET_FILTERS',
        filters: { layers: ['E-LIGHTING'], categories: ['Lighting'], confidenceThreshold: 0.5 },
      });
      expect(next.filters.layers).toEqual(['E-LIGHTING']);
      expect(next.filters.categories).toEqual(['Lighting']);
      expect(next.filters.confidenceThreshold).toBe(0.5);
    });
  });

  describe('Status management', () => {
    it('SET_STATUS updates specific status', () => {
      const next = workspaceReducer(state, { type: 'SET_STATUS', key: 'analysisStatus', status: 'loading' });
      expect(next.analysisStatus).toBe('loading');
      expect(next.conversionStatus).toBe('idle');
    });

    it('SET_PROGRESS updates progress value', () => {
      const next = workspaceReducer(state, { type: 'SET_PROGRESS', key: 'conversionProgress', value: 75 });
      expect(next.conversionProgress).toBe(75);
    });
  });

  describe('Panel toggles', () => {
    it('TOGGLE_LEFT_PANEL flips', () => {
      expect(state.leftPanelOpen).toBe(true);
      const next = workspaceReducer(state, { type: 'TOGGLE_LEFT_PANEL' });
      expect(next.leftPanelOpen).toBe(false);
    });

    it('SET_RIGHT_TAB opens panel and sets tab', () => {
      state.rightPanelOpen = false;
      const next = workspaceReducer(state, { type: 'SET_RIGHT_TAB', tab: 'ai' });
      expect(next.rightPanelOpen).toBe(true);
      expect(next.rightTab).toBe('ai');
    });
  });

  describe('Rule editor', () => {
    it('OPEN_RULE_EDITOR sets state', () => {
      const next = workspaceReducer(state, { type: 'OPEN_RULE_EDITOR', ruleId: 'rule-1' });
      expect(next.ruleEditorOpen).toBe(true);
      expect(next.editingRuleId).toBe('rule-1');
    });

    it('CLOSE_RULE_EDITOR resets', () => {
      state.ruleEditorOpen = true;
      state.editingRuleId = 'rule-1';
      const next = workspaceReducer(state, { type: 'CLOSE_RULE_EDITOR' });
      expect(next.ruleEditorOpen).toBe(false);
      expect(next.editingRuleId).toBeNull();
    });
  });

  describe('Compare', () => {
    it('OPEN_COMPARE sets modal and versions', () => {
      const next = workspaceReducer(state, { type: 'OPEN_COMPARE', versionA: 'v1', versionB: 'v2' });
      expect(next.compareModalOpen).toBe(true);
      expect(next.compareVersionA).toBe('v1');
      expect(next.compareVersionB).toBe('v2');
    });
  });

  describe('RESET_WORKSPACE', () => {
    it('resets to initial state (preserves leftPanelOpen)', () => {
      state.selectedObjectIds = ['a', 'b'];
      state.viewerMode = 'compare';
      state.rightTab = 'boq';
      state.leftPanelOpen = true;
      const next = workspaceReducer(state, { type: 'RESET_WORKSPACE' });
      expect(next.selectedObjectIds).toEqual([]);
      expect(next.viewerMode).toBe('viewer');
      expect(next.rightTab).toBe('overview');
    });
  });
});

// ==================== 2. BOQ GENERATION (BUSINESS LOGIC) ====================

describe('BOQ Generation Logic', () => {
  it('generateBoq produces rows from objects matching rules', async () => {
    const objects: DrawingObject[] = [
      mockObject({ id: 'o1', category: 'Lighting', name: 'LED 1' }),
      mockObject({ id: 'o2', category: 'Lighting', name: 'LED 2' }),
      mockObject({ id: 'o3', category: 'HVAC', name: 'Duct 1' }),
    ];
    const rules: MappingRule[] = [
      mockRule({ conditions: [{ field: 'category', operator: 'equals', value: 'Lighting' }], targetBoqName: 'Oprawa LED', targetUnit: 'szt', aggregationMode: 'count' }),
    ];

    const rows = await api.generateBoq(objects, rules, []);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const ledRow = rows.find(r => r.name === 'Oprawa LED');
    expect(ledRow).toBeDefined();
    expect(ledRow!.quantity).toBe(2);
    expect(ledRow!.sourceObjectIds).toContain('o1');
    expect(ledRow!.sourceObjectIds).toContain('o2');
    expect(ledRow!.unit).toBe('szt');
  });

  it('generateBoq with sum-length aggregation sums lengths', async () => {
    const objects: DrawingObject[] = [
      mockObject({ id: 'o1', category: 'Cable', length: 10.5 }),
      mockObject({ id: 'o2', category: 'Cable', length: 20.3 }),
    ];
    const rules: MappingRule[] = [
      mockRule({ conditions: [{ field: 'category', operator: 'equals', value: 'Cable' }], targetBoqName: 'Kabel', targetUnit: 'm', aggregationMode: 'sum-length' }),
    ];

    const rows = await api.generateBoq(objects, rules, []);
    const cableRow = rows.find(r => r.name === 'Kabel');
    expect(cableRow).toBeDefined();
    expect(cableRow!.quantity).toBeCloseTo(30.8, 1);
  });

  it('generateBoq with sum-area aggregation sums areas', async () => {
    const objects: DrawingObject[] = [
      mockObject({ id: 'o1', category: 'Floor', area: 25.5 }),
      mockObject({ id: 'o2', category: 'Floor', area: 30.0 }),
    ];
    const rules: MappingRule[] = [
      mockRule({ conditions: [{ field: 'category', operator: 'equals', value: 'Floor' }], targetBoqName: 'Podloga', targetUnit: 'm2', aggregationMode: 'sum-area' }),
    ];

    const rows = await api.generateBoq(objects, rules, []);
    const floorRow = rows.find(r => r.name === 'Podloga');
    expect(floorRow).toBeDefined();
    expect(floorRow!.quantity).toBeCloseTo(55.5, 1);
  });

  it('generateBoq skips objects not matching any rule', async () => {
    const objects: DrawingObject[] = [
      mockObject({ id: 'o1', category: 'Random' }),
    ];
    const rules: MappingRule[] = [
      mockRule({ conditions: [{ field: 'category', operator: 'equals', value: 'Lighting' }] }),
    ];

    const rows = await api.generateBoq(objects, rules, []);
    // No rows generated for 'Random' category
    const matchingRows = rows.filter(r => r.sourceObjectIds.includes('o1'));
    expect(matchingRows.length).toBe(0);
  });

  it('generateBoq respects rule priority', async () => {
    const objects: DrawingObject[] = [
      mockObject({ id: 'o1', category: 'Lighting', family: 'Spot' }),
    ];
    const rules: MappingRule[] = [
      mockRule({ priority: 2, conditions: [{ field: 'category', operator: 'equals', value: 'Lighting' }], targetBoqName: 'Generic Light' }),
      mockRule({ priority: 1, conditions: [{ field: 'family', operator: 'equals', value: 'Spot' }], targetBoqName: 'Spot Light' }),
    ];

    const rows = await api.generateBoq(objects, rules, []);
    // Higher priority (lower number) should match first
    expect(rows.some(r => r.name === 'Spot Light')).toBe(true);
  });

  it('inactive rules are skipped', async () => {
    const objects: DrawingObject[] = [
      mockObject({ id: 'o1', category: 'Lighting' }),
    ];
    const rules: MappingRule[] = [
      mockRule({ active: false, conditions: [{ field: 'category', operator: 'equals', value: 'Lighting' }], targetBoqName: 'Should Not Appear' }),
    ];

    const rows = await api.generateBoq(objects, rules, []);
    expect(rows.find(r => r.name === 'Should Not Appear')).toBeUndefined();
  });
});

// ==================== 3. RULE MATCHING LOGIC (tested via generateBoq) ====================

describe('Rule Matching (via generateBoq)', () => {
  it('equals operator matches exact value', async () => {
    const objects = [mockObject({ id: 'o1', category: 'Lighting' })];
    const rules = [mockRule({ conditions: [{ field: 'category', operator: 'equals', value: 'Lighting' }], targetBoqName: 'Match' })];
    const rows = await api.generateBoq(objects, rules, []);
    expect(rows.some(r => r.name === 'Match')).toBe(true);
  });

  it('equals operator rejects non-matching', async () => {
    const objects = [mockObject({ id: 'o1', category: 'HVAC' })];
    const rules = [mockRule({ conditions: [{ field: 'category', operator: 'equals', value: 'Lighting' }], targetBoqName: 'NoMatch' })];
    const rows = await api.generateBoq(objects, rules, []);
    expect(rows.find(r => r.name === 'NoMatch')).toBeUndefined();
  });

  it('contains operator matches substring', async () => {
    const objects = [mockObject({ id: 'o1', name: 'LED Panel 60x60 Recessed' })];
    const rules = [mockRule({ conditions: [{ field: 'name', operator: 'contains', value: 'Panel 60x60' }], targetBoqName: 'ContainMatch' })];
    const rows = await api.generateBoq(objects, rules, []);
    expect(rows.some(r => r.name === 'ContainMatch')).toBe(true);
  });

  it('startsWith operator works', async () => {
    const objects = [mockObject({ id: 'o1', name: 'LED Panel' })];
    const rules = [mockRule({ conditions: [{ field: 'name', operator: 'startsWith', value: 'LED' }], targetBoqName: 'StartMatch' })];
    const rows = await api.generateBoq(objects, rules, []);
    expect(rows.some(r => r.name === 'StartMatch')).toBe(true);
  });

  it('endsWith operator works', async () => {
    const objects = [mockObject({ id: 'o1', name: 'LED Panel' })];
    const rules = [mockRule({ conditions: [{ field: 'name', operator: 'endsWith', value: 'Panel' }], targetBoqName: 'EndMatch' })];
    const rows = await api.generateBoq(objects, rules, []);
    expect(rows.some(r => r.name === 'EndMatch')).toBe(true);
  });
});

// ==================== 4. VERSION COMPARISON ====================

describe('Version Comparison', () => {
  it('compareVersions detects added objects (in B not in A)', async () => {
    const objectsA: DrawingObject[] = [
      mockObject({ id: 'o1', name: 'A' }),
    ];
    const objectsB: DrawingObject[] = [
      mockObject({ id: 'o1', name: 'A' }),
      mockObject({ id: 'o2', name: 'B' }),
      mockObject({ id: 'o3', name: 'C' }),
    ];

    const result = await api.compareVersions(objectsA, objectsB);
    expect(result.addedObjects.length).toBe(2);
    expect(result.addedObjects.map(o => o.id)).toContain('o2');
    expect(result.addedObjects.map(o => o.id)).toContain('o3');
  });

  it('compareVersions detects removed objects (in A not in B)', async () => {
    const objectsA: DrawingObject[] = [
      mockObject({ id: 'o1', name: 'A' }),
      mockObject({ id: 'o2', name: 'B' }),
    ];
    const objectsB: DrawingObject[] = [
      mockObject({ id: 'o1', name: 'A' }),
    ];

    const result = await api.compareVersions(objectsA, objectsB);
    expect(result.removedObjects.length).toBe(1);
    expect(result.removedObjects[0].id).toBe('o2');
  });

  it('compareVersions detects changed objects', async () => {
    const objectsA: DrawingObject[] = [
      mockObject({ id: 'o1', name: 'A', category: 'Old' }),
    ];
    const objectsB: DrawingObject[] = [
      mockObject({ id: 'o1', name: 'A Modified', category: 'New' }),
    ];

    const result = await api.compareVersions(objectsA, objectsB);
    expect(result.changedObjects.length).toBe(1);
    expect(result.changedObjects[0].before.name).toBe('A');
    expect(result.changedObjects[0].after.name).toBe('A Modified');
  });

  it('compareVersions returns empty for identical sets', async () => {
    const objects: DrawingObject[] = [
      mockObject({ id: 'o1', name: 'A', category: 'X' }),
    ];

    const result = await api.compareVersions(objects, objects);
    expect(result.addedObjects.length).toBe(0);
    expect(result.removedObjects.length).toBe(0);
    expect(result.changedObjects.length).toBe(0);
  });
});

// ==================== 5. DELTA BOQ ====================

describe('Delta BOQ Generation', () => {
  it('generateDeltaBOQ creates delta-added rows for new objects', async () => {
    const compareResult: VersionCompareResult = {
      addedObjects: [
        mockObject({ id: 'new-1', category: 'Lighting', name: 'New LED' }),
      ],
      removedObjects: [],
      changedObjects: [],
      deltaBoqRows: [],
    };
    const currentBoq: BoqRow[] = [mockBoqRow()];

    const delta = await api.generateDeltaBOQ(compareResult, currentBoq);
    expect(delta.length).toBeGreaterThanOrEqual(1);
    const addedRow = delta.find(r => r.status === 'delta-added');
    expect(addedRow).toBeDefined();
  });

  it('generateDeltaBOQ creates delta-removed rows for removed objects', async () => {
    const compareResult: VersionCompareResult = {
      addedObjects: [],
      removedObjects: [
        mockObject({ id: 'removed-1', category: 'Lighting', name: 'Old LED' }),
      ],
      changedObjects: [],
      deltaBoqRows: [],
    };
    const currentBoq: BoqRow[] = [];

    const delta = await api.generateDeltaBOQ(compareResult, currentBoq);
    const removedRow = delta.find(r => r.status === 'delta-removed');
    expect(removedRow).toBeDefined();
  });
});

// ==================== 6. FILTER LOGIC ====================

describe('Filter logic (simulated filteredObjects)', () => {
  const allObjects: DrawingObject[] = [
    mockObject({ id: 'o1', category: 'Lighting', layer: 'E-LIGHT', level: 'Level 1', aiStatus: 'recognized', aiConfidence: 0.9, boqRowId: 'boq-1' }),
    mockObject({ id: 'o2', category: 'HVAC', layer: 'M-HVAC', level: 'Level 2', aiStatus: 'needs_review', aiConfidence: 0.4 }),
    mockObject({ id: 'o3', category: 'Lighting', layer: 'E-LIGHT', level: 'Level 1', aiStatus: 'unknown', aiConfidence: 0.1 }),
    mockObject({ id: 'o4', category: 'Plumbing', layer: 'P-PIPE', level: 'Level 1', aiStatus: 'recognized', aiConfidence: 0.95, boqRowId: 'boq-2' }),
  ];

  function applyFilters(objects: DrawingObject[], filters: Partial<WorkspaceFilters>): DrawingObject[] {
    const f = { ...DEFAULT_FILTERS, ...filters };
    let result = objects;
    if (f.searchQuery) {
      const q = f.searchQuery.toLowerCase();
      result = result.filter(o => o.name.toLowerCase().includes(q) || o.category?.toLowerCase().includes(q));
    }
    if (f.layers.length > 0) result = result.filter(o => o.layer && f.layers.includes(o.layer));
    if (f.categories.length > 0) result = result.filter(o => o.category && f.categories.includes(o.category));
    if (f.levels.length > 0) result = result.filter(o => o.level && f.levels.includes(o.level));
    if (f.onlyAiRecognized) result = result.filter(o => o.aiStatus === 'recognized');
    if (f.onlyUnresolved) result = result.filter(o => o.aiStatus === 'needs_review' || o.aiStatus === 'unknown');
    if (f.onlyBoqLinked) result = result.filter(o => !!o.boqRowId);
    if (f.confidenceThreshold > 0) result = result.filter(o => (o.aiConfidence ?? 0) >= f.confidenceThreshold);
    return result;
  }

  it('no filters returns all objects', () => {
    expect(applyFilters(allObjects, {}).length).toBe(4);
  });

  it('filter by category', () => {
    const filtered = applyFilters(allObjects, { categories: ['Lighting'] });
    expect(filtered.length).toBe(2);
    expect(filtered.every(o => o.category === 'Lighting')).toBe(true);
  });

  it('filter by layer', () => {
    const filtered = applyFilters(allObjects, { layers: ['E-LIGHT'] });
    expect(filtered.length).toBe(2);
  });

  it('filter by level', () => {
    const filtered = applyFilters(allObjects, { levels: ['Level 2'] });
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe('o2');
  });

  it('filter onlyAiRecognized', () => {
    const filtered = applyFilters(allObjects, { onlyAiRecognized: true });
    expect(filtered.length).toBe(2);
    expect(filtered.every(o => o.aiStatus === 'recognized')).toBe(true);
  });

  it('filter onlyUnresolved', () => {
    const filtered = applyFilters(allObjects, { onlyUnresolved: true });
    expect(filtered.length).toBe(2);
    expect(filtered.every(o => o.aiStatus === 'needs_review' || o.aiStatus === 'unknown')).toBe(true);
  });

  it('filter onlyBoqLinked', () => {
    const filtered = applyFilters(allObjects, { onlyBoqLinked: true });
    expect(filtered.length).toBe(2);
    expect(filtered.every(o => !!o.boqRowId)).toBe(true);
  });

  it('filter by confidence threshold', () => {
    const filtered = applyFilters(allObjects, { confidenceThreshold: 0.5 });
    expect(filtered.length).toBe(2);
    expect(filtered.every(o => (o.aiConfidence ?? 0) >= 0.5)).toBe(true);
  });

  it('filter by search query', () => {
    const filtered = applyFilters(allObjects, { searchQuery: 'HVAC' });
    expect(filtered.length).toBe(1);
    expect(filtered[0].category).toBe('HVAC');
  });

  it('combined filters stack', () => {
    const filtered = applyFilters(allObjects, {
      categories: ['Lighting'],
      onlyAiRecognized: true,
    });
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe('o1');
  });
});

// ==================== 7. BOQ ↔ OBJECT SYNC ====================

describe('BOQ ↔ Object bidirectional sync', () => {
  it('selecting BOQ row reveals source object IDs', () => {
    const row = mockBoqRow({ sourceObjectIds: ['obj-1', 'obj-2', 'obj-3'] });
    const state = workspaceReducer(INITIAL_WORKSPACE_STATE, {
      type: 'SELECT_BOQ_ROW_AND_HIGHLIGHT',
      rowId: row.id,
      sourceObjectIds: row.sourceObjectIds,
    });
    expect(state.selectedBoqRowId).toBe(row.id);
    expect(state.selectedObjectIds).toEqual(['obj-1', 'obj-2', 'obj-3']);
  });

  it('selecting object can find linked BOQ row', () => {
    const objects: DrawingObject[] = [
      mockObject({ id: 'o1', boqRowId: 'boq-1' }),
      mockObject({ id: 'o2', boqRowId: null }),
    ];
    const boqRows: BoqRow[] = [mockBoqRow({ id: 'boq-1', sourceObjectIds: ['o1'] })];

    const selectedObj = objects.find(o => o.id === 'o1')!;
    const linkedRow = boqRows.find(r => r.id === selectedObj.boqRowId);
    expect(linkedRow).toBeDefined();
    expect(linkedRow!.sourceObjectIds).toContain('o1');
  });
});

// ==================== 8. CSV EXPORT ====================

describe('CSV Export', () => {
  it('exportBoqCsv creates valid CSV content', () => {
    // Mock URL.createObjectURL and click
    const createObjectURL = vi.fn(() => 'blob:test');
    const revokeObjectURL = vi.fn();
    const click = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    vi.stubGlobal('document', {
      createElement: () => ({ href: '', download: '', click }),
    });

    const rows: BoqRow[] = [
      mockBoqRow({ code: 'E.1', name: 'LED Panel', unit: 'szt', quantity: 10 }),
      mockBoqRow({ code: 'E.2', name: 'Cable', unit: 'm', quantity: 150 }),
    ];

    api.exportBoqCsv(rows);
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledOnce();

    vi.unstubAllGlobals();
  });
});

// ==================== 9. DEFAULT RULES ====================

describe('Default Rules', () => {
  it('getDefaultRules returns non-empty array', () => {
    const rules = api.getDefaultRules();
    expect(rules.length).toBeGreaterThan(0);
  });

  it('all default rules have required fields', () => {
    const rules = api.getDefaultRules();
    for (const rule of rules) {
      expect(rule.id).toBeTruthy();
      expect(rule.name).toBeTruthy();
      expect(typeof rule.active).toBe('boolean');
      expect(typeof rule.priority).toBe('number');
      expect(Array.isArray(rule.conditions)).toBe(true);
      expect(rule.conditions.length).toBeGreaterThan(0);
      expect(rule.targetBoqName).toBeTruthy();
      expect(rule.targetUnit).toBeTruthy();
      expect(['count', 'sum-length', 'sum-area', 'sum-volume', 'custom']).toContain(rule.aggregationMode);
    }
  });

  it('default rules cover major categories', () => {
    const rules = api.getDefaultRules();
    const ruleNames = rules.map(r => r.name.toLowerCase());
    // Should cover at least some basic construction categories
    expect(ruleNames.length).toBeGreaterThanOrEqual(5);
  });
});

// ==================== 10. INITIAL STATE INTEGRITY ====================

describe('Initial workspace state', () => {
  it('has correct defaults', () => {
    const s = INITIAL_WORKSPACE_STATE;
    expect(s.activeFileId).toBeNull();
    expect(s.viewerMode).toBe('viewer');
    expect(s.rightTab).toBe('overview');
    expect(s.selectedObjectIds).toEqual([]);
    expect(s.selectedBoqRowId).toBeNull();
    expect(s.hoveredObjectId).toBeNull();
    expect(s.activeTool).toBe('select');
    expect(s.conversionStatus).toBe('idle');
    expect(s.analysisStatus).toBe('idle');
    expect(s.aiStatus).toBe('idle');
    expect(s.boqStatus).toBe('idle');
    expect(s.compareStatus).toBe('idle');
    expect(s.isFullscreen).toBe(false);
    expect(s.leftPanelOpen).toBe(true);
    expect(s.rightPanelOpen).toBe(false);
    expect(s.ruleEditorOpen).toBe(false);
  });

  it('DEFAULT_FILTERS has correct shape', () => {
    expect(DEFAULT_FILTERS.levels).toEqual([]);
    expect(DEFAULT_FILTERS.zones).toEqual([]);
    expect(DEFAULT_FILTERS.layers).toEqual([]);
    expect(DEFAULT_FILTERS.categories).toEqual([]);
    expect(DEFAULT_FILTERS.onlyAiRecognized).toBe(false);
    expect(DEFAULT_FILTERS.onlyUnresolved).toBe(false);
    expect(DEFAULT_FILTERS.onlyBoqLinked).toBe(false);
    expect(DEFAULT_FILTERS.onlyChangedInCompare).toBe(false);
    expect(DEFAULT_FILTERS.confidenceThreshold).toBe(0);
    expect(DEFAULT_FILTERS.searchQuery).toBe('');
  });
});

// ==================== 11. API CRUD FUNCTIONS ====================

describe('API CRUD functions (local operations)', () => {
  it('updateBOQRow merges updates', async () => {
    const row = await api.updateBOQRow('test-id', { name: 'Updated', quantity: 99 });
    expect(row.name).toBe('Updated');
    expect(row.quantity).toBe(99);
    expect(row.status).toBe('manually-edited');
  });

  it('approveBOQRow sets approved status', async () => {
    const row = await api.approveBOQRow('test-id');
    expect(row.status).toBe('approved');
  });

  it('createRule returns rule with id', async () => {
    const rule = await api.createRule(mockRule({ id: '' }));
    expect(rule.id).toBeTruthy();
  });

  it('getRules returns default rules', async () => {
    const rules = await api.getRules();
    expect(rules.length).toBeGreaterThan(0);
  });
});

// ==================== 12. MEASUREMENT & ANNOTATION TYPES ====================

describe('Measurement and Annotation types', () => {
  it('measurement has required fields', () => {
    const m = mockMeasurement();
    expect(m.id).toBeTruthy();
    expect(['length', 'area', 'count', 'polyline']).toContain(m.type);
    expect(typeof m.value).toBe('number');
    expect(m.unit).toBeTruthy();
    expect(m.createdBy).toBeTruthy();
    expect(m.createdAt).toBeTruthy();
  });

  it('annotation has geometry with points', () => {
    const a = mockAnnotation();
    expect(a.geometry).toBeDefined();
    expect(a.geometry.points.length).toBeGreaterThan(0);
    expect(typeof a.geometry.points[0].x).toBe('number');
    expect(typeof a.geometry.points[0].y).toBe('number');
  });
});
