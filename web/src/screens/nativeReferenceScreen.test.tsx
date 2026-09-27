// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentRegistry } from '../../../src/content/registry';
import type { ContentPack } from '../../../src/content/types';
import { EditSheet } from '../../../src/components/EditSheet';
import { ReferenceScreen } from '../../../src/screens/ReferenceScreen';

const host = vi.hoisted(() => ({
  modal: { mounts: 0, unmounts: 0 },
  scrollMounts: 0,
  registry: null as unknown,
}));

type HostProps = Record<string, unknown> & { children?: React.ReactNode };

// Native host components rendered as DOM stand-ins. The Modal and ScrollView
// stand-ins record their lifecycles: on iOS (old architecture) replacing a
// presented Modal in one commit drops the new presentation.
vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (options: { ios?: unknown; default?: unknown }) => options.ios ?? options.default },
  StyleSheet: { create: (styles: unknown) => styles, absoluteFillObject: {}, hairlineWidth: 1 },
  View: ({ children }: HostProps) => <div>{children}</div>,
  Text: ({ children }: HostProps) => <span>{children}</span>,
  KeyboardAvoidingView: ({ children }: HostProps) => <div>{children}</div>,
  Pressable: ({ children, onPress, accessibilityLabel, disabled }: HostProps) => (
    <button
      type="button"
      aria-label={accessibilityLabel as string | undefined}
      disabled={disabled as boolean | undefined}
      onClick={() => (onPress as (() => void) | undefined)?.()}
    >
      {typeof children === 'function' ? (children as (state: { pressed: boolean }) => React.ReactNode)({ pressed: false }) : children}
    </button>
  ),
  TextInput: ({ accessibilityLabel, value, onChangeText }: HostProps) => (
    <input
      aria-label={accessibilityLabel as string | undefined}
      value={value as string}
      onChange={event => (onChangeText as (text: string) => void)(event.target.value)}
    />
  ),
  ScrollView: function ScrollView({
    children, horizontal, keyboardShouldPersistTaps, automaticallyAdjustKeyboardInsets,
  }: HostProps) {
    React.useEffect(() => { host.scrollMounts += 1; }, []);
    return (
      <div
        data-scroll={horizontal ? 'horizontal' : 'vertical'}
        data-persist-taps={(keyboardShouldPersistTaps as string | undefined) ?? 'never'}
        data-adjust-insets={automaticallyAdjustKeyboardInsets ? 'true' : 'false'}
      >
        {children}
      </div>
    );
  },
  Modal: function Modal({ children, visible }: HostProps) {
    React.useEffect(() => {
      host.modal.mounts += 1;
      return () => { host.modal.unmounts += 1; };
    }, []);
    return visible ? <div role="dialog">{children}</div> : null;
  },
}));
vi.mock('expo-linear-gradient', () => ({ LinearGradient: () => null }));
// Native components import '@/theme', which the web test alias maps to the web
// tree; serve them the native theme instead.
vi.mock('@/theme', () => import('../../../src/theme'));
vi.mock('../../../src/components/Icon', () => ({ Icon: () => null }));
vi.mock('../../../src/content/useContent', () => ({ useContent: () => host.registry }));

const pack: ContentPack = {
  $schema: 'grimcomp.content.v1', id: 'native-reference-screen', name: 'Reference screen test', version: '1',
  spells: [{
    id: 'spell.light', name: 'Light', lore: 'Petty', cn: 0, range: 'Touch', target: 'Object',
    duration: 'Minutes', description: 'An object glows.',
  }],
  talents: [{ id: 'tal.sharp', name: 'Sharp', description: 'Notice subtle signs.', max: 2 }],
};

beforeEach(() => {
  host.modal.mounts = 0;
  host.modal.unmounts = 0;
  host.scrollMounts = 0;
  host.registry = new ContentRegistry([pack]);
});
afterEach(cleanup);

describe('native EditSheet', () => {
  it('remounts only its scrollable body when the content key changes', () => {
    const sheet = (contentKey: string, body: string) => (
      <EditSheet visible title="Sheet" contentKey={contentKey} onClose={() => undefined}>
        <span>{body}</span>
      </EditSheet>
    );
    const view = render(sheet('first', 'First body'));
    expect(host.scrollMounts).toBe(1);

    view.rerender(sheet('second', 'Second body'));
    expect(screen.getByText('Second body')).toBeTruthy();
    expect(host.scrollMounts).toBe(2);
    expect(host.modal).toEqual({ mounts: 1, unmounts: 0 });
  });
});

describe('native ReferenceScreen', () => {
  it('keeps the presented sheet mounted while moving between results and an entry', () => {
    render(<ReferenceScreen />);
    expect(host.modal).toEqual({ mounts: 1, unmounts: 0 });

    fireEvent.click(screen.getByRole('button', { name: 'Search rules' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^Light, Spells/ }));

    expect(within(screen.getByRole('dialog')).getByText(/An object glows\./)).toBeTruthy();
    expect(host.modal).toEqual({ mounts: 1, unmounts: 0 });

    fireEvent.click(screen.getByRole('button', { name: 'Back to results' }));
    expect(screen.getByLabelText('Search reference entries')).toBeTruthy();
    expect(host.modal).toEqual({ mounts: 1, unmounts: 0 });
  });
});
