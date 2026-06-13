import type * as React from 'react';
import { useState } from 'react';
import { ScreenContainer } from './ScreenContainer';
import { useConditions } from '@/hooks/useConditions';
import { useXp } from '@/hooks/useXp';
import { useDerived } from '@/hooks/useDerived';
import { useVitals } from '@/hooks/useVitals';
import { useCareer } from '@/hooks/useCareer';
import { useStoredState } from '@/hooks/useStoredState';
import { useCharacter, characterKey, type IdentityOverlay } from '@/hooks/useCharacter';
import { useSystemRules } from '@/content/useContent';
import { rollDice, diceLabel } from '@/utils/roll';
import { Hero } from '@/components/Hero';
import { Pill } from '@/components/Pill';
import { Button } from '@/components/Button';
import { Section } from '@/components/Section';
import { Card } from '@/components/Card';
import { Bar, SegBar } from '@/components/Bar';
import { Stepper } from '@/components/Stepper';
import { Chip } from '@/components/Chip';
import { Avatar } from '@/components/Avatar';
import { Icon } from '@/components/Icon';
import { EditSheet } from '@/components/EditSheet';
import { TextField, NumberField } from '@/components/Fields';
import { colors } from '@/theme';
import { Alert } from '@/ui/alert';
import './OverviewScreen.css';

interface IdentDraft {
  name: string;
  age: number;
  height: string;
  hair: string;
  eyes: string;
  motivation: string;
  ambitionsShort: string;
  ambitionsLong: string;
}

export const OverviewScreen: React.FC = () => {
  const { id, template: c } = useCharacter();
  const [, setIdentity] = useStoredState<IdentityOverlay>(characterKey(id, 'identity'), {});
  const [edit, setEdit] = useState<IdentDraft | null>(null);

  const openEdit = () => setEdit({
    name: c.name,
    age: c.age,
    height: c.height,
    hair: c.hair,
    eyes: c.eyes,
    motivation: c.motivation,
    ambitionsShort: c.ambitionsShort,
    ambitionsLong: c.ambitionsLong,
  });
  const saveEdit = () => {
    if (!edit || !edit.name.trim()) return;
    setIdentity(edit);
    setEdit(null);
  };
  const xp = useXp();
  const career = useCareer();
  const vitals = useVitals();
  const { conds, cycle, names } = useConditions();
  // All derived stats (max wounds, walk/run, corruption threshold) come from
  // the system formulas in the content packs, evaluated against the live
  // characteristics.
  const derived = useDerived();
  const { test } = useSystemRules();
  // Live wounds (for the segmented bar) — same key WoundsScreen writes to.
  const [wounds] = useStoredState(characterKey(id, 'wounds'), c.wounds.current);

  const xpTotal = xp.total;
  const corrThresh = derived.corruptionThreshold;
  const woundsMax = derived.maxWounds;

  return (
    <ScreenContainer>
      <Hero
        eyebrow={`${c.party.name} · Career ${career.level}/${career.ranks.length || 4}`}
        italic
        title={c.name}
        trailingTitle={
          <>
            <Pill variant="empire">{career.name}</Pill>
            <Pill variant="brass">{career.status}</Pill>
          </>
        }
        subRow={
          <>
            <span className="ovw-sub-text">{c.species}, age {c.age}</span>
            <span className="ovw-sub-sep">·</span>
            <span className="ovw-sub-text">{c.height}</span>
            <span className="ovw-sub-sep">·</span>
            <span className="ovw-sub-text">{c.hair} hair, {c.eyes} eyes</span>
            <span className="ovw-sub-sep">·</span>
            <span className="ovw-sub-text ovw-sub-motivation">
              "{c.motivation}"
            </span>
          </>
        }
        actions={
          <>
            <Button
              iconLeft={<Icon name="quill" size={13} color={colors.ink2} />}
              onPress={openEdit}
            >
              Edit
            </Button>
            <Button
              variant="primary"
              iconLeft={<Icon name="dice" size={13} color={colors.ivory} />}
              onPress={() => {
                const roll = rollDice(test.dice);
                Alert.alert('Test Roll', `${diceLabel(test.dice)} → ${roll}`);
              }}
            >
              Roll Test
            </Button>
          </>
        }
      />

      <Section title="Vitals" aside="round 4 · scene 2" />

      <div className="ovw-vitals-grid">
        <Card bordered style={{ flexGrow: 1, minWidth: 280, flexBasis: '40%' }}>
          <div className="ovw-row-between">
            <div>
              <span className="ovw-label ovw-label--empire">Wounds</span>
            </div>
            <span className="ovw-big-empire tabular">
              {wounds}
              <span className="ovw-big-frac">/{woundsMax}</span>
            </span>
          </div>
          <SegBar total={woundsMax} filled={wounds} />
          <div className="ovw-row-between ovw-mt8">
            <span className="ovw-meta-mono">0 · CRITICAL</span>
            <span className="ovw-meta-mono">{woundsMax} · FULL</span>
          </div>
        </Card>

        <Card style={{ flexGrow: 1, minWidth: 280, flexBasis: '28%' }}>
          <div className="ovw-row-between">
            <span className="ovw-label ovw-label--brass">Fate &amp; Fortune</span>
            <button type="button" className="btn-reset ovw-refresh-link" onClick={vitals.refreshFortune}>
              ↻ new session
            </button>
          </div>
          <div className="ovw-stepper-row">
            <div>
              <span className="ovw-sub-upper">Fortune</span>
              <span className="ovw-big-brass tabular">
                {vitals.fortune}<span className="ovw-big-cap">/{vitals.fate}</span>
              </span>
            </div>
            <div className="ovw-spacer" />
            <Stepper value={vitals.fortune} min={0} max={vitals.fate} onChange={vitals.setFortune} />
          </div>
          <div className="ovw-divider-line" />
          <div className="ovw-row-between">
            <span className="ovw-sub-upper">Fate · burn to cheat death</span>
            <Stepper value={vitals.fate} min={0} max={20} onChange={vitals.setFate} />
          </div>
        </Card>

        <Card style={{ flexGrow: 1, minWidth: 280, flexBasis: '28%' }}>
          <div className="ovw-row-between">
            <span className="ovw-label">Soul</span>
            <button type="button" className="btn-reset ovw-refresh-link" onClick={vitals.refreshResolve}>
              ↻ on motivation
            </button>
          </div>
          <div className="ovw-stepper-row">
            <div>
              <span className="ovw-sub-upper">Resolve</span>
              <span className="ovw-medium tabular">
                {vitals.resolve}<span className="ovw-big-cap">/{vitals.resilience}</span>
              </span>
            </div>
            <div className="ovw-spacer" />
            <Stepper value={vitals.resolve} min={0} max={vitals.resilience} onChange={vitals.setResolve} />
          </div>
          <div className="ovw-row-between ovw-mt10">
            <span className="ovw-sub-upper">Resilience</span>
            <Stepper value={vitals.resilience} min={0} max={20} onChange={vitals.setResilience} />
          </div>
          <div className="ovw-divider-line" />
          <div className="ovw-row-between">
            <span className="ovw-sub-upper ovw-sub-upper--corr">
              Corruption {vitals.corruption}/{corrThresh}
            </span>
            <Stepper value={vitals.corruption} min={0} max={99} onChange={vitals.setCorruption} />
          </div>
          <Bar value={corrThresh > 0 ? Math.min(1, vitals.corruption / corrThresh) : 0} variant="corr" style={{ marginTop: 10 }} />
        </Card>
      </div>

      <div className="ovw-two-col ovw-mt12">
        <Card tight style={{ flex: 1 }}>
          <div className="ovw-row-between">
            <span className="ovw-label">Movement</span>
            <span className="ovw-meta-mono ovw-meta-mono--10">M {c.movement}</span>
          </div>
          <div className="ovw-move-row">
            <MoveCell label="Walk" v={derived.walk} />
            <div className="ovw-vr" />
            <MoveCell label="Run" v={derived.run} />
            {'SB' in derived.vars ? (
              <>
                <div className="ovw-vr" />
                <MoveCell label="SB" v={derived.vars.SB} />
              </>
            ) : null}
            {'TB' in derived.vars ? (
              <>
                <div className="ovw-vr" />
                <MoveCell label="TB" v={derived.vars.TB} />
              </>
            ) : null}
          </div>
        </Card>

        <Card tight style={{ flex: 1 }}>
          <div className="ovw-row-between">
            <span className="ovw-label">Experience</span>
            <span className="ovw-meta-mono ovw-meta-mono--10">{xpTotal} TOTAL</span>
          </div>
          <div className="ovw-xp-row">
            <span className="ovw-xp-big tabular">{xp.current}</span>
            <span className="ovw-muted">spendable</span>
            <div className="ovw-spacer" />
            <span className="ovw-muted">{xp.spent} spent</span>
          </div>
          <Bar value={xpTotal === 0 ? 0 : xp.spent / xpTotal} variant="brass" style={{ marginTop: 10 }} />
        </Card>
      </div>

      <Section title="Current Conditions" aside="tap to apply · long-press for rule" />
      <div className="ovw-chips">
        {names.map(t => {
          const n = conds[t] ?? 0;
          return <Chip key={t} label={t} count={n} on={n > 0} onPress={() => cycle(t)} />;
        })}
      </div>

      <Section title="Party" aside={c.party.name} />
      <Card>
        <p className="ovw-party">
          <span className="ovw-party-drop">{c.party.short[0]}</span>
          {c.party.short.slice(1)}
        </p>
        <div className="ovw-party-grid">
          {c.party.members.map(m => (
            <div key={m.name} className="ovw-party-member">
              <Avatar
                initials={m.name.split(' ').map(s => s[0]).join('')}
                size={32}
                fontSize={13}
              />
              <div className="ovw-party-meta">
                <span className="ovw-party-name">{m.name}</span>
                <span className="ovw-party-role">{m.role}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <EditSheet
        visible={!!edit}
        title="Edit character"
        subtitle="Name, description, and ambitions. Stats, skills, and gear are edited on their own screens."
        onClose={() => setEdit(null)}
        onSave={saveEdit}
        saveDisabled={!edit?.name.trim()}
      >
        {edit ? (
          <>
            <TextField
              label="Name"
              value={edit.name}
              onChangeText={t => setEdit(s => s && { ...s, name: t })}
              placeholder="Character name"
              autoCapitalize="words"
            />
            <NumberField
              label="Age"
              value={edit.age}
              onChangeNumber={n => setEdit(s => s && { ...s, age: n })}
              min={0}
              max={9999}
            />
            <TextField
              label="Height"
              value={edit.height}
              onChangeText={t => setEdit(s => s && { ...s, height: t })}
              placeholder="e.g. 183 cm"
            />
            <TextField
              label="Hair"
              value={edit.hair}
              onChangeText={t => setEdit(s => s && { ...s, hair: t })}
              placeholder="e.g. Chestnut"
            />
            <TextField
              label="Eyes"
              value={edit.eyes}
              onChangeText={t => setEdit(s => s && { ...s, eyes: t })}
              placeholder="e.g. Grey"
            />
            <TextField
              label="Motivation"
              value={edit.motivation}
              onChangeText={t => setEdit(s => s && { ...s, motivation: t })}
              placeholder="What drives them"
              multiline
              numberOfLines={2}
            />
            <TextField
              label="Short-term ambition"
              value={edit.ambitionsShort}
              onChangeText={t => setEdit(s => s && { ...s, ambitionsShort: t })}
              placeholder="A near-term goal"
              multiline
              numberOfLines={2}
            />
            <TextField
              label="Long-term ambition"
              value={edit.ambitionsLong}
              onChangeText={t => setEdit(s => s && { ...s, ambitionsLong: t })}
              placeholder="A life goal"
              multiline
              numberOfLines={2}
            />
          </>
        ) : null}
      </EditSheet>
    </ScreenContainer>
  );
};

const MoveCell: React.FC<{ label: string; v: number }> = ({ label, v }) => (
  <div>
    <span className="ovw-move-label">{label}</span>
    <span className="ovw-move-value tabular">{v}</span>
  </div>
);
