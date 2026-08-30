import { useRef, useState } from 'react';
import type * as React from 'react';
import { ScreenContainer } from './ScreenContainer';
import { useCharacter } from '@/hooks/useCharacter';
import { useCharacterSummary } from '@/hooks/useCharacterSummary';
import { useRoster } from '@/hooks/useRoster';
import { runStoredTransaction } from '@/hooks/useStoredState';
import { FALLBACK_CHARACTER_ID, type Character } from '@/data/character';
import { Hero } from '@/components/Hero';
import { Section } from '@/components/Section';
import { Card } from '@/components/Card';
import { Pill } from '@/components/Pill';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { Icon } from '@/components/Icon';
import { Alert } from '@/ui/alertStore';
import { colors } from '@/theme';
import './RosterScreen.css';

interface Props {
  onNav: (id: string) => void;
}

const DEFAULT_PARTY_NAME = 'The Eberfeld Road Wardens';

interface RosterCardProps {
  template: Character;
  active: boolean;
  custom: boolean;
  deleting: boolean;
  onSwitch: (id: string) => void;
  onDelete: (id: string, name: string) => void;
}

const RosterCard: React.FC<RosterCardProps> = ({
  template,
  active,
  custom,
  deleting,
  onSwitch,
  onDelete,
}) => {
  const summary = useCharacterSummary(template);
  const c = summary.character;

  return (
    <div
      className="rost-cell-wrap"
      onContextMenu={custom
        ? (e) => { e.preventDefault(); if (!deleting) onDelete(c.id, c.name); }
        : undefined}
    >
      <Card style={{
        flex: 1,
        ...(active ? { borderColor: colors.brass, boxShadow: 'var(--shadow-deep)' } : null),
      }}>
        <button
          type="button"
          className="btn-reset rost-card-btn"
          onClick={() => onSwitch(c.id)}
          aria-label={`Switch to ${c.name}`}
        >
          <div className="rost-card-row">
            <Avatar initials={c.initials} accent={c.accent} size={56} fontSize={22} />
            <div className="rost-card-main">
              <div className="rost-name-row">
                <span className="rost-name">{c.name}</span>
                <div className="rost-pills">
                  {custom ? <Pill variant="ghost" size={10}>CUSTOM</Pill> : null}
                  {active ? <Pill variant="brass" size={10}>ACTIVE</Pill> : null}
                </div>
              </div>
              <span className="rost-meta">
                {c.species} · {summary.careerName} · rank {summary.careerLevel} · {summary.status}
              </span>
              <div className="rost-stats-row">
                <div className="rost-stat">
                  <span className="rost-meta-mono">WOUNDS</span>
                  <span className="rost-big-val">{summary.wounds}/{summary.maxWounds}</span>
                </div>
                <div className="rost-stat">
                  <span className="rost-meta-mono">SPENDABLE XP</span>
                  <span className="rost-big-val rost-big-val--brass">{summary.xpCurrent}</span>
                </div>
                <div className="rost-chev">
                  <Icon name="chev" size={16} color={colors.ink3} />
                </div>
              </div>
            </div>
          </div>
        </button>

        {custom ? (
          <button
            type="button"
            className="btn-reset rost-delete"
            onClick={() => onDelete(c.id, c.name)}
            disabled={deleting}
            aria-label={`Delete ${c.name}`}
            title={`Delete ${c.name}`}
          >
            <Icon name="minus" size={15} color={colors.ink3} />
          </button>
        ) : null}
      </Card>
    </div>
  );
};

export const RosterScreen: React.FC<Props> = ({ onNav }) => {
  const { id: activeId, template: active, setActive } = useCharacter();
  const { list, remove, custom } = useRoster();
  const deletingIdsRef = useRef(new Set<string>());
  const [deletingIds, setDeletingIds] = useState<ReadonlySet<string>>(() => new Set());

  const switchTo = (id: string) => {
    setActive(id);
    onNav('overview');
  };

  // Party-name subtitle reads the active character's party; falls back to the
  // canonical name when a character has no party set.
  const partyName = active.party?.name?.trim() || DEFAULT_PARTY_NAME;

  const deleteCharacter = async (id: string) => {
    if (deletingIdsRef.current.has(id)) return;
    deletingIdsRef.current.add(id);
    setDeletingIds(new Set(deletingIdsRef.current));
    const result = await (async () => {
      try {
        const ticket = runStoredTransaction(() => {
          remove(id);
          if (id === activeId) setActive(FALLBACK_CHARACTER_ID);
        });
        return await ticket.completion;
      } finally {
        deletingIdsRef.current.delete(id);
        setDeletingIds(new Set(deletingIdsRef.current));
      }
    })();
    if (!result.ok) {
      Alert.alert(
        'Character not deleted',
        `Nothing was changed because the character could not be deleted. ${result.error.message}`,
      );
    }
  };

  const confirmDelete = (id: string, name: string) => {
    if (deletingIdsRef.current.has(id)) return;
    Alert.alert(
      'Delete character',
      `Permanently delete ${name}? This wipes their XP, wounds, conditions and inventory.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => { void deleteCharacter(id); },
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
        {list.map(c => (
          <RosterCard
            key={c.id}
            template={c}
            active={c.id === activeId}
            custom={c.id in custom}
            deleting={deletingIds.has(c.id)}
            onSwitch={switchTo}
            onDelete={confirmDelete}
          />
        ))}

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
                <span className="rost-empty-sub">guided race, characteristics, and career setup</span>
              </div>
            </Card>
          </button>
        </div>
      </div>
    </ScreenContainer>
  );
};
