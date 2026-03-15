import React, { useState } from 'react';
import { X, Save, Check, Loader2 } from 'lucide-react';
import { createTemplate } from '../../lib/documentService';

interface SaveAsTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  documentData: {
    name: string;
    type: string;
    content: any;
    variables: any[];
  };
  companyId: string;
  userId: string;
  onSaved: () => void;
}

export const SaveAsTemplateModal: React.FC<SaveAsTemplateModalProps> = ({
  isOpen,
  onClose,
  documentData,
  companyId,
  userId,
  onSaved,
}) => {
  const [name, setName] = useState(documentData.name || '');
  const [description, setDescription] = useState('');
  const [type, setType] = useState(documentData.type || 'other');
  const [isDefault, setIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Nazwa szablonu jest wymagana');
      return;
    }

    setSaving(true);
    setError('');

    try {
      await createTemplate({
        company_id: companyId,
        name: name.trim(),
        type: type as any,
        description: description.trim(),
        content: documentData.content,
        variables: documentData.variables,
        is_active: true,
        created_by: userId,
      });

      onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Wystąpił błąd podczas zapisywania szablonu');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-800">
            Zapisz jako szablon
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
            aria-label="Zamknij"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Nazwa szablonu <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Np. Umowa o roboty budowlane"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Typ dokumentu
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-500"
            >
              <option value="contract">Umowa</option>
              <option value="protocol">Protokół</option>
              <option value="annex">Aneks</option>
              <option value="other">Inne</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Opis (opcjonalnie)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Krótki opis przeznaczenia szablonu"
              rows={3}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-500"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isDefault"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="isDefault" className="text-sm text-slate-600">
              Ustaw jako domyślny dla tego typu
            </label>
          </div>

          <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-700">
            <p className="font-medium mb-1">Co zostanie zapisane:</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>Struktura sekcji dokumentu</li>
              <li>Lista zmiennych ({documentData.variables?.length || 0})</li>
              <li>Formatowanie tekstu</li>
            </ul>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Anuluj
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Zapisz szablon
          </button>
        </div>
      </div>
    </div>
  );
};

export default SaveAsTemplateModal;
