import * as React from 'react';
import { ScreenContainer } from './ScreenContainer';
import { useTalents } from '@/hooks/useTalents';
import { useCharacteristics } from '@/hooks/useCharacteristics';
import { useXp } from '@/hooks/useXp';
import { characterKey, useCharacter } from '@/hooks/useCharacter';
import { useStoredState } from '@/hooks/useStoredState';
import { useCareers, useXpRules, useTalentDefs } from '@/content/useContent';
import { talentMaxRank } from '@/utils/advancement';
import { Hero } from '@/components/Hero';
import { Section } from '@/components/Section';
import { Card } from '@/components/Card';
import { Pill } from '@/components/Pill';
import { Stepper } from '@/components/Stepper';
import { Icon } from '@/components/Icon';
import { EditSheet } from '@/components/EditSheet';
import { TextField } from '@/components/Fields';
import { Alert } from '@/ui/alertStore';
import { colors } from '@/theme';
import './TalentsScreen.css';

export const TalentsScreen: React.FC = () => {
  const { id, template: c } = useCharacter();
  const {
    list,
    buyAnother,
    refundRank,
    forgetTalent,
  } = useTalents();
  const chars = useCharacteristics();
  const talentDefs = useTalentDefs();
  const careers = useCareers();
  const xp = useXp();
  const rules = useXpRules();
  const [addedNames, setAddedNames] = useStoredState<string[]>(characterKey(id, 'talents.added'), []);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [selectedName, setSelectedName] = React.useState('');
  const registryCareer = careers.find(candidate => candidate.name === c.career);
  const careerTalentNames = new Set(registryCareer?.advanceScheme?.talents ?? []);

  // Talent "Max" (WFRP 4e p.135): a flat cap or the Bonus of a characteristic.
  // Looked up by name against the registry's talent defs; undefined = no cap.
  const defByName = React.useMemo(
    () => Object.fromEntries(talentDefs.map(d => [d.name, d])),
    [talentDefs],
  );
  const bonusFor = (key: string) => chars.list.find(c => c.key === key)?.bonus ?? 0;
  const maxRankFor = (name: string): number | undefined => talentMaxRank(defByName[name], bonusFor);
  const ownedNames = new Set(list.map(t => t.name));
  const availableTalents = talentDefs
    .filter(t => !ownedNames.has(t.name))
    .sort((a, b) => {
      const careerOrder = Number(careerTalentNames.has(b.name)) - Number(careerTalentNames.has(a.name));
      return careerOrder || a.name.localeCompare(b.name);
    });
  const availableCareerCount = availableTalents.filter(t => careerTalentNames.has(t.name)).length;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const pickerResults = availableTalents
    .filter(t => !normalizedQuery
      || t.name.toLocaleLowerCase().includes(normalizedQuery)
      || t.description.toLocaleLowerCase().includes(normalizedQuery))
    .slice(0, 40);

  // "Buy another rank" cost: talentCostPerRank × the new rank number
  // (WFRP 4e core p.49). Sourced from the content registry (xpRules).
  const talentCost = (currentTimes: number) => rules.talentCostPerRank * (currentTimes + 1);

  const buy = (name: string, currentTimes: number) => {
    const cap = maxRankFor(name);
    if (cap !== undefined && currentTimes >= cap) {
      Alert.alert('At maximum', `${name} is capped at ${cap} rank${cap === 1 ? '' : 's'} (its listed Max).`);
      return;
    }
    const cost = talentCost(currentTimes);
    const reason = `${name} ×${currentTimes + 1}`;
    const r = xp.spend(cost, reason, 'talent');
    if (!r.ok) {
      Alert.alert('Not enough XP', r.message);
      return;
    }
    buyAnother(name);
    Alert.alert('Bought talent', r.message);
  };

  // Undo the most recent rank: refund the XP the matching purchase cost, then
  // step the rank down. The refund only succeeds if there's a real purchase in
  // the log, so template-granted ranks can't be sold back for free XP.
  const undo = (name: string, currentTimes: number) => {
    const cost = talentCost(currentTimes - 1);
    const r = xp.refund(cost, `${name} ×${currentTimes}`, 'talent');
    if (!r.ok) {
      Alert.alert('Cannot refund', `${r.message} Only ranks you bought this session can be refunded.`);
      return;
    }
    refundRank(name);
  };

  const removeAddedTalent = (name: string) => {
    const cost = talentCost(0);
    const r = xp.refund(cost, `${name} ×1`, 'talent');
    if (!r.ok) {
      Alert.alert('Cannot refund', `${r.message} Only talents bought through this picker can be removed.`);
      return;
    }
    setAddedNames(prev => prev.filter(candidate => candidate !== name));
    forgetTalent(name);
  };

  const onTimesChange = (name: string, currentTimes: number, next: number, added: boolean) => {
    if (added && currentTimes === 1 && next === 0) {
      removeAddedTalent(name);
      return;
    }
    if (next > currentTimes) buy(name, currentTimes);
    else if (next < currentTimes) undo(name, currentTimes);
  };

  const openPicker = () => {
    setQuery('');
    setSelectedName('');
    setPickerOpen(true);
  };

  const buySelectedTalent = () => {
    if (!selectedName) return;
    const cost = talentCost(0);
    const r = xp.spend(cost, `${selectedName} ×1`, 'talent');
    if (!r.ok) {
      Alert.alert('Not enough XP', r.message);
      return;
    }
    setAddedNames(prev => prev.includes(selectedName) ? prev : [...prev, selectedName]);
    buyAnother(selectedName);
    setPickerOpen(false);
    Alert.alert('Bought talent', r.message);
  };

  return (
    <ScreenContainer>
      <Hero
        eyebrow="Sheet 4 — Talents"
        title="Talents"
        subRow={
          <>
            <span className="tal-sub">{list.length} acquired</span>
            <span className="tal-sep">·</span>
            <span className="tal-sub">passive effects and unlocks</span>
            <span className="tal-sep">·</span>
            <span className="tal-sub">{xp.current} XP available</span>
          </>
        }
      />

      <Section title="Active talents" />

      <div className="tal-grid">
        {list.map((t, i) => {
          const cost = talentCost(t.times);
          const cap = maxRankFor(t.name);
          const atMax = cap !== undefined && t.times >= cap;
          const added = addedNames.includes(t.name);
          return (
            <Card key={i} style={{ flexBasis: '48%', flexGrow: 1, minWidth: 280 }}>
              <div className="tal-row" style={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div style={{ flex: 1 }}>
                  <div className="tal-title-row">
                    <span className="tal-name">{t.name}</span>
                    {t.career ? <Pill variant="empire" size={9.5}>career</Pill> : null}
                    {atMax ? <Pill variant="brass" size={9.5}>max</Pill> : null}
                  </div>
                  <span className="tal-desc">{t.desc}</span>
                </div>
                <div className="tal-times-col">
                  <span className="tal-mini-label">TIMES</span>
                  <span className="tal-times">×{t.times}{cap !== undefined ? ` / ${cap}` : ''}</span>
                </div>
              </div>
              <div className="tal-divider" />
              <div className="tal-row-between">
                <span className="tal-next">{atMax ? 'AT MAXIMUM' : `NEXT ${cost} XP`}</span>
                <Stepper
                  value={t.times}
                  min={added ? 0 : 1}
                  max={cap}
                  step={1}
                  decreaseLabel={added && t.times === 1 ? `Remove ${t.name}` : `Decrease ${t.name}`}
                  increaseLabel={`Increase ${t.name}`}
                  onChange={(next) => onTimesChange(t.name, t.times, next, added)}
                />
              </div>
            </Card>
          );
        })}

        <button
          type="button"
          className="btn-reset tal-cell tal-add"
          onClick={openPicker}
          aria-label={`New talent ${availableCareerCount} career options, ${availableTalents.length} total available`}
        >
          <Card dashed style={{ flex: 1, width: '100%' }}>
            <div className="tal-empty">
              <Icon name="plus" size={20} color={colors.ink3} />
              <span className="tal-empty-title">New talent</span>
              <span className="tal-empty-sub">{availableCareerCount} career · {availableTalents.length} total</span>
            </div>
          </Card>
        </button>
      </div>

      <EditSheet
        visible={pickerOpen}
        title="New talent"
        subtitle={`Buy a first rank for ${talentCost(0)} XP. ${availableCareerCount} talents are listed for ${c.career}; fallback career lists are approximate.`}
        onClose={() => setPickerOpen(false)}
        onSave={buySelectedTalent}
        saveLabel={`Buy · ${talentCost(0)} XP`}
        saveDisabled={!selectedName}
      >
        <TextField
          label="Search talents"
          value={query}
          onChangeText={setQuery}
          placeholder="name or description"
          autoCapitalize="none"
        />
        <div className="tal-picker-list" role="listbox" aria-label="Available talents">
          {pickerResults.map(talent => {
            const selected = selectedName === talent.name;
            const cap = maxRankFor(talent.name);
            return (
              <button
                key={talent.id}
                type="button"
                className={`btn-reset tal-picker-option${selected ? ' tal-picker-option--selected' : ''}`}
                role="option"
                aria-selected={selected}
                onClick={() => setSelectedName(talent.name)}
              >
                <span className="tal-picker-name">{talent.name}</span>
                <span className="tal-picker-desc">{talent.description || 'No description available.'}</span>
                <span className="tal-picker-max">
                  {careerTalentNames.has(talent.name) ? 'Career' : 'Other · GM approval'}
                  {cap !== undefined ? ` · Max ${cap}` : ''}
                </span>
              </button>
            );
          })}
          {pickerResults.length === 0 ? (
            <span className="tal-picker-empty">No available talents match this search.</span>
          ) : null}
        </div>
      </EditSheet>
    </ScreenContainer>
  );
};
