# Grim Companion

A WFRP 4e tablet/phone companion app for managing characters in Warhammer Fantasy Roleplay 4th Edition. Built in React Native (Expo) from a Claude Design handoff.

Sample character: **Sigmund Braun** — Ember Útőr (Roadwarden), 2. szint.

## Stack

- React Native via Expo SDK 51
- TypeScript with `@/` path alias to `src/`
- `react-native-svg` for the hit-location figure and icons
- `@expo-google-fonts` for IM Fell English / Inter / JetBrains Mono
- No navigation library — single state-based screen switcher matching the prototype

## Layout

- iPad / wide tablet (≥820 px): persistent left rail (268 px) + content
- iPhone / narrow: hamburger button reveals the rail in a slide-over

The whole UI is in Hungarian, mirroring the design's intent.

## Getting started

```sh
npm install
npm run ios      # opens iOS Simulator
npm run android  # opens Android emulator
npm run web      # browser preview
```

The first launch downloads the Google Fonts; a loading indicator shows until they are ready.

## Project structure

```
src/
  theme/           # colors, typography, spacing — single source of truth
  data/            # character + nav data (mirrors the prototype's data.js)
  components/      # Card, Pill, Chip, Stepper, Button, Bar, Counter, Stat,
                   # Section, Hero, Avatar, Icon, Table, Rail, AppBar, Shell,
                   # HitLocationFigure
  screens/         # 17 screens — see App.tsx for the routing table
App.tsx            # font loading + screen switcher + Shell wrapper
```

## Implementation notes

- Colors and dimensions track `styles.css` directly — see `src/theme/colors.ts`.
- The hit-location SVG figure is a port of the prototype's anatomy SVG.
- Data is currently static (`src/data/character.ts`); steppers / counters render the values but don't yet mutate them. The original prototype was static too.
- The rail's "campaign book" embossed gradient is approximated with a flat brass background; a full multi-stop gradient would require `expo-linear-gradient`.

## What's not implemented

The prototype is a static hi-fi mock; this port matches it. Persistent local state, dice rolling, XP spending, and rule lookup are scaffolded but inert.
