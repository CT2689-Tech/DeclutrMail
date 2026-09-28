import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { reconcileAction } from './reconcile-action';
import { sendersKeys } from '@/features/senders/api/query-keys';

describe('terminal action reconciliation', () => {
  it('reconciles a shared terminal snapshot once, but never swallows a changed result', () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const failed = { status: 'failed' };
    reconcileAction(client, failed);
    reconcileAction(client, failed);
    expect(
      invalidate.mock.calls.filter(([filter]) => filter?.queryKey === sendersKeys.all),
    ).toHaveLength(1);
    reconcileAction(client, { status: 'done' });
    expect(
      invalidate.mock.calls.filter(([filter]) => filter?.queryKey === sendersKeys.all),
    ).toHaveLength(2);
  });
  it('scopes known enqueue results, retaining list/summary and all affected detail children', () => {
    const client = new QueryClient();
    for (const key of [
      sendersKeys.list(),
      sendersKeys.summary(),
      sendersKeys.detail('a'),
      sendersKeys.messages('a'),
      sendersKeys.timeseries('a'),
      sendersKeys.detail('b'),
    ]) {
      client.setQueryData(key, {});
    }
    const mutation = client.getMutationCache().build(client, {});
    mutation.state = {
      ...mutation.state,
      variables: { senderId: 'a' },
      data: { actionId: 'job', secondaryId: 'child' },
    };
    reconcileAction(client, { status: 'failed' }, 'child');
    expect(client.getQueryState(sendersKeys.detail('a'))?.isInvalidated).toBe(true);
    expect(client.getQueryState(sendersKeys.timeseries('a'))?.isInvalidated).toBe(true);
    expect(client.getQueryState(sendersKeys.messages('a'))?.isInvalidated).toBe(true);
    expect(client.getQueryState(sendersKeys.list())?.isInvalidated).toBe(true);
    expect(client.getQueryState(sendersKeys.summary())?.isInvalidated).toBe(true);
    expect(client.getQueryState(sendersKeys.detail('b'))?.isInvalidated).toBe(false);
  });
  it('keeps unknown/recovered and bulk/undo handles broad', () => {
    const client = new QueryClient();
    client.setQueryData(sendersKeys.detail('other'), {});
    reconcileAction(client, { status: 'failed' }, 'recovered');
    expect(client.getQueryState(sendersKeys.detail('other'))?.isInvalidated).toBe(true);
  });
});
