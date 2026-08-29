import * as React from 'react';
import { ScreenContainer } from './ScreenContainer';
import { useTalents } from '@/hooks/useTalents';
import { useCharacteristics } from '@/hooks/useCharacteristics';
import { useXp } from '@/hooks/useXp';
import { useCharacter } from '@/hooks/useCharacter';
import { useCareers, useXpRules, useTalentDefs } from '@/content/useContent';
import { talentMaxRank } from '@/utils/advancement';
import {
  TALENT_TRACKING_NOTICE,
  canonicalTalentRef,
  isTalentCareerOption,
  resolveStoredTalentRef,
  talentDefForTalent,
  talentRulesStatusLabel,
  talentRulesStatusMeta,
  talentSourceLabel,
  talentIdentityKey,
  type StoredTalentRef,
} from '@/utils/talents';
import type { LiveTalent } from '@/hooks/useTalents';
import type { Talent } from '@/data/character';
import type { TalentDef } from '@/content/types';
import { careerDefForCharacter } from '@/utils/careers';
import { Hero } from '@/components/Hero';
import { Section } from '@/components/Section';
import { Card } from '@/components/Card';
import { Pill } from '@/components/Pill';
import { Stepper } from '@/components/Stepper';
import { Icon } from '@/components/Icon';
import { EditSheet } from '@/components/EditSheet';
import { PickerField, TextField } from '@/components/Fields';
import { Alert } from '@/ui/alertStore';
import { colors } from '@/theme';
import './TalentsScreen.css';

const normalized = (value: string): string => value.trim().toLocaleLowerCase();

export const TalentsScreen: React.FC = () => {
  const { template: c } = useCharacter();
  const {
    list,
    buyAnother,
    refundRank,
    forgetTalent,
    addTalentRef,
    removeTalentRef,
  } = useTalents();
  const chars = useCharacteristics();
  const talentDefs = useTalentDefs();
  const careers = useCareers();
  const xp = useXp();
  const rules = useXpRules();
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [selectedDefinitionId, setSelectedDefinitionId] = React.useState('');
  const [selectedSpecialization, setSelectedSpecialization] = React.useState('');
  const registryCareer = careerDefForCharacter(careers, c);
  const careerTalentNames = React.useMemo(
    () => new Set(registryCareer?.advanceScheme?.talents ?? []),
    [registryCareer],
  );

  const bonusFor = React.useCallback(
    (key: string) => chars.list.find(characteristic => characteristic.key === key)?.bonus ?? 0,
    [chars.list],
  );
  const definitionForTalent = React.useCallback(
    (talent: Pick<Talent, 'definitionId' | 'name'>): TalentDef | undefined =>
      talentDefForTalent(talentDefs, talent),
    [talentDefs],
  );
  const maxRankForTalent = React.useCallback(
    (talent: Pick<Talent, 'definitionId' | 'name'>): number | undefined =>
      talentMaxRank(definitionForTalent(talent), bonusFor),
    [bonusFor, definitionForTalent],
  );
  const maxRankForDefinition = React.useCallback(
    (definition: TalentDef): number | undefined => talentMaxRank(definition, bonusFor),
    [bonusFor],
  );

  // Resolve every character talent through its stable definition id first. For
  // old name-only sheets, the shared resolver supplies the bounded legacy
  // fallback and can infer known parameter choices.
  const ownedDefinitionKeys = React.useMemo(() => {
    const keys = new Set<string>();
    for (const talent of list) {
      const resolved = resolveStoredTalentRef(talentDefs, {
        name: talent.name,
        definitionId: talent.definitionId,
        specialization: talent.specialization,
      });
      if (resolved.definition) {
        keys.add(talentIdentityKey({
          name: resolved.name,
          definitionId: resolved.definition.id,
          specialization: resolved.specialization,
        }));
      }
    }
    return keys;
  }, [list, talentDefs]);

  const definitionAvailable = React.useCallback((definition: TalentDef): boolean => {
    if (definition.specializations?.length) {
      return definition.specializations.some(specialization => (
        !ownedDefinitionKeys.has(talentIdentityKey({
          name: definition.name,
          definitionId: definition.id,
          specialization,
        }))
      ));
    }
    return !ownedDefinitionKeys.has(talentIdentityKey({
      name: definition.name,
      definitionId: definition.id,
    }));
  }, [ownedDefinitionKeys]);

  const availability = React.useMemo(() => {
    let total = 0;
    let career = 0;
    for (const definition of talentDefs) {
      if (!definitionAvailable(definition)) continue;
      total += 1;
      if (isTalentCareerOption(careerTalentNames, talentDefs, definition, definition.name)) career += 1;
    }
    return { total, career };
  }, [careerTalentNames, definitionAvailable, talentDefs]);

  // Search/sort the 160+ entry catalog only while the modal is visible.
  const pickerResults = React.useMemo(() => {
    if (!pickerOpen) return [];
    const normalizedQuery = normalized(query);
    return talentDefs
      .filter(definitionAvailable)
      .filter(talent => {
        if (!normalizedQuery) return true;
        return [
          talent.name,
          talent.description,
          talent.tests,
          talent.restriction,
          talent.rulesNote,
          talentSourceLabel(talent),
          talentRulesStatusLabel(talent),
          talent.specializations?.join(' '),
        ].some(value => value?.toLocaleLowerCase().includes(normalizedQuery));
      })
      .sort((a, b) => {
        const aCareer = isTalentCareerOption(careerTalentNames, talentDefs, a, a.name);
        const bCareer = isTalentCareerOption(careerTalentNames, talentDefs, b, b.name);
        return Number(bCareer) - Number(aCareer) || a.name.localeCompare(b.name);
      })
      .slice(0, 40);
  }, [careerTalentNames, definitionAvailable, pickerOpen, query, talentDefs]);

  const selectedDefinition = talentDefs.find(definition => definition.id === selectedDefinitionId);
  const remainingSpecializations = selectedDefinition?.specializations?.filter(specialization => (
    !ownedDefinitionKeys.has(talentIdentityKey({
      name: selectedDefinition.name,
      definitionId: selectedDefinition.id,
      specialization,
    }))
  )) ?? [];
  const acquiredSpecializations = selectedDefinition?.specializations?.filter(specialization => (
    ownedDefinitionKeys.has(talentIdentityKey({
      name: selectedDefinition.name,
      definitionId: selectedDefinition.id,
      specialization,
    }))
  )) ?? [];

  // "Buy another rank" cost: talentCostPerRank × the new rank number
  // (WFRP 4e core p.49). Sourced from the content registry (xpRules).
  const talentCost = (currentTimes: number) => rules.talentCostPerRank * (currentTimes + 1);

  const buy = (talent: LiveTalent, currentTimes: number) => {
    const cap = maxRankForTalent(talent);
    if (cap !== undefined && currentTimes >= cap) {
      Alert.alert(
        'At maximum',
        `${talent.name} is capped at ${cap} rank${cap === 1 ? '' : 's'} (its listed Max).`,
      );
      return;
    }
    const cost = talentCost(currentTimes);
    const reason = `${talent.name} ×${currentTimes + 1}`;
    const result = xp.spend(cost, reason, 'talent', talentIdentityKey(talent));
    if (!result.ok) {
      Alert.alert('Not enough XP', result.message);
      return;
    }
    buyAnother(talent);
    Alert.alert('Bought talent', result.message);
  };

  // Undo the most recent rank after a successful XP refund. Template-granted
  // ranks cannot be sold back because they have no matching purchase log entry.
  const undo = (talent: LiveTalent) => {
    const currentTimes = talent.times;
    const cost = talentCost(currentTimes - 1);
    const reason = `${talent.name} ×${currentTimes}`;
    const legacyReasons = talent.storedName === talent.name
      ? []
      : [`${talent.storedName} ×${currentTimes}`];
    const result = xp.refund(
      cost,
      reason,
      'talent',
      talentIdentityKey(talent),
      legacyReasons,
    );
    if (!result.ok) {
      Alert.alert('Cannot refund', `${result.message} Only ranks you bought this session can be refunded.`);
      return;
    }
    refundRank(talent);
  };

  const removeAddedTalent = (talent: LiveTalent) => {
    const cost = talentCost(0);
    const reason = `${talent.name} ×1`;
    const legacyReasons = talent.storedName === talent.name ? [] : [`${talent.storedName} ×1`];
    const result = xp.refund(
      cost,
      reason,
      'talent',
      talentIdentityKey(talent),
      legacyReasons,
    );
    if (!result.ok) {
      Alert.alert('Cannot refund', `${result.message} Only talents bought through this picker can be removed.`);
      return;
    }
    removeTalentRef(talent);
    forgetTalent(talent);
  };

  const onTimesChange = (talent: LiveTalent, next: number) => {
    if (talent.added && talent.times === 1 && next === 0) {
      removeAddedTalent(talent);
      return;
    }
    if (next > talent.times) buy(talent, talent.times);
    else if (next < talent.times) undo(talent);
  };

  const openPicker = () => {
    setQuery('');
    setSelectedDefinitionId('');
    setSelectedSpecialization('');
    setPickerOpen(true);
  };

  const commitTalentPurchase = (ref: StoredTalentRef) => {
    const cost = talentCost(0);
    const result = xp.spend(cost, `${ref.name} ×1`, 'talent', talentIdentityKey(ref));
    if (!result.ok) {
      Alert.alert('Not enough XP', result.message);
      return;
    }
    addTalentRef(ref);
    buyAnother(ref);
    setPickerOpen(false);
    Alert.alert('Bought talent', result.message);
  };

  const buySelectedTalent = () => {
    const definition = talentDefs.find(candidate => candidate.id === selectedDefinitionId);
    if (!definition) {
      Alert.alert('Talent unavailable', 'That loaded definition is no longer active. Select a Talent again.');
      return;
    }
    const ref = canonicalTalentRef(definition, selectedSpecialization || undefined);
    if (!ref) {
      Alert.alert('Choose a specialization', `Choose one option for ${definition.name} before buying it.`);
      return;
    }
    if (ownedDefinitionKeys.has(talentIdentityKey(ref))) {
      Alert.alert('Talent already acquired', `${ref.name} is already on this character sheet.`);
      return;
    }

    if (definition.restriction?.trim()) {
      const source = talentSourceLabel(definition);
      Alert.alert(
        'Confirm talent eligibility',
        [
          `Restriction: ${definition.restriction.trim()}`,
          source ? `Source: ${source}` : '',
          TALENT_TRACKING_NOTICE,
        ].filter(Boolean).join('\n\n'),
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: `Confirm & buy · ${talentCost(0)} XP`,
            onPress: () => commitTalentPurchase(ref),
          },
        ],
      );
      return;
    }

    commitTalentPurchase(ref);
  };

  const needsSpecialization = !!selectedDefinition?.specializations?.length;
  const saveDisabled = !selectedDefinition
    || (needsSpecialization && !selectedSpecialization);

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

      <div className="tal-tracking-notice" role="note">{TALENT_TRACKING_NOTICE}</div>
      <Section title="Active talents" />

      <div className="tal-grid">
        {list.map((talent, index) => {
          const definition = definitionForTalent(talent);
          const source = definition ? talentSourceLabel(definition) : '';
          const status = definition ? talentRulesStatusLabel(definition) : '';
          const cap = maxRankForTalent(talent);
          const atMax = cap !== undefined && talent.times >= cap;
          const unresolved = talent.added && !definition;
          const cost = talentCost(talent.times);
          return (
            <Card
              key={`${talent.definitionId ?? 'legacy'}:${talent.specialization ?? ''}:${talent.name}:${index}`}
              style={{ flexBasis: '48%', flexGrow: 1, minWidth: 280 }}
            >
              <div className="tal-row" style={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div style={{ flex: 1 }}>
                  <div className="tal-title-row">
                    <span className="tal-name">{talent.name}</span>
                    {talent.career ? <Pill variant="empire" size={9.5}>career</Pill> : null}
                    {atMax ? <Pill variant="brass" size={9.5}>max</Pill> : null}
                    {unresolved ? <Pill variant="warn" size={9.5}>source unavailable</Pill> : null}
                  </div>
                  <span className="tal-desc">{talent.desc}</span>
                  {definition ? (
                    <div className="tal-rules-meta">
                      <div className="tal-rules-meta-row">
                        {source ? <span className="tal-source">{source}</span> : null}
                        {definition.rulesStatus ? (
                          <span className="tal-status-short">{talentRulesStatusMeta(definition)}</span>
                        ) : null}
                      </div>
                      {status ? <span className="tal-status">{status}</span> : null}
                      {definition.tests?.trim() ? (
                        <span className="tal-rule-line">Tests: {definition.tests.trim()}</span>
                      ) : null}
                      {definition.restriction?.trim() ? (
                        <span className="tal-restriction">Restriction: {definition.restriction.trim()}</span>
                      ) : null}
                      {definition.rulesNote?.trim() ? (
                        <span className="tal-rule-line">Rules note: {definition.rulesNote.trim()}</span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="tal-times-col">
                  <span className="tal-mini-label">TIMES</span>
                  <span className="tal-times">×{talent.times}{cap !== undefined ? ` / ${cap}` : ''}</span>
                </div>
              </div>
              <div className="tal-divider" />
              <div className="tal-row-between">
                <span className="tal-next">{atMax ? 'AT MAXIMUM' : `NEXT ${cost} XP`}</span>
                <Stepper
                  value={talent.times}
                  min={talent.added ? 0 : 1}
                  max={cap}
                  step={1}
                  decreaseLabel={talent.added && talent.times === 1 ? `Remove ${talent.name}` : `Decrease ${talent.name}`}
                  increaseLabel={`Increase ${talent.name}`}
                  onChange={(next) => onTimesChange(talent, next)}
                />
              </div>
            </Card>
          );
        })}

        <button
          type="button"
          className="btn-reset tal-cell tal-add"
          onClick={openPicker}
          aria-label={`New talent ${availability.career} career options, ${availability.total} total available`}
        >
          <Card dashed style={{ flex: 1, width: '100%' }}>
            <div className="tal-empty">
              <Icon name="plus" size={20} color={colors.ink3} />
              <span className="tal-empty-title">New talent</span>
              <span className="tal-empty-sub">{availability.career} career · {availability.total} total</span>
            </div>
          </Card>
        </button>
      </div>

      <EditSheet
        visible={pickerOpen}
        title="New talent"
        subtitle={`Buy a first rank for ${talentCost(0)} XP. ${availability.career} talents are listed for ${c.career}; fallback career lists are approximate.`}
        onClose={() => setPickerOpen(false)}
        onSave={buySelectedTalent}
        saveLabel={`Buy · ${talentCost(0)} XP`}
        saveDisabled={saveDisabled}
      >
        <TextField
          label="Search talents"
          value={query}
          onChangeText={(nextQuery) => {
            setQuery(nextQuery);
            setSelectedDefinitionId('');
            setSelectedSpecialization('');
          }}
          placeholder="name, effect, source, Tests, or restriction"
          autoCapitalize="none"
        />
        <div className="tal-picker-list" role="listbox" aria-label="Available talents">
          {pickerResults.map(talent => {
            const selected = selectedDefinitionId === talent.id;
            const cap = maxRankForDefinition(talent);
            const source = talentSourceLabel(talent);
            const status = talentRulesStatusLabel(talent);
            const career = isTalentCareerOption(careerTalentNames, talentDefs, talent, talent.name);
            return (
              <button
                key={talent.id}
                type="button"
                className={`btn-reset tal-picker-option${selected ? ' tal-picker-option--selected' : ''}`}
                role="option"
                aria-selected={selected}
                onClick={() => {
                  setSelectedDefinitionId(talent.id);
                  setSelectedSpecialization('');
                }}
              >
                <span className="tal-picker-head">
                  <span className="tal-picker-name">{talent.name}</span>
                  <span className="tal-picker-max">
                    {career ? 'Career' : 'Other · GM approval'}
                    {cap !== undefined ? ` · Max ${cap}` : ''}
                  </span>
                </span>
                <span className="tal-picker-desc">{talent.description || 'No description available.'}</span>
                <span className="tal-picker-meta">
                  {source ? <span>Source: {source}</span> : null}
                  {status ? <span className="tal-picker-status">{status}</span> : null}
                  {talent.tests?.trim() ? <span>Tests: {talent.tests.trim()}</span> : null}
                  {talent.specializations?.length ? (
                    <span>Choices: {talent.specializations.join(', ')}</span>
                  ) : null}
                  {talent.restriction?.trim() ? (
                    <span className="tal-picker-restriction">Restriction: {talent.restriction.trim()}</span>
                  ) : null}
                  {talent.rulesNote?.trim() ? <span>Rules note: {talent.rulesNote.trim()}</span> : null}
                </span>
              </button>
            );
          })}
          {pickerResults.length === 0 ? (
            <span className="tal-picker-empty">No available talents match this search.</span>
          ) : null}
        </div>

        {selectedDefinition?.specializations?.length ? (
          <PickerField
            label={selectedDefinition.name.includes('(Wind)') ? 'Wind' : 'Specialization'}
            value={selectedSpecialization}
            onChange={setSelectedSpecialization}
            options={remainingSpecializations.map(specialization => ({
              value: specialization,
              label: specialization,
            }))}
            hint={acquiredSpecializations.length
              ? `Already acquired: ${acquiredSpecializations.join(', ')}. Choose another option.`
              : 'Choose one option. The listed Max applies separately to each concrete choice.'}
          />
        ) : null}
      </EditSheet>
    </ScreenContainer>
  );
};
