import { describe, expect, it } from 'vitest';

import { expectMatchesDeck } from './expect-matches-deck';
import { WS1_COPY, WS2_COPY, WS3_COPY, WS4_COPY, WS5_COPY } from './index';

describe('launch copy deck snapshots', () => {
  it.each([
    ['ws1', WS1_COPY],
    ['ws2', WS2_COPY],
    ['ws3', WS3_COPY],
    ['ws4', WS4_COPY],
    ['ws5', WS5_COPY],
  ] as const)('%s matches its checked-in deck section', (section, copy) => {
    expectMatchesDeck(section, copy);
  });

  it('fails when a module drifts from the deck section', () => {
    expect(() => expectMatchesDeck('ws1', { extra: 'not in the deck' })).toThrow();
  });

  it('pins the drop2-r20 inbox report support line and pricing meta description', () => {
    expect(WS5_COPY['report.mostlyUnread.support']).toEqual({
      one: 'That sender had less than 10% of its email marked read in Gmail in that time.',
      other:
        'Each of those {n} senders had less than 10% of its email marked read in Gmail in that time.',
    });
    expect(WS5_COPY['report.glyph']).toBe('about {n} in 10');
    expect(WS1_COPY['pricing.meta.description']).toBe(
      'Free is $0 with {allowance} emails cleared a month and unlimited unsubscribes. The {passName} is {passPrice} once. {plusName} is {plusPrice} a year. 30-day Undo on every plan.',
    );
    expect(WS2_COPY.aiPrompt._notShipping).toEqual([
      'text',
      'review',
      'dismiss',
      'dismissAria',
      'frequency',
    ]);
  });

  it('pins the drop2-r23 home scan-failed sentences', () => {
    expect(WS2_COPY.home.failed).toEqual({
      title: 'The scan stopped',
      body: 'Your progress is saved. Try the scan again, and if it keeps stopping, get help.',
      retry: 'Try again',
      help: 'Get help',
    });
  });

  it('pins the drop2-r18 trash sentences', () => {
    expect(WS2_COPY.dialog.delete.footer).toBe(
      'Undo from Activity for 30 days. Deleted email sits in Gmail Trash, and Gmail deletes it for good after 30 days, or sooner if you empty Trash.',
    );
    expect(WS2_COPY.home.nextLargest.body).toBe(
      'About {size} of email (Gmail’s estimates). Archiving doesn’t change storage. Deleted email sits in Gmail Trash, and Gmail deletes it for good after 30 days, or sooner if you empty Trash.',
    );
    expect(WS4_COPY.email.weekly.trust).toBe(
      'Nothing was deleted permanently. Deleted email sits in Gmail Trash, and Gmail deletes it for good after 30 days, or sooner if you empty Trash.',
    );
  });

  it('keeps the drop2-r7 unsubscribe lines', () => {
    expect(WS5_COPY['f1.footer']).toBe('Whether their email stops is up to the sender.');
    expect(WS5_COPY['f1.preview.future.mailto']).toBe(
      'Future emails: we’ll open a prefilled email in Gmail for you to send to {Sender}.',
    );
    expect(WS5_COPY['f1.toast.mailto']).toBe(
      'The email is ready in Gmail. Press Send there to finish.',
    );
    expect(WS5_COPY['f1.preview.future.mailto']).not.toMatch(/draft/i);
    expect(WS5_COPY['f1.toast.mailto']).not.toMatch(/draft/i);
  });

  it('keeps the drop2-r17 toast parts and combined activity rows', () => {
    expect(WS5_COPY['f1.toast.part.unsub']).toEqual({
      one: 'Unsubscribe requested from 1 sender',
      other: 'Unsubscribe requested from {m} senders',
    });
    expect(WS5_COPY['f1.toast.part.archived']).toEqual({
      one: 'Archived 1 email',
      other: 'Archived {n} emails',
    });
    expect(WS5_COPY['f1.toast.part.deleted']).toEqual({
      one: 'Deleted 1 email',
      other: 'Deleted {n} emails',
    });
    expect(WS5_COPY['f1.activity.row']).toEqual({
      one: 'Unsubscribe requested · Archived 1 email',
      other: 'Unsubscribe requested · Archived {n} emails',
    });
    expect(WS5_COPY['f1.reason.paused']).toBe('unsubscribe requests are paused right now');
    expect(WS5_COPY['f1.reason.skipped.notFound']).toBe(
      'the sender is no longer found, so nothing was sent',
    );
    expect(WS5_COPY['f1.protected.leadNoReason']).toBe('{Sender} is Protected.');
  });

  it('keeps the drop2-r13 move, mailto, and skip lines', () => {
    expect(WS5_COPY['f1.toast.bulk.delete']).toEqual({
      one: 'Unsubscribe requested from {m} senders · Deleted 1 email',
      other: 'Unsubscribe requested from {m} senders · Deleted {n} emails',
    });
    expect(WS5_COPY['f1.activity.row.delete']).toEqual({
      one: 'Unsubscribe requested · Deleted 1 email',
      other: 'Unsubscribe requested · Deleted {n} emails',
    });
    expect(WS5_COPY['f1.toast.mailto.withMove.archive']).toEqual({
      one: 'Archived 1 email. To finish unsubscribing, press Send on the email that’s ready in Gmail.',
      other:
        'Archived {n} emails. To finish unsubscribing, press Send on the email that’s ready in Gmail.',
    });
    expect(WS5_COPY['f1.toast.mailto.withMove.delete']).toEqual({
      one: 'Deleted 1 email. To finish unsubscribing, press Send on the email that’s ready in Gmail.',
      other:
        'Deleted {n} emails. To finish unsubscribing, press Send on the email that’s ready in Gmail.',
    });
    expect(WS5_COPY['f1.reason.skipped']).toBe('the sender is Protected, so nothing was sent');
    expect(WS5_COPY['f1.toast.unsub.skipped']).toEqual({
      one: 'No unsubscribe sent: 1 sender is Protected, so it was left as it is.',
      other: 'No unsubscribe sent: {n} senders are Protected, so they were left as they are.',
    });
    expect(WS5_COPY['f1.toast.unsub.skipped.plain']).toEqual({
      one: 'No unsubscribe sent. That sender was left as it is.',
      other: 'No unsubscribe sent. Those {n} senders were left as they are.',
    });
    expect(WS5_COPY['f1.toast.bulkSkipped']).toEqual({
      one: '1 Protected sender left as it is',
      other: '{k} Protected senders left as they are',
    });
  });
});
