import type * as React from 'react';
import { colors } from '@/theme';
import { Icon } from './Icon';
import { resolveTest, outcomeLabel, diceLabel } from '@/utils/roll';
import { useConditions } from '@/hooks/useConditions';
import { useSystemRules } from '@/content/useContent';
import { Alert } from '@/ui/alert';
import './AppBar.css';

interface AppBarProps {
  crumbs: string[];
  showMenu?: boolean;
  onMenuPress?: () => void;
}

export const AppBar: React.FC<AppBarProps> = ({ crumbs, showMenu, onMenuPress }) => {
  // Pull condition modifier for the quick-roll button so the toolbar's roll
  // reflects the same penalties as in-screen tests.
  const { modifier: condMod } = useConditions();
  const { test } = useSystemRules();
  return (
    <div className="appbar">
      {showMenu ? (
        <button type="button" className="btn-reset appbar-menu" onClick={onMenuPress} aria-label="Open menu">
          <Icon name="menu" size={18} color={colors.ink2} />
        </button>
      ) : null}
      <div className="appbar-crumbs">
        {crumbs.map((c, i) => {
          const here = i === crumbs.length - 1;
          return (
            <div key={`${c}-${i}`} className="appbar-crumb-row">
              <span className={`appbar-crumb${here ? ' appbar-crumb--here' : ''}`}>{c}</span>
              {!here ? <span className="appbar-sep">›</span> : null}
            </div>
          );
        })}
      </div>
      <div className="appbar-spacer" />
      <button
        type="button"
        className="btn-reset appbar-action"
        onClick={() => Alert.alert('Search', 'Global search not wired up in this prototype.')}
      >
        <Icon name="search" size={14} color={colors.ink2} />
        <span className="appbar-action-text">Search</span>
      </button>
      <div className="appbar-sep2" />
      <button
        type="button"
        className="btn-reset appbar-action"
        onClick={() => Alert.alert('Notifications', 'You have no new notifications.')}
        aria-label="Notifications"
      >
        <Icon name="bell" size={14} color={colors.ink2} />
      </button>
      <button
        type="button"
        className="btn-reset appbar-action"
        onClick={() => {
          // No specific target — roll against the midpoint of the system's
          // dice so the auto-success/fumble interpretation still applies.
          const midpoint = Math.round((test.dice.count * test.dice.sides) / 2);
          const r = resolveTest({ target: midpoint, modifier: condMod.total, label: 'Quick test' }, test);
          const condLine = condMod.parts.length
            ? '\n\nFrom conditions:\n' + condMod.parts.map(p => `  • ${p.name} ×${p.stacks} → ${p.modifier > 0 ? '+' : ''}${p.modifier}`).join('\n')
            : '';
          Alert.alert(
            `Quick ${diceLabel(test.dice)} — ${outcomeLabel(r.outcome)}`,
            `Rolled ${r.roll}.\n\nTip: tap the dice next to a skill or weapon to test against a real target.${condLine}`,
          );
        }}
      >
        <Icon name="dice" size={14} color={colors.ink2} />
        <span className="appbar-action-text">Roll</span>
      </button>
    </div>
  );
};
