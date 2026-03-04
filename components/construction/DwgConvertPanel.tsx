import React, { useState } from 'react';
import { FileWarning, RefreshCw, Loader2, CheckCircle, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface DwgConvertPanelProps {
  fileName: string;
  fileUrl: string;
  onConvertComplete: (dxfText: string, dxfFileName: string) => void;
  onClose: () => void;
}

export default function DwgConvertPanel({ fileName, fileUrl, onConvertComplete, onClose }: DwgConvertPanelProps) {
  const [status, setStatus] = useState<'idle' | 'downloading' | 'converting' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');

  const handleConvert = async () => {
    setStatus('downloading');
    setError('');
    setProgress('Pobieranie pliku DWG...');

    try {
      // Download the DWG file
      const response = await fetch(fileUrl);
      if (!response.ok) throw new Error('Nie udało się pobrać pliku DWG');
      const arrayBuffer = await response.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);

      // Convert to base64
      let binary = '';
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
      }
      const fileBase64 = btoa(binary);

      setStatus('converting');
      setProgress('Konwersja DWG → DXF (CloudConvert)...');

      // Call edge function
      const { data, error: fnError } = await supabase.functions.invoke('dwg-convert', {
        body: { fileBase64, fileName },
      });

      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);

      if (!data?.dxfBase64) throw new Error('Brak pliku DXF w odpowiedzi');

      // Decode base64 DXF
      const dxfText = atob(data.dxfBase64);
      const dxfFileName = data.fileName || fileName.replace(/\.dwg$/i, '.dxf');

      setStatus('done');
      setProgress('Konwersja zakończona!');
      onConvertComplete(dxfText, dxfFileName);
    } catch (err: any) {
      setError(err.message || 'Błąd konwersji');
      setStatus('error');
    }
  };

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-gray-900/80">
      <div className="bg-white rounded-xl shadow-2xl w-[420px] p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <FileWarning size={24} className="text-amber-500" />
            <h3 className="font-semibold">Plik DWG wykryty</h3>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
        </div>

        <p className="text-sm text-gray-600 mb-4">
          Plik <strong>{fileName}</strong> jest w formacie DWG (binarny AutoCAD).
          Aby wyświetlić rysunek, musi zostać skonwertowany do formatu DXF.
        </p>

        {status === 'idle' && (
          <div className="space-y-3">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
              Konwersja wymaga połączenia z serwisem CloudConvert. Plik zostanie przesłany do konwersji i usunięty po zakończeniu.
            </div>
            <button
              onClick={handleConvert}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <RefreshCw size={16} /> Konwertuj DWG → DXF
            </button>
          </div>
        )}

        {(status === 'downloading' || status === 'converting') && (
          <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg">
            <Loader2 size={20} className="text-blue-600 animate-spin" />
            <div>
              <div className="text-sm font-medium">{progress}</div>
              <div className="text-xs text-gray-500">Proszę czekać...</div>
            </div>
          </div>
        )}

        {status === 'done' && (
          <div className="flex items-center gap-3 p-3 bg-green-50 rounded-lg">
            <CheckCircle size={20} className="text-green-600" />
            <div>
              <div className="text-sm font-medium text-green-700">Konwersja zakończona!</div>
              <div className="text-xs text-gray-500">Ładowanie rysunku DXF...</div>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="space-y-3">
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
              {error}
            </div>
            <button
              onClick={handleConvert}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <RefreshCw size={16} /> Spróbuj ponownie
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
