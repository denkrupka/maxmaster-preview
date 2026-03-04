import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, Save, BookOpen, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  loadCompanyMappings,
  saveCompanyMapping,
  deleteCompanyMapping,
  type CompanyMapping,
} from '../../lib/pdfCompanyMappings';

interface PdfMappingDictionaryPanelProps {
  companyId: string;
  onClose: () => void;
  onMappingsChanged?: (mappings: CompanyMapping[]) => void;
}

const CATEGORIES = [
  'Kable', 'Oprawy oświetleniowe', 'Osprzęt elektryczny',
  'Trasy kablowe', 'Tablice i rozdzielnice', 'Instalacja alarmowa',
  'Teletechnika', 'Inne',
];

const MAPPING_TYPES = [
  { value: 'style_color', label: 'Kolor stylu' },
  { value: 'symbol_shape', label: 'Kształt symbolu' },
  { value: 'text_label', label: 'Etykieta tekstowa' },
  { value: 'legend_entry', label: 'Wpis legendy' },
];

export default function PdfMappingDictionaryPanel({
  companyId, onClose, onMappingsChanged,
}: PdfMappingDictionaryPanelProps) {
  const [mappings, setMappings] = useState<CompanyMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<CompanyMapping>>({});

  useEffect(() => {
    loadCompanyMappings(supabase, companyId)
      .then(m => { setMappings(m); setLoading(false); })
      .catch(() => setLoading(false));
  }, [companyId]);

  const startAdd = () => {
    setEditId('new');
    setDraft({
      companyId,
      mappingType: 'style_color',
      matchValue: '',
      elementName: '',
      category: 'Kable',
      unit: 'szt.',
      multiplier: 1,
    });
  };

  const startEdit = (m: CompanyMapping) => {
    setEditId(m.id || null);
    setDraft({ ...m });
  };

  const handleSave = async () => {
    if (!draft.matchValue || !draft.elementName || !draft.category) return;
    setSaving(true);
    try {
      const mapping: CompanyMapping = {
        id: editId !== 'new' ? editId || undefined : undefined,
        companyId,
        mappingType: draft.mappingType as any || 'style_color',
        matchValue: draft.matchValue!,
        elementName: draft.elementName!,
        category: draft.category!,
        unit: draft.unit || 'szt.',
        multiplier: draft.multiplier || 1,
        notes: draft.notes,
      };
      await saveCompanyMapping(supabase, mapping);
      const fresh = await loadCompanyMappings(supabase, companyId);
      setMappings(fresh);
      onMappingsChanged?.(fresh);
      setEditId(null);
      setDraft({});
    } catch (err) {
      console.error(err);
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    await deleteCompanyMapping(supabase, id);
    const fresh = await loadCompanyMappings(supabase, companyId);
    setMappings(fresh);
    onMappingsChanged?.(fresh);
  };

  return (
    <div className="fixed right-0 top-0 bottom-0 w-[480px] bg-white shadow-2xl z-[90] flex flex-col border-l">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <BookOpen size={18} className="text-indigo-600" />
          <h3 className="font-semibold text-sm">Słownik mapowań firmy</h3>
          <span className="text-xs text-gray-400">({mappings.length})</span>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={20} className="animate-spin text-gray-400" />
          </div>
        )}

        {!loading && mappings.length === 0 && !editId && (
          <div className="text-center py-8 text-gray-400 text-sm">
            Brak zapisanych mapowań. Dodaj pierwsze mapowanie.
          </div>
        )}

        {mappings.map(m => (
          <div
            key={m.id}
            className={`border rounded-lg p-3 text-xs ${editId === m.id ? 'border-indigo-300 bg-indigo-50' : 'hover:bg-gray-50'}`}
          >
            {editId === m.id ? (
              renderEditForm()
            ) : (
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    {m.mappingType === 'style_color' && (
                      <div className="w-3 h-3 rounded" style={{ backgroundColor: m.matchValue }} />
                    )}
                    <span className="font-medium">{m.elementName}</span>
                  </div>
                  <div className="text-gray-500">
                    {MAPPING_TYPES.find(t => t.value === m.mappingType)?.label}: <code className="bg-gray-100 px-1 rounded">{m.matchValue}</code>
                  </div>
                  <div className="text-gray-400 mt-0.5">
                    {m.category} · {m.unit} · ×{m.multiplier}
                    {m.usageCount ? ` · użyto ${m.usageCount}×` : ''}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => startEdit(m)} className="p-1 hover:bg-gray-200 rounded text-gray-400">
                    <Save size={14} />
                  </button>
                  <button onClick={() => m.id && handleDelete(m.id)} className="p-1 hover:bg-red-100 rounded text-gray-400 hover:text-red-600">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {editId === 'new' && (
          <div className="border border-indigo-300 bg-indigo-50 rounded-lg p-3 text-xs">
            {renderEditForm()}
          </div>
        )}
      </div>

      <div className="px-4 py-3 border-t bg-gray-50 flex justify-between">
        <button onClick={onClose} className="px-3 py-1.5 text-xs border rounded hover:bg-gray-100">
          Zamknij
        </button>
        {!editId && (
          <button onClick={startAdd} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700">
            <Plus size={14} /> Dodaj mapowanie
          </button>
        )}
      </div>
    </div>
  );

  function renderEditForm() {
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-gray-500">Typ dopasowania</label>
            <select
              value={draft.mappingType || 'style_color'}
              onChange={e => setDraft({ ...draft, mappingType: e.target.value as any })}
              className="w-full border rounded px-2 py-1 text-xs"
            >
              {MAPPING_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-gray-500">Wartość</label>
            <input
              value={draft.matchValue || ''}
              onChange={e => setDraft({ ...draft, matchValue: e.target.value })}
              className="w-full border rounded px-2 py-1 text-xs"
              placeholder={draft.mappingType === 'style_color' ? '#ff0000' : 'CIRCLE'}
            />
          </div>
        </div>
        <div>
          <label className="text-[10px] text-gray-500">Nazwa elementu</label>
          <input
            value={draft.elementName || ''}
            onChange={e => setDraft({ ...draft, elementName: e.target.value })}
            className="w-full border rounded px-2 py-1 text-xs"
            placeholder="Kabel YDYp 3x2.5"
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-[10px] text-gray-500">Kategoria</label>
            <select
              value={draft.category || 'Kable'}
              onChange={e => setDraft({ ...draft, category: e.target.value })}
              className="w-full border rounded px-2 py-1 text-xs"
            >
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-gray-500">Jednostka</label>
            <input
              value={draft.unit || 'szt.'}
              onChange={e => setDraft({ ...draft, unit: e.target.value })}
              className="w-full border rounded px-2 py-1 text-xs"
            />
          </div>
          <div>
            <label className="text-[10px] text-gray-500">Mnożnik</label>
            <input
              type="number"
              value={draft.multiplier || 1}
              onChange={e => setDraft({ ...draft, multiplier: parseFloat(e.target.value) || 1 })}
              className="w-full border rounded px-2 py-1 text-xs"
              step="0.1"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={() => { setEditId(null); setDraft({}); }}
            className="px-2 py-1 text-xs border rounded hover:bg-gray-100"
          >
            Anuluj
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            Zapisz
          </button>
        </div>
      </div>
    );
  }
}
