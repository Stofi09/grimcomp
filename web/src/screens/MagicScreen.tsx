import type * as React from 'react';
import { ScreenContainer } from './ScreenContainer';
import { useCharacter, characterKey } from '@/hooks/useCharacter';
import { useStoredState } from '@/hooks/useStoredState';
import { useCharacteristics } from '@/hooks/useCharacteristics';
import { useConditions } from '@/hooks/useConditions';
import { resolveTest, outcomeLabel, formatTestResult, isDouble } from '@/utils/roll';
import { resolveCast } from '@/utils/magic';
import { useResolveSpells, useTable, useSystemRules, useCreation, useCapabilities } from '@/content/useContent';
import { rollOnTable, rollForTable } from '@/content/tables';
import type { Spell } from '@/content/types';
import { Alert } from '@/ui/alertStore';
import { Hero } from '@/components/Hero';
import { Section } from '@/components/Section';
import { Card, CardHead } from '@/components/Card';
import { Pill } from '@/components/Pill';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Table, TableRow, Cell } from '@/components/Table';
import { Counter } from '@/components/Counter';
import { colors } from '@/theme';
import './MagicScreen.css';

export const MagicScreen: React.FC = () => {
  const { id, template: c } = useCharacter();
  const { list: chars } = useCharacteristics();
  const { modifier: condMod } = useConditions();
  const system = useSystemRules();
  const magic = system.magic;
  const caps = useCapabilities();
  const creation = useCreation();

  // Channelling pool — SL accumulated from successful Channelling tests.
  // Each casting attempt may add the pool's SL to the cast SL. Cleared on
  // cast or miscast.
  const [pool, setPool] = useStoredState(characterKey(id, 'magic.pool'), 0);
  // Skill purchases live in an overlay separate from the immutable character
  // template. Read the same map as SkillsScreen so casting targets update as
  // soon as Language (Magick) or Channelling advances are bought.
  const [skillAdvances] = useStoredState<Record<string, number>>(
    characterKey(id, 'skills.adv'),
    Object.fromEntries(c.skills.map(skill => [skill.name, skill.adv])),
  );

  // Content hooks must run before the early return below.
  const spells = useResolveSpells(c.knownSpells ?? []);
  const miscastMinor = useTable(magic.minorMiscastTable);
  const miscastMajor = useTable(magic.majorMiscastTable);

  // A double on a channel/cast roll triggers a miscast — only when the system
  // models doubles AND the magicMiscastOnDouble capability is on. Both channel()
  // and cast() route through this, so one gate covers every miscast path.
  const miscastDouble = (roll: number): boolean =>
    caps.magicMiscastOnDouble && !!system.test.doubles && isDouble(roll);

  if (!c.isCaster) {
    return (
      <ScreenContainer>
        <Hero
          title="Magic"
          subRow={<span className="mag-sub">{c.name} is not a spellcaster — this screen is for reference only.</span>}
        />
        <Card style={{ alignItems: 'center', paddingLeft: 20, paddingRight: 20, paddingTop: 48, paddingBottom: 48, marginTop: 24 }}>
          <Icon name="sparkle" size={28} color={colors.ink3} />
          <span className="mag-empty-title">No spells</span>
          <span className="mag-empty-body">
            The Magic page activates when the character has spellcasting (e.g. Apprentice Wizard or Wizard career).
            Use the Reference page to browse magic rules, or create a Wizard archetype on the New Character screen.
          </span>
        </Card>
      </ScreenContainer>
    );
  }

  const channelCh = chars.find(x => x.key === magic.channelChar);
  const castCh = chars.find(x => x.key === magic.castChar);

  // Test targets for the active character. Any skill named with the configured
  // prefix ("Channelling (<Lore>)") is the channelling skill; the cast skill is
  // matched by its exact configured name.
  const channelSkill = c.skills.find(s => s.name.startsWith(magic.channellingSkillPrefix));
  const channelSkillName = channelSkill?.name
    ?? Object.keys(skillAdvances).find(name => name.startsWith(magic.channellingSkillPrefix));
  const langSkill = c.skills.find(s => s.name === magic.castSkill);
  const channelAdvance = channelSkillName
    ? (skillAdvances[channelSkillName] ?? channelSkill?.adv ?? 0)
    : 0;
  const castAdvance = skillAdvances[magic.castSkill] ?? langSkill?.adv ?? 0;
  const hasCastSkill = langSkill !== undefined
    || Object.prototype.hasOwnProperty.call(skillAdvances, magic.castSkill);
  const channelTarget = (channelCh?.current ?? 0) + channelAdvance;
  const castTarget = (castCh?.current ?? 0) + castAdvance;

  const channel = () => {
    const r = resolveTest({ target: channelTarget, modifier: condMod.total, label: 'Channelling' }, system.test);

    if (miscastDouble(r.roll)) {
      // A double while channelling is a Miscast. A successful (Critical) channel
      // is a Minor Miscast that still banks its SL; a failed double is a fumble →
      // Major Miscast and the pool is lost.
      const mRoll = rollForTable(r.success ? miscastMinor : miscastMajor);
      if (r.success) {
        const slGain = Math.max(0, r.sl);
        const newPool = pool + slGain;
        setPool(newPool);
        Alert.alert(
          'Channelling — Minor Miscast',
          `${formatTestResult(r)}\n\nMISCAST (${mRoll}):\n${rollOnTable(miscastMinor, mRoll)}\n\nPool still gained ${slGain} SL → ${newPool} total.`,
        );
      } else {
        setPool(0);
        Alert.alert(
          'Channelling — Major Miscast',
          `${formatTestResult(r)}\n\nMISCAST (${mRoll}):\n${rollOnTable(miscastMajor, mRoll)}\n\nChannelling pool lost.`,
        );
      }
      return;
    }

    const slGain = Math.max(0, r.sl);
    const newPool = pool + slGain;
    if (r.success) setPool(newPool);
    Alert.alert(
      `Channelling — ${outcomeLabel(r.outcome)}`,
      `${formatTestResult(r)}\n\n${
        r.success
          ? `Pool gained ${slGain} SL → ${newPool} total. Spend on your next cast.`
          : 'No SL added. The Aethyr resists.'
      }`,
    );
  };

  const cast = (spell: Spell) => {
    const r = resolveTest({ target: castTarget, modifier: condMod.total, label: `Cast ${spell.name}` }, system.test);
    // Total SL = casting-test SL + banked Channelling SL, vs the spell's CN.
    // A fumbled casting test never casts, however large the pool.
    const oc = resolveCast(r.sl, pool, spell.cn, r.outcome === 'fumble');
    const usedPool = pool;
    setPool(0); // Channelled power is spent on the attempt regardless of outcome.

    const resolveLine = `${spell.description}${spell.damage ? `\nDamage: ${spell.damage}` : ''}`;
    // Surplus SL over the CN fuels Overcasting (CRB p.239) — one effect per 2 SL.
    const overcastLine = oc.overcasts > 0
      ? `\n\nOvercast: +${oc.surplus} SL over CN → up to ${oc.overcasts} effect${oc.overcasts === 1 ? '' : 's'} (each 2 SL: +1 Target, +1× Range, or +1× Duration).`
      : oc.cast && oc.surplus > 0
        ? `\n\nSurplus +${oc.surplus} SL (2 needed to Overcast).`
        : '';

    let body = `${formatTestResult(r)}\n\nChannelling pool used: +${usedPool} SL\nTotal SL: ${oc.totalSl}  ·  CN ${spell.cn}\n\n`;

    // A double on the casting roll is a Miscast (WFRP 4e), whether or not the
    // spell goes off — not merely a fumble (96–00).
    if (miscastDouble(r.roll)) {
      const mRoll = rollForTable(miscastMinor);
      body += `MISCAST (${mRoll}):\n${rollOnTable(miscastMinor, mRoll)}`;
      if (oc.cast) body += `\n\n…the spell still resolves: ${resolveLine}${overcastLine}`;
    } else if (oc.cast) {
      body += `→ ${spell.name} resolves!\n${resolveLine}${overcastLine}`;
    } else {
      body += `→ Not enough SL — spell fizzles. The energy disperses harmlessly.`;
    }

    const resolution = oc.cast ? 'CAST' : 'FIZZLE';
    const miscast = miscastDouble(r.roll) ? ' · MISCAST' : '';
    Alert.alert(`${spell.name} — ${resolution}${miscast}`, body);
  };

  return (
    <ScreenContainer>
      <Hero
        title="Magic"
        subRow={
          <>
            <span className="mag-sub">{c.name} · {c.spellLore ?? 'Wizard'}</span>
            <span className="mag-sep">·</span>
            <span className="mag-sub">{spells.length} spells known</span>
            <span className="mag-sep">·</span>
            <span className="mag-sub">{magic.castSkill} {hasCastSkill ? `+${castAdvance}` : '—'}</span>
          </>
        }
      />

      <div className="mag-pool-row">
        <Counter
          label="Channelling pool"
          sub="banked SL for next cast"
          value={pool}
          variant="fate"
          style={{ flex: 1 }}
        />
        <Card style={{ flex: 1 }}>
          <span className="mag-card-label">Channel the Aethyr</span>
          <span className="mag-body">
            Test Channelling (target {channelTarget}). Successful SL stack into the pool until you cast or miscast.
          </span>
          <div className="mag-actions">
            <Button
              variant="brass"
              iconLeft={<Icon name="dice" size={13} color="#2a2010" />}
              onPress={channel}
            >
              Channel
            </Button>
            <Button
              variant="ghost"
              onPress={() => setPool(0)}
              disabled={pool === 0}
            >
              Release pool
            </Button>
          </div>
        </Card>
      </div>

      <Section
        title="Known spells"
        aside={channelCh ? `${channelCh.short} ${channelCh.current} · ${channelCh.short}B ${channelCh.bonus}` : undefined}
      />
      <Card flush>
        <CardHead title="Spells" meta={c.spellLore?.toLowerCase() ?? 'lore'} />
        <Table>
          <TableRow header>
            <Cell header flex={2}>Name</Cell>
            <Cell header flex={1}>Lore</Cell>
            <Cell header num flex={0.6}>CN</Cell>
            <Cell header flex={1.2}>Range</Cell>
            <Cell header flex={1.1}>Duration</Cell>
            <Cell header flex={0.5}> </Cell>
          </TableRow>
          {spells.map((s, i) => (
            <TableRow key={s.id} last={i === spells.length - 1}>
              <Cell flex={2}>
                <div className="mag-spell-cell">
                  <span className="mag-spell-name">{s.name}</span>
                  <span className="mag-spell-desc">{s.description}</span>
                </div>
              </Cell>
              <Cell flex={1}>
                <Pill variant={s.lore === creation?.pettyLore ? 'ghost' : 'empire'} size={10}>{s.lore}</Pill>
              </Cell>
              <Cell
                num
                flex={0.6}
                textStyle={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: s.cn >= 8 ? colors.empire : colors.ink, fontVariantNumeric: 'tabular-nums' }}
              >{s.cn}</Cell>
              <Cell flex={1.2} textStyle={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: colors.ink3 }}>{s.range}</Cell>
              <Cell flex={1.1} textStyle={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: colors.ink3 }}>{s.duration}</Cell>
              <Cell flex={0.5} align="right">
                <Button
                  variant="ghost"
                  ariaLabel={`Cast ${s.name}`}
                  iconLeft={<Icon name="dice" size={13} color={colors.ink2} />}
                  onPress={() => cast(s)}
                >{''}</Button>
              </Cell>
            </TableRow>
          ))}
        </Table>
      </Card>
    </ScreenContainer>
  );
};
