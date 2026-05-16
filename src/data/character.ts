// Character data — multiple full templates keyed by id, plus the shared
// XP-cost / condition tables. Each character in the roster gets a complete
// template; the live overlay (advances, wounds, XP log, conditions) is
// stored per-character under `gc.<id>.<suffix>` keys.

export type CharacteristicKey =
  | 'ws' | 'bs' | 's' | 't' | 'i' | 'ag' | 'dex' | 'int' | 'wp' | 'fel';

export interface Characteristic {
  key: CharacteristicKey;
  name: string;
  short: string;
  init: number;
  adv: number;
}

export interface Skill {
  name: string;
  char: CharacteristicKey;
  adv: number;
  career: boolean;
  advanced?: boolean;
  grouped?: string;
}

export interface Talent {
  name: string;
  times: number;
  desc: string;
  career: boolean;
}

export interface Weapon {
  name: string;
  group: string;
  enc: number;
  reach?: string;
  range?: string;
  dmg: string;
  qual: string[];
}

export interface Armour {
  name: string;
  locs: string[];
  enc: number;
  ap: number;
  qual: string[];
}

export interface Critical {
  loc: string;
  roll: number;
  name: string;
  effect: string;
  days: number;
}

export interface Trapping {
  name: string;
  enc: number;
}

// Class / career rank progression used by useCareer to render path and
// status pills. Each character's class defines its 4-rank progression.
export interface CareerRank {
  level: number;
  name: string;
  status: string;
}

export interface Character {
  id: string;
  name: string;
  species: string;
  class: string;
  career: string;             // currently-occupied career name
  careerLevel: number;
  careerLevelName: string;
  // 4-rank progression for this career (used by Career screen + useCareer).
  careerRanks: CareerRank[];
  status: string;
  age: number;
  height: string;
  hair: string;
  eyes: string;
  motivation: string;
  fate: number;
  fortune: number;
  resilience: number;
  resolve: number;
  xpCurrent: number;
  xpSpent: number;
  wounds: { current: number; max: number };
  corruption: number;
  sin: number;
  movement: number;
  wealth: { gc: number; ss: number; d: number };
  characteristics: Characteristic[];
  skills: Skill[];
  talents: Talent[];
  weapons: Weapon[];
  armour: Armour[];
  ap: { head: number; arm_l: number; arm_r: number; body: number; leg_l: number; leg_r: number; shield: number };
  conditions: Array<{ type: string; stacks: number }>;
  criticals: Critical[];
  trappings: Trapping[];
  party: {
    name: string;
    short: string;
    members: Array<{ name: string; role: string }>;
  };
  psychology: string[];
  mutations: Array<{ name: string }>;
  ambitionsShort: string;
  ambitionsLong: string;
  initials: string;
  accent: string;
  isCaster?: boolean;          // toggles Magic screen content
  isAnointed?: boolean;        // toggles Faith screen content
  /** Spell IDs from src/data/magic.ts (caster characters only). */
  knownSpells?: string[];
  /** Prayer IDs from src/data/faith.ts (Anointed characters only). */
  knownPrayers?: string[];
  /** Display labels for the Faith / Magic screen banners. */
  deity?: string;
  spellLore?: string;
}

const SIGMUND: Character = {
  id: 'c1',
  name: 'Sigmund Braun',
  species: 'Human',
  class: 'Warrior',
  career: 'Roadwarden',
  careerLevel: 2,
  careerLevelName: 'Road Sergeant',
  careerRanks: [
    { level: 1, name: 'Roadwarden', status: 'Silver 2' },
    { level: 2, name: 'Road Sergeant', status: 'Silver 3' },
    { level: 3, name: 'Mounted Sergeant', status: 'Silver 4' },
    { level: 4, name: 'Captain', status: 'Gold 1' },
  ],
  status: 'Silver 3',
  age: 28,
  height: '183 cm',
  hair: 'Chestnut',
  eyes: 'Grey',
  motivation: 'Protect the roads of the Empire from greenskins and bandits',

  fate: 3,
  fortune: 1,
  resilience: 2,
  resolve: 0,

  xpCurrent: 340,
  xpSpent: 785,
  wounds: { current: 11, max: 14 },
  corruption: 1,
  sin: 0,

  movement: 4,
  wealth: { gc: 12, ss: 8, d: 4 },

  characteristics: [
    { key: 'ws', name: 'Weapon Skill', short: 'WS', init: 33, adv: 10 },
    { key: 'bs', name: 'Ballistic Skill', short: 'BS', init: 38, adv: 5 },
    { key: 's', name: 'Strength', short: 'S', init: 31, adv: 5 },
    { key: 't', name: 'Toughness', short: 'T', init: 35, adv: 5 },
    { key: 'i', name: 'Initiative', short: 'I', init: 32, adv: 5 },
    { key: 'ag', name: 'Agility', short: 'Ag', init: 38, adv: 5 },
    { key: 'dex', name: 'Dexterity', short: 'Dex', init: 29, adv: 0 },
    { key: 'int', name: 'Intelligence', short: 'Int', init: 34, adv: 0 },
    { key: 'wp', name: 'Willpower', short: 'WP', init: 30, adv: 5 },
    { key: 'fel', name: 'Fellowship', short: 'Fel', init: 31, adv: 0 },
  ],

  skills: [
    { name: 'Ride (Horse)', char: 'ag', adv: 15, career: true, advanced: false },
    { name: 'Perception', char: 'i', adv: 10, career: true, advanced: false },
    { name: 'Melee (Basic)', char: 'ws', adv: 10, career: true, grouped: 'Basic', advanced: false },
    { name: 'Ranged (Bow)', char: 'bs', adv: 5, career: true, grouped: 'Bow', advanced: false },
    { name: 'Outdoor Survival', char: 'int', adv: 10, career: true, advanced: false },
    { name: 'Intimidate', char: 's', adv: 5, career: true, advanced: false },
    { name: 'Track', char: 'i', adv: 5, career: true, advanced: true },
    { name: 'Lore (Heraldry)', char: 'fel', adv: 0, career: true, advanced: true },
    { name: 'Athletics', char: 'ag', adv: 5, career: false, advanced: false },
    { name: 'Animal Care', char: 'fel', adv: 5, career: false, advanced: false },
    { name: 'Endurance', char: 't', adv: 10, career: false, advanced: false },
    { name: 'Haggle', char: 'fel', adv: 0, career: false, advanced: false },
  ],

  talents: [
    { name: 'Sure Shot', times: 1, desc: 'No penalty when shooting from a moving mount', career: true },
    { name: 'Sharp', times: 1, desc: 'Double range on visual perception tests', career: true },
    { name: 'Hardy', times: 2, desc: '+T Bonus to every Wound point', career: true },
    { name: 'Lightning Reflexes', times: 1, desc: 'Reroll one Initiative test per combat', career: false },
    { name: 'Menacing', times: 1, desc: '+10 to Intimidate tests', career: false },
  ],

  weapons: [
    { name: 'Hand Weapon (Sword)', group: 'Basic', enc: 1, reach: 'Average', dmg: 'SB+4', qual: ['Defensive'] },
    { name: 'Longbow', group: 'Bow', enc: 1, range: '90', dmg: '4', qual: ['Penetrating'] },
    { name: 'Dagger', group: 'Basic', enc: 0, reach: 'Short', dmg: 'SB+2', qual: [] },
  ],
  armour: [
    { name: 'Mail Shirt', locs: ['Body', 'Arms'], enc: 2, ap: 2, qual: ['Flexible'] },
    { name: 'Open Helm', locs: ['Head'], enc: 1, ap: 1, qual: [] },
    { name: 'Leather Leggings', locs: ['Legs'], enc: 1, ap: 1, qual: [] },
  ],
  ap: { head: 1, arm_l: 2, arm_r: 2, body: 2, leg_l: 1, leg_r: 1, shield: 0 },

  conditions: [
    { type: 'Fatigued', stacks: 1 },
    { type: 'Bleeding', stacks: 0 },
  ],

  criticals: [
    { loc: 'Arm', roll: 42, name: 'Bruised Muscle', effect: 'Pain throbs, –10 WS for 1 Round', days: 2 },
  ],

  trappings: [
    { name: 'Travel Cloak', enc: 1 },
    { name: 'Tinder Box', enc: 0 },
    { name: 'Rope (10m)', enc: 1 },
    { name: 'Torches ×3', enc: 1 },
    { name: 'Spare Clothing', enc: 1 },
    { name: 'Map: Reikland', enc: 0 },
    { name: 'Rations (week)', enc: 1 },
    { name: 'Healing Draught', enc: 0 },
    { name: 'Horn', enc: 0 },
    { name: 'Family Signet Ring', enc: 0 },
  ],

  party: {
    name: 'The Eberfeld Road Wardens',
    short: 'The party has been hired to guard the Eberfeld–Ubersreik road.',
    members: [
      { name: 'Adelheid Vogt', role: 'Pyromancer' },
      { name: 'Brogar Grimmson', role: 'Runesmith' },
      { name: 'Halla Stern', role: 'Anointed' },
    ],
  },

  psychology: ['Fear (large orcs) — short note about the great greenskins'],
  mutations: [],
  ambitionsShort: 'Find the lost caravan from the Hetzenberg Pass',
  ambitionsLong: 'Form a road-warden company in eastern Reikland',
  initials: 'SB',
  accent: '#8b2d2d',
};

const ADELHEID: Character = {
  id: 'c2',
  name: 'Adelheid Vogt',
  species: 'Human',
  class: 'Academic',
  career: 'Wizard',
  careerLevel: 3,
  careerLevelName: 'Pyromancer',
  careerRanks: [
    { level: 1, name: 'Wizard\'s Apprentice', status: 'Brass 4' },
    { level: 2, name: 'Wizard', status: 'Silver 3' },
    { level: 3, name: 'Pyromancer', status: 'Silver 4' },
    { level: 4, name: 'Master Wizard', status: 'Gold 2' },
  ],
  status: 'Silver 4',
  age: 31,
  height: '170 cm',
  hair: 'Auburn',
  eyes: 'Amber',
  motivation: 'Master Aqshy — and find the heretics who burned my master',

  fate: 2,
  fortune: 2,
  resilience: 3,
  resolve: 1,

  xpCurrent: 120,
  xpSpent: 1180,
  wounds: { current: 9, max: 10 },
  corruption: 2,
  sin: 0,

  movement: 4,
  wealth: { gc: 4, ss: 22, d: 6 },

  characteristics: [
    { key: 'ws', name: 'Weapon Skill', short: 'WS', init: 28, adv: 0 },
    { key: 'bs', name: 'Ballistic Skill', short: 'BS', init: 30, adv: 0 },
    { key: 's', name: 'Strength', short: 'S', init: 29, adv: 0 },
    { key: 't', name: 'Toughness', short: 'T', init: 32, adv: 5 },
    { key: 'i', name: 'Initiative', short: 'I', init: 36, adv: 10 },
    { key: 'ag', name: 'Agility', short: 'Ag', init: 34, adv: 5 },
    { key: 'dex', name: 'Dexterity', short: 'Dex', init: 38, adv: 10 },
    { key: 'int', name: 'Intelligence', short: 'Int', init: 40, adv: 20 },
    { key: 'wp', name: 'Willpower', short: 'WP', init: 38, adv: 20 },
    { key: 'fel', name: 'Fellowship', short: 'Fel', init: 33, adv: 10 },
  ],

  skills: [
    { name: 'Channelling (Fire)', char: 'wp', adv: 20, career: true, advanced: true },
    { name: 'Language (Magick)', char: 'int', adv: 20, career: true, advanced: true },
    { name: 'Lore (Magick)', char: 'int', adv: 20, career: true, advanced: true },
    { name: 'Lore (Bright Order)', char: 'int', adv: 15, career: true, advanced: true },
    { name: 'Cool', char: 'wp', adv: 15, career: true, advanced: false },
    { name: 'Perception', char: 'i', adv: 10, career: true, advanced: false },
    { name: 'Intuition', char: 'i', adv: 5, career: true, advanced: false },
    { name: 'Charm', char: 'fel', adv: 10, career: true, advanced: false },
    { name: 'Athletics', char: 'ag', adv: 0, career: false, advanced: false },
    { name: 'Endurance', char: 't', adv: 5, career: false, advanced: false },
  ],

  talents: [
    { name: 'Petty Magic', times: 1, desc: 'Knows the four Petty Magic spells', career: true },
    { name: 'Arcane Magic (Fire)', times: 1, desc: 'Cast spells from the Lore of Fire', career: true },
    { name: 'Aethyric Attunement', times: 1, desc: '+1 SL on channelling tests', career: true },
    { name: 'Read/Write', times: 1, desc: 'Can read and write Reikspiel', career: true },
  ],

  weapons: [
    { name: 'Quarterstaff', group: 'Two-handed', enc: 2, reach: 'Long', dmg: 'SB+3', qual: ['Defensive', 'Pummel'] },
    { name: 'Dagger', group: 'Basic', enc: 0, reach: 'Short', dmg: 'SB+2', qual: [] },
  ],
  armour: [
    { name: 'Robe', locs: ['Body', 'Arms', 'Legs'], enc: 0, ap: 0, qual: ['Practical'] },
  ],
  ap: { head: 0, arm_l: 0, arm_r: 0, body: 0, leg_l: 0, leg_r: 0, shield: 0 },

  conditions: [],

  criticals: [],

  trappings: [
    { name: 'Spellbook', enc: 1 },
    { name: 'Inks & quills', enc: 0 },
    { name: 'Bright Order pendant', enc: 0 },
    { name: 'Candles ×6', enc: 0 },
    { name: 'Salt pouch', enc: 0 },
    { name: 'Notebook of sigils', enc: 0 },
    { name: 'Rations (week)', enc: 1 },
    { name: 'Robes (spare)', enc: 1 },
  ],

  party: {
    name: 'The Eberfeld Road Wardens',
    short: 'The party has been hired to guard the Eberfeld–Ubersreik road. Adelheid joined for the chance to burn a few cultists along the way.',
    members: [
      { name: 'Sigmund Braun', role: 'Roadwarden' },
      { name: 'Brogar Grimmson', role: 'Runesmith' },
      { name: 'Halla Stern', role: 'Anointed' },
    ],
  },

  psychology: ['Hatred (Heretics) — burns to ash, no questions'],
  mutations: [],
  ambitionsShort: 'Cast Burning Blood on the cultist who killed her master',
  ambitionsLong: 'Earn a chair at the Bright Order Colleges in Altdorf',
  initials: 'AV',
  accent: '#9a7d1f',
  isCaster: true,
  spellLore: 'Fire (Aqshy)',
  knownSpells: ['m.candle', 'm.dart', 'm.gust', 'm.warm', 'm.fireball', 'm.crown', 'm.cauterise', 'm.dazzle'],
};

// Lightweight placeholder templates for the remaining roster entries — used by
// the Roster grid; tapping them switches to a sparse template (no spells,
// inherits defaults).
const BROGAR: Character = {
  ...SIGMUND,
  id: 'c3',
  name: 'Brogar Grimmson',
  species: 'Dwarf',
  class: 'Warrior',
  career: 'Runesmith',
  careerLevel: 2,
  careerLevelName: 'Journeyman Runesmith',
  careerRanks: [
    { level: 1, name: 'Apprentice Runesmith', status: 'Silver 2' },
    { level: 2, name: 'Journeyman Runesmith', status: 'Silver 3' },
    { level: 3, name: 'Runesmith', status: 'Silver 5' },
    { level: 4, name: 'Master Runesmith', status: 'Gold 3' },
  ],
  status: 'Silver 2',
  age: 124,
  height: '141 cm',
  hair: 'Iron-grey, braided',
  eyes: 'Coal',
  motivation: 'Avenge a grudge written into the Book of Grudges',
  xpCurrent: 80,
  xpSpent: 920,
  wounds: { current: 16, max: 16 },
  corruption: 0,
  initials: 'BG',
  accent: '#6a5612',
};

const HALLA: Character = {
  id: 'c4',
  name: 'Halla Stern',
  species: 'Human',
  class: 'Academic',
  career: 'Anointed Priest of Shallya',
  careerLevel: 1,
  careerLevelName: 'Anointed',
  careerRanks: [
    { level: 1, name: 'Anointed', status: 'Brass 5' },
    { level: 2, name: 'Cleric', status: 'Silver 3' },
    { level: 3, name: 'Priest', status: 'Silver 4' },
    { level: 4, name: 'High Priest', status: 'Gold 2' },
  ],
  status: 'Brass 5',
  age: 24,
  height: '167 cm',
  hair: 'Pale blonde',
  eyes: 'Pale blue',
  motivation: 'Tend the dying and bring mercy to the road',

  fate: 2,
  fortune: 2,
  resilience: 2,
  resolve: 1,

  xpCurrent: 275,
  xpSpent: 425,
  wounds: { current: 10, max: 11 },
  corruption: 0,
  sin: 0,

  movement: 4,
  wealth: { gc: 2, ss: 14, d: 4 },

  characteristics: [
    { key: 'ws', name: 'Weapon Skill', short: 'WS', init: 30, adv: 5 },
    { key: 'bs', name: 'Ballistic Skill', short: 'BS', init: 28, adv: 0 },
    { key: 's', name: 'Strength', short: 'S', init: 29, adv: 0 },
    { key: 't', name: 'Toughness', short: 'T', init: 32, adv: 5 },
    { key: 'i', name: 'Initiative', short: 'I', init: 33, adv: 5 },
    { key: 'ag', name: 'Agility', short: 'Ag', init: 31, adv: 0 },
    { key: 'dex', name: 'Dexterity', short: 'Dex', init: 34, adv: 5 },
    { key: 'int', name: 'Intelligence', short: 'Int', init: 36, adv: 10 },
    { key: 'wp', name: 'Willpower', short: 'WP', init: 38, adv: 15 },
    { key: 'fel', name: 'Fellowship', short: 'Fel', init: 35, adv: 10 },
  ],

  skills: [
    { name: 'Pray', char: 'fel', adv: 15, career: true, advanced: false },
    { name: 'Heal', char: 'int', adv: 15, career: true, advanced: false },
    { name: 'Charm', char: 'fel', adv: 10, career: true, advanced: false },
    { name: 'Lore (Theology)', char: 'int', adv: 10, career: true, advanced: true },
    { name: 'Lore (Shallya)', char: 'int', adv: 10, career: true, advanced: true },
    { name: 'Cool', char: 'wp', adv: 10, career: true, advanced: false },
    { name: 'Perception', char: 'i', adv: 5, career: true, advanced: false },
    { name: 'Intuition', char: 'i', adv: 5, career: true, advanced: false },
    { name: 'Endurance', char: 't', adv: 5, career: false, advanced: false },
    { name: 'Athletics', char: 'ag', adv: 0, career: false, advanced: false },
  ],

  talents: [
    { name: 'Bless (Shallya)', times: 1, desc: 'Knows the Bless prayer', career: true },
    { name: 'Invoke (Shallya)', times: 1, desc: 'Can invoke Shallya\'s prayers without sin', career: true },
    { name: 'Read/Write', times: 1, desc: 'Can read and write Reikspiel + Classical', career: true },
    { name: 'Kind-hearted', times: 1, desc: '+10 to Charm tests on those in distress', career: false },
  ],

  weapons: [
    { name: 'Quarterstaff', group: 'Two-handed', enc: 2, reach: 'Long', dmg: 'SB+3', qual: ['Defensive', 'Pummel'] },
  ],
  armour: [
    { name: 'Robe', locs: ['Body', 'Arms', 'Legs'], enc: 0, ap: 0, qual: ['Practical'] },
  ],
  ap: { head: 0, arm_l: 0, arm_r: 0, body: 0, leg_l: 0, leg_r: 0, shield: 0 },

  conditions: [],
  criticals: [],

  trappings: [
    { name: 'Holy symbol (dove)', enc: 0 },
    { name: 'Healing salve ×3', enc: 0 },
    { name: 'Bandages', enc: 0 },
    { name: 'Prayer book of Shallya', enc: 1 },
    { name: 'Vestments', enc: 1 },
    { name: 'Rations (week)', enc: 1 },
    { name: 'Lantern', enc: 1 },
  ],

  party: {
    name: 'The Eberfeld Road Wardens',
    short: 'The party has been hired to guard the Eberfeld–Ubersreik road. Halla travels with them to tend the wounded — friend or foe.',
    members: [
      { name: 'Sigmund Braun', role: 'Roadwarden' },
      { name: 'Adelheid Vogt', role: 'Pyromancer' },
      { name: 'Brogar Grimmson', role: 'Runesmith' },
    ],
  },

  psychology: ['Pacifism (will not deal killing blows to non-Chaos creatures)'],
  mutations: [],
  ambitionsShort: 'Establish a Shallyan hospice on the Reikland road',
  ambitionsLong: 'Earn the title of Sister of Shallya at the Couronne hospital',

  initials: 'HS',
  accent: '#3d6b3d',
  isAnointed: true,
  deity: 'Shallya',
  knownPrayers: ['p.blessing', 'p.calm', 'p.staunch', 'p.cure', 'p.bless', 'p.fortify'],
};

export const CHARACTER_TEMPLATES: Record<string, Character> = {
  c1: SIGMUND,
  c2: ADELHEID,
  c3: BROGAR,
  c4: HALLA,
};

export const DEFAULT_CHARACTER_ID = 'c1';

/** Look up a character template, falling back to Sigmund. */
export function getTemplate(id: string): Character {
  return CHARACTER_TEMPLATES[id] ?? CHARACTER_TEMPLATES[DEFAULT_CHARACTER_ID];
}

// Backwards-compat default for code paths not yet ported off the static
// CHARACTER constant. Anything new should call `useCharacter()` instead.
export const CHARACTER: Character = SIGMUND;

export const XP_COSTS = [
  { range: '0–5', cost: 25 },
  { range: '6–10', cost: 30 },
  { range: '11–15', cost: 40 },
  { range: '16–20', cost: 50 },
  { range: '21–25', cost: 70 },
  { range: '26–30', cost: 90 },
  { range: '31–35', cost: 120 },
  { range: '36+', cost: 150 },
];

export type XpKind = 'gain' | 'skill' | 'char' | 'talent' | 'career';

// Seeded XP log per character. The hook copies the seed into the live log on
// first run and appends real entries from there.
export const XP_LOG_SEED: Record<string, Array<{ date: string; reason: string; amount: number; kind: XpKind }>> = {
  c1: [
    { date: '2026.04.14', reason: 'Ride +5 → +10', amount: -30, kind: 'skill' },
    { date: '2026.04.14', reason: 'Initiative +5', amount: -25, kind: 'char' },
    { date: '2026.04.10', reason: 'Session reward: Eberfeld road', amount: 200, kind: 'gain' },
    { date: '2026.04.10', reason: 'Hardy (2nd)', amount: -200, kind: 'talent' },
    { date: '2026.04.03', reason: 'Outdoor Survival +5 → +10', amount: -30, kind: 'skill' },
    { date: '2026.04.03', reason: 'Session reward', amount: 150, kind: 'gain' },
    { date: '2026.03.27', reason: 'Roadwarden — career rank 2', amount: -200, kind: 'career' },
    { date: '2026.03.27', reason: 'Session reward', amount: 175, kind: 'gain' },
  ],
  c2: [
    { date: '2026.04.10', reason: 'Channelling (Fire) +15 → +20', amount: -50, kind: 'skill' },
    { date: '2026.04.10', reason: 'Session reward: Eberfeld road', amount: 200, kind: 'gain' },
    { date: '2026.04.03', reason: 'Intelligence +15 → +20', amount: -50, kind: 'char' },
    { date: '2026.04.03', reason: 'Session reward', amount: 150, kind: 'gain' },
  ],
  c3: [
    { date: '2026.04.10', reason: 'Session reward: Eberfeld road', amount: 200, kind: 'gain' },
  ],
  c4: [
    { date: '2026.04.10', reason: 'Session reward: Eberfeld road', amount: 200, kind: 'gain' },
    { date: '2026.04.03', reason: 'Pray +5 → +10', amount: -30, kind: 'skill' },
  ],
};

// Kept exported for back-compat (existing useXp seed reads this).
export const XP_LOG = XP_LOG_SEED.c1;

export interface RosterEntry {
  id: string;
  name: string;
  career: string;
  level: number;
  species: string;
  status: string;
  wounds: string;
  xp: number;
  initials: string;
  accent: string;
  active?: boolean;
}

export const ROSTER: RosterEntry[] = Object.values(CHARACTER_TEMPLATES).map(c => ({
  id: c.id,
  name: c.name,
  career: c.career,
  level: c.careerLevel,
  species: c.species,
  status: c.status,
  wounds: `${c.wounds.current}/${c.wounds.max}`,
  xp: c.xpCurrent,
  initials: c.initials,
  accent: c.accent,
  active: c.id === DEFAULT_CHARACTER_ID,
}));

// Standard 12 conditions in WFRP 4e.
export const CONDITIONS = [
  'Ablaze', 'Bleeding', 'Blinded', 'Broken', 'Deafened', 'Entangled',
  'Fatigued', 'Poisoned', 'Prone', 'Stunned', 'Surprised', 'Unconscious',
];
