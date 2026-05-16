// Form-field primitives used inside EditSheet. Matched to the parchment
// theme — small caps brass label above a thin-rule input, like a fillable
// character sheet.

import React from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ViewStyle,
  StyleProp,
} from 'react-native';
import { colors, fontFamilies, space } from '@/theme';

interface FieldProps {
  label: string;
  hint?: string;
  style?: StyleProp<ViewStyle>;
}

const FieldFrame: React.FC<FieldProps & { children: React.ReactNode }> = ({
  label,
  hint,
  style,
  children,
}) => (
  <View style={[styles.field, style]}>
    <Text style={styles.label}>{label}</Text>
    {children}
    {hint ? <Text style={styles.hint}>{hint}</Text> : null}
  </View>
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
    <TextInput
      style={[
        styles.input,
        multiline ? { minHeight: 22 * numberOfLines, textAlignVertical: 'top' } : null,
      ]}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.ink4}
      autoCorrect={false}
      autoCapitalize={autoCapitalize}
      multiline={multiline}
      numberOfLines={multiline ? numberOfLines : 1}
    />
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
    if (Number.isNaN(n)) return;
    let clamped = n;
    if (min != null) clamped = Math.max(min, clamped);
    if (max != null) clamped = Math.min(max, clamped);
    onChangeNumber(clamped);
  };
  return (
    <FieldFrame label={label} hint={hint} style={style}>
      <TextInput
        style={[styles.input, { fontFamily: fontFamilies.monoMedium }]}
        value={raw}
        onChangeText={commit}
        keyboardType="number-pad"
        placeholderTextColor={colors.ink4}
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
      <View style={styles.optionsRow}>
        {options.map(opt => {
          const on = opt.value === value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => onChange(opt.value)}
              hitSlop={4}
              style={({ pressed }) => [
                styles.option,
                on && styles.optionOn,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={[styles.optionText, on && styles.optionTextOn]}>
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
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
      <View style={styles.optionsRow}>
        {options.map(opt => {
          const on = selected.includes(opt.value);
          return (
            <Pressable
              key={opt.value}
              onPress={() => toggle(opt.value)}
              hitSlop={4}
              style={({ pressed }) => [
                styles.option,
                on && styles.optionOn,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={[styles.optionText, on && styles.optionTextOn]}>
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
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
      <TextInput
        style={styles.input}
        value={raw}
        onChangeText={t => {
          setRaw(t);
          const parts = t.split(',').map(s => s.trim()).filter(Boolean);
          onChange(parts);
        }}
        placeholder="e.g. Defensive, Penetrating"
        placeholderTextColor={colors.ink4}
        autoCorrect={false}
        autoCapitalize="words"
      />
    </FieldFrame>
  );
};

const styles = StyleSheet.create({
  field: { marginBottom: space.xxxl },
  label: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: 9.5,
    letterSpacing: 1.6,
    color: colors.brass,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  input: {
    fontFamily: fontFamilies.body,
    fontSize: 14,
    color: colors.ink,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderStrong,
    paddingVertical: 7,
    paddingHorizontal: 0,
  },
  hint: {
    fontFamily: fontFamilies.body,
    fontSize: 11,
    color: colors.ink3,
    marginTop: 4,
  },
  optionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  option: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: 4,
  },
  optionOn: {
    backgroundColor: colors.empire,
    borderColor: colors.empireDeep,
  },
  optionText: {
    fontFamily: fontFamilies.bodyMedium,
    fontSize: 11.5,
    color: colors.ink2,
  },
  optionTextOn: { color: colors.bone },
});
