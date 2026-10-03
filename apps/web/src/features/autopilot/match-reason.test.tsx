import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describeMatchReason } from './match-reason';
import { PendingSuggestionRow } from './pending-suggestion-row';
import { RulePreviewSample } from './rule-preview-panel';
import { AUTO_ARCHIVE_LOW_ENGAGEMENT, PENDING_SUGGESTIONS, RULE_PREVIEW_RESULT } from './fixtures';

describe('recorded Autopilot match explanations', () => {
  it('does not reinterpret adjusted historical rates as raw READ flags', () => {
    const copy = describeMatchReason('Read rate 0% across all 51 messages, last seen 105d ago');
    expect(copy.label).toBe('At matching: 51 indexed emails; last seen 105 days earlier.');
    expect(copy.technical).toBe('Read rate 0% across all 51 messages, last seen 105d ago');
    expect(copy.label).not.toMatch(/marked read|90 days|unread/);
  });

  it.each([
    ['New sender (1d old, 1 msgs)', 'At matching: first seen 1 day earlier · 1 indexed email'],
    ['New sender (0d old)', 'At matching: first seen 0 days earlier'],
    ['New sender (2 msgs)', 'At matching: 2 indexed emails'],
  ])('retains the actual branch evidence: %s', (reason, label) => {
    expect(describeMatchReason(reason)).toEqual({ label, technical: null });
  });

  it.each(['Archive', 'Unsubscribe'])(
    'keeps %s confidence in inspectable details without calling it an outcome',
    (action) => {
      const reason = `Engine verdict=${action} @0.95 above threshold 0.90`;
      expect(describeMatchReason(reason)).toEqual({
        label: `At matching: ${action} suggestion exceeded the rule's confidence threshold.`,
        technical: reason,
      });
    },
  );

  it.each([
    'Read rate 0% across all 0 messages, last seen 105d ago',
    'Read rate 101% across all 51 messages, last seen 105d ago',
    'Read rate 0% across all 9007199254740993 messages, last seen 105d ago',
    'Engine verdict=Archive @1.50 above threshold 0.72',
    'Engine verdict=Archive @0.70 above threshold 0.72',
    'monthly_volume=47, read_rate=0.04',
    'New sender ()',
    'Future matcher: window=unknown',
  ])('does not infer facts from unavailable/invalid/unknown evidence: %s', (reason) => {
    expect(describeMatchReason(reason)).toEqual({
      label: "Matches this rule's recorded conditions.",
      technical: reason,
    });
  });

  it('does not manufacture an explanation for missing evidence', () => {
    expect(describeMatchReason('')).toEqual({
      label: 'Match details unavailable.',
      technical: null,
    });
  });

  it('retains the matcher decision when display rounding makes both numbers equal', () => {
    const reason = 'Engine verdict=Archive @0.74 above threshold 0.74';
    expect(describeMatchReason(reason)).toEqual({
      label: "At matching: Archive suggestion exceeded the rule's confidence threshold.",
      technical: reason,
    });
  });

  it('pending rows disclose escaped diagnostics without changing selection or dismissing mail', () => {
    const select = vi.fn();
    const dismiss = vi.fn();
    const reason = '<img src=x onerror=alert(1)> window=unknown';
    const view = render(
      <PendingSuggestionRow
        match={{ ...PENDING_SUGGESTIONS[0]!, reason }}
        rule={AUTO_ARCHIVE_LOW_ENGAGEMENT}
        selected={false}
        onToggleSelect={select}
        onDismiss={dismiss}
        isDismissing={false}
      />,
    );
    const details = view.container.querySelector('details')!;
    expect(details).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('Show recorded match details'));
    expect(screen.getByText(reason)).toBeInTheDocument();
    expect(view.container.querySelector('img')).toBeNull();
    expect(select).not.toHaveBeenCalled();
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('rule preview shares recorded-time evidence and the adjusted-rate caveat', () => {
    render(
      <RulePreviewSample
        ruleName="Dormant sender"
        result={{
          ...RULE_PREVIEW_RESULT,
          sample: [
            {
              ...RULE_PREVIEW_RESULT.sample[0]!,
              reason: 'Read rate 4% across all 25 messages, last seen 181d ago',
            },
          ],
        }}
      />,
    );
    expect(
      screen.getByText('At matching: 25 indexed emails; last seen 181 days earlier.'),
    ).toBeVisible();
    expect(screen.getByText('Show recorded match details')).toBeVisible();
    expect(
      screen.getByText(/Read-rate diagnostics may exclude mail marked read by other tools/),
    ).toBeInTheDocument();
  });
});
