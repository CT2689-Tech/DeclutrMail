import { describe, expect, it } from 'vitest';
import { sampleSenders } from './fixture';
import {
  SAMPLE_NOW,
  initialSampleMail,
  toActionSender,
  buildSamplePreview,
  applySampleAction,
  restoreSampleMail,
  countSampleInbox,
  type SampleMail,
} from './action-fixtures';
const sender = sampleSenders[0]!;
const DAY = 86_400_000;

describe('synthetic production-action preview model', () => {
  it('matches all initial inbox sizes and supplies explicit protection state', () => {
    const mail = initialSampleMail();
    for (const item of sampleSenders) {
      expect(countSampleInbox(mail, item.id)).toBe(item.inbox);
      expect(toActionSender(item).protectionFlags.isProtected).toBe(item.protected);
      expect(toActionSender(item).unsubscribeMethod).toBe('one_click');
    }
    expect(new Set(mail.map((row) => row.id)).size).toBe(mail.length);
  });
  it('keeps date samples inside their actual age window and separate reach', () => {
    const mail = initialSampleMail();
    const preview = buildSamplePreview(sender, mail);
    expect(preview.allMail!.counts.all).toBe(preview.counts.all + 18);
    for (const [key, days] of Object.entries({
      olderThan30d: 30,
      olderThan90d: 90,
      olderThan180d: 180,
      olderThan365d: 365,
    })) {
      const bucket = key as keyof typeof preview.counts;
      for (const sample of preview.recentMessages[bucket])
        expect(Date.parse(sample.date!)).toBeLessThan(SAMPLE_NOW - days * DAY);
      expect(preview.counts[bucket]).toBe(
        mail.filter(
          (row) =>
            row.senderId === sender.id &&
            row.location === 'inbox' &&
            Date.parse(row.date) < SAMPLE_NOW - days * DAY,
        ).length,
      );
    }
  });
  it('applies default Delete only to inbox mail over 180 days, and explicit all reaches more', () => {
    const mail = initialSampleMail();
    const preview = buildSamplePreview(sender, mail);
    const normal = applySampleAction(mail, sender.id, 'Delete', {});
    expect(normal.affected.length).toBe(preview.counts.olderThan180d);
    expect(normal.inboxAffected).toBe(normal.affected.length);
    const expanded = applySampleAction(mail, sender.id, 'Delete', {
      olderThanDays: null,
      reach: 'all_mail',
    });
    expect(expanded.affected.length).toBe(preview.allMail!.counts.all);
    expect(expanded.inboxAffected).toBe(sender.inbox);
  });
  it('Archive defaults to all inbox and Later ignores unsupported age/reach', () => {
    const mail = initialSampleMail();
    for (const action of ['Archive', 'Later'] as const) {
      const result = applySampleAction(
        mail,
        sender.id,
        action,
        action === 'Later' ? { olderThanDays: 365, reach: 'all_mail' } : { reach: 'all_mail' },
      );
      expect(result.affected.length).toBe(sender.inbox);
      expect(
        result.mail.filter((row) => row.senderId === sender.id && row.location === 'archived')
          .length,
      ).toBe(action === 'Archive' ? sender.inbox + 18 : 18);
    }
  });
  it('Keep and Unsubscribe alone leave mail in place; composite uses its own age and reach', () => {
    const mail = initialSampleMail();
    const preview = buildSamplePreview(sender, mail);
    for (const action of ['Keep', 'Unsubscribe'] as const)
      expect(applySampleAction(mail, sender.id, action, {}).affected).toEqual([]);
    const result = applySampleAction(mail, sender.id, 'Unsubscribe', {
      olderThanDays: 30,
      secondary: { type: 'delete', olderThanDays: 365 },
      reach: 'all_mail',
    });
    expect(result.affected.length).toBe(preview.allMail!.counts.olderThan365d);
    expect(result.unsubscribeRequested).toBe(true);
    expect(result.cleanupAction).toBe('Delete');
  });
  it('restores original inbox and archive locations without undoing another sender', () => {
    const original = initialSampleMail();
    const first = applySampleAction(original, sender.id, 'Delete', {
      olderThanDays: null,
      reach: 'all_mail',
    });
    const second = applySampleAction(first.mail, sampleSenders[1]!.id, 'Archive', {});
    const restored = restoreSampleMail(second.mail, first.affected);
    expect(restored.filter((row) => row.senderId === sender.id)).toEqual(
      original.filter((row) => row.senderId === sender.id),
    );
    expect(countSampleInbox(restored, sampleSenders[1]!.id)).toBe(0);
    expect(buildSamplePreview(sender, restored).counts.all).toBe(sender.inbox);
  });
  it('uses a strict older-than boundary and never reprocesses trash', () => {
    const mail: SampleMail[] = [180, 181].map((age) => ({
      id: String(age),
      senderId: sender.id,
      subject: 'Boundary',
      date: new Date(SAMPLE_NOW - age * DAY).toISOString(),
      location: 'inbox',
    }));
    const result = applySampleAction(mail, sender.id, 'Delete', {});
    expect(result.affected.map((row) => row.id)).toEqual(['181']);
    expect(
      applySampleAction(result.mail, sender.id, 'Delete', { reach: 'all_mail' }).affected,
    ).toEqual([]);
  });
  it('all-mail Delete includes Later mail and recovery restores its original Later state', () => {
    const original = initialSampleMail();
    const deferred = applySampleAction(original, sender.id, 'Later', {});
    const preview = buildSamplePreview(sender, deferred.mail);
    expect(preview.counts.all).toBe(0);
    expect(preview.allMail!.counts.all).toBe(sender.inbox + 18);
    const deleted = applySampleAction(deferred.mail, sender.id, 'Delete', {
      olderThanDays: null,
      reach: 'all_mail',
    });
    expect(deleted.affected.length).toBe(sender.inbox + 18);
    expect(deleted.inboxAffected).toBe(0);
    expect(deleted.affected.filter((row) => row.location === 'later')).toHaveLength(sender.inbox);
    expect(restoreSampleMail(deleted.mail, deleted.affected)).toEqual(deferred.mail);
  });
});
