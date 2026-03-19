import React, { useState } from 'react'

interface Step { email: string; name: string; role: 'signer' | 'approver' | 'viewer'; order: number }
interface Props { supabase: any; companyId: string; onClose: () => void; onSelect?: (template: any) => void; mode: 'save' | 'load' }

const ProcessTemplateModal: React.FC<Props> = ({ supabase, companyId, onClose, onSelect, mode }) => {
  const [name, setName] = useState('')
  const [steps, setSteps] = useState<Step[]>([{ email: '', name: '', role: 'signer', order: 1 }])
  const [signingOrder, setSigningOrder] = useState<'sequential' | 'parallel'>('sequential')
  const [templates, setTemplates] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  React.useEffect(() => {
    if (mode === 'load') {
      supabase.from('document_process_templates').select('*').eq('company_id', companyId).eq('is_active', true)
        .then(({ data }: any) => setTemplates(data || []))
    }
  }, [mode])

  const addStep = () => setSteps(s => [...s, { email: '', name: '', role: 'signer', order: s.length + 1 }])
  const removeStep = (i: number) => setSteps(s => s.filter((_, j) => j !== i))

  const handleSave = async () => {
    if (!name.trim() || steps.length === 0) return
    setLoading(true)
    await supabase.from('document_process_templates').insert({
      company_id: companyId, name, signing_order: signingOrder, steps,
    })
    setLoading(false)
    onClose()
  }

  if (mode === 'load') return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center">
      <div className="bg-white rounded-xl p-6 w-full max-w-md">
        <div className="flex justify-between mb-4">
          <h2 className="text-lg font-semibold">Wybierz szablon procesu</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        {templates.length === 0 ? (
          <p className="text-gray-500 text-sm">Brak zapisanych szablonów</p>
        ) : (
          <div className="space-y-2">
            {templates.map(t => (
              <button key={t.id} onClick={() => { onSelect?.(t); onClose() }}
                className="w-full text-left p-3 border rounded-lg hover:bg-blue-50 hover:border-blue-300">
                <div className="font-medium">{t.name}</div>
                <div className="text-xs text-gray-500">{t.steps?.length || 0} kroków · {t.signing_order === 'sequential' ? 'Sekwencyjnie' : 'Równolegle'}</div>
              </button>
            ))}
          </div>
        )}
        <button onClick={onClose} className="mt-4 w-full py-2 border rounded-lg hover:bg-gray-50">Zamknij</button>
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center">
      <div className="bg-white rounded-xl p-6 w-full max-w-lg overflow-auto max-h-screen">
        <div className="flex justify-between mb-4">
          <h2 className="text-lg font-semibold">Zapisz szablon procesu</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Nazwa szablonu</label>
            <input value={name} onChange={e => setName(e.target.value)} className="border rounded-lg px-3 py-2 w-full" placeholder="np. Umowa z podwykonawcą" />
          </div>
          <div className="flex gap-4">
            {['sequential','parallel'].map(v => (
              <label key={v} className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="order" value={v} checked={signingOrder===v} onChange={() => setSigningOrder(v as any)} />
                <span className="text-sm">{v === 'sequential' ? 'Sekwencyjnie' : 'Równolegle'}</span>
              </label>
            ))}
          </div>
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-sm font-medium">Kroki podpisywania</label>
              <button onClick={addStep} className="text-blue-600 text-sm hover:underline">+ Dodaj krok</button>
            </div>
            {steps.map((step, i) => (
              <div key={i} className="flex gap-2 items-center">
                <span className="text-xs text-gray-400 w-4">{i+1}.</span>
                <input value={step.name} onChange={e => setSteps(s => s.map((x,j) => j===i ? {...x,name:e.target.value} : x))} className="border rounded px-2 py-1.5 text-sm flex-1" placeholder="Imię nazwisko" />
                <input value={step.email} onChange={e => setSteps(s => s.map((x,j) => j===i ? {...x,email:e.target.value} : x))} className="border rounded px-2 py-1.5 text-sm flex-1" placeholder="email@..." />
                <select value={step.role} onChange={e => setSteps(s => s.map((x,j) => j===i ? {...x,role:e.target.value as any} : x))} className="border rounded px-2 py-1.5 text-sm">
                  <option value="signer">Signer</option>
                  <option value="approver">Approver</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button onClick={() => removeStep(i)} className="text-red-400 hover:text-red-600 text-xs">✕</button>
              </div>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-4 py-2 border rounded-lg hover:bg-gray-50">Anuluj</button>
          <button onClick={handleSave} disabled={loading || !name.trim()} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {loading ? 'Zapisuję...' : 'Zapisz szablon'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ProcessTemplateModal
