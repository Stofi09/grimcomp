import { outcomeLabel } from '@/utils/roll';
import type { RollHistoryEntry } from '@/utils/rollHistory';
import './RollSheet.css';

export function RollResultCard({ entry }: { entry: RollHistoryEntry }) {
  const r = entry.result;
  // Older entries already carry the attack verdict in their generated title.
  const landed = entry.attack?.landed ?? (entry.title.endsWith(' — NO HIT') ? false : entry.title.endsWith(' — HIT') ? true : undefined);
  const successful = landed ?? r.success;
  const defender = entry.attack?.defender;
  return (
    <article className={`roll-result ${successful ? 'roll-result--success' : 'roll-result--failure'}`}>
      <div className="roll-result-heading">
        <strong>{entry.title}</strong>
        <time dateTime={new Date(entry.at).toISOString()}>{new Date(entry.at).toLocaleString(undefined, {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        })}</time>
      </div>
      <div className="roll-result-numbers">
        <div><span>Rolled · {entry.dice}</span><strong>{r.roll}</strong></div>
        <div><span>Target</span><strong>{r.effectiveTarget}</strong></div>
        {r.hasSl && <div><span>Success levels</span><strong>{r.sl >= 0 ? '+' : ''}{r.sl}</strong></div>}
      </div>
      <p className="roll-verdict">{landed === undefined ? `Test · ${outcomeLabel(r.outcome)}` : `Attack · ${landed ? 'HIT' : 'NO HIT'}`}</p>
      {landed !== undefined && <p className="roll-opposition">
        Your test: {outcomeLabel(r.outcome)}
        {defender && <> · Defender {defender.sl >= 0 ? '+' : ''}{defender.sl} SL (roll {defender.roll} vs {defender.target})</>}
        {entry.attack?.damage !== undefined && <> · Damage {entry.attack.damage} before Toughness and armour</>}
      </p>}
      <details className="roll-breakdown">
        <summary>Modifiers &amp; details</summary>
        <p>Base target {r.baseTarget} · modifier {r.modifier >= 0 ? '+' : ''}{r.modifier} · final target {r.effectiveTarget}</p>
        {entry.detail && <p>{entry.detail}</p>}
      </details>
    </article>
  );
}
