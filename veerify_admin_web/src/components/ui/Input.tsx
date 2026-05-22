import { InputHTMLAttributes, forwardRef, TextareaHTMLAttributes, SelectHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface FieldProps {
  label?: string;
  hint?: string;
  error?: string;
  className?: string;
}

const inputCls =
  'w-full h-10 px-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none text-sm transition-all placeholder:text-slate-400';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & FieldProps>(
  ({ label, hint, error, className, ...rest }, ref) => (
    <div className={className}>
      {label && <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">{label}</label>}
      <input ref={ref} {...rest} className={cn(inputCls, error && 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/20')} />
      {(hint || error) && (
        <div className={cn('mt-1 text-xs', error ? 'text-rose-600' : 'text-slate-500')}>{error || hint}</div>
      )}
    </div>
  ),
);
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & FieldProps>(
  ({ label, hint, error, className, rows = 3, ...rest }, ref) => (
    <div className={className}>
      {label && <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">{label}</label>}
      <textarea
        ref={ref}
        rows={rows}
        {...rest}
        className={cn(inputCls, 'h-auto py-2.5', error && 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/20')}
      />
      {(hint || error) && (
        <div className={cn('mt-1 text-xs', error ? 'text-rose-600' : 'text-slate-500')}>{error || hint}</div>
      )}
    </div>
  ),
);
Textarea.displayName = 'Textarea';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & FieldProps & { children: ReactNode }>(
  ({ label, hint, error, className, children, ...rest }, ref) => (
    <div className={className}>
      {label && <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">{label}</label>}
      <select ref={ref} {...rest} className={cn(inputCls, 'pr-8 cursor-pointer', error && 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/20')}>
        {children}
      </select>
      {(hint || error) && (
        <div className={cn('mt-1 text-xs', error ? 'text-rose-600' : 'text-slate-500')}>{error || hint}</div>
      )}
    </div>
  ),
);
Select.displayName = 'Select';

interface ColorPickerProps {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  presets?: string[];
}

export function ColorPicker({ label, value, onChange, presets = [] }: ColorPickerProps) {
  return (
    <div>
      {label && <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">{label}</label>}
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-12 rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer bg-transparent"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(inputCls, 'font-mono uppercase')}
        />
      </div>
      {presets.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {presets.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onChange(c)}
              style={{ backgroundColor: c }}
              className={cn(
                'w-6 h-6 rounded-md border-2 transition-all',
                value.toLowerCase() === c.toLowerCase()
                  ? 'border-slate-900 dark:border-white scale-110'
                  : 'border-white dark:border-slate-700 hover:scale-110',
              )}
              title={c}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}

export function Toggle({ checked, onChange, label }: ToggleProps) {
  return (
    <label className="flex items-center gap-3 cursor-pointer select-none">
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
          checked ? 'bg-brand-600' : 'bg-slate-300 dark:bg-slate-700',
        )}
        role="switch"
        aria-checked={checked}
      >
        <span
          className={cn(
            'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
            checked ? 'translate-x-4' : 'translate-x-0.5',
          )}
        />
      </button>
      {label && <span className="text-sm text-slate-700 dark:text-slate-300">{label}</span>}
    </label>
  );
}
