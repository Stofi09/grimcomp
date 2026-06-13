// Form-field primitives used inside EditSheet. Matched to the parchment
// theme — small caps brass label above a thin-rule input, like a fillable
// character sheet.

import React from 'react';
import './Fields.css';

interface FieldProps {
  label: string;
  hint?: string;
  style?: React.CSSProperties | null;
}

const FieldFrame: React.FC<FieldProps & { children: React.ReactNode }> = ({
  label,
  hint,
  style,
  children,
}) => (
  <div className="fld" style={style ?? undefined}>
    <div className="fld-label">{label}</div>
    {children}
    {hint ? <div className="fld-hint">{hint}</div> : null}
  </div>
);

interface TextFieldProps extends FieldProps {
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  multiline?: boolean;
  numberOfLines?: number;
}

export const TextField: React.FC<TextFieldProps> = ({
  label,
  hint,
  style,
  value,
  onChangeText,
  placeholder,
  autoCapitalize = 'sentences',
  multiline,
  numberOfLines = 4,
}) => (
  <FieldFrame label={label} hint={hint} style={style}>
    {multiline ? (
      <textarea
        className="fld-input fld-input-multiline"
        style={{ minHeight: 22 * numberOfLines }}
        rows={numberOfLines}
        value={value}
        onChange={e => onChangeText(e.target.value)}
        placeholder={placeholder}
        autoCorrect="off"
        spellCheck={false}
        autoCapitalize={autoCapitalize}
      />
    ) : (
      <input
        type="text"
        className="fld-input"
        value={value}
        onChange={e => onChangeText(e.target.value)}
        placeholder={placeholder}
        autoCorrect="off"
        spellCheck={false}
        autoCapitalize={autoCapitalize}
      />
    )}
  </FieldFrame>
);

interface NumberFieldProps extends FieldProps {
  value: number;
  onChangeNumber: (next: number) => void;
  min?: number;
  max?: number;
}

export const NumberField: React.FC<NumberFieldProps> = ({
  label,
  hint,
  style,
  value,
  onChangeNumber,
  min,
  max,
}) => {
  const [raw, setRaw] = React.useState(String(value));
  React.useEffect(() => { setRaw(String(value)); }, [value]);
  const commit = (text: string) => {
    setRaw(text);
    const n = parseInt(text.replace(/[^\d-]/g, ''), 10);
    if (Number.isNaN(n)) {
      // Empty / non-numeric input: fall back to the min (or 0) and still fire
      // the callback, so a field can actually be cleared or zeroed. The local
      // `raw` draft keeps the empty string so typing stays natural.
      onChangeNumber(min ?? 0);
      return;
    }
    let clamped = n;
    if (min != null) clamped = Math.max(min, clamped);
    if (max != null) clamped = Math.min(max, clamped);
    onChangeNumber(clamped);
  };
  return (
    <FieldFrame label={label} hint={hint} style={style}>
      <input
        type="text"
        className="fld-input fld-input-num"
        inputMode="numeric"
        value={raw}
        onChange={e => commit(e.target.value)}
        autoCorrect="off"
        spellCheck={false}
      />
    </FieldFrame>
  );
};

interface PickerOption<T extends string> { value: T; label: string; }

interface PickerFieldProps<T extends string> extends FieldProps {
  value: T;
  onChange: (next: T) => void;
  options: PickerOption<T>[];
}

export function PickerField<T extends string>({
  label,
  hint,
  style,
  value,
  onChange,
  options,
}: PickerFieldProps<T>) {
  return (
    <FieldFrame label={label} hint={hint} style={style}>
      <div className="fld-options">
        {options.map(opt => {
          const on = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              className={`btn-reset fld-option${on ? ' fld-option-on' : ''}`}
              onClick={() => onChange(opt.value)}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </FieldFrame>
  );
}

interface MultiPickerFieldProps<T extends string> extends FieldProps {
  selected: T[];
  onChange: (next: T[]) => void;
  options: PickerOption<T>[];
}

export function MultiPickerField<T extends string>({
  label,
  hint,
  style,
  selected,
  onChange,
  options,
}: MultiPickerFieldProps<T>) {
  const toggle = (v: T) => {
    if (selected.includes(v)) onChange(selected.filter(x => x !== v));
    else onChange([...selected, v]);
  };
  return (
    <FieldFrame label={label} hint={hint} style={style}>
      <div className="fld-options">
        {options.map(opt => {
          const on = selected.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              className={`btn-reset fld-option${on ? ' fld-option-on' : ''}`}
              onClick={() => toggle(opt.value)}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </FieldFrame>
  );
}

/** Comma-separated qualities (free-form). */
interface QualitiesFieldProps extends FieldProps {
  value: string[];
  onChange: (next: string[]) => void;
}

export const QualitiesField: React.FC<QualitiesFieldProps> = ({ label, hint, style, value, onChange }) => {
  const [raw, setRaw] = React.useState(value.join(', '));
  React.useEffect(() => { setRaw(value.join(', ')); }, [value]);
  return (
    <FieldFrame label={label} hint={hint} style={style}>
      <input
        type="text"
        className="fld-input"
        value={raw}
        onChange={e => {
          const t = e.target.value;
          setRaw(t);
          const parts = t.split(',').map(s => s.trim()).filter(Boolean);
          onChange(parts);
        }}
        placeholder="e.g. Defensive, Penetrating"
        autoCorrect="off"
        spellCheck={false}
        autoCapitalize="words"
      />
    </FieldFrame>
  );
};
