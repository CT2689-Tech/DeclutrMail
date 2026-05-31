import { describe, expect, it } from 'vitest';

import {
  ACTION_TIER_RANK,
  ACTION_VERBS,
  CANONICAL_SHORTCUTS,
  SELECTOR_TYPES,
} from '../contracts/verb-constants';
import { ACTION_REGISTRY, listActionDescriptors } from './manifest-entries';

/**
 * The Action Registry invariants (ADR-0015 / consensus §5). These are
 * the contract the foundation ships with ZERO consumers — they catch
 * drift the moment P5 appends a verb or a capability.
 */
describe('Action Registry (ADR-0015)', () => {
  // 1. constants ↔ manifest bijection — no orphan verb, no orphan entry.
  it('has exactly one descriptor per verb in ACTION_VERBS', () => {
    expect(Object.keys(ACTION_REGISTRY).sort()).toEqual([...ACTION_VERBS].sort());
    for (const verb of ACTION_VERBS) {
      expect(ACTION_REGISTRY[verb].verb, verb).toBe(verb);
    }
  });

  // 2. D227 canonical shortcuts hardwired — K/A/U/L never drift.
  it('declares the correct D227 shortcut for every canonical verb present', () => {
    const canonical = CANONICAL_SHORTCUTS as Record<string, string>;
    for (const descriptor of listActionDescriptors()) {
      const expected = canonical[descriptor.verb];
      if (expected !== undefined) {
        expect(descriptor.shortcut, descriptor.verb).toBe(expected);
      }
    }
  });

  // 3. label-modify / unsubscribe verbs render a modal preview (D208/D226).
  //    `unsubscribe` joins the kind set at P5; the check is forward-safe.
  it('renders a modal preview for every label-modify / unsubscribe verb', () => {
    const modalRequiredKinds = new Set(['label-modify', 'unsubscribe']);
    for (const d of listActionDescriptors()) {
      if (modalRequiredKinds.has(d.execution.kind)) {
        expect(d.preview, d.verb).toBe('modal');
      }
    }
  });

  // 4. policy-only verbs preview as modal or inline-confirm — never silent
  //    (silent is Autopilot-only; a user verb always shows a preview, D226).
  it('previews every policy-only verb as modal or inline-confirm', () => {
    for (const d of listActionDescriptors()) {
      if (d.execution.kind === 'policy-only') {
        expect(['modal', 'inline-confirm'], d.verb).toContain(d.preview);
      }
    }
  });

  // 5. capabilitiesBySelector tier is monotonic across the selector funnel:
  //    sender ≤ multi-sender ≤ sender-filter (Free funnel coherence).
  it('keeps capability tiers non-decreasing across selectors (free ≤ plus ≤ pro)', () => {
    for (const d of listActionDescriptors()) {
      // `null` = the verb does not support that selector — a GAP, not a
      // tier regression. We drop gaps and assert monotonicity across the
      // selectors the verb DOES support (so `sender:free, filter:pro`
      // with no multi-sender still reads free ≤ pro).
      const ranks = SELECTOR_TYPES.map((sel) => {
        const cap = d.capabilities[sel];
        return cap ? ACTION_TIER_RANK[cap.tier] : null;
      }).filter((r): r is number => r !== null);
      for (let i = 1; i < ranks.length; i += 1) {
        const prev = ranks[i - 1] ?? 0;
        const curr = ranks[i] ?? 0;
        expect(
          curr >= prev,
          `${d.verb}: selector tiers must be non-decreasing, got ${ranks.join(' → ')}`,
        ).toBe(true);
      }
    }
  });
});
