import React, { useState, useEffect } from 'react';
import { X, Play, Loader2, CheckCircle, AlertTriangle, BookOpen, FileImage, Save, Sparkles } from 'lucide-react';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { classifyFromOpList } from '../../lib/pdfGeometryExtractor';
import { extractPageGeometry } from '../../lib/pdfGeometryExtractor';
import { groupPathsByStyle, detectScale, detectSymbols, matchAiResultToGeometry } from '../../lib/pdfAnalyzer';
import type { PdfClassification, PdfAnalysisStep, PdfRasterAiResult } from '../../lib/pdfTypes';
import type { DxfAnalysis } from '../../lib/dxfAnalyzer';
import type { PdfAnalysisExtra } from '../../lib/pdfAnalyzer';
import PdfTakeoffWizard from './PdfTakeoffWizard';
import { supabase } from '../../lib/supabase';

/** Render a PDF page to base64 JPEG for AI analysis.
 *  If scaleOverride is set, uses that. Otherwise auto-scales: 3x default, up to 4x for small pages, capped at ~16MP. */
async function renderPageToBase64(page: PDFPageProxy, scaleOverride?: number): Promise<string> {
  const baseVp = page.getViewport({ scale: 1 });
  let renderScale: number;
  if (scaleOverride) {
    renderScale = scaleOverride;
  } else {
    const basePx = baseVp.width * baseVp.height;
    const maxPixels = 16_000_000;
    renderScale = 3;
    if (basePx * 9 < 4_000_000) renderScale = 4;
    if (basePx * renderScale * renderScale > maxPixels) {
      renderScale = Math.max(2, Math.floor(Math.sqrt(maxPixels / basePx)));
    }
  }
  const viewport = page.getViewport({ scale: renderScale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d')!;
  await page.render({ canvasContext: ctx, viewport }).promise;
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  return dataUrl.replace(/^data:image\/jpeg;base64,/, '');
}

/** Call AI to analyze the full drawing page */
async function analyzeDrawingWithAI(
  imageBase64: string,
  pageNumber: number,
  structuredData?: any,
  ocrContext?: string,
): Promise<PdfRasterAiResult> {
  const { data, error } = await supabase.functions.invoke('pdf-analyze-raster', {
    body: {
      imageBase64,
      mimeType: 'image/jpeg',
      pageNumber,
      structuredData: structuredData || undefined,
      ocrContext: ocrContext || undefined,
    },
  });
  if (error) throw new Error(`AI analysis failed: ${error.message}`);
  if (data?.error) throw new Error(data.error);
  return data.data || data;
}

interface PdfAnalysisModalProps {
  pdfDoc: PDFDocumentProxy;
  pageNumber: number;
  companyId: string;
  drawingId: string;
  scaleRatio?: number;
  onAnalysisComplete: (analysis: DxfAnalysis, extra?: PdfAnalysisExtra) => void;
  onTakeoffPositionsReady?: (positions: import('./PdfTakeoffWizard').TakeoffPosition[]) => void;
  onClose: () => void;
}

export default function PdfAnalysisModal({
  pdfDoc, pageNumber, companyId, drawingId, scaleRatio, onAnalysisComplete, onTakeoffPositionsReady, onClose,
}: PdfAnalysisModalProps) {
  const [step, setStep] = useState<PdfAnalysisStep>('idle');
  const [classification, setClassification] = useState<PdfClassification | null>(null);
  const [analysis, setAnalysis] = useState<DxfAnalysis | null>(null);
  const [extra, setExtra] = useState<PdfAnalysisExtra | null>(null);
  const [error, setError] = useState('');
  const [extractionProgress, setExtractionProgress] = useState(0);
  const [analysisSubStep, setAnalysisSubStep] = useState('');
  const [aiUsed, setAiUsed] = useState(false);
  const [showTakeoffWizard, setShowTakeoffWizard] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(true);
  const [existingAnalysisId, setExistingAnalysisId] = useState<string | null>(null);

  const runAnalysis = async () => {
    setStep('classifying');
    setError('');
    setExtractionProgress(0);
    setAnalysisSubStep('');
    try {
      const page = await pdfDoc.getPage(pageNumber);

      // Step 1: Classify page type
      await new Promise(r => setTimeout(r, 0));
      const opList = await page.getOperatorList();
      const cls = classifyFromOpList(opList.fnArray);
      setClassification(cls);

      // Step 2: Extract geometry for vector PDFs, render image
      setStep('extracting');
      let styleGroups: Awaited<ReturnType<typeof groupPathsByStyle>> | null = null;
      let extraction: Awaited<ReturnType<typeof extractPageGeometry>> | null = null;
      let structuredData: any = undefined;
      const isVector = cls.contentType === 'vector' || cls.contentType === 'mixed';

      if (isVector) {
        // For vector PDFs: extract all geometry data (this is lossless, no quality loss)
        setAnalysisSubStep('Ekstrakcja geometrii z wektorowego PDF...');
        await new Promise(r => setTimeout(r, 0));
        extraction = await extractPageGeometry(page, (pct) => setExtractionProgress(pct));
        styleGroups = groupPathsByStyle(extraction.paths);
        const scaleInfo = detectScale(extraction.texts, scaleRatio);

        // Apply scale
        for (const sg of styleGroups) {
          sg.totalLengthM = sg.totalLengthPx * scaleInfo.scaleFactor;
        }

        // Detect symbols (clusters of small graphic shapes)
        setAnalysisSubStep('Wykrywanie symboli...');
        await new Promise(r => setTimeout(r, 0));
        const symbols = detectSymbols(extraction.paths, styleGroups, extraction.texts);

        // Build cluster summary: group symbols by clusterId and count
        const clusterMap = new Map<string, { shape: string; color: string; centerX: number; centerY: number; radius: number; count: number }>();
        for (const sym of symbols) {
          const existing = clusterMap.get(sym.clusterId);
          if (!existing) {
            const p = extraction.paths.find((_, idx) =>
              styleGroups!.some(sg => sg.id === sym.styleGroupId && sg.pathIndices.includes(idx))
            );
            const color = sym.styleGroupId
              ? (styleGroups.find(sg => sg.id === sym.styleGroupId)?.strokeColor || '#000')
              : '#000';
            clusterMap.set(sym.clusterId, {
              shape: sym.shape,
              color,
              centerX: sym.centerX,
              centerY: sym.centerY,
              radius: sym.radius,
              count: 1,
            });
          } else {
            existing.count++;
          }
        }

        // Build texts list (filtered, sorted by position)
        const texts = extraction.texts
          .filter(t => t.text.trim().length >= 2)
          .sort((a, b) => a.y - b.y || a.x - b.x)
          .map(t => ({
            text: t.text.trim(),
            x: t.x,
            y: t.y,
            fontSize: t.fontSize,
          }));

        // Build style groups summary
        const sgData = [...styleGroups]
          .sort((a, b) => b.totalLengthPx - a.totalLengthPx)
          .slice(0, 30) // top 30 groups
          .map(sg => ({
            name: sg.name,
            color: sg.strokeColor,
            lineWidth: sg.lineWidth,
            dashPattern: sg.dashPattern.length ? sg.dashPattern.map(v => v.toFixed(0)).join('-') : 'solid',
            pathCount: sg.pathCount,
            totalLengthM: sg.totalLengthM,
          }));

        // Also include individual symbol positions (up to 2000)
        const symbolPositions = symbols.slice(0, 2000).map(s => ({
          shape: s.shape,
          centerX: s.centerX,
          centerY: s.centerY,
          radius: s.radius,
          color: s.styleGroupId
            ? (styleGroups!.find(sg => sg.id === s.styleGroupId)?.strokeColor || '#000')
            : '#000',
          clusterId: s.clusterId,
          count: clusterMap.get(s.clusterId)?.count || 1,
        }));

        structuredData = {
          texts: texts.slice(0, 1000), // limit to 1000 text fragments
          symbols: symbolPositions,
          styleGroups: sgData,
          pageWidth: extraction.pageWidth,
          pageHeight: extraction.pageHeight,
          scale: scaleInfo.scaleText || '1:100',
        };
      }

      // Render image: low-res for vector (just for visual context), high-res for raster
      setAnalysisSubStep('Renderowanie strony...');
      await new Promise(r => setTimeout(r, 0));
      const imageBase64 = await renderPageToBase64(page, isVector ? 1.5 : undefined);

      // Step 3: AI analyzes the drawing
      setStep('analyzing');
      setAnalysisSubStep('AI analizuje rysunek...');
      await new Promise(r => setTimeout(r, 0));

      const aiResult = await analyzeDrawingWithAI(imageBase64, pageNumber, structuredData);

      // Step 5: Merge AI results with geometry for precise measurements
      setAnalysisSubStep('Łączenie wyników...');
      // Get page dimensions for position mapping (at 1x scale, not render scale)
      const viewport1x = page.getViewport({ scale: 1 });
      const { analysis: result, extra: analysisExtra } = matchAiResultToGeometry(
        aiResult,
        styleGroups,
        extraction,
        scaleRatio,
        { width: viewport1x.width, height: viewport1x.height },
      );

      setAiUsed(true);
      setAnalysis(result);
      setExtra(analysisExtra);
      setStep('analyzed');
    } catch (err: any) {
      setError(err.message || 'Błąd analizy');
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

  // ── Load existing analysis on mount ──────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function loadExisting() {
      setLoadingExisting(true);
      try {
        const { data: rows } = await supabase
          .from('pdf_analyses')
          .select('id, detected_scale, scale_factor, analysis_result, created_at')
          .eq('drawing_id', drawingId)
          .eq('page_number', pageNumber)
          .eq('status', 'completed')
          .order('created_at', { ascending: false })
          .limit(1);

        if (cancelled || !rows || rows.length === 0) return;
        const row = rows[0];
        setExistingAnalysisId(row.id);

        // Load legend entries
        const { data: legendRows } = await supabase
          .from('pdf_legends')
          .select('entries, bounding_box')
          .eq('analysis_id', row.id)
          .limit(1);

        if (cancelled) return;

        if (legendRows && legendRows.length > 0) {
          // Reconstruct minimal DxfAnalysis + PdfAnalysisExtra from saved data
          const ar = row.analysis_result || {};
          const restoredAnalysis: any = {
            totalLayers: ar.totalLayers || 0,
            totalBlocks: ar.totalBlocks || 0,
            totalEntities: ar.totalEntities || 0,
            blocks: ar.blocks || [],
            lineGroups: Array(ar.lineGroupCount || 0).fill(null).map((_, i) => ({ id: `lg-${i}` })),
          };
          const restoredExtra: any = {
            styleGroups: [],
            symbols: [],
            rooms: [],
            legend: { boundingBox: legendRows[0].bounding_box, entries: legendRows[0].entries },
            scaleInfo: {
              scaleText: row.detected_scale,
              scaleFactor: row.scale_factor,
              source: 'text_detection',
            },
            extraction: { paths: [], texts: [], pageWidth: 0, pageHeight: 0 },
          };
          setAnalysis(restoredAnalysis);
          setExtra(restoredExtra);
          setStep('done');
          setAiUsed(true);
        }
      } catch (_e) {
        // silently ignore — user can re-run analysis
      } finally {
        if (!cancelled) setLoadingExisting(false);
      }
    }
    loadExisting();
    return () => { cancelled = true; };
  }, [drawingId, pageNumber]);

  const isRunning = ['classifying', 'extracting', 'analyzing', 'saving'].includes(step);
  const hasLegend = extra?.legend && extra.legend.entries.length > 0;
  const legendMatches = extra?.legend?.entries.filter(e => (e.matchCount || 0) > 0) || [];
  const totalMatched = legendMatches.reduce((s, e) => s + (e.matchCount || 0), 0);

  return (
    <>
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
              <span className="text-sm font-medium">Analiza zakończona</span>
              {aiUsed && (
                <span className="flex items-center gap-1 px-2 py-0.5 bg-violet-100 text-violet-700 rounded-full text-[10px] font-medium">
                  <Sparkles size={10} /> Gemini AI
                </span>
              )}
            </div>
          )}

          {step === 'done' && (
            <div className="flex items-center gap-2 text-green-700">
              <CheckCircle size={16} />
              <span className="text-sm font-medium">
                {existingAnalysisId ? 'Wczytano z pamięci' : 'Zapisano!'}
              </span>
              {existingAnalysisId && (
                <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                  📂 Poprzedni wynik
                </span>
              )}
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
                Skala: {extra.scaleInfo.scaleText || '—'}
                {extra.scaleInfo.source === 'text_detection' && ' (z rysunku)'}
                {extra.scaleInfo.source === 'default' && ' (domyślna)'}
                {' | '}Symboli: {analysis.totalBlocks}
                {' | '}Tras: {analysis.lineGroups.length}
                {extra.extraction.paths.length > 0 && (
                  <>{' | '}Ścieżek: {extra.extraction.paths.length.toLocaleString()}</>
                )}
              </div>

              {/* Wykryte elementy */}
              {hasLegend && (
                <div className="border rounded-lg overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border-b">
                    <BookOpen size={14} className="text-amber-600" />
                    <span className="text-xs font-semibold text-amber-800">
                      Wykryte elementy — {extra.legend!.entries.length} pozycji
                    </span>
                  </div>
                  <div className="max-h-[40vh] overflow-y-auto divide-y">
                    {extra.legend!.entries.map((entry, i) => (
                      <div key={i} className="px-3 py-2 text-xs hover:bg-gray-50">
                        <div className="flex items-center gap-2">
                          <span className="flex-1 font-medium text-slate-700" title={entry.description}>{entry.label}</span>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {(entry.matchCount || 0) > 0 && (
                              <span className="text-green-700 font-bold bg-green-50 px-1.5 py-0.5 rounded">
                                {entry.matchCount} szt.
                              </span>
                            )}
                            {(entry.totalLengthM || 0) > 0 && (
                              <span className="text-blue-700 font-bold bg-blue-50 px-1.5 py-0.5 rounded">
                                {entry.totalLengthM!.toFixed(1)}m
                              </span>
                            )}
                          </div>
                        </div>
                        {entry.category && (
                          <span className="text-[10px] text-gray-400">{entry.category}</span>
                        )}
                        {entry.description && entry.description !== entry.label && (
                          <div className="text-[10px] text-gray-500 mt-0.5 truncate">{entry.description}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!hasLegend && (
                <div className="text-xs text-amber-700 bg-amber-50 rounded p-3 text-center">
                  AI nie wykryło elementów na rysunku.
                </div>
              )}
            </>
          )}

          {/* Loading existing */}
          {loadingExisting && step === 'idle' && (
            <div className="text-center py-6 text-gray-400">
              <Loader2 size={24} className="mx-auto mb-2 animate-spin text-blue-400" />
              <p className="text-xs">Sprawdzam zapisany wynik…</p>
            </div>
          )}

          {/* Idle state */}
          {step === 'idle' && !loadingExisting && (
            <div className="text-center py-6 text-gray-500">
              <FileImage size={32} className="mx-auto mb-2 text-gray-300" />
              <p className="text-sm">Kliknij aby rozpocząć analizę rysunku.</p>
              <p className="text-xs text-gray-400 mt-1">AI przeanalizuje legendę, symbole i trasy kablowe.</p>
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
              <>
                <button
                  onClick={() => { setStep('idle'); setAnalysis(null); setExtra(null); setError(''); }}
                  className="px-3 py-1.5 text-xs border rounded hover:bg-gray-100 text-gray-500"
                  title="Ponowna analiza"
                >
                  🔄 Analizuj ponownie
                </button>
                <button onClick={onClose} className="px-4 py-1.5 text-sm border rounded hover:bg-gray-100">
                  Gotowe
                </button>
                {extra && (
                  <button
                    onClick={() => setShowTakeoffWizard(true)}
                    className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-violet-600 text-white rounded hover:bg-violet-700 font-medium"
                  >
                    <Sparkles size={14} /> Utwórz przedmiar AI
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>

    {showTakeoffWizard && extra && (
      <PdfTakeoffWizard
        pdfDoc={pdfDoc}
        pageNumber={pageNumber}
        planId={drawingId}
        companyId={companyId}
        analysisExtra={extra}
        onTakeoffCreated={(positions) => {
          setShowTakeoffWizard(false);
          if (onTakeoffPositionsReady) {
            onTakeoffPositionsReady(positions);
          }
          onClose();
        }}
        onClose={() => setShowTakeoffWizard(false)}
      />
    )}
    </>
  );
}
