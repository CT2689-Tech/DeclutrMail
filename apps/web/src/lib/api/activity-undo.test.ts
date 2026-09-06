import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';
import { revertActivityUndo } from './activity';

afterEach(() => {
  resetFetchStub();
  vi.useRealTimers();
});

function stubUndo(poll: () => Response | Promise<Response>, reverted = false) {
  let posts = 0;
  let polls = 0;
  installFetchStub([
    {
      method: 'POST',
      path: '/api/undo/token/action',
      respond: (req) => {
        expect(req.headers.get('X-Active-Mailbox-Id')).toBe('mailbox-a');
        posts++;
        return jsonOk({ data: { reverted, actionId: reverted ? null : 'reverse' } });
      },
    },
    {
      method: 'GET',
      path: '/api/actions/reverse',
      respond: (req) => {
        expect(req.headers.get('X-Active-Mailbox-Id')).toBe('mailbox-a');
        polls++;
        return poll();
      },
    },
  ]);
  return { posts: () => posts, polls: () => polls };
}

describe('Activity action-only Undo lifecycle', () => {
  it('polls queued and executing without posting twice, stopping only on confirmed reversal', async () => {
    vi.useFakeTimers();
    const states = ['queued', 'executing', 'done'];
    const requests = stubUndo(() => {
      const status = states.shift();
      return jsonOk({
        data: { status, undoRevertedAt: status === 'done' ? '2026-09-06T18:00:00Z' : null },
      });
    });
    const pending = revertActivityUndo('token', 'mailbox-a');
    const success = expect(pending).resolves.toBeUndefined();
    await vi.runAllTimersAsync();
    await success;
    expect(requests.posts()).toBe(1);
    expect(requests.polls()).toBe(3);
  });

  it('does not poll an already completed Undo', async () => {
    const requests = stubUndo(() => {
      throw new Error('unexpected poll');
    }, true);
    await revertActivityUndo('token', 'mailbox-a');
    expect(requests.polls()).toBe(0);
  });

  it('reports a terminal failure without claiming that no email changed', async () => {
    stubUndo(() => jsonOk({ data: { status: 'failed', affectedCount: 2 } }));
    await expect(revertActivityUndo('token', 'mailbox-a')).rejects.toThrow(
      'Some emails may have been restored',
    );
  });

  it('does not declare success for done without a recorded reversal', async () => {
    stubUndo(() => jsonOk({ data: { status: 'done', undoRevertedAt: null } }));
    await expect(revertActivityUndo('token', 'mailbox-a')).rejects.toThrow("Couldn't confirm Undo");
  });

  it('stops on status access failure without claiming the background action failed', async () => {
    const requests = stubUndo(() => new Response('{}', { status: 403 }));
    await expect(revertActivityUndo('token', 'mailbox-a')).rejects.toThrow('It may still finish');
    expect(requests.polls()).toBe(1);
  });

  it('bounds a stuck job wait and reports an unconfirmed outcome', async () => {
    vi.useFakeTimers();
    const requests = stubUndo(() => jsonOk({ data: { status: 'executing' } }));
    const pending = expect(revertActivityUndo('token', 'mailbox-a')).rejects.toThrow(
      'taking longer than expected',
    );
    await vi.runAllTimersAsync();
    await pending;
    expect(requests.polls()).toBe(120);
  });
});
