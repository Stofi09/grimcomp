# Grim Companion (web)

A grimdark fantasy RPG character companion, rebuilt as a **plain React + Vite static site** — no iOS/Android dependency. It ships as static files (`npm run build`) you can host anywhere, and **all game content lives in editable JSON** so spells, races, careers, the XP economy, character creation, and even the starter characters can be added, removed, or rebalanced **without touching code or rebuilding**.

This is a port of the original Expo/React-Native app (kept at the repo root). Same parchment look, same screens, same rules — now in the browser, and far more configurable.

---

## Quick start

```bash
cd web
npm install
npm run dev        # local dev server (hot reload)
npm run build      # static production build → web/dist/
npm run preview    # serve the production build locally
npm run tsc        # type-check the app (test files run under Vitest, see below)
npm test           # run the unit suite once (Vitest)
npm run test:watch # run the unit suite in watch mode
```

Deploy by copying **`web/dist/`** to any static host (GitHub Pages, Netlify, Vercel, S3, nginx, a USB stick). The build uses relative asset paths (`base: './'`), so it works from a subdirectory too — no server config required.

The app stores all player data (characters, advances, wounds, XP, notes, imported packs) in the browser's **localStorage** — nothing is sent anywhere, and it works fully offline.

---

## How content works

All game data is authored as **content packs** — JSON files under [`public/content/`](public/content/). At startup the app fetches [`manifest.json`](public/content/manifest.json), then loads every pack it lists, validates each one, and merges them into a single registry that every screen reads from.

```
public/content/
├── manifest.json          ← the load order (edit this to add/remove packs)
├── core-rules.json        ← conditions, XP economy, hit locations, criticals, wounds rule, characteristics, note seeds
├── core-races.json        ← playable species
├── core-careers.json      ← careers + rank progressions + advancement requirements
├── core-skills.json       ← skill definitions
├── core-talents.json      ← talent definitions
├── core-items.json        ← weapons, armour, trappings
├── core-magic.json        ← spells + miscast tables
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
- **Entity sections** (`spells`, `prayers`, `races`, `careers`, `skills`, `talents`, `weapons`, `armour`, `trappings`, `deities`, `characters`, `tables`) merge **by `id`** — add new ids, or reuse an id to override.
- **Singleton sections** (`conditions`, `characteristics`, `xpRules`, `system`, `hitLocations`, `figureLabels`, `criticals`, `woundsRules`, `creation`, `noteSeeds`) are **replaced wholesale** by the last pack that defines them (except `xpRules` and `system`, which overlay field-by-field).

---

## Recipes

### Add or remove a spell

In `core-magic.json` (or your own pack), edit the `spells` array:

```json
{
  "id": "m.fireball",
  "name": "Fireball",
  "lore": "Fire",
  "cn": 8,
  "range": "WPB×10 yards",
  "target": "AoE WPB",
  "duration": "Instant",
  "description": "A roaring ball of flame.",
  "damage": "+5"
}
```

To **remove** a spell, delete its object. To **add** one, append a new object with a unique `id` (convention: `m.<slug>`). A character "knows" a spell when its `id` is in their `knownSpells` array (see `core-characters.json`), so add the id there to put it on a caster's sheet. Prayers work identically in `core-faith.json` (`prayers`, ids `p.<slug>`, with a `deity`).

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

`species` lists the race ids eligible to take it (drives the New Character wizard). Optional per-rank `requirements` (skill display name + minimum advances) gate the **Career** screen's "advance" button; ranks without requirements stay unblocked.

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
  "quickAwards": [50, 100, 150, 200],
  "buyStep": 5
}
```

Each `*Advances` band means "while you have between `min` and `max` advances, each point costs `cost` XP." Change a number, reload, and the Characteristics/Skills/Talents/Career/XP screens all use the new values. `quickAwards` are the session-reward buttons; `buyStep` is how many points one purchase buys (+5).

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

`statRoll` is the starting-characteristic formula (`2d10 + 20` by default — change to e.g. `{ "count": 3, "sides": 6, "plus": 25 }`). Each `archetype` clones a starter `templateId` (from `core-characters.json`) and binds a `careerId`. `pettyLore`/`anyDeity` control which spells/prayers a fresh caster/priest keeps.

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
- Roll **tables** may declare their own `"dice": { "count": 2, "sides": 6 }` (default 1d100).

### Edit rules data (conditions, hit locations, criticals, wounds)

All in `core-rules.json`:
- **`conditions`** — `{ "name", "penalty"?, "maxStacks"?, "clearsAtSceneEnd"?, "description"? }`. `penalty` is the per-stack test modifier; `maxStacks` is the tap-cycle cap; `clearsAtSceneEnd` drops all stacks at scene end instead of ticking down by 1.
- **`hitLocations`** — d100 bands `{ "min", "max", "key", "label" }` (`key` ∈ head/body/arm_l/arm_r/leg_l/leg_r). `figureLabels` are the body-diagram annotations per key.
- **`criticals`** — the prefab critical-injury pool `{ "name", "effect", "days" }`.
- **`woundsRules`** — `{ "smallSizes": ["Small"], "bonusTalent": "Hardy" }`. The max-Wounds formula is `SB + 2×TB + WPB` (small sizes drop SB; the bonus talent adds TB per rank).
- **`characteristics`** — the 10-entry roster `{ "key", "name", "short" }` in display order.

### Ship your own starter characters

In `core-characters.json`, the `characters` array holds full character templates (the same shape the app saves), and `xpLogSeeds` maps each character `id` to its starting XP-log history. Add an entry and it appears in the **Characters** roster.

---

## Validation & debugging

- Imported packs are validated before they're accepted; errors are shown in the import dialog.
- If a **core** pack fails to load or parse, the app keeps running on whatever loaded and surfaces the errors (splash screen on hard failure, and in **Settings**). Common causes: trailing commas, a missing `$schema`, or a duplicate `id` within a section.
- JSON must be strict (no comments, no trailing commas). Validate a file quickly with:
  ```bash
  node -e "JSON.parse(require('fs').readFileSync('public/content/core-magic.json','utf8'))"
  ```

---

## Tests & data migrations

A [Vitest](https://vitest.dev) unit suite covers the rules-critical pure logic: the d100/dice **roll engine** (`src/utils/roll.ts`), the **formula evaluator** (`src/utils/formula.ts`), **content-pack validation** (`src/content/validate.ts`), and **storage migrations** (`src/storage/migrations.ts`). Run it with `npm test` (or `npm run test:watch`).

Tests live next to the code they cover as `*.test.ts`. They're **excluded from `npm run tsc`** (which type-checks only the app) because they use Node APIs (`node:fs`) to load the real content packs; Vitest type-checks and runs them itself, so both `npm run tsc` and `npm test` stay green.

**Storage migrations.** All player data is stored as `gc.*` JSON keys in `localStorage`. `runStorageMigrations()` (called once in `main.tsx` before React renders) stamps and versions that data, so a future breaking change to a data shape can *rewrite* existing saves rather than silently hydrating them as the wrong shape. The migration table is empty today on purpose — the framework ships one release ahead of the first breaking change so it's proven before anything depends on it.

## Backup, sharing & portability

**Settings** provides full data portability:
- **Export** — download a JSON snapshot of the active character or the whole roster (including all live overlays: advances, wounds, XP, conditions, inventory).
- **Import data** — load an exported snapshot back in (useful for moving between devices/browsers).
- **Content packs** — import/paste homebrew packs, toggle them, or remove them.
- **Reset local data** — wipe everything and start fresh.

---

## Project layout

```
web/
├── public/content/      ← JSON content packs (the configurable game data)
├── src/
│   ├── content/         ← pack types, validator, registry, runtime loader, React provider + hooks
│   ├── data/            ← character TYPES + nav structure (no game data — that's in JSON)
│   ├── hooks/           ← persisted state (localStorage), per-character domain hooks
│   ├── storage/         ← versioned localStorage migrations (run once at boot)
│   ├── components/      ← UI kit (Card, Table, Stepper, Icon, HitLocationFigure, …)
│   ├── screens/         ← the 17 screens + ScreenContainer
│   ├── ui/              ← Alert dialog system
│   ├── styles/          ← theme.css (design tokens) + base.css
│   └── App.tsx          ← content provider + router + shell
└── dist/                ← static build output (deploy this)
```

Rules-critical pure logic (`utils/roll.ts`, `utils/formula.ts`, `content/validate.ts`, `storage/migrations.ts`) is covered by a Vitest unit suite — see **Tests & data migrations** above.

The `src/` code is intentionally content-agnostic: it knows the *shapes* of game data (TypeScript types) but never hardcodes the *values* — those all come from the JSON packs.
