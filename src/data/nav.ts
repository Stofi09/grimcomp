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
      { id: 'skills', label: 'Skills', icon: 'scroll', badge: '12' },
      { id: 'talents', label: 'Talents', icon: 'star', badge: '5' },
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
      { id: 'trappings', label: 'Trappings', icon: 'pack', badge: '10' },
      { id: 'psychology', label: 'Psychology', icon: 'mask' },
    ],
  },
  {
    section: 'Rulebook',
    items: [
      { id: 'reference', label: 'Reference', icon: 'tome' },
      { id: 'notes', label: 'Notes', icon: 'quill', badge: '7' },
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

export const SCREEN_CRUMBS: Record<ScreenId, string[]> = {
  overview: ['Character', 'Sigmund Braun', 'Overview'],
  characteristics: ['Character', 'Sigmund Braun', 'Characteristics'],
  skills: ['Character', 'Sigmund Braun', 'Skills'],
  talents: ['Character', 'Sigmund Braun', 'Talents'],
  career: ['Character', 'Sigmund Braun', 'Career'],
  xp: ['Character', 'Sigmund Braun', 'XP Log'],
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
