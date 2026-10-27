import { z } from 'zod';
import { SIGNUP_HEARD_FROM_VALUES } from './signup-attribution';

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const answerChannel = z.enum(SIGNUP_HEARD_FROM_VALUES).exclude(['skipped']);

/** Founder-only all-time snapshot. No identities, free text or inferred response rate. */
export const SignupAttributionReportSchema = z
  .object({
    observedAt: z.string().datetime(),
    totalAccounts: count,
    answered: count,
    skipped: count,
    unanswered: count,
    unrecognized: count,
    channels: z.array(z.object({ channel: answerChannel, count }).strict()),
  })
  .strict()
  .superRefine((report, ctx) => {
    const channels = new Set(report.channels.map((row) => row.channel));
    if (
      channels.size !== answerChannel.options.length ||
      channels.size !== report.channels.length
    ) {
      ctx.addIssue({ code: 'custom', message: 'Every answer channel must appear exactly once.' });
    }
    const answerTotal = report.channels.reduce(
      (total, row) => total + row.count,
      report.unrecognized,
    );
    const accountTotal = report.answered + report.skipped + report.unanswered;
    if (
      !Number.isSafeInteger(answerTotal) ||
      answerTotal !== report.answered ||
      !Number.isSafeInteger(accountTotal) ||
      accountTotal !== report.totalAccounts
    ) {
      ctx.addIssue({ code: 'custom', message: 'Survey counts do not reconcile.' });
    }
  });

export type SignupAttributionReport = z.infer<typeof SignupAttributionReportSchema>;
