import React from 'react';

interface FormField {
  name: string;
  label: string;
  type?: 'text' | 'email' | 'number' | 'date' | 'textarea' | 'select';
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  options?: { value: string; label: string }[];
  validate?: (value: any) => string | undefined;
}

interface FormValidation {
  isValid: boolean;
  errors: Record<string, string>;
}

export function validateForm(
  values: Record<string, any>,
  fields: FormField[]
): FormValidation {
  const errors: Record<string, string> = {};

  for (const field of fields) {
    const value = values[field.name];
    
    // Required check
    if (field.required && (!value || (typeof value === 'string' && value.trim() === ''))) {
      errors[field.name] = `${field.label} jest wymagane`;
      continue;
    }

    if (!value) continue;

    // Type-specific validation
    switch (field.type) {
      case 'email':
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
          errors[field.name] = 'Nieprawidłowy format email';
        }
        break;
      case 'number':
        if (isNaN(Number(value))) {
          errors[field.name] = 'Wartość musi być liczbą';
        }
        break;
    }

    // Length validation
    if (field.minLength && String(value).length < field.minLength) {
      errors[field.name] = `Minimum ${field.minLength} znaków`;
    }
    if (field.maxLength && String(value).length > field.maxLength) {
      errors[field.name] = `Maksimum ${field.maxLength} znaków`;
    }

    // Pattern validation
    if (field.pattern && !field.pattern.test(String(value))) {
      errors[field.name] = `Nieprawidłowy format`;
    }

    // Custom validation
    if (field.validate) {
      const customError = field.validate(value);
      if (customError) {
        errors[field.name] = customError;
      }
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

interface FormErrorProps {
  error?: string;
}

export const FormError: React.FC<FormErrorProps> = ({ error }) => {
  if (!error) return null;
  return (
    <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
      <span className="inline-block w-1 h-1 rounded-full bg-red-600" />
      {error}
    </p>
  );
};

interface FormInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  helperText?: string;
}

export const FormInput: React.FC<FormInputProps> = ({
  label,
  error,
  helperText,
  className = '',
  ...props
}) => {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-slate-600">
        {label}
        {props.required && <span className="text-red-500 ml-1">*</span>}
      </label>
      <input
        className={`w-full border rounded-lg px-3 py-2 text-sm transition-colors ${
          error
            ? 'border-red-300 focus:border-red-500 focus:ring-2 focus:ring-red-200'
            : 'border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200'
        } ${className}`}
        {...props}
      />
      {error ? (
        <FormError error={error} />
      ) : helperText ? (
        <p className="text-xs text-slate-400">{helperText}</p>
      ) : null}
    </div>
  );
};

interface FormTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
  helperText?: string;
}

export const FormTextarea: React.FC<FormTextareaProps> = ({
  label,
  error,
  helperText,
  className = '',
  ...props
}) => {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-slate-600">
        {label}
        {props.required && <span className="text-red-500 ml-1">*</span>}
      </label>
      <textarea
        className={`w-full border rounded-lg px-3 py-2 text-sm transition-colors resize-y ${
          error
            ? 'border-red-300 focus:border-red-500 focus:ring-2 focus:ring-red-200'
            : 'border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200'
        } ${className}`}
        {...props}
      />
      {error ? (
        <FormError error={error} />
      ) : helperText ? (
        <p className="text-xs text-slate-400">{helperText}</p>
      ) : null}
    </div>
  );
};

interface FormSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  helperText?: string;
  options: { value: string; label: string }[];
}

export const FormSelect: React.FC<FormSelectProps> = ({
  label,
  error,
  helperText,
  options,
  className = '',
  ...props
}) => {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-slate-600">
        {label}
        {props.required && <span className="text-red-500 ml-1">*</span>}
      </label>
      <select
        className={`w-full border rounded-lg px-3 py-2 text-sm transition-colors bg-white ${
          error
            ? 'border-red-300 focus:border-red-500 focus:ring-2 focus:ring-red-200'
            : 'border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200'
        } ${className}`}
        {...props}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error ? (
        <FormError error={error} />
      ) : helperText ? (
        <p className="text-xs text-slate-400">{helperText}</p>
      ) : null}
    </div>
  );
};

export type { FormField, FormValidation };
