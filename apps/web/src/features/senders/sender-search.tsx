'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, tokens } from '@declutrmail/shared';
import { GROUP_BY_KEY, type Sender } from './data';

const { color, font } = tokens;

/**
 * Sender search with a live typeahead. Typing filters the table (via
 * `onChange`); the dropdown surfaces the top matches for quick jump.
 */
export function SenderSearch({
  value,
  onChange,
  senders,
  onPick,
}: {
  value: string;
  onChange: (next: string) => void;
  senders: Sender[];
  /** Called when a suggestion is chosen — lets the host clear filters. */
  onPick?: (sender: Sender) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return [];
    return senders
      .filter((s) => s.name.toLowerCase().includes(q) || s.domain.toLowerCase().includes(q))
      .slice(0, 6);
  }, [value, senders]);

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

  const showList = open && matches.length > 0;

  const pick = (s: Sender) => {
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
                {s.monthly} in last 30d · {GROUP_BY_KEY[s.group].label}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
