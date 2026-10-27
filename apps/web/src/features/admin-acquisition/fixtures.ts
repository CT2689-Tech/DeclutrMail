import {
  SIGNUP_HEARD_FROM_VALUES,
  type SignupAttributionReport,
} from '@declutrmail/shared/contracts';

/** Synthetic operator report: no production identities or free-text answers. */
export const ACQUISITION_REPORT_FIXTURE: SignupAttributionReport = {
  observedAt: '2026-10-27T18:00:00.000Z',
  totalAccounts: 24,
  answered: 15,
  skipped: 5,
  unanswered: 4,
  unrecognized: 0,
  channels: SIGNUP_HEARD_FROM_VALUES.filter((channel) => channel !== 'skipped').map((channel) => ({
    channel,
    count:
      ({ google: 6, ai_assistant: 4, reddit: 3, other: 2 } as Record<string, number>)[channel] ?? 0,
  })),
};
