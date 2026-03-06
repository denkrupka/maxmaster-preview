import React, { useState } from 'react';
import { X, Play, Brain, Loader2, CheckCircle, AlertTriangle, Layers, Box, GitBranch, FileImage, Home } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { classifyPdfPage } from '../../lib/pdfClassifier';
import { extractPageGeometry } from '../../lib/pdfGeometryExtractor';
import { analyzePdfPage, type PdfAnalysisExtra } from '../../lib/pdfAnalyzer';
import { analyzeRasterPdf } from '../../lib/pdfRasterAnalyzer';
import type { PdfClassification, PdfAnalysisStep } from '../../lib/pdfTypes';
import type { DxfAnalysis } from '../../lib/dxfAnalyzer';
import { supabase } from '../../lib/supabase';

interface PdfAnalysisModalProps {
  pdfDoc: PDFDocumentProxy;
  pageNumber: number;
  companyId: string;
  drawingId: string;
  scaleRatio?: number;
  onAnalysisComplete: (analysis: DxfAnalysis, extra?: PdfAnalysisExtra) => void;
  onClose: () => void;
}

export default function PdfAnalysisModal({
  pdfDoc, pageNumber, companyId, drawingId, scaleRatio, onAnalysisComplete, onClose,
}: PdfAnalysisModalProps) {
  const [step, setStep] = useState<PdfAnalysisStep>('idle');
  const [classification, setClassification] = useState<PdfClassification | null>(null);
  const [analysis, setAnalysis] = useState<DxfAnalysis | null>(null);
  const [extra, setExtra] = useState<PdfAnalysisExtra | null>(null);
  const [error, setError] = useState('');
  const [aiClassified, setAiClassified] = useState(false);
  const [extractionProgress, setExtractionProgress] = useState(0);

  const runAnalysis = async () => {
    setStep('classifying');
    setError('');
    setExtractionProgress(0);
    try {
      const page = await pdfDoc.getPage(pageNumber);

      // Step 1: Classify — use a microtask yield to let UI update before heavy work
      await new Promise(r => setTimeout(r, 0));
      const cls = await classifyPdfPage(page);
      setClassification(cls);

      if (cls.contentType === 'raster') {
        // Raster pipeline
        setStep('analyzing');
        await new Promise(r => setTimeout(r, 0));
        const { analysis: result } = await analyzeRasterPdf(page, supabase, pageNumber);
        setAnalysis(result);
        setStep('analyzed');
      } else {
        // Vector pipeline — runs in Web Worker (non-blocking)
        setStep('extracting');
        await new Promise(r => setTimeout(r, 0));
        const extraction = await extractPageGeometry(page, (pct) => {
          setExtractionProgress(pct);
        });

        setStep('analyzing');
        // Yield to UI before heavy sync analysis
        await new Promise(r => setTimeout(r, 0));
        const { analysis: result, extra: analysisExtra } = analyzePdfPage(extraction, {
          calibrationScaleRatio: scaleRatio,
        });
        setAnalysis(result);
        setExtra(analysisExtra);
        setStep('analyzed');
      }
    } catch (err: any) {
      setError(err.message || 'Błąd analizy');
      setStep('error');
    }
  };

  const runAiClassification = async () => {
    if (!analysis || !extra) return;
    setStep('ai_classifying');
    setError('');
    try {
      // Send style groups as "layers" and symbol clusters as "blocks" to dxf-classify
      const { data, error: fnError } = await supabase.functions.invoke('dxf-classify', {
        body: {
          layers: extra.styleGroups.map(sg => ({
            name: sg.name,
            entityCount: sg.pathCount,
            entityTypes: { PDF_PATH: sg.pathCount },
          })),
          blocks: analysis.blocks.map(b => ({
            name: b.name,
            insertCount: b.insertCount,
            containedTypes: b.containedTypes,
          })),
        },
      });

      if (fnError) throw new Error(typeof fnError === 'string' ? fnError : fnError.message || 'Edge Function returned a non-2xx status code');
      if (data?.error) throw new Error(data.error);

      // Apply AI categories to style groups
      const aiLayers: { name: string; category: string; confidence: number }[] = data.layers || [];
      if (extra) {
        for (const aiLayer of aiLayers) {
          const sg = extra.styleGroups.find(g => g.name === aiLayer.name);
          if (sg) {
            sg.category = sg.category || aiLayer.category;
            sg.aiConfidence = aiLayer.confidence;
          }
        }
      }

      setAiClassified(true);
      setStep('analyzed');
    } catch (err: any) {
      setError(`Klasyfikacja AI: ${err.message || 'Błąd'}`);
      setStep('analyzed');
    }
  };

  const saveToDatabase = async () => {
    if (!analysis) return;
    setStep('saving');
    setError('');
    try {
      // Save only lightweight summary — full analysis with 200k+ entities would crash the DB
      const analysisSummary = {
        totalLayers: analysis.totalLayers,
        totalBlocks: analysis.totalBlocks,
        totalEntities: analysis.totalEntities,
        blocks: analysis.blocks,
        lineGroupCount: analysis.lineGroups.length,
      };
      const { data: row, error: aErr } = await supabase.from('pdf_analyses').insert({
        company_id: companyId,
        drawing_id: drawingId,
        page_number: pageNumber,
        content_type: classification?.contentType || 'vector',
        status: 'completed',
        total_paths: extra?.extraction.paths.length || 0,
        total_symbols: extra?.symbols.length || 0,
        total_style_groups: extra?.styleGroups.length || 0,
        total_text_items: extra?.extraction.texts.length || 0,
        total_routes: analysis.lineGroups.length,
        detected_scale: extra?.scaleInfo.scaleText,
        scale_factor: extra?.scaleInfo.scaleFactor,
        ai_classification_status: aiClassified ? 'completed' : 'none',
        analysis_result: analysisSummary,
      }).select().single();

      if (aErr) throw aErr;
      const analysisId = row.id;

      // Save style groups
      if (extra?.styleGroups && extra.styleGroups.length > 0) {
        await supabase.from('pdf_style_groups').insert(
          extra.styleGroups.map(sg => ({
            analysis_id: analysisId,
            name: sg.name,
            stroke_color: sg.strokeColor,
            line_width: sg.lineWidth,
            dash_pattern: sg.dashPattern,
            path_count: sg.pathCount,
            total_length_px: sg.totalLengthPx,
            total_length_m: sg.totalLengthM,
            category: sg.category,
            ai_confidence: sg.aiConfidence,
          }))
        );
      }

      // Save symbols
      if (extra?.symbols && extra.symbols.length > 0) {
        const batchSize = 500;
        for (let i = 0; i < extra.symbols.length; i += batchSize) {
          const batch = extra.symbols.slice(i, i + batchSize);
          await supabase.from('pdf_detected_symbols').insert(
            batch.map(s => ({
              analysis_id: analysisId,
              cluster_id: s.clusterId,
              shape: s.shape,
              center_x: s.centerX,
              center_y: s.centerY,
              radius: s.radius,
              category: s.category,
              description: s.description,
              confidence: s.confidence,
              room: s.room,
            }))
          );
        }
      }

      // Save legend
      if (extra?.legend) {
        await supabase.from('pdf_legends').insert({
          analysis_id: analysisId,
          bounding_box: extra.legend.boundingBox,
          entries: extra.legend.entries,
        });
      }

      setStep('done');
      onAnalysisComplete(analysis, extra || undefined);
    } catch (err: any) {
      setError(err.message || 'Błąd zapisu');
      setStep('error');
    }
  };

  const stepLabel = (s: PdfAnalysisStep) => {
    switch (s) {
      case 'idle': return 'Gotowy do analizy';
      case 'classifying': return 'Klasyfikacja strony...';
      case 'extracting': return `Ekstrakcja geometrii...${extractionProgress > 0 ? ` ${extractionProgress}%` : ''}`;
      case 'analyzing': return classification?.contentType === 'raster' ? 'Analiza AI (Gemini Vision)...' : 'Analiza ścieżek i symboli...';
      case 'analyzed': return 'Analiza zakończona';
      case 'ai_classifying': return 'Klasyfikacja AI grup...';
      case 'saving': return 'Zapisywanie do bazy...';
      case 'done': return 'Gotowe!';
      case 'error': return 'Błąd';
    }
  };

  const contentTypeBadge = (ct: string) => {
    const colors = { vector: 'bg-green-100 text-green-700', raster: 'bg-orange-100 text-orange-700', mixed: 'bg-blue-100 text-blue-700' };
    const labels = { vector: 'Wektorowy', raster: 'Rastrowy', mixed: 'Mieszany' };
    return (
      <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${colors[ct as keyof typeof colors] || 'bg-gray-100'}`}>
        {labels[ct as keyof typeof labels] || ct}
      </span>
    );
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-[600px] max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-2">
            <FileImage size={18} className="text-blue-600" />
            <h3 className="font-semibold">Analiza rysunku PDF</h3>
            {classification && contentTypeBadge(classification.contentType)}
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
        </div>

        <div className="p-4 flex-1 overflow-y-auto space-y-4">
          {/* Step indicator */}
          <div className="flex items-center gap-2">
            {['classifying', 'extracting', 'analyzing', 'ai_classifying', 'saving'].includes(step) ? (
              <Loader2 size={16} className="text-blue-600 animate-spin" />
            ) : ['done', 'analyzed'].includes(step) ? (
              <CheckCircle size={16} className="text-green-600" />
            ) : step === 'error' ? (
              <AlertTriangle size={16} className="text-red-500" />
            ) : null}
            <span className="text-sm font-medium">{stepLabel(step)}</span>
          </div>

          {error && <div className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</div>}

          {/* Classification info */}
          {classification && (
            <div className="text-xs text-gray-500 bg-gray-50 rounded p-2">
              Operacje: wektorowe={classification.vectorOpCount}, rastrowe={classification.rasterOpCount}, tekst={classification.textOpCount}
              {' | '}Pewność: {(classification.confidence * 100).toFixed(0)}%
            </div>
          )}

          {/* Analysis results */}
          {analysis && (
            <div className="space-y-3">
              <div className="grid grid-cols-4 gap-2">
                <div className="bg-blue-50 rounded-lg p-2.5 text-center">
                  <Layers size={18} className="mx-auto text-blue-600 mb-1" />
                  <div className="text-lg font-bold">{extra?.styleGroups.length || analysis.totalLayers}</div>
                  <div className="text-[10px] text-gray-500">Grup stylów</div>
                </div>
                <div className="bg-green-50 rounded-lg p-2.5 text-center">
                  <Box size={18} className="mx-auto text-green-600 mb-1" />
                  <div className="text-lg font-bold">{extra?.symbols.length || analysis.totalBlocks}</div>
                  <div className="text-[10px] text-gray-500">Symboli</div>
                </div>
                <div className="bg-purple-50 rounded-lg p-2.5 text-center">
                  <GitBranch size={18} className="mx-auto text-purple-600 mb-1" />
                  <div className="text-lg font-bold">{analysis.lineGroups.length}</div>
                  <div className="text-[10px] text-gray-500">Tras</div>
                </div>
                <div className="bg-amber-50 rounded-lg p-2.5 text-center">
                  <Home size={18} className="mx-auto text-amber-600 mb-1" />
                  <div className="text-lg font-bold">{extra?.rooms?.length || 0}</div>
                  <div className="text-[10px] text-gray-500">Pomieszczeń</div>
                </div>
              </div>

              {extra?.scaleInfo && (
                <div className="text-xs text-gray-500">
                  Skala: {extra.scaleInfo.scaleText}
                  {extra.scaleInfo.source === 'text_detection' && ' (z rysunku)'}
                  {extra.scaleInfo.source === 'calibration' && ' (z kalibracji)'}
                  {extra.scaleInfo.source === 'default' && ' (domyślna)'}
                  {' | '}Ścieżek: {extra.extraction.paths.length}
                  {' | '}Tekstów: {extra.extraction.texts.length}
                </div>
              )}

              {/* Top style groups */}
              {extra?.styleGroups && extra.styleGroups.length > 0 && (
                <div>
                  <div className="text-xs font-medium mb-1">Top grupy stylów:</div>
                  <div className="space-y-0.5 max-h-32 overflow-y-auto">
                    {extra.styleGroups.slice(0, 10).map(sg => (
                      <div key={sg.id} className="flex items-center gap-2 text-xs">
                        <div className="w-3 h-3 rounded" style={{ backgroundColor: sg.strokeColor }} />
                        <span className="flex-1 truncate font-mono text-[11px]">{sg.name}</span>
                        <span className="text-gray-400">{sg.pathCount} śc.</span>
                        {sg.totalLengthM > 0 && (
                          <span className="text-gray-400">{sg.totalLengthM.toFixed(1)}m</span>
                        )}
                        {sg.aiConfidence != null && (
                          <span className={`text-[10px] font-medium ${sg.aiConfidence >= 0.6 ? 'text-green-600' : sg.aiConfidence >= 0.3 ? 'text-amber-500' : 'text-gray-400'}`}>
                            {Math.round(sg.aiConfidence * 100)}%
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Detected rooms */}
              {extra?.rooms && extra.rooms.length > 0 && (
                <div>
                  <div className="text-xs font-medium mb-1">Wykryte pomieszczenia:</div>
                  <div className="space-y-0.5 max-h-24 overflow-y-auto">
                    {extra.rooms.map(room => (
                      <div key={room.id} className="flex items-center gap-2 text-xs bg-amber-50/50 px-2 py-0.5 rounded">
                        <Home size={10} className="text-amber-500 flex-shrink-0" />
                        <span className="flex-1 truncate">{room.name}</span>
                        <span className="text-gray-400">{room.symbolCount} sym.</span>
                        <span className="text-gray-400">{room.routeCount} tras</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Legend info */}
              {extra?.legend && (
                <div className="text-xs text-amber-700 bg-amber-50 rounded p-2">
                  Wykryto legendę: {extra.legend.entries.length} wpisów
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
            {step === 'analyzed' && !aiClassified && extra?.styleGroups && extra.styleGroups.length > 0 && (
              <button onClick={runAiClassification} className="flex items-center gap-1 px-3 py-1.5 text-sm bg-purple-600 text-white rounded hover:bg-purple-700">
                <Brain size={14} /> Klasyfikacja AI
              </button>
            )}
            {step === 'ai_classifying' && (
              <div className="flex items-center gap-1 px-3 py-1.5 text-sm text-purple-700">
                <Loader2 size={14} className="animate-spin" /> Klasyfikacja AI grup...
              </div>
            )}
            {step === 'saving' && (
              <div className="flex items-center gap-1 px-3 py-1.5 text-sm text-green-700">
                <Loader2 size={14} className="animate-spin" /> Zapisywanie...
              </div>
            )}
            {step === 'analyzed' && (
              <button onClick={saveToDatabase} className="flex items-center gap-1 px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700">
                <CheckCircle size={14} /> Zapisz i kontynuuj
              </button>
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
