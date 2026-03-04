import React, { useState } from 'react';
import { X, Play, Brain, Loader2, CheckCircle, AlertTriangle, Layers, Box, GitBranch } from 'lucide-react';
import type { IDxf } from 'dxf-parser';
import { analyzeDxf, type DxfAnalysis } from '../../lib/dxfAnalyzer';
import { supabase } from '../../lib/supabase';

interface DxfAnalysisModalProps {
  dxf: IDxf;
  companyId: string;
  drawingId: string;
  onAnalysisComplete: (analysis: DxfAnalysis) => void;
  onClose: () => void;
}

type AnalysisStep = 'idle' | 'analyzing' | 'analyzed' | 'classifying' | 'classified' | 'saving' | 'done' | 'error';

export default function DxfAnalysisModal({ dxf, companyId, drawingId, onAnalysisComplete, onClose }: DxfAnalysisModalProps) {
  const [step, setStep] = useState<AnalysisStep>('idle');
  const [analysis, setAnalysis] = useState<DxfAnalysis | null>(null);
  const [error, setError] = useState('');
  const [aiResults, setAiResults] = useState<{ layers: any[]; blocks: any[] } | null>(null);

  const runAnalysis = async () => {
    setStep('analyzing');
    setError('');
    try {
      const result = analyzeDxf(dxf);
      setAnalysis(result);
      setStep('analyzed');
    } catch (err: any) {
      setError(err.message || 'Błąd analizy');
      setStep('error');
    }
  };

  const runAiClassification = async () => {
    if (!analysis) return;
    setStep('classifying');
    setError('');
    try {
      const { data, error: fnError } = await supabase.functions.invoke('dxf-classify', {
        body: {
          layers: analysis.layers.filter(l => l.entityCount > 0).map(l => ({
            name: l.name,
            entityCount: l.entityCount,
            entityTypes: l.entityTypes,
          })),
          blocks: analysis.blocks.filter(b => b.insertCount > 0).map(b => ({
            name: b.name,
            insertCount: b.insertCount,
            containedTypes: b.containedTypes,
          })),
        },
      });

      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);

      setAiResults({ layers: data.layers || [], blocks: data.blocks || [] });
      setStep('classified');
    } catch (err: any) {
      setError(`Klasyfikacja AI: ${err.message || 'Błąd'}`);
      setStep('analyzed'); // go back, don't block
    }
  };

  const saveToDatabase = async () => {
    if (!analysis) return;
    setStep('saving');
    setError('');
    try {
      // Create analysis record
      const { data: analysisRow, error: aErr } = await supabase.from('dxf_analyses').insert({
        company_id: companyId,
        drawing_id: drawingId,
        status: 'completed',
        total_entities: analysis.totalEntities,
        total_blocks: analysis.totalBlocks,
        total_layers: analysis.totalLayers,
        unit_system: analysis.unitSystem,
        ai_classification_status: aiResults ? 'completed' : 'none',
      }).select().single();

      if (aErr) throw aErr;
      const analysisId = analysisRow.id;

      // Save layers
      if (analysis.layers.length > 0) {
        const aiLayerMap = new Map((aiResults?.layers || []).map((l: any) => [l.name, l]));
        await supabase.from('dxf_extracted_layers').insert(
          analysis.layers.map(l => {
            const ai = aiLayerMap.get(l.name);
            return {
              analysis_id: analysisId,
              name: l.name,
              color: l.color,
              entity_count: l.entityCount,
              frozen: l.frozen,
              entity_types: l.entityTypes,
              ai_category: ai?.category,
              ai_confidence: ai?.confidence,
            };
          })
        );
      }

      // Save blocks
      if (analysis.blocks.length > 0) {
        const aiBlockMap = new Map((aiResults?.blocks || []).map((b: any) => [b.name, b]));
        await supabase.from('dxf_extracted_blocks').insert(
          analysis.blocks.map(b => {
            const ai = aiBlockMap.get(b.name);
            return {
              analysis_id: analysisId,
              name: b.name,
              insert_count: b.insertCount,
              sample_layer: b.sampleLayer,
              entity_count: b.entityCount,
              contained_types: b.containedTypes,
              ai_category: ai?.category,
              ai_description: ai?.description,
              ai_confidence: ai?.confidence,
            };
          })
        );
      }

      // Save entities (batch — max 500 at a time)
      const batchSize = 500;
      for (let i = 0; i < analysis.entities.length; i += batchSize) {
        const batch = analysis.entities.slice(i, i + batchSize);
        await supabase.from('dxf_extracted_entities').insert(
          batch.map(e => ({
            analysis_id: analysisId,
            entity_type: e.entityType,
            layer_name: e.layerName,
            block_name: e.blockName,
            geometry: e.geometry,
            length_m: e.lengthM,
            area_m2: e.areaM2,
            properties: e.properties,
            group_id: e.groupId,
            entity_index: e.index,
          }))
        );
      }

      onAnalysisComplete(analysis);
      setStep('done');
    } catch (err: any) {
      setError(err.message || 'Błąd zapisu');
      setStep('error');
    }
  };

  const stepLabel = (s: AnalysisStep) => {
    switch (s) {
      case 'idle': return 'Gotowy do analizy';
      case 'analyzing': return 'Analiza DXF...';
      case 'analyzed': return 'Analiza zakończona';
      case 'classifying': return 'Klasyfikacja AI...';
      case 'classified': return 'Klasyfikacja AI zakończona';
      case 'saving': return 'Zapisywanie do bazy...';
      case 'done': return 'Gotowe!';
      case 'error': return 'Błąd';
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-[600px] max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-semibold">Analiza rysunku DXF</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
        </div>

        <div className="p-4 flex-1 overflow-y-auto space-y-4">
          {/* Step indicator */}
          <div className="flex items-center gap-2">
            {step === 'analyzing' || step === 'classifying' || step === 'saving' ? (
              <Loader2 size={16} className="text-blue-600 animate-spin" />
            ) : step === 'done' || step === 'classified' || step === 'analyzed' ? (
              <CheckCircle size={16} className="text-green-600" />
            ) : step === 'error' ? (
              <AlertTriangle size={16} className="text-red-500" />
            ) : null}
            <span className="text-sm font-medium">{stepLabel(step)}</span>
          </div>

          {error && <div className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</div>}

          {/* Analysis results */}
          {analysis && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-blue-50 rounded-lg p-3 text-center">
                  <Layers size={20} className="mx-auto text-blue-600 mb-1" />
                  <div className="text-lg font-bold">{analysis.totalLayers}</div>
                  <div className="text-xs text-gray-500">Warstw</div>
                </div>
                <div className="bg-green-50 rounded-lg p-3 text-center">
                  <Box size={20} className="mx-auto text-green-600 mb-1" />
                  <div className="text-lg font-bold">{analysis.totalBlocks}</div>
                  <div className="text-xs text-gray-500">Bloków</div>
                </div>
                <div className="bg-purple-50 rounded-lg p-3 text-center">
                  <GitBranch size={20} className="mx-auto text-purple-600 mb-1" />
                  <div className="text-lg font-bold">{analysis.totalEntities}</div>
                  <div className="text-xs text-gray-500">Elementów</div>
                </div>
              </div>

              <div className="text-xs text-gray-500">
                Jednostki: {analysis.unitSystem} | Grupy linii: {analysis.lineGroups.length}
              </div>

              {/* Top layers */}
              <div>
                <div className="text-xs font-medium mb-1">Top warstwy:</div>
                <div className="space-y-0.5 max-h-32 overflow-y-auto">
                  {analysis.layers.slice(0, 10).map(l => (
                    <div key={l.name} className="flex items-center gap-2 text-xs">
                      <div className="w-3 h-3 rounded" style={{ backgroundColor: l.color }} />
                      <span className="flex-1 truncate font-mono">{l.name}</span>
                      <span className="text-gray-400">{l.entityCount} el.</span>
                      {aiResults && (() => {
                        const ai = aiResults.layers.find((al: any) => al.name === l.name);
                        return ai ? <span className="text-blue-500 text-[10px]">{ai.category}</span> : null;
                      })()}
                    </div>
                  ))}
                </div>
              </div>

              {/* Top blocks */}
              {analysis.blocks.length > 0 && (
                <div>
                  <div className="text-xs font-medium mb-1">Top bloki:</div>
                  <div className="space-y-0.5 max-h-32 overflow-y-auto">
                    {analysis.blocks.slice(0, 10).map(b => (
                      <div key={b.name} className="flex items-center gap-2 text-xs">
                        <Box size={10} className="text-gray-400" />
                        <span className="flex-1 truncate font-mono">{b.name}</span>
                        <span className="text-gray-400">{b.insertCount}x</span>
                        {aiResults && (() => {
                          const ai = aiResults.blocks.find((ab: any) => ab.name === b.name);
                          return ai ? <span className="text-blue-500 text-[10px]">{ai.category}</span> : null;
                        })()}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border rounded hover:bg-gray-100">Zamknij</button>
          <div className="flex items-center gap-2">
            {step === 'idle' && (
              <button onClick={runAnalysis} className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
                <Play size={14} /> Rozpocznij analizę
              </button>
            )}
            {(step === 'analyzed' || step === 'classified') && (
              <>
                {step === 'analyzed' && (
                  <button onClick={runAiClassification} className="flex items-center gap-1 px-3 py-1.5 text-sm bg-purple-600 text-white rounded hover:bg-purple-700">
                    <Brain size={14} /> Klasyfikacja AI
                  </button>
                )}
                <button onClick={saveToDatabase} className="flex items-center gap-1 px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700">
                  <CheckCircle size={14} /> Zapisz i kontynuuj
                </button>
              </>
            )}
            {step === 'done' && (
              <button onClick={onClose} className="px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700">
                Gotowe
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
