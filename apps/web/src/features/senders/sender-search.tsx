'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, tokens } from '@declutrmail/shared';
import { useSenderSuggestions } from './api/use-sender-suggestions';
import type { Sender } from './data';

const { color, font } = tokens;

const SUGGEST_DEBOUNCE_MS = 150;

/**
 * Sender search w/ live typeahead.
 *
 * Suggestions span the WHOLE mailbox via `GET /api/senders/suggest`
 * (mailbox-scoped, ranked by `total_received DESC`), not just the
 * loaded list page. Typing also propagates to the host via `onChange`
 * so the underlying list narrows in lockstep.
 *
 * Debounced 150ms — typing fires ~3 keystrokes/sec; 150ms catches
 * pauses without piling up cancelled queries. The query is keyed by
 * the debounced term so an in-flight fetch for an obsolete term
 * resolves into a stale cache, not the active dropdown.
 *
 * Privacy (D7): the suggestion row renders allowlisted fields only —
 * name, domain, `totalReceived`. No body, snippet, or headers.
 */
export function SenderSearch({
  value,
  onChange,
  senders,
  onPick,
}: {
  value: string;
  onChange: (next: string) => void;
  /**
   * Fallback pool from the loaded list page. Used to render the
   * dropdown while the BE suggestion query is in flight so the user
   * never sees a flash of "no matches" on a fresh keystroke. The BE
   * result supersedes this once it lands.
   */
  senders: Sender[];
  /** Called when a suggestion is chosen — lets the host clear filters. */
  onPick?: (sender: { id: string; name: string; domain: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [debounced, setDebounced] = useState(value);
  const ref = useRef<HTMLDivElement>(null);

  // Debounce the term that feeds the BE typeahead. The visible input
  // stays controlled by `value` — only the network query trails.
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), SUGGEST_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [value]);

  const remote = useSenderSuggestions(debounced, { limit: 8 });

  // Local fallback for the gap between keystroke and the first BE hit.
  // When the remote query has landed (success or empty), it wins; until
  // then we surface the loaded-page matches so the dropdown isn't empty
  // mid-typing.
  const fallbackMatches = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return [];
    return senders
      .filter((s) => s.name.toLowerCase().includes(q) || s.domain.toLowerCase().includes(q))
      .slice(0, 6)
      .map((s) => ({ id: s.id, name: s.name, domain: s.domain, monthly: s.monthly }));
  }, [value, senders]);

  // Resolve the dropdown row set. Empty query → nothing. Remote result
  // available → use it. Otherwise the fallback while we wait.
  const trimmed = value.trim();
  const matches = useMemo(() => {
    if (trimmed.length === 0) return [];
    if (remote.suggestions.length > 0 || (!remote.loading && !remote.error)) {
      return remote.suggestions.map((s) => ({
        id: s.id,
        name: s.name,
        domain: s.domain,
        // Suggestions don't carry monthly volume — show the lifetime
        // total instead so the row still has a quantitative anchor.
        secondary: s.totalReceived.toLocaleString() + ' lifetime',
      }));
    }
    return fallbackMatches.map((s) => ({
      id: s.id,
      name: s.name,
      domain: s.domain,
      secondary: s.monthly + ' in last 30d',
    }));
  }, [trimmed, remote.suggestions, remote.loading, remote.error, fallbackMatches]);

  useEffect(() => {
    setActive(0);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const showList = open && (matches.length > 0 || (remote.loading && trimmed.length > 0));

  const pick = (s: { id: string; name: string; domain: string }) => {
    if (onPick) onPick(s);
    else onChange(s.name);
    setOpen(false);
  };

  return (
    <div ref={ref} style={{ position: 'relative', width: 220 }}>
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!showList) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((i) => Math.min(matches.length - 1, i + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => Math.max(0, i - 1));
          } else if (e.key === 'Enter') {
            const s = matches[active];
            if (s) pick(s);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        placeholder="Search senders…"
        aria-label="Search senders"
        role="combobox"
        aria-expanded={showList}
        aria-controls="dm-sender-search-list"
        aria-autocomplete="list"
        aria-activedescendant={showList ? `dm-sender-opt-${active}` : undefined}
        style={{
          height: 32,
          width: '100%',
          padding: '0 10px',
          background: color.card,
          color: color.fg,
          border: `1px solid ${color.border}`,
          borderRadius: 7,
          fontFamily: font.sans,
          fontSize: 12.5,
          outline: 'none',
        }}
      />

      {showList && (
        <div
          id="dm-sender-search-list"
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            zIndex: 50,
            background: color.card,
            border: `1px solid ${color.border}`,
            borderRadius: 9,
            boxShadow: tokens.shadow.pop,
            padding: 4,
            maxHeight: 320,
            overflowY: 'auto',
          }}
        >
          {matches.length === 0 && remote.loading && (
            <div
              style={{
                padding: '10px 12px',
                fontFamily: font.mono,
                fontSize: 11,
                color: color.fgMuted,
                letterSpacing: '0.04em',
              }}
            >
              searching mailbox…
            </div>
          )}
          {matches.map((s, i) => (
            <button
              key={s.id}
              id={`dm-sender-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(s)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                width: '100%',
                padding: '7px 8px',
                background: i === active ? color.primarySoft : 'transparent',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                textAlign: 'left',
                fontFamily: font.sans,
              }}
            >
              <Avatar name={s.name} domain={s.domain} size={24} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    display: 'block',
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: color.fg,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {s.name}
                </span>
                <span
                  style={{
                    display: 'block',
                    fontFamily: font.mono,
                    fontSize: 10,
                    color: color.fgMuted,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {s.domain}
                </span>
              </span>
              <span
                style={{
                  fontFamily: font.mono,
                  fontSize: 10,
                  color: color.fgMuted,
                  whiteSpace: 'nowrap',
                }}
              >
                {s.secondary}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
