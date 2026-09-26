// Runtime content store. Merges all loaded ContentPacks into ID-keyed lookup
// maps. Later packs override earlier ones by id, so a user-imported pack can
// add new entries or replace a core entry.

import type {
  ContentPack, Spell, Prayer, RollTable, XpCostRow,
  Race, Career, SkillDef, TalentDef, WeaponDef, ArmourDef, TrappingDef,
  ReferenceDef,
} from './types';

export class ContentRegistry {
  readonly packs: ContentPack[];

  private readonly spellMap = new Map<string, Spell>();
  private readonly legacySpellMap: Map<string, Spell>;
  private readonly prayerMap = new Map<string, Prayer>();
  private readonly tableMap = new Map<string, RollTable>();
  private readonly raceMap = new Map<string, Race>();
  private readonly careerMap = new Map<string, Career>();
  private readonly skillMap = new Map<string, SkillDef>();
  private readonly legacySkillMap: Map<string, SkillDef>;
  private readonly talentMap = new Map<string, TalentDef>();
  private readonly legacyTalentMap: Map<string, TalentDef>;
  private readonly weaponMap = new Map<string, WeaponDef>();
  private readonly armourMap = new Map<string, ArmourDef>();
  private readonly trappingMap = new Map<string, TrappingDef>();
  private readonly referenceMap = new Map<string, ReferenceDef>();

  readonly conditions: string[] = [];
  readonly xpCosts: XpCostRow[] = [];

  constructor(packs: ContentPack[], options: {
    legacySpells?: readonly Spell[];
    legacySkills?: readonly SkillDef[];
    legacyTalents?: readonly TalentDef[];
  } = {}) {
    this.packs = packs;
    this.legacySpellMap = new Map((options.legacySpells ?? []).map(spell => [spell.id, spell]));
    this.legacySkillMap = new Map((options.legacySkills ?? []).map(skill => [skill.id, skill]));
    this.legacyTalentMap = new Map((options.legacyTalents ?? []).map(talent => [talent.id, talent]));
    for (const pack of packs) {
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
      for (const reference of pack.references ?? []) this.referenceMap.set(reference.id, reference);
      // conditions / xpCosts are flat tables rather than id-keyed collections —
      // the last pack to define a section replaces it wholesale.
      if (pack.conditions) {
        this.conditions.splice(0, this.conditions.length, ...pack.conditions);
      }
      if (pack.xpCosts) {
        this.xpCosts.splice(0, this.xpCosts.length, ...pack.xpCosts);
      }
    }
  }

  get allSpells(): Spell[] {
    return [...this.spellMap.values()];
  }

  getSpell(id: string): Spell | undefined {
    return this.spellMap.get(id) ?? this.legacySpellMap.get(id);
  }

  resolveSpells(ids: string[]): Spell[] {
    return ids
      .map(id => this.getSpell(id))
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

  get allTables(): RollTable[] {
    return [...this.tableMap.values()];
  }

  get allReferences(): ReferenceDef[] {
    return [...this.referenceMap.values()];
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

  getSkillDef(id: string): SkillDef | undefined {
    return this.skillMap.get(id) ?? this.legacySkillMap.get(id);
  }

  get allTalentDefs(): TalentDef[] {
    return [...this.talentMap.values()];
  }

  getTalentDef(id: string): TalentDef | undefined {
    return this.talentMap.get(id) ?? this.legacyTalentMap.get(id);
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
}
