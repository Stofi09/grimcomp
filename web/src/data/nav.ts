import type { IconName } from '@/components/Icon';

export type ScreenId =
  | 'overview' | 'characteristics' | 'skills' | 'talents' | 'career' | 'xp'
  | 'combat' | 'wounds' | 'magic' | 'faith' | 'trappings' | 'psychology'
  | 'reference' | 'notes' | 'roster' | 'settings' | 'newchar';

export interface NavItem {
  id: ScreenId;
  label: string;
  icon: IconName;
  badge?: string;
}

export interface NavGroup {
  section: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    section: 'Character',
    items: [
      { id: 'overview', label: 'Overview', icon: 'shield' },
      { id: 'characteristics', label: 'Characteristics', icon: 'grid' },
      { id: 'skills', label: 'Skills', icon: 'scroll' },
      { id: 'talents', label: 'Talents', icon: 'star' },
      { id: 'career', label: 'Career', icon: 'crown' },
      { id: 'xp', label: 'XP Log', icon: 'book' },
    ],
  },
  {
    section: 'Play',
    items: [
      { id: 'combat', label: 'Combat', icon: 'sword' },
      { id: 'wounds', label: 'Wounds & Conditions', icon: 'heart' },
      { id: 'magic', label: 'Magic', icon: 'sparkle' },
      { id: 'faith', label: 'Faith', icon: 'flame' },
      { id: 'trappings', label: 'Trappings', icon: 'pack' },
      { id: 'psychology', label: 'Psychology', icon: 'mask' },
    ],
  },
  {
    section: 'Rulebook',
    items: [
      { id: 'reference', label: 'Reference', icon: 'tome' },
      { id: 'notes', label: 'Notes', icon: 'quill' },
    ],
  },
  {
    section: 'System',
    items: [
      { id: 'roster', label: 'Characters', icon: 'users' },
      { id: 'settings', label: 'Settings', icon: 'gear' },
    ],
  },
];

// '$NAME' is substituted with the active character's name at render time
// (the Shell does the replacement).
export const SCREEN_CRUMBS: Record<ScreenId, string[]> = {
  overview: ['Character', '$NAME', 'Overview'],
  characteristics: ['Character', '$NAME', 'Characteristics'],
  skills: ['Character', '$NAME', 'Skills'],
  talents: ['Character', '$NAME', 'Talents'],
  career: ['Character', '$NAME', 'Career'],
  xp: ['Character', '$NAME', 'XP Log'],
  combat: ['Play', 'Combat'],
  wounds: ['Play', 'Wounds & Conditions'],
  magic: ['Play', 'Magic'],
  faith: ['Play', 'Faith'],
  trappings: ['Play', 'Trappings'],
  psychology: ['Play', 'Psychology'],
  reference: ['Rulebook', 'Reference'],
  notes: ['Rulebook', 'Notes'],
  roster: ['System', 'Characters'],
  settings: ['System', 'Settings'],
  newchar: ['System', 'Characters', 'New Character'],
};
