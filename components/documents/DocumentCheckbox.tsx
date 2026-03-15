import React from 'react';
import { CheckSquare, Square } from 'lucide-react';

interface DocumentCheckboxProps {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}

export const DocumentCheckbox: React.FC<DocumentCheckboxProps> = ({
  checked,
  onChange,
  disabled = false
}) => {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onChange();
      }}
      disabled={disabled}
      className={`
        flex items-center justify-center w-8 h-8 rounded-lg transition-all
        ${disabled 
          ? 'cursor-not-allowed opacity-50' 
          : 'hover:bg-slate-100 cursor-pointer'
        }
      `}
    >
      {checked ? (
        <CheckSquare className="w-5 h-5 text-blue-600" />
      ) : (
        <Square className="w-5 h-5 text-slate-300" />
      )}
    </button>
  );
};
