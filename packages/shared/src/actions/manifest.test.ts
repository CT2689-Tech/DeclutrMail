import { describe, expect, it } from 'vitest';

import {
  ACTION_TIER_RANK,
  ACTION_VERBS,
  CANONICAL_SHORTCUTS,
  COMPOSITE_PRIMARY_VERBS,
  SELECTOR_TYPES,
} from '../contracts/verb-constants';
import { ACTION_REGISTRY, listActionDescriptors } from './manifest-entries';
import { ACTION_SEMANTICS } from './action-semantics';

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
      expect(ACTION_REGISTRY[verb].semantics, verb).toBe(ACTION_SEMANTICS[verb]);
      expect(ACTION_REGISTRY[verb].copy.primary, verb).toBe(ACTION_SEMANTICS[verb].label);
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

  // 4b. Each verb routes to its DECIDED execution.kind (P4 decision —
  //     documented for founder review). Pinned so a future edit that
  //     re-routes `later` to a snooze kind or misclassifies `unsubscribe`
  //     as label-modify (the Codex §4 error) is a failing test, not a
  //     silent drift.
  it('routes each verb to its decided execution.kind', () => {
    const byVerb = Object.fromEntries(
      listActionDescriptors().map((d) => [d.verb, d.execution.kind]),
    );
    expect(byVerb).toEqual({
      keep: 'policy-only',
      archive: 'label-modify',
      later: 'label-modify',
      unsubscribe: 'unsubscribe',
      // ADR-0019 + spec v1.2 Decision 1 — Delete routes via label-modify
      // (Gmail TRASH is a label) so it rides the LabelActionWorker.
      delete: 'label-modify',
      unarchive: 'label-modify',
    });
  });

  // 4c. `unsubscribe` carries its standing side-effect label and nothing
  //     that could leak a body (D7) — label ids only.
  it('gives unsubscribe a label-only side-effect', () => {
    const d = ACTION_REGISTRY.unsubscribe;
    expect(d.execution.kind).toBe('unsubscribe');
    if (d.execution.kind === 'unsubscribe') {
      expect(d.execution.sideEffect).toEqual({ addLabelIds: ['DeclutrMail/Unsubscribed'] });
    }
  });

  // 4d. The label-modify verbs build a forward/reverse INBOX delta that
  //     round-trips (undo is the inverse). Catches a reverse that does
  //     not actually undo the forward.
  it('builds invertible INBOX deltas for label-modify verbs', () => {
    for (const d of listActionDescriptors()) {
      if (d.execution.kind !== 'label-modify') continue;
      const { forward, reverse } = d.execution.buildLabelChange({});
      // INBOX appears on exactly one side of the forward delta and the
      // opposite side of the reverse — the move is undoable.
      const fwdRemovesInbox = forward.removeLabelIds?.includes('INBOX') ?? false;
      const fwdAddsInbox = forward.addLabelIds?.includes('INBOX') ?? false;
      const revRemovesInbox = reverse.removeLabelIds?.includes('INBOX') ?? false;
      const revAddsInbox = reverse.addLabelIds?.includes('INBOX') ?? false;
      expect(fwdRemovesInbox || fwdAddsInbox, `${d.verb}: forward touches INBOX`).toBe(true);
      expect(fwdRemovesInbox, `${d.verb}: reverse inverts INBOX`).toBe(revAddsInbox);
      expect(fwdAddsInbox, `${d.verb}: reverse inverts INBOX`).toBe(revRemovesInbox);
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

  // The verb-agnostic bulk-preview wire carries sender ids only. Keep
  // every verb it previews on one selector tier until that backwards-
  // compatible API contract is deliberately versioned to include verb.
  it('keeps every composite primary on the same multi-sender preview tier', () => {
    const tiers = COMPOSITE_PRIMARY_VERBS.map(
      (verb) => ACTION_REGISTRY[verb].capabilities['multi-sender']?.tier,
    );
    expect(new Set(tiers)).toEqual(new Set(['plus']));
  });
});
