// Runtime content store. Folds all loaded ContentPacks into ID-keyed lookup
// maps (entities) and last-pack-wins singletons (flat config). Later packs
// override earlier ones, so a user-imported pack can add new entries or
// replace a core entry / config section.
//
// v2 extends the original entity set (spells, prayers, tables, races, careers,
// skills, talents, weapons, armour, trappings) with character templates and a
// pile of config singletons (conditions, xpRules, characteristics, creation,
// hit locations, criticals, wounds rules, deities, note seeds, xp-log seeds).

import type {
  ContentPack, Spell, Prayer, RollTable,
  Race, Career, SkillDef, TalentDef, WeaponDef, ArmourDef, TrappingDef,
  ConditionDef, XpRules, XpCostBand, CharacteristicDef, CreationConfig,
  HitLocationRow, HitLocationKey, CriticalDef, WoundsRules, Deity,
  NoteSeedsConfig, XpEntry, SystemRules, SystemOverlay,
} from './types';
import { xpCostRowsToBands } from './validate';
import { DEFAULT_TEST_RULES } from '@/utils/roll';
import type { Character } from '@/data/character';

/** The canonical 10-characteristic roster, in canonical order. */
export const DEFAULT_CHARACTERISTICS: CharacteristicDef[] = [
  { key: 'ws', name: 'Weapon Skill', short: 'WS' },
  { key: 'bs', name: 'Ballistic Skill', short: 'BS' },
  { key: 's', name: 'Strength', short: 'S' },
  { key: 't', name: 'Toughness', short: 'T' },
  { key: 'i', name: 'Initiative', short: 'I' },
  { key: 'ag', name: 'Agility', short: 'Ag' },
  { key: 'dex', name: 'Dexterity', short: 'Dex' },
  { key: 'int', name: 'Intelligence', short: 'Int' },
  { key: 'wp', name: 'Willpower', short: 'WP' },
  { key: 'fel', name: 'Fellowship', short: 'Fel' },
];

/** Baseline XP economy used until a pack overlays it. */
export const DEFAULT_XP_RULES: XpRules = {
  characteristicAdvances: [
    { min: 0, max: 5, cost: 25 },
    { min: 6, max: 10, cost: 30 },
    { min: 11, max: 15, cost: 40 },
    { min: 16, max: 20, cost: 50 },
    { min: 21, max: 25, cost: 70 },
    { min: 26, max: 30, cost: 90 },
    { min: 31, max: 35, cost: 120 },
    { min: 36, max: 40, cost: 150 },
    { min: 41, max: 45, cost: 190 },
    { min: 46, max: 999, cost: 230 },
  ],
  skillAdvances: [
    { min: 0, max: 5, cost: 10 },
    { min: 6, max: 10, cost: 15 },
    { min: 11, max: 15, cost: 20 },
    { min: 16, max: 20, cost: 30 },
    { min: 21, max: 25, cost: 40 },
    { min: 26, max: 30, cost: 60 },
    { min: 31, max: 35, cost: 80 },
    { min: 36, max: 40, cost: 110 },
    { min: 41, max: 45, cost: 140 },
    { min: 46, max: 999, cost: 180 },
  ],
  talentCostPerRank: 100,
  careerAdvanceCost: 100,
  nonCareerSkillMultiplier: 2,
  quickAwards: [50, 100, 150, 200],
  buyStep: 5,
};

const DEFAULT_WOUNDS_RULES: WoundsRules = {
  smallSizes: ['Small'],
  bonusTalent: 'Hardy',
};

/**
 * Baseline game-system mechanics — WFRP 4e. Packs overlay any subset via the
 * `system` section, so a different game can swap the dice, the derived-stat
 * formulas, the currency, and the magic/faith/combat bindings without code.
 */
export const DEFAULT_SYSTEM: SystemRules = {
  test: DEFAULT_TEST_RULES,
  formulas: {
    bonus: 'floor(value / 10)',
    maxWounds: '(small ? 0 : sb) + 2*tb + wpb + bonusRanks * tb',
    walk: 'm * 2',
    run: 'm * 4',
    maxEncumbrance: 'sb + tb',
    corruptionThreshold: 'max(1, tb + wpb)',
    restRecovery: 'tb',
  },
  currency: {
    units: [
      { key: 'gc', label: 'GC', factor: 240 },
      { key: 'ss', label: 'SS', factor: 12 },
      { key: 'd', label: 'BP', factor: 1 },
    ],
    baseLabel: 'brass',
  },
  magic: {
    channellingSkillPrefix: 'Channelling',
    castSkill: 'Language (Magick)',
    channelChar: 'wp',
    castChar: 'int',
    minorMiscastTable: 'miscast-minor',
    majorMiscastTable: 'miscast-major',
  },
  faith: {
    praySkill: 'Pray',
    prayChar: 'fel',
    wrathTable: 'wrath',
    wrathBonusPerSin: 10,
  },
  combat: {
    rangedGroupPattern: 'bow|cross|sling|throw|gun|fire',
    meleeChar: 'ws',
    rangedChar: 'bs',
    meleeSkillPattern: 'Melee ({group})',
    rangedSkillPattern: 'Ranged ({group})',
  },
};

/**
 * Field-by-field overlay of one `system` subsection. JSON cannot express
 * undefined, so a pack writes an explicit null to REMOVE an optional field
 * inherited from earlier packs (e.g. "sl": null for a system without success
 * levels, or "autoSuccess": null to drop the auto-success band).
 */
function overlayFields<T extends object>(base: T, overlay: Partial<T> | undefined): T {
  if (!overlay) return base;
  const merged = { ...base, ...overlay } as Record<string, unknown>;
  for (const k of Object.keys(merged)) {
    if (merged[k] === null) delete merged[k];
  }
  return merged as T;
}

/** Merge a pack's partial `system` section onto the resolved rules. */
function overlaySystem(base: SystemRules, overlay: SystemOverlay): SystemRules {
  return {
    test: overlayFields(base.test, overlay.test),
    formulas: overlayFields(base.formulas, overlay.formulas),
    currency: overlayFields(base.currency, overlay.currency),
    magic: overlayFields(base.magic, overlay.magic),
    faith: overlayFields(base.faith, overlay.faith),
    combat: overlayFields(base.combat, overlay.combat),
  };
}

export class ContentRegistry {
  readonly packs: ContentPack[];

  private readonly spellMap = new Map<string, Spell>();
  private readonly prayerMap = new Map<string, Prayer>();
  private readonly tableMap = new Map<string, RollTable>();
  private readonly raceMap = new Map<string, Race>();
  private readonly careerMap = new Map<string, Career>();
  private readonly skillMap = new Map<string, SkillDef>();
  private readonly talentMap = new Map<string, TalentDef>();
  private readonly weaponMap = new Map<string, WeaponDef>();
  private readonly armourMap = new Map<string, ArmourDef>();
  private readonly trappingMap = new Map<string, TrappingDef>();
  private readonly deityMap = new Map<string, Deity>();
  private readonly characterMap = new Map<string, Character>();

  // Last-pack-wins singletons / flat tables.
  private _conditions: ConditionDef[] = [];
  private _xpRules: XpRules = { ...DEFAULT_XP_RULES };
  private _characteristics: CharacteristicDef[] = [...DEFAULT_CHARACTERISTICS];
  private _hitLocations: HitLocationRow[] = [];
  private _figureLabels: Partial<Record<HitLocationKey, string>> = {};
  private _criticals: CriticalDef[] = [];
  private _woundsRules: WoundsRules = { ...DEFAULT_WOUNDS_RULES };
  private _system: SystemRules = {
    test: { ...DEFAULT_SYSTEM.test },
    formulas: { ...DEFAULT_SYSTEM.formulas },
    currency: { ...DEFAULT_SYSTEM.currency },
    magic: { ...DEFAULT_SYSTEM.magic },
    faith: { ...DEFAULT_SYSTEM.faith },
    combat: { ...DEFAULT_SYSTEM.combat },
  };
  private _creation: CreationConfig | undefined;
  private _noteSeeds: NoteSeedsConfig | undefined;
  private _xpLogSeeds: Record<string, XpEntry[]> = {};

  constructor(packs: ContentPack[]) {
    this.packs = packs;
    for (const pack of packs) {
      // id-keyed entity sections — merge last-pack-wins per id, insertion
      // order preserved.
      for (const s of pack.spells ?? []) this.spellMap.set(s.id, s);
      for (const p of pack.prayers ?? []) this.prayerMap.set(p.id, p);
      for (const t of pack.tables ?? []) this.tableMap.set(t.id, t);
      for (const r of pack.races ?? []) this.raceMap.set(r.id, r);
      for (const c of pack.careers ?? []) this.careerMap.set(c.id, c);
      for (const sk of pack.skills ?? []) this.skillMap.set(sk.id, sk);
      for (const tl of pack.talents ?? []) this.talentMap.set(tl.id, tl);
      for (const w of pack.weapons ?? []) this.weaponMap.set(w.id, w);
      for (const a of pack.armour ?? []) this.armourMap.set(a.id, a);
      for (const tr of pack.trappings ?? []) this.trappingMap.set(tr.id, tr);
      for (const d of pack.deities ?? []) this.deityMap.set(d.id, d);
      for (const ch of pack.characters ?? []) this.characterMap.set(ch.id, ch);

      // Flat singletons — the last pack to define a section replaces it
      // wholesale.
      if (pack.conditions) {
        this._conditions = this.normalizeConditions(pack.conditions);
      }
      if (pack.characteristics) {
        this._characteristics = pack.characteristics;
      }
      if (pack.hitLocations) {
        this._hitLocations = pack.hitLocations;
      }
      if (pack.figureLabels) {
        this._figureLabels = { ...this._figureLabels, ...pack.figureLabels };
      }
      if (pack.criticals) {
        this._criticals = pack.criticals;
      }
      if (pack.woundsRules) {
        this._woundsRules = pack.woundsRules;
      }
      if (pack.creation) {
        this._creation = pack.creation;
      }
      if (pack.noteSeeds) {
        this._noteSeeds = pack.noteSeeds;
      }

      // system: each subsection overlays field-by-field onto prior values, so
      // a pack can change just the SL formula or just the currency labels.
      if (pack.system) {
        this._system = overlaySystem(this._system, pack.system);
      }

      // xpRules: start from prior values, apply the pack's partial overlay,
      // then fold any legacy v1 xpCosts rows into characteristicAdvances.
      if (pack.xpRules) {
        this._xpRules = this.overlayXpRules(this._xpRules, pack.xpRules);
      }
      if (pack.xpCosts && pack.xpCosts.length > 0) {
        const bands = xpCostRowsToBands(pack.xpCosts);
        if (bands.length > 0) {
          this._xpRules = { ...this._xpRules, characteristicAdvances: bands };
        }
      }

      // xpLogSeeds: shallow-merge the Record across packs (later packs override
      // per charId).
      if (pack.xpLogSeeds) {
        this._xpLogSeeds = { ...this._xpLogSeeds, ...pack.xpLogSeeds };
      }
    }
  }

  private normalizeConditions(raw: Array<ConditionDef | string>): ConditionDef[] {
    return raw.map(c => (typeof c === 'string' ? { name: c } : c));
  }

  private overlayXpRules(base: XpRules, overlay: Partial<XpRules>): XpRules {
    const next: XpRules = { ...base };
    if (overlay.characteristicAdvances !== undefined) {
      next.characteristicAdvances = overlay.characteristicAdvances as XpCostBand[];
    }
    if (overlay.skillAdvances !== undefined) {
      next.skillAdvances = overlay.skillAdvances as XpCostBand[];
    }
    if (overlay.talentCostPerRank !== undefined) next.talentCostPerRank = overlay.talentCostPerRank;
    if (overlay.careerAdvanceCost !== undefined) next.careerAdvanceCost = overlay.careerAdvanceCost;
    if (overlay.nonCareerSkillMultiplier !== undefined) next.nonCareerSkillMultiplier = overlay.nonCareerSkillMultiplier;
    if (overlay.quickAwards !== undefined) next.quickAwards = overlay.quickAwards;
    if (overlay.buyStep !== undefined) next.buyStep = overlay.buyStep;
    return next;
  }

  // --- Entity getters (original surface) ---

  get allSpells(): Spell[] {
    return [...this.spellMap.values()];
  }

  getSpell(id: string): Spell | undefined {
    return this.spellMap.get(id);
  }

  resolveSpells(ids: string[]): Spell[] {
    return ids
      .map(id => this.spellMap.get(id))
      .filter((s): s is Spell => s !== undefined);
  }

  get allPrayers(): Prayer[] {
    return [...this.prayerMap.values()];
  }

  getPrayer(id: string): Prayer | undefined {
    return this.prayerMap.get(id);
  }

  resolvePrayers(ids: string[]): Prayer[] {
    return ids
      .map(id => this.prayerMap.get(id))
      .filter((p): p is Prayer => p !== undefined);
  }

  getTable(id: string): RollTable | undefined {
    return this.tableMap.get(id);
  }

  get allRaces(): Race[] {
    return [...this.raceMap.values()];
  }

  getRace(id: string): Race | undefined {
    return this.raceMap.get(id);
  }

  get allCareers(): Career[] {
    return [...this.careerMap.values()];
  }

  getCareer(id: string): Career | undefined {
    return this.careerMap.get(id);
  }

  get allSkillDefs(): SkillDef[] {
    return [...this.skillMap.values()];
  }

  get allTalentDefs(): TalentDef[] {
    return [...this.talentMap.values()];
  }

  get allWeapons(): WeaponDef[] {
    return [...this.weaponMap.values()];
  }

  get allArmour(): ArmourDef[] {
    return [...this.armourMap.values()];
  }

  get allTrappings(): TrappingDef[] {
    return [...this.trappingMap.values()];
  }

  // --- v2 config singletons + new entities ---

  get conditions(): ConditionDef[] {
    return this._conditions;
  }

  get xpRules(): XpRules {
    return this._xpRules;
  }

  get characteristics(): CharacteristicDef[] {
    return this._characteristics;
  }

  /** Alias of `characteristics`, kept for callers that prefer the longer name. */
  get characteristicDefs(): CharacteristicDef[] {
    return this._characteristics;
  }

  get creation(): CreationConfig | undefined {
    return this._creation;
  }

  get hitLocations(): HitLocationRow[] {
    return this._hitLocations;
  }

  get figureLabels(): Partial<Record<HitLocationKey, string>> {
    return this._figureLabels;
  }

  get criticals(): CriticalDef[] {
    return this._criticals;
  }

  get woundsRules(): WoundsRules {
    return this._woundsRules;
  }

  get system(): SystemRules {
    return this._system;
  }

  get allDeities(): Deity[] {
    return [...this.deityMap.values()];
  }

  getDeity(id: string): Deity | undefined {
    return this.deityMap.get(id);
  }

  get noteSeeds(): NoteSeedsConfig | undefined {
    return this._noteSeeds;
  }

  get allCharacterTemplates(): Character[] {
    return [...this.characterMap.values()];
  }

  getCharacterTemplate(id: string): Character | undefined {
    return this.characterMap.get(id);
  }

  get xpLogSeeds(): Record<string, XpEntry[]> {
    return this._xpLogSeeds;
  }
}
