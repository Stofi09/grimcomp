// Spell library — Lore of Fire (Aqshy) sampling from WFRP 4e core book.
// IDs are stable, used by each caster's `knownSpells` list on their template.

export interface Spell {
  id: string;
  name: string;
  lore: string;
  /** Casting Number: target SL to reach. */
  cn: number;
  range: string;
  target: string;
  duration: string;
  /** d100 miscast severity threshold. Minor for any fumble, Major if any
      condition is already active. Simplified for the prototype. */
  description: string;
  /** Damage formula when the spell hits something flammable. Optional. */
  damage?: string;
}

export const PETTY_MAGIC: Spell[] = [
  { id: 'm.candle',  name: 'Light',       lore: 'Petty',  cn: 1, range: 'Touch',    target: '1',         duration: 'Willpower Bonus minutes', description: 'A held object glows like a candle.' },
  { id: 'm.dart',    name: 'Magic Dart',  lore: 'Petty',  cn: 3, range: 'WPB yards', target: '1',         duration: 'Instant',                description: 'A bolt of raw magic strikes a target.', damage: '2' },
  { id: 'm.gust',    name: 'Gust',        lore: 'Petty',  cn: 2, range: 'WPB yards', target: 'AoE WPB',   duration: 'Instant',                description: 'A sudden gust extinguishes candles and pushes lighter objects.' },
  { id: 'm.warm',    name: 'Warmth',      lore: 'Petty',  cn: 1, range: 'Touch',    target: '1',         duration: 'Willpower Bonus hours',   description: 'The target is comfortably warm regardless of weather.' },
];

export const LORE_OF_FIRE: Spell[] = [
  { id: 'm.fireball',     name: 'Fireball',          lore: 'Fire',  cn: 8,  range: 'WPB×10 yards', target: 'AoE WPB',  duration: 'Instant',                 description: 'A ball of flame explodes at the target point.', damage: '+5' },
  { id: 'm.crown',        name: 'Crown of Fire',     lore: 'Fire',  cn: 6,  range: 'You',          target: 'Self',     duration: 'WPB rounds',              description: 'Your head is wreathed in flame. +1 SL on Intimidate; melee attackers take damage.', damage: '+3' },
  { id: 'm.cauterise',    name: 'Cauterise',         lore: 'Fire',  cn: 4,  range: 'Touch',        target: '1',        duration: 'Instant',                 description: 'A bleeding wound is sealed. Removes Bleeding condition; deals 1 damage.' },
  { id: 'm.dazzle',       name: 'Dazzling Blaze',    lore: 'Fire',  cn: 5,  range: 'WPB yards',    target: 'AoE WPB',  duration: 'WPB rounds',              description: 'A blinding flash. Targets failing a Cool test gain Blinded 1.' },
  { id: 'm.firewall',     name: 'Wall of Fire',      lore: 'Fire',  cn: 9,  range: 'WPB×4 yards',  target: 'Special',  duration: 'WPB rounds',              description: 'A wall of flame WPB×2 yards long springs up. Anyone crossing takes damage.', damage: '+4' },
  { id: 'm.burning',      name: "Burning Blood",     lore: 'Fire',  cn: 12, range: 'WPB yards',    target: '1',        duration: 'WPB rounds',              description: "The target's blood boils. Devastating but slow to cast.", damage: '+7' },
];

export const ALL_SPELLS: Spell[] = [...PETTY_MAGIC, ...LORE_OF_FIRE];

const BY_ID: Record<string, Spell> = Object.fromEntries(ALL_SPELLS.map(s => [s.id, s]));

export function getSpell(id: string): Spell | undefined {
  return BY_ID[id];
}

export function resolveSpells(ids: string[]): Spell[] {
  return ids.map(getSpell).filter((s): s is Spell => !!s);
}

/** d100 → minor miscast effect (simplified — full tables are p.236+). */
export function minorMiscast(roll: number): string {
  if (roll <= 20) return 'Snap! A loud bang; one round of ringing ears (Surprised 1).';
  if (roll <= 40) return 'Smoke billows from the caster; Stunned 1.';
  if (roll <= 60) return 'A sigil burns onto the caster\'s skin; 1 damage, ignoring armour.';
  if (roll <= 80) return 'Aethyric backlash: caster suffers 1 stack of Fatigued.';
  return 'Reality wobbles; caster gains 1 Corruption point.';
}

/** d100 → major miscast (only triggered on fumble + active conditions). */
export function majorMiscast(roll: number): string {
  if (roll <= 25) return 'A small fire breaks out in 3-yard radius; everyone in it: Burning condition stack.';
  if (roll <= 50) return 'Aethyric vortex; caster takes SB+2 damage and gains Stunned 1.';
  if (roll <= 75) return 'Wraith eyes! The caster sees the dead until end of scene.';
  return 'Daemon stirs — caster gains 1 Corruption + a Disorder roll (off-screen).';
}
