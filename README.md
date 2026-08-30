# Grim Companion

A WFRP 4e tablet/phone companion app for managing characters in Warhammer Fantasy Roleplay 4th Edition. Built in React Native (Expo) from a Claude Design handoff.

Sample character: **Sigmund Braun** — Human Roadwarden, rank 2.

> **Web version:** there is also a browser build under [`web/`](web/) — a plain React + Vite static site that shares the parchment design and main character-companion workflows while adding a content editor and a more extensively configurable rules runtime. It runs fully offline (`localStorage`) and deploys as static files. See [`web/README.md`](web/README.md) for content authoring, configuration, tests, and deployment.

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
pnpm install

# These three are equivalent — they boot the iPad, start Metro, and
# auto-open Expo Go on the iPad via `xcrun simctl openurl <UDID>`.
pnpm start
pnpm run ios
pnpm run ios:ipad

# Form-factor variants
pnpm run ios:ipad:11    # iPad Pro 11-inch (M5)
pnpm run ios:iphone     # iPhone 17 Pro

# Other entry points
pnpm run start:metro    # boots the iPad + Metro QR, no auto-launch (scan with phone)
pnpm run start:raw      # pure `expo start`, no pinning at all
pnpm run android        # opens Android emulator
pnpm run web            # Expo/RN web preview (the separate Vite app is under web/)
pnpm run icons          # regenerate the App Store icon
```

## Verification

The root checks cover the shared contracts and Expo app. Native unit regressions use the web workspace's isolated Vitest toolchain while importing the real root modules:

```sh
pnpm run check:core-boundary
pnpm run tsc:core
pnpm run tsc
pnpm run audit:ios

pnpm --dir web install --frozen-lockfile
pnpm --dir web run test:native
```

The native CI workflow runs this matrix and also performs a local iOS Expo export so Babel, Metro, and bundled assets are exercised without creating a signed build.

### Why so many scripts? Pinning a simulator per project

Expo SDK 51's `expo start --ios` has no `--device` flag. Inside, it picks
the **first simulator that's currently booted** (regardless of which one you
intended), falling back to the system default. With multiple RN projects open
this is unreliable — whichever sim was booted last wins.

`scripts/dev-ios.js` solves it deterministically:

1. Boot the requested device (no-op if already booted).
2. Spawn `expo start`.
3. When Metro logs `Waiting on http://localhost:<port>`, run
   `xcrun simctl openurl <UDID> exp://localhost:<port>`. This pushes the
   deep-link directly to the chosen device, bypassing Expo's selection.

For another project, copy `scripts/dev-ios.js` and change the device
name in that project's `package.json`:

```json
"ios": "node scripts/dev-ios.js 'iPhone 17 Pro'"
```

Or skip the script and rely on the env var as a fallback:

```sh
EXPO_IOS_DEVICE='iPhone 17 Pro' pnpm run ios
```

List devices with `xcrun simctl list devices available`. The script gives
a fuzzy "did you mean" hint when the device name doesn't match.

## TestFlight / production builds

Configured via [EAS](https://docs.expo.dev/eas/).

| Setting | Value |
|---|---|
| Apple ID | `kristof.solak@gmail.com` |
| Apple Team ID | `2JV57W286Z` |
| EAS owner | `stofi09` |
| Bundle id | `com.kristofsolak.grimcomp` |
| iOS version source | EAS-managed (`appVersionSource: remote`) |

### Account and credential setup

The repository is already linked to its EAS project, and `eas.json` already contains the App Store Connect app id. Do **not** run `eas init` unless you intentionally mean to relink the app to a different EAS project.

```sh
# Log in on a new development machine.
eas login

# Inspect or replace iOS signing credentials only when needed.
eas credentials
```

### Pre-flight audit

```sh
pnpm run audit:ios
```

Sanity-checks `app.json` + `eas.json` for the common TestFlight blockers
(empty projectId, missing bundleId, placeholder Apple Team ID, etc.) before
you spend cloud build minutes. Mirrors `david-mobil/scripts/audit-ios-config.js`.

### Build + ship to TestFlight

```sh
# One-shot: build, then auto-submit to the configured App Store Connect app.
pnpm run submit:ios:testflight

# Or split build and submit (handy if you want to inspect the .ipa first):
pnpm run build:ios     # cloud build, auto-increments build number
pnpm run submit:ios    # uploads the latest production build
```

After the submit step finishes, the build appears in App Store Connect → Apps → Grim Companion → TestFlight, usually within ~10 minutes of finishing processing. Add internal testers in App Store Connect to install via the TestFlight app.

### Quick internal preview build (ad-hoc, no App Store)

```sh
pnpm run build:ios:preview
```

Produces a `.ipa` you can install on registered devices via the EAS QR code — useful for sanity-checking before the slower TestFlight pipeline.

## Project structure

```
src/
  theme/           # colors, typography, spacing — single source of truth
  data/            # character + nav data (mirrors the prototype's data.js)
  hooks/           # domain hooks backed by the verified native storage store
  storage/         # AsyncStorage adapter, recovery, migrations, import/export
  components/      # Card, Pill, Chip, Stepper, Button, Bar, Counter, Stat,
                   # Section, Hero, Avatar, Icon, Table, Rail, AppBar, Shell,
                   # HitLocationFigure
  screens/         # 17 screens — see App.tsx for the routing table
scripts/
  generate-icons.js  # SVG → PNG, run via `pnpm run icons`
App.tsx            # font loading + screen switcher + Shell wrapper
```

## Implementation notes

- Colours and dimensions track `styles.css` directly — see `src/theme/colors.ts`.
- The rail's three-stop parchment gradient, avatar diagonals, bar fills, segmented
  wound cells, and primary buttons all use `expo-linear-gradient`.
- The hit-location SVG figure is a port of the prototype's anatomy SVG.
- Character overlays use `gc.<characterId>.<suffix>` keys. Global `gc.*` keys hold the active-character pointer, custom roster, notes, settings, content packs, screen, and local creation progress; storage journals/version markers are internal.
- React mounts only after the AsyncStorage journal has recovered, migrations have run, and stored runtime shapes have been validated. If recovery cannot be proved safe, the app offers retry, a raw diagnostic export, or an explicitly confirmed restartable reset instead of opening possibly inconsistent data.
- Settings exports use the shared `grimcomp.v1` backup schema. Character exports are scoped; full exports include roster overlays and content packs. Web/native creation draft and step keys stay local because their runtime shapes differ, and portable backup files are capped at 960 KiB of UTF-8 text on both platforms so the crash-recovery journal retains room for escaped before- and after-images.
- Durable gameplay and settings actions report success only after verified persistence. Wounds keeps scene, session, and healing-day clocks separate: scene end clears `Surprised`, Fortune refresh is a separate Overview action, and critical healing advances by day.
- Shared Buttons expose button/disabled semantics and contextual labels; Steppers announce their value, disable bounded actions, and use 44-point controls.
- The Cell helper auto-wraps array-of-primitives children (e.g. `+{n}`) in a
  `<Text>`, which avoids the "Text strings must be rendered within a Text
  component" runtime error.
