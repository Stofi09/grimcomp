import { useRef, useState } from 'react';
import { useActiveCharId, useCharacter } from '@/hooks/useCharacter';
import { useConditions } from '@/hooks/useConditions';
import { useTestOptions } from '@/hooks/useTestOptions';
import { useRollHistory } from '@/hooks/useRollHistory';
import { useSystemRules } from '@/content/useContent';
import { diceLabel, resolveTest } from '@/utils/roll';
import type { RollHistoryEntry } from '@/utils/rollHistory';
import { EditSheet } from './EditSheet';
import { NumberField } from './Fields';
import { RollResultCard } from './RollResultCard';
import './RollSheet.css';

interface RollSheetProps {
  visible: boolean;
  onClose: () => void;
  initialMode?: 'roll' | 'history';
}

export function RollSheet(props: RollSheetProps) {
  const id = useActiveCharId();
  // A fresh dialog for each opening and character prevents stale targets/results.
  return props.visible ? <RollSheetContent key={id} {...props} /> : null;
}

function RollSheetContent({ onClose, initialMode = 'roll' }: RollSheetProps) {
  const { template: c } = useCharacter();
  const options = useTestOptions();
  const { test } = useSystemRules();
  const { modifier: conditions } = useConditions();
  const { entries, recordRoll } = useRollHistory();
  const [mode, setMode] = useState(initialMode);
  const [selection, setSelection] = useState('');
  const [difficulty, setDifficulty] = useState(0);
  const [result, setResult] = useState<RollHistoryEntry | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'pending' | 'saved' | 'failed'>('idle');
  const busy = useRef(false);
  const selected = options.find(option => option.id === selection);
  const modifier = conditions.total + difficulty;
  const preview = selected ? resolveTest({ target: selected.target, modifier, forceRoll: 1 }, test) : null;

  const roll = async () => {
    if (!selected || selected.disabled || busy.current) return;
    busy.current = true;
    setSaveState('pending');
    const r = resolveTest({ target: selected.target, modifier, label: selected.label }, test);
    const detail = [
      `Difficulty: ${difficulty >= 0 ? '+' : ''}${difficulty}`,
      ...conditions.parts.map(p => `${p.name} ×${p.stacks}: ${p.modifier >= 0 ? '+' : ''}${p.modifier}`),
    ].join('\n');
    try {
      const saved = recordRoll({ title: selected.label, dice: diceLabel(test.dice), result: r, detail });
      setResult(saved.entry);
      const durability = await saved.completion;
      setSaveState(durability.ok ? 'saved' : 'failed');
    } catch {
      setSaveState('failed');
    } finally {
      busy.current = false;
    }
  };

  return (
    <EditSheet visible title={mode === 'roll' ? 'Roll a test' : 'Roll history'}
      subtitle={`${c.name} · ${mode === 'roll' ? 'Choose a test. See every modifier.' : 'Latest 100 rolls, saved with this character.'}`}
      onClose={onClose} onSave={mode === 'roll' ? roll : undefined}
      closeLabel={mode === 'history' || result ? 'Done' : 'Cancel'}
      saveLabel={saveState === 'pending' ? 'Saving roll…' : result ? 'Roll again' : `Roll ${diceLabel(test.dice)}`}
      saveDisabled={!selected || selected.disabled || saveState === 'pending'}>
      <div className="roll-tabs" role="group" aria-label="Roll view">
        <button type="button" aria-pressed={mode === 'roll'} onClick={() => setMode('roll')}>Roll a test</button>
        <button type="button" aria-pressed={mode === 'history'} onClick={() => setMode('history')}>History · {entries.length}</button>
      </div>
      {mode === 'roll' ? <>
        {!result && <>
        <label className="roll-select-label" htmlFor="roll-test-choice">Skill or characteristic</label>
        <select id="roll-test-choice" className="roll-select" value={selection}
          onChange={e => { setSelection(e.target.value); setResult(null); }}>
          <option value="">Choose a test…</option>
          {['Characteristics', 'Skills'].map(group => <optgroup key={group} label={group}>
            {options.filter(option => option.group === group).map(option =>
              <option key={option.id} value={option.id} disabled={option.disabled}>
                {option.label} · {option.disabled ? 'training required' : option.target}
              </option>)}
          </optgroup>)}
        </select>
        <NumberField label="Difficulty modifier" value={difficulty} min={-100} max={100}
          onChangeNumber={value => { setDifficulty(value); setResult(null); }} hint="Positive helps; negative makes the test harder." />
        <div className="roll-difficulty" role="group" aria-label="Quick difficulty">
          {[-20, -10, 0, 10, 20].map(value => <button type="button" key={value}
            aria-pressed={difficulty === value} onClick={() => { setDifficulty(value); setResult(null); }}>
            {value > 0 ? '+' : ''}{value}
          </button>)}
        </div>
        <div className="roll-target-preview">
          <div><span>Final target</span><strong>{preview?.effectiveTarget ?? '—'}</strong></div>
          <p>{selected ? `Base ${selected.target} · difficulty ${difficulty >= 0 ? '+' : ''}${difficulty} · conditions ${conditions.total}` : 'Choose a skill or characteristic to calculate your target.'}</p>
        </div>
        {conditions.parts.length > 0 && <ul className="roll-conditions">{conditions.parts.map(p =>
          <li key={p.name}>{p.name} ×{p.stacks} <strong>{p.modifier >= 0 ? '+' : ''}{p.modifier}</strong></li>)}</ul>}
        </>}
        <div aria-live="polite" aria-atomic="true">
          {result && <RollResultCard entry={result} />}
          {saveState !== 'idle' && <p className={`roll-save-status${saveState === 'failed' ? ' roll-save-status--error' : ''}`}>
            {saveState === 'pending' ? 'Saving to history…' : saveState === 'saved' ? 'Saved to this character’s history.' : 'This roll could not be saved to history. Keep the result before closing.'}
          </p>}
        </div>
        {result && <button type="button" className="roll-change-test" disabled={saveState === 'pending'}
          onClick={() => { setResult(null); setSaveState('idle'); }}>Change test or difficulty</button>}
      </> : <div className="roll-history">
        {entries.length ? entries.map(entry => <RollResultCard key={entry.id} entry={entry} />)
          : <div className="roll-empty"><strong>Your next roll starts the story.</strong><p>Tests and attacks appear here, including their targets, modifiers, and outcomes.</p></div>}
      </div>}
    </EditSheet>
  );
}
