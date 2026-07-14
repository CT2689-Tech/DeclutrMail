/**
 * Source-backed public comparison copy.
 *
 * Competitor facts are deliberately limited to claims published on the
 * vendor's own product, help, pricing, or privacy pages. A missing public
 * claim stays `unknown`; it is never completed from memory or a review site.
 */

import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';

export const COMPARISON_VERIFIED_LABEL = 'Last verified July 2026';

export type ComparisonSlug =
  'clean-email' | 'trimbox' | 'sanebox' | 'leave-me-alone' | 'gmail-filters';

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
    summary: 'A deliberate sender-by-sender cleanup ritual',
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
    summary: 'Separate Pro automation',
    detail:
      'Autopilot rules are configured separately. A one-time Archive or Later action does not automatically become a future-mail rule.',
    state: 'limited',
  },
  unsubscribe: {
    summary: 'When sender metadata supports it',
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
    summary: 'Journaled for reversible label actions',
    detail:
      'Archive and Later use the plan window. Delete has an up-to-30-day Activity token while Gmail retains Trash. Unsubscribe is not a reversible DeclutrMail action.',
    state: 'limited',
  },
  data: {
    summary: 'Metadata and Gmail’s short preview snippet',
    detail: 'Full message bodies and attachments are not fetched.',
    state: 'supported',
  },
  price: {
    summary: `Free, ${plusMonthly} Plus, or ${proMonthly} Pro monthly`,
    detail: `Free includes ${TIER_MANIFEST.free.cleanupActionsLifetime} lifetime cleanup actions. Plus is ${plusAnnual}/year; Pro is ${proAnnual}/year${foundingAnnual ? `, with a limited ${foundingAnnual} founding offer` : ''} in the current tier manifest.`,
    state: 'supported',
  },
} as const satisfies Record<string, ComparisonCell>;

const cleanEmail: ComparisonDefinition = {
  slug: 'clean-email',
  name: 'Clean Email',
  category: 'Broad cleanup suite',
  title: 'DeclutrMail vs Clean Email',
  description:
    'A source-backed comparison of DeclutrMail and Clean Email for Gmail cleanup, automation, unsubscribe, privacy, and pricing.',
  verdict:
    'Clean Email is the broader multi-provider cleanup suite. DeclutrMail is the narrower Gmail workflow when you want to make explicit sender decisions with a preview and a durable record of reversible moves.',
  indexSummary:
    'Choose between a broad smart-folder cleanup suite and a focused, sender-first Gmail ritual.',
  primaryUnit: 'Smart folders, groups, senders, and lists',
  providerScope: 'Major providers and IMAP',
  publicEntryPoint: '1,000 messages free; paid price not stated in reviewed help page',
  chooseCompetitor: {
    headline: 'Choose Clean Email for breadth',
    points: [
      'You need Outlook, Yahoo, iCloud, or another IMAP mailbox as well as Gmail.',
      'Smart folders, storage cleanup, sender settings, Screener, and Auto Clean belong in one suite.',
      'You want bulk subscription management and a richer email-management client surface.',
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
      label: 'Mailbox support',
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
        summary: 'Vendor says cleanup analysis uses headers and metadata',
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
  title: 'DeclutrMail vs Trimbox',
  description:
    'A source-backed comparison of DeclutrMail and Trimbox for Gmail unsubscribe, past-email deletion, automation, privacy, and pricing.',
  verdict:
    'Trimbox is the simpler choice when the job is one-click newsletter cleanup inside a Gmail-shaped experience. DeclutrMail covers a wider sender decision set and makes previews and reversible label actions part of the workflow.',
  indexSummary:
    'Choose between fast newsletter opt-outs and a broader sender-by-sender Gmail control surface.',
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
      'You want impact previews and an activity record for reversible mailbox moves.',
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
      label: 'Mailbox support',
      declutrMail: DECLUTR.providers,
      competitor: {
        summary: 'Gmail is documented',
        detail:
          'Support for other mailbox providers was not clearly stated on the reviewed current product pages.',
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
  title: 'DeclutrMail vs SaneBox',
  description:
    'A source-backed comparison of DeclutrMail and SaneBox for sender cleanup, importance sorting, training, privacy, providers, and pricing.',
  verdict:
    'SaneBox is strongest when you want new mail continuously sorted by learned importance across providers. DeclutrMail is stronger when you want to work through Gmail’s existing clutter as explicit sender decisions with previews.',
  indexSummary:
    'Choose between learned importance sorting for incoming mail and an explicit sender cleanup ritual.',
  primaryUnit: 'Learned sender importance and training folders',
  providerScope: 'Most IMAP/Exchange-style providers',
  publicEntryPoint: '14-day trial; plans limit accounts and enabled features',
  chooseCompetitor: {
    headline: 'Choose SaneBox for continuous sorting',
    points: [
      'Your main problem is interruption from incoming mail, not a sender-by-sender backlog.',
      'You want trainable folders, snooze choices, reminders, no-reply tracking, and do-not-disturb tools.',
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
      label: 'Mailbox support',
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
          'Fresh SaneBlackHole messages remain reviewable for seven days; a general action-journal undo window is not publicly stated.',
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
  title: 'DeclutrMail vs Leave Me Alone',
  description:
    'A source-backed comparison of DeclutrMail and Leave Me Alone for unsubscribe, newsletter rollups, sender cleanup, privacy, providers, and pricing.',
  verdict:
    'Leave Me Alone is purpose-built for subscriptions, Rollups, and Inbox Shield across providers. DeclutrMail treats newsletters as one part of a broader Gmail sender-cleanup workflow.',
  indexSummary:
    'Choose between subscription-focused control and a wider set of Gmail sender outcomes.',
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
      'You prefer an activity ledger for reversible Gmail label moves.',
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
      label: 'Mailbox support',
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
        summary: 'Subscription metadata; encrypted content for Rollups',
        detail:
          'Inbox Shield stores metadata. Rollups fetch, encrypt, and store the content needed to create the digest.',
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

const gmailFilters: ComparisonDefinition = {
  slug: 'gmail-filters',
  name: 'Gmail filters',
  category: 'Native rules',
  title: 'DeclutrMail vs Gmail filters',
  description:
    'A source-backed comparison of DeclutrMail and native Gmail filters for sender cleanup, future-mail rules, unsubscribe, preview, recovery, and cost.',
  verdict:
    'Gmail filters are the flexible, no-extra-vendor choice when you already know the search criteria and desired action. DeclutrMail adds a ranked sender inventory, an opinionated decision workflow, previews, and a separate activity record.',
  indexSummary: 'Choose between native rule-building and a guided, ranked sender cleanup workflow.',
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
      'You value a cleanup activity ledger and plan-based recovery window for reversible label moves.',
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
      label: 'Mailbox support',
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
          'Google documents previewing matches with Search, but no separate durable cleanup-action journal.',
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

export const COMPARISONS: readonly ComparisonDefinition[] = [
  cleanEmail,
  trimbox,
  sanebox,
  leaveMeAlone,
  gmailFilters,
];

export function comparisonBySlug(slug: string): ComparisonDefinition | undefined {
  return COMPARISONS.find((comparison) => comparison.slug === slug);
}
