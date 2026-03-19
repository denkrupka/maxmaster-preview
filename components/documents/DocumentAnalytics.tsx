import React, { useEffect, useState } from 'react'

interface AnalyticsData {
  total_documents: number
  draft_count: number
  sent_count: number
  signed_count: number
  expired_count: number
  overdue_count: number
}

interface Props { supabase: any; companyId: string }

const DocumentAnalytics: React.FC<Props> = ({ supabase, companyId }) => {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const { data: docs } = await supabase.from('documents')
        .select('status, expires_at').eq('company_id', companyId)
      if (!docs) { setLoading(false); return }
      const now = new Date()
      setData({
        total_documents: docs.length,
        draft_count: docs.filter((d: any) => d.status === 'draft').length,
        sent_count: docs.filter((d: any) => d.status === 'sent').length,
        signed_count: docs.filter((d: any) => d.status === 'signed').length,
        expired_count: docs.filter((d: any) => d.status === 'expired').length,
        overdue_count: docs.filter((d: any) => d.expires_at && new Date(d.expires_at) < now && !['signed','withdrawn','expired'].includes(d.status)).length,
      })
      setLoading(false)
    }
    load()
  }, [companyId])

  if (loading) return <div className="animate-pulse h-32 bg-gray-100 rounded-xl" />
  if (!data) return null

  const cards = [
    { label: 'Wszystkie', value: data.total_documents, color: 'bg-blue-50 text-blue-700' },
    { label: 'Szkice', value: data.draft_count, color: 'bg-gray-50 text-gray-600' },
    { label: 'Wysłane', value: data.sent_count, color: 'bg-blue-50 text-blue-700' },
    { label: 'Podpisane', value: data.signed_count, color: 'bg-green-50 text-green-700' },
    { label: 'Wygasłe', value: data.expired_count, color: 'bg-orange-50 text-orange-700' },
    { label: '⚠️ Przeterminowane', value: data.overdue_count, color: 'bg-red-50 text-red-700' },
  ]

  return (
    <div className="grid grid-cols-3 gap-3 mb-6 sm:grid-cols-6">
      {cards.map(c => (
        <div key={c.label} className={`rounded-xl p-3 text-center ${c.color}`}>
          <div className="text-2xl font-bold">{c.value}</div>
          <div className="text-xs mt-1">{c.label}</div>
        </div>
      ))}
    </div>
  )
}

export default DocumentAnalytics
