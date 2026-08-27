import { describe, expect, it } from 'vitest';

import { AUTOPILOT_PRESETS, type PresetInput, type PresetSignals } from './autopilot-presets.js';

const SIGNALS_ZERO: PresetSignals = {
  isProtected: false,
  firstSeenDaysAgo: 365,
  totalMessages: 100,
  readRateLifetime: 0.5,
  lastSeenDaysAgo: 7,
};

function input(
  signalsOverride: Partial<PresetSignals>,
  decisionOverride: PresetInput['triageDecision'],
): PresetInput {
  return {
    signals: { ...SIGNALS_ZERO, ...signalsOverride },
    triageDecision: decisionOverride,
  };
}

describe('AUTOPILOT_PRESETS', () => {
  describe('preset #1 — auto_archive_low_engagement', () => {
    const p = AUTOPILOT_PRESETS.auto_archive_low_engagement;

    it('matches verdict=archive above default threshold 0.72', () => {
      const r = p.match(input({}, { verdict: 'archive', confidence: 0.92 }), null);
      expect(r.matched).toBe(true);
      expect(r.reason).toBe('Engine verdict=Archive @0.92 above threshold 0.72');
    });

    // The reason the default moved off D101's 0.85. `packages/shared/src/triage-engine/cascade.ts`
    // caps Archive at 0.74 unless the user has already archived that
    // sender 3+ times by hand, so at 0.85 this preset was inert by
    // construction — it swept the founder's mailbox once and took 0
    // actions. 0.73/0.74 is what a real Archive verdict scores.
    it('matches a real Archive score (0.74) — the reach 0.85 could never have', () => {
      expect(p.match(input({}, { verdict: 'archive', confidence: 0.74 }), null).matched).toBe(true);
      expect(p.match(input({}, { verdict: 'archive', confidence: 0.73 }), null).matched).toBe(true);
    });

    it('does NOT match exactly at the threshold (strict > per D101)', () => {
      const r = p.match(input({}, { verdict: 'archive', confidence: 0.72 }), null);
      expect(r.matched).toBe(false);
    });

    it('does NOT match below the threshold', () => {
      const r = p.match(input({}, { verdict: 'archive', confidence: 0.71 }), null);
      expect(r.matched).toBe(false);
    });

    it('honors a custom threshold from the rule', () => {
      const r = p.match(input({}, { verdict: 'archive', confidence: 0.78 }), 0.7);
      expect(r.matched).toBe(true);
      expect(r.reason).toContain('threshold 0.70');
    });

    it('does NOT match other verdicts (keep, unsubscribe, later)', () => {
      for (const verdict of ['keep', 'unsubscribe', 'later'] as const) {
        const r = p.match(input({}, { verdict, confidence: 0.99 }), null);
        expect(r.matched).toBe(false);
      }
    });

    it('does NOT match when triageDecision is null', () => {
      const r = p.match(input({}, null), null);
      expect(r.matched).toBe(false);
    });
  });

  describe('preset #2 — auto_unsubscribe_noisy', () => {
    const p = AUTOPILOT_PRESETS.auto_unsubscribe_noisy;

    it('default threshold is 0.90, strict >', () => {
      expect(p.match(input({}, { verdict: 'unsubscribe', confidence: 0.91 }), null).matched).toBe(
        true,
      );
      expect(p.match(input({}, { verdict: 'unsubscribe', confidence: 0.9 }), null).matched).toBe(
        false,
      );
    });

    it('default payload includes and_archive_future (D101 #2)', () => {
      expect(p.defaultActionPayload).toEqual({ and_archive_future: true });
    });

    it('does NOT fire on verdict=archive even at high confidence', () => {
      const r = p.match(input({}, { verdict: 'archive', confidence: 0.99 }), null);
      expect(r.matched).toBe(false);
    });
  });

  describe('preset #3 — auto_screen_new_senders', () => {
    const p = AUTOPILOT_PRESETS.auto_screen_new_senders;

    it('emits the later verdict (D227 — Screen is internal-only)', () => {
      expect(p.actionKind).toBe('later');
    });

    it('matches by day age alone', () => {
      const r = p.match(input({ firstSeenDaysAgo: 3, totalMessages: 20 }, null), null);
      expect(r.matched).toBe(true);
      expect(r.reason).toBe('New sender (3d old)');
    });

    it('matches by message count alone', () => {
      const r = p.match(input({ firstSeenDaysAgo: 90, totalMessages: 2 }, null), null);
      expect(r.matched).toBe(true);
      expect(r.reason).toBe('New sender (2 msgs)');
    });

    it('renders combined reason when both branches match', () => {
      const r = p.match(input({ firstSeenDaysAgo: 1, totalMessages: 1 }, null), null);
      expect(r.matched).toBe(true);
      expect(r.reason).toBe('New sender (1d old, 1 msgs)');
    });

    it('does NOT match boundary firstSeenDaysAgo=7', () => {
      const r = p.match(input({ firstSeenDaysAgo: 7, totalMessages: 20 }, null), null);
      expect(r.matched).toBe(false);
    });

    it('does NOT match boundary totalMessages=3', () => {
      const r = p.match(input({ firstSeenDaysAgo: 90, totalMessages: 3 }, null), null);
      expect(r.matched).toBe(false);
    });

    it('does NOT match an established sender', () => {
      const r = p.match(input({ firstSeenDaysAgo: 365, totalMessages: 200 }, null), null);
      expect(r.matched).toBe(false);
    });
  });

  describe('preset #4 — newsletter_graveyard', () => {
    const p = AUTOPILOT_PRESETS.newsletter_graveyard;

    it('matches read<5% AND last_seen>90d', () => {
      const r = p.match(input({ readRateLifetime: 0.02, lastSeenDaysAgo: 120 }, null), null);
      expect(r.matched).toBe(true);
      expect(r.reason).toBe('Read rate 2% across all 100 messages, last seen 120d ago');
    });

    it('does NOT match if read_rate is exactly 5%', () => {
      const r = p.match(input({ readRateLifetime: 0.05, lastSeenDaysAgo: 120 }, null), null);
      expect(r.matched).toBe(false);
    });

    it('does NOT match if last_seen is exactly 90 (strict >)', () => {
      const r = p.match(input({ readRateLifetime: 0.02, lastSeenDaysAgo: 90 }, null), null);
      expect(r.matched).toBe(false);
    });

    it('matches on a LIFETIME rate a 90-day window could never measure (F009)', () => {
      // The re-arm. `lastSeenDaysAgo > 90` guarantees a dormant sender
      // has no mail inside a 90-day window, so the old signal was
      // unmeasurable for every sender this preset can reach — its
      // `< 0.05` test could not fail, and 6,531 dormant senders matched
      // on a fabricated 0%. Measured over the sender's OWN mail, the
      // test discriminates again.
      const ignored = p.match(
        input({ readRateLifetime: 0.01, totalMessages: 40, lastSeenDaysAgo: 120 }, null),
        null,
      );
      expect(ignored.matched).toBe(true);

      // Same dormancy, same window — but the user read almost all of it.
      // Under the tautology this sender matched too.
      const read = p.match(
        input({ readRateLifetime: 0.95, totalMessages: 40, lastSeenDaysAgo: 120 }, null),
        null,
      );
      expect(read.matched).toBe(false);
    });

    it('still abstains when we hold no mail from the sender', () => {
      // `null` is unmeasurable, never "never read" — and this preset
      // ends in an unsubscribe.
      const r = p.match(
        input({ readRateLifetime: null, totalMessages: 40, lastSeenDaysAgo: 120 }, null),
        null,
      );
      expect(r.matched).toBe(false);
    });

    it('will not act on a handful of messages', () => {
      // A rate over one or two messages is noise. 0/4 is a perfect 0%
      // and still not evidence enough for a destructive verb.
      expect(
        p.match(input({ readRateLifetime: 0, totalMessages: 4, lastSeenDaysAgo: 120 }, null), null)
          .matched,
      ).toBe(false);
      expect(
        p.match(input({ readRateLifetime: 0, totalMessages: 5, lastSeenDaysAgo: 120 }, null), null)
          .matched,
      ).toBe(true);
    });

    it('names the evidence, including the denominator', () => {
      // "Read rate 0%" over 5 messages and over 500 are different
      // claims; the reason has to say which one it is.
      const r = p.match(
        input({ readRateLifetime: 0, totalMessages: 137, lastSeenDaysAgo: 120 }, null),
        null,
      );
      expect(r.reason).toBe('Read rate 0% across all 137 messages, last seen 120d ago');
    });

    it('does NOT match active newsletter', () => {
      const r = p.match(input({ readRateLifetime: 0.4, lastSeenDaysAgo: 120 }, null), null);
      expect(r.matched).toBe(false);
    });
  });

  describe('preset #5 — long_dormant_unsubscribe (D124 replacement)', () => {
    const p = AUTOPILOT_PRESETS.long_dormant_unsubscribe;

    it('matches read<5% AND last_seen>180d', () => {
      const r = p.match(input({ readRateLifetime: 0.01, lastSeenDaysAgo: 200 }, null), null);
      expect(r.matched).toBe(true);
      expect(r.reason).toBe('Read rate 1% across all 100 messages, last seen 200d ago');
    });

    it('does NOT match if last_seen ≤ 180', () => {
      const r = p.match(input({ readRateLifetime: 0.01, lastSeenDaysAgo: 180 }, null), null);
      expect(r.matched).toBe(false);
    });

    it('newsletter_graveyard fires before long_dormant for 91-179d range', () => {
      // Both presets are active; the worker runs each independently. Just
      // confirming neither matcher claims the wrong window.
      const signals = { readRateLifetime: 0.01, lastSeenDaysAgo: 120 };
      expect(AUTOPILOT_PRESETS.newsletter_graveyard.match(input(signals, null), null).matched).toBe(
        true,
      );
      expect(
        AUTOPILOT_PRESETS.long_dormant_unsubscribe.match(input(signals, null), null).matched,
      ).toBe(false);
    });

    it('disjoint windows — past 180d, only long_dormant matches (no double-fire)', () => {
      // Per Codex review of PR #65 (finding #2): the prior implementation
      // had newsletter_graveyard matching `> 90d` AND long_dormant matching
      // `> 180d`, so at 200d both fired → two unsubscribe-match rows for
      // the same sender. The (90, 180] bound on newsletter_graveyard makes
      // the two windows disjoint by construction.
      const signals = { readRateLifetime: 0.01, lastSeenDaysAgo: 200 };
      expect(AUTOPILOT_PRESETS.newsletter_graveyard.match(input(signals, null), null).matched).toBe(
        false,
      );
      expect(
        AUTOPILOT_PRESETS.long_dormant_unsubscribe.match(input(signals, null), null).matched,
      ).toBe(true);
    });

    it('newsletter_graveyard upper bound — does NOT match at lastSeenDaysAgo=181', () => {
      // Boundary test: 180 inclusive (matches), 181 exclusive (no match).
      const signals = { readRateLifetime: 0.02, lastSeenDaysAgo: 181 };
      expect(AUTOPILOT_PRESETS.newsletter_graveyard.match(input(signals, null), null).matched).toBe(
        false,
      );
    });

    it('newsletter_graveyard upper bound — DOES match at lastSeenDaysAgo=180 (inclusive)', () => {
      const signals = { readRateLifetime: 0.02, lastSeenDaysAgo: 180 };
      expect(AUTOPILOT_PRESETS.newsletter_graveyard.match(input(signals, null), null).matched).toBe(
        true,
      );
    });
  });

  describe('unmeasurable read rate abstains (F009)', () => {
    // `readRate90d` used to be fabricated as `0` when the sender had no
    // mail in the 90-day window. Both dormancy presets require
    // `lastSeenDaysAgo > 90`, which GUARANTEES no 90-day mail — so the
    // `readRate90d < 0.05` predicate could never fail and filtered
    // nothing. On the founder's mailbox that was 7,072 of 7,072
    // candidates matching, 95% of them senders read ≥90% of the time.
    it('newsletter_graveyard does NOT match on a null read rate', () => {
      const r = AUTOPILOT_PRESETS.newsletter_graveyard.match(
        input({ readRateLifetime: null, lastSeenDaysAgo: 120 }, null),
        null,
      );
      expect(r.matched).toBe(false);
    });

    it('long_dormant_unsubscribe does NOT match on a null read rate', () => {
      const r = AUTOPILOT_PRESETS.long_dormant_unsubscribe.match(
        input({ readRateLifetime: null, lastSeenDaysAgo: 200 }, null),
        null,
      );
      expect(r.matched).toBe(false);
    });

    it('null never reaches the reason string as "Read rate 0%"', () => {
      for (const days of [120, 200]) {
        for (const key of ['newsletter_graveyard', 'long_dormant_unsubscribe'] as const) {
          const r = AUTOPILOT_PRESETS[key].match(
            input({ readRateLifetime: null, lastSeenDaysAgo: days }, null),
            null,
          );
          expect(r.reason).not.toContain('Read rate');
        }
      }
    });
  });

  describe('preset metadata', () => {
    it('all 5 D101 preset keys present', () => {
      const keys = Object.keys(AUTOPILOT_PRESETS).sort();
      expect(keys).toEqual([
        'auto_archive_low_engagement',
        'auto_screen_new_senders',
        'auto_unsubscribe_noisy',
        'long_dormant_unsubscribe',
        'newsletter_graveyard',
      ]);
    });

    it('only verdict-gated presets have a default threshold', () => {
      expect(AUTOPILOT_PRESETS.auto_archive_low_engagement.defaultThreshold).toBe(0.72);
      expect(AUTOPILOT_PRESETS.auto_unsubscribe_noisy.defaultThreshold).toBe(0.9);
      expect(AUTOPILOT_PRESETS.auto_screen_new_senders.defaultThreshold).toBeNull();
      expect(AUTOPILOT_PRESETS.newsletter_graveyard.defaultThreshold).toBeNull();
      expect(AUTOPILOT_PRESETS.long_dormant_unsubscribe.defaultThreshold).toBeNull();
    });

    it('action_kind values are K/A/U/L canonical per D227 (no keep)', () => {
      const allowed = new Set(['archive', 'unsubscribe', 'later']);
      for (const preset of Object.values(AUTOPILOT_PRESETS)) {
        expect(allowed.has(preset.actionKind)).toBe(true);
      }
    });
  });
});
