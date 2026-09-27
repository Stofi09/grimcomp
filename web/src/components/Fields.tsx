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

interface FieldFrameProps extends FieldProps {
  children: React.ReactNode;
  controlId?: string;
  labelId?: string;
  hintId?: string;
  group?: boolean;
}

const FieldFrame: React.FC<FieldFrameProps> = ({
  label,
  hint,
  style,
  children,
  controlId,
  labelId,
  hintId,
  group,
}) => {
  const groupProps = group
    ? {
        role: 'group',
        'aria-labelledby': labelId,
        'aria-describedby': hint ? hintId : undefined,
      }
    : {};

  return (
    <div className="fld" style={style ?? undefined} {...groupProps}>
      {controlId ? (
        <label className="fld-label" htmlFor={controlId}>{label}</label>
      ) : (
        <div className="fld-label" id={labelId}>{label}</div>
      )}
      {children}
      {hint ? <div className="fld-hint" id={hintId}>{hint}</div> : null}
    </div>
  );
};

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
}) => {
  const controlId = React.useId();
  const hintId = `${controlId}-hint`;
  const describedBy = hint ? hintId : undefined;

  return (
    <FieldFrame
      label={label}
      hint={hint}
      style={style}
      controlId={controlId}
      hintId={hintId}
    >
      {multiline ? (
        <textarea
          id={controlId}
          className="fld-input fld-input-multiline"
          style={{ minHeight: 22 * numberOfLines }}
          rows={numberOfLines}
          value={value}
          onChange={e => onChangeText(e.target.value)}
          placeholder={placeholder}
          aria-describedby={describedBy}
          autoCorrect="off"
          spellCheck={false}
          autoCapitalize={autoCapitalize}
        />
      ) : (
        <input
          id={controlId}
          type="text"
          className="fld-input"
          value={value}
          onChange={e => onChangeText(e.target.value)}
          placeholder={placeholder}
          aria-describedby={describedBy}
          autoCorrect="off"
          spellCheck={false}
          autoCapitalize={autoCapitalize}
        />
      )}
    </FieldFrame>
  );
};

interface NumberFieldProps extends FieldProps {
  value: number;
  onChangeNumber: (next: number) => void;
  min?: number;
  max?: number;
}

/** The whole number a draft spells out: digits with an optional leading minus. */
function parseDraft(text: string): number | null {
  const cleaned = text.replace(/[^\d-]/g, '');
  return /^-?\d+$/.test(cleaned) ? parseInt(cleaned, 10) : null;
}

/**
 * The value a draft stands for. An empty or unfinished draft ("", "-") counts
 * as 0 kept inside the range, so clearing a field zeroes it (or lifts it to a
 * positive minimum) instead of jumping to a negative minimum.
 */
function draftValue(text: string, min?: number, max?: number): number {
  let n = parseDraft(text) ?? 0;
  if (min != null) n = Math.max(min, n);
  if (max != null) n = Math.min(max, n);
  return n;
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
  const controlId = React.useId();
  const hintId = `${controlId}-hint`;
  // The local draft keeps what the user typed ("", "-", "-2") while the parent
  // holds the number. Outside changes (presets, resets) replace the draft only
  // when it no longer stands for the current value, so typing "-20" works.
  const [raw, setRaw] = React.useState(String(value));
  React.useEffect(() => {
    setRaw(prev => (draftValue(prev, min, max) === value ? prev : String(value)));
  }, [value, min, max]);
  const commit = (text: string) => {
    setRaw(text);
    onChangeNumber(draftValue(text, min, max));
  };
  return (
    <FieldFrame
      label={label}
      hint={hint}
      style={style}
      controlId={controlId}
      hintId={hintId}
    >
      <input
        id={controlId}
        type="text"
        className="fld-input fld-input-num"
        inputMode="numeric"
        value={raw}
        onChange={e => commit(e.target.value)}
        onBlur={() => setRaw(String(value))}
        aria-describedby={hint ? hintId : undefined}
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
  const labelId = React.useId();
  const hintId = `${labelId}-hint`;
  return (
    <FieldFrame
      label={label}
      hint={hint}
      style={style}
      labelId={labelId}
      hintId={hintId}
      group
    >
      <div className="fld-options">
        {options.map(opt => {
          const on = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              className={`btn-reset fld-option${on ? ' fld-option-on' : ''}`}
              onClick={() => onChange(opt.value)}
              aria-pressed={on}
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
  const labelId = React.useId();
  const hintId = `${labelId}-hint`;
  const toggle = (v: T) => {
    if (selected.includes(v)) onChange(selected.filter(x => x !== v));
    else onChange([...selected, v]);
  };
  return (
    <FieldFrame
      label={label}
      hint={hint}
      style={style}
      labelId={labelId}
      hintId={hintId}
      group
    >
      <div className="fld-options">
        {options.map(opt => {
          const on = selected.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              className={`btn-reset fld-option${on ? ' fld-option-on' : ''}`}
              onClick={() => toggle(opt.value)}
              aria-pressed={on}
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
  const controlId = React.useId();
  const hintId = `${controlId}-hint`;
  const [raw, setRaw] = React.useState(value.join(', '));
  React.useEffect(() => { setRaw(value.join(', ')); }, [value]);
  return (
    <FieldFrame
      label={label}
      hint={hint}
      style={style}
      controlId={controlId}
      hintId={hintId}
    >
      <input
        id={controlId}
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
        aria-describedby={hint ? hintId : undefined}
        autoCorrect="off"
        spellCheck={false}
        autoCapitalize="words"
      />
    </FieldFrame>
  );
};
