# Grim Companion (web)

A grimdark fantasy RPG character companion, rebuilt as a **plain React + Vite static site** — no iOS/Android dependency. It ships as static files (`pnpm build`) you can host anywhere, and its authored rules content lives in editable JSON so spells, races, careers, the XP economy, character creation, and even the starter characters can be added, removed, or rebalanced **without touching code or rebuilding**. Small built-in fallbacks keep incomplete packs usable and are identified as approximate where they supply rule details.

This is a browser counterpart to the Expo/React-Native app kept at the repo root. It shares the parchment look and main character-companion workflows, while the web build also provides a content editor and a more extensively configurable rules runtime.

---

## Quick start

```bash
cd web
pnpm install
pnpm dev        # local dev server (hot reload)
pnpm build      # static production build → web/dist/
pnpm preview    # serve the production build locally
pnpm tsc        # type-check the app (test files run under Vitest, see below)
pnpm lint       # ESLint (typescript-eslint + react-hooks)
pnpm test       # run the unit suite once (Vitest)
pnpm test:coverage # run the full suite with V8 coverage reports under coverage/
pnpm test:native # focused root-native regressions through this Vitest toolchain
pnpm test:watch # run the unit suite in watch mode
```

Deploy by copying **`web/dist/`** to any static host (GitHub Pages, Netlify, Vercel, S3, nginx, a USB stick). The build uses relative asset paths (`base: './'`), so it works from a subdirectory too — no server config required.

The app stores all player data (characters, advances, wounds, XP, notes, imported packs) in the browser's **localStorage** — nothing is sent anywhere, and it works fully offline. Storage belongs to that browser profile and site origin; clearing site data removes it, so use the Settings exports described under [Backup, sharing & portability](#backup-sharing--portability) when the data matters.

---

## How content works

The primary game data is authored as **content packs** — JSON files under [`public/content/`](public/content/). At startup the app fetches [`manifest.json`](public/content/manifest.json), then loads every pack it lists, validates each one, and merges them into a single registry that every screen reads from. Runtime defaults cover a missing system section, and bundled careers missing detailed schemes receive conservative fallback data marked **approximate** in the UI.

```
public/content/
├── manifest.json          ← the load order (edit this to add/remove packs)
├── core-rules.json        ← conditions, XP economy, hit locations, criticals, wounds rule, characteristics, note seeds
├── core-chaos.json        ← searchable, explicitly approximate Chaos & Mutation companion entries
├── core-races.json        ← playable species
├── core-careers.json      ← careers + rank progressions + advancement requirements
├── core-skills.json       ← skill definitions
├── core-talents.json      ← talent definitions
├── core-items.json        ← weapons, armour, trappings
├── core-magic.json        ← spells + miscast tables
├── winds-of-magic.json    ← sourced Winds of Magic career, spell, skill + talent index
├── core-faith.json        ← prayers + deities + wrath table
├── core-creation.json     ← New Character wizard config (archetypes, stat-roll formula)
└── core-characters.json   ← the four starter characters + their XP-log history
```

Because these are plain files served as-is, the workflow is:

> **edit the JSON → reload the page → the change is live.** No rebuild.

(In production, edit the files inside your deployed `dist/content/` folder the same way.)

Two ways to add content:

1. **Edit the core packs** (or add your own file and list it in `manifest.json`) — best for permanent/shared changes.
2. **Import a pack at runtime** via **Settings → Content packs → Import / Paste JSON** — best for trying homebrew without touching files. Imported packs are stored in your browser and can be toggled on/off or removed. **Later packs override earlier ones by `id`**, so an imported pack can replace a core spell or add new ones.

---

## Pack anatomy

Every pack is one JSON object with a schema tag, identity, and any subset of content sections (all sections are optional — a pack can carry just spells, just races, etc.):

```json
{
  "$schema": "grimcomp.content.v2",
  "id": "my-homebrew",
  "name": "My Homebrew Pack",
  "version": "2026.06.01",

  "spells": [ ... ],
  "races": [ ... ],
  "careers": [ ... ]
}
```

> The legacy tag `grimcomp.content.v1` is still accepted and auto-upgraded (v1 `conditions` were plain strings and `xpCosts` was a flat table; both are normalized into the v2 shapes below).

Sections fall into two merge styles:
- **Entity sections** (`spells`, `prayers`, `races`, `careers`, `skills`, `talents`, `references`, `weapons`, `armour`, `trappings`, `deities`, `characters`, `tables`) merge **by `id`** — add new ids, or reuse an id to override.
- **Singleton sections** (`conditions`, `characteristics`, `resources`, `hitLocations`, `criticals`, `criticalTables`, `woundsRules`, `creation`, `noteSeeds`, `screens`, `screenGroups`) are **replaced wholesale** by the last pack that defines them. `xpRules`, `system`, and `capabilities` overlay field-by-field; `figureLabels` overlays by location key; and `xpLogSeeds` overlays by character id.

---

## Recipes

### Add or remove a spell

In `core-magic.json` (or your own pack), edit the `spells` array:

```json
{
  "id": "sp.fire.fireball",
  "name": "Fireball",
  "lore": "Fire",
  "cn": 8,
  "range": "WPB×10 yards",
  "target": "AoE WPB",
  "duration": "Instant",
  "description": "A roaring ball of flame.",
  "damage": "+5",
  "sourceBook": "Example source",
  "sourcePage": 42,
  "rulesNote": "Optional handling note."
}
```

To **remove** a spell, delete its object. To **add** one, append a new object with a unique `id` (convention: `sp.<lore>.<slug>`). A character's authored defaults live in the `knownSpells` array in `core-characters.json`; players can add or remove loaded spells without editing JSON from **Magic → Manage spellbook**. Prayers work similarly in `core-faith.json` (`prayers`, ids `p.<slug>`, with a `deity`).

`winds-of-magic.json` intentionally avoids reproducing the supplement's protected rules text. All 200 spell entries include researched name, lore, CN, and source-page metadata. The 67 spells that overlap the older companion pack retain its short mechanics summary and are visibly labelled **Approximate**; the other 133 are visibly labelled **Index only** and use `"See source"` where mechanics could not be verified from an authoritative public source. Consult the current owned book or official module to resolve them—Cubicle 7 has revised the PDF since its original release.

### Add a career

Careers use stable ids such as `car.hierophant`; new character sheets persist that id alongside the display-name snapshot, while older name-only sheets remain compatible. Optional provenance fields include `sourceBook`, `sourcePage`, `rulesStatus`, and `rulesNote`. Set `creationAvailable` to `false` for a reference-only path, `randomEligible` to `false` for a path that must not be selected by a direct random roll, and `magicAccess` to `none`, `starting`, or `later`.

The Winds of Magic pack adds all **12 standard Careers** as additive records, bringing the loaded library to 77 without replacing the Core Wizard. Their current rank names, Status, eligible species, characteristic unlock order, and page references are indexed. They remain excluded from new-character creation until the print-synced Career Skills, Talents, Trappings, and rank requirements can be sourced from an owned current book or licensed module. Combat Familiar and Spell Familiar advancement are separate searchable references because those statusless, Familiar-only paths do not fit the ordinary character Career model; Power Familiar reuses Spell Familiar progression and is not a third Career.

### Add a skill

Skill definitions use stable ids such as `sk.augury` and specify their characteristic, whether they are Advanced, and whether they require a specialisation. Players can add a loaded definition from **Skills → New skill**; choosing a library result fills its characteristic and type while career/non-career pricing remains an explicit choice. The same sheet still accepts GM-approved custom or grouped names such as `Trade (Alchemist)`.

The Winds of Magic pack adds the supplement's two standalone skills: **Augury** and **Psychometry**, both Advanced Intelligence skills. They are labelled **Index only** because their source procedures and outcome tables are not automated. The picker shows their species/Career restrictions, and prevents a character from owning both mutually exclusive Skills. Alchemy is not added as a third skill: the supplement handles it as an application of the existing grouped **Trade** skill, with a searchable reference entry explaining the source's `Trade (Alchemist)` / `Trade (Alchemy)` naming drift. Consult the current source for complete procedures.

### Add a talent

Talent definitions use stable ids such as `tal.magical-assistant`. Optional metadata covers a printed Max, Tests line, source, eligibility restriction, and parameter choices. Players acquire a loaded definition from **Talents → New talent**; the app tracks XP, ranks, and the listed Max, while Talent effects remain manual.

The Winds of Magic pack adds exactly two new Talent definitions from page 186: **Magical Assistant** and **Suffuse with (Wind)**. Magical Assistant is visibly restricted to Power Familiars. Suffuse is stored once as a parameterized definition; acquisition requires one of Aqshy, Azyr, Chamon, Ghur, Ghyran, Hysh, Shyish, or Ulgu, and the character save retains both the stable definition id and concrete Wind. The pack also carries the page 161 revision of **Concoct** under its existing `tal.concoct` identity; because packs merge by id, the library still exposes one Concoct while Winds of Magic is enabled. These entries are **Index only** and point to the current source instead of reproducing protected rules text.

The Core Talent roster contains 166 unique definitions. **Detect Artefact**, **Magical Sense**, **Magic Resistance**, and **Witch!** were restored during the Winds of Magic dependency audit; their entries include source pages and verified Max/Tests metadata, with the official errata's Toughness Bonus maximum applied to Magic Resistance.

Prayers may also carry an optional **`"type"`**: `"blessing"` (a minor invocation — invoked with **no test and no Wrath**) or `"miracle"` (a **Pray Test** that risks the Wrath of the Gods). Omit it and the Faith screen infers the type from the deity — a deity-agnostic prayer (`deity` equal to `creation.anyDeity`, `"Any"` by default) is treated as a Blessing, a deity-specific one as a Miracle.

### Add a race / species

In `core-races.json`:

```json
{
  "id": "race.ogre",
  "name": "Ogre",
  "charModifiers": { "s": 20, "t": 20, "ag": -10, "int": -10, "fel": -10 },
  "size": "Large",
  "movement": 4,
  "fate": 0,
  "resilience": 3,
  "extra": 2,
  "skills": ["sk.intimidate", "sk.endurance"],
  "talents": ["tal.hardy"],
  "description": "A mountain of muscle and appetite."
}
```

`charModifiers` are flat bonuses applied to rolled starting characteristics. `skills`/`talents` reference ids from `core-skills.json` / `core-talents.json`. `size` of `"Small"` (see `woundsRules.smallSizes`) makes a species omit its Strength Bonus from max Wounds.

### Add a career (and gate its advancement)

In `core-careers.json`:

```json
{
  "id": "car.witch-hunter",
  "name": "Witch Hunter",
  "class": "Warrior",
  "species": ["race.human", "race.dwarf"],
  "advanceScheme": {
    "characteristics": ["ws", "bs", "s", "t", "wp", "fel"],
    "skills": ["Melee (Basic)", "Intimidate", "Perception", "Cool"]
  },
  "ranks": [
    { "level": 1, "name": "Interrogator", "status": "Silver 2" },
    { "level": 2, "name": "Witch Hunter", "status": "Silver 4",
      "requirements": [
        { "skill": "Intimidate", "min": 10 },
        { "skill": "Perception", "min": 5 }
      ]
    },
    { "level": 3, "name": "Captain", "status": "Gold 1" },
    { "level": 4, "name": "Witchfinder General", "status": "Gold 3" }
  ]
}
```

`species` lists the race ids eligible to take it (drives the New Character wizard). Optional per-rank `requirements` (skill display name + minimum advances) gate the **Career** screen's "advance" button; when a rank has no modelled requirements, advancing remains possible only through an explicit GM-review confirmation. Optional `advanceScheme.characteristics` lists the characteristics the career advances — one **outside** it is a non-career advance on the Characteristics screen and costs `xpRules.nonCareerCharacteristicMultiplier` (×2). A career with no `advanceScheme` treats every characteristic as in-career. Bundled core careers that omit a scheme are enriched with conservative playable fallbacks at load time; authored fields always win, and fallback-derived details are labelled **approximate**.

### Rebalance the XP economy

In `core-rules.json`, the `xpRules` section is the single source of truth for all XP costs:

```json
"xpRules": {
  "characteristicAdvances": [
    { "min": 0, "max": 5, "cost": 25 },
    { "min": 6, "max": 10, "cost": 30 },
    { "min": 46, "max": 999, "cost": 230 }
  ],
  "skillAdvances": [ { "min": 0, "max": 5, "cost": 10 }, "… more bands …" ],
  "talentCostPerRank": 100,
  "careerAdvanceCost": 100,
  "nonCareerSkillMultiplier": 2,
  "nonCareerCharacteristicMultiplier": 2,
  "quickAwards": [50, 100, 150, 200],
  "buyStep": 5
}
```

Each `*Advances` band means "while you have between `min` and `max` advances, each point costs `cost` XP." Change a number, reload, and the Characteristics/Skills/Talents/Career/XP screens all use the new values. `quickAwards` are the session-reward buttons; `buyStep` is how many points one purchase buys (+5). `nonCareer*Multiplier` are applied to advances outside the current career's `advanceScheme` (skills already flag `career`; characteristics use the scheme).

**Talent rank caps** — a talent may cap how many times it can be taken (WFRP 4e "Max"). In `core-talents.json`, add `"max": 1` for a flat cap, or `"maxChar": "t"` to cap ranks at that characteristic's Bonus (e.g. Hardy → Toughness Bonus). Omit both for a talent with no listed cap. The Talents screen shows `×N / M` and blocks buying past the cap.

### Configure character creation

In `core-creation.json`:

```json
"creation": {
  "statRoll": { "count": 2, "sides": 10, "plus": 20 },
  "archetypes": [
    {
      "key": "warrior",
      "label": "Warrior",
      "blurb": "Front-line fighter.",
      "icon": "sword",
      "templateId": "c1",
      "careerId": "car.roadwarden",
      "accent": "#8b2d2d"
    }
  ],
  "defaults": { "species": "Human", "archetype": "warrior" },
  "pettyLore": "Petty",
  "anyDeity": "Any"
}
```

`statRoll` is the starting-characteristic formula (`2d10 + 20` by default — change to e.g. `{ "count": 3, "sides": 6, "plus": 25 }`). `pettyLore`/`anyDeity` control which spells/prayers a fresh caster/priest keeps.

The **New Character** wizard is a streamlined rank-one flow: Name & Species (including a single accept-first random roll for +20 XP and the Fate/Resilience **Extra** allocation) → Characteristics → **Career** → Review. Later steps stay locked until their prerequisites are complete. Characteristic rerolls are free and award no XP. The career step lists **every species-eligible career** (grouped by class); its rewarded random choices lock after their first result, while choosing freely awards +0 XP. Replacing a random species manually, or switching a rolled career flow to **Choose freely**, forfeits that reward; selecting one of the three careers offered by **Roll 3** retains its +25 XP. For a career with a loaded advance scheme, fresh characters receive balanced defaults for the five career-Characteristic advances and 40 career-Skill advances plus one career Talent; species benefits, rank-one Status money, and a basic kit are also applied. A career without a starting skill scheme is called out as a basic start so the missing skills can be added later. Matching archetypes contribute only novice spell/prayer identity—experienced demo-character advances and equipment are never cloned. **Finish & switch** persists the character, makes it active, and navigates straight to its Overview.

### Change the game system itself (dice, formulas, currency)

The `system` section in `core-rules.json` defines the *mechanics*, not just the data. Every subsection overlays field-by-field, so a pack can change one formula without restating the rest:

```json
"system": {
  "test": {
    "dice": { "count": 1, "sides": 100 },
    "direction": "under",
    "autoSuccess": { "min": 1, "max": 5 },
    "autoFailure": { "min": 96, "max": 100 },
    "doubles": true,
    "sl": "floor(target / 10) - floor(roll / 10)",
    "targetClamp": { "min": 0, "max": 100 }
  },
  "formulas": {
    "bonus": "floor(value / 10)",
    "maxWounds": "(small ? 0 : sb) + 2*tb + wpb + bonusRanks * tb",
    "walk": "m * 2",
    "run": "m * 4",
    "maxEncumbrance": "sb + tb",
    "corruptionThreshold": "max(1, tb + wpb)",
    "restRecovery": "tb"
  },
  "currency": { "units": [ { "key": "gc", "label": "GC", "factor": 240 }, "…" ], "baseLabel": "brass" },
  "magic":  { "channellingSkillPrefix": "Channelling", "castSkill": "Language (Magick)", "channelChar": "wp", "castChar": "int", "minorMiscastTable": "miscast-minor", "majorMiscastTable": "miscast-major" },
  "faith":  { "praySkill": "Pray", "prayChar": "fel", "wrathTable": "wrath", "wrathBonusPerSin": 10 },
  "combat": { "rangedGroupPattern": "bow|cross|sling|throw|gun|fire", "meleeChar": "ws", "rangedChar": "bs", "meleeSkillPattern": "Melee ({group})", "rangedSkillPattern": "Ranged ({group})" }
}
```

- **`test`** is the dice engine: a d20 roll-over system would set `dice: {count: 1, sides: 20}`, `direction: "over"`, put crits on `autoSuccess: {min: 20, max: 20}` / `autoFailure: {min: 1, max: 1}`, and **remove** the WFRP-only fields with an explicit `null` — `"sl": null`, `"doubles": null`, `"targetClamp": null` (JSON can't write `undefined`, so `null` means "drop the inherited value").
- **`formulas`** are arithmetic expressions evaluated against the live characteristics. Each characteristic is available by key (`s` = current value, `sb` = bonus) and by short name (`S`, `SB`). Supported: `+ - * / %`, comparisons, `cond ? a : b`, `floor/ceil/round/abs/min/max`. A d20-style game could set `"bonus": "floor((value - 10) / 2)"`.
- The **`characteristics` roster is open** — keys are no longer restricted to the WFRP ten, so a pack can ship `str/dex/con/int/wis/cha` and reference them in formulas.
- **Weapon `dmg` strings are formulas too** (`"SB+4"`), evaluated live against the bonuses.
- **`combat.rangedGroupPattern` is safety-checked and bounded.** Literal alternatives such as `bow|cross|sling` and ordinary anchored groups are supported; lookarounds, backreferences, nested/ambiguous repetition, oversized bounds, and patterns longer than 256 characters are rejected at import.
- Roll **tables** may declare their own `"dice": { "count": 2, "sides": 6 }` (default 1d100).

### How combat, magic & faith resolve

The `system.combat` / `system.magic` / `system.faith` bindings above drive these WFRP 4e procedures (pure logic in `src/utils/`, toggled by the capability flags in `core-rules.json`):

- **Combat damage** (`utils/combat.ts`). An attack derives its hit location by reversing the to-hit roll. The **Combat → "Take a hit"** action resolves incoming damage as `Damage − (Toughness Bonus + Armour Points at the struck location)` and applies the result to Wounds; reaching (or being struck at) **0 Wounds** raises a Critical Wound, rolled on the struck location's `criticalTables` entry when one exists. Armour Points come from the live armour list, summed per location.
- **Advantage, Opposed melee & weapon qualities** (`utils/combat.ts`). The Combat screen tracks **Advantage** (+10 per point to your attack tests; a damaging hit offers +1, taking Wounds resets it). The attack sheet takes an optional **defence** value to resolve a melee attack as an **Opposed Test**: higher SL wins even when both tests fail, and the net opposed SL feeds damage. Unopposed attacks still require a successful attack test and use that test's SL. Weapon qualities fold into the number where they change it (**Damaging** uses the units die if higher than SL; **Impale** adds a die on a double); the rest surface as reminders.
- **Spellcasting** (`utils/magic.ts`). **Channelling** banks Success Levels across rounds into a pool (persisted per character). A cast adds the pool to the casting-test SL and compares the total to the spell's **CN**; SL over the CN fuels **Overcasting** (one effect per 2 surplus SL). A double triggers a Miscast (gated by `magicMiscastOnDouble`); a fumbled casting test never casts.
- **Faith.** A **Blessing** is invoked with no test and never risks Wrath; a **Miracle** rolls a Pray Test and can trigger the **Wrath of the Gods** when the roll's units die is ≤ the character's Sin (gated by `faithWrath`). See `prayers[].type` above.
- **Wounds and recovery clocks.** `Bleeding` drains 1 Wound per stack on **End of round**; a Fate point can be **burned** to cheat death. **End of scene** clears only conditions whose data explicitly sets `clearsAtSceneEnd`; it does not refresh Fortune, reduce other conditions, or advance injuries. **Advance healing day** reduces each Critical Wound's healing time by one day and removes those that reach zero. Fortune refresh is a separate **new session** action on Overview. Max Wounds follows `system.formulas.maxWounds`.

### Edit rules data (conditions, hit locations, criticals, wounds)

All in `core-rules.json`:
- **`conditions`** — `{ "name", "penalty"?, "maxStacks"?, "clearsAtSceneEnd"?, "description"? }`. `penalty` is the per-stack test modifier; `maxStacks` is the tap-cycle cap; `clearsAtSceneEnd` makes the explicit **End of scene** action drop every stack. Conditions without that flag are left unchanged by the scene action. Overview and Wounds render a separate, keyboard-accessible info button beside each condition so `description` and the stack metadata are available without a hidden long-press gesture.
- **`hitLocations`** — d100 bands `{ "min", "max", "key", "label" }` (`key` ∈ head/body/arm_l/arm_r/leg_l/leg_r). `figureLabels` are the body-diagram annotations per key. The core pack ships the canonical WFRP table (01–09 Head, 10–24 Left Arm, 25–44 Right Arm, 45–79 Body, 80–89 Left Leg, 90–100 Right Leg); Combat derives the struck location by **reversing the digits** of a successful to-hit roll (e.g. `27 → 72`) and looking it up in these bands.
- **`criticals`** — the flat prefab critical-injury pool `{ "name", "effect", "days" }` (the fallback when no location table matches).
- **`criticalTables`** — location-specific d100 critical tables `{ "locations": ["arm_l", "arm_r"], "rows": [{ "min", "max", "name", "effect", "days" }] }`. Arms and legs share a table (list both keys). When present, a critical at a struck location rolls on its own table instead of drawing a random `criticals` prefab.
- **`woundsRules`** — `{ "smallSizes": ["Small"], "bonusTalent": "Hardy" }`. The max-Wounds formula is `SB + 2×TB + WPB` (small sizes drop SB; the bonus talent adds TB per rank).
- **`characteristics`** — the 10-entry roster `{ "key", "name", "short" }` in display order.

### Ship your own starter characters

In `core-characters.json`, the `characters` array holds full character templates (the same shape the app saves), and `xpLogSeeds` maps each character `id` to its starting XP-log history. Add an entry and it appears in the **Characters** roster.

---

## Validation & debugging

- Imported packs are validated before they're accepted. A failed pasted import shows an error while keeping the paste sheet open and preserving the JSON for correction; a file import reports the same validation error without installing a partial pack.
- If a **core** pack fails to load or parse, the app keeps running on whatever loaded and surfaces the errors (splash screen on hard failure, and in **Settings**). Common causes: trailing commas, a missing `$schema`, or a duplicate `id` within a section.
- JSON must be strict (no comments, no trailing commas). Validate a file quickly with:
  ```bash
  node -e "JSON.parse(require('fs').readFileSync('public/content/core-magic.json','utf8'))"
  ```

---

## Tests & data migrations

A [Vitest](https://vitest.dev) suite covers the rules-critical pure logic and the QA-sensitive UI flows: the d100/dice **roll engine** (`src/utils/roll.ts`), the **formula evaluator** (`src/utils/formula.ts`), **combat resolution** (`src/utils/combat.ts` — hit location, armour soak, the 0-Wounds Critical, Advantage, Opposed tests, weapon distance, and quality-aware damage), **spellcasting** (`src/utils/magic.ts` — SL-vs-CN and Overcasting), **advancement** (`src/utils/advancement.ts` — talent caps, non-career pricing), **character creation** (`src/utils/creation.ts` plus `NewCharScreen.test.tsx`), **separate recovery clocks** (`src/utils/recovery.ts`), **critical tables** (`src/content/tables.ts`), the **persistence store** (`src/hooks/storageCore.ts`), bounded content regular expressions and **content-pack validation** (`src/content/validate.ts`), scoped **Settings exports**, reference history, accessible fields/listbox behavior, and **storage migrations** (`src/storage/migrations.ts`). Run it with `pnpm test` (or `pnpm test:watch`).

Tests live next to the code they cover as `*.test.ts` or `*.test.tsx`. They're **excluded from `pnpm tsc`** (which type-checks only the app) because some use Node APIs (`node:fs`) or a per-file jsdom environment; Vitest transforms and runs them itself, so both `pnpm tsc` and `pnpm test` stay green. `pnpm test:coverage` writes ignored text/JSON V8 reports under `coverage/`. `pnpm test:native` is the focused React-Native CI lane: it imports platform-neutral native storage, roll, and control-accessibility modules through this workspace's Vitest installation rather than running the full web suite. Native React-Native screen TSX is outside the web runner's coverage report and still requires the native typecheck, Expo export, and device/simulator smoke coverage described in the root README.

**Storage migrations.** All player data is stored as `gc.*` JSON keys in `localStorage`. `runStorageMigrations()` (called once in `main.tsx` before React renders) stamps and versions that data, so a future breaking change to a data shape can *rewrite* existing saves rather than silently hydrating them as the wrong shape. The migration table is empty today on purpose — the framework ships one release ahead of the first breaking change so it's proven before anything depends on it.

## Backup, sharing & portability

**Settings** provides full data portability:

- **This char** — exports only the active character's `gc.<id>.*` overlays, the active-character pointer, and that character's definition when it is custom. It deliberately excludes global notes, filters/settings, reference history, and content packs. If the selected character's template depends on an imported or edited pack, this narrow export is refused; use **All** so the defining content travels with it.
- **All** — exports the whole roster and all live overlays plus global notes, settings/filters, recent-reference history, and imported/edited content packs. In-progress character-creation draft/step state stays local because its runtime shape differs between web and native. Review this broader file before sharing it.
- **Import data** — validates and applies matching keys from a `grimcomp.v1` export as one recoverable transaction, then offers a reload. Custom-character definitions are merged with the destination roster; incoming values replace other matching keys.
- **Content packs** — import/paste homebrew packs, toggle them, or remove them.
- **Reset local data** — wipe everything and start fresh.

Portable web/native backups share a 960 KiB UTF-8 file limit. The cap leaves the 4 MiB crash-recovery journal room for JSON-escaped before- and after-images. Export refuses to create a file over the matching import cap, and import validates the exact post-import roster before publishing anything.

## Everyday UI behavior

- The rail and Characters roster read live character overlays, so Fate/Fortune, wounds, XP, identity, and career changes update without a reload.
- **Search** in the app bar and Reference screen searches the loaded offline rules. Its result list is one keyboard tab stop: Arrow Up/Down and Home/End move the active option, while Enter/Space opens it. Reference's **Recently viewed** list is populated by entries opened from that screen's search; it is not seeded with sample history.
- **Trappings → Edit wealth** edits the active character's denominations from `system.currency.units`; the base-unit total updates from those persisted values.
- Magic, Faith, XP, content, and inventory mutation flows withhold success feedback until storage confirms the write and ignore duplicate activation while a save is pending. Stale weapon, armour, and Trappings editors refuse to update a different item after a cross-tab reorder or conflict.
- Bounded steppers disable their decrease/increase controls at the minimum/maximum. Form labels, choice-group state, modal focus handling, and the Settings XP-mode selection are exposed to keyboard and assistive-technology users.

---

## Project layout

```
web/
├── public/content/      ← JSON content packs (the configurable game data)
├── src/
│   ├── content/         ← pack types, validator, registry, runtime loader, React provider + hooks
│   ├── data/            ← character TYPES + nav structure (no game data — that's in JSON)
│   ├── hooks/           ← persisted state (localStorage), per-character domain hooks
│   ├── storage/         ← localStorage adapter, recovery, migrations, boot gate, cross-tab sync
│   ├── components/      ← UI kit (Card, Table, Stepper, Icon, HitLocationFigure, …)
│   ├── screens/         ← the 18 screens + ScreenContainer
│   ├── ui/              ← Alert dialog system
│   ├── styles/          ← theme.css (design tokens) + base.css
│   └── App.tsx          ← content provider + router + shell
└── dist/                ← static build output (deploy this)
```

Rules-critical pure logic (`utils/roll.ts`, `utils/formula.ts`, `utils/combat.ts`, `utils/magic.ts`, `utils/advancement.ts`, `utils/recovery.ts`, `content/validate.ts`, `storage/migrations.ts`) is covered by the Vitest suite — see **Tests & data migrations** above.

The runtime is content-driven: screens consume the resolved registry rather than importing core JSON directly. Code-level defaults still provide a safe system/resource baseline, conservative approximate enrichment for incomplete bundled careers, and the streamlined creation wizard's basic starter kit; authored pack data remains the source of truth wherever it is present.
