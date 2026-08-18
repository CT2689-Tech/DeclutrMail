import { describe, expect, it } from 'vitest';

import {
  ACTION_PREVIEW_CLAIM,
  ACTION_SAFETY_SUMMARY,
  AI_PROCESSING_DISCLOSURE,
  BRIEF_AI_DISCLOSURE,
  MANUAL_ACTION_SCOPE_CLAIM,
} from './action-safety';

describe('canonical public product-truth copy', () => {
  it('does not promise that unsubscribe can be undone', () => {
    expect(ACTION_SAFETY_SUMMARY).toContain('cannot be taken back');
    expect(ACTION_SAFETY_SUMMARY).toContain('Before a manual action moves mail');
    expect(ACTION_SAFETY_SUMMARY).toContain('On Plus, Autopilot finds matches');
    expect(ACTION_SAFETY_SUMMARY).toContain('On Pro, rules you turn on');
    expect(ACTION_SAFETY_SUMMARY).toContain('unless you empty Trash sooner');
    expect(ACTION_SAFETY_SUMMARY).not.toMatch(/every action (?:is )?(?:reversible|undoable)/i);
  });

  it('separates manual message actions from future automation', () => {
    expect(MANUAL_ACTION_SCOPE_CLAIM).toContain('New mail from that sender is unchanged');
    expect(MANUAL_ACTION_SCOPE_CLAIM).toContain('Pro can run rules you turn on automatically');
  });

  it('describes the count-and-sample preview without promising a frozen full set', () => {
    expect(ACTION_PREVIEW_CLAIM).toContain('how many emails are affected');
    expect(ACTION_PREVIEW_CLAIM).toContain('sample when available');
    expect(ACTION_PREVIEW_CLAIM).toContain('final number can change');
    expect(ACTION_PREVIEW_CLAIM).not.toMatch(/exact (?:messages|set|scope)/i);
  });

  it('names the preview snippet boundary for Brief', () => {
    expect(BRIEF_AI_DISCLOSURE).toContain('Anthropic');
    expect(BRIEF_AI_DISCLOSURE).toContain('preview snippet');
    expect(BRIEF_AI_DISCLOSURE).toContain('never sends the full contents of an email');
  });

  it('distinguishes explanation inputs from Brief inputs', () => {
    expect(AI_PROCESSING_DISCLOSURE).toContain('short explanation for a suggestion');
    expect(AI_PROCESSING_DISCLOSURE).toContain('does not send subject lines');
    expect(AI_PROCESSING_DISCLOSURE).toContain('Pro Brief');
  });
});
