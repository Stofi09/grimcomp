import * as React from 'react';
import { useContent } from '@/content/useContent';
import {
  buildReferenceItems,
  type ReferenceCategory,
  type ReferenceItem,
} from '@/utils/referenceSearch';
import { EditSheet } from './EditSheet';
import { TextField } from './Fields';
import { Pill } from './Pill';
import './ReferenceSearchSheet.css';

const CATEGORIES: ReferenceCategory[] = [
  'Careers',
  'Skills',
  'Talents',
  'Spells',
  'Prayers',
  'Conditions',
  'Critical Wounds',
  'Chaos & Mutation',
];

interface ReferenceSearchSheetProps {
  visible: boolean;
  onClose: () => void;
  initialCategory?: ReferenceCategory | 'All';
  initialQuery?: string;
  title?: string;
  onViewed?: (item: ReferenceItem) => void;
}

export const ReferenceSearchSheet: React.FC<ReferenceSearchSheetProps> = ({
  visible,
  onClose,
  initialCategory = 'All',
  initialQuery = '',
  title = 'Search rules',
  onViewed,
}) => {
  const registry = useContent();
  const items = React.useMemo(() => buildReferenceItems(registry), [registry]);
  const [category, setCategory] = React.useState<ReferenceCategory | 'All'>(initialCategory);
  const [query, setQuery] = React.useState(initialQuery);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const listboxId = React.useId();
  const listboxRef = React.useRef<HTMLDivElement>(null);
  const optionRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

  React.useEffect(() => {
    if (!visible) return;
    setCategory(initialCategory);
    setQuery(initialQuery);
    setSelectedId(null);
    setActiveId(null);
  }, [initialCategory, initialQuery, visible]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = items.filter(item => {
    if (category !== 'All' && item.category !== category) return false;
    if (!normalizedQuery) return true;
    return `${item.name} ${item.meta} ${item.detail}`
      .toLocaleLowerCase()
      .includes(normalizedQuery);
  });
  const visibleResults = filtered.slice(0, 80);
  const selected = items.find(item => item.id === selectedId);
  const storedActiveIndex = visibleResults.findIndex(item => item.id === activeId);
  const activeIndex = storedActiveIndex >= 0
    ? storedActiveIndex
    : visibleResults.length > 0 ? 0 : -1;
  const activeItem = activeIndex >= 0 ? visibleResults[activeIndex] : undefined;
  const activeOptionId = activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined;

  const selectItem = (item: ReferenceItem) => {
    setActiveId(item.id);
    setSelectedId(item.id);
    onViewed?.(item);
  };

  const moveActive = (nextIndex: number) => {
    const nextItem = visibleResults[nextIndex];
    if (!nextItem) return;
    setActiveId(nextItem.id);
    optionRefs.current[nextIndex]?.scrollIntoView?.({ block: 'nearest' });
  };

  const onResultsKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (visibleResults.length === 0) return;

    let nextIndex: number | undefined;
    switch (event.key) {
      case 'ArrowDown':
        nextIndex = Math.min(activeIndex + 1, visibleResults.length - 1);
        break;
      case 'ArrowUp':
        nextIndex = Math.max(activeIndex - 1, 0);
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = visibleResults.length - 1;
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (activeItem) selectItem(activeItem);
        return;
      default:
        return;
    }

    event.preventDefault();
    moveActive(nextIndex);
  };

  return (
    <EditSheet
      visible={visible}
      title={title}
      subtitle={`${filtered.length} matching entries in the loaded offline content.`}
      onClose={onClose}
    >
      <TextField
        label="Search"
        value={query}
        onChangeText={next => {
          setQuery(next);
          setSelectedId(null);
          setActiveId(null);
        }}
        placeholder="name, rule text, lore, or source"
        autoCapitalize="none"
      />

      <div className="ref-search-categories" role="group" aria-label="Reference category">
        {(['All', ...CATEGORIES] as const).map(candidate => (
          <button
            key={candidate}
            type="button"
            className={`btn-reset ref-search-chip${category === candidate ? ' ref-search-chip--active' : ''}`}
            aria-pressed={category === candidate}
            onClick={() => {
              setCategory(candidate);
              setSelectedId(null);
              setActiveId(null);
            }}
          >
            {candidate}
          </button>
        ))}
      </div>

      {selected ? (
        <div className="ref-search-detail" aria-live="polite">
          <div className="ref-search-detail-head">
            <div>
              <span className="ref-search-detail-name">{selected.name}</span>
              <span className="ref-search-detail-meta">{selected.meta}</span>
            </div>
            <Pill variant="brass" size={9.5}>{selected.category}</Pill>
          </div>
          <p className="ref-search-detail-body">{selected.detail}</p>
        </div>
      ) : null}

      <div
        ref={listboxRef}
        className="ref-search-results"
        role="listbox"
        aria-label="Reference results"
        aria-activedescendant={activeOptionId}
        tabIndex={0}
        onKeyDown={onResultsKeyDown}
      >
        {visibleResults.map((item, index) => {
          const isSelected = selectedId === item.id;
          const isActive = activeIndex === index;
          return (
            <button
              key={item.id}
              ref={element => { optionRefs.current[index] = element; }}
              id={`${listboxId}-option-${index}`}
              type="button"
              className={`btn-reset ref-search-result${isSelected ? ' ref-search-result--selected' : ''}${isActive ? ' ref-search-result--active' : ''}`}
              role="option"
              aria-selected={isSelected}
              tabIndex={-1}
              onMouseDown={event => event.preventDefault()}
              onClick={() => {
                selectItem(item);
                listboxRef.current?.focus();
              }}
            >
              <span className="ref-search-result-main">
                <span className="ref-search-result-name">{item.name}</span>
                <span className="ref-search-result-meta">{item.meta}</span>
              </span>
              <span className="ref-search-result-category">{item.category}</span>
            </button>
          );
        })}
        {visibleResults.length === 0 ? (
          <span className="ref-search-empty">No loaded reference entries match this search.</span>
        ) : null}
        {filtered.length > visibleResults.length ? (
          <span className="ref-search-limit">
            Showing the first {visibleResults.length} of {filtered.length}; narrow the search to see more.
          </span>
        ) : null}
      </div>
    </EditSheet>
  );
};
