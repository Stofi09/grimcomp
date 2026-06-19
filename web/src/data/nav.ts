import type { IconName } from '@/components/Icon';
import { coerceIcon } from '@/components/Icon';
import type { CompiledFormula } from '@/utils/formula';
import { compileFormula } from '@/utils/formula';
import type { ScreenKind, ScreenDef, ScreenGroupDef } from '@/content/types';
import type { Character } from '@/data/character';

// A ScreenId is just a ScreenKind — every built-in screen's id matches its
// component kind in the default nav. Packs may reuse a kind under a different id.
export type ScreenId = ScreenKind;

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

// The built-in WFRP nav. Used to build the DEFAULT nav model when no pack ships
// a `screens` section — so the no-pack path is behaviourally identical.
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
      { id: 'content', label: 'Content', icon: 'scroll' },
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
  content: ['System', 'Content'],
  settings: ['System', 'Settings'],
  newchar: ['System', 'Characters', 'New Character'],
};

// Default section headers, used when a pack ships `screens` but no `screenGroups`.
export const DEFAULT_SCREEN_GROUPS: ScreenGroupDef[] = [
  { id: 'character', label: 'Character' },
  { id: 'play', label: 'Play' },
  { id: 'rulebook', label: 'Rulebook' },
  { id: 'system', label: 'System' },
];

// Kinds whose breadcrumb trail includes the active character's name.
const CHARACTER_KINDS = new Set<ScreenKind>([
  'overview', 'characteristics', 'skills', 'talents', 'career', 'xp',
]);

// --- Resolved model the UI actually consumes ------------------------------

export interface ResolvedNavItem {
  id: string;
  kind: ScreenKind;
  label: string;
  icon: IconName;
  badge?: string;
  /** Compiled predicate; when present and it evaluates to 0 for the active
      character, the item is hidden from the rail (the screen stays routable). */
  enabledWhen?: CompiledFormula;
  hideFromNav?: boolean;
}

export interface ResolvedNavGroup {
  id: string;
  label: string;
  items: ResolvedNavItem[];
}

export interface NavModel {
  /** Visible rail sections (hideFromNav items excluded; enabledWhen still applied at render). */
  groups: ResolvedNavGroup[];
  /** Every screen by id, including hidden ones — the routing table. */
  itemsById: Record<string, ResolvedNavItem>;
  /** id → breadcrumb trail (may contain the '$NAME' token). */
  crumbs: Record<string, string[]>;
  /** Every valid screen id (including hidden), for persisted-screen validation. */
  allIds: string[];
  /** First non-hidden screen — the landing screen. */
  defaultScreenId: string;
}

/** Numeric vars a screen `enabledWhen` predicate is evaluated against.
    Mirror SCREEN_ENABLED_WHEN_VARS in content/types.ts. */
export function navVars(c: Character): Record<string, number> {
  return {
    isCaster: c.isCaster ? 1 : 0,
    isAnointed: c.isAnointed ? 1 : 0,
    careerLevel: c.careerLevel ?? 0,
  };
}

// Already validated at import, but compile defensively so a bad predicate that
// slipped through degrades to "always shown" rather than throwing in render.
function compileEnabled(src: string | undefined): CompiledFormula | undefined {
  if (!src) return undefined;
  try { return compileFormula(src); } catch { return undefined; }
}

/** Resolve a pack-authored `screens` section into the runtime nav model. */
export function resolveNavModel(screens: ScreenDef[], groups?: ScreenGroupDef[]): NavModel {
  const groupDefs = groups && groups.length > 0 ? groups : DEFAULT_SCREEN_GROUPS;
  const knownGroupIds = new Set(groupDefs.map(g => g.id));
  const labelFor = (id: string) => groupDefs.find(g => g.id === id)?.label ?? 'More';

  const items: ResolvedNavItem[] = screens.map(s => ({
    id: s.id,
    kind: s.kind,
    label: s.label,
    icon: coerceIcon(s.icon),
    badge: s.badge,
    enabledWhen: compileEnabled(s.enabledWhen),
    hideFromNav: s.hideFromNav,
  }));

  const itemsById: Record<string, ResolvedNavItem> = {};
  const crumbs: Record<string, string[]> = {};
  items.forEach((it, i) => {
    itemsById[it.id] = it;
    const gl = labelFor(screens[i].group);
    crumbs[it.id] = CHARACTER_KINDS.has(it.kind) ? [gl, '$NAME', it.label] : [gl, it.label];
  });

  const resolvedGroups: ResolvedNavGroup[] = [];
  for (const g of groupDefs) {
    const groupItems = items.filter((it, i) => screens[i].group === g.id && !it.hideFromNav);
    if (groupItems.length > 0) resolvedGroups.push({ id: g.id, label: g.label, items: groupItems });
  }
  // Screens pointing at an unknown group still appear (in a trailing section)
  // rather than silently vanishing.
  const orphans = items.filter((it, i) => !knownGroupIds.has(screens[i].group) && !it.hideFromNav);
  if (orphans.length > 0) resolvedGroups.push({ id: '__more', label: 'More', items: orphans });

  const firstVisible = items.find(it => !it.hideFromNav);
  return {
    groups: resolvedGroups,
    itemsById,
    crumbs,
    allIds: items.map(it => it.id),
    defaultScreenId: firstVisible?.id ?? items[0]?.id ?? 'overview',
  };
}

/** The built-in WFRP nav as a NavModel — behaviourally identical to the old
    hardcoded rail (Magic gated on casters, Faith on the Anointed, New Character
    reachable but unlisted). Used when no pack ships a `screens` section. */
export function buildDefaultNavModel(): NavModel {
  const itemsById: Record<string, ResolvedNavItem> = {};
  const groups: ResolvedNavGroup[] = NAV.map(g => {
    const items = g.items.map<ResolvedNavItem>(it => {
      const enabledWhen =
        it.id === 'magic' ? compileEnabled('isCaster')
        : it.id === 'faith' ? compileEnabled('isAnointed')
        : undefined;
      const resolved: ResolvedNavItem = {
        id: it.id, kind: it.id, label: it.label, icon: it.icon, badge: it.badge, enabledWhen,
      };
      itemsById[it.id] = resolved;
      return resolved;
    });
    return { id: g.section.toLowerCase(), label: g.section, items };
  });
  // Reachable from the Roster screen but deliberately absent from the rail.
  itemsById.newchar = {
    id: 'newchar', kind: 'newchar', label: 'New Character', icon: coerceIcon('plus'), hideFromNav: true,
  };

  return {
    groups,
    itemsById,
    crumbs: { ...SCREEN_CRUMBS },
    allIds: Object.keys(itemsById),
    defaultScreenId: 'overview',
  };
}
