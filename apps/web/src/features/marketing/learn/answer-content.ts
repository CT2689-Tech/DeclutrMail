import { PRIVACY_STORAGE_ITEMS } from '@declutrmail/shared';
import type { LearnArticle } from './types';

export const ANSWER_SLUGS = [
  'is-it-safe-to-connect-gmail-app',
  'what-is-metadata-only-email-analysis',
  'how-undo-works-for-gmail-cleanup',
  'best-way-to-clean-gmail-2026',
  'sender-level-vs-message-level-cleanup',
] as const;

export type AnswerSlug = (typeof ANSWER_SLUGS)[number];

const STORED_FIELDS = PRIVACY_STORAGE_ITEMS.join(', ');

export const ANSWER_ARTICLES: Record<AnswerSlug, LearnArticle> = {
  'is-it-safe-to-connect-gmail-app': {
    slug: 'is-it-safe-to-connect-gmail-app',
    path: '/answers/is-it-safe-to-connect-gmail-app',
    kind: 'Direct answer',
    eyebrow: 'Gmail access · risk checklist',
    title: 'Is it safe to connect a Gmail cleanup app?',
    description:
      'A practical checklist for evaluating Gmail cleanup apps: OAuth scope, fetched data, token handling, action previews, recovery, and deletion.',
    intro:
      'Connecting any third-party app to Gmail creates risk. “Safe” is not a permanent badge; it is a set of technical boundaries you can inspect, permissions you can revoke, and failure modes the product should explain before you authorize it.',
    quickAnswer:
      'It can be reasonable when the app uses Google OAuth, requests only permissions its features need, clearly states what it fetches and stores, protects tokens, previews mutations, and lets you revoke access and delete data. Never rely on a privacy slogan alone.',
    readingMinutes: 8,
    sections: [
      {
        id: 'questions',
        title: 'Six questions to ask before connecting',
        paragraphs: [
          'A useful evaluation separates access from usage. Gmail may expose a broad capability through one OAuth scope; the app’s code and policy determine which parts it actually reads or changes.',
        ],
        bullets: [
          'Does sign-in use Google OAuth, so you never give the app your Google password?',
          'Which Gmail scope is requested, and which product actions require it?',
          'Does the app fetch full or raw messages, or only a declared metadata set?',
          'Are OAuth tokens encrypted, excluded from the browser, and revocable?',
          'Can you see the current scope and planned Gmail changes before mail moves, and which effects cannot be undone?',
          'Can you disconnect an inbox, export your data, and delete the stored index?',
        ],
      },
      {
        id: 'declutrmail-scope',
        title: 'What DeclutrMail asks Google for',
        paragraphs: [
          'DeclutrMail requests gmail.modify, plus OpenID and the email identity used to connect the correct mailbox. gmail.modify is needed to change labels, archive, move messages to Trash, and support other user-approved mailbox actions. It is a sensitive capability, so treating it as “read-only” would be misleading.',
          'The product narrows usage inside that scope. Gmail messages are requested in metadata format; full and raw message formats are not used. The stored message allowlist is: ' +
            STORED_FIELDS +
            '. Attachments, inline images, raw MIME, and full message bodies are not fetched or stored.',
        ],
        callout: {
          title: 'A Gmail snippet is stored',
          body: 'Metadata-only does not mean “sender address only.” DeclutrMail stores Gmail’s short preview snippet and subject. Those fields can still contain sensitive text and should be part of your decision.',
          tone: 'truth',
        },
      },
      {
        id: 'processing',
        title: 'Know where metadata is processed',
        paragraphs: [
          'Most sender scoring uses aggregate facts rather than message content. The reasoning path that explains a sender decision receives precomputed facts and does not receive subject or snippet text.',
          'Daily Brief is a narrower exception that should be stated plainly: when its narrative provider is configured, it sends sender identity, subject, and Gmail preview snippet to Anthropic within a bounded prompt. It never sends a full message body or attachment, and it falls back to a deterministic template when that provider is unavailable.',
        ],
      },
      {
        id: 'action-risk',
        title: 'Evaluate mutation risk separately from data risk',
        paragraphs: [
          'An app can minimize stored data and still move the wrong messages. Look for a preview that names the sender, action, and count; an activity record; idempotent execution; and verb-specific recovery rather than one universal undo promise.',
          'In DeclutrMail, Archive, Later, and Delete have Activity Undo while their plan-window token is live. Delete also has separate Gmail Trash recovery. A delivered unsubscribe request is one-way. Manual Archive, Later, and Delete affect current matched mail and do not silently become future sender rules.',
        ],
      },
      {
        id: 'leave',
        title: 'Verify that you can leave cleanly',
        paragraphs: [
          'You should be able to revoke access from the app and from Google’s connected-app controls. Revocation should stop future API access immediately even if the service retains a historical activity record under its stated policy.',
          'DeclutrMail exposes mailbox disconnection from the top-bar account menu, data export, and whole-account deletion. Disconnecting preserves the historical DeclutrMail record for reconnection; account deletion follows the published grace and undo-window schedule. After revocation, verify Google’s own permissions page no longer lists the connection.',
        ],
      },
      {
        id: 'decision',
        title: 'Make a threat-model decision, not a brand decision',
        paragraphs: [
          'A highly sensitive mailbox used for legal, medical, or financial operations may justify avoiding third-party access even when controls are strong. A separate consumer mailbox may have a different risk tolerance. The same answer does not fit both.',
          'The responsible product answer is therefore conditional: understand the scope, the stored fields, external processors, mutation boundaries, and exit path. Connect only if that complete model is acceptable to you.',
        ],
      },
    ],
    related: [
      {
        href: '/security',
        label: 'DeclutrMail security',
        description: 'OAuth, encryption, verification, and reporting details.',
      },
      {
        href: '/privacy',
        label: 'Privacy policy',
        description: 'The published Gmail message-field disclosure and never-store list.',
      },
      {
        href: '/answers/what-is-metadata-only-email-analysis',
        label: 'Metadata-only explained',
        description: 'What the phrase includes and excludes.',
      },
    ],
  },

  'what-is-metadata-only-email-analysis': {
    slug: 'what-is-metadata-only-email-analysis',
    path: '/answers/what-is-metadata-only-email-analysis',
    kind: 'Direct answer',
    eyebrow: 'Privacy boundary · published fields',
    title: 'What is metadata-only email analysis?',
    description:
      'Metadata-only email analysis explained precisely, including Gmail snippets, subjects, aggregate facts, external processing, and what is never fetched.',
    intro:
      'The phrase is useful only when the product lists the fields. A subject line and a Gmail preview snippet are metadata in the API response, but they can reveal more than a timestamp or sender address.',
    quickAnswer:
      'Metadata-only analysis means the system works from a declared set of message headers, Gmail’s generated preview snippet, labels, dates, and engagement state without fetching the full or raw message body. It is data minimization, not content-free processing.',
    readingMinutes: 7,
    sections: [
      {
        id: 'three-layers',
        title: 'Separate headers, preview text, and full content',
        paragraphs: [
          'Email data is not binary. Identity and routing headers sit at one layer. Gmail’s snippet is a short preview generated by Gmail from message content. The full MIME message contains the complete text, HTML, inline assets, and attachments.',
          'A metadata request can include selected headers and Gmail’s snippet without returning the full MIME parts. That materially reduces collection, but the snippet and subject may still contain a name, purchase, appointment, or other sensitive phrase.',
        ],
      },
      {
        id: 'stored',
        title: 'What DeclutrMail stores',
        paragraphs: [
          'DeclutrMail’s published message-field disclosure lists: ' + STORED_FIELDS + '.',
          'It also stores derived sender aggregates and the user’s own decisions, automation settings, and activity records. Full message bodies, HTML, attachments, inline images, raw MIME, and headers outside the allowlist are not fetched or stored.',
        ],
        callout: {
          title: 'The honest shorthand',
          body: 'Say “full bodies fetched: 0; Gmail snippets stored,” not “we cannot see any email content.” The second statement erases a meaningful part of the boundary.',
          tone: 'truth',
        },
      },
      {
        id: 'analysis',
        title: 'What can be inferred without a body',
        paragraphs: [
          'Sender frequency, time since last message, read rate, reply history, labels, and whether a sender is protected can support useful sender-level decisions. These facts answer questions such as “how often does this source arrive?” and “do I engage with it?” without parsing a complete email.',
          'They cannot reliably answer what a specific message means. When a subject or snippet is ambiguous, the correct interface sends you to Gmail rather than pretending the metadata contains the whole story.',
        ],
      },
      {
        id: 'external-processing',
        title: 'External processing still belongs in the disclosure',
        paragraphs: [
          'DeclutrMail’s sender-reasoning adapter receives aggregate facts and no subject or snippet. Daily Brief uses a different bounded input: sender identity, subject, and Gmail snippet may be sent to Anthropic to compose a short narrative when the adapter is configured.',
          'That input remains body-free, and the stored Brief payload intentionally omits the snippets used in the prompt. Even so, sending allowlisted metadata to a processor is processing and should not be hidden behind “no full bodies.”',
        ],
      },
      {
        id: 'evaluate',
        title: 'How to evaluate a metadata-only claim',
        paragraphs: [
          'Ask for implementation-level answers rather than accepting the category label.',
        ],
        bullets: [
          'Which API format and required metadata are requested?',
          'Is a provider-generated snippet fetched or stored?',
          'Which derived aggregates are retained, and for how long?',
          'Does any feature send subjects or snippets to an external processor?',
          'Are logs, error reports, analytics, and exports barred from containing those fields?',
          'Can the user delete the index without deleting mail in Gmail?',
        ],
      },
      {
        id: 'tradeoff',
        title: 'The trade-off is reduced exposure, not zero exposure',
        paragraphs: [
          'Metadata-only design lowers the consequence of a breach because the service never possesses complete conversations or attachments. It also constrains product behavior: deep content search, complete summarization, and body-based classification should not be possible.',
          'A trustworthy design treats those missing capabilities as proof of the boundary, not as gaps to work around silently.',
        ],
      },
    ],
    related: [
      {
        href: '/privacy',
        label: 'Privacy disclosure',
        description: 'Stored and never-fetched fields in one policy.',
      },
      {
        href: '/answers/is-it-safe-to-connect-gmail-app',
        label: 'Connection risk checklist',
        description: 'Evaluate scope, processing, actions, and exit paths.',
      },
      {
        href: '/blog/metadata-only-is-a-design-constraint',
        label: 'Metadata as a constraint',
        description: 'Why less data should visibly limit the product.',
      },
    ],
  },

  'how-undo-works-for-gmail-cleanup': {
    slug: 'how-undo-works-for-gmail-cleanup',
    path: '/answers/how-undo-works-for-gmail-cleanup',
    kind: 'Direct answer',
    eyebrow: 'Recovery · action by action',
    title: 'How does undo work for Gmail cleanup?',
    description:
      'A verb-specific explanation of Gmail cleanup recovery for Archive, Later, Delete, Keep, and delivered Unsubscribe requests.',
    intro:
      'There is no honest universal undo for email cleanup. Some actions are reversible label changes, some rely on Gmail Trash, some are standing settings you can change again, and some leave the system entirely.',
    quickAnswer:
      'Archive, Later, and Delete expose Activity Undo while the plan-window token is active. Delete also has separate Gmail Trash recovery for up to about 30 days unless Trash is emptied sooner. Keep can be changed as a policy. A delivered unsubscribe request cannot be recalled.',
    readingMinutes: 7,
    sections: [
      {
        id: 'model',
        title: 'Undo records the inverse, not a copy of your email',
        paragraphs: [
          'For a reversible mail-moving action, DeclutrMail records the Gmail message identifiers and the label change needed to reverse the action. It does not copy the message body into an undo store. The token is a capability tied to one mailbox and expires after the plan’s configured window.',
          'Free and Plus currently use seven-day Activity windows; Pro uses thirty days for journaled actions. Gmail’s own retention rules can still impose an outside limit, especially for Trash.',
        ],
      },
      {
        id: 'archive-later',
        title: 'Archive and Later are inverse label changes',
        paragraphs: [
          'Archive removes the Inbox label. Undo adds Inbox back. Later removes Inbox and adds DeclutrMail/Later; undo adds Inbox and removes that Later label. These are current-mail changes, not permanent future sender rules.',
          'The active entry appears in Activity, and Triage also shows a recent-action tray. Do not assume the undo control follows you globally across every screen; Activity is the dependable recovery destination.',
        ],
      },
      {
        id: 'delete',
        title: 'Delete combines an app journal with Gmail Trash',
        paragraphs: [
          'Delete adds Gmail’s Trash state and removes Inbox. Gmail keeps ordinary deleted messages in Trash for up to 30 days unless you permanently delete them or empty Trash earlier. DeclutrMail’s preview names that Gmail recovery boundary.',
          'An Activity token can reverse the label operation while it is active. If the token has expired but Gmail still retains the message, restore it directly from Gmail Trash. Once Gmail permanently deletes it, DeclutrMail cannot recover it because DeclutrMail never stored a full copy.',
        ],
      },
      {
        id: 'unsubscribe',
        title: 'Delivered unsubscribe is one-way',
        paragraphs: [
          'An unsubscribe request may be sent to a standards endpoint or, for mailto, manually sent by you from Gmail. Once delivered, it has crossed into another organization’s system. There is no standard retract operation, so DeclutrMail does not present the request itself as undoable.',
          'A confirmation can also include Archive or Delete for the old backlog. Only that secondary mail-moving effect has its own recovery path. Undoing the backlog does not resubscribe you.',
        ],
        callout: {
          title: 'Resubscribe is a new action',
          body: 'If you change your mind, visit the sender’s site or signup form. That creates a new subscription; it is not an undo of the earlier request.',
          tone: 'warning',
        },
      },
      {
        id: 'policies',
        title: 'Keep and Protected are settings, not journaled mail moves',
        paragraphs: [
          'Keep records your current sender decision. Protected is the standing safety control. Neither moves messages, so they do not create the same undo-journal token as Archive or Later. You reverse their effect by changing the sender policy again.',
          'That distinction matters because a toast saying “undo” can imply a transactional rollback when the real mechanism is simply another settings write.',
        ],
      },
      {
        id: 'safe-use',
        title: 'Use recovery as a safety net, not as the first review',
        paragraphs: [
          'Read the preview, verify the sender, and start with a small batch. Then inspect Activity and Gmail. Recovery protects against mistakes; it should not replace knowing which messages and future behaviors an action covers.',
          'For a high-risk deletion, verify Gmail Trash immediately. For an unsubscribe, assume delivery is final before confirming.',
        ],
      },
    ],
    related: [
      {
        href: '/how-to/bulk-delete-emails-from-one-sender',
        label: 'Delete with a checked scope',
        description: 'Use Gmail search or a sender preview safely.',
      },
      {
        href: '/how-to/unsubscribe-from-emails-gmail',
        label: 'Unsubscribe boundaries',
        description: 'One-click, mailto, and secondary cleanup.',
      },
      {
        href: '/blog/reversible-does-not-mean-risk-free',
        label: 'Recovery is not consent',
        description: 'Why previews still matter when undo exists.',
      },
    ],
  },

  'best-way-to-clean-gmail-2026': {
    slug: 'best-way-to-clean-gmail-2026',
    path: '/answers/best-way-to-clean-gmail-2026',
    kind: 'Direct answer',
    eyebrow: '2026 field guide · choose by job',
    title: 'What is the best way to clean Gmail in 2026?',
    description:
      'A practical 2026 comparison of Gmail search, filters, unsubscribe, sender-first cleanup, and automation based on the job you need done.',
    intro:
      'The best method depends on whether you are removing old mail, stopping future mail, preserving important history, or automating a stable pattern. No single bulk action is safest for every job.',
    quickAnswer:
      'Use Gmail search for a precise one-off cleanup, Gmail filters for exact future routing, unsubscribe for legitimate lists you no longer want, and sender-first review when recurring sources are the real problem. Add automation only after observing its matches.',
    readingMinutes: 8,
    sections: [
      {
        id: 'job-map',
        title: 'Match the tool to the job',
        paragraphs: [
          'Start by naming the desired change. “Clean my inbox” is too broad to verify. “Remove old mail from one sender,” “stop a newsletter,” and “route future low-value updates away from Inbox” have different safest tools.',
        ],
        bullets: [
          'One exact backlog: Gmail search plus a reviewed selection.',
          'One exact future pattern: Gmail filter with Skip Inbox or a label.',
          'Legitimate recurring list: Gmail or DeclutrMail unsubscribe.',
          'Many recurring sources: a sender-first inventory and small review batches.',
          'Stable behavior across senders: observed automation, activated only after reviewing matches.',
        ],
      },
      {
        id: 'native-first',
        title: 'Use Gmail’s native tools when the condition is already clear',
        paragraphs: [
          'Gmail search operators are the most transparent way to define one affected set. You see the results before selecting them, and Gmail remains the source of truth. Filters are similarly strong for future rules when the condition is exact and durable.',
          'The weakness is discovery. Native Gmail does not automatically turn thousands of messages into a ranked sender decision list, so users often clean by date or unread state and leave the recurring source unchanged.',
        ],
      },
      {
        id: 'sender-first',
        title: 'Use sender-first cleanup when recurrence is the problem',
        paragraphs: [
          'Sender-first cleanup compresses many messages into one review object. Volume, engagement, recent subjects, and replies help you identify which source deserves a decision. This is especially useful when you cannot name the noisiest sources from memory.',
          'DeclutrMail implements this model as a Gmail companion. It stores allowlisted metadata and Gmail snippets but never fetches full message bodies. You return to Gmail for reading and final verification.',
        ],
      },
      {
        id: 'sequence',
        title: 'A safe sequence for a large mailbox',
        paragraphs: [],
        steps: [
          {
            name: 'Protect obvious important sources',
            text: 'Identify people, account-security mail, financial records, receipts, and anything uncertain before pursuing large counts.',
          },
          {
            name: 'Stop future legitimate noise',
            text: 'Unsubscribe from a small batch of recognized lists. Use spam reporting for deceptive mail rather than engaging with it.',
          },
          {
            name: 'Clean existing mail separately',
            text: 'Archive when searchability matters, Later for a temporary queue, and Delete only with a verified scope and Trash plan.',
          },
          {
            name: 'Create exact future routing',
            text: 'Use Gmail filters for known senders or explicit conditions. Do not assume a manual Archive installed a future rule.',
          },
          {
            name: 'Observe before automating fuzzy patterns',
            text: 'Review at least a representative week of would-be matches before activating DeclutrMail’s preset automation.',
          },
        ],
      },
      {
        id: 'avoid',
        title: 'Avoid shortcuts that hide scope',
        paragraphs: [
          'Be skeptical of “delete everything,” universal undo, and category claims that cannot show their inputs. A large result count is not evidence that the selection is correct. A recommendation should remain inspectable and subordinate to your decision.',
          'Also avoid making inbox zero the only success measure. A small Inbox can still be governed by brittle filters, while a larger mailbox with deliberate sender rules can be calmer and safer.',
        ],
        callout: {
          title: 'Best means explainable',
          body: 'The best cleanup method is the one where you can state the selected set, the current-mail effect, the future-mail effect, and the recovery path before clicking confirm.',
          tone: 'truth',
        },
      },
      {
        id: 'maintenance',
        title: 'Prefer maintenance over another annual purge',
        paragraphs: [
          'A monthly ten-minute review of new recurring senders prevents the next backlog more effectively than another giant deletion. Check whether unsubscribed senders still write, whether filters still match the intended mail, and whether automation produced exceptions.',
          'Cleanup becomes durable when every recurring source has an explicit reason to stay, route elsewhere, or stop.',
        ],
      },
    ],
    related: [
      {
        href: '/how-to/clean-gmail-by-sender',
        label: 'Run a sender-first pass',
        description: 'A concrete workflow in Gmail and DeclutrMail.',
      },
      {
        href: '/answers/sender-level-vs-message-level-cleanup',
        label: 'Compare cleanup models',
        description: 'Different units answer different questions.',
      },
      {
        href: '/pricing',
        label: 'Current plan limits',
        description: 'Single, bulk, inbox, and automation capabilities.',
      },
    ],
  },

  'sender-level-vs-message-level-cleanup': {
    slug: 'sender-level-vs-message-level-cleanup',
    path: '/answers/sender-level-vs-message-level-cleanup',
    kind: 'Direct answer',
    eyebrow: 'Mental model · unit of decision',
    title: 'Sender-level vs message-level email cleanup',
    description:
      'Compare sender-level and message-level Gmail cleanup, including where each model is strong, where it loses context, and how to combine them.',
    intro:
      'Message-level cleanup asks what to do with this email. Sender-level cleanup asks what relationship you want with this recurring source. Neither question replaces the other.',
    quickAnswer:
      'Use sender-level cleanup to discover recurring volume and make durable source decisions. Use message-level cleanup when content, thread context, attachments, deadlines, or exceptions determine the outcome. The safest workflow moves between both.',
    readingMinutes: 7,
    sections: [
      {
        id: 'message-strength',
        title: 'Message-level review preserves the most context',
        paragraphs: [
          'Gmail’s inbox, search results, and threads show the actual subject, participants, body, attachments, and conversation history. That context is essential for replies, approvals, receipts, deadlines, and any sender whose messages vary widely in importance.',
          'The cost is scale. Repeatedly deciding on individual newsletters or automated updates treats each symptom while leaving the source unchanged.',
        ],
      },
      {
        id: 'sender-strength',
        title: 'Sender-level review exposes recurrence',
        paragraphs: [
          'Grouping by sender makes volume and engagement visible. Fifty near-identical updates become one review: keep the relationship, stop future delivery, or clean the existing backlog. That compression is useful when the decision is truly about the source.',
          'DeclutrMail’s sender index uses allowlisted metadata, Gmail snippets, and aggregate facts. It deliberately does not fetch full message bodies, so it cannot replace message reading when content is decisive.',
        ],
      },
      {
        id: 'failure-modes',
        title: 'Each model has a characteristic failure mode',
        paragraphs: [
          'Message-level cleanup can become endless triage: the same sender returns tomorrow because the future relationship was never addressed. Sender-level cleanup can overgeneralize: one address may carry promotions, receipts, and security notices that should not share one destructive action.',
          'Display names add another trap. Multiple addresses can represent one brand, and one mailing system can serve many brands. Sender identity must be inspectable rather than inferred from a logo or label alone.',
        ],
        callout: {
          title: 'A sender is a review unit, not a category verdict',
          body: 'Low engagement can justify a closer look. It does not prove that a sender is promotional, safe to delete, or unimportant.',
          tone: 'truth',
        },
      },
      {
        id: 'hybrid',
        title: 'Use a hybrid loop',
        paragraphs: [],
        steps: [
          {
            name: 'Discover at sender level',
            text: 'Rank recurring sources by volume or review a sender queue. Start with obvious, repeated patterns rather than individual unread messages.',
          },
          {
            name: 'Inspect representative messages',
            text: 'Read recent subjects and Gmail snippets. Open the full message in Gmail whenever the sender appears mixed or sensitive.',
          },
          {
            name: 'Decide the future relationship',
            text: 'Choose Keep or Unsubscribe, or create an exact Gmail filter when you know how future mail should route.',
          },
          {
            name: 'Decide the current backlog separately',
            text: 'Archive, Later, or Delete the messages that already exist. Manual cleanup does not silently become a future rule.',
          },
          {
            name: 'Verify exceptions in Gmail',
            text: 'Check Activity and sample the affected messages in Gmail. Correct the sender decision or restore mail before the recovery window closes.',
          },
        ],
      },
      {
        id: 'which-to-use',
        title: 'Choose the starting level from the uncertainty',
        paragraphs: [
          'Start at sender level when the source is repetitive, the messages serve one stable purpose, and aggregate behavior is enough to justify review. Start at message level when the sender is a person, a shared platform, or a source with high-consequence exceptions.',
          'For automation, require an even stronger standard: observe multiple matches, protect exceptions, and expose the active rule. Automation turns one mistaken generalization into a recurring mistake.',
        ],
      },
      {
        id: 'measure',
        title: 'Measure prevented recurrence, not just removed messages',
        paragraphs: [
          'Message counts describe the backlog removed today. Sender decisions and filters describe which recurrence will be prevented tomorrow. Both are useful, but they answer different questions and should not be merged into one inflated cleanup number.',
          'A calm mailbox comes from preserving context where it matters and compressing repetition where it does not.',
        ],
      },
    ],
    related: [
      {
        href: '/how-to/clean-gmail-by-sender',
        label: 'Sender-first workflow',
        description: 'Apply the hybrid loop to a real cleanup session.',
      },
      {
        href: '/answers/best-way-to-clean-gmail-2026',
        label: 'Choose the right tool',
        description: 'Map searches, filters, and automation to the job.',
      },
      {
        href: '/blog/why-cleanup-starts-with-senders',
        label: 'Why start with senders',
        description: 'The product argument behind the model.',
      },
    ],
  },
};
