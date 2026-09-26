import * as React from 'react';
import { colors } from '@/theme';
import { Icon } from './Icon';
import { RollSheet } from './RollSheet';
import { ReferenceSearchSheet } from './ReferenceSearchSheet';
import './AppBar.css';

interface AppBarProps {
  crumbs: string[];
  showMenu?: boolean;
  onMenuPress?: () => void;
}

export const AppBar: React.FC<AppBarProps> = ({ crumbs, showMenu, onMenuPress }) => {
  const [rollMode, setRollMode] = React.useState<'roll' | 'history' | null>(null);
  const [searchOpen, setSearchOpen] = React.useState(false);
  return (
    <>
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
          className="btn-reset appbar-action appbar-action--search"
          onClick={() => setSearchOpen(true)}
          aria-label="Global search"
        >
          <Icon name="search" size={14} color={colors.ink2} />
          <span className="appbar-action-text">Search</span>
        </button>
        <div className="appbar-sep2" />
        <button
          type="button"
          className="btn-reset appbar-action appbar-action--history"
          onClick={() => setRollMode('history')}
          aria-label="Roll history"
        >
          <Icon name="book" size={14} color={colors.ink2} />
          <span className="appbar-history-text">History</span>
        </button>
        <button
          type="button"
          className="btn-reset appbar-action appbar-action--roll"
          onClick={() => setRollMode('roll')}
        >
          <Icon name="dice" size={14} color={colors.ink2} />
          <span className="appbar-action-text">Roll</span>
        </button>
      </div>
      <RollSheet visible={rollMode !== null} initialMode={rollMode ?? 'roll'} onClose={() => setRollMode(null)} />
      <ReferenceSearchSheet
        visible={searchOpen}
        onClose={() => setSearchOpen(false)}
        title="Global search"
      />
    </>
  );
};
