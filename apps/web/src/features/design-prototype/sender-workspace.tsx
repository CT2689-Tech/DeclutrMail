'use client';
import { useState } from 'react';
import type { PrototypeProps, SampleSender } from './fixture';

export function useSenderWorkspace(senders: SampleSender[]) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'volume' | 'low' | 'protected'>('all');
  const [sort, setSort] = useState('volume');
  const [selection, setSelection] = useState<string[]>([]);
  const [minimum, setMinimum] = useState('0');
  const toggleSelected = (id: string) =>
    setSelection((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  const filtered = senders
    .filter(
      (x) =>
        `${x.name} ${x.email}`.toLowerCase().includes(search.toLowerCase()) &&
        x.inbox >= Number(minimum) &&
        (filter === 'all' ||
          (filter === 'protected'
            ? x.protected
            : filter === 'volume'
              ? x.inbox >= 75
              : x.markedRead < 20)),
    )
    .sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name)
        : sort === 'read'
          ? a.markedRead - b.markedRead
          : b.inbox - a.inbox,
    );
  return {
    search,
    setSearch,
    filter,
    setFilter,
    sort,
    setSort,
    selection,
    setSelection,
    minimum,
    setMinimum,
    toggleSelected,
    filtered,
  };
}

export function SenderWorkspaceControls({
  p,
  styles: s,
}: {
  p: PrototypeProps;
  styles: Record<string, string>;
}) {
  const {
    search,
    setSearch,
    filter,
    setFilter,
    sort,
    setSort,
    selection,
    setSelection,
    minimum,
    setMinimum,
    filtered,
  } = p.workspace;
  return (
    <>
      {' '}
      <div className={s.filters}>
        {(['all', 'volume', 'low', 'protected'] as const).map((x) => (
          <button
            key={x}
            aria-pressed={filter === x}
            className={filter === x ? s.filterActive : ''}
            onClick={() => setFilter(x)}
          >
            {x === 'all'
              ? 'All senders'
              : x === 'volume'
                ? 'High volume'
                : x === 'low'
                  ? 'Low marked-read'
                  : 'Protected'}
          </button>
        ))}
      </div>
      <details className={s.moreFilters}>
        <summary>More filters{minimum !== '0' ? ' · 1 active' : ''}</summary>
        <div className={s.filterFields}>
          <label>
            Inbox volume
            <select value={minimum} onChange={(e) => setMinimum(e.target.value)}>
              <option value="0">Any volume</option>
              <option value="50">50+ emails</option>
              <option value="100">100+ emails</option>
            </select>
          </label>
          <label>
            Sort by
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="volume">Most inbox emails</option>
              <option value="read">Lowest marked-read</option>
              <option value="name">Sender name</option>
            </select>
          </label>
        </div>
      </details>
      {minimum !== '0' && (
        <div className={s.activeFilters}>
          <button onClick={() => setMinimum('0')} aria-label="Remove inbox volume filter">
            {minimum}+ inbox emails ×
          </button>
        </div>
      )}
      <div className={s.filterSummary}>
        <span>
          {filtered.length} of {p.senders.length} senders
          {filter === 'volume'
            ? ' · 75+ inbox emails'
            : filter === 'low'
              ? ' · Under 20% marked read · 90 days'
              : ''}
        </span>
        {(filter !== 'all' || minimum !== '0' || search) && (
          <button
            onClick={() => {
              setFilter('all');
              setMinimum('0');
              setSearch('');
            }}
          >
            Clear filters
          </button>
        )}
      </div>
      <div className={s.selectionHeader}>
        <label>
          <input
            type="checkbox"
            aria-label="Select all matching senders"
            checked={filtered.length > 0 && filtered.every((x) => selection.includes(x.id))}
            onChange={(e) =>
              setSelection(
                e.target.checked
                  ? Array.from(new Set([...selection, ...filtered.map((x) => x.id)]))
                  : selection.filter((id) => !filtered.some((x) => x.id === id)),
              )
            }
          />{' '}
          Select matching ({filtered.length})
        </label>
        <span>INBOX</span>
      </div>
      {selection.length > 0 && (
        <div className={s.bulkBar}>
          <strong>{selection.length} senders selected</strong>
          <span>
            {p.senders.filter((x) => selection.includes(x.id) && x.protected).length} protected ·
            excluded from bulk cleanup
          </span>
          <span>
            {selection.filter((id) => !filtered.some((x) => x.id === id)).length > 0
              ? 'Includes hidden selections'
              : 'Ready to review together'}
          </span>
          <div>
            {(['Archive', 'Unsubscribe', 'Delete'] as const).map((action) => (
              <button
                key={action}
                onClick={() =>
                  p.showInfo(
                    `Bulk ${action.toLowerCase()} · layout preview`,
                    `${selection.length} senders selected. ${p.senders.filter((x) => selection.includes(x.id) && x.protected).length} protected senders would be skipped. This previews the toolbar placement only; bulk execution is not connected in this layout study.`,
                  )
                }
              >
                {action}
              </button>
            ))}
            <button onClick={() => setSelection([])}>Clear selection</button>
          </div>
        </div>
      )}
    </>
  );
}
