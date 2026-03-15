import React, { useState, useEffect } from 'react';
import { Key, Webhook, Copy, Trash2, Plus, RefreshCw, AlertCircle, Check } from 'lucide-react';
import { useAppContext } from '../../context/AppContext';
import { Button } from '../../components/Button';
import { supabase } from '../../lib/supabase';

interface ApiKey {
  id: string;
  name: string;
  permissions: string[];
  is_active: boolean;
  created_at: string;
  expires_at?: string;
  last_used_at?: string;
}

interface Webhook {
  id: string;
  name: string;
  url: string;
  events: string[];
  is_active: boolean;
  created_at: string;
}

export const ApiSettingsManager: React.FC = () => {
  const { state } = useAppContext();
  const { currentCompany, currentUser } = state;
  
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(false);
  const [showNewKeyForm, setShowNewKeyForm] = useState(false);
  const [showNewWebhookForm, setShowNewWebhookForm] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  
  // Webhook form
  const [webhookForm, setWebhookForm] = useState({
    name: '',
    url: '',
    secret: '',
    events: [] as string[],
  });

  const availableEvents = [
    'document.created',
    'document.sent',
    'document.signed',
    'document.expired',
    'document.cancelled',
    'verification.completed',
  ];

  useEffect(() => {
    if (currentCompany) {
      loadApiKeys();
      loadWebhooks();
    }
  }, [currentCompany]);

  const loadApiKeys = async () => {
    if (!currentCompany) return;
    const { data } = await supabase
      .from('api_keys')
      .select('id, name, permissions, is_active, created_at, expires_at, last_used_at')
      .eq('company_id', currentCompany.id)
      .order('created_at', { ascending: false });
    
    if (data) setApiKeys(data);
  };

  const loadWebhooks = async () => {
    if (!currentCompany) return;
    const { data } = await supabase
      .from('webhooks')
      .select('*')
      .eq('company_id', currentCompany.id)
      .order('created_at', { ascending: false });
    
    if (data) setWebhooks(data);
  };

  const createApiKey = async () => {
    if (!newKeyName.trim() || !currentCompany || !currentUser) return;
    
    setLoading(true);
    
    // Generate a random API key
    const keyPrefix = 'mm_';
    const keyRandom = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    const fullKey = `${keyPrefix}${keyRandom}`;
    
    // Hash the key for storage (in production, use proper hashing)
    const keyHash = fullKey;
    
    const { error } = await supabase.from('api_keys').insert([{
      company_id: currentCompany.id,
      name: newKeyName,
      key_hash: keyHash,
      permissions: ['documents:read', 'documents:write', 'webhooks:read', 'webhooks:write'],
      is_active: true,
      created_by: currentUser.id,
    }]);
    
    setLoading(false);
    
    if (!error) {
      setNewlyCreatedKey(fullKey);
      setNewKeyName('');
      setShowNewKeyForm(false);
      loadApiKeys();
    }
  };

  const revokeApiKey = async (id: string) => {
    if (!confirm('Czy na pewno chcesz unieważnić ten klucz API?')) return;
    
    await supabase.from('api_keys').update({ is_active: false }).eq('id', id);
    loadApiKeys();
  };

  const createWebhook = async () => {
    if (!webhookForm.name.trim() || !webhookForm.url.trim() || !currentCompany) return;
    
    setLoading(true);
    
    const { error } = await supabase.from('webhooks').insert([{
      company_id: currentCompany.id,
      name: webhookForm.name,
      url: webhookForm.url,
      secret: webhookForm.secret,
      events: webhookForm.events,
      is_active: true,
    }]);
    
    setLoading(false);
    
    if (!error) {
      setWebhookForm({ name: '', url: '', secret: '', events: [] });
      setShowNewWebhookForm(false);
      loadWebhooks();
    }
  };

  const deleteWebhook = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć ten webhook?')) return;
    
    await supabase.from('webhooks').delete().eq('id', id);
    loadWebhooks();
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleEvent = (event: string) => {
    setWebhookForm(prev => ({
      ...prev,
      events: prev.events.includes(event)
        ? prev.events.filter(e => e !== event)
        : [...prev.events, event],
    }));
  };

  if (!currentCompany) {
    return (
      <div className="p-6 text-center text-slate-500">
        <AlertCircle size={48} className="mx-auto mb-4 text-slate-300" />
        <p>Wybierz firmę, aby zarządzać ustawieniami API</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* API Keys Section */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Key size={20} className="text-blue-600" />
            <h3 className="font-bold text-slate-900">Klucze API</h3>
          </div>
          <Button size="sm" onClick={() => setShowNewKeyForm(true)}>
            <Plus size={16} className="mr-1" />
            Nowy klucz
          </Button>
        </div>
        
        <div className="p-4">
          {newlyCreatedKey && (
            <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-green-800">Klucz API został utworzony!</span>
                <button 
                  onClick={() => setNewlyCreatedKey(null)}
                  className="text-green-600 hover:text-green-800"
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <p className="text-sm text-green-700 mb-2">
                Skopiuj klucz teraz. Nie będzie można go ponownie wyświetlić.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-white border border-green-300 rounded px-3 py-2 text-sm font-mono break-all">
                  {newlyCreatedKey}
                </code>
                <button
                  onClick={() => copyToClipboard(newlyCreatedKey)}
                  className="p-2 bg-green-600 text-white rounded hover:bg-green-700"
                >
                  {copied ? <Check size={18} /> : <Copy size={18} />}
                </button>
              </div>
            </div>
          )}
          
          {showNewKeyForm && (
            <div className="mb-4 p-4 bg-slate-50 rounded-lg">
              <h4 className="font-medium text-slate-700 mb-3">Nowy klucz API</h4>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="Nazwa klucza (np. Integracja z CRM)"
                  className="flex-1 border border-slate-300 rounded-lg px-3 py-2"
                />
                <Button onClick={createApiKey} disabled={loading || !newKeyName.trim()}>
                  <RefreshCw size={16} className={`mr-1 ${loading ? 'animate-spin' : ''}`} />
                  Utwórz
                </Button>
                <Button variant="ghost" onClick={() => setShowNewKeyForm(false)}>
                  Anuluj
                </Button>
              </div>
            </div>
          )}
          
          <div className="space-y-2">
            {apiKeys.map(key => (
              <div key={key.id} className="flex items-center justify-between p-3 border border-slate-200 rounded-lg">
                <div>
                  <div className="font-medium text-slate-900">{key.name}</div>
                  <div className="text-sm text-slate-500">
                    Utworzony: {new Date(key.created_at).toLocaleDateString()}
                    {key.last_used_at && ` • Używany: ${new Date(key.last_used_at).toLocaleDateString()}`}
                  </div>
                  <div className="flex gap-1 mt-1">
                    {key.permissions.map(perm => (
                      <span key={perm} className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded">
                        {perm}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-1 rounded ${key.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {key.is_active ? 'Aktywny' : 'Unieważniony'}
                  </span>
                  <button
                    onClick={() => revokeApiKey(key.id)}
                    className="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
                    title="Unieważnij klucz"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            ))}
            {apiKeys.length === 0 && (
              <p className="text-center text-slate-400 py-4">Brak kluczy API</p>
            )}
          </div>
        </div>
      </div>

      {/* API Documentation */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50">
          <h3 className="font-bold text-slate-900">Dokumentacja API</h3>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <h4 className="font-medium text-slate-700 mb-2">Endpoint</h4>
            <code className="block bg-slate-900 text-green-400 px-4 py-3 rounded-lg text-sm font-mono">
              POST https://diytvuczpciikzdhldny.supabase.co/functions/v1/api-documents
            </code>
          </div>
          
          <div>
            <h4 className="font-medium text-slate-700 mb-2">Autentykacja</h4>
            <p className="text-sm text-slate-600 mb-2">
              Dołącz klucz API w nagłówku:
            </p>
            <code className="block bg-slate-900 text-blue-400 px-4 py-3 rounded-lg text-sm font-mono">
              X-API-Key: mm_your_api_key_here
            </code>
          </div>

          <div>
            <h4 className="font-medium text-slate-700 mb-2">Przykład - Tworzenie dokumentu</h4>
            <pre className="bg-slate-900 text-slate-300 px-4 py-3 rounded-lg text-xs font-mono overflow-x-auto">
{`curl -X POST \\
  https://diytvuczpciikzdhldny.supabase.co/functions/v1/api-documents \\
  -H "X-API-Key: mm_your_api_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "Umowa o pracę",
    "content": "Treść dokumentu...",
    "type": "employment_contract",
    "recipient_email": "pracownik@example.com",
    "recipient_name": "Jan Kowalski"
  }'`}
            </pre>
          </div>

          <div>
            <h4 className="font-medium text-slate-700 mb-2">Webhooki</h4>
            <p className="text-sm text-slate-600">
              Konfiguruj webhooki, aby otrzymywać powiadomienia o zdarzeniach:
            </p>
            <ul className="list-disc list-inside text-sm text-slate-600 mt-2">
              <li>document.created - dokument utworzony</li>
              <li>document.sent - dokument wysłany do podpisania</li>
              <li>document.signed - dokument podpisany</li>
              <li>document.expired - dokument wygasł</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Webhooks Section */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Webhook size={20} className="text-purple-600" />
            <h3 className="font-bold text-slate-900">Webhooki</h3>
          </div>
          <Button size="sm" onClick={() => setShowNewWebhookForm(true)}>
            <Plus size={16} className="mr-1" />
            Nowy webhook
          </Button>
        </div>
        
        <div className="p-4">
          {showNewWebhookForm && (
            <div className="mb-4 p-4 bg-slate-50 rounded-lg space-y-3">
              <h4 className="font-medium text-slate-700">Nowy webhook</h4>
              
              <input
                type="text"
                value={webhookForm.name}
                onChange={(e) => setWebhookForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Nazwa webhooka"
                className="w-full border border-slate-300 rounded-lg px-3 py-2"
              />
              
              <input
                type="url"
                value={webhookForm.url}
                onChange={(e) => setWebhookForm(prev => ({ ...prev, url: e.target.value }))}
                placeholder="URL webhooka (https://...)"
                className="w-full border border-slate-300 rounded-lg px-3 py-2"
              />
              
              <input
                type="text"
                value={webhookForm.secret}
                onChange={(e) => setWebhookForm(prev => ({ ...prev, secret: e.target.value }))}
                placeholder="Secret (opcjonalne, dla weryfikacji)"
                className="w-full border border-slate-300 rounded-lg px-3 py-2"
              />
              
              <div>
                <span className="text-sm font-medium text-slate-700">Zdarzenia:</span>
                <div className="flex flex-wrap gap-2 mt-2">
                  {availableEvents.map(event => (
                    <button
                      key={event}
                      onClick={() => toggleEvent(event)}
                      className={`text-xs px-3 py-1 rounded-full transition-colors ${
                        webhookForm.events.includes(event)
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-200 text-slate-600 hover:bg-slate-300'
                      }`}
                    >
                      {event}
                    </button>
                  ))}
                </div>
              </div>
              
              <div className="flex gap-2">
                <Button 
                  onClick={createWebhook} 
                  disabled={loading || !webhookForm.name.trim() || !webhookForm.url.trim() || webhookForm.events.length === 0}
                >
                  <RefreshCw size={16} className={`mr-1 ${loading ? 'animate-spin' : ''}`} />
                  Utwórz
                </Button>
                <Button variant="ghost" onClick={() => setShowNewWebhookForm(false)}>
                  Anuluj
                </Button>
              </div>
            </div>
          )}
          
          <div className="space-y-2">
            {webhooks.map(webhook => (
              <div key={webhook.id} className="flex items-center justify-between p-3 border border-slate-200 rounded-lg">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-slate-900">{webhook.name}</div>
                  <div className="text-sm text-slate-500 truncate">{webhook.url}</div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {webhook.events.map(event => (
                      <span key={event} className="text-xs px-2 py-0.5 bg-purple-100 text-purple-600 rounded">
                        {event}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-4">
                  <span className={`text-xs px-2 py-1 rounded ${webhook.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {webhook.is_active ? 'Aktywny' : 'Nieaktywny'}
                  </span>
                  <button
                    onClick={() => deleteWebhook(webhook.id)}
                    className="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
                    title="Usuń webhook"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            ))}
            {webhooks.length === 0 && (
              <p className="text-center text-slate-400 py-4">Brak webhooków</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ApiSettingsManager;
