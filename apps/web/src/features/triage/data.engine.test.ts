import { describe, expect, it } from 'vitest';

import { TRIAGE_QUEUE, TRIAGE_FIXTURE_SEEDS } from './data';

// The demo's guided story depends on these exact verdicts: Groupon is the
// reversible Archive lesson, LinkedIn the one-way Unsubscribe lesson, and
// Priya the Protected lesson. Pinning them here means a cascade change
// that would silently rewrite the public demo fails in CI instead.
//
// D133 RESOLVED (2026-08-26). The original hand-written signals for five
// fixtures (groupon/oldnavy/nextdoor/substack/shipping) could not reach
// their intended verdict under the real cascade — proven by running
// `runCascade`, all seven free signals swept per fixture, no fudge; see
// the D133 task report for the full evidence. Founder-directed
// resolution: the engine is truth.
//
//   - The three GUIDED anchors (groupon/linkedin/priya) keep their
//     verdicts, because the guided demo's copy in
//     `inbox-simulator-screen.tsx` depends on them and that file is
//     mid-edit on an open PR (#646) — out of scope here. LinkedIn and
//     Priya already matched honestly. Groupon did not: its signals were
//     changed (not its verdict) to a combination that IS honest and
//     DOES reach Archive — see the fixture's own comment in `data.ts`.
//   - The other four (oldnavy/nextdoor/substack/shipping) take the
//     engine's real output. Their display fields were adjusted so the
//     rendered stats and the generated reasoning agree (see each
//     fixture's comment in `data.ts` for what changed and why).
const INTENDED_VERDICTS: Readonly<Record<string, string>> = {
  't-groupon': 'archive',
  't-linkedin': 'unsubscribe',
  't-oldnavy': 'unsubscribe',
  't-django': 'unsubscribe',
  't-nextdoor': 'unsubscribe',
  't-substack': 'keep',
  't-sarah': 'keep',
  't-priya': 'keep',
  't-shipping': 'later',
  // The amazon.com run (Plan 3 Task 2) — all six achieve their intended
  // verdict from freely-chosen, internally-consistent signals (no
  // existing display data to reconcile against, unlike the nine above).
  't-amazon-main': 'archive',
  't-amazon-primevideo': 'archive',
  't-amazon-advertising': 'unsubscribe',
  't-amazon-orders': 'later',
  't-amazon-photos': 'archive',
  't-amazon-security': 'keep',
};

describe('triage fixtures — engine-derived', () => {
  it('derives every verdict from the cascade, matching the demo the copy describes', () => {
    for (const [id, verdict] of Object.entries(INTENDED_VERDICTS)) {
      const row = TRIAGE_QUEUE.find((r) => r.id === id);
      expect(row, `fixture ${id} missing`).toBeDefined();
      expect(row!.verdict, `fixture ${id}`).toBe(verdict);
    }
  });

  it('derives reasoning from the template, never hand-written prose', () => {
    for (const row of TRIAGE_QUEUE) {
      expect(row.reasoning.length).toBeGreaterThan(0);
      // renderTemplate always names the sender. A hand-written string that
      // forgot to would slip through any length check.
      expect(row.reasoning).toContain(row.senderName);
    }
  });

  it('carries a confidence the cascade produced, in range', () => {
    for (const row of TRIAGE_QUEUE) {
      expect(row.confidence).toBeGreaterThanOrEqual(0);
      expect(row.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('has one seed per row, so nothing is hand-written alongside', () => {
    expect(TRIAGE_FIXTURE_SEEDS.length).toBe(TRIAGE_QUEUE.length);
  });
});
