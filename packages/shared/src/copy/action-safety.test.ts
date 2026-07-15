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
    expect(ACTION_SAFETY_SUMMARY).toContain('cannot be recalled');
    expect(ACTION_SAFETY_SUMMARY).toContain('Manual sender cleanup');
    expect(ACTION_SAFETY_SUMMARY).toContain('Observe-mode Autopilot approvals');
    expect(ACTION_SAFETY_SUMMARY).toContain('without a new per-message approval');
    expect(ACTION_SAFETY_SUMMARY).toContain('emptying Trash can end that separate fallback sooner');
    expect(ACTION_SAFETY_SUMMARY).not.toMatch(/every action (?:is )?(?:reversible|undoable)/i);
  });

  it('separates manual message actions from future automation', () => {
    expect(MANUAL_ACTION_SCOPE_CLAIM).toContain('do not create future-mail rules');
    expect(MANUAL_ACTION_SCOPE_CLAIM).toContain('Pro Autopilot');
  });

  it('describes the count-and-sample preview without promising a frozen full set', () => {
    expect(ACTION_PREVIEW_CLAIM).toContain('current matching count');
    expect(ACTION_PREVIEW_CLAIM).toContain('sample when available');
    expect(ACTION_PREVIEW_CLAIM).toContain('final affected count can change');
    expect(ACTION_PREVIEW_CLAIM).not.toMatch(/exact (?:messages|set|scope)/i);
  });

  it('names the preview snippet boundary for Brief', () => {
    expect(BRIEF_AI_DISCLOSURE).toContain('Anthropic');
    expect(BRIEF_AI_DISCLOSURE).toContain('preview snippet');
    expect(BRIEF_AI_DISCLOSURE).toContain('Full message bodies are never fetched');
  });

  it('distinguishes explanation inputs from Brief inputs', () => {
    expect(AI_PROCESSING_DISCLOSURE).toContain('Recommendation explanations');
    expect(AI_PROCESSING_DISCLOSURE).toContain('do not send subject lines');
    expect(AI_PROCESSING_DISCLOSURE).toContain('Pro Brief');
  });
});
