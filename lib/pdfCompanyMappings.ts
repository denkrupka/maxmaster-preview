/**
 * Per-company mapping dictionary for PDF takeoff.
 * Stores and retrieves learned style→element type mappings.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface CompanyMapping {
  id?: string;
  companyId: string;
  mappingType: 'style_color' | 'symbol_shape' | 'text_label' | 'legend_entry';
  matchValue: string;
  elementName: string;
  category: string;
  unit: string;
  multiplier: number;
  notes?: string;
  usageCount?: number;
}

/** Load all mappings for a company */
export async function loadCompanyMappings(
  supabase: SupabaseClient,
  companyId: string,
): Promise<CompanyMapping[]> {
  const { data, error } = await supabase
    .from('pdf_company_mappings')
    .select('*')
    .eq('company_id', companyId)
    .order('usage_count', { ascending: false });

  if (error) throw error;

  return (data || []).map(row => ({
    id: row.id,
    companyId: row.company_id,
    mappingType: row.mapping_type,
    matchValue: row.match_value,
    elementName: row.element_name,
    category: row.category,
    unit: row.unit,
    multiplier: row.multiplier,
    notes: row.notes,
    usageCount: row.usage_count,
  }));
}

/** Save or update a mapping */
export async function saveCompanyMapping(
  supabase: SupabaseClient,
  mapping: CompanyMapping,
): Promise<string> {
  if (mapping.id) {
    const { error } = await supabase
      .from('pdf_company_mappings')
      .update({
        mapping_type: mapping.mappingType,
        match_value: mapping.matchValue,
        element_name: mapping.elementName,
        category: mapping.category,
        unit: mapping.unit,
        multiplier: mapping.multiplier,
        notes: mapping.notes,
      })
      .eq('id', mapping.id);
    if (error) throw error;
    return mapping.id;
  }

  const { data, error } = await supabase
    .from('pdf_company_mappings')
    .insert({
      company_id: mapping.companyId,
      mapping_type: mapping.mappingType,
      match_value: mapping.matchValue,
      element_name: mapping.elementName,
      category: mapping.category,
      unit: mapping.unit,
      multiplier: mapping.multiplier,
      notes: mapping.notes,
    })
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
}

/** Delete a mapping */
export async function deleteCompanyMapping(
  supabase: SupabaseClient,
  mappingId: string,
): Promise<void> {
  const { error } = await supabase
    .from('pdf_company_mappings')
    .delete()
    .eq('id', mappingId);
  if (error) throw error;
}

/** Increment usage count for a mapping */
export async function incrementMappingUsage(
  supabase: SupabaseClient,
  mappingId: string,
): Promise<void> {
  const { data } = await supabase
    .from('pdf_company_mappings')
    .select('usage_count')
    .eq('id', mappingId)
    .single();
  if (data) {
    await supabase
      .from('pdf_company_mappings')
      .update({ usage_count: (data.usage_count || 0) + 1 })
      .eq('id', mappingId);
  }
}

/** Auto-generate TakeoffRules from company mappings */
export function mappingsToRules(mappings: CompanyMapping[]) {
  return mappings.map(m => ({
    id: `mapping_${m.id}`,
    name: m.elementName,
    category: m.category,
    matchType: m.mappingType as any,
    matchPattern: m.matchValue,
    quantitySource: 'count' as const,
    unit: m.unit,
    multiplier: m.multiplier,
    isDefault: false,
  }));
}
