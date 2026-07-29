import type { ChangelogEntry } from './types';

/**
 * Evidence comes from `git log --first-parent` on the repository. There are
 * currently no public semver tags, so the public surface calls these
 * repository builds instead of inventing release numbers.
 */
export const CHANGELOG_ENTRIES: readonly ChangelogEntry[] = [
  {
    id: '2026-07-29',
    date: '2026-07-29',
    title: 'Billing truth and sync recovery',
    summary:
      'This repository build gave in-flight purchases a server-side record and gave a failed first sync a visible outcome instead of silence.',
    added: [
      'A payment in progress is now recorded server-side before the provider is contacted, so a purchase that completes during an outage is still reconciled to the correct plan.',
      'A terminal first-sync failure sends an account notice instead of failing silently.',
    ],
    improved: [
      'Every screen that could strand a failed sync now offers a way forward.',
      'Cancellation provenance and the end of a paid entitlement are recorded explicitly rather than inferred.',
    ],
    fixed: [
      'A checkout that ends ambiguously at the provider no longer strands the record of the attempt.',
      'Plan states that were rejected before a payment claim was held are reported inline rather than as a blocking error.',
    ],
    evidence: [
      { commit: 'd3df6c34', pullRequest: 430, summary: 'Server-side billing reconciliation' },
      { commit: '84828519', pullRequest: 432, summary: 'Atomic checkout claim and sweep' },
      { commit: '03dc2bc3', pullRequest: 433, summary: 'Claim survives ambiguous outcomes' },
      { commit: 'a412993a', pullRequest: 434, summary: 'Held-claim and inline rejections' },
      { commit: '9260217f', pullRequest: 428, summary: 'Sync-failed notice' },
      { commit: 'b090eda4', pullRequest: 427, summary: 'Failed-sync exits' },
    ],
  },
  {
    id: '2026-07-28',
    date: '2026-07-28',
    title: 'Delete reaches filtered mail',
    summary:
      'The largest user-facing change in this range: senders whose mail a Gmail filter files past the inbox can now be cleaned up. Account email and product language were rebuilt alongside it.',
    added: [
      'Delete can now include archived mail. A sender whose messages skip the inbox by Gmail filter previously previewed zero under every verb and could not be cleaned up at all. Inbox only remains the default; Inbox and archived is an explicit per-action choice on a single sender.',
      'Undo for that wider Delete returns each message to where it was, re-inboxing only the messages that carried Inbox and returning the rest to the archive.',
      'The sender row detail states how many of a sender’s messages are still in the inbox before you open an action.',
      'A failed first sync has an explicit way out rather than a dead end.',
      'Account email moved onto the DeclutrMail brand system, carrying a one-click unsubscribe header and a working per-category opt-out.',
    ],
    improved: [
      'Plain language across every user-facing surface.',
      'One name for a Gmail connection everywhere it appears.',
      'Senders opens on active senders, with counts that state what is known and a reachable peek.',
      'Gmail push delivery is rate-limited, and an unrecognized signing key is refetched rather than trusted.',
    ],
    fixed: [
      'The monthly cleanup-action counter counts down toward the limit rather than up from zero.',
      'Public pricing no longer describes a retired Free-tier allowance.',
      'Resuming a paused plan is refused while a billing subscription is already active.',
    ],
    evidence: [
      { commit: 'be6956cb', pullRequest: 407, summary: 'Delete reach and in-inbox count' },
      { commit: '230b16a3', pullRequest: 418, summary: 'Failed first-sync exit' },
      { commit: '04e761d2', pullRequest: 405, summary: 'Email templates and one-click opt-out' },
      { commit: '51568b95', pullRequest: 406, summary: 'Transactional email brand system' },
      { commit: '0a32dd08', pullRequest: 415, summary: 'Postal-address slot' },
      { commit: '20807f19', pullRequest: 410, summary: 'Plain language sweep' },
      { commit: '7e8de22a', pullRequest: 419, summary: 'One name for a Gmail connection' },
      { commit: '2be53971', pullRequest: 409, summary: 'Senders defaults and honest counts' },
      { commit: '532910df', pullRequest: 416, summary: 'Push throttle and key refetch' },
      { commit: '42efe557', pullRequest: 412, summary: 'Quota counter direction' },
      { commit: '4bb799b3', pullRequest: 411, summary: 'Retired Free-tier copy' },
      { commit: '77feeb80', pullRequest: 417, summary: 'Resume guard' },
    ],
  },
  {
    id: '2026-07-27',
    date: '2026-07-27',
    title: 'The Free tier opens',
    summary:
      'Free became a usable plan rather than a preview, and the action preview and its receipt were made to resolve the same messages.',
    added: [
      'The Free tier is live: Senders, Sender detail, Activity history, Triage sessions, and the Later review queue, metered at 50 cleanup actions each month on your signup anniversary.',
      'A preview that will not fit within the remaining monthly allowance says so and offers the upgrade instead of a confirm.',
    ],
    improved: ['Each billing screen tells one plan story rather than several partial ones.'],
    fixed: [
      'A preview and its receipt now resolve the same messages through one shared predicate.',
      'Confirm is never armed against a stale cached preview.',
      'Triage batches only the messages that can legally be acted on in bulk.',
    ],
    evidence: [
      { commit: 'de90ebd5', pullRequest: 401, summary: 'Free tier activation' },
      { commit: '04298f8e', pullRequest: 402, summary: 'One billing story per screen' },
      { commit: '022e1e5a', pullRequest: 400, summary: 'One predicate, preview to receipt' },
      { commit: 'b2354b64', pullRequest: 398, summary: 'Cached-preview confirm guard' },
      { commit: 'f5c19ba4', pullRequest: 403, summary: 'Lawful Triage batching' },
    ],
  },
  {
    id: '2026-07-26',
    date: '2026-07-26',
    title: 'Verb surfaces state what they will do',
    summary:
      'A correctness pass over the places where an action described a scope it would not actually act on.',
    added: [],
    improved: [
      'Every verb surface reports the scope it will actually act on, including when that scope is empty.',
    ],
    fixed: [
      'An explicit Screener decision now overrides an automatic Protected classification.',
      'Autopilot no longer offers matches built on evidence that has since been deleted.',
    ],
    evidence: [
      { commit: '4b044a1d', pullRequest: 394, summary: 'Verb surface scope truth' },
      { commit: '62d450bd', pullRequest: 393, summary: 'Explicit decision overrides Protected' },
      { commit: '7fe71b74', pullRequest: 388, summary: 'Autopilot deleted-evidence matches' },
    ],
  },
  {
    id: '2026-07-25',
    date: '2026-07-25',
    title: 'India opens; readiness becomes observable',
    summary:
      'Razorpay checkout went live for India, and the service gained a probe that can actually report a dependency outage.',
    added: [
      'Razorpay checkout for India, with prices quoted in rupees only where that price point is genuinely purchasable in rupees.',
      'A readiness endpoint that reports database and queue reachability, alongside the existing dependency-free health endpoint.',
    ],
    improved: [
      'The currency shown on a price is the currency that price will be charged in, resolved per price point rather than by region alone.',
    ],
    fixed: [],
    evidence: [
      { commit: '05816101', pullRequest: 379, summary: 'Razorpay live catalog' },
      { commit: 'ddaa7034', pullRequest: 376, summary: 'Razorpay overlay and charge currency' },
      { commit: '1a1622e5', pullRequest: 377, summary: 'Readiness probe' },
    ],
  },
  {
    id: '2026-07-22',
    date: '2026-07-22',
    title: 'Production billing, deletion, and sync hardening',
    summary:
      'Paddle production billing was enabled, and account deletion, sync recovery, and database access control were hardened ahead of it.',
    added: ['Paddle production billing for customers outside India.'],
    improved: [
      'Account deletion revokes the Google grant before encrypted refresh tokens are erased, and applies the same guarantee to per-mailbox data deletion.',
      'One API instance stays warm so a first request does not wait on a cold start.',
    ],
    fixed: [
      'Incremental message persistence and sender counters are transactional and safe to replay, so a queue failure stays recoverable.',
      'Row-level security is enforced on the recovery tables.',
    ],
    evidence: [
      { commit: '407fdcbd', pullRequest: 374, summary: 'Paddle production billing' },
      { commit: '8822f910', pullRequest: 372, summary: 'Grant revocation on deletion' },
      { commit: 'ef144860', pullRequest: 371, summary: 'API launch floor' },
      { commit: '14aac856', pullRequest: 370, summary: 'Sync recovery hardening' },
      { commit: '5bf9645b', pullRequest: 373, summary: 'Recovery-table row-level security' },
    ],
  },
  {
    id: '2026-07-17',
    date: '2026-07-17',
    title: 'Senders states one window and one count',
    summary:
      'A truth pass across Senders, Triage, Screener, and Settings, where a list and its detail view could disagree about the same sender.',
    added: [
      'A coverage line and a grid/table toggle at the top of the Senders screen.',
      'A peek affordance on a sender row, with grid and table showing the same facts.',
    ],
    improved: [
      'The sender list and sender detail share one rolling 30-day window instead of drifting apart.',
      'Sender rows are assembled from the wire row plus derived fields, so a value cannot be lost between the server and the screen.',
      'Settings states only what is known, and every dead end offers a way out.',
    ],
    fixed: [
      'Triage keyboard handling uses a single listener with an explicit inline confirm.',
      'Autopilot approve-all states its true scope and resets its slider.',
      'The Screener heading states the true pending count rather than the current page size.',
    ],
    evidence: [
      { commit: 'efd89816', pullRequest: 339, summary: 'Sender wire model' },
      { commit: '426801f9', pullRequest: 340, summary: 'Rollup and grid/table parity' },
      { commit: 'c90f8daf', pullRequest: 341, summary: 'Coverage line and view toggle' },
      { commit: '07b18969', pullRequest: 343, summary: 'One rolling 30-day window' },
      { commit: 'd6bc3f82', pullRequest: 344, summary: 'Settings known-state and exits' },
      { commit: '2a6ab186', pullRequest: 342, summary: 'Triage keyboard and confirm' },
      { commit: '21d190de', pullRequest: 345, summary: 'Autopilot approve-all scope' },
      { commit: '42ac4c08', pullRequest: 350, summary: 'Screener pending count' },
    ],
  },
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
