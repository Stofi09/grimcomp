# Grim Companion

A WFRP 4e tablet/phone companion app for managing characters in Warhammer Fantasy Roleplay 4th Edition. Built in React Native (Expo) from a Claude Design handoff.

Sample character: **Sigmund Braun** — Human Roadwarden, rank 2.

## Stack

- React Native via Expo SDK 51
- TypeScript with `@/` path alias to `src/`
- `react-native-svg` for the hit-location figure and icons
- `expo-linear-gradient` for the rail spine, avatars, bars, and primary buttons
- `@react-native-async-storage/async-storage` for persisted state
- `@expo-google-fonts` for IM Fell English / Inter / JetBrains Mono

## Layout

- iPad / wide tablet (≥820 pt): persistent left rail (268 pt) + content
- iPhone / narrow: hamburger button reveals the rail in a slide-over

UI language: English.

## Getting started

```sh
npm install
npm run ios            # iPad Pro 13-inch (M5) — the project's default
npm run ios:ipad       # same as above
npm run ios:ipad:11    # iPad Pro 11-inch (M5)
npm run ios:iphone     # iPhone 17 Pro
npm run android        # opens Android emulator
npm run web            # browser preview
npm run icons          # regenerate the App Store icon from scripts/generate-icons.js
```

### Pinning a default simulator per project

Expo SDK 51's `expo start --ios` has no `--device` flag — it just opens
whichever simulator is already booted, falling back to the system default
(usually an iPhone). To pin a specific device per project we boot it ourselves
first via `scripts/dev-ios.js`, then hand off to Expo.

In another project you can either:

- **Copy `scripts/dev-ios.js`** and change the device name in `package.json`,
  e.g. `"ios": "node scripts/dev-ios.js 'iPhone 17 Pro'"`.
- Or set the env var **once** in your shell:
  `EXPO_IOS_DEVICE='iPhone 17 Pro' npm run ios` — the script reads it as a
  fallback when no argument is supplied.

List available devices any time with `xcrun simctl list devices available`.

## TestFlight / production builds

Configured via [EAS](https://docs.expo.dev/eas/) — same wiring as `homeassist2/homebase`.

| Setting | Value |
|---|---|
| Apple ID | `kristof.solak@gmail.com` |
| Apple Team ID | `2JV57W286Z` |
| EAS owner | `stofi09` |
| Bundle id | `com.kristofsolak.grimcomp` |
| iOS version source | EAS-managed (`appVersionSource: remote`) |

### One-time setup

Run these once. They each prompt for credentials interactively.

```sh
# 1. Log in to EAS (uses your Expo account)
eas login

# 2. Link this project to a fresh EAS project ID. Updates app.json's
#    `extra.eas.projectId` automatically.
eas init

# 3. Configure iOS credentials. EAS will offer to register the app on
#    App Store Connect (creates the ascAppId), provision distribution
#    certs, and store everything in EAS-managed credentials.
eas credentials
```

### Build + ship to TestFlight

```sh
# Cloud build (15–30 min). Auto-increments the iOS build number.
npm run build:ios

# Upload the latest production build to TestFlight.
npm run submit:ios
```

After `submit:ios` finishes, the build appears in App Store Connect → Apps → Grim Companion → TestFlight, usually within ~10 minutes of finishing processing. Add internal testers in App Store Connect to install via the TestFlight app.

### Quick internal preview build (ad-hoc, no App Store)

```sh
npm run build:ios:preview
```

Produces a `.ipa` you can install on registered devices via the EAS QR code — useful for sanity-checking before the slower TestFlight pipeline.

## Project structure

```
src/
  theme/           # colors, typography, spacing — single source of truth
  data/            # character + nav data (mirrors the prototype's data.js)
  hooks/           # useStoredState (AsyncStorage write-through), useStoredScreen,
                   # useConditions (shared across Overview + Wounds)
  components/      # Card, Pill, Chip, Stepper, Button, Bar, Counter, Stat,
                   # Section, Hero, Avatar, Icon, Table, Rail, AppBar, Shell,
                   # HitLocationFigure
  screens/         # 17 screens — see App.tsx for the routing table
scripts/
  generate-icons.js  # SVG → PNG, run via `npm run icons`
App.tsx            # font loading + screen switcher + Shell wrapper
```

## Implementation notes

- Colours and dimensions track `styles.css` directly — see `src/theme/colors.ts`.
- The rail's three-stop parchment gradient, avatar diagonals, bar fills, segmented
  wound cells, and primary buttons all use `expo-linear-gradient`.
- The hit-location SVG figure is a port of the prototype's anatomy SVG.
- Persisted state keys (under AsyncStorage):
  - `gc.screen`, `gc.wounds`, `gc.sin`, `gc.skills.adv`, `gc.conditions`,
    `gc.notes.filter`, `gc.newchar.step`, `gc.newchar.method`.
- The Cell helper auto-wraps array-of-primitives children (e.g. `+{n}`) in a
  `<Text>`, which avoids the "Text strings must be rendered within a Text
  component" runtime error.
