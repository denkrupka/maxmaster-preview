import React, { useState } from 'react';
import { X, Plus, Trash2, Play, Pause, Settings, Loader2, Check, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface Automation {
  id: string;
  name: string;
  trigger_event: string;
  action_type: string;
  is_active: boolean;
  created_at: string;
}

interface AutomationsTabProps {
  companyId: string;
  userId: string;
}

const TRIGGER_OPTIONS = [
  { value: 'document_created', label: 'Dokument utworzony' },
  { value: 'document_signed', label: 'Dokument podpisany' },
  { value: 'document_completed', label: 'Dokument zatwierdzony' },
  { value: 'signature_requested', label: 'Wysłano prośbę o podpis' },
  { value: 'signature_expired', label: 'Podpis wygasł' },
];

const ACTION_OPTIONS = [
  { value: 'send_email', label: 'Wyślij email' },
  { value: 'create_task', label: 'Utwórz zadanie' },
  { value: 'move_to_folder', label: 'Przenieś do folderu' },
  { value: 'notify_slack', label: 'Powiadomienie Slack' },
  { value: 'webhook', label: 'Webhook' },
];

export const AutomationsTab: React.FC<AutomationsTabProps> = ({
  companyId,
  userId,
}) => {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newAutomation, setNewAutomation] = useState({
    name: '',
    trigger_event: '',
    action_type: '',
    action_config: {},
  });

  const loadAutomations = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('document_automations')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });
    setAutomations(data || []);
    setLoading(false);
  };

  React.useEffect(() => {
    loadAutomations();
  }, [companyId]);

  const toggleAutomation = async (id: string, isActive: boolean) => {
    await supabase
      .from('document_automations')
      .update({ is_active: !isActive })
      .eq('id', id);
    loadAutomations();
  };

  const deleteAutomation = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć tę automatyzację?')) return;
    await supabase.from('document_automations').delete().eq('id', id);
    loadAutomations();
  };

  const saveAutomation = async () => {
    if (!newAutomation.name || !newAutomation.trigger_event || !newAutomation.action_type) {
      return;
    }

    await supabase.from('document_automations').insert({
      company_id: companyId,
      created_by: userId,
      name: newAutomation.name,
      trigger_event: newAutomation.trigger_event,
      action_type: newAutomation.action_type,
      action_config: newAutomation.action_config,
      is_active: true,
    });

    setShowAdd(false);
    setNewAutomation({ name: '', trigger_event: '', action_type: '', action_config: {} });
    loadAutomations();
  };

  const getTriggerLabel = (value: string) =>
    TRIGGER_OPTIONS.find((o) => o.value === value)?.label || value;

  const getActionLabel = (value: string) =>
    ACTION_OPTIONS.find((o) => o.value === value)?.label || value;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-medium text-slate-700">
          Automatyzacje dokumentów
        </h3>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Nowa automatyzacja
        </button>
      </div>

      {showAdd && (
        <div className="bg-slate-50 rounded-lg p-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Nazwa automatyzacji
            </label>
            <input
              type="text"
              value={newAutomation.name}
              onChange={(e) =>
                setNewAutomation({ ...newAutomation, name: e.target.value })
              }
              placeholder="Np. Powiadomienie o nowym dokumencie"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Kiedy (trigger)
              </label>
              <select
                value={newAutomation.trigger_event}
                onChange={(e) =>
                  setNewAutomation({
                    ...newAutomation,
                    trigger_event: e.target.value,
                  })
                }
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              >
                <option value="">Wybierz...</option>
                {TRIGGER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Wykonaj (akcja)
              </label>
              <select
                value={newAutomation.action_type}
                onChange={(e) =>
                  setNewAutomation({
                    ...newAutomation,
                    action_type: e.target.value,
                  })
                }
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              >
                <option value="">Wybierz...</option>
                {ACTION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowAdd(false)}
              className="px-3 py-1.5 text-xs text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-100"
            >
              Anuluj
            </button>
            <button
              onClick={saveAutomation}
              disabled={
                !newAutomation.name ||
                !newAutomation.trigger_event ||
                !newAutomation.action_type
              }
              className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              Zapisz
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
        </div>
      ) : automations.length === 0 ? (
        <div className="text-center py-8 text-slate-400">
          <Settings className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p className="text-sm">Brak skonfigurowanych automatyzacji</p>
          <p className="text-xs mt-1">
            Utwórz automatyzację, aby zautomatyzować przepływ dokumentów
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {automations.map((auto) => (
            <div
              key={auto.id}
              className="flex items-center justify-between p-3 bg-slate-50 rounded-lg"
            >
              <div>
                <p className="text-sm font-medium">{auto.name}</p>
                <p className="text-xs text-slate-500">
                  {getTriggerLabel(auto.trigger_event)} →{' '}
                  {getActionLabel(auto.action_type)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => toggleAutomation(auto.id, auto.is_active)}
                  className={`p-1.5 rounded transition-colors ${
                    auto.is_active
                      ? 'bg-green-100 text-green-700 hover:bg-green-200'
                      : 'bg-slate-200 text-slate-500 hover:bg-slate-300'
                  }`}
                  title={auto.is_active ? 'Wyłącz' : 'Włącz'}
                >
                  {auto.is_active ? (
                    <Play className="w-4 h-4" />
                  ) : (
                    <Pause className="w-4 h-4" />
                  )}
                </button>
                <button
                  onClick={() => deleteAutomation(auto.id)}
                  className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                  title="Usuń"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AutomationsTab;
