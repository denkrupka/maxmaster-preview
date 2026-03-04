/**
 * DXF Takeoff (Krok D) — Rules engine for quantity takeoff
 * Pattern matching, connected LINE detection, default Polish electrical rules
 */
import type { DxfAnalysis, AnalyzedEntity, LineGroup } from './dxfAnalyzer';

// ==================== TYPES ====================

export interface TakeoffRule {
  id: string;
  name: string;
  category: string;
  matchType: 'layer_contains' | 'layer_exact' | 'layer_regex' | 'block_contains' | 'block_exact' | 'block_regex' | 'entity_type';
  matchPattern: string;
  quantitySource: 'count' | 'length_m' | 'area_m2' | 'group_length_m';
  unit: string;
  multiplier: number;
  isDefault: boolean;
}

export interface TakeoffItem {
  id: string;
  ruleId: string;
  category: string;
  description: string;
  quantity: number;
  unit: string;
  sourceEntityIndices: number[];
  sourceLayer?: string;
  sourceBlock?: string;
  status: 'auto' | 'manual' | 'verified';
}

export interface TakeoffResult {
  items: TakeoffItem[];
  totalByCategory: Record<string, { count: number; items: TakeoffItem[] }>;
  unmatchedEntityCount: number;
  matchedEntityCount: number;
}

// ==================== RULE MATCHING ====================

function matchesRule(rule: TakeoffRule, entity: AnalyzedEntity): boolean {
  switch (rule.matchType) {
    case 'layer_contains':
      return entity.layerName.toUpperCase().includes(rule.matchPattern.toUpperCase());
    case 'layer_exact':
      return entity.layerName.toUpperCase() === rule.matchPattern.toUpperCase();
    case 'layer_regex':
      try {
        return new RegExp(rule.matchPattern, 'i').test(entity.layerName);
      } catch { return false; }
    case 'block_contains':
      return !!entity.blockName && entity.blockName.toUpperCase().includes(rule.matchPattern.toUpperCase());
    case 'block_exact':
      return !!entity.blockName && entity.blockName.toUpperCase() === rule.matchPattern.toUpperCase();
    case 'block_regex':
      if (!entity.blockName) return false;
      try {
        return new RegExp(rule.matchPattern, 'i').test(entity.blockName);
      } catch { return false; }
    case 'entity_type':
      return entity.entityType.toUpperCase() === rule.matchPattern.toUpperCase();
    default:
      return false;
  }
}

function getQuantity(rule: TakeoffRule, entities: AnalyzedEntity[], groups: LineGroup[]): number {
  switch (rule.quantitySource) {
    case 'count':
      return entities.length * rule.multiplier;
    case 'length_m':
      return entities.reduce((sum, e) => sum + e.lengthM, 0) * rule.multiplier;
    case 'area_m2':
      return entities.reduce((sum, e) => sum + e.areaM2, 0) * rule.multiplier;
    case 'group_length_m': {
      // Sum lengths from line groups that contain any of the matched entities
      const entitySet = new Set(entities.map(e => e.index));
      let total = 0;
      const usedGroups = new Set<string>();
      for (const group of groups) {
        if (usedGroups.has(group.id)) continue;
        if (group.entityIndices.some(idx => entitySet.has(idx))) {
          total += group.totalLengthM;
          usedGroups.add(group.id);
        }
      }
      return total * rule.multiplier;
    }
    default:
      return 0;
  }
}

let itemCounter = 0;

/** Apply rules to analysis results and generate takeoff items */
export function applyRules(analysis: DxfAnalysis, rules: TakeoffRule[]): TakeoffResult {
  const items: TakeoffItem[] = [];
  const matchedIndices = new Set<number>();
  itemCounter = 0;

  for (const rule of rules) {
    // Find all entities matching this rule
    const matched = analysis.entities.filter(e => matchesRule(rule, e));
    if (matched.length === 0) continue;

    const quantity = getQuantity(rule, matched, analysis.lineGroups);
    if (quantity === 0) continue;

    matched.forEach(e => matchedIndices.add(e.index));

    // Group by layer+block for separate line items
    const groups = new Map<string, AnalyzedEntity[]>();
    for (const e of matched) {
      const key = `${e.layerName}|${e.blockName || ''}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(e);
    }

    for (const [key, groupEntities] of groups) {
      const [layer, block] = key.split('|');
      const qty = getQuantity(rule, groupEntities, analysis.lineGroups);
      if (qty === 0) continue;

      items.push({
        id: `item_${++itemCounter}`,
        ruleId: rule.id,
        category: rule.category,
        description: block
          ? `${rule.name} — blok: ${block} (${layer})`
          : `${rule.name} — warstwa: ${layer}`,
        quantity: Math.round(qty * 1000) / 1000,
        unit: rule.unit,
        sourceEntityIndices: groupEntities.map(e => e.index),
        sourceLayer: layer,
        sourceBlock: block || undefined,
        status: 'auto',
      });
    }
  }

  // Build category summary
  const totalByCategory: Record<string, { count: number; items: TakeoffItem[] }> = {};
  for (const item of items) {
    if (!totalByCategory[item.category]) {
      totalByCategory[item.category] = { count: 0, items: [] };
    }
    totalByCategory[item.category].count++;
    totalByCategory[item.category].items.push(item);
  }

  return {
    items,
    totalByCategory,
    matchedEntityCount: matchedIndices.size,
    unmatchedEntityCount: analysis.totalEntities - matchedIndices.size,
  };
}

/** Get entities not matched by any rule (for QA) */
export function getUnassignedEntities(analysis: DxfAnalysis, items: TakeoffItem[]): AnalyzedEntity[] {
  const matched = new Set<number>();
  for (const item of items) {
    for (const idx of item.sourceEntityIndices) matched.add(idx);
  }
  return analysis.entities.filter(e => !matched.has(e.index));
}

// ==================== DEFAULT ELECTRICAL RULES ====================

/** Default rules for Polish electrical installation drawings */
export function getDefaultElectricalRules(): TakeoffRule[] {
  return [
    {
      id: 'def_kab_ydyp',
      name: 'Kabel YDYp',
      category: 'Kable i przewody',
      matchType: 'layer_contains',
      matchPattern: 'KAB',
      quantitySource: 'group_length_m',
      unit: 'm',
      multiplier: 1.1, // 10% zapas
      isDefault: true,
    },
    {
      id: 'def_kab_yky',
      name: 'Kabel YKY',
      category: 'Kable i przewody',
      matchType: 'layer_regex',
      matchPattern: 'YKY|KABEL.*ZIEMNY',
      quantitySource: 'group_length_m',
      unit: 'm',
      multiplier: 1.1,
      isDefault: true,
    },
    {
      id: 'def_oprawa',
      name: 'Oprawa oświetleniowa',
      category: 'Oprawy oświetleniowe',
      matchType: 'layer_contains',
      matchPattern: 'OPR',
      quantitySource: 'count',
      unit: 'szt.',
      multiplier: 1,
      isDefault: true,
    },
    {
      id: 'def_oprawa_block',
      name: 'Oprawa (blok)',
      category: 'Oprawy oświetleniowe',
      matchType: 'block_regex',
      matchPattern: 'OPR|LAMP|LIGHT|OPRAWA',
      quantitySource: 'count',
      unit: 'szt.',
      multiplier: 1,
      isDefault: true,
    },
    {
      id: 'def_gniazdo',
      name: 'Gniazdo wtykowe',
      category: 'Osprzęt elektryczny',
      matchType: 'layer_contains',
      matchPattern: 'GNI',
      quantitySource: 'count',
      unit: 'szt.',
      multiplier: 1,
      isDefault: true,
    },
    {
      id: 'def_gniazdo_block',
      name: 'Gniazdo (blok)',
      category: 'Osprzęt elektryczny',
      matchType: 'block_regex',
      matchPattern: 'GNI|SOCKET|GNIAZDKO',
      quantitySource: 'count',
      unit: 'szt.',
      multiplier: 1,
      isDefault: true,
    },
    {
      id: 'def_wylacznik',
      name: 'Wyłącznik / łącznik',
      category: 'Osprzęt elektryczny',
      matchType: 'layer_contains',
      matchPattern: 'WYL',
      quantitySource: 'count',
      unit: 'szt.',
      multiplier: 1,
      isDefault: true,
    },
    {
      id: 'def_wylacznik_block',
      name: 'Wyłącznik (blok)',
      category: 'Osprzęt elektryczny',
      matchType: 'block_regex',
      matchPattern: 'WYL|SWITCH|LACZNIK',
      quantitySource: 'count',
      unit: 'szt.',
      multiplier: 1,
      isDefault: true,
    },
    {
      id: 'def_rura',
      name: 'Rura ochronna / koryto',
      category: 'Trasy kablowe',
      matchType: 'layer_contains',
      matchPattern: 'RURA',
      quantitySource: 'group_length_m',
      unit: 'm',
      multiplier: 1.05,
      isDefault: true,
    },
    {
      id: 'def_koryto',
      name: 'Koryto kablowe',
      category: 'Trasy kablowe',
      matchType: 'layer_regex',
      matchPattern: 'KORYTO|TRAY|KORYTKO',
      quantitySource: 'group_length_m',
      unit: 'm',
      multiplier: 1.05,
      isDefault: true,
    },
    {
      id: 'def_tablica',
      name: 'Tablica rozdzielcza',
      category: 'Tablice i rozdzielnice',
      matchType: 'layer_contains',
      matchPattern: 'TB',
      quantitySource: 'count',
      unit: 'szt.',
      multiplier: 1,
      isDefault: true,
    },
    {
      id: 'def_tablica_block',
      name: 'Tablica (blok)',
      category: 'Tablice i rozdzielnice',
      matchType: 'block_regex',
      matchPattern: 'TB|TABLICA|ROZDZIEL|BOARD',
      quantitySource: 'count',
      unit: 'szt.',
      multiplier: 1,
      isDefault: true,
    },
    {
      id: 'def_czujnik',
      name: 'Czujnik / detektor',
      category: 'Instalacja alarmowa',
      matchType: 'layer_contains',
      matchPattern: 'CZUJ',
      quantitySource: 'count',
      unit: 'szt.',
      multiplier: 1,
      isDefault: true,
    },
    {
      id: 'def_czujnik_block',
      name: 'Czujnik (blok)',
      category: 'Instalacja alarmowa',
      matchType: 'block_regex',
      matchPattern: 'CZUJ|SENSOR|DETECT|CZUJNIK',
      quantitySource: 'count',
      unit: 'szt.',
      multiplier: 1,
      isDefault: true,
    },
    {
      id: 'def_puszka',
      name: 'Puszka instalacyjna',
      category: 'Osprzęt elektryczny',
      matchType: 'block_regex',
      matchPattern: 'PUSZKA|JUNCTION|BOX',
      quantitySource: 'count',
      unit: 'szt.',
      multiplier: 1,
      isDefault: true,
    },
  ];
}

/** Validate a rule pattern — returns error message or null */
export function validateRulePattern(rule: Partial<TakeoffRule>): string | null {
  if (!rule.matchPattern?.trim()) return 'Wzorzec nie może być pusty';
  if (rule.matchType?.endsWith('_regex')) {
    try {
      new RegExp(rule.matchPattern);
    } catch (e) {
      return `Nieprawidłowe wyrażenie regularne: ${(e as Error).message}`;
    }
  }
  if (rule.multiplier != null && (rule.multiplier <= 0 || rule.multiplier > 100)) {
    return 'Mnożnik musi być między 0 a 100';
  }
  return null;
}

/** Export takeoff items to CSV string */
export function takeoffToCsv(items: TakeoffItem[]): string {
  const header = 'Kategoria;Opis;Ilość;Jednostka;Warstwa;Blok;Status';
  const rows = items.map(item =>
    [
      item.category,
      item.description,
      item.quantity.toString().replace('.', ','),
      item.unit,
      item.sourceLayer || '',
      item.sourceBlock || '',
      item.status,
    ].join(';')
  );
  return [header, ...rows].join('\n');
}
