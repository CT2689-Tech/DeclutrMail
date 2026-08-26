/**
 * Source-backed public comparison copy.
 *
 * Competitor facts are deliberately limited to claims published on the
 * vendor's own product, help, pricing, or privacy pages. A missing public
 * claim stays `unknown`; it is never completed from memory or a review site.
 */

import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';

/**
 * Freshness is per comparison, because verification is per comparison:
 * a page whose sources were re-read today and a page last read in July
 * cannot honestly share one stamp. The visible label and the WebPage
 * JSON-LD `dateModified` both derive from `verifiedIso`, so the two
 * cannot drift apart the way hand-edited literals did (SEO sweep
 * 2026-08-04). Bump a page's date only after re-reading ITS sources.
 */
export function comparisonVerifiedLabel(iso: string): string {
  return `Last verified ${new Date(iso).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })}`;
}

export type ComparisonSlug =
  | 'clean-email'
  | 'trimbox'
  | 'sanebox'
  | 'leave-me-alone'
  | 'unroll-me'
  | 'gmail-filters'
  | 'gmail';

export type EvidenceState = 'supported' | 'limited' | 'not-supported' | 'unknown' | 'native';

export interface ComparisonCell {
  readonly summary: string;
  readonly detail?: string;
  readonly state: EvidenceState;
}

export interface ComparisonRow {
  readonly label: string;
  readonly declutrMail: ComparisonCell;
  readonly competitor: ComparisonCell;
}

export interface ComparisonSource {
  readonly label: string;
  readonly url: string;
  readonly note: string;
}

export interface ComparisonDefinition {
  readonly slug: ComparisonSlug;
  readonly name: string;
  readonly category: string;
  /** ISO `YYYY-MM-DD` this page's sources were last read end to end. */
  readonly verifiedIso: string;
  readonly title: string;
  readonly description: string;
  readonly verdict: string;
  readonly indexSummary: string;
  readonly primaryUnit: string;
  readonly providerScope: string;
  readonly publicEntryPoint: string;
  readonly chooseCompetitor: {
    readonly headline: string;
    readonly points: readonly string[];
  };
  readonly chooseDeclutrMail: {
    readonly headline: string;
    readonly points: readonly string[];
  };
  readonly rows: readonly ComparisonRow[];
  readonly sources: readonly ComparisonSource[];
}

function usd(point: { usdCents: number } | null): string {
  if (!point) return 'not offered';
  const dollars = point.usdCents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

const plusMonthly = usd(TIER_MANIFEST.plus.prices.monthly);
const plusAnnual = usd(TIER_MANIFEST.plus.prices.annual);
const proMonthly = usd(TIER_MANIFEST.pro.prices.monthly);
const proAnnual = usd(TIER_MANIFEST.pro.prices.annual);
const foundingAnnual = TIER_MANIFEST.pro.promo ? usd(TIER_MANIFEST.pro.promo.annual) : null;

const DECLUTR = {
  focus: {
    summary: 'A guided sender-by-sender cleanup',
    detail:
      'Rank senders, inspect the effect, then choose Keep, Archive, Unsubscribe, Later, or Delete.',
    state: 'supported',
  },
  providers: {
    summary: 'Gmail and Google Workspace',
    detail: 'DeclutrMail is intentionally Gmail-specific today.',
    state: 'limited',
  },
  existingMail: {
    summary: 'Yes — by sender',
    detail:
      'Archive, Later, and Delete act on matching current inbox mail. Unsubscribe does not move existing mail.',
    state: 'supported',
  },
  futureMail: {
    summary: 'Separate Autopilot rules',
    detail:
      'Autopilot rules are configured separately — you preview a rule before turning it on, and it then acts on future matches, or collects them for your batch approval if you choose Watch first. A one-time Archive or Later action does not automatically become a future-mail rule.',
    state: 'limited',
  },
  unsubscribe: {
    summary: 'When the sender provides an unsubscribe method',
    detail:
      'RFC one-click requests can run directly. Mailto-based requests require a manual step; unsupported senders stay explicit.',
    state: 'limited',
  },
  preview: {
    summary: 'Preview before cleanup actions',
    detail:
      'Archive, Later, Unsubscribe, and Delete use a confirmation preview. Keep is an inline sender decision.',
    state: 'supported',
  },
  recovery: {
    summary: 'Recorded in Activity when recovery is available',
    detail:
      'Archive, Later, and Delete use the plan Activity Undo window. Delete also has separate Gmail Trash recovery, normally up to 30 days. Unsubscribe is not a reversible DeclutrMail action.',
    state: 'limited',
  },
  data: {
    summary: 'Listed Gmail details, including the preview snippet',
    detail: 'Full message bodies and attachments are not fetched.',
    state: 'supported',
  },
  funding: {
    summary: 'Subscriptions only',
    detail:
      'The published privacy policy states that Gmail data is not sold and is not used for advertising of any kind, and that it is not transferred to third parties except the subprocessors needed to run the service.',
    state: 'supported',
  },
  price: {
    summary: `Free, ${plusMonthly} Plus, or ${proMonthly} Pro monthly`,
    detail: `Free includes ${TIER_MANIFEST.free.cleanupActionsPerMonth} cleanup actions per month. Plus is ${plusAnnual}/year; Pro is ${proAnnual}/year${foundingAnnual ? `, with a limited ${foundingAnnual} founding offer` : ''} in the current tier manifest.`,
    state: 'supported',
  },
} as const satisfies Record<string, ComparisonCell>;

const cleanEmail: ComparisonDefinition = {
  slug: 'clean-email',
  name: 'Clean Email',
  category: 'Broad cleanup suite',
  verifiedIso: '2026-07-11',
  title: 'DeclutrMail vs Clean Email',
  description:
    'A source-backed comparison of DeclutrMail and Clean Email for Gmail cleanup, automation, unsubscribe, privacy, and pricing.',
  verdict:
    'Clean Email is the broader multi-provider cleanup suite. DeclutrMail is the narrower Gmail workflow when you want to make explicit sender decisions with a preview and a durable record of reversible moves.',
  indexSummary:
    'Choose between a broad smart-folder cleanup suite and a Gmail workflow that previews manual Archive, Later, and Delete before they run.',
  primaryUnit: 'Smart folders, groups, senders, and lists',
  providerScope: 'Major providers and IMAP',
  publicEntryPoint: '1,000 messages free; paid price not stated in reviewed help page',
  chooseCompetitor: {
    headline: 'Choose Clean Email for breadth',
    points: [
      'You need Outlook, Yahoo, iCloud, or another IMAP Gmail account as well as Gmail.',
      'Smart folders, storage cleanup, sender settings, Screener, and Auto Clean belong in one suite.',
      'You want bulk subscription management and a fuller email-management app.',
    ],
  },
  chooseDeclutrMail: {
    headline: 'Choose DeclutrMail for deliberate Gmail cleanup',
    points: [
      'Your real unit of work is the sender, not a folder or a stream of messages.',
      'You want to inspect the effect before Archive, Later, Unsubscribe, or Delete runs.',
      'You want a Gmail-specific companion that does not fetch full message bodies or attachments.',
    ],
  },
  rows: [
    {
      label: 'Core approach',
      declutrMail: DECLUTR.focus,
      competitor: {
        summary: 'Broad inbox cleanup and automation suite',
        detail:
          'Smart Folders, bulk filters, Cleaning Suggestions, Unsubscriber, Screener, sender settings, and Auto Clean.',
        state: 'supported',
      },
    },
    {
      label: 'Gmail account support',
      declutrMail: DECLUTR.providers,
      competitor: {
        summary: 'Major providers plus IMAP',
        detail: 'Clean Email publishes support for Gmail, Yahoo, AOL, iCloud, Outlook, and IMAP.',
        state: 'supported',
      },
    },
    {
      label: 'Existing-mail cleanup',
      declutrMail: DECLUTR.existingMail,
      competitor: {
        summary: 'Yes — broad bulk grouping',
        detail:
          'Group and clean by date, size, sender, recipient, smart folder, and other filters.',
        state: 'supported',
      },
    },
    {
      label: 'Future-mail automation',
      declutrMail: DECLUTR.futureMail,
      competitor: {
        summary: 'Yes — premium sender settings and Auto Clean',
        detail:
          'Published options include Block, Mute, Deliver to Folder, Trash After, and Keep Newest.',
        state: 'supported',
      },
    },
    {
      label: 'Unsubscribe',
      declutrMail: DECLUTR.unsubscribe,
      competitor: {
        summary: 'Bulk Unsubscriber',
        detail:
          'Clean Email says it sends unsubscribe requests and can trash later messages when a list does not honor the request.',
        state: 'supported',
      },
    },
    {
      label: 'Preview and recovery',
      declutrMail: DECLUTR.recovery,
      competitor: {
        summary: 'Action history published; undo window not publicly stated',
        detail:
          'The reviewed feature pages describe logs/history, but do not state a durable, universal undo period.',
        state: 'unknown',
      },
    },
    {
      label: 'Email-data posture',
      declutrMail: DECLUTR.data,
      competitor: {
        summary: 'Vendor says cleanup analysis uses email headers and other listed details',
        detail:
          'Clean Email also publishes in-app open, read, reply, and forward features; consult its privacy policy for the exact processing that applies to features you enable.',
        state: 'limited',
      },
    },
    {
      label: 'Public starting point',
      declutrMail: DECLUTR.price,
      competitor: {
        summary: 'Up to 1,000 messages free; 14-day premium trial',
        detail:
          'The reviewed official help page confirms monthly and yearly subscriptions but does not publish the current paid amount.',
        state: 'unknown',
      },
    },
  ],
  sources: [
    {
      label: 'Clean Email features',
      url: 'https://clean.email/features',
      note: 'Bulk cleanup, Smart Folders, Unsubscriber, Screener, Auto Clean, providers, and privacy claims.',
    },
    {
      label: 'Clean Email free trial and subscriptions',
      url: 'https://clean.email/help/accounts/free-trial-and-subscriptions',
      note: 'Free limits, trial, premium-only features, sender settings, and subscription model.',
    },
    {
      label: 'Clean Email privacy policy',
      url: 'https://clean.email/privacy',
      note: 'Vendor’s current legal description of Gmail-data access and processing.',
    },
  ],
};

const trimbox: ComparisonDefinition = {
  slug: 'trimbox',
  name: 'Trimbox',
  category: 'In-inbox unsubscriber',
  verifiedIso: '2026-07-11',
  title: 'DeclutrMail vs Trimbox',
  description:
    'A source-backed comparison of DeclutrMail and Trimbox for Gmail unsubscribe, past-email deletion, automation, privacy, and pricing.',
  verdict:
    'Trimbox is the simpler choice when the job is one-click newsletter cleanup inside a Gmail-shaped experience. DeclutrMail covers a wider sender decision set and makes previews and reversible label actions part of the workflow.',
  indexSummary:
    'Choose between fast newsletter opt-outs and a broader Gmail workflow with previews for manual mail moves.',
  primaryUnit: 'Mailing list or unwanted sender',
  providerScope: 'Gmail is clearly documented',
  publicEntryPoint: 'Not publicly stated on reviewed product pages',
  chooseCompetitor: {
    headline: 'Choose Trimbox for a smaller job',
    points: [
      'You mainly want to spot mailing lists, unsubscribe, and delete their old messages quickly.',
      'You prefer a lightweight Gmail-adjacent experience over a separate cleanup dashboard.',
      'Trimbox’s published claim that email data stays on-device is your deciding requirement.',
    ],
  },
  chooseDeclutrMail: {
    headline: 'Choose DeclutrMail for a broader sender decision',
    points: [
      'You need Keep, Archive, Later, and Delete alongside supported unsubscribe flows.',
      'You want impact previews and an activity record for reversible Gmail account moves.',
      'You want pricing and plan limits published before connecting Gmail.',
    ],
  },
  rows: [
    {
      label: 'Core approach',
      declutrMail: DECLUTR.focus,
      competitor: {
        summary: 'One-click mailing-list cleanup',
        detail:
          'Identify mailing lists, unsubscribe, and optionally mass-delete old mail from a sender.',
        state: 'supported',
      },
    },
    {
      label: 'Gmail account support',
      declutrMail: DECLUTR.providers,
      competitor: {
        summary: 'Gmail is documented',
        detail:
          'Support for other Gmail account providers was not clearly stated on the reviewed current product pages.',
        state: 'unknown',
      },
    },
    {
      label: 'Existing-mail cleanup',
      declutrMail: DECLUTR.existingMail,
      competitor: {
        summary: 'Mass-delete old mail from a sender',
        detail:
          'The official product page presents this as a one-click cleanup after identifying a list.',
        state: 'supported',
      },
    },
    {
      label: 'Future-mail automation',
      declutrMail: DECLUTR.futureMail,
      competitor: {
        summary: 'Not publicly stated',
        detail:
          'No current automation contract was stated on the reviewed primary product and FAQ pages.',
        state: 'unknown',
      },
    },
    {
      label: 'Unsubscribe',
      declutrMail: DECLUTR.unsubscribe,
      competitor: {
        summary: 'One-click unsubscribe',
        detail: 'Trimbox says lists can be unsubscribed without opening the email.',
        state: 'supported',
      },
    },
    {
      label: 'Preview and recovery',
      declutrMail: DECLUTR.recovery,
      competitor: {
        summary: 'Not publicly stated',
        detail:
          'A pre-action impact preview and durable undo window were not described on the reviewed pages.',
        state: 'unknown',
      },
    },
    {
      label: 'Email-data posture',
      declutrMail: DECLUTR.data,
      competitor: {
        summary: 'Vendor says email data never leaves the device',
        detail:
          'Trimbox’s separate privacy policy describes account, usage, device, tracking, and advertising-related processing; review both statements for your use case.',
        state: 'limited',
      },
    },
    {
      label: 'Public starting point',
      declutrMail: DECLUTR.price,
      competitor: {
        summary: 'Not publicly stated',
        detail:
          'The reviewed official product and subscription-management pages did not publish a current price or free quota.',
        state: 'unknown',
      },
    },
  ],
  sources: [
    {
      label: 'Trimbox product page',
      url: 'https://www.trimbox.io/',
      note: 'Mailing-list detection, one-click unsubscribe, old-mail deletion, and on-device claim.',
    },
    {
      label: 'Trimbox for Gmail',
      url: 'https://www.trimbox.io/trimbox-for-gmail',
      note: 'Current Gmail-specific positioning and cleanup workflow.',
    },
    {
      label: 'Trimbox privacy policy',
      url: 'https://www.trimbox.io/privacy',
      note: 'Current legal description of personal-data, tracking, disclosure, and retention practices.',
    },
  ],
};

const sanebox: ComparisonDefinition = {
  slug: 'sanebox',
  name: 'SaneBox',
  category: 'Importance sorting',
  verifiedIso: '2026-07-11',
  title: 'DeclutrMail vs SaneBox',
  description:
    'A source-backed comparison of DeclutrMail and SaneBox for sender cleanup, importance sorting, training, privacy, providers, and pricing.',
  verdict:
    'SaneBox is strongest when you want new mail continuously sorted by learned importance across providers. DeclutrMail is stronger when you want to work through Gmail’s existing clutter as explicit sender decisions with previews.',
  indexSummary:
    'Choose between learned importance sorting for incoming mail and explicit sender decisions you approve one at a time.',
  primaryUnit: 'Learned sender importance and training folders',
  providerScope: 'Most IMAP/Exchange-style providers',
  publicEntryPoint: '14-day trial; plans limit accounts and enabled features',
  chooseCompetitor: {
    headline: 'Choose SaneBox for continuous sorting',
    points: [
      'Your main problem is interruption from incoming mail, not a sender-by-sender backlog.',
      'You want trainable folders, snooze options, reminders, no-reply tracking, and do-not-disturb tools.',
      'You need a provider other than Gmail or want the same system across several providers.',
    ],
  },
  chooseDeclutrMail: {
    headline: 'Choose DeclutrMail for explicit cleanup',
    points: [
      'You would rather decide sender outcomes than delegate importance ranking to a trained sorter.',
      'You need a concrete preview before current Gmail messages move.',
      'You want supported mailing-list opt-out, not only future delivery to a trash-training folder.',
    ],
  },
  rows: [
    {
      label: 'Core approach',
      declutrMail: DECLUTR.focus,
      competitor: {
        summary: 'Train importance-sorting folders',
        detail: 'SaneLater and other selectable features sort new mail on the user’s mail server.',
        state: 'supported',
      },
    },
    {
      label: 'Gmail account support',
      declutrMail: DECLUTR.providers,
      competitor: {
        summary: 'Broad provider support',
        detail: 'SaneBox publishes support for Gmail and most provider-hosted IMAP-style accounts.',
        state: 'supported',
      },
    },
    {
      label: 'Existing-mail cleanup',
      declutrMail: DECLUTR.existingMail,
      competitor: {
        summary: 'Backlog sorting plus Email Deep Clean',
        detail: 'SaneBox says initial SaneLater backlog processing happens gradually overnight.',
        state: 'supported',
      },
    },
    {
      label: 'Future-mail automation',
      declutrMail: DECLUTR.futureMail,
      competitor: {
        summary: 'Core behavior',
        detail: 'New mail is left in Inbox or moved to a selected Sane folder as it arrives.',
        state: 'supported',
      },
    },
    {
      label: 'Unsubscribe or block',
      declutrMail: DECLUTR.unsubscribe,
      competitor: {
        summary: 'SaneBlackHole trains future mail to Trash',
        detail:
          'SaneBox markets this as one-click unsubscribe; its help page describes sender training to Trash rather than a confirmed mailing-list opt-out.',
        state: 'limited',
      },
    },
    {
      label: 'Preview and recovery',
      declutrMail: DECLUTR.recovery,
      competitor: {
        summary: 'Correct by moving and retraining',
        detail:
          'Fresh SaneBlackHole messages remain reviewable for seven days; a general Activity undo window is not publicly stated.',
        state: 'limited',
      },
    },
    {
      label: 'Email-data posture',
      declutrMail: DECLUTR.data,
      competitor: {
        summary: 'Headers for core sorting; optional features can need more',
        detail:
          'SaneBox says core features use headers. Its privacy help lists limited extra access for attachments, reminders, and some snooze options.',
        state: 'limited',
      },
    },
    {
      label: 'Public starting point',
      declutrMail: DECLUTR.price,
      competitor: {
        summary: '14-day trial; paid plans by accounts and feature slots',
        detail: 'Official pricing lists 1/2/4 accounts with 2/6/all selectable Sane features.',
        state: 'supported',
      },
    },
  ],
  sources: [
    {
      label: 'SaneBox pricing',
      url: 'https://www.sanebox.com/pricing',
      note: 'Trial, account limits, feature allowances, and included tools.',
    },
    {
      label: 'What is a SaneBox feature?',
      url: 'https://www.sanebox.com/help/138-what-is-a-feature',
      note: 'SaneLater, SaneBlackHole, training folders, reminders, and feature-slot semantics.',
    },
    {
      label: 'Getting the most out of SaneLater',
      url: 'https://www.sanebox.com/help/348-getting-the-most-out-of-sanelater',
      note: 'Incoming-mail behavior, initial backlog processing, and retraining.',
    },
    {
      label: 'SaneBox privacy and email content',
      url: 'https://www.sanebox.com/help/412-privacy-and-security-i-don-t-want-sanebox-reading-my-mail',
      note: 'Header-only core features and optional cases requiring limited additional access.',
    },
  ],
};

const leaveMeAlone: ComparisonDefinition = {
  slug: 'leave-me-alone',
  name: 'Leave Me Alone',
  category: 'Subscription control',
  verifiedIso: '2026-07-11',
  title: 'DeclutrMail vs Leave Me Alone',
  description:
    'A source-backed comparison of DeclutrMail and Leave Me Alone for unsubscribe, newsletter rollups, sender cleanup, privacy, providers, and pricing.',
  verdict:
    'Leave Me Alone is purpose-built for subscriptions, Rollups, and Inbox Shield across providers. DeclutrMail treats newsletters as one part of a broader Gmail sender-cleanup workflow.',
  indexSummary:
    'Choose between an unsubscribe specialist and a broader Gmail workflow that also includes supported unsubscribe, Keep, Archive, Later, and Delete.',
  primaryUnit: 'Subscription or shield rule',
  providerScope: 'Google, Microsoft, Yahoo, iCloud, AOL, Fastmail, and IMAP',
  publicEntryPoint: '10 unsubscribes free; $19 seven-day pass',
  chooseCompetitor: {
    headline: 'Choose Leave Me Alone for subscriptions',
    points: [
      'Unsubscribing, newsletter Rollups, private addresses, and Inbox Shield are the whole job.',
      'You want several scheduled digests for newsletters you still enjoy.',
      'You need Google, Microsoft, Yahoo, iCloud, Fastmail, AOL, or another IMAP mailbox.',
    ],
  },
  chooseDeclutrMail: {
    headline: 'Choose DeclutrMail for all sender types',
    points: [
      'Your clutter includes notifications, receipts, people, and systems—not only mailing lists.',
      'You want Archive, Later, and Delete decisions with impact previews in addition to unsubscribe.',
      'You prefer an Activity history for Gmail changes that can be undone.',
    ],
  },
  rows: [
    {
      label: 'Core approach',
      declutrMail: DECLUTR.focus,
      competitor: {
        summary: 'Subscription cleanup, Rollups, and Inbox Shield',
        detail:
          'The service centers on mailing lists, digests, screening, blocklists, and quiet periods.',
        state: 'supported',
      },
    },
    {
      label: 'Gmail account support',
      declutrMail: DECLUTR.providers,
      competitor: {
        summary: 'Google, Microsoft, major providers, and IMAP',
        detail:
          'The official FAQ lists Gmail, Outlook, Yahoo, iCloud, AOL, Fastmail, and other IMAP mailboxes.',
        state: 'supported',
      },
    },
    {
      label: 'Existing-mail cleanup',
      declutrMail: DECLUTR.existingMail,
      competitor: {
        summary: 'Subscription-specific',
        detail:
          'Find and unsubscribe from subscription mail. Rollups move chosen newsletters to a folder; general sender archive/delete is not the published core workflow.',
        state: 'limited',
      },
    },
    {
      label: 'Future-mail automation',
      declutrMail: DECLUTR.futureMail,
      competitor: {
        summary: 'Inbox Shield, filters, Rollups, and do-not-disturb',
        detail:
          'Published tools can screen senders, route newsletters, block unwanted mail, and hold mail on a schedule.',
        state: 'supported',
      },
    },
    {
      label: 'Unsubscribe',
      declutrMail: DECLUTR.unsubscribe,
      competitor: {
        summary: 'Core feature',
        detail:
          'Follows a published link or sends a request from a unique address when only email opt-out is available.',
        state: 'supported',
      },
    },
    {
      label: 'Preview and recovery',
      declutrMail: DECLUTR.recovery,
      competitor: {
        summary: 'Unsubscribe is not reversible in the service',
        detail: 'The FAQ says re-subscribing must be done manually at the sender’s website.',
        state: 'not-supported',
      },
    },
    {
      label: 'Email-data posture',
      declutrMail: DECLUTR.data,
      competitor: {
        summary: 'Subscription details; encrypted email content for Rollups',
        detail:
          'Inbox Shield stores subscription details. Rollups fetch, encrypt, and store the email content needed to create the digest.',
        state: 'limited',
      },
    },
    {
      label: 'Public starting point',
      declutrMail: DECLUTR.price,
      competitor: {
        summary: '10 unsubscribes free; $19 seven-day pass',
        detail:
          'The pass includes two accounts and unlimited unsubscribes for seven days. Recurring amounts were dynamically unavailable in the reviewed public snapshot.',
        state: 'limited',
      },
    },
  ],
  sources: [
    {
      label: 'Leave Me Alone FAQ',
      url: 'https://leavemealone.com/faq/',
      note: 'Unsubscribe mechanics, provider support, irreversibility, and service positioning.',
    },
    {
      label: 'Leave Me Alone security',
      url: 'https://leavemealone.com/security/',
      note: 'OAuth scopes and storage for subscriptions, Rollups, and Inbox Shield.',
    },
    {
      label: 'Leave Me Alone pricing',
      url: 'https://leavemealone.com/pricing/',
      note: 'Free allowance, seven-day pass, included features, accounts, and refund policy.',
    },
    {
      label: 'Leave Me Alone Rollups',
      url: 'https://leavemealone.com/rollups/',
      note: 'Digest scheduling and newsletter reading workflow.',
    },
  ],
};

/**
 * The one comparison where the decisive difference is not a feature.
 * Unroll.Me publishes its market-research model on its own site, so the
 * funding row is sourced from the vendor, not inferred — and the 2019
 * FTC settlement is cited from the FTC's own release rather than from
 * the press coverage of it. No adjective goes beyond what those two
 * documents say.
 */
const unrollMe: ComparisonDefinition = {
  slug: 'unroll-me',
  name: 'Unroll.Me',
  category: 'Digest and blocking',
  verifiedIso: '2026-08-13',
  title: 'DeclutrMail vs Unroll.Me',
  description:
    'A source-backed comparison of DeclutrMail and Unroll.Me on Gmail cleanup, blocking, digests, email-data access, the market-research business model and cost.',
  verdict:
    'Unroll.Me is free because your commercial email feeds a market-research business it names on its own site. DeclutrMail charges for subscriptions instead, does not fetch full message bodies, and previews each move before it runs — the trade is money for data access, and it is worth deciding deliberately.',
  indexSummary:
    'A free daily digest funded by market research, versus a paid Gmail workflow that does not fetch message bodies.',
  primaryUnit: 'Subscription sender and daily digest',
  providerScope: 'Gmail documented; other providers not named',
  publicEntryPoint: 'Free sign-up; funded by market research',
  chooseCompetitor: {
    headline: 'Choose Unroll.Me if the digest is the point',
    points: [
      'You want many subscriptions collapsed into one daily digest email rather than decided one by one.',
      'Paying nothing matters more to you than limiting what a vendor reads, and you accept the market-research terms.',
      'Your Gmail account holds little you would mind a research panel deriving purchase data from.',
    ],
  },
  chooseDeclutrMail: {
    headline: 'Choose DeclutrMail to pay in money, not Gmail account access',
    points: [
      'You want full message bodies and attachments never fetched, with the stored field list published.',
      'You want the count, a sample, and the exact Gmail changes before Archive, Later, or Delete runs.',
      'You would rather be the customer than the panel: no Gmail account data is sold, shared for research, or used for advertising.',
    ],
  },
  rows: [
    {
      label: 'Core approach',
      declutrMail: DECLUTR.focus,
      competitor: {
        summary: 'Keep, Block, Rollup',
        detail:
          'The product page describes blocking unwanted email, keeping the mail you want, and rolling the rest up into a single daily digest.',
        state: 'supported',
      },
    },
    {
      label: 'Gmail account support',
      declutrMail: DECLUTR.providers,
      competitor: {
        summary: 'Gmail documented; other providers not stated by name',
        detail:
          'The product page says it supports major email providers without naming them. The privacy notice documents Gmail sign-in, plus a Google App Password option for accounts outside Google’s restricted-permission rules.',
        state: 'unknown',
      },
    },
    {
      label: 'Existing-mail cleanup',
      declutrMail: DECLUTR.existingMail,
      competitor: {
        summary: 'Rollup collects subscriptions into a digest',
        detail:
          'Chosen subscriptions are gathered into one daily email. Bulk archiving or deleting a sender’s existing backlog is not stated on the reviewed product page.',
        state: 'limited',
      },
    },
    {
      label: 'Future-mail automation',
      declutrMail: DECLUTR.futureMail,
      competitor: {
        summary: 'Core behavior',
        detail:
          'Keep, Block, and Rollup are ongoing per-sender dispositions rather than one-time cleanups.',
        state: 'supported',
      },
    },
    {
      label: 'Unsubscribe',
      declutrMail: DECLUTR.unsubscribe,
      competitor: {
        summary: 'Blocking is the published mechanism',
        detail:
          'The reviewed pages describe blocking unwanted email. Whether an opt-out request is delivered to the sender, or mail is instead handled after it arrives, is not stated.',
        state: 'limited',
      },
    },
    {
      label: 'Preview and recovery',
      declutrMail: DECLUTR.recovery,
      competitor: {
        summary: 'Not publicly stated',
        detail:
          'A count-and-sample preview before a change, and any undo window afterwards, were not stated on the reviewed product and privacy pages.',
        state: 'unknown',
      },
    },
    {
      label: 'Email-data posture',
      declutrMail: DECLUTR.data,
      competitor: {
        summary: 'Copies of commercial emails; Gmail terms cover bodies and attachments',
        detail:
          'The privacy notice says that connecting an inbox collects copies of and information from commercial email — receipts, confirmations, promotions — and that its Gmail access may read, write, modify, or control message bodies including attachments, headers, and settings to provide the service. It also states this Gmail data is not used to serve advertisements.',
        state: 'limited',
      },
    },
    {
      label: 'How the product is funded',
      declutrMail: DECLUTR.funding,
      competitor: {
        summary: 'A market-research panel, stated on its own site',
        detail:
          'Its site says: “We use your data to fuel our market research business, NielsenIQ.” The privacy notice says panelist data about the commercial emails you receive, plus demographics, may be sold or shared with customers including e-commerce businesses, investment companies, consumer brands, media companies, and data brokers — while directly identifying details are never sold to target you.',
        state: 'supported',
      },
    },
    {
      label: 'Disclosure history',
      declutrMail: {
        summary: 'No regulatory action',
        detail:
          'DeclutrMail is a new product with no enforcement history; treat that as absence of a record, not as a track record.',
        state: 'supported',
      },
      competitor: {
        summary: 'FTC settlement finalized December 2019',
        detail:
          'The FTC alleged Unrollme falsely told consumers it would not “touch” their personal emails while sharing users’ e-receipts with its then-parent Slice Technologies for market-research products. The finalized order bars misrepresenting what it collects, uses, stores, or shares, and required deleting affected e-receipts absent express consent.',
        state: 'supported',
      },
    },
    {
      label: 'Public starting point',
      declutrMail: DECLUTR.price,
      competitor: {
        summary: 'Free sign-up; paid tiers not publicly stated',
        detail:
          'The product page offers a free sign-up, and no pricing page or paid plan was published on the reviewed site. The privacy notice describes the market-research business the free service funds.',
        state: 'unknown',
      },
    },
  ],
  sources: [
    {
      label: 'Unroll.Me product page',
      url: 'https://unroll.me/',
      note: 'Keep, Block, Rollup positioning, the single daily digest, free sign-up, and the provider-support claim.',
    },
    {
      label: 'Unroll.Me privacy notice',
      url: 'https://unroll.me/legal/privacy',
      note: 'Commercial-email collection, selling and sharing panelist data, Gmail restricted-use terms, and account-deletion coupling.',
    },
    {
      label: 'FTC — settlement finalized with Unrollme',
      url: 'https://www.ftc.gov/news-events/news/press-releases/2019/12/ftc-finalizes-settlement-company-misled-consumers-about-how-it-accesses-uses-their-email',
      note: 'The Commission’s own account of the allegations, the e-receipt sharing, and what the final order requires.',
    },
  ],
};

const gmailFilters: ComparisonDefinition = {
  slug: 'gmail-filters',
  name: 'Gmail filters',
  category: 'Native rules',
  verifiedIso: '2026-07-11',
  title: 'DeclutrMail vs Gmail filters',
  description:
    'A source-backed comparison of DeclutrMail and native Gmail filters for sender cleanup, future-mail rules, unsubscribe, preview, recovery, and cost.',
  verdict:
    'Gmail filters are the flexible, no-extra-vendor choice when you already know the search criteria and desired action. DeclutrMail adds a ranked sender inventory, an opinionated decision workflow, previews, and a separate activity record.',
  indexSummary:
    'Choose between native rule-building and a guided sender workflow that shows the affected email before manual changes.',
  primaryUnit: 'Search criteria and rule action',
  providerScope: 'Gmail and Google Workspace',
  publicEntryPoint: 'Included with the Gmail account or Workspace plan',
  chooseCompetitor: {
    headline: 'Choose Gmail filters for native flexibility',
    points: [
      'You do not want to authorize an additional cleanup service.',
      'You are comfortable composing search criteria and maintaining rules in Gmail settings.',
      'You need native actions such as label, archive, delete, star, or forward on matching new mail.',
    ],
  },
  chooseDeclutrMail: {
    headline: 'Choose DeclutrMail for guided decisions',
    points: [
      'You need Gmail’s noisy senders surfaced and ranked before you know which rules to write.',
      'You want plain-language sender outcomes and an impact preview rather than filter plumbing.',
      'You value a cleanup history and a plan-based recovery window for Gmail label changes.',
    ],
  },
  rows: [
    {
      label: 'Core approach',
      declutrMail: DECLUTR.focus,
      competitor: {
        summary: 'Build a rule from Gmail search criteria',
        detail:
          'Choose conditions, test the search, then select actions for matching incoming mail.',
        state: 'native',
      },
    },
    {
      label: 'Gmail account support',
      declutrMail: DECLUTR.providers,
      competitor: {
        summary: 'Gmail and Google Workspace',
        detail: 'Filters are a native Gmail capability, not a separate cross-provider product.',
        state: 'native',
      },
    },
    {
      label: 'Existing-mail cleanup',
      declutrMail: DECLUTR.existingMail,
      competitor: {
        summary: 'Via Gmail search and bulk actions',
        detail:
          'Native Gmail search can find current matches; filter documentation primarily describes incoming-mail rules.',
        state: 'limited',
      },
    },
    {
      label: 'Future-mail automation',
      declutrMail: DECLUTR.futureMail,
      competitor: {
        summary: 'Core behavior',
        detail:
          'Filters can label, archive, delete, star, or automatically forward matching incoming mail.',
        state: 'native',
      },
    },
    {
      label: 'Unsubscribe',
      declutrMail: DECLUTR.unsubscribe,
      competitor: {
        summary: 'Separate Gmail subscription controls',
        detail:
          'A filter routes mail; it does not itself opt out. Gmail separately offers Unsubscribe and Manage subscriptions.',
        state: 'limited',
      },
    },
    {
      label: 'Preview and recovery',
      declutrMail: DECLUTR.recovery,
      competitor: {
        summary: 'Test criteria; edit or delete the rule later',
        detail:
          'Google documents previewing matches with Search, but no separate long-term cleanup history.',
        state: 'limited',
      },
    },
    {
      label: 'Email-data posture',
      declutrMail: DECLUTR.data,
      competitor: {
        summary: 'No additional cleanup vendor',
        detail: 'Filtering happens inside the Gmail service that already hosts the mailbox.',
        state: 'native',
      },
    },
    {
      label: 'Public starting point',
      declutrMail: DECLUTR.price,
      competitor: {
        summary: 'Included with Gmail or Google Workspace',
        detail: 'There is no separate Gmail-filter subscription.',
        state: 'native',
      },
    },
  ],
  sources: [
    {
      label: 'Gmail Help — create rules to filter email',
      url: 'https://support.google.com/mail/answer/6579?hl=en',
      note: 'Filter criteria, search preview, actions, editing, deletion, import, and export.',
    },
    {
      label: 'Gmail Help — unsubscribe from an email',
      url: 'https://support.google.com/mail/answer/15433283?hl=en',
      note: 'Native unsubscribe and Manage subscriptions behavior and limitations.',
    },
    {
      label: 'Gmail Help — organize and archive email',
      url: 'https://support.google.com/mail/answer/9259770?hl=en',
      note: 'Native labels, search, snooze, archive, delete, and bulk operations.',
    },
  ],
};

/**
 * The most predictable launch objection, answered on its own page:
 * "Gmail added sender-ranked cleanup — why does this exist?"
 * Concessions first, delta second (launch playbook G2). Claims about
 * Gmail cite its own Help pages only.
 */
const gmailNative: ComparisonDefinition = {
  slug: 'gmail',
  name: "Gmail's built-in cleanup",
  category: 'Native tools',
  verifiedIso: '2026-07-11',
  title: "DeclutrMail vs Gmail's built-in cleanup",
  description:
    "A source-backed comparison of DeclutrMail and Gmail's own cleanup tools — Manage subscriptions, bulk search actions, and unsubscribe — for preview, recovery, and control by sender.",
  verdict:
    "Gmail's built-in cleanup is free, already there, and requires no third-party access — start with it. DeclutrMail adds an exact count and sample before manual changes, a per-sender Activity history with undo windows, and one review flow across every sender.",
  indexSummary:
    'Gmail now lists subscription senders natively; the difference is what you can verify before and after a move.',
  primaryUnit: 'Sender (subscriptions) or search results',
  providerScope: 'Gmail and Google Workspace',
  publicEntryPoint: 'Included with Gmail (Manage subscriptions is gradually rolling out)',
  chooseCompetitor: {
    headline: "Choose Gmail's built-in tools when they already cover you",
    points: [
      'You do not want to authorize any additional service against your mailbox.',
      'Your cleanup is mostly unsubscribing from active subscription senders, which Manage subscriptions lists with recent-email counts.',
      'You are comfortable with select-all bulk actions and do not need a record of what moved.',
    ],
  },
  chooseDeclutrMail: {
    headline: 'Choose DeclutrMail to see and verify every move',
    points: [
      'You want the per-sender current count, samples, and the exact Gmail label changes before you confirm — Gmail shows a selection count, not the per-sender picture or the planned changes.',
      'You want a per-sender history of what happened, with an undo window for Archive, Later, and Delete.',
      'You want one ranked queue covering every sender — not only detected subscriptions — with Keep, Archive, Unsubscribe, Later, and Delete in one pass.',
    ],
  },
  rows: [
    {
      label: 'Core approach',
      declutrMail: DECLUTR.focus,
      competitor: {
        summary: 'Native lists and search actions',
        detail:
          'Manage subscriptions lists active subscription senders with recent-email counts and unsubscribe; search plus select-all handles bulk moves.',
        state: 'native',
      },
    },
    {
      label: 'Gmail account support',
      declutrMail: DECLUTR.providers,
      competitor: {
        summary: 'Gmail and Google Workspace',
        detail: 'Built into the Gmail account itself; nothing to connect.',
        state: 'native',
      },
    },
    {
      label: 'Existing-mail cleanup',
      declutrMail: DECLUTR.existingMail,
      competitor: {
        summary: 'Search + select-all bulk actions',
        detail:
          'Native search finds current matches, select-all shows the selected-conversation count, and bulk actions move them; there is no per-sender preview of the planned label changes.',
        state: 'native',
      },
    },
    {
      label: 'Future-mail automation',
      declutrMail: DECLUTR.futureMail,
      competitor: {
        summary: 'Via filters, built separately',
        detail:
          'Manage subscriptions does not create rules; ongoing routing means composing Gmail filters yourself.',
        state: 'limited',
      },
    },
    {
      label: 'Unsubscribe',
      declutrMail: DECLUTR.unsubscribe,
      competitor: {
        summary: 'Native unsubscribe on detected senders',
        detail:
          'Gmail offers unsubscribe on messages and in Manage subscriptions for senders it detects as subscriptions.',
        state: 'native',
      },
    },
    {
      label: 'Preview and recovery',
      declutrMail: DECLUTR.recovery,
      competitor: {
        summary: 'Selection count and brief Undo; no long-term action history',
        detail:
          'Bulk changes show the selected count and a brief Undo; archives stay recoverable in All Mail and deletes in Trash for about 30 days. There is no long-term record for each action or multi-day undo window.',
        state: 'limited',
      },
    },
    {
      label: 'Email-data posture',
      declutrMail: DECLUTR.data,
      competitor: {
        summary: 'No additional vendor',
        detail: 'Cleanup happens inside the service that already hosts the mailbox.',
        state: 'native',
      },
    },
    {
      label: 'Public starting point',
      declutrMail: DECLUTR.price,
      competitor: {
        summary: 'Included with Gmail',
        detail:
          'No separate purchase; Google notes Manage subscriptions is gradually rolling out and may not be available to every account yet.',
        state: 'native',
      },
    },
  ],
  sources: [
    {
      label: 'Gmail Help — unsubscribe or change subscription preferences',
      url: 'https://support.google.com/mail/answer/15433283?hl=en',
      note: 'Manage subscriptions: active subscription senders listed with unsubscribe.',
    },
    {
      label: 'Gmail Help — organize and archive email',
      url: 'https://support.google.com/mail/answer/9259770?hl=en',
      note: 'Native search, bulk select, archive, delete, and label behavior.',
    },
    {
      label: 'Gmail Help — delete or recover deleted Gmail messages',
      url: 'https://support.google.com/mail/answer/7401?hl=en',
      note: 'Selected-conversation counts on bulk actions; Trash retention (~30 days).',
    },
    {
      label: 'Gmail Help — manage your subscriptions in Gmail',
      url: 'https://support.google.com/mail/answer/15621070?hl=en',
      note: 'Manage subscriptions: recent-email counts, unsubscribe, gradual rollout note.',
    },
    {
      label: 'Gmail Help — create rules to filter your emails',
      url: 'https://support.google.com/mail/answer/6579?hl=en',
      note: 'Filters as the native path for ongoing routing (Future-mail row).',
    },
  ],
};

/**
 * Typed non-empty so the verification floor below needs no assertion: an
 * empty list would otherwise type as `string` while holding `undefined`,
 * and the hub would render "Last verified Invalid Date" — the worst
 * failure mode for a page whose entire claim is that it was verified.
 */
export const COMPARISONS: readonly [ComparisonDefinition, ...ComparisonDefinition[]] = [
  cleanEmail,
  trimbox,
  sanebox,
  leaveMeAlone,
  unrollMe,
  gmailFilters,
  gmailNative,
];

/**
 * The oldest per-page verification date. The hub covers every page at
 * once, so it must claim the weakest of them, not the freshest.
 */
export const COMPARISONS_VERIFIED_FLOOR_ISO = COMPARISONS.reduce(
  (oldest, comparison) => (comparison.verifiedIso < oldest ? comparison.verifiedIso : oldest),
  COMPARISONS[0].verifiedIso,
);

export function comparisonBySlug(slug: string): ComparisonDefinition | undefined {
  return COMPARISONS.find((comparison) => comparison.slug === slug);
}
