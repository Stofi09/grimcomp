import type * as React from 'react';
import { ScreenContainer } from './ScreenContainer';
import { useCharacter } from '@/hooks/useCharacter';
import { useVitals } from '@/hooks/useVitals';
import { useDerived } from '@/hooks/useDerived';
import { Hero } from '@/components/Hero';
import { Section } from '@/components/Section';
import { Card } from '@/components/Card';
import { Pill } from '@/components/Pill';
import { Button } from '@/components/Button';
import { Stepper } from '@/components/Stepper';
import { Bar } from '@/components/Bar';
import './PsychologyScreen.css';

export const PsychologyScreen: React.FC = () => {
  const { template: c } = useCharacter();
  const vitals = useVitals();
  const corrThresh = useDerived().corruptionThreshold;

  return (
    <ScreenContainer>
      <Hero
        title="Psychology"
        subRow={<span className="psy-sub">Motivation, ambitions, mutations, and the corruption of Chaos.</span>}
      />

      <div className="psy-row">
        <Card style={{ flex: 1, minWidth: 280 }}>
          <span className="psy-label">Motivation</span>
          <span className="psy-title">{c.motivation || '—'}</span>
          <span className="psy-body">Acting on your Motivation refreshes Resolve to its maximum.</span>
          <div className="psy-motivation-row">
            <Button variant="ghost" onPress={vitals.refreshResolve}>Act on Motivation</Button>
            <span className="psy-meta-mono">Resolve {vitals.resolve}/{vitals.resilience}</span>
          </div>
        </Card>
        <Card style={{ flex: 1, minWidth: 280 }}>
          <span className="psy-label">Psychological traits</span>
          <div className="psy-chips">
            {c.psychology.map((p, i) => (
              <Pill key={i} variant="warn" size={11}>{p}</Pill>
            ))}
          </div>
        </Card>
      </div>

      <div className="psy-row" style={{ marginTop: 12 }}>
        <Card style={{ flex: 1, minWidth: 280 }}>
          <span className="psy-label">Short-term ambition</span>
          <span className="psy-title">{c.ambitionsShort}</span>
          <div className="psy-pill-row">
            <Pill variant="brass" size={10}>complete = 100 XP</Pill>
          </div>
        </Card>
        <Card style={{ flex: 1, minWidth: 280 }}>
          <span className="psy-label">Long-term ambition</span>
          <span className="psy-title">{c.ambitionsLong}</span>
          <div className="psy-pill-row">
            <Pill variant="brass" size={10}>complete = 200 XP</Pill>
          </div>
        </Card>
      </div>

      <Section title="Corruption & Mutation" />
      <div className="psy-row">
        <Card style={{ flex: 1, minWidth: 280 }}>
          <div className="psy-row-between">
            <span className="psy-label">Corruption points</span>
            <span className="psy-meta-mono">threshold {corrThresh} · TB+WPB</span>
          </div>
          <span className="psy-big-corr tabular">
            {vitals.corruption}
            <span className="psy-muted psy-big-corr-suffix"> / {corrThresh}</span>
          </span>
          <Bar
            value={corrThresh > 0 ? Math.min(1, vitals.corruption / corrThresh) : 0}
            variant="corr"
            style={{ marginTop: 10 }}
          />
          <div className="psy-row-between" style={{ marginTop: 10 }}>
            <span className="psy-body">At threshold: roll a mutation test.</span>
            <Stepper value={vitals.corruption} min={0} max={99} onChange={vitals.setCorruption} />
          </div>
        </Card>
        <Card style={{ flex: 1, minWidth: 280 }}>
          <span className="psy-label">Mutations</span>
          {c.mutations.length === 0 ? (
            <span className="psy-body psy-clean">— clean —</span>
          ) : (
            c.mutations.map((m, i) => <span key={i} className="psy-mutation">{m.name}</span>)
          )}
        </Card>
      </div>
    </ScreenContainer>
  );
};
