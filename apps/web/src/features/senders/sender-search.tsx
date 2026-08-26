'use client';

import { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, tokens } from '@declutrmail/shared';
import { useSenderSuggestions } from './api/use-sender-suggestions';
import type { Sender } from './data';

const { color, font } = tokens;

/**
 * How long after the last keystroke the BE typeahead is asked.
 *
 * Must exceed the interval between keystrokes or it debounces nothing.
 * At 150ms it fired on every character of an ordinary word: typing
 * "baapstore" produced eight `GET /api/senders/suggest` calls, seven of
 * them cancelled (founder network capture, 2026-08-21).
 */
const SUGGEST_DEBOUNCE_MS = 250;

/**
 * How long after the last keystroke the HOST learns about the new query.
 *
 * Longer than the suggest debounce because it costs far more: the host
 * writes the term to the URL compose state, so each notify is a Next
 * router navigation (an `_rsc` round-trip) PLUS the senders list fetch —
 * measured at 2.7–4.4s each in the same capture, eight times for one
 * word. The dropdown is what has to feel live; the list behind it only
 * has to be right once the typing stops.
 */
const NOTIFY_DEBOUNCE_MS = 400;

/**
 * Sender search w/ live typeahead.
 *
 * Suggestions span the WHOLE mailbox via `GET /api/senders/suggest`
 * (mailbox-scoped, ranked by `total_received DESC`), not just the
 * loaded list page. Typing also propagates to the host via `onChange`
 * so the underlying list narrows in lockstep.
 *
 * Debounced — see the two constants above. The query is keyed by the
 * debounced term so an in-flight fetch for an obsolete term resolves
 * into a stale cache, not the active dropdown.
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
  const ref = useRef<HTMLDivElement>(null);

  // SEMI-controlled input (keystroke-eating fix, 2026-07-03 smoke).
  // The DOM input renders from LOCAL state and the host is notified on
  // a short DEBOUNCE — never per keystroke. Both halves matter:
  //   - Local state: the input's own re-render is tiny, so a keystroke
  //     echoes instantly.
  //   - Debounced notify: the host's query state re-renders the whole
  //     screen (50 cards, ~hundreds of ms in dev). When that render was
  //     tied to each keystroke, any commit that landed later than the
  //     next keystroke re-asserted a stale value onto the DOM input and
  //     ATE the characters typed in between (live repro: "chase" →
  //     "cha"). With the debounce the heavy render happens once per
  //     typing pause, when no keystroke is in flight to clobber.
  // `lastSentRef` distinguishes our own echo (host handing back what we
  // sent — ignore) from an external set (host cleared the search /
  // picked a suggestion — adopt).
  const [text, setText] = useState(value);
  const lastSentRef = useRef(value);
  const notifyTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (value !== lastSentRef.current) {
      // External set wins over anything in flight — cancel the pending
      // keystroke notify, or a stale timer would fire AFTER the adopt
      // and resurrect the cleared/replaced query in the host (Codex
      // review 2026-07-03: "Clear search & filters" undone by the
      // timer, input and list out of sync).
      if (notifyTimerRef.current !== null) {
        window.clearTimeout(notifyTimerRef.current);
        notifyTimerRef.current = null;
      }
      lastSentRef.current = value;
      setText(value);
    }
  }, [value]);
  useEffect(
    () => () => {
      if (notifyTimerRef.current !== null) window.clearTimeout(notifyTimerRef.current);
    },
    [],
  );
  const commit = (next: string) => {
    setText(next);
    if (notifyTimerRef.current !== null) window.clearTimeout(notifyTimerRef.current);
    notifyTimerRef.current = window.setTimeout(() => {
      notifyTimerRef.current = null;
      lastSentRef.current = next;
      // Transition: the host update is a whole-screen narrow — keep it
      // interruptible so a keystroke arriving mid-render still wins.
      startTransition(() => onChange(next));
    }, NOTIFY_DEBOUNCE_MS);
  };

  const [debounced, setDebounced] = useState(text);

  // Debounce the term that feeds the BE typeahead. The visible input
  // stays controlled by local `text` — only the network query trails.
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(text), SUGGEST_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [text]);

  const remote = useSenderSuggestions(debounced, { limit: 8 });

  // Local fallback for the gap between keystroke and the first BE hit.
  // When the remote query has landed (success or empty), it wins; until
  // then we surface the loaded-page matches so the dropdown isn't empty
  // mid-typing.
  const fallbackMatches = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!q) return [];
    return senders
      .filter((s) => s.name.toLowerCase().includes(q) || s.domain.toLowerCase().includes(q))
      .slice(0, 6)
      .map((s) => ({ id: s.id, name: s.name, domain: s.domain, monthly: s.monthlyVolume ?? 0 }));
  }, [text, senders]);

  // Resolve the dropdown row set. Empty query → nothing. Remote result
  // available → use it. Otherwise the fallback while we wait.
  const trimmed = text.trim();
  const matches = useMemo(() => {
    if (trimmed.length === 0) return [];
    if (remote.suggestions.length > 0 || (!remote.loading && !remote.error)) {
      return remote.suggestions.map((s) => ({
        id: s.id,
        name: s.name,
        domain: s.domain,
        // Suggestions don't carry monthly volume — show the lifetime
        // total instead so the row still has a quantitative anchor.
        // "emails" not "lifetime": next to the list's "N senders" counts,
        // a bare "421 lifetime" reads as unit-ambiguous (2026-07-16 smoke).
        // The bucket rides along with the count (F011). Omitted rather
        // than guessed when the wire does not say — an unlabelled row is
        // honest; a wrong label re-creates the contradiction.
        secondary:
          s.totalReceived.toLocaleString('en-US') +
          ' emails' +
          (s.activity ? ` · ${s.activity}` : ''),
      }));
    }
    return fallbackMatches.map((s) => ({
      id: s.id,
      name: s.name,
      domain: s.domain,
      secondary: s.monthly + ' in last 90d',
    }));
  }, [trimmed, remote.suggestions, remote.loading, remote.error, fallbackMatches]);

  useEffect(() => {
    setActive(0);
  }, [text]);

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
    // A pick is a discrete click — flush any pending keystroke notify
    // and tell the host NOW (no debounce; nothing can clobber it).
    if (notifyTimerRef.current !== null) {
      window.clearTimeout(notifyTimerRef.current);
      notifyTimerRef.current = null;
    }
    if (onPick) {
      // The host will hand the picked name back via `value` — let the
      // external-set sync adopt it (do NOT pre-mark as our own echo).
      onPick(s);
    } else {
      setText(s.name);
      lastSentRef.current = s.name;
      onChange(s.name);
    }
    setOpen(false);
  };

  return (
    <div ref={ref} style={{ position: 'relative', width: 220 }}>
      <input
        value={text}
        onChange={(e) => {
          commit(e.target.value);
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
              searching Gmail account…
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
