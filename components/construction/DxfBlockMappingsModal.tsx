import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, Search } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface BlockMapping {
  id: string;
  source_name: string;
  source_type: 'layer' | 'block';
  mapped_category: string;
  mapped_description: string;
  investor: string;
  design_office: string;
}

interface DxfBlockMappingsModalProps {
  companyId: string;
  onClose: () => void;
}

const CATEGORIES = [
  'Kable i przewody', 'Oprawy oświetleniowe', 'Osprzęt elektryczny',
  'Trasy kablowe', 'Tablice i rozdzielnice', 'Instalacja alarmowa',
  'Instalacja odgromowa', 'Wymiary i opisy', 'Konstrukcja / architektura', 'Inne',
];

export default function DxfBlockMappingsModal({ companyId, onClose }: DxfBlockMappingsModalProps) {
  const [mappings, setMappings] = useState<BlockMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [filterInvestor, setFilterInvestor] = useState('');
  const [filterOffice, setFilterOffice] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadMappings();
  }, [companyId]);

  const loadMappings = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('dxf_block_mappings')
      .select('*')
      .eq('company_id', companyId)
      .order('source_name');
    setMappings(data || []);
    setLoading(false);
  };

  const addMapping = async () => {
    const newMapping: Partial<BlockMapping> = {
      source_name: '',
      source_type: 'block',
      mapped_category: 'Inne',
      mapped_description: '',
      investor: '',
      design_office: '',
    };
    const { data, error } = await supabase
      .from('dxf_block_mappings')
      .insert({ ...newMapping, company_id: companyId })
      .select()
      .single();
    if (data) {
      setMappings([...mappings, data]);
      setEditingId(data.id);
    }
  };

  const updateMapping = async (id: string, updates: Partial<BlockMapping>) => {
    setMappings(mappings.map(m => m.id === id ? { ...m, ...updates } : m));
  };

  const saveMapping = async (mapping: BlockMapping) => {
    setSaving(true);
    await supabase.from('dxf_block_mappings').update({
      source_name: mapping.source_name,
      source_type: mapping.source_type,
      mapped_category: mapping.mapped_category,
      mapped_description: mapping.mapped_description,
      investor: mapping.investor,
      design_office: mapping.design_office,
    }).eq('id', mapping.id);
    setSaving(false);
    setEditingId(null);
  };

  const deleteMapping = async (id: string) => {
    await supabase.from('dxf_block_mappings').delete().eq('id', id);
    setMappings(mappings.filter(m => m.id !== id));
  };

  const filtered = mappings.filter(m => {
    if (filter && !m.source_name.toLowerCase().includes(filter.toLowerCase()) && !m.mapped_description.toLowerCase().includes(filter.toLowerCase())) return false;
    if (filterInvestor && m.investor !== filterInvestor) return false;
    if (filterOffice && m.design_office !== filterOffice) return false;
    return true;
  });

  const investors = [...new Set(mappings.map(m => m.investor).filter(Boolean))];
  const offices = [...new Set(mappings.map(m => m.design_office).filter(Boolean))];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-[850px] max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-semibold">Słownik mapowań bloków/warstw DXF</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 px-4 py-2 border-b bg-gray-50">
          <div className="flex items-center gap-1 flex-1">
            <Search size={14} className="text-gray-400" />
            <input
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Szukaj..."
              className="flex-1 text-xs border rounded px-2 py-1"
            />
          </div>
          <select value={filterInvestor} onChange={e => setFilterInvestor(e.target.value)} className="text-xs border rounded px-1 py-1">
            <option value="">Wszyscy inwestorzy</option>
            {investors.map(i => <option key={i} value={i}>{i}</option>)}
          </select>
          <select value={filterOffice} onChange={e => setFilterOffice(e.target.value)} className="text-xs border rounded px-1 py-1">
            <option value="">Wszystkie biura</option>
            {offices.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          <button onClick={addMapping} className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700">
            <Plus size={12} /> Dodaj
          </button>
        </div>

        {/* Table */}
        <div className="overflow-y-auto flex-1">
          {loading ? (
            <div className="p-8 text-center text-gray-400 text-sm">Ładowanie...</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 text-gray-500 sticky top-0">
                  <th className="text-left px-3 py-1.5 font-medium">Nazwa źródłowa</th>
                  <th className="text-left px-2 py-1.5 font-medium w-16">Typ</th>
                  <th className="text-left px-2 py-1.5 font-medium">Kategoria</th>
                  <th className="text-left px-2 py-1.5 font-medium">Opis</th>
                  <th className="text-left px-2 py-1.5 font-medium">Inwestor</th>
                  <th className="text-left px-2 py-1.5 font-medium">Biuro proj.</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(m => {
                  const isEditing = editingId === m.id;
                  return (
                    <tr key={m.id} className={`border-b hover:bg-blue-50 ${isEditing ? 'bg-blue-50' : ''}`} onClick={() => setEditingId(m.id)}>
                      <td className="px-3 py-1">
                        {isEditing ? (
                          <input value={m.source_name} onChange={e => updateMapping(m.id, { source_name: e.target.value })} className="w-full border rounded px-1 py-0.5 text-xs font-mono" autoFocus />
                        ) : (
                          <code className="bg-gray-100 px-1 rounded">{m.source_name || '—'}</code>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        {isEditing ? (
                          <select value={m.source_type} onChange={e => updateMapping(m.id, { source_type: e.target.value as any })} className="text-xs border rounded px-1 py-0.5">
                            <option value="block">Blok</option>
                            <option value="layer">Warstwa</option>
                          </select>
                        ) : (
                          <span className="text-gray-500">{m.source_type === 'block' ? 'Blok' : 'Warstwa'}</span>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        {isEditing ? (
                          <select value={m.mapped_category} onChange={e => updateMapping(m.id, { mapped_category: e.target.value })} className="text-xs border rounded px-1 py-0.5">
                            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        ) : (
                          <span>{m.mapped_category}</span>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        {isEditing ? (
                          <input value={m.mapped_description} onChange={e => updateMapping(m.id, { mapped_description: e.target.value })} className="w-full border rounded px-1 py-0.5 text-xs" />
                        ) : (
                          <span className="text-gray-600 truncate">{m.mapped_description || '—'}</span>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        {isEditing ? (
                          <input value={m.investor} onChange={e => updateMapping(m.id, { investor: e.target.value })} className="w-full border rounded px-1 py-0.5 text-xs" />
                        ) : (
                          <span className="text-gray-500 truncate">{m.investor || '—'}</span>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        {isEditing ? (
                          <input value={m.design_office} onChange={e => updateMapping(m.id, { design_office: e.target.value })} className="w-full border rounded px-1 py-0.5 text-xs" />
                        ) : (
                          <span className="text-gray-500 truncate">{m.design_office || '—'}</span>
                        )}
                      </td>
                      <td className="px-1 py-1">
                        <div className="flex gap-0.5">
                          {isEditing && (
                            <button onClick={e => { e.stopPropagation(); saveMapping(m); }} className="px-1 py-0.5 text-[10px] bg-blue-600 text-white rounded">OK</button>
                          )}
                          <button onClick={e => { e.stopPropagation(); deleteMapping(m.id); }} className="p-0.5 hover:bg-red-100 rounded text-gray-400 hover:text-red-500">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={7} className="text-center py-8 text-gray-400">Brak mapowań</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-4 py-2 border-t text-xs text-gray-400">
          {mappings.length} mapowań łącznie
        </div>
      </div>
    </div>
  );
}
