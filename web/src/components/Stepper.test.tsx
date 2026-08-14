// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Stepper } from './Stepper';

afterEach(cleanup);

describe('Stepper', () => {
  it('disables controls that cannot change a bounded value', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Stepper value={0} min={0} max={2} onChange={onChange} />,
    );

    expect(screen.getByRole('button', { name: 'Decrease' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Increase' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Decrease' }));
    expect(onChange).not.toHaveBeenCalled();

    rerender(<Stepper value={2} min={0} max={2} onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Increase' }).hasAttribute('disabled')).toBe(true);
  });
});
