import React, { useState } from 'react';
import { X, Play, Loader2, CheckCircle, AlertTriangle, BookOpen, GitBranch, FileImage, Save } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { extractPageGeometry, classifyFromOpList } from '../../lib/pdfGeometryExtractor';
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
  const [extractionProgress, setExtractionProgress] = useState(0);
  const [analysisSubStep, setAnalysisSubStep] = useState('');

  const runAnalysis = async () => {
    setStep('classifying');
    setError('');
    setExtractionProgress(0);
    setAnalysisSubStep('');
    try {
      const page = await pdfDoc.getPage(pageNumber);

      // Step 1: Get operator list ONCE and classify
      await new Promise(r => setTimeout(r, 0));
      const opList = await page.getOperatorList();
      const cls = classifyFromOpList(opList.fnArray);
      setClassification(cls);

      if (cls.contentType === 'raster') {
        setStep('analyzing');
        await new Promise(r => setTimeout(r, 0));
        const { analysis: result } = await analyzeRasterPdf(page, supabase, pageNumber);
        setAnalysis(result);
        setStep('analyzed');
      } else {
        // Vector pipeline
        setStep('extracting');
        await new Promise(r => setTimeout(r, 0));
        const extraction = await extractPageGeometry(page, (pct) => {
          setExtractionProgress(pct);
        });

        setStep('analyzing');
        setAnalysisSubStep('Grupowanie stylów...');
        await new Promise(r => setTimeout(r, 0));

        const { analysis: result, extra: analysisExtra } = await analyzePdfPage(
          extraction,
          { calibrationScaleRatio: scaleRatio },
          (sub) => setAnalysisSubStep(sub),
        );
        setAnalysis(result);
        setExtra(analysisExtra);
        setStep('analyzed');
      }
    } catch (err: any) {
      setError(err.message || 'Blad analizy');
      setStep('error');
    }
  };

  const saveToDatabase = async () => {
    if (!analysis) return;
    setStep('saving');
    setError('');
    try {
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
        ai_classification_status: 'none',
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

      // Save symbols (batch)
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
      setError(err.message || 'Blad zapisu');
      setStep('error');
    }
  };

  const isRunning = ['classifying', 'extracting', 'analyzing', 'saving'].includes(step);
  const hasLegend = extra?.legend && extra.legend.entries.length > 0;
  const legendMatches = extra?.legend?.entries.filter(e => (e.matchCount || 0) > 0) || [];
  const totalMatched = legendMatches.reduce((s, e) => s + (e.matchCount || 0), 0);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-[560px] max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-2">
            <FileImage size={18} className="text-blue-600" />
            <h3 className="font-semibold text-sm">Analiza rysunku PDF</h3>
            {classification && (
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                classification.contentType === 'vector' ? 'bg-green-100 text-green-700' :
                classification.contentType === 'raster' ? 'bg-orange-100 text-orange-700' :
                'bg-blue-100 text-blue-700'
              }`}>
                {classification.contentType === 'vector' ? 'Wektorowy' :
                 classification.contentType === 'raster' ? 'Rastrowy' : 'Mieszany'}
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
        </div>

        {/* Content */}
        <div className="p-4 flex-1 overflow-y-auto space-y-3">
          {/* Progress */}
          {isRunning && (
            <div className="flex items-center gap-2">
              <Loader2 size={16} className="text-blue-600 animate-spin flex-shrink-0" />
              <div className="flex-1">
                <div className="text-sm font-medium">
                  {step === 'classifying' && 'Klasyfikacja strony...'}
                  {step === 'extracting' && `Ekstrakcja geometrii... ${extractionProgress > 0 ? `${extractionProgress}%` : ''}`}
                  {step === 'analyzing' && (analysisSubStep || 'Analiza...')}
                  {step === 'saving' && 'Zapisywanie...'}
                </div>
                {step === 'extracting' && extractionProgress > 0 && (
                  <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1">
                    <div className="bg-blue-600 h-1.5 rounded-full transition-all" style={{ width: `${extractionProgress}%` }} />
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 'analyzed' && (
            <div className="flex items-center gap-2 text-green-700">
              <CheckCircle size={16} />
              <span className="text-sm font-medium">Analiza zakonczona</span>
            </div>
          )}

          {step === 'done' && (
            <div className="flex items-center gap-2 text-green-700">
              <CheckCircle size={16} />
              <span className="text-sm font-medium">Zapisano!</span>
            </div>
          )}

          {step === 'error' && (
            <div className="flex items-center gap-2 text-red-600">
              <AlertTriangle size={16} />
              <span className="text-sm font-medium">Blad</span>
            </div>
          )}

          {error && <div className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</div>}

          {/* Results */}
          {analysis && extra && (
            <>
              {/* Stats bar */}
              <div className="text-xs text-gray-500 bg-gray-50 rounded p-2">
                Skala: {extra.scaleInfo.scaleText}
                {extra.scaleInfo.source === 'text_detection' && ' (z rysunku)'}
                {extra.scaleInfo.source === 'default' && ' (domyślna)'}
                {' | '}Ścieżek: {extra.extraction.paths.length.toLocaleString()}
                {' | '}Tekstów: {extra.extraction.texts.length}
                {' | '}Tras: {analysis.lineGroups.length}
              </div>

              {/* LEGEND — primary result */}
              {hasLegend ? (
                <div className="border rounded-lg overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border-b">
                    <BookOpen size={14} className="text-amber-600" />
                    <span className="text-xs font-semibold text-amber-800">
                      Legenda — {extra.legend!.entries.length} wpisów
                    </span>
                    {totalMatched > 0 && (
                      <span className="ml-auto text-xs text-green-700 font-medium">
                        {totalMatched} symboli dopasowanych
                      </span>
                    )}
                  </div>
                  <div className="max-h-60 overflow-y-auto divide-y">
                    {extra.legend!.entries.map((entry, i) => (
                      <div key={i} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-50">
                        {entry.sampleColor ? (
                          <div className="w-4 h-4 rounded border flex-shrink-0" style={{ backgroundColor: entry.sampleColor }} />
                        ) : (
                          <div className="w-4 h-4 rounded border border-dashed border-gray-300 flex-shrink-0" />
                        )}
                        <span className="flex-1 truncate" title={entry.description}>{entry.label}</span>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {(entry.matchCount || 0) > 0 && (
                            <span className="text-green-700 font-semibold bg-green-50 px-1.5 py-0.5 rounded">
                              {entry.matchCount} szt.
                            </span>
                          )}
                          {(entry.totalLengthM || 0) > 0 && (
                            <span className="text-blue-700 font-semibold bg-blue-50 px-1.5 py-0.5 rounded">
                              {entry.totalLengthM!.toFixed(1)}m
                            </span>
                          )}
                          {!(entry.matchCount || 0) && !(entry.totalLengthM || 0) && (
                            <span className="text-gray-300">—</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-amber-700 bg-amber-50 rounded p-3 text-center">
                  Nie wykryto legendy na rysunku. Symbole wykryto na podstawie kształtów ({extra.symbols.length} szt.)
                </div>
              )}

              {/* Top routes — only show when NO legend (fallback view) */}
              {!hasLegend && analysis.lineGroups.length > 0 && (() => {
                const groupedRoutes = new Map<string, { count: number; totalLength: number }>();
                for (const r of analysis.lineGroups) {
                  const key = r.layer;
                  const existing = groupedRoutes.get(key) || { count: 0, totalLength: 0 };
                  existing.count++;
                  existing.totalLength += r.totalLengthM;
                  groupedRoutes.set(key, existing);
                }
                const sorted = [...groupedRoutes.entries()].sort((a, b) => b[1].totalLength - a[1].totalLength).slice(0, 8);
                return (
                  <div>
                    <div className="text-xs font-medium mb-1 flex items-center gap-1">
                      <GitBranch size={12} className="text-purple-500" />
                      Grupy stylów ({analysis.lineGroups.length} tras):
                    </div>
                    <div className="space-y-0.5 max-h-28 overflow-y-auto">
                      {sorted.map(([layer, info], i) => (
                        <div key={i} className="flex items-center gap-2 text-xs px-2 py-0.5 bg-gray-50 rounded">
                          <span className="flex-1 truncate text-[10px]">{layer}</span>
                          <span className="text-gray-400 text-[10px]">{info.count} tras</span>
                          <span className="text-gray-500 font-medium">{info.totalLength.toFixed(1)}m</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </>
          )}

          {/* Idle state */}
          {step === 'idle' && (
            <div className="text-center py-6 text-gray-500">
              <FileImage size={32} className="mx-auto mb-2 text-gray-300" />
              <p className="text-sm">Kliknij aby rozpoczac analize rysunku.</p>
              <p className="text-xs text-gray-400 mt-1">System wykryje legende, symbole, trasy i pomieszczenia.</p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50 rounded-b-xl">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border rounded hover:bg-gray-100">
            Zamknij
          </button>
          <div className="flex items-center gap-2">
            {step === 'idle' && (
              <button onClick={runAnalysis} className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
                <Play size={14} /> Rozpocznij analize
              </button>
            )}
            {step === 'analyzed' && (
              <button onClick={saveToDatabase} className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700">
                <Save size={14} /> Zapisz i kontynuuj
              </button>
            )}
            {step === 'done' && (
              <button onClick={onClose} className="px-4 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700">
                Gotowe
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
