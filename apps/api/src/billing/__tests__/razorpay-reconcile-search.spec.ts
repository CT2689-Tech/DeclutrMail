import { afterEach, describe, expect, it, vi } from 'vitest';

import { RazorpayAdapter } from '../razorpay.adapter.js';

/**
 * RazorpayAdapter.searchSubscriptions pagination (D249, Codex round 4).
 *
 * A single count=100 page silently hid any match past page one — a
 * plan-wide false "no payment found" that unlocked the manual release
 * while a paid subscription existed on page two. These tests stub
 * fetch and assert the adapter walks pages until a short page, and
 * that cross-workspace rows never leak into the result.
 */

const adapter = new RazorpayAdapter({
  RAZORPAY_KEY_ID: 'rzp_test_key',
  RAZORPAY_KEY_SECRET: 'secret',
} as unknown as NodeJS.ProcessEnv);

function rzpItem(id: string, workspaceId: string, status = 'active') {
  return {
    id,
    plan_id: 'plan_test_plus_monthly',
    status,
    customer_id: 'cust_x',
    current_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
    notes: { workspace_id: workspaceId },
    created_at: Math.floor(Date.now() / 1000),
  };
}

function jsonResponse(items: unknown[]): Response {
  return new Response(JSON.stringify({ entity: 'collection', count: items.length, items }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RazorpayAdapter.searchSubscriptions', () => {
  it('walks past a full first page — a page-two match is found, not "none"', async () => {
    const calls: string[] = [];
    // Page 1: 100 other-workspace rows (full page → keep going).
    // Page 2: the workspace's own paid subscription (short page → stop).
    const page1 = Array.from({ length: 100 }, (_, i) => rzpItem(`sub_other_${i}`, 'ws-other'));
    const page2 = [rzpItem('sub_ours', 'ws-mine')];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        calls.push(String(url));
        return calls.length === 1 ? jsonResponse(page1) : jsonResponse(page2);
      }),
    );

    const result = await adapter.searchSubscriptions({
      workspaceId: 'ws-mine',
      email: 'ignored@razorpay.example',
      providerPriceIds: ['plan_test_plus_monthly'],
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('skip=0');
    expect(calls[1]).toContain('skip=100');
    // Cross-workspace rows filtered; the page-two match survived.
    expect(result.subscriptions.map((s) => s.providerSubscriptionId)).toEqual(['sub_ours']);
    expect(result.inProgress).toBe(0);
  });

  it('stops at a short page and counts pre-grant artifacts as inProgress', async () => {
    const items = [rzpItem('sub_3ds', 'ws-mine', 'authenticated'), rzpItem('sub_x', 'ws-other')];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(items)),
    );

    const result = await adapter.searchSubscriptions({
      workspaceId: 'ws-mine',
      email: 'ignored@razorpay.example',
      providerPriceIds: ['plan_test_plus_monthly'],
    });

    expect(result.subscriptions).toHaveLength(0);
    // The 3DS-window artifact is REAL activity — reported, never "no
    // payment found".
    expect(result.inProgress).toBe(1);
  });
});
