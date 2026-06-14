// Maps each built-in ScreenKind to its component. The nav model picks and
// orders screens by kind; App renders SCREEN_COMPONENTS[kind]. Packs choose
// from this fixed set — they can't inject arbitrary React.

import type { ComponentType } from 'react';
import type { ScreenKind } from '@/content/types';

import { OverviewScreen } from './OverviewScreen';
import { CharacteristicsScreen } from './CharacteristicsScreen';
import { SkillsScreen } from './SkillsScreen';
import { TalentsScreen } from './TalentsScreen';
import { CareerScreen } from './CareerScreen';
import { XpScreen } from './XpScreen';
import { CombatScreen } from './CombatScreen';
import { WoundsScreen } from './WoundsScreen';
import { MagicScreen } from './MagicScreen';
import { FaithScreen } from './FaithScreen';
import { TrappingsScreen } from './TrappingsScreen';
import { PsychologyScreen } from './PsychologyScreen';
import { ReferenceScreen } from './ReferenceScreen';
import { NotesScreen } from './NotesScreen';
import { RosterScreen } from './RosterScreen';
import { SettingsScreen } from './SettingsScreen';
import { NewCharScreen } from './NewCharScreen';

// Props every screen is rendered with. Most ignore onNav; Roster/NewChar use it
// to navigate. Components that accept no props are assignable here (the extra
// prop is ignored), so the map can be uniformly typed.
export interface ScreenComponentProps {
  onNav: (id: string) => void;
}

export const SCREEN_COMPONENTS: Record<ScreenKind, ComponentType<ScreenComponentProps>> = {
  overview: OverviewScreen,
  characteristics: CharacteristicsScreen,
  skills: SkillsScreen,
  talents: TalentsScreen,
  career: CareerScreen,
  xp: XpScreen,
  combat: CombatScreen,
  wounds: WoundsScreen,
  magic: MagicScreen,
  faith: FaithScreen,
  trappings: TrappingsScreen,
  psychology: PsychologyScreen,
  reference: ReferenceScreen,
  notes: NotesScreen,
  roster: RosterScreen,
  settings: SettingsScreen,
  newchar: NewCharScreen,
};
