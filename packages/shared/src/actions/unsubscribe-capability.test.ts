import { describe, expect, it } from 'vitest';

import {
  countUnsubscribeCapabilities,
  isExecutableUnsubscribe,
  unsubscribeCapabilityBreakdown,
  unsubscribeCapabilityOf,
  unsubscribeOutcomeBreakdown,
  unsubscribeUnavailableReason,
} from './unsubscribe-capability';

describe('unsubscribeCapabilityOf', () => {
  it('maps each stored method to its own state', () => {
    expect(unsubscribeCapabilityOf('one_click')).toBe('one_click');
    expect(unsubscribeCapabilityOf('mailto')).toBe('mailto');
    expect(unsubscribeCapabilityOf('none')).toBe('none');
  });

  // The defect this module exists to prevent: NULL means the sender
  // index has not derived a method, which is NOT the same fact as
  // "this sender publishes no unsubscribe".
  it('reads a NULL method as unknown, never as none', () => {
    expect(unsubscribeCapabilityOf(null)).toBe('unknown');
    expect(unsubscribeCapabilityOf(null)).not.toBe('none');
    expect(unsubscribeCapabilityOf(undefined)).toBe('unknown');
  });

  it('treats only one_click as executable by DeclutrMail', () => {
    expect(isExecutableUnsubscribe('one_click')).toBe(true);
    expect(isExecutableUnsubscribe('mailto')).toBe(false);
    expect(isExecutableUnsubscribe('none')).toBe(false);
    expect(isExecutableUnsubscribe(null)).toBe(false);
  });
});

describe('countUnsubscribeCapabilities', () => {
  it('partitions a selection across all four states', () => {
    const counts = countUnsubscribeCapabilities([
      'one_click',
      'one_click',
      'mailto',
      null,
      'none',
      undefined,
    ]);
    expect(counts).toEqual({ one_click: 2, mailto: 1, none: 1, unknown: 2 });
  });

  it('keeps unknown senders out of the none bucket', () => {
    const counts = countUnsubscribeCapabilities([null, null, null]);
    expect(counts.unknown).toBe(3);
    expect(counts.none).toBe(0);
  });

  it('counts nothing for an empty selection', () => {
    expect(countUnsubscribeCapabilities([])).toEqual({
      one_click: 0,
      mailto: 0,
      none: 0,
      unknown: 0,
    });
  });
});

describe('unsubscribeCapabilityBreakdown', () => {
  it('states every non-empty group separately — never one aggregate', () => {
    const lines = unsubscribeCapabilityBreakdown({
      one_click: 8,
      mailto: 4,
      none: 2,
      unknown: 1,
    });
    expect(lines).toEqual([
      '8 senders we can unsubscribe for you',
      '4 senders need an email you send yourself',
      '2 senders offer no unsubscribe',
      "1 sender we haven't checked yet",
    ]);
    // 15 senders were selected; no line may claim the whole selection.
    expect(lines.join(' · ')).not.toContain('15');
  });

  it('omits empty groups and singularizes', () => {
    expect(
      unsubscribeCapabilityBreakdown({ one_click: 1, mailto: 1, none: 1, unknown: 1 }),
    ).toEqual([
      '1 sender we can unsubscribe for you',
      '1 sender needs an email you send yourself',
      '1 sender offers no unsubscribe',
      "1 sender we haven't checked yet",
    ]);
    expect(
      unsubscribeCapabilityBreakdown({ one_click: 1, mailto: 0, none: 0, unknown: 0 }),
    ).toEqual(['1 sender we can unsubscribe for you']);
  });

  it('never describes an unknown sender as offering no unsubscribe', () => {
    const [line] = unsubscribeCapabilityBreakdown({
      one_click: 0,
      mailto: 0,
      none: 0,
      unknown: 3,
    });
    expect(line).toBe("3 senders we haven't checked yet");
    expect(line).not.toContain('no unsubscribe');
  });
});

describe('unsubscribeUnavailableReason', () => {
  it('is null while a channel exists', () => {
    expect(unsubscribeUnavailableReason('one_click')).toBeNull();
    expect(unsubscribeUnavailableReason('mailto')).toBeNull();
  });

  it('claims we looked ONLY when the index actually recorded none', () => {
    expect(unsubscribeUnavailableReason('none')).toBe(
      'No unsubscribe channel found — Archive handles senders like this.',
    );
  });

  it('says not-yet-checked for a sender with no derived method', () => {
    const reason = unsubscribeUnavailableReason(null);
    expect(reason).toBe(
      "We haven't checked this sender for an unsubscribe option yet — Archive works in the meantime.",
    );
    expect(reason).not.toContain('No unsubscribe channel found');
  });
});

describe('unsubscribeOutcomeBreakdown', () => {
  it('reports all three terminal outcomes without collapsing any', () => {
    expect(unsubscribeOutcomeBreakdown({ endpointAccepted: 6, unconfirmed: 2, failed: 1 })).toEqual(
      ['6 requests accepted', '2 requests sent, results unconfirmed', '1 request failed'],
    );
  });

  it('says "accepted", never "unsubscribed"', () => {
    const line = unsubscribeOutcomeBreakdown({
      endpointAccepted: 3,
      unconfirmed: 0,
      failed: 0,
    }).join(' ');
    expect(line).toContain('accepted');
    expect(line.toLowerCase()).not.toContain('unsubscribed');
  });

  it('keeps unconfirmed out of both the accepted and failed lines', () => {
    const lines = unsubscribeOutcomeBreakdown({
      endpointAccepted: 0,
      unconfirmed: 4,
      failed: 0,
    });
    expect(lines).toEqual(['4 requests sent, results unconfirmed']);
    expect(lines.join(' ')).not.toContain('accepted');
    expect(lines.join(' ')).not.toContain('failed');
  });

  it('omits outcomes that did not happen', () => {
    expect(unsubscribeOutcomeBreakdown({ endpointAccepted: 0, unconfirmed: 0, failed: 0 })).toEqual(
      [],
    );
  });
});
