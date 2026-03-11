import React, { useState, useCallback } from 'react';
import { Sparkles, Loader2, CheckCircle, AlertTriangle, Play, X, Scale, Eye } from 'lucide-react';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { supabase } from '../../lib/supabase';
import type { PdfAnalysisExtra } from '../../lib/pdfAnalyzer';
import type { TakeoffRule } from '../../lib/dxfTakeoff';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PdfTakeoffWizardProps {
  pdfDoc: PDFDocumentProxy;
  pageNumber: number;
  planId: string;
  companyId: string;
  analysisExtra: PdfAnalysisExtra;
  onTakeoffCreated: (rules: TakeoffRule[]) => void;
  onClose: () => void;
}

type WizardStep = 'scale' | 'rendering' | 'analyzing' | 'comparing' | 'creating' | 'done';

interface LegendEntry {
  label: string;
  description?: string;
  entryType?: string;
  color?: string;
  category?: string;
}

interface ComparedRow {
  label: string;
  category?: string;
  entryType?: string;
  color?: string;
  gemini: boolean;
  claude: boolean;
  geminiColor?: string;
  claudeColor?: string;
  /** 0–1 */
  confidence: number;
  /** needs manual review */
  needsReview: boolean;
  reviewReason?: string;
  status: 'ok' | 'mismatch' | 'single';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function renderPageToBase64(page: PDFPageProxy): Promise<string> {
  const baseVp = page.getViewport({ scale: 1 });
  const MAX_SIDE = 1800;
  const scale = Math.min(2, MAX_SIDE / Math.max(baseVp.width, baseVp.height));
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = vp.width;
  canvas.height = vp.height;
  await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
  return canvas.toDataURL('image/jpeg', 0.82).replace(/^data:image\/jpeg;base64,/, '');
}

function normalize(s: string) {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

function labelSimilarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.8;
  const wordsA = na.split(' ');
  const wordsB = nb.split(' ');
  const shared = wordsA.filter(w => wordsB.includes(w)).length;
  return shared / Math.max(wordsA.length, wordsB.length);
}

function computeConfidence(row: Pick<ComparedRow, 'gemini' | 'claude' | 'status'>): number {
  if (row.gemini && row.claude && row.status === 'ok') return 0.92;
  if (row.gemini && row.claude && row.status === 'mismatch') return 0.55;
  if (row.gemini && !row.claude) return 0.65;
  if (!row.gemini && row.claude) return 0.60;
  return 0.50;
}

function buildStyleGroupsSummary(extra: PdfAnalysisExtra): string {
  return (extra.styleGroups || [])
    .slice(0, 20)
    .map(g => `color:${g.strokeColor} width:${g.lineWidth} dash:${(g.dashPattern || []).join(',') || 'solid'} paths:${g.pathCount} length:${g.totalLengthM?.toFixed(1) ?? '?'}m`)
    .join('\n');
}

function compareResults(
  geminiEntries: LegendEntry[],
  claudeBlocks: Array<{ name?: string; category?: string; color?: string }>,
  claudeLines: Array<{ label?: string; category?: string; color?: string }>,
): ComparedRow[] {
  const claudeItems = [
    ...claudeBlocks.map(b => ({ name: b.name || '', category: b.category, color: b.color, entryType: 'symbol' })),
    ...claudeLines.map(l => ({ name: l.label || '', category: l.category, color: l.color, entryType: 'line' })),
  ];

  const matched = new Set<number>();
  const rows: ComparedRow[] = [];

  for (const ge of geminiEntries) {
    let bestIdx = -1;
    let bestScore = 0;
    claudeItems.forEach((ci, i) => {
      if (matched.has(i)) return;
      const score = labelSimilarity(ge.label, ci.name);
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    });

    if (bestIdx >= 0 && bestScore >= 0.5) {
      matched.add(bestIdx);
      const ci = claudeItems[bestIdx];
      const colorMismatch = !!(ge.color && ci.color && normalize(ge.color) !== normalize(ci.color));
      const status: ComparedRow['status'] = colorMismatch ? 'mismatch' : 'ok';
      const partial: Pick<ComparedRow, 'gemini' | 'claude' | 'status'> = { gemini: true, claude: true, status };
      const confidence = computeConfidence(partial);
      const needsReview = status === 'mismatch' || confidence < 0.70;
      rows.push({
        label: ge.label,
        category: ge.category || ci.category,
        entryType: ge.entryType || ci.entryType,
        color: ge.color || ci.color,
        gemini: true, claude: true,
        geminiColor: ge.color,
        claudeColor: ci.color,
        confidence,
        needsReview,
        reviewReason: colorMismatch ? `Kolor: Gemini=${ge.color}, Claude=${ci.color}` : undefined,
        status,
      });
    } else {
      const partial: Pick<ComparedRow, 'gemini' | 'claude' | 'status'> = { gemini: true, claude: false, status: 'single' };
      const confidence = computeConfidence(partial);
      rows.push({
        label: ge.label,
        category: ge.category,
        entryType: ge.entryType,
        color: ge.color,
        gemini: true, claude: false,
        geminiColor: ge.color,
        confidence,
        needsReview: confidence < 0.70,
        reviewReason: 'Tylko Gemini — Claude nie wykryło',
        status: 'single',
      });
    }
  }

  claudeItems.forEach((ci, i) => {
    if (!matched.has(i) && ci.name) {
      const partial: Pick<ComparedRow, 'gemini' | 'claude' | 'status'> = { gemini: false, claude: true, status: 'single' };
      const confidence = computeConfidence(partial);
      rows.push({
        label: ci.name,
        category: ci.category,
        entryType: ci.entryType,
        color: ci.color,
        gemini: false, claude: true,
        claudeColor: ci.color,
        confidence,
        needsReview: confidence < 0.70,
        reviewReason: 'Tylko Claude — Gemini nie wykryło',
        status: 'single',
      });
    }
  });

  return rows;
}

function buildRules(rows: ComparedRow[]): TakeoffRule[] {
  return rows.map((row, index) => {
    const isLine = (row.entryType || '').toLowerCase() === 'line';
    return {
      id: `takeoff-${Date.now()}-${index}`,
      name: row.label,
      category: row.category || 'Inne',
      matchType: isLine ? 'style_color' : 'block_contains',
      matchPattern: row.color || row.label,
      quantitySource: isLine ? 'group_length_m' : 'count',
      unit: isLine ? 'm' : 'szt.',
      multiplier: 1,
      isDefault: false,
    } as TakeoffRule;
  });
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const cls = pct >= 85 ? 'bg-green-900/40 text-green-400' : pct >= 65 ? 'bg-yellow-900/40 text-yellow-400' : 'bg-red-900/40 text-red-400';
  return <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono ${cls}`}>{pct}%</span>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PdfTakeoffWizard({
  pdfDoc, pageNumber, planId, companyId, analysisExtra, onTakeoffCreated, onClose,
}: PdfTakeoffWizardProps) {
  const [step, setStep] = useState<WizardStep>('scale');
  const [statusMsg, setStatusMsg] = useState('');
  const [comparedRows, setComparedRows] = useState<ComparedRow[]>([]);
  const [pendingRules, setPendingRules] = useState<TakeoffRule[]>([]);
  const [error, setError] = useState('');

  // ── PROTECTION 1: Scale confirmation ──────────────────────────────────────
  const detectedScale = analysisExtra.scaleInfo?.scaleText || null;
  const [scaleConfirmed, setScaleConfirmed] = useState(false);
  const [customScale, setCustomScale] = useState(detectedScale || '1:100');
  const [scaleSource, setScaleSource] = useState<'detected' | 'custom'>(detectedScale ? 'detected' : 'custom');

  const isLoading = step === 'rendering' || step === 'analyzing' || step === 'creating';
  const reviewCount = comparedRows.filter(r => r.needsReview).length;
  const okCount = comparedRows.filter(r => !r.needsReview).length;

  const run = useCallback(async () => {
    setError('');
    setStep('rendering');
    setStatusMsg('Renderowanie strony…');

    let pageBase64: string;
    try {
      const page = await pdfDoc.getPage(pageNumber);
      pageBase64 = await renderPageToBase64(page);
    } catch (e) {
      setError(`Błąd renderowania: ${e instanceof Error ? e.message : String(e)}`);
      setStep('scale');
      return;
    }

    setStep('analyzing');
    setStatusMsg('Gemini + Claude analizują równolegle…');

    const styleGroupsSummary = buildStyleGroupsSummary(analysisExtra);

    const [legendRes, rasterRes] = await Promise.allSettled([
      supabase.functions.invoke('pdf-analyze-legend', {
        body: { legendImageBase64: pageBase64, mimeType: 'image/jpeg', styleGroupsSummary },
      }),
      supabase.functions.invoke('pdf-analyze-raster', {
        body: { imageBase64: pageBase64, mimeType: 'image/jpeg', pageNumber },
      }),
    ]);

    const geminiEntries: LegendEntry[] =
      legendRes.status === 'fulfilled'
        ? (legendRes.value.data?.data?.entries || legendRes.value.data?.entries || [])
        : [];

    const rasterData =
      rasterRes.status === 'fulfilled' && rasterRes.value.data ? rasterRes.value.data : {};

    const claudeBlocks = (rasterData as any).blocks || [];
    const claudeLines = (rasterData as any).lineGroups || [];

    if (!geminiEntries.length && !claudeBlocks.length && !claudeLines.length) {
      setError('Żadna analiza AI nie zwróciła wyników. Spróbuj ponownie lub sprawdź jakość rysunku.');
      setStep('scale');
      return;
    }

    const rows = compareResults(geminiEntries, claudeBlocks, claudeLines);
    setComparedRows(rows);
    setPendingRules(buildRules(rows));
    setStep('comparing');
    setStatusMsg('');
  }, [pdfDoc, pageNumber, analysisExtra]);

  const createTakeoff = useCallback(async () => {
    if (!pendingRules.length) return;
    setStep('creating');
    setStatusMsg('Zapisuję reguły…');
    try {
      const dbRows = pendingRules.map(r => ({
        plan_id: planId,
        company_id: companyId,
        name: r.name,
        category: r.category,
        match_type: r.matchType,
        match_pattern: r.matchPattern,
        quantity_source: r.quantitySource,
        unit: r.unit,
        multiplier: r.multiplier,
        is_default: false,
        is_ai_generated: true,
        enabled: true,
      }));
      const { error: dbErr } = await supabase.from('drawing_takeoff_rules').insert(dbRows);
      if (dbErr) throw new Error(dbErr.message);
      setStep('done');
      setStatusMsg(`Zapisano ${pendingRules.length} reguł. Pozycje do weryfikacji: ${reviewCount}`);
      onTakeoffCreated(pendingRules);
    } catch (e) {
      setError(`Błąd zapisu: ${e instanceof Error ? e.message : String(e)}`);
      setStep('comparing');
    }
  }, [pendingRules, planId, companyId, onTakeoffCreated, reviewCount]);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-violet-400" />
            <span className="text-white font-semibold text-sm">Wizard AI Przedmiarowania</span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><X size={16} /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* ── PROTECTION 1: Scale confirmation ── */}
          {(step === 'scale' || step === 'comparing' || step === 'done') && (
            <div className={`rounded-lg border px-4 py-3 ${scaleConfirmed ? 'border-green-700 bg-green-900/20' : 'border-yellow-600 bg-yellow-900/20'}`}>
              <div className="flex items-center gap-2 mb-2">
                <Scale size={14} className={scaleConfirmed ? 'text-green-400' : 'text-yellow-400'} />
                <span className={`text-xs font-semibold ${scaleConfirmed ? 'text-green-300' : 'text-yellow-300'}`}>
                  Ochrona 1: Potwierdzenie skali rysunku
                </span>
                {scaleConfirmed && <CheckCircle size={12} className="text-green-400" />}
              </div>
              {detectedScale && (
                <p className="text-xs text-gray-400 mb-2">
                  Wykryta skala: <strong className="text-white">{detectedScale}</strong>
                  <span className="text-gray-500"> (z tekstu rysunku)</span>
                </p>
              )}
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer">
                  <input type="radio" checked={scaleSource === 'detected'} onChange={() => setScaleSource('detected')}
                    disabled={!detectedScale} className="accent-green-500" />
                  Wykryta: {detectedScale || '—'}
                </label>
                <label className="flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer">
                  <input type="radio" checked={scaleSource === 'custom'} onChange={() => setScaleSource('custom')} className="accent-yellow-500" />
                  Inna:
                  <input
                    type="text"
                    value={customScale}
                    onChange={e => setCustomScale(e.target.value)}
                    disabled={scaleSource !== 'custom'}
                    placeholder="np. 1:50"
                    className="ml-1 w-20 bg-gray-800 border border-gray-600 rounded px-2 py-0.5 text-xs text-white focus:outline-none focus:border-yellow-500 disabled:opacity-40"
                  />
                </label>
                {!scaleConfirmed && (
                  <button
                    onClick={() => setScaleConfirmed(true)}
                    className="ml-auto px-3 py-1 bg-yellow-600 hover:bg-yellow-500 text-white text-xs rounded font-medium"
                  >
                    Potwierdzam skalę
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Status message */}
          {statusMsg && (
            <div className="flex items-center gap-2 text-gray-300 text-xs">
              {isLoading && <Loader2 size={12} className="animate-spin text-violet-400" />}
              {step === 'done' && <CheckCircle size={12} className="text-green-400" />}
              <span>{statusMsg}</span>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 bg-red-900/30 border border-red-700 rounded-lg px-3 py-2 text-red-300 text-xs">
              <AlertTriangle size={12} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* ── Comparison table ── */}
          {comparedRows.length > 0 && (
            <div>
              {/* ── PROTECTION 2+3: Summary bar ── */}
              <div className="flex items-center gap-3 mb-2 text-xs">
                <span className="text-gray-400">Razem: <strong className="text-white">{comparedRows.length}</strong></span>
                <span className="text-green-400">✓ OK: {okCount}</span>
                {reviewCount > 0 && (
                  <span className="flex items-center gap-1 text-yellow-400">
                    <Eye size={11} /> Do weryfikacji: {reviewCount}
                  </span>
                )}
              </div>
              <div className="overflow-x-auto rounded-lg border border-gray-700">
                <table className="w-full text-xs text-left">
                  <thead className="bg-gray-800 text-gray-500 uppercase text-[10px]">
                    <tr>
                      <th className="px-3 py-2">Element</th>
                      <th className="px-3 py-2">Gemini</th>
                      <th className="px-3 py-2">Claude</th>
                      <th className="px-3 py-2 text-center">Pewność</th>
                      <th className="px-3 py-2">Weryfikacja</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {comparedRows.map((row, i) => (
                      <tr key={i} className={`hover:bg-gray-800/50 ${row.needsReview ? 'bg-yellow-950/20' : ''}`}>
                        <td className="px-3 py-2 text-white font-medium max-w-[180px] truncate" title={row.label}>
                          {row.label}
                        </td>
                        <td className="px-3 py-2">
                          {row.gemini
                            ? <span className="text-green-400">✓{row.geminiColor ? <span className="text-gray-500 ml-1">{row.geminiColor}</span> : null}</span>
                            : <span className="text-gray-600">—</span>}
                        </td>
                        <td className="px-3 py-2">
                          {row.claude
                            ? <span className="text-blue-400">✓{row.claudeColor ? <span className="text-gray-500 ml-1">{row.claudeColor}</span> : null}</span>
                            : <span className="text-gray-600">—</span>}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <ConfidenceBadge value={row.confidence} />
                        </td>
                        <td className="px-3 py-2">
                          {row.needsReview
                            ? <span className="flex items-center gap-1 text-yellow-400"><AlertTriangle size={11} /><span className="text-[10px]">{row.reviewReason}</span></span>
                            : <span className="text-green-500 text-[10px]">✓ Akceptuj</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {reviewCount > 0 && (
                <p className="mt-2 text-xs text-yellow-500 flex items-center gap-1">
                  <AlertTriangle size={11} />
                  {reviewCount} pozycji wymaga ręcznej weryfikacji — zostaną uwzględnione w przedmiarze, ale zaznaczone do sprawdzenia.
                </p>
              )}
            </div>
          )}

          {step === 'done' && (
            <div className="flex items-center gap-2 bg-green-900/30 border border-green-700 rounded-lg px-3 py-3 text-green-300 text-sm">
              <CheckCircle size={16} />
              <span>Przedmiar gotowy! Reguły zapisane i aktywowane w przestrzeni roboczej.</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-700">
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xs">
            {step === 'done' ? 'Zamknij' : 'Anuluj'}
          </button>
          <div className="flex items-center gap-3">
            {(step === 'scale') && (
              <button
                onClick={run}
                disabled={!scaleConfirmed || isLoading}
                className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium px-4 py-2 rounded-lg"
              >
                <Play size={13} />
                {scaleConfirmed ? 'Uruchom analizę AI' : 'Najpierw potwierdź skalę'}
              </button>
            )}
            {step === 'comparing' && pendingRules.length > 0 && (
              <button
                onClick={createTakeoff}
                className="flex items-center gap-2 bg-green-600 hover:bg-green-500 text-white text-xs font-medium px-4 py-2 rounded-lg"
              >
                <Sparkles size={13} />
                Utwórz przedmiar ({pendingRules.length})
              </button>
            )}
            {isLoading && (
              <div className="flex items-center gap-2 text-gray-400 text-xs">
                <Loader2 size={12} className="animate-spin" />
                {step === 'rendering' ? 'Renderowanie…' : step === 'analyzing' ? 'AI analizuje…' : 'Zapisywanie…'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
