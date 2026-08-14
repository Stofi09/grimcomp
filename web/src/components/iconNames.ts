export type IconName =
  | 'shield' | 'grid' | 'scroll' | 'star' | 'crown' | 'book'
  | 'sword' | 'heart' | 'sparkle' | 'flame' | 'pack' | 'mask'
  | 'tome' | 'quill' | 'users' | 'gear' | 'plus' | 'search'
  | 'bell' | 'chev' | 'dice' | 'minus' | 'check' | 'info'
  | 'menu';

/** Runtime set of icon names accepted by the Icon component. */
export const ICON_NAMES: ReadonlySet<string> = new Set<IconName>([
  'shield', 'grid', 'scroll', 'star', 'crown', 'book',
  'sword', 'heart', 'sparkle', 'flame', 'pack', 'mask',
  'tome', 'quill', 'users', 'gear', 'plus', 'search',
  'bell', 'chev', 'dice', 'minus', 'check', 'info', 'menu',
]);

export const DEFAULT_ICON: IconName = 'info';

/** Map a pack-authored icon string to a supported glyph. */
export function coerceIcon(name: string | undefined): IconName {
  return name !== undefined && ICON_NAMES.has(name) ? (name as IconName) : DEFAULT_ICON;
}
