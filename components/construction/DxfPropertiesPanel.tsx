import React from 'react';
import { X, Info } from 'lucide-react';
import { getEntityProperties, getEntityDescription, type PropertyEntry } from '../../lib/dxfProperties';
import type { IDxf } from 'dxf-parser';

interface DxfPropertiesPanelProps {
  entity: any;
  dxf: IDxf;
  onClose: () => void;
}

export default function DxfPropertiesPanel({ entity, dxf, onClose }: DxfPropertiesPanelProps) {
  if (!entity) return null;

  const properties = getEntityProperties(entity, dxf);
  const description = getEntityDescription(entity);

  // Group by category
  const grouped: Record<string, PropertyEntry[]> = {};
  for (const prop of properties) {
    const cat = prop.category || 'Ogólne';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(prop);
  }

  return (
    <div className="absolute top-2 left-2 z-50 bg-white rounded-lg shadow-xl border w-72 max-h-[80vh] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-2 border-b bg-gray-50 rounded-t-lg">
        <div className="flex items-center gap-1.5">
          <Info size={14} className="text-blue-600" />
          <span className="text-xs font-medium truncate">{description}</span>
        </div>
        <button onClick={onClose} className="p-0.5 hover:bg-gray-200 rounded">
          <X size={14} />
        </button>
      </div>

      {/* Properties */}
      <div className="overflow-y-auto flex-1 divide-y">
        {Object.entries(grouped).map(([category, props]) => (
          <div key={category}>
            <div className="px-2 py-1 bg-gray-50 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
              {category}
            </div>
            {props.map((prop, i) => (
              <div key={i} className="flex px-2 py-1 text-xs hover:bg-gray-50">
                <span className="text-gray-500 w-28 flex-shrink-0 truncate" title={prop.label}>{prop.label}</span>
                <span className="text-gray-900 flex-1 truncate select-all" title={prop.value}>{prop.value}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
