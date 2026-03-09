import React, { useState } from 'react';
import {
  MousePointer, Hand, Ruler, Square, Hash, Type, MessageSquare,
  Camera, Scissors, PenTool, Pencil, Circle, ArrowUpRight, Minus,
  CloudLightning, MessageCircleWarning, Link2, Sparkles, Eraser,
  ChevronDown, X, Crosshair, Image
} from 'lucide-react';
import type { BottomTool } from './WorkspaceTypes';

interface ViewerBottomToolbarProps {
  activeTool: BottomTool;
  onSetTool: (tool: BottomTool) => void;
  // Annotation styling
  strokeColor: string;
  strokeWidth: number;
  onColorChange: (color: string) => void;
  onWidthChange: (width: number) => void;
  // Count display
  countValue?: number;
  countLabel?: string;
  onClearCount?: () => void;
  // Highlight info
  highlightLabel?: string;
  highlightCount?: number;
  onClearHighlight?: () => void;
  // Scale
  hasScale?: boolean;
  onCalibrateScale?: () => void;
}

const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#000000', '#ffffff'];
const WIDTHS = [1, 2, 4, 6, 10];

export const ViewerBottomToolbar: React.FC<ViewerBottomToolbarProps> = ({
  activeTool, onSetTool, strokeColor, strokeWidth, onColorChange, onWidthChange,
  countValue, countLabel, onClearCount, highlightLabel, highlightCount, onClearHighlight,
  hasScale, onCalibrateScale,
}) => {
  const [showPenMenu, setShowPenMenu] = useState(false);
  const [showShapeMenu, setShowShapeMenu] = useState(false);
  const [showMeasureMenu, setShowMeasureMenu] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);

  const ToolBtn: React.FC<{
    tool: BottomTool;
    icon: React.ReactNode;
    title: string;
    shortcut?: string;
    active?: boolean;
    className?: string;
  }> = ({ tool, icon, title, shortcut, active, className }) => (
    <button
      onClick={() => onSetTool(tool)}
      className={`p-2 rounded-lg transition ${
        (active ?? activeTool === tool)
          ? 'bg-blue-100 text-blue-700 shadow-inner'
          : `hover:bg-slate-100 text-slate-600 ${className || ''}`
      }`}
      title={`${title}${shortcut ? ` (${shortcut})` : ''}`}
    >
      {icon}
    </button>
  );

  const Separator = () => <div className="w-px h-6 bg-slate-200 mx-1" />;

  return (
    <div className="px-3 py-1.5 border-t border-slate-200 bg-white flex items-center gap-0.5 flex-shrink-0 relative" onClick={e => e.stopPropagation()}>
      {/* Select & Pan */}
      <ToolBtn tool="select" icon={<MousePointer className="w-5 h-5" />} title="Zaznacz" shortcut="V" />
      <ToolBtn tool="pan" icon={<Hand className="w-5 h-5" />} title="Raczka — przesun" shortcut="G" />

      <Separator />

      {/* Pen/Highlighter dropdown */}
      <div className="relative">
        <button
          onClick={e => { e.stopPropagation(); setShowPenMenu(!showPenMenu); }}
          className={`p-2 rounded-lg flex items-center gap-0.5 transition ${
            ['pen', 'highlighter'].includes(activeTool) ? 'bg-blue-100 text-blue-700 shadow-inner' : 'hover:bg-slate-100 text-slate-600'
          }`}
          title="Rysowanie"
        >
          <PenTool className="w-5 h-5" /><ChevronDown className="w-3 h-3 opacity-50" />
        </button>
        {showPenMenu && (
          <div className="absolute left-0 bottom-full mb-1 w-44 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-1" onClick={e => e.stopPropagation()}>
            <button className={`w-full flex items-center gap-3 px-3 py-2 text-sm ${activeTool === 'pen' ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'}`}
              onClick={() => { onSetTool('pen'); setShowPenMenu(false); }}>
              <PenTool className="w-4 h-4" /> Pioro <span className="ml-auto text-[10px] text-slate-400 font-mono">P</span>
            </button>
            <button className={`w-full flex items-center gap-3 px-3 py-2 text-sm ${activeTool === 'highlighter' ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'}`}
              onClick={() => { onSetTool('highlighter'); setShowPenMenu(false); }}>
              <Pencil className="w-4 h-4" /> Zakreslacz <span className="ml-auto text-[10px] text-slate-400 font-mono">H</span>
            </button>
          </div>
        )}
      </div>

      {/* Shape dropdown */}
      <div className="relative">
        <button
          onClick={e => { e.stopPropagation(); setShowShapeMenu(!showShapeMenu); }}
          className={`p-2 rounded-lg flex items-center gap-0.5 transition ${
            ['rectangle', 'ellipse', 'arrow', 'line'].includes(activeTool) ? 'bg-blue-100 text-blue-700 shadow-inner' : 'hover:bg-slate-100 text-slate-600'
          }`}
          title="Ksztalty"
        >
          <Square className="w-5 h-5" /><ChevronDown className="w-3 h-3 opacity-50" />
        </button>
        {showShapeMenu && (
          <div className="absolute left-0 bottom-full mb-1 w-48 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-1" onClick={e => e.stopPropagation()}>
            {([
              { tool: 'rectangle' as BottomTool, label: 'Prostokat', icon: Square, key: 'R' },
              { tool: 'ellipse' as BottomTool, label: 'Elipsa', icon: Circle, key: 'O' },
              { tool: 'arrow' as BottomTool, label: 'Strzalka', icon: ArrowUpRight, key: 'A' },
              { tool: 'line' as BottomTool, label: 'Linia', icon: Minus, key: 'L' },
            ]).map(item => (
              <button key={item.tool}
                className={`w-full flex items-center gap-3 px-3 py-2 text-sm ${activeTool === item.tool ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'}`}
                onClick={() => { onSetTool(item.tool); setShowShapeMenu(false); }}>
                <item.icon className="w-4 h-4" /> {item.label} <span className="ml-auto text-[10px] text-slate-400 font-mono">{item.key}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Text */}
      <ToolBtn tool="text-annotation" icon={<Type className="w-5 h-5" />} title="Tekst" shortcut="T" />
      {/* Cloud */}
      <ToolBtn tool="issue-cloud" icon={<CloudLightning className="w-5 h-5" />} title="Chmura rewizyjna" shortcut="K" />
      {/* Callout */}
      <ToolBtn tool="callout" icon={<MessageCircleWarning className="w-5 h-5" />} title="Odnosnik z tekstem" shortcut="B" />

      <Separator />

      {/* Measure dropdown */}
      <div className="relative">
        <button
          onClick={e => { e.stopPropagation(); setShowMeasureMenu(!showMeasureMenu); }}
          className={`p-2 rounded-lg flex items-center gap-0.5 transition ${
            ['measure-length', 'measure-area', 'measure-polyline'].includes(activeTool) ? 'bg-blue-100 text-blue-700 shadow-inner' : 'hover:bg-slate-100 text-slate-600'
          }`}
          title={hasScale ? 'Pomiar' : 'Pomiar — skalibruj skale'}
        >
          <Ruler className="w-5 h-5" /><ChevronDown className="w-3 h-3 opacity-50" />
        </button>
        {showMeasureMenu && (
          <div className="absolute left-0 bottom-full mb-1 w-56 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-1" onClick={e => e.stopPropagation()}>
            <button className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm ${activeTool === 'measure-length' ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'}`}
              onClick={() => { onSetTool('measure-length'); setShowMeasureMenu(false); }}>
              <Crosshair className="w-4 h-4" /> Odcinek
            </button>
            <button className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm ${activeTool === 'measure-polyline' ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'}`}
              onClick={() => { onSetTool('measure-polyline'); setShowMeasureMenu(false); }}>
              <Ruler className="w-4 h-4" /> Polilinia — lamana
            </button>
            <button className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm ${activeTool === 'measure-area' ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'}`}
              onClick={() => { onSetTool('measure-area'); setShowMeasureMenu(false); }}>
              <Square className="w-4 h-4" /> Obszar
            </button>
            {!hasScale && (
              <>
                <div className="border-t border-slate-100 my-1" />
                <button onClick={() => { onCalibrateScale?.(); setShowMeasureMenu(false); }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-amber-600 hover:bg-amber-50">
                  <Ruler className="w-4 h-4" /> Kalibruj skale
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Count */}
      <ToolBtn tool="count-marker" icon={<Hash className="w-5 h-5" />} title="Licznik elementow" shortcut="N"
        className={activeTool === 'count-marker' ? 'bg-amber-100 text-amber-700' : ''} />
      {(countValue !== undefined && countValue > 0) && (
        <div className="flex items-center gap-1 ml-1">
          <span className="text-xs font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full truncate max-w-[200px]" title={countLabel}>
            {countLabel ? `${countLabel}: ` : 'E '}{countValue}
          </span>
          <button onClick={onClearCount} className="p-1 hover:bg-red-50 rounded text-slate-400 hover:text-red-500" title="Wyczysc licznik">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {highlightLabel && highlightCount !== undefined && highlightCount > 0 && (
        <div className="flex items-center gap-1 ml-1">
          <span className="text-xs font-bold text-orange-700 bg-orange-50 px-2 py-0.5 rounded-full truncate max-w-[250px]" title={highlightLabel}>
            {highlightLabel}: {highlightCount}
          </span>
          <button onClick={onClearHighlight} className="p-1 hover:bg-red-50 rounded text-slate-400 hover:text-red-500">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <Separator />

      {/* BOQ link */}
      <ToolBtn tool="link-boq" icon={<Link2 className="w-5 h-5" />} title="Polacz z pozycja BOQ" />
      {/* AI classify selection */}
      <ToolBtn tool="ai-classify-selection" icon={<Sparkles className="w-5 h-5" />} title="Klasyfikuj zaznaczenie AI" />

      <Separator />

      {/* Comment & Camera */}
      <ToolBtn tool="comment" icon={<MessageSquare className="w-5 h-5" />} title="Komentarz" shortcut="C" />
      <ToolBtn tool="camera" icon={<Camera className="w-5 h-5" />} title="Zdjecie — przypnij do planu" />
      {/* Eraser */}
      <ToolBtn tool="erase" icon={<Eraser className="w-5 h-5" />} title="Gumka" shortcut="E" />
      {/* Snapshot */}
      <ToolBtn tool="snapshot" icon={<Scissors className="w-5 h-5" />} title="Zrzut ekranu wybranego obszaru" />

      <div className="flex-1" />

      {/* Color picker */}
      <div className="relative">
        <button
          onClick={() => setShowColorPicker(!showColorPicker)}
          className="p-1.5 hover:bg-slate-100 rounded-lg flex items-center gap-1"
          title="Kolor i grubosc"
        >
          <div className="w-5 h-5 rounded-full border-2 border-slate-300" style={{ backgroundColor: strokeColor }} />
          <span className="text-[10px] text-slate-500">{strokeWidth}px</span>
        </button>
        {showColorPicker && (
          <div className="absolute right-0 bottom-full mb-1 w-48 bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-3" onClick={e => e.stopPropagation()}>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {COLORS.map(c => (
                <button key={c}
                  onClick={() => onColorChange(c)}
                  className={`w-6 h-6 rounded-full border-2 ${strokeColor === c ? 'border-blue-500 scale-110' : 'border-slate-200'}`}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
            <div className="flex gap-1">
              {WIDTHS.map(w => (
                <button key={w}
                  onClick={() => onWidthChange(w)}
                  className={`flex-1 py-1 text-[10px] rounded ${strokeWidth === w ? 'bg-blue-100 text-blue-700 font-bold' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}>
                  {w}px
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ViewerBottomToolbar;
