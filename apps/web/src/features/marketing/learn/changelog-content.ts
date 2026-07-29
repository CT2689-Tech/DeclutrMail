import type { ChangelogEntry } from './types';

/**
 * Public product updates, newest first.
 *
 * ## Editorial rules (founder decision 2026-07-29)
 *
 * HIGH LEVEL ONLY. Entries say what a user would notice, in the words they
 * would use. No internal mechanics ("one shared predicate", "recorded
 * server-side before the provider is contacted"), no module names, no
 * counts from the founder's own mailbox. The previous version read as an
 * engineering log and volunteered a public defect history — "the repair
 * that made purchases land at all" tells a competitor more than it tells a
 * customer.
 *
 * NO INTERNAL IDENTIFIERS ON THE PAGE. `evidence` stays in this data as
 * build-time provenance — `pnpm check-changelog` uses it to verify this
 * file against git history, and the guard is the only reason the page can
 * be trusted at all — but it is NOT rendered. Pull-request numbers and
 * commit hashes are internal, and every link to them would 404 for the
 * public the moment the repository goes private.
 *
 * DATE = MERGE DATE, in UTC. One entry per date; grouping several dates
 * under the earliest one backdates the rest. The guard enforces this.
 *
 * REMOVALS COUNT. A feature that was taken away is a change a user can see,
 * so it belongs here as much as an addition does.
 */
export const CHANGELOG_ENTRIES: readonly ChangelogEntry[] = [
  {
    id: '2026-07-29',
    date: '2026-07-29',
    title: 'Steadier payments and syncs',
    summary: 'Payments and first-time syncs became harder to get stuck in.',
    added: [
      'A payment that completes during an interruption still lands on the right plan.',
      'If a first sync fails for good, you get an email about it instead of silence.',
    ],
    improved: [
      'Every screen that can show a failed sync now offers a way forward.',
      'Plan changes and cancellations are recorded with their reason, so billing history reads clearly.',
    ],
    fixed: [
      'An interrupted checkout no longer leaves your account stuck mid-purchase.',
      'Plan problems are explained where you are, instead of as a blocking error.',
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
      'Delete can now reach mail that never touched your inbox. Account email and wording across the app were reworked alongside it.',
    added: [
      'Delete can now include archived mail. If a Gmail filter sends a sender straight past your inbox, that backlog was previously untouchable. Inbox only stays the default; including archived mail is a deliberate choice you make per sender.',
      'Undo puts every message back exactly where it was — inbox mail to the inbox, archived mail to the archive.',
      'A sender now tells you how much of its mail is still in your inbox before you act.',
      'A failed first sync has an explicit way out rather than a dead end.',
      'Account email looks like DeclutrMail, and every kind you can opt out of is one click to turn off.',
    ],
    improved: [
      'Plain language across every user-facing surface.',
      'One name for a Gmail connection everywhere it appears.',
      'Senders opens on senders still mailing you, with counts that say what is actually known.',
      'Real-time Gmail updates handle bursts and key rotation without falling behind.',
    ],
    fixed: [
      'The monthly cleanup counter counts down, so it reads as what is left.',
      'Pricing describes the Free plan as it actually works.',
      'Resuming a paused plan is refused when a subscription is already active.',
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
      'Free became a plan you can actually work in, and previews were made to match their results.',
    added: [
      'The Free tier is live: Senders, Sender detail, Activity history, Triage sessions, and the Later review queue, metered at 50 cleanup actions each month on your signup anniversary.',
      'A preview that will not fit within the remaining monthly allowance says so and offers the upgrade instead of a confirm.',
    ],
    improved: ['Billing screens tell one consistent story about your plan.'],
    fixed: [
      'A preview and the result it produces now always describe the same messages.',
      'Confirm is never active against an out-of-date preview.',
      'Triage only batches messages it is allowed to act on in bulk — Protected senders stay out.',
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
    title: 'Actions say what they will do',
    summary:
      'A pass over the places where an action described a scope it would not actually act on.',
    added: [],
    improved: [
      'Keep, Archive, Unsubscribe, Later and Delete each state the scope they will really act on — including when it is empty.',
    ],
    fixed: [
      'A decision you make in the Screener now overrides automatic protection.',
      'Autopilot no longer suggests rules based on mail that no longer exists.',
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
    title: 'India can pay in rupees',
    summary: 'Checkout opened for India, and service health checks learned to notice an outage.',
    added: [
      'Checkout in Indian rupees, quoted in rupees only where that exact price can be charged in rupees.',
      'Service health checks now notice an outage instead of reporting OK regardless.',
    ],
    improved: ['The currency shown on a price is the currency you will be charged in.'],
    fixed: [],
    evidence: [
      { commit: '05816101', pullRequest: 379, summary: 'Razorpay live catalog' },
      { commit: 'ddaa7034', pullRequest: 376, summary: 'Razorpay overlay and charge currency' },
      { commit: '1a1622e5', pullRequest: 377, summary: 'Readiness probe' },
    ],
  },
  {
    id: '2026-07-24',
    date: '2026-07-24',
    title: 'Paid plans open outside India',
    summary: 'Paid plans became purchasable outside India.',
    added: ['Paid plans became purchasable outside India.'],
    improved: [],
    fixed: [],
    evidence: [{ commit: '407fdcbd', pullRequest: 374, summary: 'Paddle production billing' }],
  },
  {
    id: '2026-07-23',
    date: '2026-07-23',
    title: 'Tighter access controls',
    summary: 'Access controls were tightened on the records behind recovery and deletion.',
    added: [],
    improved: [],
    fixed: ['Recovery and deletion records are locked down at the database level.'],
    evidence: [
      { commit: '5bf9645b', pullRequest: 373, summary: 'Recovery-table row-level security' },
    ],
  },
  {
    id: '2026-07-22',
    date: '2026-07-22',
    title: 'Safer deletion and sync recovery',
    summary: 'Account deletion and sync recovery were hardened before paid plans opened.',
    added: [],
    improved: [
      'Deleting your account revokes DeclutrMail’s Google access first, so nothing is left connected. Deleting a single mailbox gets the same guarantee.',
      'The app answers the first request without a cold start.',
    ],
    fixed: ['An interrupted sync resumes cleanly instead of double-counting or losing its place.'],
    evidence: [
      { commit: '8822f910', pullRequest: 372, summary: 'Grant revocation on deletion' },
      { commit: 'ef144860', pullRequest: 371, summary: 'API launch floor' },
      { commit: '14aac856', pullRequest: 370, summary: 'Sync recovery hardening' },
    ],
  },
  {
    id: '2026-07-21',
    date: '2026-07-21',
    title: 'Self-serve plan changes',
    summary: 'Changing plan stopped requiring an email to support.',
    added: [
      'Upgrade, downgrade, and switch between monthly and annual from the billing screen.',
      'A one-tap interval toggle on the plan picker.',
    ],
    improved: [
      'An upgrade applies straight away and is prorated. A downgrade takes effect at the end of the period you already paid for — and the screen says which will happen before you confirm.',
      'Changing your mind restores your current plan and confirms it against your real subscription.',
    ],
    fixed: [],
    evidence: [{ commit: '84cf754b', pullRequest: 367, summary: 'Self-serve plan changes' }],
  },
  {
    id: '2026-07-20',
    date: '2026-07-20',
    title: 'Two payment problems fixed',
    summary:
      'A purchase could fail to apply to the account that made it, and a late payment update could overwrite a newer one.',
    added: [],
    improved: [],
    fixed: [
      'A completed purchase applies to the account that made it.',
      'A delayed payment update can no longer overwrite a newer one.',
    ],
    evidence: [
      { commit: '38651429', pullRequest: 362, summary: 'Paddle purchase attribution' },
      { commit: '6da7fc85', pullRequest: 364, summary: 'Webhook recovery and event order' },
    ],
  },
  {
    id: '2026-07-18',
    date: '2026-07-18',
    title: 'A clearer sort label',
    summary: 'One label fixed on Senders.',
    added: [],
    improved: ['The Senders sort now reads Newest arrivals, which is what it actually orders by.'],
    fixed: [],
    evidence: [{ commit: '5c904e56', pullRequest: 353, summary: 'Newest arrivals sort label' }],
  },
  {
    id: '2026-07-17',
    date: '2026-07-17',
    title: 'Senders agrees with itself',
    summary:
      'A pass across Senders, Triage, Screener and Settings, where a list and a detail view could disagree about the same sender.',
    added: [
      'A coverage line and a grid/table toggle at the top of the Senders screen.',
      'A quick peek at a sender from its row, with grid and table showing the same facts.',
    ],
    improved: [
      'The sender list and sender detail now describe the same 30 days.',
      'Sender numbers can no longer be lost on the way to the screen.',
      'Settings states only what is known, and every dead end offers a way out.',
    ],
    fixed: [
      'Triage keyboard shortcuts stopped double-firing, and confirmation is explicit.',
      'Autopilot’s approve-all states how many rules it will really approve.',
      'The Screener heading counts everything pending, not just the current page.',
      'The Weekly Hero panel was removed.',
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
      { commit: 'a5700c53', pullRequest: 346, summary: 'Weekly Hero removal' },
      { commit: '638cd55e', pullRequest: 351, summary: 'Single subscription read' },
    ],
  },
  {
    id: '2026-07-15',
    date: '2026-07-15',
    title: 'Protection you can check',
    summary:
      'Automatic protection was narrowed to signals you can check, and senders it had wrongly protected were released.',
    added: [
      'You can export your Activity history as a summary and a spreadsheet. Sender addresses are masked unless you choose otherwise.',
      'Daily Brief arrives on your own local schedule, and first-run cleanup has an end rather than scrolling forever.',
    ],
    improved: [
      'A sender is only auto-protected for importance if Gmail also files it in Primary. Promotions and updates that Gmail merely marks important no longer qualify, and ones protected under the old rule were released.',
      'Protection that no longer qualifies is withdrawn rather than left standing. Anything you protected or unprotected by hand is never touched.',
      'Automation is only suggested after a pattern repeats, and shows you why.',
    ],
    fixed: [
      'Protection reasons left over from retired rules were cleared, so every protected sender shows a reason that still means something.',
      'An action you undid stays undone in your history, however far back you look.',
    ],
    evidence: [
      { commit: '5b64dcf8', pullRequest: 335, summary: 'Primary gate on importance protection' },
      { commit: '9bc6b739', pullRequest: 333, summary: 'Activity support bundle export' },
      { commit: 'c72b86ea', pullRequest: 334, summary: 'Behavioral activation and trust' },
      { commit: '8017db6d', pullRequest: 336, summary: 'Protection-reason cleanup' },
    ],
  },
  {
    id: '2026-07-14',
    date: '2026-07-14',
    title: 'The public site, and one name per idea',
    summary:
      'The public site went live, alongside a pass that gave every screen one name for each idea.',
    added: [
      'A public site: how it works, pricing, methodology, FAQ, comparisons, Gmail guides, a journal, legal and security pages, a demo built on synthetic data, and these updates with an RSS feed.',
    ],
    improved: [
      'Protected became the one safety state. The separate VIP idea was retired, so there is a single answer to whether a sender is shielded from bulk and automatic actions.',
      'Recovery, Later and Unsubscribe wording was aligned to what each one actually does.',
    ],
    fixed: [],
    evidence: [
      { commit: 'e0295e38', pullRequest: 325, summary: 'Public product experience' },
      { commit: 'eb4932bd', pullRequest: 332, summary: 'Product clarity contract' },
    ],
  },
  {
    id: '2026-07-10',
    date: '2026-07-10',
    title: 'Decision flow and trust polish',
    summary:
      'Sender decisions, protected-sender behaviour, consent handling, and plan gating were all tightened.',
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
      'Gmail push notifications carrying a numeric history id are accepted, so real-time sync keeps up instead of stalling.',
      'A second initial sync for a mailbox that is already ready does nothing, rather than repeating the work.',
      'The sync-complete email states what it can actually do next.',
    ],
    evidence: [
      { commit: '5b8f9174', pullRequest: 322, summary: 'Noise-prevented payoff' },
      { commit: '23b1ba3d', pullRequest: 321, summary: 'Archive/Later batch banner' },
      { commit: '438634ed', pullRequest: 320, summary: 'Consent and auth-shell fixes' },
      { commit: 'e2da5221', pullRequest: 318, summary: 'Protected-sender recommendation fix' },
      { commit: '5ab85737', pullRequest: 317, summary: 'Pro route gating' },
      { commit: 'b3bd07f3', pullRequest: 316, summary: 'First-Triage practice contrast' },
      { commit: 'e9e48dd9', pullRequest: 311, summary: 'Numeric historyId in Gmail push' },
      { commit: '248f673d', pullRequest: 314, summary: 'Duplicate initial sync no-op' },
      { commit: '540ebe54', pullRequest: 315, summary: 'Sync-complete email copy' },
    ],
  },
  {
    id: '2026-07-09',
    date: '2026-07-09',
    title: 'Mobile and public-surface build',
    summary:
      'The public pages became easier to find, and the secondary screens became usable on a phone.',
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
      'A broad set of sender, Triage, automation, Brief, Quiet, Activity, and settings workflows landed.',
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
      'The refund guarantee, governing law, and India DPDP disclosures were made consistent across the public legal pages.',
      'A page that does not exist now offers next steps suited to whether you are signed in.',
    ],
    evidence: [
      { commit: 'b2da2269', pullRequest: 291, summary: 'Refund, governing law, DPDP' },
      { commit: '358079fa', pullRequest: 292, summary: 'Database vocabulary hardening' },
      { commit: '4da2f6b7', pullRequest: 302, summary: 'Audience-aware 404' },
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

// `REPOSITORY_URL` / `changelogEvidenceUrl()` were deleted 2026-07-29 with
// the receipt links they built. They had no other consumer, and pointing the
// public at a repository that is going private would produce a page of 404s
// under a heading that claimed to be evidence.
