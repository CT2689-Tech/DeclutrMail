/**
 * Unit tests for the pure half of the D65 Noise bulk-archive hook.
 *
 * `buildNoiseTargets` is the join between the FROZEN snapshot (D69) and
 * the LIVE archive targets, so its failure modes are the ones that would
 * either drop a sender the Brief promised or hand a bulk action a sender
 * it must not touch (D245).
 */

import { describe, expect, it } from 'vitest';

import type { BriefNoiseSenderWire, BriefSenderGroupWire } from '@/lib/api/brief';

import { blockedReason, buildNoiseTargets } from './use-noise-archive';

const GROUPS: BriefSenderGroupWire[] = [
  { senderKey: 'sk-news', senderName: 'Newsletter Daily', messageCount: 4, messageIds: ['m1'] },
  { senderKey: 'sk-boss', senderName: 'Big Boss', messageCount: 2, messageIds: ['m2'] },
  { senderKey: 'sk-gone', senderName: 'Deleted Co', messageCount: 1, messageIds: ['m3'] },
];

const RESOLVED: BriefNoiseSenderWire[] = [
  { senderKey: 'sk-news', senderId: 'id-news', isProtected: false },
  { senderKey: 'sk-boss', senderId: 'id-boss', isProtected: true },
  { senderKey: 'sk-gone', senderId: null, isProtected: false },
];

describe('buildNoiseTargets', () => {
  it('carries the frozen count through untouched (D69)', () => {
    const targets = buildNoiseTargets(GROUPS, RESOLVED);
    expect(targets.map((t) => t.messageCount)).toEqual([4, 2, 1]);
    expect(targets.map((t) => t.senderName)).toEqual([
      'Newsletter Daily',
      'Big Boss',
      'Deleted Co',
    ]);
  });

  it('attaches the live sender id and protection state', () => {
    const [news, boss] = buildNoiseTargets(GROUPS, RESOLVED);
    expect(news!.senderId).toBe('id-news');
    expect(news!.isProtected).toBe(false);
    expect(boss!.senderId).toBe('id-boss');
    expect(boss!.isProtected).toBe(true);
  });

  it('keeps a group with no resolved target instead of dropping the row', () => {
    // The Brief said this sender mailed you yesterday. That stays true
    // whether or not we can still act on it — dropping the row would
    // quietly rewrite the frozen snapshot.
    const targets = buildNoiseTargets(GROUPS, RESOLVED);
    expect(targets).toHaveLength(3);
    expect(targets[2]!.senderId).toBeNull();
  });

  it('treats an entirely absent resolution list as nothing actionable', () => {
    // The API-skew case: a server deployed before D65 sends no
    // `noiseSenders` at all.
    const targets = buildNoiseTargets(GROUPS, []);
    expect(targets.every((t) => t.senderId === null)).toBe(true);
    expect(targets.every((t) => blockedReason(t) === 'unresolved')).toBe(true);
  });
});

describe('blockedReason', () => {
  it('blocks a Protected sender (D245)', () => {
    const [, boss] = buildNoiseTargets(GROUPS, RESOLVED);
    expect(blockedReason(boss!)).toBe('protected');
  });

  it('blocks a sender with no resolvable target', () => {
    const [, , gone] = buildNoiseTargets(GROUPS, RESOLVED);
    expect(blockedReason(gone!)).toBe('unresolved');
  });

  it('reports protection ahead of an unresolved id so the reason is never misleading', () => {
    expect(
      blockedReason({
        senderKey: 'k',
        senderName: 'n',
        messageCount: 1,
        senderId: null,
        isProtected: true,
      }),
    ).toBe('protected');
  });

  it('allows a resolved, unprotected sender', () => {
    const [news] = buildNoiseTargets(GROUPS, RESOLVED);
    expect(blockedReason(news!)).toBeNull();
  });
});
