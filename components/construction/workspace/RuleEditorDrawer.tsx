import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, ChevronDown, GripVertical, Copy, Save, ToggleLeft, ToggleRight } from 'lucide-react';
import type { MappingRule, RuleCondition, RuleConditionField, RuleConditionOperator, AggregationMode } from './WorkspaceTypes';

interface RuleEditorDrawerProps {
  isOpen: boolean;
  rules: MappingRule[];
  editingRuleId: string | null;
  onSaveRule: (rule: MappingRule) => void;
  onDeleteRule: (ruleId: string) => void;
  onToggleRule: (ruleId: string) => void;
  onReorderRules: (rules: MappingRule[]) => void;
  onClose: () => void;
}

const FIELD_OPTIONS: { value: RuleConditionField; label: string }[] = [
  { value: 'category', label: 'Kategoria' },
  { value: 'family', label: 'Rodzina' },
  { value: 'type', label: 'Typ' },
  { value: 'layer', label: 'Warstwa' },
  { value: 'name', label: 'Nazwa' },
  { value: 'blockName', label: 'Blok' },
  { value: 'system', label: 'System' },
  { value: 'level', label: 'Poziom' },
  { value: 'zone', label: 'Strefa' },
  { value: 'classification', label: 'Klasyfikacja' },
  { value: 'geometryType', label: 'Typ geometrii' },
  { value: 'aiClass', label: 'Klasa AI' },
  { value: 'property', label: 'Wlasciwosc (sciezka)' },
];

const OPERATOR_OPTIONS: { value: RuleConditionOperator; label: string }[] = [
  { value: 'equals', label: '=' },
  { value: 'contains', label: 'zawiera' },
  { value: 'startsWith', label: 'zaczyna sie od' },
  { value: 'endsWith', label: 'konczy sie na' },
  { value: 'regex', label: 'regex' },
  { value: 'exists', label: 'istnieje' },
  { value: 'greaterThan', label: '>' },
  { value: 'lessThan', label: '<' },
];

const AGG_OPTIONS: { value: AggregationMode; label: string }[] = [
  { value: 'count', label: 'Zlicz (szt.)' },
  { value: 'sum-length', label: 'Suma dlugosci (m)' },
  { value: 'sum-area', label: 'Suma pow. (m2)' },
  { value: 'sum-volume', label: 'Suma obj. (m3)' },
  { value: 'custom', label: 'Niestandardowa' },
];

const emptyCondition = (): RuleCondition => ({
  field: 'category',
  operator: 'contains',
  value: '',
});

const emptyRule = (): MappingRule => ({
  id: `rule-${Date.now()}`,
  name: '',
  active: true,
  priority: 100,
  conditions: [emptyCondition()],
  targetBoqName: '',
  targetCategory: '',
  targetUnit: 'szt.',
  aggregationMode: 'count',
});

export const RuleEditorDrawer: React.FC<RuleEditorDrawerProps> = ({
  isOpen, rules, editingRuleId, onSaveRule, onDeleteRule, onToggleRule, onReorderRules, onClose,
}) => {
  const [editingRule, setEditingRule] = useState<MappingRule | null>(null);
  const [view, setView] = useState<'list' | 'edit'>('list');

  useEffect(() => {
    if (editingRuleId) {
      const found = rules.find(r => r.id === editingRuleId);
      setEditingRule(found ? { ...found, conditions: [...found.conditions] } : null);
      setView('edit');
    } else {
      setView('list');
    }
  }, [editingRuleId, rules]);

  if (!isOpen) return null;

  const startEdit = (rule?: MappingRule) => {
    setEditingRule(rule ? { ...rule, conditions: [...rule.conditions] } : emptyRule());
    setView('edit');
  };

  const saveAndClose = () => {
    if (editingRule && editingRule.name && editingRule.targetBoqName) {
      onSaveRule(editingRule);
      setView('list');
      setEditingRule(null);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/20 z-[70]" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 w-[420px] bg-white shadow-2xl z-[71] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <h3 className="text-sm font-bold text-slate-800">
            {view === 'edit' ? (editingRule?.id ? 'Edytuj regule' : 'Nowa regula') : 'Silnik regul'}
          </h3>
          <div className="flex items-center gap-1">
            {view === 'edit' && (
              <button onClick={() => { setView('list'); setEditingRule(null); }}
                className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1">Wstecz</button>
            )}
            <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg"><X className="w-4 h-4 text-slate-500" /></button>
          </div>
        </div>

        {view === 'list' ? (
          /* Rule List */
          <div className="flex-1 overflow-y-auto">
            <div className="p-3">
              <button onClick={() => startEdit()}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700">
                <Plus className="w-3.5 h-3.5" /> Dodaj regule
              </button>
            </div>

            {rules.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-xs text-slate-400">Brak regul. Dodaj pierwsza regule mapowania.</p>
              </div>
            ) : (
              <div className="space-y-px">
                {rules.sort((a, b) => a.priority - b.priority).map(rule => (
                  <div key={rule.id} className="px-3 py-2 border-b border-slate-100 hover:bg-slate-50 flex items-center gap-2">
                    <GripVertical className="w-3.5 h-3.5 text-slate-300 cursor-grab flex-shrink-0" />
                    <button onClick={() => onToggleRule(rule.id)} className="flex-shrink-0">
                      {rule.active ? <ToggleRight className="w-5 h-5 text-green-500" /> : <ToggleLeft className="w-5 h-5 text-slate-300" />}
                    </button>
                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => startEdit(rule)}>
                      <p className={`text-xs font-medium truncate ${rule.active ? 'text-slate-800' : 'text-slate-400'}`}>{rule.name}</p>
                      <p className="text-[10px] text-slate-400 truncate">
                        {rule.conditions.map(c => `${c.field} ${c.operator} ${c.value}`).join(', ')}
                        {' -> '}{rule.targetBoqName}
                      </p>
                    </div>
                    <span className="text-[9px] text-slate-400 font-mono flex-shrink-0">P{rule.priority}</span>
                    <button onClick={() => startEdit({ ...rule, id: `rule-${Date.now()}`, name: `${rule.name} (kopia)` })}
                      className="p-1 hover:bg-slate-200 rounded text-slate-400" title="Duplikuj">
                      <Copy className="w-3 h-3" />
                    </button>
                    <button onClick={() => onDeleteRule(rule.id)}
                      className="p-1 hover:bg-red-50 rounded text-slate-400 hover:text-red-500" title="Usun">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : editingRule ? (
          /* Edit Form */
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Name & Priority */}
            <div className="space-y-2">
              <div>
                <label className="text-[10px] font-medium text-slate-500">Nazwa reguly</label>
                <input type="text" value={editingRule.name} onChange={e => setEditingRule({ ...editingRule, name: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="np. Oprawy oswietleniowe LED" />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-[10px] font-medium text-slate-500">Priorytet</label>
                  <input type="number" value={editingRule.priority} onChange={e => setEditingRule({ ...editingRule, priority: Number(e.target.value) })}
                    className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg" min={1} />
                </div>
                <div className="flex-1">
                  <label className="text-[10px] font-medium text-slate-500">Zakres</label>
                  <input type="text" value={editingRule.scope || ''} onChange={e => setEditingRule({ ...editingRule, scope: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg" placeholder="np. Electrical" />
                </div>
              </div>
            </div>

            {/* Conditions */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] font-bold text-slate-600 uppercase">Warunki</label>
                <button onClick={() => setEditingRule({ ...editingRule, conditions: [...editingRule.conditions, emptyCondition()] })}
                  className="flex items-center gap-1 text-[10px] text-blue-600 hover:text-blue-800">
                  <Plus className="w-3 h-3" /> Dodaj warunek
                </button>
              </div>
              <div className="space-y-2">
                {editingRule.conditions.map((cond, i) => (
                  <div key={i} className="flex items-center gap-1.5 bg-slate-50 rounded-lg p-2">
                    <select value={cond.field}
                      onChange={e => {
                        const newConds = [...editingRule.conditions];
                        newConds[i] = { ...cond, field: e.target.value as RuleConditionField };
                        setEditingRule({ ...editingRule, conditions: newConds });
                      }}
                      className="px-1.5 py-1 text-[10px] border border-slate-200 rounded bg-white flex-shrink-0 w-24">
                      {FIELD_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>
                    <select value={cond.operator}
                      onChange={e => {
                        const newConds = [...editingRule.conditions];
                        newConds[i] = { ...cond, operator: e.target.value as RuleConditionOperator };
                        setEditingRule({ ...editingRule, conditions: newConds });
                      }}
                      className="px-1.5 py-1 text-[10px] border border-slate-200 rounded bg-white flex-shrink-0 w-20">
                      {OPERATOR_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    {cond.operator !== 'exists' && (
                      <input type="text" value={cond.value}
                        onChange={e => {
                          const newConds = [...editingRule.conditions];
                          newConds[i] = { ...cond, value: e.target.value };
                          setEditingRule({ ...editingRule, conditions: newConds });
                        }}
                        className="flex-1 px-2 py-1 text-[10px] border border-slate-200 rounded bg-white"
                        placeholder="Wartosc..." />
                    )}
                    <button
                      onClick={() => {
                        const newConds = editingRule.conditions.filter((_, j) => j !== i);
                        setEditingRule({ ...editingRule, conditions: newConds.length ? newConds : [emptyCondition()] });
                      }}
                      className="p-0.5 hover:bg-red-50 rounded text-slate-400 hover:text-red-500 flex-shrink-0">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Target */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-600 uppercase">Cel BOQ</label>
              <div>
                <label className="text-[10px] font-medium text-slate-500">Nazwa pozycji BOQ</label>
                <input type="text" value={editingRule.targetBoqName}
                  onChange={e => setEditingRule({ ...editingRule, targetBoqName: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                  placeholder="np. Oprawa LED 60x60" />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-[10px] font-medium text-slate-500">Kategoria</label>
                  <input type="text" value={editingRule.targetCategory || ''}
                    onChange={e => setEditingRule({ ...editingRule, targetCategory: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                    placeholder="np. lighting" />
                </div>
                <div className="flex-1">
                  <label className="text-[10px] font-medium text-slate-500">Jednostka</label>
                  <input type="text" value={editingRule.targetUnit || ''}
                    onChange={e => setEditingRule({ ...editingRule, targetUnit: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg"
                    placeholder="szt." />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-medium text-slate-500">Agregacja</label>
                <select value={editingRule.aggregationMode}
                  onChange={e => setEditingRule({ ...editingRule, aggregationMode: e.target.value as AggregationMode })}
                  className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg">
                  {AGG_OPTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
              </div>
            </div>

            {/* Save */}
            <div className="pt-2 border-t border-slate-200 flex gap-2">
              <button onClick={saveAndClose}
                disabled={!editingRule.name || !editingRule.targetBoqName}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50">
                <Save className="w-3.5 h-3.5" /> Zapisz regule
              </button>
              <button onClick={() => { setView('list'); setEditingRule(null); }}
                className="px-4 py-2.5 border border-slate-300 text-slate-700 rounded-lg text-xs font-medium hover:bg-slate-50">
                Anuluj
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
};

export default RuleEditorDrawer;
