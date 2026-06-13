import type * as React from 'react';
import './Stat.css';

/**
 * Structural mirror of `Characteristic` from '@/data/character' — kept local so
 * this component only depends on react. Any object with these fields works.
 */
interface StatCharacteristic {
  key?: string;
  name: string;
  short: string;
  init: number;
  adv: number;
  /** Current value and bonus, precomputed by the caller (useCharacteristics)
      with the system's configured formulas — never recomputed here. */
  current: number;
  bonus: number;
}

interface StatProps {
  c: StatCharacteristic;
  suggested?: boolean;
}

export const Stat: React.FC<StatProps> = ({ c, suggested }) => {
  const cur = c.current;
  const bonus = c.bonus;
  return (
    <div className={suggested ? 'gc-stat gc-stat--suggested' : 'gc-stat'}>
      <div className="gc-stat-bonus">{bonus}</div>

      <div className="gc-stat-top">
        <span className="gc-stat-key">{c.short}</span>
        <span className="gc-stat-name">{c.name}</span>
      </div>

      <div className="gc-stat-num">{cur}</div>

      <div className="gc-stat-breakdown">
        <span className="gc-stat-bd">
          <span className="gc-stat-bd-b">{c.init}</span> base
        </span>
        <span className="gc-stat-bd gc-stat-bd--adv">+{c.adv} adv</span>
      </div>
    </div>
  );
};
