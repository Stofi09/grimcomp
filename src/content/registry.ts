// Runtime content store. Merges all loaded ContentPacks into ID-keyed lookup
// maps. Later packs override earlier ones by id, so a user-imported pack can
// add new entries or replace a core entry.

import type {
  ContentPack, Spell, Prayer, RollTable, XpCostRow,
  Race, Career, SkillDef, TalentDef, WeaponDef, ArmourDef, TrappingDef,
} from './types';

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

  readonly conditions: string[] = [];
  readonly xpCosts: XpCostRow[] = [];

  constructor(packs: ContentPack[]) {
    this.packs = packs;
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
}
