// @vitest-environment jsdom

import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  MultiPickerField,
  NumberField,
  PickerField,
  TextField,
} from './Fields';

afterEach(cleanup);

describe('form fields', () => {
  it('associates text fields and hints with their visible labels', () => {
    const onChangeText = vi.fn();

    render(
      <TextField
        label="Character name"
        hint="Shown on the roster."
        value="Sigmund"
        onChangeText={onChangeText}
      />,
    );

    const input = screen.getByRole('textbox', { name: 'Character name' });
    expect(input.getAttribute('aria-describedby')).not.toBeNull();
    expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent)
      .toBe('Shown on the roster.');

    fireEvent.change(input, { target: { value: 'Erika' } });
    expect(onChangeText).toHaveBeenCalledWith('Erika');
  });

  it('labels and clamps numeric input before reporting a value', () => {
    const onChangeNumber = vi.fn();

    render(
      <NumberField
        label="Age"
        value={28}
        min={16}
        max={80}
        onChangeNumber={onChangeNumber}
      />,
    );

    const input = screen.getByRole('textbox', { name: 'Age' });
    fireEvent.change(input, { target: { value: '999 years' } });
    expect(onChangeNumber).toHaveBeenLastCalledWith(80);

    fireEvent.change(input, { target: { value: '' } });
    expect(onChangeNumber).toHaveBeenLastCalledWith(16);
  });

  it('lets a negative-range field be typed, cleared and preset', () => {
    function Difficulty() {
      const [value, setValue] = React.useState(10);
      return (
        <>
          <NumberField label="Difficulty modifier" value={value} min={-100} max={100} onChangeNumber={setValue} />
          <output aria-label="Current difficulty">{value}</output>
          <button type="button" onClick={() => setValue(20)}>Preset +20</button>
        </>
      );
    }
    render(<Difficulty />);
    const input = screen.getByRole('textbox', { name: 'Difficulty modifier' }) as HTMLInputElement;
    const current = () => screen.getByLabelText('Current difficulty').textContent;

    // Clearing zeroes the value instead of jumping to the -100 minimum.
    fireEvent.change(input, { target: { value: '' } });
    expect(current()).toBe('0');
    expect(input.value).toBe('');

    // A lone minus is an unfinished entry: it stays in the field.
    fireEvent.change(input, { target: { value: '-' } });
    expect(input.value).toBe('-');
    expect(current()).toBe('0');
    fireEvent.change(input, { target: { value: '-20' } });
    expect(current()).toBe('-20');
    expect(input.value).toBe('-20');

    // An outside change replaces the draft.
    fireEvent.click(screen.getByRole('button', { name: 'Preset +20' }));
    expect(input.value).toBe('20');

    // An out-of-range entry clamps the value; leaving the field tidies the text.
    fireEvent.change(input, { target: { value: '-1002' } });
    expect(current()).toBe('-100');
    fireEvent.blur(input);
    expect(input.value).toBe('-100');
  });

  it('exposes a named single-choice group and its selected state', () => {
    const onChange = vi.fn();

    render(
      <PickerField
        label="Class"
        value="warrior"
        onChange={onChange}
        options={[
          { value: 'warrior', label: 'Warrior' },
          { value: 'academic', label: 'Academic' },
        ]}
      />,
    );

    expect(screen.getByRole('group', { name: 'Class' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Warrior' }).getAttribute('aria-pressed'))
      .toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Academic' }));
    expect(onChange).toHaveBeenCalledWith('academic');
  });

  it('reports the next selection for a named multi-choice group', () => {
    const onChange = vi.fn();

    render(
      <MultiPickerField
        label="Qualities"
        selected={['defensive']}
        onChange={onChange}
        options={[
          { value: 'defensive', label: 'Defensive' },
          { value: 'fast', label: 'Fast' },
        ]}
      />,
    );

    expect(screen.getByRole('group', { name: 'Qualities' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Fast' }));
    expect(onChange).toHaveBeenCalledWith(['defensive', 'fast']);
  });
});
