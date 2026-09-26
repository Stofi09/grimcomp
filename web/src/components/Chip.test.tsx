// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Chip } from './Chip';

afterEach(cleanup);

describe('Chip rule affordance', () => {
  it('exposes rule help as a separate labelled button', () => {
    const onPress = vi.fn();
    const onInfoPress = vi.fn();
    render(
      <Chip
        label="Bleeding"
        count={1}
        on
        onPress={onPress}
        onInfoPress={onInfoPress}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Read Bleeding rule' }));

    expect(onInfoPress).toHaveBeenCalledOnce();
    expect(onPress).not.toHaveBeenCalled();
  });

  it('offers a separate remove-one-stack button only while stacks remain', () => {
    const onPress = vi.fn();
    const onDecrement = vi.fn();
    const view = render(
      <Chip label="Bleeding" count={3} on onPress={onPress} onDecrement={onDecrement} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove one Bleeding stack' }));
    expect(onDecrement).toHaveBeenCalledOnce();
    expect(onPress).not.toHaveBeenCalled();

    view.rerender(<Chip label="Bleeding" count={0} on={false} onPress={onPress} onDecrement={onDecrement} />);
    expect(screen.queryByRole('button', { name: 'Remove one Bleeding stack' })).toBeNull();
  });
});
