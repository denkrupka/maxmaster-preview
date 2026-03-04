import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, Download, Upload, TestTube } from 'lucide-react';
import type { TakeoffRule } from '../../lib/dxfTakeoff';
import { getDefaultElectricalRules, getDefaultPdfElectricalRules, validateRulePattern } from '../../lib/dxfTakeoff';
import { supabase } from '../../lib/supabase';

interface DxfTakeoffRulesModalProps {
  companyId: string;
  rules: TakeoffRule[];
  onRulesChange: (rules: TakeoffRule[]) => void;
  onClose: () => void;
  onTestRules?: () => void;
}

export default function DxfTakeoffRulesModal({ companyId, rules, onRulesChange, onClose, onTestRules }: DxfTakeoffRulesModalProps) {
  const [localRules, setLocalRules] = useState<TakeoffRule[]>(rules);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const matchTypes: { value: TakeoffRule['matchType']; label: string }[] = [
    { value: 'layer_contains', label: 'Warstwa zawiera' },
    { value: 'layer_exact', label: 'Warstwa dokładnie' },
    { value: 'layer_regex', label: 'Warstwa regex' },
    { value: 'block_contains', label: 'Blok zawiera' },
    { value: 'block_exact', label: 'Blok dokładnie' },
    { value: 'block_regex', label: 'Blok regex' },
    { value: 'entity_type', label: 'Typ elementu' },
    { value: 'style_color', label: 'Kolor stylu (PDF)' },
    { value: 'symbol_shape', label: 'Kształt symbolu (PDF)' },
  ];

  const quantitySources: { value: TakeoffRule['quantitySource']; label: string }[] = [
    { value: 'count', label: 'Liczba' },
    { value: 'length_m', label: 'Długość (m)' },
    { value: 'area_m2', label: 'Pole (m²)' },
    { value: 'group_length_m', label: 'Długość grupy (m)' },
  ];

  const addRule = () => {
    const newRule: TakeoffRule = {
      id: `rule_${Date.now()}`,
      name: 'Nowa reguła',
      category: 'Inne',
      matchType: 'layer_contains',
      matchPattern: '',
      quantitySource: 'count',
      unit: 'szt.',
      multiplier: 1,
      isDefault: false,
    };
    setLocalRules([...localRules, newRule]);
    setEditingId(newRule.id);
  };

  const updateRule = (id: string, updates: Partial<TakeoffRule>) => {
    setLocalRules(localRules.map(r => r.id === id ? { ...r, ...updates } : r));
  };

  const deleteRule = (id: string) => {
    setLocalRules(localRules.filter(r => r.id !== id));
    if (editingId === id) setEditingId(null);
  };

  const importDefaults = (type: 'dxf' | 'pdf' = 'dxf') => {
    const defaults = type === 'pdf' ? getDefaultPdfElectricalRules() : getDefaultElectricalRules();
    const existingIds = new Set(localRules.map(r => r.id));
    const newRules = defaults.filter(d => !existingIds.has(d.id));
    setLocalRules([...localRules, ...newRules]);
  };

  const handleSave = async () => {
    // Validate all rules
    for (const rule of localRules) {
      const err = validateRulePattern(rule);
      if (err) { setError(`Reguła "${rule.name}": ${err}`); return; }
    }

    setSaving(true);
    setError('');

    try {
      // Delete existing rules and insert new ones
      await supabase.from('dxf_takeoff_rules').delete().eq('company_id', companyId);

      if (localRules.length > 0) {
        const { error: insertError } = await supabase.from('dxf_takeoff_rules').insert(
          localRules.map(r => ({
            id: r.id.startsWith('rule_') || r.id.startsWith('def_') ? undefined : r.id,
            company_id: companyId,
            name: r.name,
            category: r.category,
            match_type: r.matchType,
            match_pattern: r.matchPattern,
            quantity_source: r.quantitySource,
            unit: r.unit,
            multiplier: r.multiplier,
            is_default: r.isDefault,
          }))
        );
        if (insertError) throw insertError;
      }

      onRulesChange(localRules);
    } catch (err: any) {
      setError(err.message || 'Błąd zapisu');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-[800px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-semibold">Reguły przedmiaru DXF</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b bg-gray-50">
          <button onClick={addRule} className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700">
            <Plus size={12} /> Dodaj regułę
          </button>
          <button onClick={() => importDefaults('dxf')} className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-200 rounded hover:bg-gray-300">
            <Download size={12} /> Domyślne DXF
          </button>
          <button onClick={() => importDefaults('pdf')} className="flex items-center gap-1 px-2 py-1 text-xs bg-purple-100 text-purple-700 rounded hover:bg-purple-200">
            <Download size={12} /> Domyślne PDF
          </button>
          {onTestRules && (
            <button onClick={onTestRules} className="flex items-center gap-1 px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700">
              <TestTube size={12} /> Testuj reguły
            </button>
          )}
          <span className="text-xs text-gray-400 ml-auto">{localRules.length} reguł</span>
        </div>

        {error && (
          <div className="px-4 py-1.5 bg-red-50 text-red-600 text-xs">{error}</div>
        )}

        {/* Rules list */}
        <div className="overflow-y-auto flex-1">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 text-gray-500 sticky top-0">
                <th className="text-left px-3 py-1.5 font-medium">Nazwa</th>
                <th className="text-left px-2 py-1.5 font-medium">Kategoria</th>
                <th className="text-left px-2 py-1.5 font-medium">Dopasowanie</th>
                <th className="text-left px-2 py-1.5 font-medium">Wzorzec</th>
                <th className="text-left px-2 py-1.5 font-medium">Źródło</th>
                <th className="text-left px-2 py-1.5 font-medium">Jedn.</th>
                <th className="text-right px-2 py-1.5 font-medium">Mnożnik</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {localRules.map(rule => (
                <tr
                  key={rule.id}
                  className={`border-b hover:bg-blue-50 ${editingId === rule.id ? 'bg-blue-50' : ''}`}
                  onClick={() => setEditingId(rule.id)}
                >
                  <td className="px-3 py-1">
                    {editingId === rule.id ? (
                      <input value={rule.name} onChange={e => updateRule(rule.id, { name: e.target.value })} className="w-full border rounded px-1 py-0.5 text-xs" />
                    ) : (
                      <span className="truncate">{rule.name}</span>
                    )}
                  </td>
                  <td className="px-2 py-1">
                    {editingId === rule.id ? (
                      <input value={rule.category} onChange={e => updateRule(rule.id, { category: e.target.value })} className="w-full border rounded px-1 py-0.5 text-xs" />
                    ) : (
                      <span className="truncate text-gray-600">{rule.category}</span>
                    )}
                  </td>
                  <td className="px-2 py-1">
                    {editingId === rule.id ? (
                      <select value={rule.matchType} onChange={e => updateRule(rule.id, { matchType: e.target.value as any })} className="text-xs border rounded px-1 py-0.5">
                        {matchTypes.map(mt => <option key={mt.value} value={mt.value}>{mt.label}</option>)}
                      </select>
                    ) : (
                      <span className="text-gray-500">{matchTypes.find(m => m.value === rule.matchType)?.label}</span>
                    )}
                  </td>
                  <td className="px-2 py-1">
                    {editingId === rule.id ? (
                      <input value={rule.matchPattern} onChange={e => updateRule(rule.id, { matchPattern: e.target.value })} className="w-full border rounded px-1 py-0.5 text-xs font-mono" />
                    ) : (
                      <code className="text-xs bg-gray-100 px-1 rounded">{rule.matchPattern}</code>
                    )}
                  </td>
                  <td className="px-2 py-1">
                    {editingId === rule.id ? (
                      <select value={rule.quantitySource} onChange={e => updateRule(rule.id, { quantitySource: e.target.value as any })} className="text-xs border rounded px-1 py-0.5">
                        {quantitySources.map(qs => <option key={qs.value} value={qs.value}>{qs.label}</option>)}
                      </select>
                    ) : (
                      <span className="text-gray-500">{quantitySources.find(q => q.value === rule.quantitySource)?.label}</span>
                    )}
                  </td>
                  <td className="px-2 py-1">
                    {editingId === rule.id ? (
                      <input value={rule.unit} onChange={e => updateRule(rule.id, { unit: e.target.value })} className="w-12 border rounded px-1 py-0.5 text-xs" />
                    ) : (
                      <span>{rule.unit}</span>
                    )}
                  </td>
                  <td className="px-2 py-1 text-right">
                    {editingId === rule.id ? (
                      <input type="number" step="0.01" value={rule.multiplier} onChange={e => updateRule(rule.id, { multiplier: parseFloat(e.target.value) || 1 })} className="w-16 border rounded px-1 py-0.5 text-xs text-right" />
                    ) : (
                      <span className="font-mono">{rule.multiplier}</span>
                    )}
                  </td>
                  <td className="px-1 py-1">
                    <button onClick={e => { e.stopPropagation(); deleteRule(rule.id); }} className="p-0.5 hover:bg-red-100 rounded text-gray-400 hover:text-red-500">
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
              {localRules.length === 0 && (
                <tr><td colSpan={8} className="text-center py-8 text-gray-400">Brak reguł. Dodaj nową lub zaimportuj domyślne.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50">Anuluj</button>
          <button onClick={handleSave} disabled={saving} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Zapisywanie...' : 'Zapisz reguły'}
          </button>
        </div>
      </div>
    </div>
  );
}
