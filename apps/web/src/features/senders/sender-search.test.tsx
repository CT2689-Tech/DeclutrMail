/**
 * SenderSearch debounce (D38).
 *
 * Founder network capture 2026-08-21: typing "baapstore" into the
 * senders search fired EIGHT `GET /api/senders/suggest` calls (seven
 * cancelled) and eight host list fetches, each an `_rsc` navigation plus
 * a senders query measured at 2.7–4.4s. Both debounces were 150ms —
 * shorter than the gap between one keystroke and the next for an
 * ordinary typist, so each timer expired before the next character
 * arrived and the debounce debounced nothing.
 *
 * The invariant is therefore a RELATION, not a number: the debounce must
 * outlast the keystroke interval. These tests type at a realistic pace
 * and assert the network is asked once per word, not once per letter.
 * A future tuning pass that drops either constant back under
 * `KEYSTROKE_MS` fails here.
 *
 * The sibling keystroke-eating bug (2026-07-03) needed Playwright
 * because its mechanism was host-render latency, which jsdom cannot
 * exhibit. This one is pure timer arithmetic, which fake timers model
 * exactly.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const suggestCalls: string[] = [];

vi.mock('./api/use-sender-suggestions', () => ({
  useSenderSuggestions: (q: string) => {
    suggestCalls.push(q);
    return { suggestions: [], loading: false, error: false };
  },
}));

const { SenderSearch } = await import('./sender-search');

/**
 * Gap between characters for an ordinary typist. The component's own
 * docstring used to put this at ~3 keystrokes/sec (333ms) and then set a
 * 150ms debounce against it, which is the arithmetic that failed. 180ms
 * is deliberately at the FAST end of human typing — a debounce that
 * survives this survives a slower typist too.
 */
const KEYSTROKE_MS = 180;

function typeWord(word: string) {
  const input = screen.getByLabelText('Search senders');
  for (let i = 1; i <= word.length; i += 1) {
    fireEvent.change(input, { target: { value: word.slice(0, i) } });
    act(() => {
      vi.advanceTimersByTime(KEYSTROKE_MS);
    });
  }
}

/** Longer than either debounce — the pause after the word is finished. */
function settle() {
  act(() => {
    vi.advanceTimersByTime(1_000);
  });
}

beforeEach(() => {
  suggestCalls.length = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SenderSearch — one fetch per word, not per keystroke', () => {
  it('notifies the host once for a word typed at speed', () => {
    const onChange = vi.fn();
    render(<SenderSearch value="" onChange={onChange} senders={[]} />);

    typeWord('baapstore');
    settle();

    // The host notify is the expensive half: it writes the term to the
    // URL compose state, so every call is a router navigation plus the
    // senders list query. Eight of those for one word is the reported bug.
    expect(onChange.mock.calls.map(([q]) => q)).toEqual(['baapstore']);
  });

  it('asks the typeahead for one term, not every prefix', () => {
    render(<SenderSearch value="" onChange={vi.fn()} senders={[]} />);

    typeWord('baapstore');
    settle();

    // Prefixes the capture showed being fetched and thrown away:
    // ba, baa, baap, baaps, baapst, baapsto, baapstor.
    const queried = [...new Set(suggestCalls.filter((q) => q !== ''))];
    expect(queried).toEqual(['baapstore']);
  });

  it('keeps the input echoing every keystroke while the network waits', () => {
    render(<SenderSearch value="" onChange={vi.fn()} senders={[]} />);

    typeWord('baap');

    // The debounce must never reach the DOM input — that is the
    // keystroke-eating failure mode (2026-07-03), and raising these
    // timers is exactly the change that could reintroduce it.
    expect(screen.getByLabelText<HTMLInputElement>('Search senders').value).toBe('baap');
  });
});
