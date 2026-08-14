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
});
