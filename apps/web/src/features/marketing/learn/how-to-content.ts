import type { LearnArticle } from './types';

export const HOW_TO_SLUGS = [
  'clean-gmail-by-sender',
  'bulk-delete-emails-from-one-sender',
  'auto-archive-future-emails-in-gmail',
  'stop-promotional-emails-gmail',
  'unsubscribe-from-emails-gmail',
] as const;

export type HowToSlug = (typeof HOW_TO_SLUGS)[number];

export const HOW_TO_ARTICLES: Record<HowToSlug, LearnArticle> = {
  'clean-gmail-by-sender': {
    slug: 'clean-gmail-by-sender',
    path: '/how-to/clean-gmail-by-sender',
    kind: 'How-to guide',
    eyebrow: 'Inbox method · sender first',
    title: 'How to clean Gmail by sender',
    description:
      'A precise sender-first Gmail cleanup workflow, with native Gmail steps and an honest explanation of what DeclutrMail changes.',
    intro:
      'An inbox may contain 20,000 messages but only a few dozen recurring sources of noise. Grouping by sender turns an endless message list into a smaller set of decisions you can reason about.',
    readingMinutes: 7,
    example: {
      label: 'Illustrative example — synthetic data',
      caption:
        'These names and counts are invented to demonstrate the decision model. They are not a screenshot or a claim about your inbox.',
      rows: [
        {
          sender: 'Weekly Market Note',
          detail: '38 inbox messages · 3% read',
          action: 'Archive',
          result: 'Current inbox mail moves to All Mail.',
        },
        {
          sender: 'Project Digest',
          detail: '12 inbox messages · opened often',
          action: 'Later',
          result: 'Current mail moves to DeclutrMail/Later.',
        },
        {
          sender: 'Coupon Parade',
          detail: '61 messages · no recent engagement',
          action: 'Unsubscribe',
          result: 'Future delivery is stopped where the sender supports it.',
        },
      ],
    },
    sections: [
      {
        id: 'why-sender-first',
        title: 'Start with the source, not the unread count',
        paragraphs: [
          'Unread counts measure accumulation. They do not tell you which decision will prevent the next hundred messages. A sender-first pass asks a more durable question: do I still want mail from this source, and what should happen to the mail already here?',
          'Gmail can already do this manually. Search for one exact address with the from: operator, inspect a few recent messages, then archive, label, delete, or create a filter. The limitation is repetition: you must know which sender to search for and repeat the investigation for every source.',
        ],
        bullets: [
          'Start with high-volume senders rather than the oldest individual messages.',
          'Inspect recent subjects before acting; an address may carry receipts as well as marketing.',
          'Protect people, financial notices, account security, and anything you are uncertain about.',
        ],
      },
      {
        id: 'native-gmail',
        title: 'The native Gmail method',
        paragraphs: [
          'This method stays entirely inside Gmail and is the right baseline to understand before adding another tool.',
        ],
        steps: [
          {
            name: 'Find an exact sender',
            text: 'Open one message, copy the actual From address, and search Gmail for from:(address@example.com). Add newer_than:1y if you want to inspect a recent window first.',
          },
          {
            name: 'Sample before selecting',
            text: 'Open several recent results. Confirm the address is not shared across receipts, security alerts, and promotions that deserve different treatment.',
          },
          {
            name: 'Choose the scope',
            text: 'Select the visible page or use Gmail’s “select all conversations that match this search” option only after checking the query. The second option can affect years of mail.',
          },
          {
            name: 'Apply one clear outcome',
            text: 'Archive removes Inbox, Delete moves mail to Trash, and a label organizes it. If you want future behavior, create a Gmail filter separately; a one-time archive is not a future rule.',
          },
        ],
      },
      {
        id: 'declutrmail-workflow',
        title: 'What DeclutrMail changes about the workflow',
        paragraphs: [
          'DeclutrMail indexes sender, subject, Gmail’s short preview snippet, dates, labels, and read state, then presents senders with aggregate facts such as volume and engagement. Full message bodies and attachments are never fetched. You still open Gmail when you need to read a message.',
          'On the Senders or Triage surface, choose a sender, inspect the preview of what will move, and apply the decision. Single-sender actions are available before bulk workflows; current plan limits and bulk capabilities are listed on the pricing page.',
        ],
        steps: [
          {
            name: 'Connect and let the index finish',
            text: 'DeclutrMail needs the metadata sync to finish before volume and engagement facts are reliable. It remains a companion to Gmail, not a second inbox.',
          },
          {
            name: 'Review the noisiest sender',
            text: 'Use sender volume, read rate, replies, and recent subjects as evidence. Recommendations are guidance; the decision remains yours.',
          },
          {
            name: 'Preview the mail-moving action',
            text: 'Archive, Later, Delete, and Unsubscribe show their scope before commit. Check both what changes and what remains untouched.',
          },
          {
            name: 'Verify in Activity and Gmail',
            text: 'Activity records the result. Reversible label changes expose an active undo there; delivered unsubscribe requests do not, because an external sender cannot be made to resubscribe you automatically.',
          },
        ],
      },
      {
        id: 'action-boundaries',
        title: 'Know what each decision actually means',
        paragraphs: [
          'Archive removes the Inbox label from the matching mail that exists now. Later removes Inbox and adds DeclutrMail/Later to that current mail. Delete moves current matching mail to Gmail Trash. None of those manual actions creates a standing rule for future messages.',
          'Unsubscribe is different: it asks the sender to stop future delivery and leaves existing mail where it is unless you separately approve a cleanup action. Keep records a sender decision, while VIP and Protect are separate standing controls.',
        ],
        callout: {
          title: 'Undo is verb-specific',
          body: 'Archive and Later can be reversed from Activity while their token is live. Delete is recoverable through Gmail Trash for up to about 30 days unless Trash is emptied sooner. Once an unsubscribe request is delivered, that request is one-way.',
          tone: 'truth',
        },
      },
      {
        id: 'repeatable-routine',
        title: 'Use a small repeatable routine',
        paragraphs: [
          'Do not attempt to perfect the entire mailbox in one sitting. Decide on five to ten obvious senders, verify the results, and stop. The next pass becomes faster because the ambiguous senders are no longer mixed with the easy ones.',
          'A useful outcome is not inbox zero. It is a mailbox in which recurring noise has an explicit owner and each action has a known boundary.',
        ],
      },
    ],
    sources: [
      {
        href: 'https://support.google.com/mail/answer/9259770?hl=en',
        label: 'Google: Organize and archive email',
        description: 'Official Archive, All Mail, multi-select, and Trash behavior.',
      },
    ],
    related: [
      {
        href: '/answers/sender-level-vs-message-level-cleanup',
        label: 'Sender-level vs message-level',
        description: 'When each model is the better tool.',
      },
      {
        href: '/how-to/bulk-delete-emails-from-one-sender',
        label: 'Delete one sender safely',
        description: 'Scope a Gmail Trash move without guessing.',
      },
      {
        href: '/pricing',
        label: 'Compare plans',
        description: 'Current inbox, bulk-action, and undo limits.',
      },
    ],
  },

  'bulk-delete-emails-from-one-sender': {
    slug: 'bulk-delete-emails-from-one-sender',
    path: '/how-to/bulk-delete-emails-from-one-sender',
    kind: 'How-to guide',
    eyebrow: 'Gmail cleanup · exact scope',
    title: 'How to bulk delete emails from one sender',
    description:
      'Safely delete Gmail messages from one sender using a verified search, with clear Trash and future-mail boundaries.',
    intro:
      'Bulk delete is safe only when the search is precise and the effect is understood. Gmail moves deleted messages to Trash; it does not unsubscribe you or stop the sender from writing again.',
    readingMinutes: 6,
    example: {
      label: 'Illustrative example — synthetic data',
      caption: 'A made-up sender demonstrates how current-mail scope differs from future delivery.',
      rows: [
        {
          sender: 'Sale Signal',
          detail: 'from:offers@salesignal.example · 84 current messages',
          action: 'Delete',
          result: '84 move to Gmail Trash; future mail can still arrive.',
        },
      ],
    },
    sections: [
      {
        id: 'before-delete',
        title: 'Check the address and the consequences first',
        paragraphs: [
          'A display name is not a stable sender identity. “Store Updates” may arrive from several addresses, while one address may carry orders and advertising together. Use the full From address and inspect recent subjects before selecting everything.',
          'Gmail normally retains Trash for up to about 30 days unless you permanently delete messages or empty Trash earlier. Treat that period as recovery time, not long-term storage. If you might need invoices or receipts, narrow the search with exclusions or archive instead.',
        ],
        callout: {
          title: 'Delete is not unsubscribe',
          body: 'Deleting current mail changes only the messages matched now. It does not contact the sender, create a filter, or stop future delivery.',
          tone: 'warning',
        },
      },
      {
        id: 'gmail-steps',
        title: 'Delete one sender in Gmail',
        paragraphs: [
          'Use Gmail’s own search grammar to make the affected set visible before acting.',
        ],
        steps: [
          {
            name: 'Search the exact address',
            text: 'Enter from:(offers@example.com). For a safer first pass, add older_than:1y or -label:important and inspect the resulting set.',
          },
          {
            name: 'Open a sample',
            text: 'Check recent and old results. Look for receipts, password resets, or account notices that share the same sender address.',
          },
          {
            name: 'Select the intended scope',
            text: 'Select the current page first. If Gmail offers “select all conversations that match,” use it only when the query and count match your intention.',
          },
          {
            name: 'Move to Trash and verify',
            text: 'Click Delete, then open Trash and confirm a few messages. Undo immediately if the selection was wrong; otherwise Gmail keeps the messages in Trash temporarily.',
          },
        ],
      },
      {
        id: 'declutrmail-steps',
        title: 'Delete by sender in DeclutrMail',
        paragraphs: [
          'DeclutrMail groups the current indexed mail by sender. Delete is intentionally placed behind the action menu and a confirmation preview because its recovery model differs from Archive and Later.',
          'The preview names the sender and affected count available from the current index. The action moves matching mail to Gmail Trash and removes it from Inbox. It does not install a future sender rule.',
        ],
        steps: [
          {
            name: 'Open the sender',
            text: 'Find the sender in Senders, then review recent subjects and its current inbox count.',
          },
          {
            name: 'Choose Delete from the full action menu',
            text: 'Delete is not promoted as a recommendation. It remains an explicit choice separate from Archive, Later, Keep, and Unsubscribe.',
          },
          {
            name: 'Read the preview',
            text: 'Confirm the sender and message scope. The recovery note should say that Gmail Trash, not DeclutrMail, supplies the approximately 30-day window.',
          },
          {
            name: 'Confirm and inspect Activity',
            text: 'Wait for server confirmation. Activity records the action; Gmail remains the final place to verify or restore trashed messages.',
          },
        ],
      },
      {
        id: 'future-mail',
        title: 'Decide what should happen to future mail separately',
        paragraphs: [
          'If the sender is legitimate but no longer wanted, use Unsubscribe after reading its preview. If it lacks a usable unsubscribe method, a Gmail filter can route future mail to Trash or skip Inbox. Blocking the sender routes future mail to Spam; that is a different outcome again.',
          'Keeping cleanup and future routing as two explicit decisions prevents a one-time housekeeping action from silently becoming permanent automation.',
        ],
      },
      {
        id: 'safer-alternatives',
        title: 'Use a less destructive option when uncertain',
        paragraphs: [
          'Archive preserves mail in All Mail and Gmail search. Later keeps it under a DeclutrMail/Later label. Both are better first moves when the sender mixes useful and noisy messages, and both have DeclutrMail Activity undo while their token is active.',
          'The fastest cleanup is not always the one with the largest count. The better measure is how confidently you can explain what moved and how you would recover it.',
        ],
      },
    ],
    sources: [
      {
        href: 'https://support.google.com/mail/answer/7401?hl=en',
        label: 'Google: Delete messages in Gmail',
        description: 'Official search, Trash, recovery, and permanent-deletion behavior.',
      },
    ],
    related: [
      {
        href: '/answers/how-undo-works-for-gmail-cleanup',
        label: 'How undo actually works',
        description: 'Different verbs have different recovery boundaries.',
      },
      {
        href: '/how-to/unsubscribe-from-emails-gmail',
        label: 'Stop future delivery',
        description: 'Use unsubscribe when deletion is not enough.',
      },
      {
        href: '/faq',
        label: 'Product FAQ',
        description: 'Short answers about privacy, actions, and plans.',
      },
    ],
  },

  'auto-archive-future-emails-in-gmail': {
    slug: 'auto-archive-future-emails-in-gmail',
    path: '/how-to/auto-archive-future-emails-in-gmail',
    kind: 'How-to guide',
    eyebrow: 'Automation · with a review phase',
    title: 'How to auto-archive future emails in Gmail',
    description:
      'Create a Gmail Skip Inbox filter, or use DeclutrMail’s observed low-engagement preset without confusing one-time Archive with a future rule.',
    intro:
      'A one-time Archive removes Inbox from mail that already exists. Future auto-archive requires a separate filter or automation rule. Keeping that distinction visible is the safest way to avoid mail disappearing unexpectedly.',
    readingMinutes: 7,
    example: {
      label: 'Illustrative example — synthetic data',
      caption: 'Synthetic rule matches show why Observe should come before Active automation.',
      rows: [
        {
          sender: 'Product Roundup',
          detail: 'Observed match · low engagement · 9 messages',
          action: 'Would archive',
          result: 'Nothing moves while the preset remains in Observe.',
        },
        {
          sender: 'Billing Alerts',
          detail: 'Opened regularly · excluded by the observed pattern',
          action: 'Keep',
          result: 'Review catches a source that should remain visible.',
        },
      ],
    },
    sections: [
      {
        id: 'choose-mechanism',
        title: 'Choose between an exact filter and an observed preset',
        paragraphs: [
          'Gmail filters are best when you can state an exact condition such as one sender address or a stable subject prefix. They are transparent, free, and run entirely in Gmail. A filter can Skip Inbox, apply a label, mark as read, forward, or delete future matches.',
          'DeclutrMail’s launch automation is preset-based rather than a custom rule builder. Its “Auto-archive low-engagement” preset watches aggregate sender signals. Every preset begins in Observe, where matches are collected but mail is not moved. After the seven-day observation period, you review a dry run before choosing Active.',
        ],
      },
      {
        id: 'gmail-filter',
        title: 'Create a native Gmail auto-archive filter',
        paragraphs: [
          'Use an exact query and test it against existing mail before saving the future rule.',
        ],
        steps: [
          {
            name: 'Build and test the search',
            text: 'Search for from:(updates@example.com), a stable subject, or another narrow condition. Read several results and verify the query excludes wanted mail.',
          },
          {
            name: 'Open filter creation',
            text: 'Use Gmail’s advanced-search controls and choose Create filter. Gmail shows the same criteria before you select an action.',
          },
          {
            name: 'Select Skip the Inbox',
            text: 'Choose “Skip the Inbox (Archive it).” Applying a label as well makes the routed mail easy to find. Avoid Delete unless the condition is exceptionally stable.',
          },
          {
            name: 'Decide whether existing mail is included',
            text: 'Gmail offers a separate option to apply the filter to matching conversations that already exist. Leave it off if your goal is future mail only.',
          },
          {
            name: 'Review the filter later',
            text: 'Return to Gmail Settings → Filters and Blocked Addresses after a few days. Edit or remove the filter if legitimate mail is being routed away.',
          },
        ],
      },
      {
        id: 'declutrmail-autopilot',
        title: 'Use DeclutrMail Autopilot without blind activation',
        paragraphs: [
          'Autopilot is a Pro surface with five launch presets. Custom rules are not part of the launch UI, so do not expect to enter an arbitrary sender and create a permanent archive rule there.',
          'The low-engagement preset evaluates the signals defined by the product and records matches. Observe mode is the evidence-gathering step; Active is a separate choice after reviewing the sample and affected count.',
        ],
        steps: [
          {
            name: 'Enable the low-engagement preset in Observe',
            text: 'Observe records would-be matches. It does not move the messages it sees during this review window.',
          },
          {
            name: 'Wait for representative traffic',
            text: 'Seven days gives the preset a chance to see ordinary sender behavior. A quiet day is not enough evidence for automation.',
          },
          {
            name: 'Review names, counts, and exceptions',
            text: 'Inspect the dry-run sample. Mark important senders VIP or Protect when they should never be handled by cleanup automation.',
          },
          {
            name: 'Activate only if the sample is acceptable',
            text: 'The activation preview describes the first sweep. Active applies the preset to future matches; you can pause it later, but already delivered external unsubscribe requests remain one-way.',
          },
        ],
      },
      {
        id: 'manual-is-not-future',
        title: 'Do not mistake manual Archive for a standing rule',
        paragraphs: [
          'A manual Archive in Senders or Triage targets matching mail currently in the inbox. It removes the Inbox label and can be reversed through Activity while its undo token is valid. New mail from the sender may still arrive in Inbox.',
          'The same boundary applies to manual Later and Delete: they change current matched mail, not future delivery. Use Gmail filters or an explicitly activated Autopilot preset when future behavior is the goal.',
        ],
        callout: {
          title: 'Automation deserves a different standard',
          body: 'Reviewing one current batch is not consent to an indefinite future rule. Keep the rule, its scope, and its active state visible and independently reversible.',
          tone: 'truth',
        },
      },
      {
        id: 'monitor',
        title: 'Monitor outcomes instead of assuming the rule is finished',
        paragraphs: [
          'Open Activity periodically and sample Gmail’s All Mail or the label attached by your filter. A useful automation removes predictable attention cost without hiding exceptional mail.',
          'Pause first when results look wrong. Tighten the condition only after identifying why the false match occurred; otherwise the same mistake returns under a different threshold.',
        ],
      },
    ],
    sources: [
      {
        href: 'https://support.google.com/mail/answer/6579?hl=en',
        label: 'Google: Create rules to filter your emails',
        description: 'Official filter creation, testing, editing, and deletion steps.',
      },
    ],
    related: [
      {
        href: '/answers/how-undo-works-for-gmail-cleanup',
        label: 'Automation and undo',
        description: 'What can be reversed after a rule acts.',
      },
      {
        href: '/answers/best-way-to-clean-gmail-2026',
        label: 'Choose a cleanup method',
        description: 'Filters, searches, and sender-first review compared.',
      },
      {
        href: '/pricing',
        label: 'Autopilot plan details',
        description: 'See the current Pro capabilities.',
      },
    ],
  },

  'stop-promotional-emails-gmail': {
    slug: 'stop-promotional-emails-gmail',
    path: '/how-to/stop-promotional-emails-gmail',
    kind: 'How-to guide',
    eyebrow: 'Future delivery · sender by sender',
    title: 'How to stop promotional emails in Gmail',
    description:
      'Use unsubscribe, filters, or spam reporting for the right kind of promotional mail, with sender-level DeclutrMail guidance.',
    intro:
      'Promotional mail is not one category of risk. A legitimate newsletter, an unwanted store campaign, and deceptive spam require different actions. Start by identifying the sender and the outcome you actually want.',
    readingMinutes: 6,
    example: {
      label: 'Illustrative example — synthetic data',
      caption: 'Synthetic examples show why one “remove promotions” button would be misleading.',
      rows: [
        {
          sender: 'Neighborhood Theatre',
          detail: 'Wanted announcements · opened monthly',
          action: 'Keep',
          result: 'No cleanup; this sender still earns attention.',
        },
        {
          sender: 'Daily Deals Wire',
          detail: 'Legitimate list · no longer wanted',
          action: 'Unsubscribe',
          result: 'Requests that future delivery stop.',
        },
        {
          sender: 'Prize Claim Center',
          detail: 'Deceptive sender · no trusted relationship',
          action: 'Report spam',
          result: 'Use Gmail’s abuse controls instead of an unsubscribe link.',
        },
      ],
    },
    sections: [
      {
        id: 'classify-by-relationship',
        title: 'Classify by your relationship, not by Gmail’s tab',
        paragraphs: [
          'The Promotions tab is a presentation choice, not a verdict. It may contain a discount you want, a receipt-adjacent campaign from a store you trust, or a list you never knowingly joined. DeclutrMail does not use machine learning to assign semantic categories such as “shopping” or “banking.” It works from sender identity, message metadata, aggregate engagement, and your decisions.',
          'Ask whether the sender is legitimate, whether you want future mail, and whether current messages should remain searchable. Those questions map to different tools.',
        ],
      },
      {
        id: 'native-options',
        title: 'Use the correct Gmail control',
        paragraphs: ['Gmail exposes several controls that are often mistaken for one another.'],
        bullets: [
          'Unsubscribe asks a legitimate list sender to stop future delivery. It does not clean up old messages.',
          'Create filter can skip Inbox, add a label, mark as read, or delete future matches you define.',
          'Block sends future mail from an address to Spam; it does not notify or unsubscribe the sender.',
          'Report spam trains Gmail’s abuse handling and is preferable to clicking links in suspicious mail.',
          'Archive or Delete changes existing mail only unless you separately create a filter.',
        ],
      },
      {
        id: 'declutrmail-flow',
        title: 'Review promotional senders in DeclutrMail',
        paragraphs: [
          'DeclutrMail’s Senders view makes recurring sources visible without downloading full message bodies. It stores the sender, subject, Gmail preview snippet, dates, labels, read state, and aggregate facts needed for the product.',
          'A low read rate is evidence, not proof that mail is promotional or unwanted. Read recent subjects and protect any sender you are uncertain about before performing a bulk action.',
        ],
        steps: [
          {
            name: 'Sort for recurring volume',
            text: 'Start with sources that contribute repeatedly. Volume makes the potential benefit visible without deciding the outcome for you.',
          },
          {
            name: 'Check engagement and recent subjects',
            text: 'Replies and opens can reveal a sender that looks noisy but still matters. Open the actual message in Gmail when metadata is not enough.',
          },
          {
            name: 'Choose Unsubscribe for legitimate unwanted lists',
            text: 'The preview explains whether DeclutrMail can use a one-click endpoint or must prepare a mailto request for you to send manually.',
          },
          {
            name: 'Choose a separate current-mail action if needed',
            text: 'Existing mail stays put after unsubscribe unless you separately approve Archive or Delete. That secondary cleanup has its own scope and recovery behavior.',
          },
        ],
      },
      {
        id: 'unsubscribe-boundary',
        title: 'Treat unsubscribe as a one-way delivery request',
        paragraphs: [
          'For standards-compliant one-click lists, DeclutrMail sends the request and records whether the endpoint accepted it; the sender still controls whether and when mail stops. For mailto-only lists, it opens a prepared Gmail draft and you press Send. It never sends that email silently on your behalf.',
          'Once the unsubscribe request reaches the sender, DeclutrMail cannot recall it. A separately archived backlog may still have an Activity undo token, but that does not resubscribe you.',
        ],
        callout: {
          title: 'Suspicious sender? Do not unsubscribe',
          body: 'An unsubscribe link can confirm that an address is active. For deceptive or malicious mail, use Gmail’s Report spam or phishing controls instead.',
          tone: 'warning',
        },
      },
      {
        id: 'maintenance',
        title: 'Run a short maintenance pass each month',
        paragraphs: [
          'Review new high-volume senders, then revisit sources marked as unsubscribed but still mailing. A sender may take time to honor the request, use another address, or fail to comply.',
          'The durable goal is not to erase the Promotions tab. It is to make future delivery intentional and keep Gmail’s abuse tools reserved for actual abuse.',
        ],
      },
    ],
    sources: [
      {
        href: 'https://support.google.com/mail/answer/15433283?hl=en',
        label: 'Google: Unsubscribe from an email',
        description: 'Official promotional-email unsubscribe flow.',
      },
      {
        href: 'https://support.google.com/mail/answer/8151?hl=en',
        label: 'Google: Block an email address',
        description: 'Official distinction between blocking, Spam, and unsubscribe.',
      },
    ],
    related: [
      {
        href: '/how-to/unsubscribe-from-emails-gmail',
        label: 'Unsubscribe step by step',
        description: 'One-click, mailto, and manual boundaries.',
      },
      {
        href: '/how-to/clean-gmail-by-sender',
        label: 'Clean by sender',
        description: 'Turn recurring sources into a review queue.',
      },
      {
        href: '/answers/is-it-safe-to-connect-gmail-app',
        label: 'Connection safety',
        description: 'Questions to ask before granting Gmail access.',
      },
    ],
  },

  'unsubscribe-from-emails-gmail': {
    slug: 'unsubscribe-from-emails-gmail',
    path: '/how-to/unsubscribe-from-emails-gmail',
    kind: 'How-to guide',
    eyebrow: 'List email · delivery control',
    title: 'How to unsubscribe from emails in Gmail',
    description:
      'Unsubscribe safely in Gmail or DeclutrMail, with the difference between one-click, mailto, old-mail cleanup, and undo made explicit.',
    intro:
      'Unsubscribe controls future delivery. Archive, Later, and Delete control mail already in the mailbox. Combining those ideas without showing both scopes is how cleanup tools create surprises.',
    readingMinutes: 7,
    example: {
      label: 'Illustrative example — synthetic data',
      caption:
        'Synthetic delivery methods demonstrate the two unsubscribe paths DeclutrMail can expose.',
      rows: [
        {
          sender: 'Garden Weekly',
          detail: 'List-Unsubscribe-Post endpoint available',
          action: 'One-click',
          result: 'DeclutrMail can send the standards-based request.',
        },
        {
          sender: 'Community Bulletin',
          detail: 'Mailto unsubscribe address only',
          action: 'Open draft',
          result: 'You review and send the prepared email in Gmail.',
        },
      ],
    },
    sections: [
      {
        id: 'when-safe',
        title: 'Unsubscribe only from senders you recognize',
        paragraphs: [
          'A legitimate commercial list should provide an unsubscribe mechanism and honor it. Gmail may surface an Unsubscribe control near the sender name when the message exposes a supported list header. That route is generally safer than hunting for a tiny footer link.',
          'Do not use unsubscribe on phishing or obvious spam. Interacting can confirm that your address is active. Use Gmail’s Report spam or Report phishing controls for those messages.',
        ],
      },
      {
        id: 'gmail-method',
        title: 'Unsubscribe in Gmail',
        paragraphs: [
          'The exact UI varies by message and device, but the decision sequence stays the same.',
        ],
        steps: [
          {
            name: 'Open a recent message',
            text: 'Confirm the From address and the organization. A familiar display name alone is not enough.',
          },
          {
            name: 'Use Gmail’s Unsubscribe control when present',
            text: 'Gmail may show Unsubscribe beside the sender. Review the confirmation; Gmail either sends a supported request or takes you to the sender’s preference page.',
          },
          {
            name: 'Use a trusted preference link if needed',
            text: 'If Gmail has no control, use the sender’s footer only when the sender and destination are trustworthy. Never enter account credentials after following an unexpected mail link.',
          },
          {
            name: 'Wait before escalating',
            text: 'Legitimate senders may need several days to process the request. Report continued unwanted mail as spam if it persists beyond the stated period.',
          },
        ],
      },
      {
        id: 'declutrmail-method',
        title: 'Unsubscribe by sender in DeclutrMail',
        paragraphs: [
          'DeclutrMail reads allowlisted list-unsubscribe headers alongside message metadata. When a sender offers the RFC 8058 one-click method, DeclutrMail can submit the request. When it offers only a mailto address, DeclutrMail opens Gmail compose with the address and any supplied subject or body; you remain the person who sends it.',
          'The confirmation preview states that existing mail will not move. If you also choose to archive or delete old mail, that is a second action with a separately visible count.',
        ],
        steps: [
          {
            name: 'Review the sender facts',
            text: 'Check the full address, recent subjects, volume, and engagement. Open Gmail if the metadata leaves doubt.',
          },
          {
            name: 'Open the Unsubscribe preview',
            text: 'Confirm the future-delivery effect and whether an optional backlog action is selected.',
          },
          {
            name: 'Complete the correct delivery path',
            text: 'One-click requests are submitted through the standards endpoint. Mailto requests open a Gmail draft; DeclutrMail does not auto-send it.',
          },
          {
            name: 'Track the outcome',
            text: 'Activity distinguishes the recorded intent from a confirmed delivery outcome. Watch for later mail rather than assuming every sender complies instantly.',
          },
        ],
      },
      {
        id: 'undo',
        title: 'Understand why unsubscribe cannot be undone',
        paragraphs: [
          'A delivered unsubscribe request leaves DeclutrMail and reaches another organization. There is no universal protocol for retracting it, so the product does not issue an undo token for the request itself. You can subscribe again through the sender’s site if you later change your mind.',
          'If the same confirmation also archived existing mail, only that archive portion is reversible while its Activity token is active. Delete has Gmail Trash recovery. Those recovery mechanisms must not be presented as unsubscribe undo.',
        ],
        callout: {
          title: 'One confirmation may contain two effects',
          body: 'Read the preview line by line: future delivery and current-mail cleanup are separate. Approve only the secondary action you actually want.',
          tone: 'truth',
        },
      },
      {
        id: 'bulk',
        title: 'Use bulk unsubscribe as a review queue, not a blind sweep',
        paragraphs: [
          'Paid DeclutrMail plans support multi-sender cleanup. Each sender still has its own method and outcome: one-click requests queue separately, mailto requests stay in a visible Gmail-draft checklist until you send them, and senders without a published channel are excluded so Archive can be chosen instead.',
          'Start with a small batch of obvious lists. Verify outcomes before selecting hundreds. Bulk speed is useful only when per-sender failures and one-way effects remain visible.',
        ],
      },
    ],
    sources: [
      {
        href: 'https://support.google.com/mail/answer/15433283?hl=en',
        label: 'Google: Unsubscribe from an email',
        description: 'Official desktop unsubscribe steps and processing-time guidance.',
      },
      {
        href: 'https://support.google.com/mail/answer/15621070?hl=en',
        label: 'Google: Manage subscriptions in Gmail',
        description: 'Official sender-level subscription management behavior and rollout note.',
      },
    ],
    related: [
      {
        href: '/how-to/stop-promotional-emails-gmail',
        label: 'Promotions, spam, or filter?',
        description: 'Choose the right future-delivery control.',
      },
      {
        href: '/answers/how-undo-works-for-gmail-cleanup',
        label: 'Undo boundaries',
        description: 'Why recovery differs by action.',
      },
      {
        href: '/faq',
        label: 'DeclutrMail FAQ',
        description: 'Privacy and product answers in one place.',
      },
    ],
  },
};
