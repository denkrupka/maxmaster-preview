import { describe, it, expect } from 'vitest';
import { applyRules, getDefaultElectricalRules, getUnassignedEntities, validateRulePattern, takeoffToCsv, type TakeoffRule } from '../dxfTakeoff';
import type { DxfAnalysis, AnalyzedEntity, LineGroup } from '../dxfAnalyzer';

function makeAnalysis(entities: Partial<AnalyzedEntity>[], lineGroups: LineGroup[] = []): DxfAnalysis {
  return {
    totalEntities: entities.length,
    totalBlocks: 0,
    totalLayers: 1,
    unitSystem: 'mm',
    insUnits: 4,
    layers: [{ name: '0', color: '#808080', entityCount: entities.length, frozen: false, entityTypes: {} }],
    entities: entities.map((e, i) => ({
      index: i,
      entityType: e.entityType || 'LINE',
      layerName: e.layerName || '0',
      blockName: e.blockName,
      geometry: e.geometry || { type: 'line' },
      lengthM: e.lengthM || 0,
      areaM2: e.areaM2 || 0,
      properties: {},
      ...e,
    })) as AnalyzedEntity[],
    blocks: [],
    lineGroups,
  };
}

describe('dxfTakeoff', () => {
  describe('applyRules', () => {
    it('matches entities by layer_contains', () => {
      const analysis = makeAnalysis([
        { entityType: 'LINE', layerName: 'KAB-YDYp-3x1.5' },
        { entityType: 'LINE', layerName: 'KAB-YDYp-5x2.5' },
        { entityType: 'LINE', layerName: 'OPR-LED-60' },
      ]);

      const rules: TakeoffRule[] = [{
        id: 'r1', name: 'Kable', category: 'Kable', matchType: 'layer_contains',
        matchPattern: 'KAB', quantitySource: 'count', unit: 'szt.', multiplier: 1, isDefault: false,
      }];

      const result = applyRules(analysis, rules);
      expect(result.matchedEntityCount).toBe(2);
      expect(result.unmatchedEntityCount).toBe(1);
      expect(result.items.length).toBeGreaterThanOrEqual(1);
    });

    it('matches entities by block_regex', () => {
      const analysis = makeAnalysis([
        { entityType: 'INSERT', layerName: '0', blockName: 'OPRAWA-LED-60' },
        { entityType: 'INSERT', layerName: '0', blockName: 'OPRAWA-HALO' },
        { entityType: 'INSERT', layerName: '0', blockName: 'SWITCH-1' },
      ]);

      const rules: TakeoffRule[] = [{
        id: 'r1', name: 'Oprawy', category: 'Oprawy', matchType: 'block_regex',
        matchPattern: 'OPRAWA', quantitySource: 'count', unit: 'szt.', multiplier: 1, isDefault: false,
      }];

      const result = applyRules(analysis, rules);
      expect(result.matchedEntityCount).toBe(2);
    });

    it('uses length_m quantity source', () => {
      const analysis = makeAnalysis([
        { entityType: 'LINE', layerName: 'KAB', lengthM: 10 },
        { entityType: 'LINE', layerName: 'KAB', lengthM: 20 },
      ]);

      const rules: TakeoffRule[] = [{
        id: 'r1', name: 'Kable', category: 'Kable', matchType: 'layer_contains',
        matchPattern: 'KAB', quantitySource: 'length_m', unit: 'm', multiplier: 1.1, isDefault: false,
      }];

      const result = applyRules(analysis, rules);
      // Total length = 30 * 1.1 multiplier = 33
      expect(result.items[0].quantity).toBeCloseTo(33, 0);
    });

    it('uses group_length_m quantity source', () => {
      const lineGroups: LineGroup[] = [{
        id: 'g1', entityIndices: [0, 1], totalLengthM: 50, layer: 'KAB', points: [],
      }];

      const analysis = makeAnalysis([
        { entityType: 'LINE', layerName: 'KAB', lengthM: 20 },
        { entityType: 'LINE', layerName: 'KAB', lengthM: 30 },
      ], lineGroups);

      const rules: TakeoffRule[] = [{
        id: 'r1', name: 'Kable', category: 'Kable', matchType: 'layer_contains',
        matchPattern: 'KAB', quantitySource: 'group_length_m', unit: 'm', multiplier: 1, isDefault: false,
      }];

      const result = applyRules(analysis, rules);
      expect(result.items[0].quantity).toBeCloseTo(50, 0);
    });

    it('returns empty result for no matches', () => {
      const analysis = makeAnalysis([
        { entityType: 'LINE', layerName: 'WALL' },
      ]);

      const rules: TakeoffRule[] = [{
        id: 'r1', name: 'Kable', category: 'Kable', matchType: 'layer_contains',
        matchPattern: 'KAB', quantitySource: 'count', unit: 'szt.', multiplier: 1, isDefault: false,
      }];

      const result = applyRules(analysis, rules);
      expect(result.items).toHaveLength(0);
      expect(result.unmatchedEntityCount).toBe(1);
    });
  });

  describe('getDefaultElectricalRules', () => {
    it('returns a non-empty set of rules', () => {
      const rules = getDefaultElectricalRules();
      expect(rules.length).toBeGreaterThan(5);
      expect(rules.every(r => r.id && r.name && r.category)).toBe(true);
    });

    it('all default rules are marked as default', () => {
      const rules = getDefaultElectricalRules();
      expect(rules.every(r => r.isDefault)).toBe(true);
    });

    it('has rules for common electrical categories', () => {
      const rules = getDefaultElectricalRules();
      const categories = new Set(rules.map(r => r.category));
      expect(categories.has('Kable i przewody')).toBe(true);
      expect(categories.has('Oprawy oświetleniowe')).toBe(true);
      expect(categories.has('Osprzęt elektryczny')).toBe(true);
    });
  });

  describe('getUnassignedEntities', () => {
    it('returns entities not matched by any item', () => {
      const analysis = makeAnalysis([
        { entityType: 'LINE', layerName: 'KAB' },
        { entityType: 'LINE', layerName: 'WALL' },
        { entityType: 'CIRCLE', layerName: 'WALL' },
      ]);

      const items = [{ sourceEntityIndices: [0] }] as any;
      const unassigned = getUnassignedEntities(analysis, items);
      expect(unassigned).toHaveLength(2);
      expect(unassigned.map(e => e.index)).toEqual([1, 2]);
    });
  });

  describe('validateRulePattern', () => {
    it('returns null for valid pattern', () => {
      expect(validateRulePattern({ matchType: 'layer_contains', matchPattern: 'KAB', multiplier: 1 })).toBeNull();
    });

    it('returns error for empty pattern', () => {
      expect(validateRulePattern({ matchType: 'layer_contains', matchPattern: '' })).toBeTruthy();
    });

    it('returns error for invalid regex', () => {
      expect(validateRulePattern({ matchType: 'layer_regex', matchPattern: '([invalid' })).toBeTruthy();
    });

    it('accepts valid regex', () => {
      expect(validateRulePattern({ matchType: 'layer_regex', matchPattern: 'KAB|OPR.*LED' })).toBeNull();
    });
  });

  describe('takeoffToCsv', () => {
    it('generates CSV with header and rows', () => {
      const items = [{
        id: '1', ruleId: 'r1', category: 'Kable', description: 'Kabel YDYp',
        quantity: 123.5, unit: 'm', sourceEntityIndices: [0, 1],
        sourceLayer: 'KAB', status: 'auto' as const,
      }];

      const csv = takeoffToCsv(items);
      const lines = csv.split('\n');
      expect(lines[0]).toContain('Kategoria');
      expect(lines[1]).toContain('Kable');
      expect(lines[1]).toContain('123,5'); // Polish decimal separator
    });
  });
});
