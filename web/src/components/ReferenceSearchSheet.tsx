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

  React.useEffect(() => {
    if (!visible) return;
    setCategory(initialCategory);
    setQuery(initialQuery);
    setSelectedId(null);
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

      <div className="ref-search-results" role="listbox" aria-label="Reference results">
        {visibleResults.map(item => {
          const isSelected = selectedId === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={`btn-reset ref-search-result${isSelected ? ' ref-search-result--selected' : ''}`}
              role="option"
              aria-selected={isSelected}
              onClick={() => {
                setSelectedId(item.id);
                onViewed?.(item);
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
