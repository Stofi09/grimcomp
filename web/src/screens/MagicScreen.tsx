import { useReportTest } from '@/hooks/useRecordTest';
import * as React from 'react';
import { ScreenContainer } from './ScreenContainer';
import { useCharacter, characterKey } from '@/hooks/useCharacter';
import { useStoredState } from '@/hooks/useStoredState';
import { useCharacteristics } from '@/hooks/useCharacteristics';
import { useConditions } from '@/hooks/useConditions';
import { resolveTest, formatTestResult, isDouble, resultLabel } from '@/utils/roll';
import { resolveCast } from '@/utils/magic';
import { useContent, useTable, useSystemRules, useCreation, useCapabilities } from '@/content/useContent';
import { rollOnTable, rollForTable } from '@/content/tables';
import type { Spell } from '@/content/types';
import {
  EMPTY_SPELLBOOK_OVERLAY,
  normalizeSpellbookOverlay,
  resolveSpellbookIds,
  setSpellbookSelection,
  type SpellbookOverlay,
} from '@/utils/spellbook';
import { formatSpellCn, spellRulesStatusLabel, spellRulesStatusMeta, spellSourceLabel } from '@/utils/spells';
import { Alert } from '@/ui/alertStore';
import { Hero } from '@/components/Hero';
import { Section } from '@/components/Section';
import { Card, CardHead } from '@/components/Card';
import { Pill } from '@/components/Pill';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Table, TableRow, Cell } from '@/components/Table';
import { Counter } from '@/components/Counter';
import { EditSheet } from '@/components/EditSheet';
import { TextField } from '@/components/Fields';
import { colors } from '@/theme';
import './MagicScreen.css';

interface SpellbookManagerProps {
  allSpells: Spell[];
  templateIds: readonly string[];
  overlay: SpellbookOverlay;
  onChange: (next: SpellbookOverlay) => void;
  onClose: () => void;
}

const SpellbookManager: React.FC<SpellbookManagerProps> = ({
  allSpells,
  templateIds,
  overlay,
  onChange,
  onClose,
}) => {
  const [query, setQuery] = React.useState('');
  const [lore, setLore] = React.useState<string>('All');
  const [draft, setDraft] = React.useState<SpellbookOverlay>(
    () => normalizeSpellbookOverlay(overlay),
  );

  const selectedIds = resolveSpellbookIds(templateIds, draft);
  const selected = new Set(selectedIds);
  const lores = [...new Set(allSpells.map(spell => spell.lore))]
    .sort((a, b) => a.localeCompare(b));
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = allSpells
    .filter(spell => lore === 'All' || spell.lore === lore)
    .filter(spell => !normalizedQuery || [
      spell.name,
      spell.lore,
      spell.description,
      spell.sourceBook,
      spell.rulesNote,
      spellRulesStatusLabel(spell),
    ].filter(Boolean).join(' ').toLocaleLowerCase().includes(normalizedQuery))
    .sort((a, b) => a.lore.localeCompare(b.lore) || a.name.localeCompare(b.name));
  const loadedIds = new Set(allSpells.map(spell => spell.id));
  const selectedLoadedCount = selectedIds.filter(id => loadedIds.has(id)).length;

  return (
    <EditSheet
      visible
      title="Manage spellbook"
      subtitle={`${selectedLoadedCount} selected of ${allSpells.length} loaded spells. Changes apply when you choose Done.`}
      onClose={onClose}
      onSave={() => {
        onChange(draft);
        onClose();
      }}
      saveLabel="Done"
      destructive={{
        label: 'Reset to template',
        onPress: () => setDraft(EMPTY_SPELLBOOK_OVERLAY),
      }}
    >
      <TextField
        label="Search spells"
        value={query}
        onChangeText={setQuery}
        placeholder="name, lore, rule text, or source"
        autoCapitalize="none"
      />

      <div className="mag-spellbook-lores" role="group" aria-label="Filter spells by lore">
        {['All', ...lores].map(candidate => (
          <button
            key={candidate}
            type="button"
            className={`btn-reset mag-spellbook-lore${lore === candidate ? ' mag-spellbook-lore--active' : ''}`}
            aria-pressed={lore === candidate}
            onClick={() => setLore(candidate)}
          >
            {candidate}
          </button>
        ))}
      </div>

      <div className="mag-spellbook-list" role="list" aria-label="Loaded spells">
        {filtered.map(spell => {
          const isSelected = selected.has(spell.id);
          const source = spellSourceLabel(spell);
          const status = spellRulesStatusMeta(spell);
          return (
            <div className="mag-spellbook-row" role="listitem" key={spell.id}>
              <div className="mag-spellbook-info">
                <span className="mag-spellbook-name">{spell.name}</span>
                <span className="mag-spellbook-meta">
                  {[spell.lore, `CN ${formatSpellCn(spell)}`, spell.cn === null ? 'See source' : '', status, source].filter(Boolean).join(' · ')}
                </span>
              </div>
              <button
                type="button"
                className={`btn-reset mag-spellbook-toggle${isSelected ? ' mag-spellbook-toggle--selected' : ''}`}
                aria-label={`${isSelected ? 'Remove' : 'Add'} ${spell.name} ${isSelected ? 'from' : 'to'} spellbook`}
                aria-pressed={isSelected}
                onClick={() => setDraft(current => setSpellbookSelection(
                  templateIds,
                  current,
                  spell.id,
                  !isSelected,
                ))}
              >
                <Icon name={isSelected ? 'minus' : 'plus'} size={12} color={isSelected ? colors.empire : colors.ink2} />
                <span>{isSelected ? 'Remove' : 'Add'}</span>
              </button>
            </div>
          );
        })}
        {filtered.length === 0 ? (
          <span className="mag-spellbook-empty">No loaded spells match this search.</span>
        ) : null}
      </div>
    </EditSheet>
  );
};

export const MagicScreen: React.FC = () => {
  const { id, template: c } = useCharacter();
  const reportTest = useReportTest();
  const content = useContent();
  const { list: chars } = useCharacteristics();
  const { modifier: condMod } = useConditions();
  const system = useSystemRules();
  const magic = system.magic;
  const caps = useCapabilities();
  const creation = useCreation();
  const windsOfMagicLoaded = content.packs.some(pack => pack.id === 'winds-of-magic');

  // Channelling pool — SL accumulated from successful Channelling tests.
  // Each casting attempt may add the pool's SL to the cast SL. Cleared on
  // cast or miscast.
  const [pool, setPool] = useStoredState(characterKey(id, 'magic.pool'), 0);
  const poolActionRef = React.useRef(false);
  const [poolActionPending, setPoolActionPending] = React.useState(false);
  // Store only the character's additions/removals over the immutable template.
  // Template spells remain defaults and newly shipped defaults are not masked
  // by an older, fully copied spell list.
  const [storedSpellbookOverlay, setStoredSpellbookOverlay] = useStoredState<unknown>(
    characterKey(id, 'magic.spellbook'),
    EMPTY_SPELLBOOK_OVERLAY,
  );
  const spellbookOverlay = normalizeSpellbookOverlay(storedSpellbookOverlay);
  const [spellbookOpen, setSpellbookOpen] = React.useState(false);
  // Skill purchases live in an overlay separate from the immutable character
  // template. Read the same map as SkillsScreen so casting targets update as
  // soon as Language (Magick) or Channelling advances are bought.
  const [skillAdvances] = useStoredState<Record<string, number>>(
    characterKey(id, 'skills.adv'),
    Object.fromEntries(c.skills.map(skill => [skill.name, skill.adv])),
  );

  // Content hooks must run before the early return below.
  const templateSpellIds = c.knownSpells ?? [];
  const effectiveSpellIds = resolveSpellbookIds(templateSpellIds, spellbookOverlay);
  const spells = content.resolveSpells(effectiveSpellIds);
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

  const channel = async () => {
    if (poolActionRef.current) return;
    poolActionRef.current = true;
    setPoolActionPending(true);
    try {
      const r = resolveTest({ target: channelTarget, modifier: condMod.total, label: 'Channelling' }, system.test);

      if (miscastDouble(r.roll)) {
        // A double while channelling is a Miscast. A successful (Critical) channel
        // is a Minor Miscast that still banks its SL; a failed double is a fumble →
        // Major Miscast and the pool is lost.
        const mRoll = rollForTable(r.success ? miscastMinor : miscastMajor);
        if (r.success) {
          const slGain = Math.max(0, r.sl);
          const newPool = pool + slGain;
          const durability = await setPool(newPool).completion;
          if (!durability.ok) {
            Alert.alert('Could not save Channelling', `The roll was discarded because the pool change could not be saved. ${durability.error.message}`);
            return;
          }
          reportTest(r,
            'Channelling — Minor Miscast',
            `${formatTestResult(r)}\n\nMISCAST (${mRoll}):\n${rollOnTable(miscastMinor, mRoll)}\n\nPool still gained ${slGain} SL → ${newPool} total.`,
          );
        } else {
          const durability = await setPool(0).completion;
          if (!durability.ok) {
            Alert.alert('Could not save Channelling', `The roll was discarded because the pool change could not be saved. ${durability.error.message}`);
            return;
          }
          reportTest(r,
            'Channelling — Major Miscast',
            `${formatTestResult(r)}\n\nMISCAST (${mRoll}):\n${rollOnTable(miscastMajor, mRoll)}\n\nChannelling pool lost.`,
          );
        }
        return;
      }

      const slGain = Math.max(0, r.sl);
      const newPool = pool + slGain;
      if (r.success) {
        const durability = await setPool(newPool).completion;
        if (!durability.ok) {
          Alert.alert('Could not save Channelling', `The roll was discarded because the pool change could not be saved. ${durability.error.message}`);
          return;
        }
      }
      reportTest(r,
        `Channelling — ${resultLabel(r)}`,
        `${formatTestResult(r)}\n\n${
          r.success
            ? `Pool gained ${slGain} SL → ${newPool} total. Spend on your next cast.`
            : 'No SL added. The Aethyr resists.'
        }`,
      );
    } finally {
      poolActionRef.current = false;
      setPoolActionPending(false);
    }
  };

  const cast = async (spell: Spell) => {
    if (spell.cn === null) {
      const source = spellSourceLabel(spell);
      Alert.alert(
        `${spell.name} — Casting Number unknown`,
        `Look up the Casting Number in ${source || 'the source'} before using automated casting.`,
      );
      return;
    }
    if (poolActionRef.current) return;
    poolActionRef.current = true;
    setPoolActionPending(true);
    try {
      const r = resolveTest({ target: castTarget, modifier: condMod.total, label: `Cast ${spell.name}` }, system.test);
      // Core-procedure automation: a passed casting test must also meet the CN
      // after banked Channelling SL is added. Winds of Magic revises this
      // procedure, which remains a manual supplement lookup in this app.
      const oc = resolveCast(r.sl, pool, spell.cn, r.success);
      const usedPool = pool;
      const durability = await setPool(0).completion;
      if (!durability.ok) {
        Alert.alert(
          'Could not cast spell',
          `The casting result was discarded because the Channelling pool could not be saved. ${durability.error.message}`,
        );
        return;
      }

      const source = spellSourceLabel(spell);
      const status = spellRulesStatusLabel(spell);
      const description = spell.rulesStatus === 'bibliographic' ? '' : spell.description;
      const resolveLine = [
        status ? `Rules status: ${status}` : '',
        description,
        spell.damage ? `Damage: ${spell.damage}` : '',
        spell.rulesNote?.trim() ? `Rules note: ${spell.rulesNote.trim()}` : '',
        source ? `Source: ${source}` : '',
      ].filter(Boolean).join('\n');
      const indexedResolution = `Casting threshold reached — resolve ${spell.name} from its source.`;
      // Core Rulebook automation: surplus SL over the CN fuels Overcasting.
      const overcastLine = oc.overcasts > 0
        ? `\n\nCore Overcast: +${oc.surplus} SL over CN → up to ${oc.overcasts} effect${oc.overcasts === 1 ? '' : 's'} (each 2 SL: +1 Target, +1× Range, or +1× Duration).`
        : oc.cast && oc.surplus > 0
          ? `\n\nCore-procedure surplus: +${oc.surplus} SL (2 needed to Overcast).`
          : '';

      const procedureNote = windsOfMagicLoaded
        ? `\n\nAutomation uses the Core Rulebook casting procedure. Resolve Winds of Magic's revised Channelling and Overcasting from the supplement.`
        : '';

      let body = `${formatTestResult(r)}\n\nChannelling pool used: +${usedPool} SL\nTotal SL: ${oc.totalSl}  ·  CN ${spell.cn}\n\n`;

      // A double on the casting roll is a Miscast (WFRP 4e), whether or not the
      // spell goes off — not merely a fumble (96–00).
      if (miscastDouble(r.roll)) {
        const mRoll = rollForTable(miscastMinor);
        body += `MISCAST (${mRoll}):\n${rollOnTable(miscastMinor, mRoll)}`;
        if (oc.cast) {
          body += spell.rulesStatus === 'bibliographic'
            ? `\n\n${indexedResolution}\n${resolveLine}${overcastLine}`
            : `\n\n…the spell still resolves: ${resolveLine}${overcastLine}`;
        }
      } else if (oc.cast) {
        body += spell.rulesStatus === 'bibliographic'
          ? `→ ${indexedResolution}\n${resolveLine}${overcastLine}`
          : `→ ${spell.name} resolves!\n${resolveLine}${overcastLine}`;
      } else {
        body += r.success
          ? `→ Not enough SL — spell fizzles. The energy disperses harmlessly.`
          : `→ Casting test failed — spell fizzles. The energy disperses harmlessly.`;
      }

      body += procedureNote;

      const resolution = oc.cast
        ? spell.rulesStatus === 'bibliographic' ? 'THRESHOLD' : 'CAST'
        : 'FIZZLE';
      const miscast = miscastDouble(r.roll) ? ' · MISCAST' : '';
      reportTest(r, `${spell.name} — ${resolution}${miscast}`, body);
    } finally {
      poolActionRef.current = false;
      setPoolActionPending(false);
    }
  };

  const releasePool = async () => {
    if (poolActionRef.current || pool === 0) return;
    poolActionRef.current = true;
    setPoolActionPending(true);
    try {
      const durability = await setPool(0).completion;
      if (!durability.ok) Alert.alert('Could not release pool', durability.error.message);
    } finally {
      poolActionRef.current = false;
      setPoolActionPending(false);
    }
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
        actions={
          <Button
            variant="ghost"
            iconLeft={<Icon name="book" size={13} color={colors.ink} />}
            onPress={() => setSpellbookOpen(true)}
          >
            Manage spellbook
          </Button>
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
          {windsOfMagicLoaded ? (
            <span className="mag-rules-disclosure" role="note">
              Automation uses the Core Rulebook casting procedure. Resolve Winds of Magic’s revised Channelling and Overcasting from the supplement.
            </span>
          ) : null}
          <div className="mag-actions">
            <Button
              variant="brass"
              iconLeft={<Icon name="dice" size={13} color="#2a2010" />}
              onPress={channel}
              disabled={poolActionPending}
            >
              Channel
            </Button>
            <Button
              variant="ghost"
              onPress={releasePool}
              disabled={pool === 0 || poolActionPending}
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
                  {spellRulesStatusLabel(s) ? (
                    <span className="mag-spell-status">{spellRulesStatusLabel(s)}</span>
                  ) : null}
                  {s.rulesStatus !== 'bibliographic' ? (
                    <span className="mag-spell-desc">{s.description}</span>
                  ) : null}
                  {s.rulesNote?.trim() ? (
                    <span className="mag-spell-note">Rules note: {s.rulesNote.trim()}</span>
                  ) : null}
                  {spellSourceLabel(s) ? (
                    <span className="mag-spell-source">{spellSourceLabel(s)}</span>
                  ) : null}
                </div>
              </Cell>
              <Cell flex={1}>
                <Pill variant={s.lore === creation?.pettyLore ? 'ghost' : 'empire'} size={10}>{s.lore}</Pill>
              </Cell>
              <Cell
                num
                flex={0.6}
                textStyle={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: s.cn !== null && s.cn >= 8 ? colors.empire : colors.ink, fontVariantNumeric: 'tabular-nums' }}
              >{formatSpellCn(s)}</Cell>
              <Cell flex={1.2} textStyle={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: colors.ink3 }}>{s.range}</Cell>
              <Cell flex={1.1} textStyle={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: colors.ink3 }}>{s.duration}</Cell>
              <Cell flex={0.5} align="right">
                <Button
                  variant="ghost"
                  ariaLabel={s.cn === null ? `See source for ${s.name}` : `Cast ${s.name}`}
                  iconLeft={<Icon name={s.cn === null ? 'book' : 'dice'} size={13} color={colors.ink2} />}
                  onPress={() => cast(s)}
                  disabled={poolActionPending}
                >{s.cn === null ? 'See source' : ''}</Button>
              </Cell>
            </TableRow>
          ))}
          {spells.length === 0 ? (
            <TableRow last>
              <Cell flex={1} textStyle={{ color: colors.ink3, fontStyle: 'italic' }}>
                No spells selected. Use Manage spellbook to add one.
              </Cell>
            </TableRow>
          ) : null}
        </Table>
      </Card>

      {spellbookOpen ? (
        <SpellbookManager
          allSpells={content.allSpells}
          templateIds={templateSpellIds}
          overlay={spellbookOverlay}
          onChange={next => setStoredSpellbookOverlay(normalizeSpellbookOverlay(next))}
          onClose={() => setSpellbookOpen(false)}
        />
      ) : null}
    </ScreenContainer>
  );
};
