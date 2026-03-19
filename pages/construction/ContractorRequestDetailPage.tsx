import React, { useEffect, useState } from 'react'

const ContractorRequestDetailPage: React.FC = () => {
  const pathParts = window.location.hash.split('/')
  const requestId = pathParts[pathParts.length - 1]
  const [request, setRequest] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const { supabase } = (window as any).__supabase || {}
        if (!supabase || !requestId) { setLoading(false); return }
        const { data } = await supabase.from('subcontractor_requests')
          .select('*, offers(title, status)')
          .eq('id', requestId).single()
        setRequest(data)
      } catch(e) { console.error(e) }
      setLoading(false)
    }
    load()
  }, [requestId])

  if (loading) return <div className="p-8 text-center">Ładowanie...</div>
  if (!request) return <div className="p-8 text-center text-gray-500">Nie znaleziono zapytania</div>

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <button onClick={() => window.history.back()} className="flex items-center gap-2 text-gray-500 hover:text-gray-700 mb-6">
        ← Wróć
      </button>
      <div className="bg-white rounded-xl border p-6">
        <h1 className="text-2xl font-bold mb-2">{request.title || 'Zapytanie dla podwykonawcy'}</h1>
        <div className="grid grid-cols-2 gap-4 mt-4">
          <div><span className="text-sm text-gray-500">Status:</span>
            <span className="ml-2 font-medium">{request.status}</span></div>
          <div><span className="text-sm text-gray-500">Typ:</span>
            <span className="ml-2 font-medium">{request.type || 'Cały zakres'}</span></div>
          <div><span className="text-sm text-gray-500">Podwykonawca:</span>
            <span className="ml-2 font-medium">{request.contractor_name || '-'}</span></div>
          <div><span className="text-sm text-gray-500">Data:</span>
            <span className="ml-2 font-medium">{request.created_at ? new Date(request.created_at).toLocaleDateString('pl-PL') : '-'}</span></div>
        </div>
        {request.description && (
          <div className="mt-4">
            <h3 className="font-medium mb-2">Opis</h3>
            <p className="text-gray-600">{request.description}</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default ContractorRequestDetailPage
