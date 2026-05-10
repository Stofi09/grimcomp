// Sample character data — Sigmund Braun (Roadwarden), English UI labels.

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

export interface Character {
  id: string;
  name: string;
  species: string;
  class: string;
  career: string;
  careerLevel: number;
  careerLevelName: string;
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
}

export const CHARACTER: Character = {
  id: 'c1',
  name: 'Sigmund Braun',
  species: 'Human',
  class: 'Warrior',
  career: 'Roadwarden',
  careerLevel: 2,
  careerLevelName: 'Road Sergeant',
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
};

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

export const XP_LOG: Array<{ date: string; reason: string; amount: number; kind: XpKind }> = [
  { date: '2026.04.14', reason: 'Ride +5 → +10', amount: -30, kind: 'skill' },
  { date: '2026.04.14', reason: 'Initiative +5', amount: -25, kind: 'char' },
  { date: '2026.04.10', reason: 'Session reward: Eberfeld road', amount: 200, kind: 'gain' },
  { date: '2026.04.10', reason: 'Hardy (2nd)', amount: -200, kind: 'talent' },
  { date: '2026.04.03', reason: 'Outdoor Survival +5 → +10', amount: -30, kind: 'skill' },
  { date: '2026.04.03', reason: 'Session reward', amount: 150, kind: 'gain' },
  { date: '2026.03.27', reason: 'Roadwarden — career rank 2', amount: -200, kind: 'career' },
  { date: '2026.03.27', reason: 'Session reward', amount: 175, kind: 'gain' },
];

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

export const ROSTER: RosterEntry[] = [
  { id: 'c1', name: 'Sigmund Braun', career: 'Roadwarden', level: 2, species: 'Human', status: 'Silver 3', wounds: '11/14', xp: 340, initials: 'SB', accent: '#8b2d2d', active: true },
  { id: 'c2', name: 'Adelheid Vogt', career: 'Pyromancer', level: 3, species: 'Human', status: 'Silver 4', wounds: '9/10', xp: 120, initials: 'AV', accent: '#9a7d1f' },
  { id: 'c3', name: 'Brogar Grimmson', career: 'Runesmith', level: 2, species: 'Dwarf', status: 'Silver 2', wounds: '16/16', xp: 80, initials: 'BG', accent: '#6a5612' },
  { id: 'c4', name: 'Halla Stern', career: 'Anointed (Shallya)', level: 1, species: 'Human', status: 'Brass 5', wounds: '10/11', xp: 275, initials: 'HS', accent: '#3d6b3d' },
];

// Standard 12 conditions in WFRP 4e.
export const CONDITIONS = [
  'Ablaze', 'Bleeding', 'Blinded', 'Broken', 'Deafened', 'Entangled',
  'Fatigued', 'Poisoned', 'Prone', 'Stunned', 'Surprised', 'Unconscious',
];
