// Conservative fallback details for the bundled core career list.
//
// The source career pack contains the names, classes, eligible species, ranks,
// and Status values for all careers, but most entries do not yet carry an
// advance scheme, a career-talent list, or higher-rank requirements. These
// profiles make those careers usable now without pretending the fallback data
// is an exact transcription of a rulebook. Authored fields always win.

import type {
  Career,
  CareerAdvanceScheme,
  CareerRankRequirement,
} from './types';

type CareerProfile = Required<Pick<CareerAdvanceScheme, 'characteristics' | 'skills' | 'talents'>>;

const PROFILES = {
  scholar: {
    characteristics: ['int', 'dex', 'i', 'wp', 'fel', 't'],
    skills: ['Research', 'Lore (Academic)', 'Language (Classical)', 'Evaluate', 'Perception', 'Gossip', 'Heal', 'Trade (Writing)'],
    talents: ['Bookish', 'Read/Write', 'Savant', 'Linguistics', 'Speedreader', 'Super Numerate', 'Tower of Memories', 'Well Prepared'],
  },
  engineer: {
    characteristics: ['dex', 'int', 't', 'i', 'ws', 'wp'],
    skills: ['Trade (Engineer)', 'Evaluate', 'Lore (Engineering)', 'Perception', 'Research', 'Ranged (Blackpowder)', 'Drive', 'Endurance'],
    talents: ['Craftsman', 'Tinker', 'Gunner', 'Super Numerate', 'Savvy', 'Very Strong', 'Numismatics', 'Well Prepared'],
  },
  healer: {
    characteristics: ['int', 'dex', 'i', 'wp', 't', 'fel'],
    skills: ['Heal', 'Lore (Medicine)', 'Trade (Apothecary)', 'Perception', 'Intuition', 'Research', 'Charm', 'Endurance'],
    talents: ['Field Dressing', 'Surgery', 'Pharmacist', 'Concoct', 'Read/Write', 'Resistance', 'Savvy', 'Well Prepared'],
  },
  cleric: {
    characteristics: ['fel', 'wp', 'int', 'i', 't', 'ws'],
    skills: ['Pray', 'Lore (Theology)', 'Charm', 'Heal', 'Cool', 'Intuition', 'Leadership', 'Melee (Basic)'],
    talents: ['Bless', 'Invoke', 'Holy Visions', 'Impassioned Zeal', 'Public Speaker', 'Pure Soul', 'Read/Write', 'Strong-minded'],
  },
  mage: {
    characteristics: ['wp', 'int', 'i', 'dex', 't', 'fel'],
    skills: ['Channelling (Any)', 'Language (Magick)', 'Lore (Magick)', 'Intuition', 'Perception', 'Cool', 'Research', 'Dodge'],
    talents: ['Aethyric Attunement', 'Arcane Magic', 'Instinctive Diction', 'Petty Magic', 'Second Sight', 'War Wizard', 'Read/Write', 'Iron Will'],
  },
  agitator: {
    characteristics: ['fel', 'wp', 'i', 'int', 'ag', 't'],
    skills: ['Charm', 'Leadership', 'Gossip', 'Intuition', 'Language (Reikspiel)', 'Lore (Politics)', 'Cool', 'Dodge'],
    talents: ['Public Speaker', 'Master Orator', 'Impassioned Zeal', 'Argumentative', 'Cat-tongued', 'Gregarious', 'Schemer', 'Suave'],
  },
  artisan: {
    characteristics: ['dex', 'int', 't', 'fel', 'ws', 'i'],
    skills: ['Trade (Any)', 'Evaluate', 'Haggle', 'Gossip', 'Perception', 'Research', 'Endurance', 'Melee (Basic)'],
    talents: ['Craftsman', 'Master Tradesman', 'Tinker', 'Dealmaker', 'Read/Write', 'Strong Back', 'Well Prepared', 'Artistic'],
  },
  investigator: {
    characteristics: ['i', 'int', 'fel', 'wp', 'ag', 'dex'],
    skills: ['Perception', 'Intuition', 'Gossip', 'Research', 'Lore (Law)', 'Charm', 'Stealth (Urban)', 'Pick Lock'],
    talents: ['Nose for Trouble', 'Sixth Sense', 'Read/Write', 'Savvy', 'Shadow', 'Schemer', 'Lip Reading', 'Sharp'],
  },
  merchant: {
    characteristics: ['fel', 'int', 'i', 'wp', 'dex', 't'],
    skills: ['Haggle', 'Evaluate', 'Gossip', 'Charm', 'Bribery', 'Language (Any)', 'Lore (Trade)', 'Drive'],
    talents: ['Dealmaker', 'Briber', 'Numismatics', 'Read/Write', 'Savvy', 'Suave', 'Super Numerate', 'Wealthy'],
  },
  urban: {
    characteristics: ['fel', 'i', 'ag', 'int', 'dex', 't'],
    skills: ['Gossip', 'Perception', 'Intuition', 'Charm', 'Dodge', 'Endurance', 'Stealth (Urban)', 'Melee (Basic)'],
    talents: ['Alley Cat', 'Beneath Notice', 'Gregarious', 'Nose for Trouble', 'Savvy', 'Stone Soup', 'Suave', 'Well Prepared'],
  },
  watch: {
    characteristics: ['ws', 't', 'i', 'fel', 's', 'wp'],
    skills: ['Melee (Basic)', 'Perception', 'Intimidate', 'Cool', 'Athletics', 'Dodge', 'Gossip', 'Leadership'],
    talents: ['Drilled', 'Combat Aware', 'Shieldsman', 'Strike to Stun', 'Hardy', 'Menacing', 'Resolute', 'War Leader'],
  },
  courtier: {
    characteristics: ['fel', 'int', 'i', 'wp', 'dex', 'ag'],
    skills: ['Charm', 'Gossip', 'Intuition', 'Lore (Heraldry)', 'Language (Any)', 'Lore (Politics)', 'Perception', 'Leadership'],
    talents: ['Etiquette', 'Noble Blood', 'Schemer', 'Suave', 'Attractive', 'Cat-tongued', 'Read/Write', 'Wealthy'],
  },
  artist: {
    characteristics: ['dex', 'fel', 'i', 'int', 'ag', 'wp'],
    skills: ['Art (Any)', 'Entertain (Any)', 'Perception', 'Intuition', 'Charm', 'Evaluate', 'Gossip', 'Trade (Art Supplies)'],
    talents: ['Artistic', 'Perfect Pitch', 'Mimic', 'Attractive', 'Craftsman', 'Gregarious', 'Suave', 'Well Prepared'],
  },
  duellist: {
    characteristics: ['ws', 'ag', 'i', 'dex', 'fel', 'wp'],
    skills: ['Melee (Fencing)', 'Dodge', 'Athletics', 'Cool', 'Intuition', 'Perception', 'Charm', 'Gossip'],
    talents: ['Beat Blade', 'Disarm', 'Feint', 'Reaction Strike', 'Reversal', 'Riposte', 'Step Aside', 'Combat Reflexes'],
  },
  servant: {
    characteristics: ['fel', 'ag', 'dex', 'i', 'int', 't'],
    skills: ['Gossip', 'Perception', 'Intuition', 'Charm', 'Stealth (Urban)', 'Trade (Household)', 'Endurance', 'Dodge'],
    talents: ['Beneath Notice', 'Etiquette', 'Supportive', 'Well Prepared', 'Strong Back', 'Savvy', 'Acute Sense', 'Read/Write'],
  },
  hedge: {
    characteristics: ['wp', 'int', 'i', 'fel', 'ag', 't'],
    skills: ['Channelling (Hedgecraft)', 'Language (Magick)', 'Lore (Herbs)', 'Intuition', 'Perception', 'Heal', 'Charm Animal', 'Trade (Herbalist)'],
    talents: ['Petty Magic', 'Second Sight', 'Concoct', 'Pharmacist', 'Animal Affinity', 'Sixth Sense', 'Resistance', 'Strong-minded'],
  },
  hunter: {
    characteristics: ['bs', 'i', 'ag', 't', 's', 'int'],
    skills: ['Ranged (Bow)', 'Track', 'Perception', 'Stealth (Rural)', 'Set Trap', 'Endurance', 'Athletics', 'Lore (Beasts)'],
    talents: ["Hunter's Eye", 'Trapper', 'Marksman', 'Rover', 'Strider', 'Accurate Shot', 'Sharp', 'Sure Shot'],
  },
  labourer: {
    characteristics: ['s', 't', 'ws', 'ag', 'dex', 'i'],
    skills: ['Endurance', 'Athletics', 'Melee (Basic)', 'Trade (Labour)', 'Climb', 'Perception', 'Intimidate', 'Lore (Local)'],
    talents: ['Strong Back', 'Very Strong', 'Hardy', 'Sturdy', 'Tenacious', 'Resistance', 'Stone Soup', 'Well Prepared'],
  },
  mystic: {
    characteristics: ['wp', 'i', 'fel', 'int', 'ag', 't'],
    skills: ['Intuition', 'Perception', 'Charm', 'Lore (Fortune)', 'Language (Any)', 'Cool', 'Gossip', 'Entertain (Storytelling)'],
    talents: ['Second Sight', 'Sixth Sense', 'Holy Visions', 'Mimic', 'Public Speaker', 'Luck', 'Strong-minded', 'Tower of Memories'],
  },
  ranger: {
    characteristics: ['ag', 'i', 't', 'bs', 'int', 'wp'],
    skills: ['Perception', 'Track', 'Navigation', 'Stealth (Rural)', 'Endurance', 'Athletics', 'Ranged (Bow)', 'Lore (Local)'],
    talents: ['Orientation', 'Rover', 'Seasoned Traveller', 'Strider', 'Fleet Footed', 'Sharp', 'Sixth Sense', 'Trapper'],
  },
  coach: {
    characteristics: ['ag', 'i', 'bs', 't', 'fel', 'int'],
    skills: ['Drive', 'Animal Care', 'Ranged (Crossbow)', 'Perception', 'Navigation', 'Gossip', 'Endurance', 'Melee (Basic)'],
    talents: ['Crack the Whip', 'Roughrider', 'Seasoned Traveller', 'Orientation', 'Rapid Reload', 'Coolheaded', 'Well Prepared', 'Trick Riding'],
  },
  entertainer: {
    characteristics: ['fel', 'ag', 'dex', 'i', 'wp', 't'],
    skills: ['Entertain (Any)', 'Charm', 'Gossip', 'Athletics', 'Dodge', 'Sleight of Hand', 'Play (Any)', 'Intuition'],
    talents: ['Attractive', 'Contortionist', 'Mimic', 'Perfect Pitch', 'Public Speaker', 'Suave', 'Flee!', 'Well Prepared'],
  },
  zealot: {
    characteristics: ['wp', 't', 's', 'ws', 'fel', 'i'],
    skills: ['Pray', 'Endurance', 'Cool', 'Intimidate', 'Melee (Flail)', 'Lore (Theology)', 'Athletics', 'Heal'],
    talents: ['Flagellant', 'Frenzy', 'Impassioned Zeal', 'Holy Hatred', 'Fearless', 'Hardy', 'Iron Will', 'Pure Soul'],
  },
  river: {
    characteristics: ['s', 't', 'ag', 'i', 'dex', 'ws'],
    skills: ['Row', 'Sail', 'Swim', 'Perception', 'Navigation', 'Endurance', 'Melee (Basic)', 'Lore (Riverways)'],
    talents: ['Waterman', 'River Guide', 'Strong Swimmer', 'Fisherman', 'Old Salt', 'Sea Legs', 'Orientation', 'Strong Back'],
  },
  smuggler: {
    characteristics: ['ag', 'i', 'fel', 'dex', 'int', 'wp'],
    skills: ['Stealth (Rural)', 'Row', 'Sail', 'Haggle', 'Bribery', 'Perception', 'Intuition', 'Lore (Riverways)'],
    talents: ['Criminal', 'Briber', 'Dealmaker', 'Shadow', 'River Guide', 'Schemer', 'Flee!', 'Kingpin'],
  },
  rogue: {
    characteristics: ['fel', 'ag', 'i', 'dex', 'int', 'wp'],
    skills: ['Charm', 'Gossip', 'Intuition', 'Bribery', 'Stealth (Urban)', 'Dodge', 'Sleight of Hand', 'Haggle'],
    talents: ['Blather', 'Briber', 'Cat-tongued', 'Criminal', 'Diceman', 'Schemer', 'Suave', 'Alley Cat'],
  },
  thief: {
    characteristics: ['ag', 'dex', 'i', 'int', 'fel', 'wp'],
    skills: ['Stealth (Urban)', 'Pick Lock', 'Sleight of Hand', 'Perception', 'Athletics', 'Climb', 'Dodge', 'Evaluate'],
    talents: ['Alley Cat', 'Break and Enter', 'Catfall', 'Criminal', 'Nimble Fingered', 'Shadow', 'Scale Sheer Surface', 'Flee!'],
  },
  cavalry: {
    characteristics: ['ws', 'ag', 's', 't', 'i', 'wp'],
    skills: ['Ride (Horse)', 'Melee (Cavalry)', 'Animal Care', 'Athletics', 'Endurance', 'Perception', 'Cool', 'Leadership'],
    talents: ['Roughrider', 'Trick Riding', 'Drilled', 'Combat Aware', 'Warrior Born', 'Strong Legs', 'Relentless', 'Shieldsman'],
  },
  fighter: {
    characteristics: ['ws', 's', 't', 'ag', 'i', 'wp'],
    skills: ['Melee (Basic)', 'Dodge', 'Athletics', 'Endurance', 'Intimidate', 'Cool', 'Perception', 'Melee (Brawling)'],
    talents: ['Combat Master', 'Dirty Fighting', 'Furious Assault', 'In-fighter', 'Iron Jaw', 'Strike Mighty Blow', 'Strike to Injure', 'Warrior Born'],
  },
  soldier: {
    characteristics: ['ws', 'bs', 't', 's', 'i', 'wp'],
    skills: ['Melee (Basic)', 'Ranged (Any)', 'Athletics', 'Endurance', 'Cool', 'Dodge', 'Perception', 'Leadership'],
    talents: ['Drilled', 'Combat Aware', 'Rapid Reload', 'Shieldsman', 'Strike Mighty Blow', 'Resolute', 'War Leader', 'Warrior Born'],
  },
  knight: {
    characteristics: ['ws', 's', 't', 'ag', 'i', 'fel'],
    skills: ['Melee (Cavalry)', 'Ride (Horse)', 'Leadership', 'Charm', 'Lore (Heraldry)', 'Athletics', 'Cool', 'Intuition'],
    talents: ['Noble Blood', 'Roughrider', 'Shieldsman', 'Strike Mighty Blow', 'War Leader', 'Etiquette', 'Fearless', 'Inspiring'],
  },
  slayer: {
    characteristics: ['ws', 's', 't', 'ag', 'i', 'wp'],
    skills: ['Melee (Two-handed)', 'Endurance', 'Athletics', 'Cool', 'Intimidate', 'Dodge', 'Perception', 'Lore (Monsters)'],
    talents: ['Slayer', 'Frenzy', 'Fearless', 'Hardy', 'Very Strong', 'Relentless', 'Strike Mighty Blow', 'Strike to Injure'],
  },
  warriorPriest: {
    characteristics: ['ws', 's', 't', 'wp', 'fel', 'i'],
    skills: ['Pray', 'Melee (Basic)', 'Lore (Theology)', 'Heal', 'Leadership', 'Cool', 'Endurance', 'Intimidate'],
    talents: ['Bless', 'Invoke', 'Holy Hatred', 'Impassioned Zeal', 'Shieldsman', 'Strike Mighty Blow', 'Pure Soul', 'Inspiring'],
  },
} satisfies Record<string, CareerProfile>;

type ProfileName = keyof typeof PROFILES;

const CAREER_PROFILES: Record<string, ProfileName> = {
  'car.apothecary': 'healer',
  'car.engineer': 'engineer',
  'car.lawyer': 'scholar',
  'car.nun': 'cleric',
  'car.physician': 'healer',
  'car.priest': 'cleric',
  'car.scholar': 'scholar',
  'car.wizard': 'mage',
  'car.agitator': 'agitator',
  'car.artisan': 'artisan',
  'car.beggar': 'urban',
  'car.investigator': 'investigator',
  'car.merchant': 'merchant',
  'car.rat-catcher': 'urban',
  'car.townsman': 'merchant',
  'car.watchman': 'watch',
  'car.advisor': 'courtier',
  'car.artist': 'artist',
  'car.duellist': 'duellist',
  'car.envoy': 'courtier',
  'car.noble': 'courtier',
  'car.servant': 'servant',
  'car.spy': 'investigator',
  'car.warden': 'courtier',
  'car.bailiff': 'watch',
  'car.hedge-witch': 'hedge',
  'car.herbalist': 'healer',
  'car.hunter': 'hunter',
  'car.miner': 'labourer',
  'car.mystic': 'mystic',
  'car.scout': 'ranger',
  'car.villager': 'labourer',
  'car.bounty-hunter': 'ranger',
  'car.coachman': 'coach',
  'car.entertainer': 'entertainer',
  'car.flagellant': 'zealot',
  'car.messenger': 'ranger',
  'car.pedlar': 'merchant',
  'car.roadwarden': 'cavalry',
  'car.witch-hunter': 'investigator',
  'car.boatman': 'river',
  'car.huffer': 'river',
  'car.riverwarden': 'watch',
  'car.riverwoman': 'river',
  'car.seaman': 'river',
  'car.smuggler': 'smuggler',
  'car.stevedore': 'labourer',
  'car.wrecker': 'smuggler',
  'car.bawd': 'rogue',
  'car.charlatan': 'rogue',
  'car.fence': 'merchant',
  'car.grave-robber': 'thief',
  'car.outlaw': 'ranger',
  'car.racketeer': 'rogue',
  'car.thief': 'thief',
  'car.witch': 'hedge',
  'car.cavalryman': 'cavalry',
  'car.guard': 'watch',
  'car.knight': 'knight',
  'car.pit-fighter': 'fighter',
  'car.protagonist': 'fighter',
  'car.soldier': 'soldier',
  'car.slayer': 'slayer',
  'car.warrior-priest': 'warriorPriest',
  'car.runesmith': 'engineer',
};

const requirementFallback = (
  skills: string[],
  level: number,
): CareerRankRequirement[] => {
  const minimum = Math.max(5, (level - 1) * 5);
  const count = Math.min(skills.length, Math.max(2, level));
  return skills.slice(0, count).map(skill => ({ skill, min: minimum }));
};

/**
 * Fill gaps on a bundled core career. This never overwrites authored schemes
 * or rank requirements; it only supplies missing fields and marks the result
 * so the UI can be honest about its approximate provenance.
 */
export function enrichCoreCareer(career: Career): Career {
  const profileName = CAREER_PROFILES[career.id];
  if (!profileName) return career;
  const profile = PROFILES[profileName];
  const existing = career.advanceScheme;
  // A rank-one career needs eight skills for its 40 free creation advances.
  // Keep every authored skill in order and use the conservative profile only
  // to fill a short authored list; never replace authored choices.
  const skills = [...new Set([...(existing?.skills ?? []), ...profile.skills])].slice(0, 8);
  const scheme: CareerAdvanceScheme = {
    characteristics: existing?.characteristics?.length
      ? existing.characteristics
      : profile.characteristics,
    skills,
    talents: existing?.talents?.length ? existing.talents : profile.talents,
  };
  const ranks = career.ranks.map(rank => {
    if (rank.level <= 1 || (rank.requirements?.length ?? 0) > 0) return rank;
    return { ...rank, requirements: requirementFallback(skills, rank.level) };
  });

  return {
    ...career,
    advanceScheme: scheme,
    ranks,
    approximate: true,
  };
}
