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

  it('keeps the drop2-r11 move and mailto lines', () => {
    expect(WS5_COPY['f1.toast.bulk.delete']).toEqual({
      one: 'Unsubscribe requested from {m} senders · Deleted 1 email',
      other: 'Unsubscribe requested from {m} senders · Deleted {n} emails',
    });
    expect(WS5_COPY['f1.activity.row.delete']).toBe('Unsubscribe requested · Deleted {n} emails');
    expect(WS5_COPY['f1.toast.mailto.withMove.archive']).toBe(
      'Archived {n} emails. To finish unsubscribing, press Send on the email that’s ready in Gmail.',
    );
    expect(WS5_COPY['f1.toast.mailto.withMove.delete']).toBe(
      'Deleted {n} emails. To finish unsubscribing, press Send on the email that’s ready in Gmail.',
    );
  });
});
