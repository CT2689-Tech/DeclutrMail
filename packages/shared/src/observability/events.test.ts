import { describe, expect, it } from 'vitest';

import type { EventName, EventPayloads } from './events';

const D246_EVENTS = [
  'activation_goal_selected',
  'first_relief_session_started',
  'action_preview_viewed',
  'action_confirmed',
  'first_relief_session_completed',
  'autopilot_pattern_suggestion_shown',
  'autopilot_pattern_suggestion_decided',
  'product_feedback_submitted',
  'weekly_review_viewed',
] as const satisfies readonly EventName[];

const FEEDBACK_EXAMPLES = [
  { surface: 'activity', rating: 'surprising' },
  { surface: 'brief', rating: 'wrong_reason' },
  { surface: 'followups', rating: 'not_followup' },
] as const satisfies readonly EventPayloads['product_feedback_submitted'][];

describe('D246 observability contract', () => {
  it('keeps activation, trust, and review events in the closed union', () => {
    expect(D246_EVENTS).toHaveLength(9);
  });

  it('keeps feedback ratings surface-specific', () => {
    expect(FEEDBACK_EXAMPLES.map((example) => example.surface)).toEqual([
      'activity',
      'brief',
      'followups',
    ]);
  });
});
