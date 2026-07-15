import type { ChangelogEntry } from './types';

/**
 * Evidence comes from `git log --first-parent` on the repository. There are
 * currently no public semver tags, so the public surface calls these
 * repository builds instead of inventing release numbers.
 */
export const CHANGELOG_ENTRIES: readonly ChangelogEntry[] = [
  {
    id: '2026-07-10',
    date: '2026-07-10',
    title: 'Decision flow and trust polish',
    summary:
      'The latest repository build tightened sender decisions, protected-sender behavior, consent handling, and plan gating across the app.',
    added: [
      'A noise-prevented payoff shared by Triage, Senders, and Activity.',
      'Same-verdict Archive and Later batch banners in Triage.',
      'A higher-contrast first-Triage practice lineup during onboarding.',
    ],
    improved: [
      'Protected senders now resolve to Keep recommendations instead of cleanup recommendations.',
      'Autopilot, Later scheduling, and Quiet now expose their Pro plan gates consistently.',
    ],
    fixed: [
      'Closing the optional analytics consent banner is recorded as a decline.',
      'The authentication loading state now matches the shape of the app shell.',
    ],
    evidence: [
      { commit: '5b8f9174', pullRequest: 322, summary: 'Noise-prevented payoff' },
      { commit: '23b1ba3d', pullRequest: 321, summary: 'Archive/Later batch banner' },
      { commit: '438634ed', pullRequest: 320, summary: 'Consent and auth-shell fixes' },
      { commit: 'e2da5221', pullRequest: 318, summary: 'Protected-sender recommendation fix' },
      { commit: '5ab85737', pullRequest: 317, summary: 'Pro route gating' },
      { commit: 'b3bd07f3', pullRequest: 316, summary: 'First-Triage practice contrast' },
    ],
  },
  {
    id: '2026-07-09',
    date: '2026-07-09',
    title: 'Mobile and public-surface build',
    summary:
      'This repository build expanded public discovery and made secondary product surfaces usable on smaller screens.',
    added: [
      'Public SEO, answer-engine, and structured-data foundations for the marketing surface.',
      'A mobile Activity card list with a bottom-sheet filter drawer.',
    ],
    improved: [
      'Secondary product screens and topbar controls now restack for mobile widths.',
      'Account and billing remain reachable when no Gmail mailbox is active.',
    ],
    fixed: ['Refund messaging was aligned with the canonical 30-day paid-plan guarantee.'],
    evidence: [
      { commit: 'ec55425e', pullRequest: 307, summary: 'SEO/AEO/GEO foundations' },
      { commit: '1390f429', pullRequest: 305, summary: 'Secondary-screen mobile restack' },
      { commit: '8951e5f1', pullRequest: 303, summary: 'Activity mobile list and filters' },
      { commit: '2a79705f', pullRequest: 308, summary: 'Account, billing, and refund honesty' },
    ],
  },
  {
    id: '2026-07-08',
    date: '2026-07-08',
    title: 'Launch workflows take shape',
    summary:
      'A broad set of user-facing sender, triage, automation, Brief, Quiet, Activity, and settings workflows landed in repository history.',
    added: [
      'Sender brand rollups, multi-sender actions, and saved views.',
      'Autopilot observe digests, activation previews, and rule statistics.',
      'Triage session progress, keyboard help, swipe actions, and domain batches.',
      'Connected-account health, CSV export, and notification preferences in Settings.',
    ],
    improved: [
      'Brief uses local-time windows and opens the relevant message back in Gmail.',
      'Quiet shows held-action counts and the current quiet-window end time.',
      'Senders restored the grid/table view switch for dense review.',
    ],
    fixed: [
      'Activity gained a distinct confirmed-unsubscribe outcome instead of treating intent as success.',
      'The database action vocabulary and URL checks were hardened for unsubscribe outcomes.',
    ],
    evidence: [
      { commit: 'db1ad7bb', pullRequest: 294, summary: 'Sender rollups and bulk actions' },
      { commit: '902cbdba', pullRequest: 295, summary: 'Autopilot observe and activation' },
      { commit: '2c59ac96', pullRequest: 293, summary: 'Triage interaction suite' },
      { commit: '7d93032b', pullRequest: 297, summary: 'Settings account health and export' },
      { commit: '6140c453', pullRequest: 296, summary: 'Brief time windows and deep links' },
      { commit: '42f23c95', pullRequest: 298, summary: 'Quiet held-action state' },
      { commit: '43f024e5', pullRequest: 300, summary: 'Sender view toggle' },
      { commit: 'e54e8250', pullRequest: 301, summary: 'Confirmed unsubscribe activity row' },
    ],
  },
];

export const REPOSITORY_URL = 'https://github.com/CT2689-Tech/DeclutrMail';

export function changelogEvidenceUrl(pullRequest: number): string {
  return `${REPOSITORY_URL}/pull/${pullRequest}`;
}
