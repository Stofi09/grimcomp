// Prayer library — Shallya (Mercy) sampling from WFRP 4e core book.
// IDs are stable; each Anointed character's template lists their `knownPrayers`.

export interface Prayer {
  id: string;
  name: string;
  deity: string;
  range: string;
  target: string;
  duration: string;
  description: string;
}

export const PRAYERS_OF_SHALLYA: Prayer[] = [
  { id: 'p.blessing',  name: 'Blessing of Mercy', deity: 'Shallya', range: 'Touch',     target: '1',         duration: 'Instant',                 description: 'The target recovers 1 wound + your Willpower Bonus.' },
  { id: 'p.calm',      name: 'Calm Soul',         deity: 'Shallya', range: 'Touch',     target: '1',         duration: 'Instant',                 description: 'Removes the Broken condition.' },
  { id: 'p.staunch',   name: 'Staunch',           deity: 'Shallya', range: 'Touch',     target: '1',         duration: 'Instant',                 description: 'Removes 1 Bleeding stack from the target.' },
  { id: 'p.cure',      name: 'Cure',              deity: 'Shallya', range: 'Touch',     target: '1',         duration: 'WPB rounds',              description: 'Cures one disease. The target makes a Toughness test to throw off the worst of it.' },
  { id: 'p.peace',     name: 'Voice of Peace',    deity: 'Shallya', range: 'WPB yards', target: 'AoE WPB',   duration: 'WPB rounds',              description: 'Hostile creatures must pass a Cool test to attack anyone in range.' },
];

export const MINOR_PROVIDENCES: Prayer[] = [
  { id: 'p.bless',     name: 'Bless',             deity: 'Any',     range: 'Touch',     target: '1',         duration: 'WPB rounds',              description: '+10 to the next test of one type the target must make.' },
  { id: 'p.fortify',   name: 'Fortify',           deity: 'Any',     range: 'Touch',     target: '1',         duration: 'WPB rounds',              description: '+1 AP to all locations on the target.' },
];

export const ALL_PRAYERS: Prayer[] = [...PRAYERS_OF_SHALLYA, ...MINOR_PROVIDENCES];

const BY_ID: Record<string, Prayer> = Object.fromEntries(ALL_PRAYERS.map(p => [p.id, p]));

export function getPrayer(id: string): Prayer | undefined {
  return BY_ID[id];
}

export function resolvePrayers(ids: string[]): Prayer[] {
  return ids.map(getPrayer).filter((p): p is Prayer => !!p);
}

/** d100 → Wrath of the Gods effect (simplified — full tables are p.221+). */
export function wrathOfTheGods(roll: number): string {
  if (roll <= 25) return 'The deity is displeased; you gain 1 Sin point.';
  if (roll <= 50) return 'A divine reprimand. Stunned 1, and prayers cost +1 SL today.';
  if (roll <= 75) return 'You are struck mute. Cannot speak until end of scene.';
  return 'Faith shaken: you lose access to prayers until you atone.';
}
