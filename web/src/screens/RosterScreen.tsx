import type * as React from 'react';
import { ScreenContainer } from './ScreenContainer';
import { useCharacter } from '@/hooks/useCharacter';
import { useRoster } from '@/hooks/useRoster';
import { FALLBACK_CHARACTER_ID } from '@/data/character';
import type { ScreenId } from '@/data/nav';
import { Hero } from '@/components/Hero';
import { Section } from '@/components/Section';
import { Card } from '@/components/Card';
import { Pill } from '@/components/Pill';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { Icon } from '@/components/Icon';
import { Alert } from '@/ui/alert';
import { colors } from '@/theme';
import './RosterScreen.css';

interface Props {
  onNav: (id: ScreenId) => void;
}

const DEFAULT_PARTY_NAME = 'The Eberfeld Road Wardens';

export const RosterScreen: React.FC<Props> = ({ onNav }) => {
  const { id: activeId, template: active, setActive } = useCharacter();
  const { list, remove, custom } = useRoster();

  const switchTo = (id: string) => {
    setActive(id);
    onNav('overview');
  };

  // Party-name subtitle reads the active character's party; falls back to the
  // canonical name when a character has no party set.
  const partyName = active.party?.name?.trim() || DEFAULT_PARTY_NAME;

  const confirmDelete = (id: string, name: string) => {
    Alert.alert(
      'Delete character',
      `Permanently delete ${name}? This wipes their XP, wounds, conditions and inventory.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            remove(id);
            if (id === activeId) setActive(FALLBACK_CHARACTER_ID);
          },
        },
      ],
    );
  };

  return (
    <ScreenContainer>
      <Hero
        title="Characters"
        subRow={<span className="rost-sub">{list.length} characters · {partyName}</span>}
        actions={
          <Button
            variant="primary"
            iconLeft={<Icon name="plus" size={13} color={colors.ivory} />}
            onPress={() => onNav('newchar')}
          >
            New character
          </Button>
        }
      />

      <Section title="Active party" />

      <div className="rost-grid">
        {list.map(c => {
          const isActive = c.id === activeId;
          const isCustom = c.id in custom;
          return (
            <div
              key={c.id}
              className="rost-cell-wrap"
              onContextMenu={isCustom ? (e) => { e.preventDefault(); confirmDelete(c.id, c.name); } : undefined}
            >
              <Card style={{ flex: 1, ...(isActive ? { borderColor: colors.brass, boxShadow: 'var(--shadow-deep)' } : null) }}>
                <button
                  type="button"
                  className="btn-reset rost-card-btn"
                  onClick={() => switchTo(c.id)}
                  aria-label={`Switch to ${c.name}`}
                >
                  <div className="rost-card-row">
                    <Avatar initials={c.initials} accent={c.accent} size={56} fontSize={22} />
                    <div className="rost-card-main">
                      <div className="rost-name-row">
                        <span className="rost-name">{c.name}</span>
                        <div className="rost-pills">
                          {isCustom ? <Pill variant="ghost" size={10}>CUSTOM</Pill> : null}
                          {isActive ? <Pill variant="brass" size={10}>ACTIVE</Pill> : null}
                        </div>
                      </div>
                      <span className="rost-meta">{c.species} · {c.career} · rank {c.careerLevel} · {c.status}</span>
                      <div className="rost-stats-row">
                        <div className="rost-stat">
                          <span className="rost-meta-mono">WOUNDS</span>
                          <span className="rost-big-val">{c.wounds.current}/{c.wounds.max}</span>
                        </div>
                        <div className="rost-stat">
                          <span className="rost-meta-mono">SPENDABLE XP</span>
                          <span className="rost-big-val rost-big-val--brass">{c.xpCurrent}</span>
                        </div>
                        <div className="rost-chev">
                          <Icon name="chev" size={16} color={colors.ink3} />
                        </div>
                      </div>
                    </div>
                  </div>
                </button>

                {isCustom ? (
                  <button
                    type="button"
                    className="btn-reset rost-delete"
                    onClick={() => confirmDelete(c.id, c.name)}
                    aria-label={`Delete ${c.name}`}
                    title={`Delete ${c.name}`}
                  >
                    <Icon name="minus" size={15} color={colors.ink3} />
                  </button>
                ) : null}
              </Card>
            </div>
          );
        })}

        <div className="rost-cell-wrap">
          <button
            type="button"
            className="btn-reset rost-empty-btn"
            onClick={() => onNav('newchar')}
          >
            <Card dashed style={{ flex: 1 }}>
              <div className="rost-empty">
                <Icon name="plus" size={22} color={colors.ink3} />
                <span className="rost-empty-title">New character</span>
                <span className="rost-empty-sub">blank, from template, or imported</span>
              </div>
            </Card>
          </button>
        </div>
      </div>
    </ScreenContainer>
  );
};
