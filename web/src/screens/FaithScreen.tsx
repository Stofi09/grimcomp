import type * as React from 'react';
import { ScreenContainer } from './ScreenContainer';
import { useStoredState } from '@/hooks/useStoredState';
import { useCharacter, characterKey } from '@/hooks/useCharacter';
import { useCharacteristics } from '@/hooks/useCharacteristics';
import { useConditions } from '@/hooks/useConditions';
import { resolveTest, outcomeLabel, formatTestResult } from '@/utils/roll';
import { useResolvePrayers, useTable, useDeities, useSystemRules, useCreation } from '@/content/useContent';
import { rollOnTable, rollForTable } from '@/content/tables';
import type { Prayer } from '@/content/types';
import { Alert } from '@/ui/alert';
import { Hero } from '@/components/Hero';
import { Section } from '@/components/Section';
import { Card, CardHead } from '@/components/Card';
import { Pill } from '@/components/Pill';
import { Stepper } from '@/components/Stepper';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Table, TableRow, Cell } from '@/components/Table';
import { colors } from '@/theme';
import './FaithScreen.css';

export const FaithScreen: React.FC = () => {
  const { id, template: c } = useCharacter();
  const { list: chars } = useCharacteristics();
  const { modifier: condMod } = useConditions();
  const system = useSystemRules();
  const faith = system.faith;
  const creation = useCreation();
  const [sin, setSin] = useStoredState(characterKey(id, 'sin'), 0);

  const prayers = useResolvePrayers(c.knownPrayers ?? []);
  const wrathTable = useTable(faith.wrathTable);
  const deities = useDeities();
  const prayCh = chars.find(x => x.key === faith.prayChar);
  const praySkill = c.skills.find(s => s.name === faith.praySkill);
  const prayTarget = (prayCh?.current ?? 0) + (praySkill?.adv ?? 0);

  // De-hardcoded deity lookup. Match the character's deity by name in the
  // registry; this gives the *real* epithet + dogma (fixing the original's
  // "— Goddess of Mercy" suffix bug, which was appended regardless of deity).
  const matched = deities.find(d => d.name === c.deity);

  const pray = (prayer: Prayer) => {
    const r = resolveTest({ target: prayTarget, modifier: condMod.total, label: `Pray ${prayer.name}` }, system.test);
    // Wrath of the Gods: on ANY Pray test whose units die ≤ current Sin Points
    // (WFRP 4e), regardless of pass/fail. Add the configured bonus per Sin to
    // the wrath roll, then remove 1 Sin after resolving.
    const units = r.roll % 10;
    const wrathTriggered = sin > 0 && units <= sin;

    if (wrathTriggered) {
      const wRoll = Math.min(100, rollForTable(wrathTable) + faith.wrathBonusPerSin * sin);
      const wrath = rollOnTable(wrathTable, wRoll);
      setSin(s => Math.max(0, s - 1));
      const effectLine = r.success
        ? `\n\nThe prayer is still answered: ${prayer.description}`
        : `\n\nThe prayer falters.`;
      Alert.alert(
        `${prayer.name} — Wrath of the Gods`,
        `${formatTestResult(r)}${effectLine}\n\nWrath (${wRoll}):\n${wrath}\n\n−1 Sin (now ${Math.max(0, sin - 1)}).`,
      );
      return;
    }

    if (r.success) {
      Alert.alert(
        `${prayer.name} — ${outcomeLabel(r.outcome)}`,
        `${formatTestResult(r)}\n\n→ ${prayer.description}`,
      );
    } else {
      Alert.alert(
        `${prayer.name} — ${outcomeLabel(r.outcome)}`,
        `${formatTestResult(r)}\n\nThe deity does not answer.`,
      );
    }
  };

  // Non-Anointed view: keeps the Sin counter + dogma card but no prayer list.
  if (!c.isAnointed) {
    // Fall back to the registry's first deity when unmatched — all deity
    // identity (name, epithet, dogma) comes from the content packs.
    const deity = matched ?? deities[0];
    const deityLine = deity
      ? `${deity.name} — ${deity.epithet}`
      : (c.deity ?? '—');
    const dogma = deity?.dogma ?? '';

    return (
      <ScreenContainer>
        <Hero
          title="Faith"
          subRow={<span className="fth-sub">{c.name} is devout but not Anointed — a follower, not a priest.</span>}
        />

        <div className="fth-row">
          <Card style={{ flex: 1, minWidth: 280 }}>
            <span className="fth-label">Sin</span>
            <span className="fth-big-corr">{sin}</span>
            <span className="fth-body">
              Sin points accumulate when dogma is broken. Thresholds carry penalties.
            </span>
            <div className="fth-controls">
              <Stepper value={sin} min={0} max={10} onChange={setSin} />
              <Button
                variant="ghost"
                iconLeft={<Icon name="info" size={12} color={colors.ink2} />}
                onPress={() => Alert.alert('Sin & Wrath', 'Sin accrues from breaking your cult\'s strictures. For the Anointed, any Pray test whose units die ≤ your Sin Points triggers Wrath of the Gods.')}
              >
                Sin table
              </Button>
            </div>
          </Card>

          <Card style={{ flex: 1, minWidth: 280 }}>
            <span className="fth-label">Deity</span>
            <span className="fth-deity">{deityLine}</span>
            <span className="fth-body">{dogma}</span>
            <div className="fth-divider" />
            <div className="fth-pill-row">
              <Pill>Devout</Pill>
              <Pill variant="ghost">Not Anointed</Pill>
            </div>
          </Card>
        </div>

        <Section title="Prayers" />
        <Card style={{ alignItems: 'center', paddingLeft: 20, paddingRight: 20, paddingTop: 32, paddingBottom: 32 }}>
          <span className="fth-empty-text">
            No prayers learned. The Anointed career is required to chant prayers.
          </span>
        </Card>
      </ScreenContainer>
    );
  }

  // Anointed view: full deity card + prayer list with cast buttons.
  // Use the real epithet from the registry; fall back to the literal c.deity
  // name when no registry entry matches.
  const deityName = matched?.name ?? c.deity ?? '—';
  const deityEpithet = matched?.epithet;
  const deityDogma = matched?.dogma ?? '';
  const deityLine = deityEpithet ? `${deityName} — ${deityEpithet}` : deityName;

  return (
    <ScreenContainer>
      <Hero
        title="Faith"
        subRow={
          <>
            <span className="fth-sub">Anointed of {deityName}</span>
            <span className="fth-sep">·</span>
            <span className="fth-sub">{prayers.length} prayers</span>
            <span className="fth-sep">·</span>
            <span className="fth-sub">Pray {praySkill ? `+${praySkill.adv}` : '—'}</span>
          </>
        }
      />

      <div className="fth-row">
        <Card style={{ flex: 1, minWidth: 280 }}>
          <span className="fth-label">Sin</span>
          <span className="fth-big-corr" style={sin >= 3 ? { color: colors.empire } : undefined}>{sin}</span>
          <span className="fth-body">
            Sin from broken dogma. Each Pray test risks Wrath when the units die ≤ your Sin ({sin}).
          </span>
          <div className="fth-controls">
            <Stepper value={sin} min={0} max={10} onChange={setSin} />
            <Button
              variant="ghost"
              iconLeft={<Icon name="info" size={12} color={colors.ink2} />}
              onPress={() => Alert.alert('Sin & Wrath', 'On any Pray test, if the units die of the roll is ≤ your Sin Points, you suffer Wrath of the Gods (+10 to the Wrath roll per Sin Point). One Sin is removed after Wrath resolves. Gain Sin by breaking your cult\'s strictures.')}
            >
              Penalties
            </Button>
          </div>
        </Card>

        <Card style={{ flex: 1, minWidth: 280 }}>
          <span className="fth-label">Deity</span>
          <span className="fth-deity">{deityLine}</span>
          <span className="fth-body">{deityDogma}</span>
          <div className="fth-divider" />
          <div className="fth-pill-row">
            <Pill variant="brass">Anointed</Pill>
            <Pill variant="success">Bless granted</Pill>
          </div>
        </Card>
      </div>

      <Section
        title="Known prayers"
        aside={prayCh ? `${prayCh.short} ${prayCh.current} · target ${prayTarget}` : `target ${prayTarget}`}
      />
      <Card flush>
        <CardHead title="Prayers" meta={(c.deity ?? '').toLowerCase()} />
        <Table>
          <TableRow header>
            <Cell header flex={2}>Name</Cell>
            <Cell header flex={1.1}>Deity</Cell>
            <Cell header flex={1.2}>Range</Cell>
            <Cell header flex={1.1}>Duration</Cell>
            <Cell header flex={0.5}> </Cell>
          </TableRow>
          {prayers.map((p, i) => (
            <TableRow key={p.id} last={i === prayers.length - 1}>
              <Cell flex={2}>
                <div className="fth-prayer-cell">
                  <span className="fth-prayer-name">{p.name}</span>
                  <span className="fth-prayer-desc">{p.description}</span>
                </div>
              </Cell>
              <Cell flex={1.1}>
                <Pill variant={p.deity === creation?.anyDeity ? 'ghost' : 'brass'} size={10}>{p.deity}</Pill>
              </Cell>
              <Cell flex={1.2} textStyle={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: colors.ink3 }}>{p.range}</Cell>
              <Cell flex={1.1} textStyle={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: colors.ink3 }}>{p.duration}</Cell>
              <Cell flex={0.5} align="right">
                <Button
                  variant="ghost"
                  iconLeft={<Icon name="dice" size={13} color={colors.ink2} />}
                  onPress={() => pray(p)}
                >{''}</Button>
              </Cell>
            </TableRow>
          ))}
        </Table>
      </Card>
    </ScreenContainer>
  );
};
