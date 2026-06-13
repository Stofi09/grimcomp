import type * as React from 'react';
import { colors, RAIL_WIDTH } from '@/theme';
import { NAV, type ScreenId } from '@/data/nav';
import { useXp } from '@/hooks/useXp';
import { useCareer } from '@/hooks/useCareer';
import { useDerived } from '@/hooks/useDerived';
import { useCharacter, characterKey } from '@/hooks/useCharacter';
import { useStoredState } from '@/hooks/useStoredState';
import { Icon } from './Icon';
import { Avatar } from './Avatar';
import './Rail.css';

interface RailProps {
  current: ScreenId;
  onNav: (id: ScreenId) => void;
  onClose?: () => void;
  width?: number;
}

export const Rail: React.FC<RailProps> = ({ current, onNav, onClose, width = RAIL_WIDTH }) => {
  const { id, template: c } = useCharacter();
  const xp = useXp();
  const career = useCareer();
  const { maxWounds } = useDerived();
  const [wounds] = useStoredState(characterKey(id, 'wounds'), c.wounds.current);

  return (
    <div className="rail" style={{ width }}>
      {/* embossed seam — inset shadow on the right edge */}
      <div className="rail-seam" />
      {/* hanging ribbon marker */}
      <div className="rail-ribbon" />

      <div className="rail-inner">
        <div className="rail-brand">
          <div className="rail-mark">
            <span className="rail-mark-text">G</span>
          </div>
          <div>
            <div className="rail-wordmark">Grim Companion</div>
            <div className="rail-ver">v2 · Reikland</div>
          </div>
        </div>

        <button type="button" className="btn-reset rail-char-card" onClick={() => onNav('roster')}>
          <div className="rail-char-top">
            <Avatar initials={c.initials} accent={c.accent} size={40} fontSize={16} />
            <div className="rail-char-meta">
              <div className="rail-name">{c.name}</div>
              <div className="rail-sub">{career.name} · rank {career.level}</div>
            </div>
            <Icon name="chev" size={13} color={colors.ink4} />
          </div>
          <div className="rail-vitals">
            <Vital label="Wnd" value={`${wounds}`} sub={`/${maxWounds}`} accent={colors.empire} />
            <Vital label="Fate" value={`${c.fate}`} sub={`·${c.fortune}`} accent={colors.brass} />
            <Vital label="XP" value={`${xp.current}`} accent={colors.brass} last />
          </div>
        </button>

        {NAV.map(group => (
          <div key={group.section}>
            <div className="rail-section">
              <span className="rail-section-label">{group.section}</span>
              <span className="rail-section-rule" />
            </div>
            {group.items
              // Hide capability-gated screens the character can't use: Magic
              // only for casters, Faith only for the Anointed. Their detail
              // screens still render a reference-only empty state if reached
              // directly (e.g. via a restored screen), so nothing breaks.
              .filter(it => (it.id !== 'magic' || c.isCaster) && (it.id !== 'faith' || c.isAnointed))
              .map(it => {
              const active = current === it.id;
              return (
                <button
                  key={it.id}
                  type="button"
                  className={`btn-reset rail-item${active ? ' rail-item--active' : ''}`}
                  onClick={() => { onNav(it.id); onClose?.(); }}
                >
                  <span className="rail-item-icon">
                    <Icon name={it.icon} size={15} color={active ? colors.gold : colors.ink3} />
                  </span>
                  <span className={`rail-item-text${active ? ' rail-item-text--active' : ''}`}>
                    {it.label}
                  </span>
                  {it.badge ? (
                    <span className={`rail-badge${active ? ' rail-badge--active' : ''}`}>
                      <span className={`rail-badge-text${active ? ' rail-badge-text--active' : ''}`}>
                        {it.badge}
                      </span>
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};

interface VitalProps {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
  last?: boolean;
}

const Vital: React.FC<VitalProps> = ({ label, value, sub, accent, last }) => (
  <div className={`rail-vital${last ? '' : ' rail-vital--divider'}`}>
    <span className="rail-vital-label">{label}</span>
    <span className="rail-vital-value" style={accent ? { color: accent } : undefined}>
      {value}
      {sub ? <span className="rail-vital-sub">{sub}</span> : null}
    </span>
  </div>
);
