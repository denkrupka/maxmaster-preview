import React, { useState } from 'react'

interface ImportedRow {
  dzial: string; poddzial: string; nazwa: string
  ilosc: number; jednostka: string; cena?: number
}
interface Props { onClose: () => void; onImport: (rows: ImportedRow[]) => void }

const ImportPriceModal: React.FC<Props> = ({ onClose, onImport }) => {
  const [preview, setPreview] = useState<ImportedRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setLoading(true); setError('')
    try {
      const XLSX = await (window as any).import('https://cdn.sheetjs.com/xlsx-0.20.0/package/xlsx.mjs')
        .catch(() => import('https://cdn.sheetjs.com/xlsx-0.20.0/package/xlsx.mjs'))
      const buffer = await f.arrayBuffer()
      const wb = XLSX.read(buffer, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const data: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 })
      const rows: ImportedRow[] = data.slice(1).filter((r: any[]) => r[2]).map((r: any[]) => ({
        dzial: String(r[0]||''), poddzial: String(r[1]||''), nazwa: String(r[2]||''),
        ilosc: parseFloat(r[3])||1, jednostka: String(r[4]||'szt'),
        cena: r[5] ? parseFloat(r[5]) : undefined
      }))
      setPreview(rows)
    } catch { setError('Nie można przetworzyć pliku. Sprawdź format.') }
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center">
      <div className="bg-white rounded-lg w-3/4 max-h-screen overflow-auto p-6">
        <div className="flex justify-between mb-4">
          <h2 className="text-lg font-semibold">Import przedmiaru</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">Wybierz plik (Excel .xlsx, .xls, CSV)</label>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} className="border rounded px-3 py-2 w-full" />
          <p className="text-xs text-gray-500 mt-1">Format kolumn: Dział | Poddział | Nazwa pozycji | Ilość | Jedn. | Cena</p>
        </div>
        {loading && <div className="text-center py-4 text-gray-500">Przetwarzanie pliku...</div>}
        {error && <div className="text-red-500 text-sm mb-3 bg-red-50 p-3 rounded">{error}</div>}
        {preview.length > 0 && (
          <div className="mb-4">
            <h3 className="text-sm font-medium mb-2">Podgląd — {preview.length} pozycji:</h3>
            <div className="overflow-auto max-h-60">
              <table className="w-full text-xs border-collapse">
                <thead><tr className="bg-gray-50 sticky top-0">
                  <th className="border px-2 py-1 text-left">Dział</th>
                  <th className="border px-2 py-1 text-left">Nazwa</th>
                  <th className="border px-2 py-1">Ilość</th>
                  <th className="border px-2 py-1">Jedn.</th>
                  <th className="border px-2 py-1">Cena</th>
                </tr></thead>
                <tbody>{preview.map((r, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="border px-2 py-1">{r.dzial}</td>
                    <td className="border px-2 py-1">{r.nazwa}</td>
                    <td className="border px-2 py-1 text-center">{r.ilosc}</td>
                    <td className="border px-2 py-1 text-center">{r.jednostka}</td>
                    <td className="border px-2 py-1 text-right">{r.cena ? r.cena.toFixed(2)+' zł' : '-'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2 border-t">
          <button onClick={onClose} className="px-4 py-2 border rounded hover:bg-gray-50">Anuluj</button>
          <button onClick={() => { onImport(preview); onClose() }}
            disabled={preview.length === 0}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
            Importuj {preview.length > 0 ? `(${preview.length} poz.)` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ImportPriceModal
