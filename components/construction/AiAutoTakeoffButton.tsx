import React, { useState } from 'react';
import { Sparkles, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { PdfStyleGroup, PdfLegend } from '../../lib/pdfTypes';
import type { TakeoffRule } from '../../lib/dxfTakeoff';

interface AiAutoTakeoffButtonProps {
  pageImageBase64: string;
  styleGroups: PdfStyleGroup[];
  onRulesGenerated: (rules: TakeoffRule[]) => void;
  onLegendDetected: (legend: PdfLegend) => void;
  disabled?: boolean;
  className?: string;
}

type ButtonState = 'idle' | 'loading' | 'success' | 'error';

export default function AiAutoTakeoffButton({
  pageImageBase64,
  styleGroups,
  onRulesGenerated,
  onLegendDetected,
  disabled = false,
  className = '',
}: AiAutoTakeoffButtonProps) {
  const [state, setState] = useState<ButtonState>('idle');
  const [ruleCount, setRuleCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');

  const handleClick = async () => {
    if (state === 'loading' || disabled) return;
    setState('loading');
    setErrorMsg('');

    try {
      // Build style groups summary for AI context
      const styleGroupsSummary = styleGroups
        .map(
          (g) =>
            `color:${g.strokeColor} width:${g.lineWidth} dash:${g.dashPattern?.join(',') || 'solid'} paths:${g.pathCount} length:${g.totalLengthM.toFixed(1)}m`
        )
        .join('\n');

      const { data, error } = await supabase.functions.invoke('pdf-analyze-legend', {
        body: {
          legendImageBase64: pageImageBase64,
          mimeType: 'image/jpeg',
          styleGroupsSummary,
        },
      });

      if (error) throw new Error(error.message || 'Błąd funkcji AI');
      if (data?.error) throw new Error(data.error);

      const entries: Array<{
        label: string;
        description?: string;
        entryType?: 'symbol' | 'line' | 'area';
        color?: string;
        lineStyle?: string;
        lineWidth?: string;
        category?: string;
      }> = data?.entries || data?.legend?.entries || [];

      if (!entries.length) throw new Error('AI nie wykryło żadnych wpisów legendy');

      // Convert entries to TakeoffRules
      const rules: TakeoffRule[] = entries
        .filter((e) => e.label)
        .map((entry, index) => {
          const entryType = entry.entryType || 'symbol';
          const color = entry.color || '#000000';

          let quantitySource: TakeoffRule['quantitySource'] = 'count';
          let unit = 'szt.';

          if (entryType === 'line') {
            quantitySource = 'group_length_m';
            unit = 'm';
          } else if (entryType === 'area') {
            quantitySource = 'area_m2';
            unit = 'm²';
          }

          return {
            id: `ai-${Date.now()}-${index}`,
            name: entry.label,
            category: entry.category || 'Inne',
            matchType: 'style_color' as TakeoffRule['matchType'],
            matchPattern: color,
            quantitySource,
            unit,
            multiplier: 1,
            isDefault: false,
          };
        });

      // Build PdfLegend from entries
      const legend: PdfLegend = {
        boundingBox: { x: 0, y: 0, width: 0, height: 0 },
        entries: entries.map((e) => ({
          label: e.label,
          description: e.description || '',
          category: e.category || 'Inne',
          sampleColor: e.color,
        })),
      };

      onRulesGenerated(rules);
      onLegendDetected(legend);
      setRuleCount(rules.length);
      setState('success');

      // Reset to idle after 4s
      setTimeout(() => setState('idle'), 4000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Nieznany błąd';
      setErrorMsg(msg);
      setState('error');
      setTimeout(() => setState('idle'), 5000);
    }
  };

  const baseClasses =
    'inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1';

  if (state === 'loading') {
    return (
      <button
        disabled
        className={`${baseClasses} bg-blue-400 text-white cursor-not-allowed ${className}`}
      >
        <Loader2 size={14} className="animate-spin" />
        Analizuję...
      </button>
    );
  }

  if (state === 'success') {
    return (
      <button
        disabled
        className={`${baseClasses} bg-green-600 text-white cursor-default ${className}`}
      >
        <CheckCircle size={14} />
        Wykryto {ruleCount} reguł
      </button>
    );
  }

  if (state === 'error') {
    return (
      <button
        onClick={handleClick}
        title={errorMsg}
        className={`${baseClasses} bg-red-600 hover:bg-red-700 text-white ${className}`}
      >
        <AlertCircle size={14} />
        Błąd — spróbuj ponownie
      </button>
    );
  }

  // idle
  return (
    <button
      onClick={handleClick}
      disabled={disabled || !pageImageBase64}
      className={`${baseClasses} bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white focus:ring-blue-500 ${className}`}
    >
      <Sparkles size={14} />
      Wykryj elementy AI
    </button>
  );
}
