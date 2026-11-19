import { WS3_COPY } from '@declutrmail/shared/copy/launch';
import { UNIFORM_UNDO_WINDOW_DAYS } from '@declutrmail/shared/entitlements/undo-window';

import { comparisonBySlug } from '../comparison/comparison-data';
import { ANSWER_ARTICLES, type AnswerSlug } from './answer-content';
import type { LearnArticle, RelatedLink } from './types';

export const HOW_TO_SLUGS = [
  'clean-gmail-by-sender',
  'bulk-delete-emails-from-one-sender',
  'gmail-storage-full',
  'auto-archive-future-emails-in-gmail',
  'stop-promotional-emails-gmail',
  'unsubscribe-from-emails-gmail',
  'mass-delete-emails-gmail',
  'delete-all-promotions-emails-gmail',
  'delete-more-than-50-emails-gmail',
  'delete-old-emails-gmail-by-date',
  'delete-all-unread-emails-gmail',
  'clean-up-gmail-inbox',
  'where-do-archived-emails-go-gmail',
  'recover-deleted-emails-gmail',
] as const;

export type HowToSlug = (typeof HOW_TO_SLUGS)[number];

const HOW_TO_BODIES: Record<HowToSlug, Omit<LearnArticle, 'related'>> = {
  'clean-gmail-by-sender': {
    slug: 'clean-gmail-by-sender',
    path: '/how-to/clean-gmail-by-sender',
    publishedAt: '2026-07-14',
    updatedAt: '2026-11-18',
    kind: 'How-to guide',
    title: 'How to clean Gmail by sender',
    description:
      'A precise sender-first Gmail cleanup workflow, with native Gmail steps and a plain explanation of what DeclutrMail changes.',
    intro:
      'An inbox may contain 20,000 emails but only a few dozen recurring senders. Grouping by sender turns an endless email list into a smaller set of decisions you can reason about.',
    readingMinutes: 7,
    example: {
      label: 'Made-up example',
      caption:
        'These names and counts are invented to demonstrate the decision model. They are not a screenshot or a claim about your inbox.',
      rows: [
        {
          sender: 'Weekly Market Note',
          detail: '38 inbox messages · 3% read',
          action: 'Archive',
          result: 'Current inbox email moves to All Mail.',
        },
        {
          sender: 'Project Digest',
          detail: '12 inbox messages · marked read often',
          action: 'Later',
          result: 'Current email moves to DeclutrMail/Later.',
        },
        {
          sender: 'Coupon Parade',
          detail: '61 messages · no recent engagement',
          action: 'Unsubscribe',
          result:
            'An opt-out request is submitted or a draft prepared; the sender controls delivery.',
        },
      ],
    },
    sections: [
      {
        id: 'why-sender-first',
        title: 'Start with the source, not the unread count',
        paragraphs: [
          'Unread counts measure accumulation. They do not tell you which decision will prevent the next hundred messages. A sender-first pass asks a more durable question: do I still want email from this source, and what should happen to the email already here?',
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
            name: 'Choose which email to change',
            text: 'Select the visible page, or click the link in Gmail’s notification that selects all conversations, only after checking the query. The second option can affect years of email.',
          },
          {
            name: 'Apply one clear outcome',
            text: 'Archive removes Inbox, Delete moves email to Trash, and a label organizes it. If you want future behavior, create a Gmail filter separately; a one-time archive is not a future rule.',
          },
        ],
      },
      {
        id: 'declutrmail-workflow',
        title: 'What DeclutrMail changes about the workflow',
        paragraphs: [
          'DeclutrMail stores the sender, subject line, Gmail preview snippet, dates, labels, and read state, then shows useful totals such as volume and read rate. Full email contents and attachments are never fetched. You still open Gmail when you need to read a message.',
          'Open a sender in Clean up to inspect recent subjects, volume, read rate, and decision history. Gmail remains the place to read the full message. Select several senders for a bulk pass only after checking each source. The pricing page lists the current plan limits.',
        ],
        steps: [
          {
            name: WS3_COPY['ws3.liveFix.learn.firstScanStep'],
            text: 'DeclutrMail needs the first Gmail scan to finish before it can show reliable volume and read-rate information. It remains a companion to Gmail, not a second inbox.',
          },
          {
            name: 'Review the noisiest sender',
            text: 'Use the sender inspector to review volume, read rate, whether you write back, recent subjects, and past decisions. Open a message in Gmail when a subject or preview snippet is not enough. Recommendations are guidance; the decision remains yours.',
          },
          {
            name: 'Preview the email-moving action',
            text: WS3_COPY['ws3.howTo.preview.reach'],
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
          'Archive removes the Inbox label from the matching email that exists now. Later removes Inbox and adds DeclutrMail/Later to that current email. Delete moves current matching email to Gmail Trash. None of those manual actions creates a standing rule for future messages.',
          WS3_COPY['ws3.pr1019.howTo.unsubscribe'],
        ],
        callout: {
          title: 'Each action has its own Undo rules',
          // The parenthetical is deleted, not reworded, when the ladder
          // is uniform: there is no plan-dependency left to describe. A
          // divergent ladder restores it, because it would then be true.
          body:
            `Archive, Later, and Delete can be reversed from Activity ${UNIFORM_UNDO_WINDOW_DAYS === null ? 'while their undo window is open' : `within the ${UNIFORM_UNDO_WINDOW_DAYS}-day window on every plan`}` +
            (UNIFORM_UNDO_WINDOW_DAYS === null ? ' (its length depends on your plan)' : '') +
            '. Delete also has separate Gmail Trash recovery for up to about 30 days unless Trash is emptied sooner. Once an unsubscribe request is delivered, that request is one-way.',
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
  },

  'bulk-delete-emails-from-one-sender': {
    slug: 'bulk-delete-emails-from-one-sender',
    path: '/how-to/bulk-delete-emails-from-one-sender',
    publishedAt: '2026-07-14',
    updatedAt: '2026-11-18',
    kind: 'How-to guide',
    title: 'Delete all emails from one sender in Gmail',
    quickAnswer:
      'In Gmail on the web, search from:(sender@example.com), check a few results, check the Select box, then click the link in the notification that selects all conversations before clicking Delete. Email moves to Trash; emptying Trash ends recovery. This does not unsubscribe you or delete future email.',
    description:
      'Delete all emails from one sender in Gmail using a verified search, with clear Trash and future-mail boundaries.',
    intro:
      'Before bulk deletion, make the search precise and understand its effect. Gmail moves deleted messages to Trash; it does not unsubscribe you or stop the sender from writing again.',
    readingMinutes: 6,
    example: {
      label: 'Made-up example',
      caption:
        'A made-up sender shows the difference between changing existing email and stopping future delivery.',
      rows: [
        {
          sender: 'Sale Signal',
          detail: 'from:offers@salesignal.example · 84 current messages',
          action: 'Delete',
          result: '84 move to Gmail Trash; future email can still arrive.',
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
          body: 'Deleting current email changes only the messages matched now. It does not contact the sender, create a filter, or stop future delivery.',
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
            name: 'Select the intended email',
            text: 'Check the Select box to select the current page. Gmail then shows a notification with a link that selects all conversations; use it only when the query and count match your intention.',
          },
          {
            name: 'Move to Trash and verify',
            text: 'Click Delete, then open Trash and confirm a few messages. If the selection was wrong, check those messages in Trash, click Move to, and choose Inbox. Gmail keeps deleted messages in Trash for up to 30 days.',
          },
        ],
      },
      {
        id: 'declutrmail-steps',
        title: 'Delete by sender in DeclutrMail',
        paragraphs: [
          'DeclutrMail groups the saved Gmail details by sender. Delete is an explicit action with a confirmation preview because its recovery model differs from Archive and Later.',
          `${WS3_COPY['ws3.liveFix.learn.deletePreview']} The action moves matching email to Gmail Trash and removes it from Inbox. It does not install a future sender rule.`,
        ],
        steps: [
          {
            name: 'Open the sender',
            text: 'Open the sender inspector in Clean up, then review recent subjects, current inbox count, and past decisions. Open Gmail for the full message when needed.',
          },
          {
            name: 'Choose Delete for this sender',
            text: 'Delete is not promoted as a recommendation. It remains an explicit decision separate from Archive, Later, Keep, and Unsubscribe.',
          },
          {
            name: 'Read the preview',
            text: WS3_COPY['ws3.howTo.preview.checklist'],
          },
          {
            name: 'Confirm and inspect Activity',
            text: 'Wait for server confirmation. Activity records the action; Gmail remains the final place to verify or restore trashed messages.',
          },
        ],
      },
      {
        id: 'future-mail',
        title: 'Decide what should happen to future email separately',
        paragraphs: [
          'If the sender is legitimate but no longer wanted, use Unsubscribe after reading its preview. If it lacks a usable unsubscribe method, a Gmail filter can route future email to Trash or skip Inbox. Blocking the sender routes future email to Spam; that is a different outcome again.',
          'Keeping cleanup and future routing as two explicit decisions prevents a one-time housekeeping action from silently becoming permanent automation.',
        ],
      },
      {
        id: 'safer-alternatives',
        title: 'Use a less destructive option when uncertain',
        paragraphs: [
          'Archive preserves email in All Mail and Gmail search. Later keeps it under a DeclutrMail/Later label. Both are better first moves when the sender mixes useful and noisy messages, and both can be undone from Activity while their undo window is open.',
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
  },

  'gmail-storage-full': {
    slug: 'gmail-storage-full',
    path: '/how-to/gmail-storage-full',
    publishedAt: '2026-08-13',
    updatedAt: '2026-10-13',
    kind: 'How-to guide',
    title: 'Gmail storage full? How to free up space',
    quickAnswer:
      'Check which of Gmail, Drive, or Photos is using your shared storage. In Gmail, review Spam and Trash, then search has:attachment larger:10M for large email you can delete. Trash still uses storage until emptied, and emptying it ends recovery. Archiving and unsubscribing do not free existing storage.',
    description:
      'Free space when Gmail storage is full: empty Trash and Spam, find large attachments with Gmail’s size operators, and see why archiving frees nothing.',
    intro:
      'A full Gmail is usually not a Gmail problem. Google gives each personal account up to 15 GB shared across Gmail, Drive, and Photos, so the email is competing with backups and photo libraries for the same quota. That also means most cleanup advice aimed at tidiness — archive, unsubscribe, inbox zero — recovers no space at all.',
    readingMinutes: 8,
    example: {
      label: 'Made-up example',
      caption:
        'Invented senders showing which decisions return storage and which only tidy the inbox. Not a screenshot and not a claim about your mailbox.',
      rows: [
        {
          sender: 'Statement Delivery',
          detail: '212 messages · PDF attachments around 2 MB each',
          action: 'Delete',
          result: 'Space returns only after Gmail Trash is emptied.',
        },
        {
          sender: 'Render Farm Reports',
          detail: '14 messages matching has:attachment larger:10M',
          action: 'Delete',
          result: 'A handful of messages can outweigh thousands of text ones.',
        },
        {
          sender: 'Photo Share Digest',
          detail: 'Large inline images · rarely marked read',
          action: 'Archive',
          result: 'Leaves the inbox and frees no storage whatsoever.',
        },
      ],
    },
    sections: [
      {
        id: 'what-full-means',
        title: 'What “full” actually refers to',
        paragraphs: [
          'Google documents a single quota of up to 15 GB per personal account, shared between Gmail, Google Drive, and Google Photos. Gmail messages and their attachments count toward it, and Google states explicitly that Spam and Trash count too until those folders are cleared.',
          'Consequences arrive across every service, not just email. Google says that when you are over quota you cannot upload files to Drive or back up photos, your ability to send and receive email can be impacted, and Drive Help adds that messages sent to you go back to the sender. Google also warns that content in an account left over quota for two years may be deleted, with at least three months of notice first.',
        ],
        bullets: [
          'Check where the space actually went before deleting email: Drive and Photos share the same 15 GB.',
          'Emptying Spam and Trash is the fastest recovery Google documents, because both still occupy quota.',
          'Expect a delay — Google says storage can take 48–72 hours to reflect a large deletion.',
        ],
      },
      {
        id: 'native-steps',
        title: 'The native Google method, in the order that pays off',
        paragraphs: [
          'Work biggest-first. A few dozen attachment-heavy messages usually free more space than thousands of ordinary ones, and Gmail’s search operators can name them exactly.',
        ],
        steps: [
          {
            name: 'Empty Spam, then Trash',
            text: 'Google calls this the quickest way to recover space. Both folders count against the quota until you permanently clear them, and clearing them is not reversible.',
          },
          {
            name: 'Find the heavy email with size operators',
            text: 'Search has:attachment larger:10M for the worst offenders, filename:.pdf larger:5M for document build-up, and older_than:2y has:attachment for stale attachments. Add in:anywhere to include Spam and Trash.',
          },
          {
            name: 'Verify before you select everything',
            text: 'Open a few results. Attachment-heavy senders often mix statements and receipts you may want to keep, and Gmail’s select-all applies to every conversation matching the query.',
          },
          {
            name: 'Delete, then empty Trash again',
            text: 'Deleting moves email to Trash, which still counts against your quota. The space is only released when Trash is emptied or Gmail’s roughly 30-day retention expires.',
          },
          {
            name: 'Check Drive and Photos, not just Gmail',
            text: 'In Drive, the Storage view lists your files largest-first. Google’s storage manager also cleans up by service — note that items it deletes from Gmail and Drive are permanently deleted and cannot be recovered.',
          },
        ],
      },
      {
        id: 'archive-frees-nothing',
        title: 'Archive, unsubscribe, and inbox zero free no space',
        paragraphs: [
          'Archiving removes the Inbox label. The message, and every byte of its attachments, stays in All Mail and stays on your quota. The same is true of labels, filters that skip the inbox, and any tool that promises a cleaner inbox without deleting anything.',
          'Unsubscribing is worth doing, but it is a future-volume decision, not a storage one: it asks the sender to stop future delivery and removes nothing that has already landed. The sender controls whether and when delivery stops. If the goal is a working mailbox today, deletion of large email plus an emptied Trash is the only lever that moves the number.',
        ],
        callout: {
          title: 'Only permanent deletion returns bytes',
          body: 'Archive keeps the message. Delete moves it to Trash, which still counts. Space comes back when Trash is emptied or its retention window expires — and then only after Google’s systems catch up, which can take up to 48–72 hours.',
          tone: 'truth',
        },
      },
      {
        id: 'by-sender',
        title: 'Attack it by sender when a few sources own the weight',
        paragraphs: [
          'Attachment volume is rarely spread evenly. Statements, scanned documents, automated reports, and image-heavy newsletters tend to concentrate in a handful of recurring senders, which makes the sender the efficient unit of work. In Gmail you can combine the two ideas directly: from:(reports@example.com) has:attachment larger:5M.',
          'DeclutrMail ranks recurring senders by volume and shows the size of each message in a sender’s recent-messages list, so you can see which sources are heavy before acting. Two limits are worth stating plainly: it does not compute a storage total per sender or report space reclaimed, and its Delete moves matching email to Gmail Trash — you still empty Trash in Gmail to get the space back.',
        ],
        steps: [
          {
            name: 'Start with the senders that repeat',
            text: 'High-volume senders with routine attachments are the best candidates. One decision covers hundreds of messages.',
          },
          {
            name: 'Read the per-message sizes',
            text: 'A sender’s recent messages show individual sizes where Gmail reports them. Use that as evidence for which senders deserve deletion rather than an archive.',
          },
          {
            name: 'Preview the Delete, then confirm',
            text: 'The preview names the sender and the count that will move to Trash. Confirm that nothing in the set is a document you would need to retrieve later.',
          },
          {
            name: 'Empty Gmail Trash to realize the space',
            text: 'This step happens in Gmail, not in DeclutrMail. Until Trash is cleared, the quota reads the same as before.',
          },
        ],
      },
      {
        id: 'prune-or-pay',
        title: 'Decide between pruning and paying',
        paragraphs: [
          'If a mailbox is mostly years of attachments you genuinely may need, extra storage through Google One is the cheaper answer than an afternoon of risky bulk deletion. Pruning wins when the weight is concentrated in email you can name and would never open again — old reports, expired offers, superseded drafts.',
          'A useful test: run has:attachment larger:10M and older_than:2y has:attachment, and look at what comes back. If the results are mostly things you would delete without hesitation, prune. If you hesitate on most of them, buy the storage and spend the effort on future volume instead.',
        ],
      },
      {
        id: 'keep-it-down',
        title: 'Keep the number down after the first pass',
        paragraphs: [
          'Set a quarterly habit rather than a one-off purge: search larger:10M older_than:1y, delete what has expired, and empty Trash. Storage creep is driven by a small set of automated senders, so the same review usually finds the same names.',
          'Then handle future volume separately with unsubscribes, Gmail filters, or an Autopilot preset. Those keep the inbox from refilling; they will not shrink what is already stored, and any tool that implies otherwise is describing tidiness, not bytes.',
        ],
      },
    ],
    sources: [
      {
        href: 'https://support.google.com/googleone/answer/9312312?hl=en',
        label: 'Google: How your Google storage works',
        description:
          'Official 15 GB shared quota, what counts (including Spam and Trash), over-quota effects, and the two-year deletion policy.',
      },
      {
        href: 'https://support.google.com/drive/answer/6374270?hl=en',
        label: 'Google: Manage your storage in Drive, Gmail & Photos',
        description:
          'Official short-term fix (empty Trash and Spam), large-file search recipes, and the 48–72 hour update delay.',
      },
      {
        href: 'https://support.google.com/mail/answer/7190?hl=en',
        label: 'Google: Refine searches in Gmail',
        description:
          'Official reference for larger:, size:, has:attachment, filename:, and in:anywhere.',
      },
      {
        href: 'https://support.google.com/mail/answer/7401?hl=en',
        label: 'Google: Delete or recover deleted Gmail messages',
        description: 'Official Trash behavior, the roughly 30-day window, and permanent deletion.',
      },
    ],
  },

  'auto-archive-future-emails-in-gmail': {
    slug: 'auto-archive-future-emails-in-gmail',
    path: '/how-to/auto-archive-future-emails-in-gmail',
    publishedAt: '2026-07-14',
    updatedAt: '2026-10-03',
    kind: 'How-to guide',
    title: 'How to auto archive emails in Gmail',
    description:
      'Archive Gmail automatically with a Skip Inbox filter or DeclutrMail’s observed low-engagement preset, without confusing one-time Archive with a future rule.',
    intro:
      'A one-time Archive removes Inbox from email that already exists. Future auto-archive requires a separate filter or automation rule. Keeping that distinction visible is the safest way to avoid email disappearing unexpectedly.',
    readingMinutes: 7,
    example: {
      label: 'Made-up example',
      caption:
        'Made-up rule matches show how the low-engagement preset waits for your review before moving email.',
      rows: [
        {
          sender: 'Product Roundup',
          detail: 'Observed match · low engagement · 9 messages',
          action: 'Would archive',
          result: 'Nothing moves while the preset remains in Watch first.',
        },
        {
          sender: 'Billing Alerts',
          detail: 'Marked read regularly · excluded by the observed pattern',
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
          'DeclutrMail’s launch automation uses presets instead of a custom rule builder. Its low-engagement Archive preset uses sender volume and Gmail marked-read flags, not proof of reading. On Plus and Pro, preview the sample and affected count, then turn it on to collect suggestions. You approve each match before mail moves.',
        ],
      },
      {
        id: 'gmail-filter',
        title: 'Create a native Gmail auto-archive filter',
        paragraphs: [
          'Use an exact query and test it against existing email before saving the future rule.',
        ],
        steps: [
          {
            name: 'Build and test the search',
            text: 'Search for from:(updates@example.com), a stable subject, or another narrow condition. Read several results and verify the query excludes wanted email.',
          },
          {
            name: 'Open filter creation',
            text: 'Use Gmail’s advanced-search controls and choose Create filter. Gmail shows the same criteria before you select an action.',
          },
          {
            name: 'Select Skip the Inbox',
            text: 'Choose “Skip the Inbox (Archive it).” Applying a label as well makes the routed email easy to find. Avoid Delete unless the condition is exceptionally stable.',
          },
          {
            name: 'Decide whether existing email is included',
            text: 'Gmail offers a separate option to apply the filter to matching conversations that already exist. Leave it off if your goal is future email only.',
          },
          {
            name: 'Review the filter later',
            text: 'Return to Gmail Settings → Filters and Blocked Addresses after a few days. Edit or remove the filter if legitimate email is being routed away.',
          },
        ],
      },
      {
        id: 'declutrmail-autopilot',
        title: 'Use DeclutrMail Autopilot without blind activation',
        paragraphs: [
          'Autopilot ships five presets on Plus and Pro, and you can add your own Archive rules for chosen senders. Any Archive rule can watch first, collecting matches for you to review, or run automatically once you turn that on.',
          'You approve or dismiss collected matches yourself. Switching a rule to run automatically requires a preview and a deliberate choice; no rule promotes itself.',
        ],
        steps: [
          {
            name: 'Turn on review',
            text: 'Review the activation preview, then turn on the low-engagement Archive preset with Watch first. It records possible matches without moving email until you approve them.',
          },
          {
            name: 'Wait for representative traffic',
            text: 'Let the preset collect representative traffic, then review the senders and current Inbox counts before deciding.',
          },
          {
            name: 'Review names, counts, and exceptions',
            text: 'Inspect the collected suggestions. Mark important senders Protected so they stay out of bulk and automatic cleanup.',
          },
          {
            name: 'Approve individual matches',
            text: 'Approve only the senders whose Inbox mail you want archived. Once the matches look right, you can let the rule run automatically, and pause it any time. Archived mail remains in Gmail All Mail.',
          },
        ],
      },
      {
        id: 'manual-is-not-future',
        title: 'Do not mistake manual Archive for a standing rule',
        paragraphs: [
          'A manual Archive in Clean up targets matching email currently in the inbox. It removes the Inbox label and can be reversed through Activity while its undo window is open. New email from the sender may still arrive in Inbox.',
          'The same boundary applies to manual Later and Delete: they change current matched email, not future delivery. Use Gmail filters or an explicitly activated Autopilot preset when future behavior is the goal.',
        ],
        callout: {
          title: 'Automation deserves a different standard',
          body: 'Reviewing one current batch is not consent to an indefinite future rule. Keep the rule, what it matches, and whether it is active visible and independently reversible.',
          tone: 'truth',
        },
      },
      {
        id: 'monitor',
        title: 'Monitor outcomes instead of assuming the rule is finished',
        paragraphs: [
          'Open Activity periodically and sample Gmail’s All Mail or the label attached by your filter. A useful automation removes predictable attention cost without hiding exceptional email.',
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
  },

  'stop-promotional-emails-gmail': {
    slug: 'stop-promotional-emails-gmail',
    path: '/how-to/stop-promotional-emails-gmail',
    publishedAt: '2026-07-14',
    updatedAt: '2026-07-28',
    kind: 'How-to guide',
    title: 'How to stop promotional emails in Gmail',
    description:
      'Use unsubscribe, filters, or spam reporting for the right kind of promotional email, with guidance organized by sender.',
    intro:
      'Promotional email is not one category of risk. A legitimate newsletter, an unwanted store campaign, and deceptive spam require different actions. Start by identifying the sender and the outcome you actually want.',
    readingMinutes: 6,
    example: {
      label: 'Made-up example',
      caption: 'Made-up examples show why one “remove promotions” button would be misleading.',
      rows: [
        {
          sender: 'Neighborhood Theatre',
          detail: 'Wanted announcements · marked read monthly',
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
          'The Promotions tab is only Gmail’s way of organizing your inbox. It may contain a discount you want, a campaign from a store you trust, or a list you never knowingly joined. DeclutrMail does not use machine learning to assign categories such as “shopping” or “banking.” It uses sender identity, listed email details, volume, read rate, and your decisions.',
          'Ask whether the sender is legitimate, whether you want future email, and whether current messages should remain searchable. Those questions map to different tools.',
        ],
      },
      {
        id: 'native-options',
        title: 'Use the correct Gmail control',
        paragraphs: ['Gmail exposes several controls that are often mistaken for one another.'],
        bullets: [
          'Unsubscribe asks a legitimate list sender to stop future delivery. It does not clean up old messages.',
          'Create filter can skip Inbox, add a label, mark as read, or delete future matches you define.',
          'Block sends future email from an address to Spam; it does not notify or unsubscribe the sender.',
          'Report spam trains Gmail’s abuse handling and is preferable to clicking links in suspicious email.',
          'Archive or Delete changes existing email only unless you separately create a filter.',
        ],
      },
      {
        id: 'declutrmail-flow',
        title: 'Review promotional senders in DeclutrMail',
        paragraphs: [
          'DeclutrMail’s Senders view makes recurring senders visible without downloading full email contents. It stores the sender, subject line, Gmail preview snippet, dates, labels, read state, volume, and read rate.',
          'A low read rate is evidence, not proof that email is promotional or unwanted. Read recent subjects and protect any sender you are uncertain about before performing a bulk action.',
        ],
        steps: [
          {
            name: 'Sort for recurring volume',
            text: 'Start with sources that contribute repeatedly. Volume makes the potential benefit visible without deciding the outcome for you.',
          },
          {
            name: 'Check engagement and recent subjects',
            text: 'Whether you write back, and read state, can reveal a sender that looks noisy but still matters. Open the email in Gmail when the listed details are not enough.',
          },
          {
            name: 'Choose Unsubscribe for legitimate unwanted lists',
            text: 'The preview explains whether DeclutrMail can use the sender’s one-click unsubscribe link or must prepare an email request for you to send manually.',
          },
          {
            name: 'Choose a separate current-mail action if needed',
            text: 'Existing email stays put after unsubscribe unless you separately approve Archive or Delete. That second action shows its own affected count and recovery options.',
          },
        ],
      },
      {
        id: 'unsubscribe-boundary',
        title: 'Treat unsubscribe as a one-way delivery request',
        paragraphs: [
          'For standards-compliant one-click lists, DeclutrMail sends the request and records whether the sender’s system accepted it; the sender still controls whether and when email stops. For mailto-only lists, it opens a prepared Gmail draft and you press Send. It never sends that email silently on your behalf.',
          'Once the unsubscribe request reaches the sender, DeclutrMail cannot recall it. A separately archived backlog may still be undoable from Activity, but that does not resubscribe you.',
        ],
        callout: {
          title: 'Suspicious sender? Do not unsubscribe',
          body: 'An unsubscribe link can confirm that an address is active. For deceptive or malicious email, use Gmail’s Report spam or phishing controls instead.',
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
  },

  'unsubscribe-from-emails-gmail': {
    slug: 'unsubscribe-from-emails-gmail',
    path: '/how-to/unsubscribe-from-emails-gmail',
    publishedAt: '2026-07-14',
    updatedAt: '2026-11-18',
    kind: 'How-to guide',
    title: 'How to unsubscribe from emails in Gmail',
    description:
      'Unsubscribe safely in Gmail or DeclutrMail, with the difference between one-click, mailto, old-mail cleanup, and undo made explicit.',
    intro:
      'Unsubscribe controls future delivery. Archive, Later, and Delete control email already in the mailbox. Combining those ideas without showing both scopes is how cleanup tools create surprises.',
    readingMinutes: 7,
    example: {
      label: 'Made-up example',
      caption:
        'Made-up delivery methods demonstrate the two unsubscribe options DeclutrMail can show.',
      rows: [
        {
          sender: 'Garden Weekly',
          detail: 'Supports one-click unsubscribe',
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
            text: 'If Gmail has no control, use the sender’s footer only when the sender and destination are trustworthy. Never enter account credentials after following an unexpected email link.',
          },
          {
            name: 'Wait before escalating',
            text: 'Legitimate senders may need several days to process the request. Report continued unwanted email as spam if it persists beyond the stated period.',
          },
        ],
      },
      {
        id: 'declutrmail-method',
        title: 'Unsubscribe by sender in DeclutrMail',
        paragraphs: [
          'DeclutrMail reads the sender’s unsubscribe information along with the other listed Gmail details. When a sender offers the standard one-click method, DeclutrMail can submit the request. When it offers only an email address, DeclutrMail opens a Gmail draft with the supplied address and text; you remain the person who sends it.',
          WS3_COPY['ws3.howTo.unsubscribe.olderEmail'],
        ],
        steps: [
          {
            name: 'Review the sender facts',
            text: 'Check the full address, recent subjects, volume, and read rate. Open Gmail if those details leave doubt.',
          },
          {
            name: 'Open the Unsubscribe preview',
            text: 'Check whether it sends a request or opens a prefilled email in Gmail, and whether Archive or Delete for older email is selected. The sender decides whether and when their email stops.',
          },
          {
            name: 'Complete the correct delivery path',
            text: 'One-click requests are sent through the sender’s standard unsubscribe link. Mailto requests open a Gmail draft; DeclutrMail does not auto-send it.',
          },
          {
            name: 'Track the outcome',
            text: 'Activity distinguishes the recorded intent from a confirmed delivery outcome. Watch for later email rather than assuming every sender complies instantly.',
          },
        ],
      },
      {
        id: 'undo',
        title: 'Understand why unsubscribe cannot be undone',
        paragraphs: [
          'A delivered unsubscribe request leaves DeclutrMail and reaches another organization. There is no universal protocol for retracting it, so the request itself has no undo window. You can subscribe again through the sender’s site if you later change your mind.',
          'A separate Archive or Delete has its own Activity Undo until the deadline shown there. Delete also has Gmail Trash recovery. Neither reverses the sent unsubscribe request.',
        ],
        callout: {
          title: 'One confirmation may contain two effects',
          body: 'Read the preview line by line: future delivery and current-mail cleanup are separate. Approve only the secondary action you actually want.',
          tone: 'truth',
        },
      },
      {
        id: 'bulk',
        title: 'Mass unsubscribe in Gmail: a review queue, not a blind sweep',
        paragraphs: [
          'Multi-sender cleanup works on every plan. Each sender still has its own method and outcome: one-click requests queue separately, mailto requests stay in a visible Gmail-draft checklist until you send them, and senders without a published channel are excluded so Archive can be chosen instead.',
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
        description: 'Official subscription management behavior by sender and rollout note.',
      },
    ],
  },

  'mass-delete-emails-gmail': {
    slug: 'mass-delete-emails-gmail',
    path: '/how-to/mass-delete-emails-gmail',
    publishedAt: '2026-11-18',
    updatedAt: '2026-11-18',
    kind: 'How-to guide',
    title: 'How to mass delete emails in Gmail',
    quickAnswer:
      'On a computer, open Gmail and choose a view on the left or enter a search. Check the Select box above your messages, click the link in the notification to select every conversation, then click Delete. Deleted email stays in Trash for up to 30 days. This does not unsubscribe you or stop future email.',
    description:
      'Mass delete emails in Gmail: select a whole view or search with the select-all link, narrow it first with search operators, and recover from Trash.',
    intro:
      'Gmail can delete a whole view or a whole search in one pass. The selection takes two clicks, so the real work is deciding which email belongs in the set before you make it.',
    readingMinutes: 6,
    example: {
      label: 'Made-up example',
      caption:
        'Invented senders and counts showing one decision per sender. Not a screenshot and not a claim about your inbox.',
      rows: [
        {
          sender: 'Flash Sale Daily',
          detail: '412 inbox messages · 1% marked read',
          action: 'Delete',
          result: '412 move to Gmail Trash; future email can still arrive.',
        },
        {
          sender: 'Forum Digest',
          detail: '230 inbox messages · 4% marked read',
          action: 'Archive',
          result: 'Leaves the inbox and stays searchable in All Mail.',
        },
        {
          sender: 'Bank Statements',
          detail: '36 inbox messages · marked read often',
          action: 'Keep',
          result: 'Nothing moves.',
        },
      ],
    },
    sections: [
      {
        id: 'what-mass-delete-changes',
        title: 'What a mass delete changes',
        paragraphs: [
          'Deleting in Gmail moves messages to Trash. Google says a message stays there for up to 30 days, during which you can move it back, and is permanently deleted after that. Emptying Trash yourself ends recovery sooner.',
          'A delete changes only the email matched now. It does not contact the sender, create a filter, or stop future delivery. If you only want a clear inbox, archiving the same selection keeps the email under All Mail.',
        ],
        callout: {
          title: 'Select all means all',
          body: 'The select-all link covers every conversation in the view or search, including ones you have not scrolled to. Narrow the set until you would delete every result in it.',
          tone: 'warning',
        },
      },
      {
        id: 'gmail-steps',
        title: 'Mass delete in Gmail',
        paragraphs: ['Google documents these steps for Gmail on a computer.'],
        steps: [
          {
            name: 'Choose what to delete from',
            text: 'On the left, select a view such as Inbox, Promotions, or All Mail. To delete specific email instead, enter a search operator in the search bar.',
          },
          {
            name: 'Select the current page',
            text: 'Above your messages, at the top left, check the Select box. This selects the messages on the current page only.',
          },
          {
            name: 'Select every conversation',
            text: 'A notification above your messages shows how many conversations are selected on the page and links to the rest. Click the link in that notification to select all conversations.',
          },
          {
            name: 'Delete and check Trash',
            text: 'At the top, click Delete. Then open Trash and look through a few messages to confirm the set was the one you intended.',
          },
        ],
      },
      {
        id: 'narrow-with-search',
        title: 'Narrow the set with search first',
        paragraphs: [
          'A search turns “everything” into a set you can read. Gmail’s operators can be combined, and the minus sign excludes a condition.',
        ],
        bullets: [
          'from:amy@example.com finds email from one address.',
          'category:promotions finds email under an inbox category, if you use categories.',
          'is:unread finds email by read status.',
          'older_than:1y finds email older than a period, using d, m, or y.',
          'before:2020/01/01 finds email received before a date.',
          'has:attachment and larger:10M find email by attachment and size.',
        ],
        callout: {
          title: 'Exclusions work on messages, not conversations',
          body: 'Google notes that with a negative operator such as -is:starred, a whole conversation can still appear if any one message in it matches. Read the results before selecting them all.',
          tone: 'info',
        },
      },
      {
        id: 'by-sender',
        title: 'When the pile comes from a few senders',
        paragraphs: [
          'Search needs you to know what to type. If the clutter is recurring senders you cannot name from memory, DeclutrMail groups the saved Gmail details by sender and lists each sender with its volume and read rate.',
          'Delete there is a decision per sender with a preview. It moves the matching email to Gmail Trash and does not create a rule for future email.',
        ],
        steps: [
          {
            name: WS3_COPY['ws3.liveFix.learn.firstScanStep'],
            text: 'Senders appear with their volume and read rate once the first Gmail scan finishes.',
          },
          {
            name: 'Check a sender before deciding',
            text: 'Open the sender in Clean up and read its recent subjects. Open Gmail when a subject line is not enough.',
          },
          {
            name: 'Read the preview',
            text: WS3_COPY['ws3.howTo.preview.checklist'],
          },
          {
            name: 'Confirm, then look at Activity',
            text: 'Activity records what moved. Archive, Later, and Delete can be undone from there while their undo window is open.',
          },
        ],
      },
      {
        id: 'after-the-delete',
        title: 'Recover a mistake, then deal with future email',
        paragraphs: [
          'To recover, open Trash, check the box beside each message, click Move to, and choose where it should go. Trash also offers Delete forever and Empty Trash now; both are permanent.',
          'Future email is a separate decision. Unsubscribe from lists you no longer want, or create a Gmail filter for a sender that offers no way to unsubscribe.',
        ],
      },
    ],
    sources: [
      {
        href: 'https://support.google.com/mail/answer/7401?hl=en',
        label: 'Google: Delete messages in Gmail',
        description:
          'Official select-all steps, the notification link, Trash retention, and recovery.',
      },
      {
        href: 'https://support.google.com/mail/answer/7190?hl=en',
        label: 'Google: Refine searches in Gmail',
        description:
          'Official reference for from:, category:, is:unread, older_than:, before:, and the minus operator.',
      },
      {
        href: 'https://support.google.com/mail/answer/9259770?hl=en',
        label: 'Google: Organize and archive email',
        description: 'Official Archive and All Mail behavior.',
      },
    ],
  },

  'delete-all-promotions-emails-gmail': {
    slug: 'delete-all-promotions-emails-gmail',
    path: '/how-to/delete-all-promotions-emails-gmail',
    publishedAt: '2026-11-18',
    updatedAt: '2026-11-18',
    kind: 'How-to guide',
    title: 'How to delete all Promotions emails in Gmail',
    quickAnswer:
      'On a computer, select Promotions on the left in Gmail, check the Select box, click the link in the notification to select all conversations in Promotions, then click Delete. To add a date or sender condition, search category:promotions instead. Deleted email stays in Trash for up to 30 days.',
    description:
      'Delete all Promotions emails in Gmail at once from the Promotions tab or a category:promotions search, with what Trash keeps and what refills the tab.',
    intro:
      'Promotions is a category Gmail assigns, so Gmail is the tool that can select all of it. Deleting the tab takes a minute. Keeping it from refilling is a separate job, done sender by sender.',
    readingMinutes: 6,
    example: {
      label: 'Made-up example',
      caption:
        'Invented senders showing why the Promotions tab is worth sampling before deleting all of it.',
      rows: [
        {
          sender: 'Daily Deals Wire',
          detail: 'Legitimate list · no longer wanted',
          action: 'Unsubscribe',
          result: 'Asks the sender to stop; older email stays unless you also delete it.',
        },
        {
          sender: 'Corner Bookshop',
          detail: 'Monthly newsletter · marked read often',
          action: 'Keep',
          result: 'Nothing moves.',
        },
        {
          sender: 'Travel Offers Weekly',
          detail: '96 inbox messages · 2% marked read',
          action: 'Delete',
          result: '96 move to Gmail Trash; future email can still arrive.',
        },
      ],
    },
    sections: [
      {
        id: 'what-promotions-is',
        title: 'What the Promotions tab is',
        paragraphs: [
          'With the Default inbox type, Gmail automatically sorts email into categories. Google describes Promotions as deals, offers, and other promotional emails. Gmail decides what lands there; you can drag an email to another tab when it is in the wrong one.',
          'That is a reason to sample the tab before deleting all of it. Google also notes that archived email does not appear in categories, so the tab shows only what is still in your inbox.',
        ],
      },
      {
        id: 'gmail-steps',
        title: 'Delete everything in Promotions',
        paragraphs: ['Google documents these steps for Gmail on a computer.'],
        steps: [
          {
            name: 'Open Promotions',
            text: 'On the left, select Promotions. Scroll through a page or two and move anything you want to keep to another tab.',
          },
          {
            name: 'Select the current page',
            text: 'Above your messages, at the top left, check the Select box. This selects the messages on the current page only.',
          },
          {
            name: 'Select all of Promotions',
            text: 'A notification above your messages shows how many conversations are selected on the page. Click the link in that notification to select all conversations in the category.',
          },
          {
            name: 'Delete',
            text: 'At the top, click Delete. The email moves to Trash, where Gmail keeps it for up to 30 days before deleting it permanently.',
          },
        ],
      },
      {
        id: 'search-route',
        title: 'Use category:promotions when you need a condition',
        paragraphs: [
          'The tab is all or nothing. A search lets you delete part of it. Enter category:promotions in the search bar, add a condition, read the results, then select and delete them the same way.',
        ],
        bullets: [
          'category:promotions older_than:1y limits the set to email more than a year old.',
          'category:promotions from:offers@example.com limits it to one address.',
          'category:promotions is:unread limits it to email not marked read.',
        ],
      },
      {
        id: 'declutrmail-boundary',
        title: 'Where DeclutrMail fits, and where it does not',
        paragraphs: [
          'DeclutrMail does not select email by Gmail category or tab, and it does not predict categories. For “everything in Promotions”, Gmail’s own tab and search are the right tool.',
          'It works by sender. That fits when the tab is filled by the same lists every week: you decide once per sender, and the decision can cover that sender’s older email too.',
          WS3_COPY['ws3.howTo.unsubscribe.olderEmail'],
        ],
        steps: [
          {
            name: 'Find the senders that repeat',
            text: 'Senders are listed with volume and read rate. A low read rate is evidence, not proof, that a list is unwanted; read recent subjects first.',
          },
          {
            name: 'Choose Unsubscribe or Delete per sender',
            text: 'Unsubscribe asks the sender to stop future email. Delete moves that sender’s matching email to Gmail Trash. Each shows a preview before anything changes.',
          },
          {
            name: 'Check Activity',
            text: 'Archive, Later, and Delete can be undone from Activity while their undo window is open. A sent unsubscribe request cannot be taken back.',
          },
        ],
      },
      {
        id: 'stop-the-refill',
        title: 'Stop the tab refilling',
        paragraphs: [
          'Deleting changes the email that exists now. The same senders will write again unless you unsubscribe or add a filter.',
          'In Gmail, open an email from the list and click Unsubscribe next to the sender’s name. Google says it may take a few days for the email to stop, and that some senders send you to their website instead. A Gmail filter can archive or delete future email that matches a search you define.',
        ],
        callout: {
          title: 'Delete is not unsubscribe',
          body: 'Emptying the Promotions tab does not contact any sender. Treat cleanup and future delivery as two decisions.',
          tone: 'warning',
        },
      },
    ],
    sources: [
      {
        href: 'https://support.google.com/mail/answer/7401?hl=en',
        label: 'Google: Delete messages in Gmail',
        description:
          'Official steps to select a category such as Promotions, select all conversations, and delete; Trash retention.',
      },
      {
        href: 'https://support.google.com/mail/answer/3094499?hl=en',
        label: 'Google: Organize your emails into categories',
        description:
          'Official category definitions, automatic sorting, moving email between tabs, and category: search.',
      },
      {
        href: 'https://support.google.com/mail/answer/7190?hl=en',
        label: 'Google: Refine searches in Gmail',
        description: 'Official reference for category:, older_than:, from:, and is:unread.',
      },
      {
        href: 'https://support.google.com/mail/answer/15433283?hl=en',
        label: 'Google: Unsubscribe from an email',
        description: 'Official unsubscribe steps and processing time.',
      },
      {
        href: 'https://support.google.com/mail/answer/6579?hl=en',
        label: 'Google: Create rules to filter your emails',
        description: 'Official filter creation and what a filter can do.',
      },
    ],
  },

  'delete-more-than-50-emails-gmail': {
    slug: 'delete-more-than-50-emails-gmail',
    path: '/how-to/delete-more-than-50-emails-gmail',
    publishedAt: '2026-11-18',
    updatedAt: '2026-11-18',
    kind: 'How-to guide',
    title: 'Delete more than 50 emails at once in Gmail',
    quickAnswer:
      'The Select box in Gmail selects only the conversations on the current page. After you check it, a notification above your messages links to all conversations in that view or search. Click that link, then click Delete. Google documents these steps for Gmail on a computer.',
    description:
      'Gmail’s Select box only covers one page. Use the select-all link in the notification to delete more than 50 emails at once, then check Trash.',
    intro:
      'You check the box, press Delete, and Gmail removes one page. The rest is still there. The step that is easy to miss is a link in the notification that appears after you select the page.',
    readingMinutes: 5,
    example: {
      label: 'Made-up example',
      caption:
        'An invented sender showing one decision covering more email than a Gmail page holds.',
      rows: [
        {
          sender: 'Price Drop Alerts',
          detail: '640 inbox messages · 1% marked read',
          action: 'Delete',
          result: '640 move to Gmail Trash in one confirmed step.',
        },
        {
          sender: 'Team Calendar',
          detail: '58 inbox messages · marked read often',
          action: 'Keep',
          result: 'Nothing moves.',
        },
      ],
    },
    sections: [
      {
        id: 'why-one-page',
        title: 'Why the selection stops at one page',
        paragraphs: [
          'Google’s instructions say the Select box selects all messages on the current page. Google’s own example shows a page of 50 conversations selected, next to a link that selects all 2,000 conversations in Inbox.',
          'A bigger page is not the fix. Google’s Outlook-to-Gmail guide says the web view shows up to 100 messages or conversations per screen, which is still one page. The link in the notification is what reaches the rest.',
        ],
      },
      {
        id: 'gmail-steps',
        title: 'Select and delete more than one page',
        paragraphs: ['Google documents these steps for Gmail on a computer.'],
        steps: [
          {
            name: 'Open the view or run the search',
            text: 'On the left, select a view such as Inbox, Promotions, or All Mail. To delete specific email, enter a search operator in the search bar instead.',
          },
          {
            name: 'Check the Select box',
            text: 'It is above your messages, at the top left. The messages on the current page are now selected.',
          },
          {
            name: 'Click the link in the notification',
            text: 'A notification above your messages shows the number of selected conversations on the page. Click its link to select all conversations.',
          },
          {
            name: 'Click Delete',
            text: 'The whole selection moves to Trash. Open Trash and check a few messages before moving on.',
          },
        ],
      },
      {
        id: 'make-the-set-exact',
        title: 'Make the set exact before selecting all of it',
        paragraphs: [
          'Once the link is clicked, the selection includes conversations you never saw. Search first so that every result is one you would delete.',
        ],
        bullets: [
          'from:offers@example.com for one sender’s address.',
          'older_than:1y for email older than a period; use d, m, or y.',
          'is:unread for email not marked read.',
          'category:promotions for an inbox category, if you use categories.',
        ],
        callout: {
          title: 'Read a sample from both ends',
          body: 'Open a few recent results and a few old ones. An address that sends offers may also send receipts or account notices.',
          tone: 'warning',
        },
      },
      {
        id: 'by-sender',
        title: 'Delete by sender instead of by page',
        paragraphs: [
          'DeclutrMail groups the saved Gmail details by sender. One Delete decision applies to the matching email from that sender, however many pages it would fill in Gmail.',
          `${WS3_COPY['ws3.liveFix.learn.deletePreview']} The final number can change before the action runs. The email moves to Gmail Trash, and no rule is created for future email.`,
        ],
        steps: [
          {
            name: 'Open the sender',
            text: 'In Clean up, open the sender and read its recent subjects and current inbox count.',
          },
          {
            name: 'Choose Delete and read the preview',
            text: WS3_COPY['ws3.howTo.preview.checklist'],
          },
          {
            name: 'Confirm and check Activity',
            text: 'Activity records the result. Delete can be undone from there while its undo window is open.',
          },
        ],
      },
      {
        id: 'recovery',
        title: 'What happens to the deleted email',
        paragraphs: [
          'Google says deleted messages stay in Trash for up to 30 days and are permanently deleted after that. To recover one, open Trash, check its box, click Move to, and choose a destination.',
          'Delete forever and Empty Trash now are permanent. Deleting also leaves future email alone: the sender can still write to you until you unsubscribe or add a filter.',
        ],
      },
    ],
    sources: [
      {
        href: 'https://support.google.com/mail/answer/7401?hl=en',
        label: 'Google: Delete messages in Gmail',
        description:
          'Official Select box behavior, the notification link that selects all conversations, and Trash retention.',
      },
      {
        href: 'https://support.google.com/mail/answer/9259955?hl=en',
        label: 'Google: View & find email',
        description: 'Official note that the web view shows up to 100 messages per screen.',
      },
      {
        href: 'https://support.google.com/mail/answer/7190?hl=en',
        label: 'Google: Refine searches in Gmail',
        description: 'Official reference for from:, older_than:, is:unread, and category:.',
      },
    ],
  },

  'delete-old-emails-gmail-by-date': {
    slug: 'delete-old-emails-gmail-by-date',
    path: '/how-to/delete-old-emails-gmail-by-date',
    publishedAt: '2026-11-18',
    updatedAt: '2026-11-18',
    kind: 'How-to guide',
    title: 'How to delete old emails in Gmail by date',
    quickAnswer:
      'Search older_than:1y for email older than a period (use d, m, or y), or before:2020/01/01 for email received before a date. Read the results, check the Select box, click the link in the notification to select all conversations, then click Delete. Deleted email stays in Trash for up to 30 days.',
    description:
      'Delete old emails in Gmail in bulk by date with older_than: and before: searches, checks to run before selecting all, and what Trash keeps.',
    intro:
      'Age is the one condition Gmail search handles precisely. The operators are short; the judgment is in deciding what old email you still need before you select all of it.',
    readingMinutes: 6,
    example: {
      label: 'Made-up example',
      caption:
        'Invented senders showing that the age of email does not settle whether to delete it.',
      rows: [
        {
          sender: 'Conference Updates',
          detail: '140 inbox messages · event ended years ago',
          action: 'Delete',
          result: '140 move to Gmail Trash.',
        },
        {
          sender: 'Insurance Documents',
          detail: '22 inbox messages · policy records',
          action: 'Keep',
          result: 'Nothing moves.',
        },
        {
          sender: 'Old Project List',
          detail: '310 inbox messages · may be needed for reference',
          action: 'Archive',
          result: 'Leaves the inbox and stays searchable in All Mail.',
        },
      ],
    },
    sections: [
      {
        id: 'date-operators',
        title: 'The two ways Gmail searches by date',
        paragraphs: [
          'Gmail has a relative form and an absolute form. Both go in the search bar and both combine with other operators.',
        ],
        bullets: [
          'older_than:1y finds email older than a period. Use d for days, m for months, and y for years, as in older_than:6m.',
          'before:2020/01/01 finds email received before a date. Google’s examples write the date as year/month/day.',
          'after:2019/01/01 before:2020/01/01 finds email inside a date range.',
          'newer_than:2d is the opposite of older_than: and is useful for checking what a search leaves out.',
        ],
      },
      {
        id: 'gmail-steps',
        title: 'Delete old email in bulk',
        paragraphs: ['Google documents these steps for Gmail on a computer.'],
        steps: [
          {
            name: 'Run the date search',
            text: 'Enter older_than:2y, or a before: date, in the search bar. Start with an older cutoff than you think you need.',
          },
          {
            name: 'Read the results',
            text: 'Open several results from different years. Look for documents, receipts, and conversations with people.',
          },
          {
            name: 'Select all conversations',
            text: 'Check the Select box above your messages to select the current page, then click the link in the notification to select all conversations.',
          },
          {
            name: 'Delete and check Trash',
            text: 'Click Delete. The email moves to Trash, where Gmail keeps it for up to 30 days before deleting it permanently.',
          },
        ],
      },
      {
        id: 'keep-what-age-cannot-judge',
        title: 'Keep what age alone cannot judge',
        paragraphs: [
          'Old is not the same as unwanted. Add a second condition so the search describes the email you mean, not just when it arrived.',
        ],
        bullets: [
          'older_than:2y category:promotions limits the set to an inbox category.',
          'older_than:2y from:updates@example.com limits it to one address.',
          'older_than:2y -is:starred leaves out email you starred.',
          'older_than:2y has:attachment shows old email with attachments, which is worth reading before deleting.',
        ],
        callout: {
          title: 'Exclusions work on messages, not conversations',
          body: 'Google notes that with a negative operator such as -is:starred, a whole conversation can still appear if any one message in it matches. Check the results before selecting them all.',
          tone: 'info',
        },
      },
      {
        id: 'declutrmail-boundary',
        title: 'Where DeclutrMail fits, and where it does not',
        paragraphs: [
          'DeclutrMail does not select email across your mailbox by date. For “everything older than two years”, Gmail’s search is the right tool.',
          'It works by sender. When the old email comes from a few recurring senders, you decide per sender, and the preview has a How far back control for limiting that sender’s cleanup to older email.',
        ],
        steps: [
          {
            name: 'Open a sender with a long history',
            text: 'In Clean up, open the sender and read its recent subjects, volume, and read rate.',
          },
          {
            name: 'Choose Archive or Delete and set How far back',
            text: WS3_COPY['ws3.howTo.preview.reach'],
          },
          {
            name: 'Confirm and check Activity',
            text: 'Archive, Later, and Delete can be undone from Activity while their undo window is open. Deleted email is also in Gmail Trash.',
          },
        ],
      },
      {
        id: 'archive-instead',
        title: 'Archive when you are not sure',
        paragraphs: [
          'If the goal is a clear inbox, archive the same search results instead of deleting them. Google says archived messages can still be found under All Mail, and that a reply to an archived message brings it back to your inbox.',
          'To recover deleted email, open Trash, check the box beside each message, click Move to, and choose a destination. Delete forever and Empty Trash now are permanent.',
        ],
      },
    ],
    sources: [
      {
        href: 'https://support.google.com/mail/answer/7190?hl=en',
        label: 'Google: Refine searches in Gmail',
        description:
          'Official reference for older_than:, newer_than:, before:, after:, and the minus operator.',
      },
      {
        href: 'https://support.google.com/mail/answer/7401?hl=en',
        label: 'Google: Delete messages in Gmail',
        description:
          'Official select-all steps, date-range search example, Trash retention, and recovery.',
      },
      {
        href: 'https://support.google.com/mail/answer/9259770?hl=en',
        label: 'Google: Organize and archive email',
        description: 'Official Archive and All Mail behavior.',
      },
    ],
  },

  'delete-all-unread-emails-gmail': {
    slug: 'delete-all-unread-emails-gmail',
    path: '/how-to/delete-all-unread-emails-gmail',
    publishedAt: '2026-11-18',
    updatedAt: '2026-11-18',
    kind: 'How-to guide',
    title: 'How to delete all unread emails in Gmail',
    quickAnswer:
      'On a computer, search is:unread in Gmail, read the results, check the Select box, click the link in the notification to select all conversations, then click Delete. Unread is not the same as unwanted, so narrow the search first. Deleted email stays in Trash for up to 30 days.',
    description:
      'Delete all unread emails in Gmail with an is:unread search and the select-all link, plus ways to narrow it so unread email you want survives.',
    intro:
      'A large unread count can mix two things: email you never wanted and email you meant to get back to. Gmail can select all of it at once, which is why the search deserves a minute before the delete.',
    readingMinutes: 5,
    example: {
      label: 'Made-up example',
      caption: 'Invented senders showing unread email that deserves different decisions.',
      rows: [
        {
          sender: 'Coupon Parade',
          detail: '520 inbox messages · 0% marked read',
          action: 'Delete',
          result: '520 move to Gmail Trash; future email can still arrive.',
        },
        {
          sender: 'School Office',
          detail: '14 inbox messages · some not marked read yet',
          action: 'Keep',
          result: 'Nothing moves.',
        },
        {
          sender: 'Weekly Reading List',
          detail: '45 inbox messages · 10% marked read',
          action: 'Later',
          result: 'Current email moves to DeclutrMail/Later.',
        },
      ],
    },
    sections: [
      {
        id: 'unread-is-not-unwanted',
        title: 'Unread is not the same as unwanted',
        paragraphs: [
          'Gmail’s is:unread operator finds email by its read status. That status says nothing about who sent the message or whether you still need it. A bill that arrived this morning and a newsletter from three years ago are both unread.',
          'So treat is:unread as a starting point and add a condition that describes the email you actually want gone.',
        ],
      },
      {
        id: 'gmail-steps',
        title: 'Delete unread email in bulk',
        paragraphs: ['Google documents these steps for Gmail on a computer.'],
        steps: [
          {
            name: 'Search is:unread',
            text: 'Enter is:unread in the search bar, with any extra condition from the next section.',
          },
          {
            name: 'Read the results',
            text: 'Scroll the first pages and open anything from a person, a bank, or an account you use.',
          },
          {
            name: 'Select all conversations',
            text: 'Check the Select box above your messages to select the current page, then click the link in the notification to select all conversations.',
          },
          {
            name: 'Delete and check Trash',
            text: 'Click Delete. The email moves to Trash, where Gmail keeps it for up to 30 days before deleting it permanently.',
          },
        ],
      },
      {
        id: 'narrow-the-search',
        title: 'Narrow the search so wanted email survives',
        paragraphs: ['Each of these combines is:unread with one more operator.'],
        bullets: [
          'is:unread older_than:6m limits the set to unread email more than six months old.',
          'is:unread category:promotions limits it to an inbox category, if you use categories.',
          'is:unread from:offers@example.com limits it to one address.',
          'is:unread -is:starred leaves out email you starred.',
        ],
        callout: {
          title: 'Exclusions work on messages, not conversations',
          body: 'Google notes that with a negative operator such as -is:starred, a whole conversation can still appear if any one message in it matches. Check the results before selecting them all.',
          tone: 'info',
        },
      },
      {
        id: 'declutrmail-boundary',
        title: 'Where DeclutrMail fits, and where it does not',
        paragraphs: [
          'DeclutrMail does not select email by unread state. For “every unread message”, Gmail’s search is the right tool.',
          'It works by sender and shows each sender’s read rate, the share of that sender’s email marked read. That answers a different question: which senders keep sending email you never get to. A low read rate is evidence, not proof, that a sender is unwanted.',
        ],
        steps: [
          {
            name: 'Look for high volume and a low read rate',
            text: 'Sort for senders that send a lot and have a low read rate. Read recent subjects before deciding.',
          },
          {
            name: 'Decide once per sender',
            text: 'Keep, Archive, Unsubscribe, Later, or Delete. Archive, Later, and Delete show a preview with the count before anything moves.',
          },
          {
            name: 'Mark what must stay as Protected',
            text: 'Protected senders stay out of bulk and automatic cleanup.',
          },
        ],
      },
      {
        id: 'after-the-delete',
        title: 'Recover a mistake, then stop the next pile',
        paragraphs: [
          'To recover, open Trash, check the box beside each message, click Move to, and choose a destination. Delete forever and Empty Trash now are permanent.',
          'Deleting unread email does not stop more arriving. Unsubscribe from the lists behind it; in Gmail, the Unsubscribe link sits next to the sender’s name in an open email.',
        ],
      },
    ],
    sources: [
      {
        href: 'https://support.google.com/mail/answer/7190?hl=en',
        label: 'Google: Refine searches in Gmail',
        description:
          'Official reference for is:unread, older_than:, category:, from:, and the minus operator.',
      },
      {
        href: 'https://support.google.com/mail/answer/7401?hl=en',
        label: 'Google: Delete messages in Gmail',
        description: 'Official select-all steps, Trash retention, and recovery.',
      },
      {
        href: 'https://support.google.com/mail/answer/15433283?hl=en',
        label: 'Google: Unsubscribe from an email',
        description: 'Official location of the Unsubscribe link.',
      },
    ],
  },

  'clean-up-gmail-inbox': {
    slug: 'clean-up-gmail-inbox',
    path: '/how-to/clean-up-gmail-inbox',
    publishedAt: '2026-11-18',
    updatedAt: '2026-11-18',
    kind: 'How-to guide',
    title: 'How to clean up a Gmail inbox',
    quickAnswer:
      'Decide per kind of email whether to delete, archive, or unsubscribe. Use Gmail search with the select-all link to clear old, unread, or Promotions email in bulk, unsubscribe from lists you no longer want, and add filters for future email. Then go sender by sender for what is left.',
    description:
      'Clean up a Gmail inbox step by step: bulk delete or archive with search, unsubscribe from lists, add filters, then work through recurring senders.',
    intro:
      'A full inbox is several problems in one pile: old email, unread email, lists you no longer want, and senders that keep writing. Each has a different fix, and Gmail already has most of them.',
    readingMinutes: 7,
    example: {
      label: 'Made-up example',
      caption:
        'Invented senders showing the five decisions. Not a screenshot and not a claim about your inbox.',
      rows: [
        {
          sender: 'Shipping Notices',
          detail: '180 inbox messages · orders long delivered',
          action: 'Archive',
          result: 'Leaves the inbox and stays searchable in All Mail.',
        },
        {
          sender: 'Daily Deals Wire',
          detail: '300 inbox messages · 1% marked read',
          action: 'Unsubscribe',
          result: 'Asks the sender to stop; the sender controls delivery.',
        },
        {
          sender: 'Long Reads Weekly',
          detail: '24 inbox messages · wanted, not urgent',
          action: 'Later',
          result: 'Current email moves to DeclutrMail/Later.',
        },
        {
          sender: 'Expired Event Invites',
          detail: '75 inbox messages · events have passed',
          action: 'Delete',
          result: '75 move to Gmail Trash.',
        },
      ],
    },
    sections: [
      {
        id: 'three-outcomes',
        title: 'Know the three outcomes before you start',
        paragraphs: [
          'Every cleanup step in Gmail ends in one of three places, and they are easy to confuse.',
        ],
        bullets: [
          'Delete moves email to Trash. Google keeps it there for up to 30 days, then deletes it permanently.',
          'Archive takes email out of the inbox. It can still be found under All Mail, and a reply brings the conversation back.',
          'Unsubscribe asks a sender to stop future email. It does not remove what has already arrived.',
        ],
      },
      {
        id: 'gmail-first-pass',
        title: 'A first pass with Gmail’s own tools',
        paragraphs: [
          'Work from the largest, least risky sets to the smallest. Google documents the selection steps for Gmail on a computer: check the Select box, then click the link in the notification to select all conversations.',
        ],
        steps: [
          {
            name: 'Clear Promotions',
            text: 'Select Promotions on the left, sample a page, select all conversations, and delete or archive them.',
          },
          {
            name: 'Clear old email by date',
            text: 'Search older_than:2y, read the results, and delete or archive the set. Add from: or category: to keep it narrow.',
          },
          {
            name: 'Review unread email',
            text: 'Search is:unread older_than:6m. Unread is not the same as unwanted, so read before selecting everything.',
          },
          {
            name: 'Unsubscribe from lists',
            text: 'Open an email from a list you no longer want and click Unsubscribe next to the sender’s name. Google says it may take a few days to stop.',
          },
          {
            name: 'Add filters for future email',
            text: 'From the search options, create a filter that archives, labels, or deletes future email matching a search you define.',
          },
        ],
      },
      {
        id: 'by-sender',
        title: 'Then go sender by sender',
        paragraphs: [
          'After the broad passes, what remains is easier to sort by who is sending it. An inbox may hold thousands of messages from a few dozen recurring senders.',
          'DeclutrMail groups the saved Gmail details by sender and shows each sender’s volume and read rate. You make one decision per sender: Keep, Archive, Unsubscribe, Later, or Delete. It does not select by Gmail category, unread state, or date across the mailbox; the Gmail steps above cover those.',
        ],
        steps: [
          {
            name: WS3_COPY['ws3.liveFix.learn.firstScanStep'],
            text: 'Senders appear with their volume and read rate once the first Gmail scan finishes.',
          },
          {
            name: 'Start with the senders that send the most',
            text: 'Open each one and read recent subjects. Open Gmail when you need the full message.',
          },
          {
            name: 'Read the preview before confirming',
            text: WS3_COPY['ws3.howTo.preview.reach'],
          },
          {
            name: 'Check Activity',
            text: 'Archive, Later, and Delete can be undone from Activity while their undo window is open. A sent unsubscribe request cannot be taken back.',
          },
        ],
      },
      {
        id: 'what-to-leave-alone',
        title: 'Decide what to leave alone',
        paragraphs: [
          'Some email should survive any bulk pass: people you write to, financial notices, account security, and anything you are unsure about. In Gmail, star those messages and add -is:starred to a search before selecting all of it.',
          'In DeclutrMail, mark those senders Protected. Protected senders stay out of bulk and automatic cleanup.',
        ],
        callout: {
          title: 'Manual cleanup does not create rules',
          body: 'A delete or archive, in Gmail or in DeclutrMail, changes the email that exists now. New email from the same sender still arrives until you unsubscribe or add a filter.',
          tone: 'truth',
        },
      },
      {
        id: 'keep-it-clean',
        title: 'Keep it from filling up again',
        paragraphs: [
          'Repeat a short version each month: one search for old Promotions email, one look at the senders that grew, and a few unsubscribes. Gmail’s Manage subscriptions page, under More on the left, lists active subscriptions in one place; Google says it is still rolling out and may not be available to you yet.',
          'The aim is not an empty inbox. It is an inbox where what arrives is email you chose to keep receiving.',
        ],
      },
    ],
    sources: [
      {
        href: 'https://support.google.com/mail/answer/7401?hl=en',
        label: 'Google: Delete messages in Gmail',
        description: 'Official select-all steps, Trash retention, and recovery.',
      },
      {
        href: 'https://support.google.com/mail/answer/7190?hl=en',
        label: 'Google: Refine searches in Gmail',
        description: 'Official reference for older_than:, is:unread, category:, and from:.',
      },
      {
        href: 'https://support.google.com/mail/answer/9259770?hl=en',
        label: 'Google: Organize and archive email',
        description: 'Official Archive and All Mail behavior.',
      },
      {
        href: 'https://support.google.com/mail/answer/15433283?hl=en',
        label: 'Google: Unsubscribe from an email',
        description: 'Official unsubscribe steps and processing time.',
      },
      {
        href: 'https://support.google.com/mail/answer/15621070?hl=en',
        label: 'Google: Manage subscriptions in Gmail',
        description: 'Official Manage subscriptions location and rollout note.',
      },
      {
        href: 'https://support.google.com/mail/answer/6579?hl=en',
        label: 'Google: Create rules to filter your emails',
        description: 'Official filter creation and what a filter can do.',
      },
    ],
  },
  'where-do-archived-emails-go-gmail': {
    slug: 'where-do-archived-emails-go-gmail',
    path: '/how-to/where-do-archived-emails-go-gmail',
    publishedAt: '2026-11-18',
    updatedAt: '2026-11-18',
    kind: 'How-to guide',
    title: 'Where do archived emails go in Gmail?',
    quickAnswer:
      'Archived Gmail email goes to All Mail. Archive takes a message out of your inbox without deleting it. To find it, click More, then All Mail, or search in:archive. To bring it back, check the message and click Move to Inbox. If someone replies, the conversation returns to your inbox.',
    description:
      'Archived Gmail email stays in All Mail. Find it with an in:archive search, move it back with Move to Inbox, and see why a reply brings it back.',
    intro:
      'Archive is easy to press and easy to lose track of. Nothing archived is gone: Gmail takes the email out of the inbox and keeps it, so it is one search away.',
    readingMinutes: 5,
    example: {
      label: 'Made-up example',
      caption: 'Invented senders showing where archived email ends up.',
      rows: [
        {
          sender: 'Shipping Notices',
          detail: '180 inbox messages · orders long delivered',
          action: 'Archive',
          result: 'Leaves the inbox; still in All Mail and in:archive.',
        },
        {
          sender: 'Team Thread',
          detail: '1 archived conversation · someone replies',
          action: 'Archive',
          result: 'The reply brings the conversation back to the inbox.',
        },
        {
          sender: 'Long Reads Weekly',
          detail: '24 inbox messages · wanted, not urgent',
          action: 'Later',
          result: 'Current email moves to DeclutrMail/Later.',
        },
      ],
    },
    sections: [
      {
        id: 'what-archive-does',
        title: 'What Archive does, and what it does not',
        paragraphs: [
          'Google describes Archive as moving email out of your inbox while keeping it. The message is not deleted and does not go to Trash. After you archive it, you can still find it under the All Mail label, and an in:archive search finds it.',
          'Delete is the one to be careful with. It moves email to Trash, where Gmail keeps it for up to 30 days before deleting it permanently. Archive does not send anything to Trash.',
        ],
        bullets: [
          'Archive: out of the inbox, kept in All Mail.',
          'Delete: moved to Trash for up to 30 days, then deleted permanently.',
        ],
      },
      {
        id: 'find-archived',
        title: 'How to find archived emails',
        paragraphs: ['Google documents two routes for Gmail on a computer, plus a wider search.'],
        steps: [
          {
            name: 'Open All Mail',
            text: 'On the left, click More, then All Mail.',
          },
          {
            name: 'Search in:archive',
            text: 'Enter in:archive in the search bar. Google lists it as the search for archived messages.',
          },
          {
            name: 'Narrow the search',
            text: 'Add other operators, such as in:archive from:receipts@example.com or in:archive older_than:1y. Google’s own example is in:archive payment reminder.',
          },
          {
            name: 'Search everywhere if it is still missing',
            text: 'in:anywhere searches all of Gmail, including Spam and Trash. Use it when you are not sure whether a message was archived or deleted.',
          },
        ],
      },
      {
        id: 'move-back',
        title: 'How to move archived email back to the inbox',
        paragraphs: [
          'Moving an email back undoes the archive. Google writes these steps for Gmail on a computer.',
        ],
        steps: [
          {
            name: 'Find the message',
            text: 'Use All Mail or an in:archive search.',
          },
          {
            name: 'Check the box',
            text: 'Check the box next to each message you want back in the inbox.',
          },
          {
            name: 'Click Move to Inbox',
            text: 'At the top, click Move to Inbox. The message is in your inbox again.',
          },
        ],
      },
      {
        id: 'replies',
        title: 'Why archived email comes back',
        paragraphs: [
          'Google states that if someone replies to a message you archived, it returns to your inbox. Archive moves the email that exists now; it does not hide the conversation from future replies.',
          'If you want email from a sender archived automatically, that takes a Gmail filter, which can archive email matching a search you define. It is a separate decision; the auto-archive guide covers how to set one up and how to tell it apart from a one-time archive.',
        ],
        callout: {
          title: 'Archive is not a rule',
          body: 'A one-time archive changes the email that exists now. New email from the same sender still lands in the inbox until you add a filter or unsubscribe.',
          tone: 'truth',
        },
      },
      {
        id: 'declutrmail-boundary',
        title: 'Where DeclutrMail fits',
        paragraphs: [
          'DeclutrMail’s Archive works per sender. It removes the Inbox label from the current email from that sender, so the email ends up in the same All Mail and in:archive results described above. Nothing is deleted, and no rule for future email is created.',
          `Each Archive is recorded in Activity, where it can be undone ${UNIFORM_UNDO_WINDOW_DAYS === null ? 'while its undo window is open' : `for ${UNIFORM_UNDO_WINDOW_DAYS} days`}. Later works the same way and also adds a DeclutrMail/Later label, so that email is under the label in Gmail too.`,
        ],
        steps: [
          {
            name: 'Read the preview before confirming',
            text: WS3_COPY['ws3.howTo.preview.reach'],
          },
        ],
      },
    ],
    sources: [
      {
        href: 'https://support.google.com/mail/answer/9259770?hl=en',
        label: 'Google: Organize and archive email',
        description:
          'Official All Mail location, in:archive search, Move to Inbox steps, and reply behavior.',
      },
      {
        href: 'https://support.google.com/mail/answer/7190?hl=en',
        label: 'Google: Refine searches in Gmail',
        description: 'Official reference for in:archive, in:anywhere, from:, and older_than:.',
      },
      {
        href: 'https://support.google.com/mail/answer/7401?hl=en',
        label: 'Google: Delete messages in Gmail',
        description: 'Official Trash retention, for comparison with Archive.',
      },
      {
        href: 'https://support.google.com/mail/answer/6579?hl=en',
        label: 'Google: Create rules to filter your emails',
        description: 'Official filter creation and its archive action.',
      },
    ],
  },

  'recover-deleted-emails-gmail': {
    slug: 'recover-deleted-emails-gmail',
    path: '/how-to/recover-deleted-emails-gmail',
    publishedAt: '2026-11-18',
    updatedAt: '2026-11-18',
    kind: 'How-to guide',
    title: 'How to recover deleted emails in Gmail',
    quickAnswer:
      'Open Trash in Gmail (click More on the left, then Trash), check the messages you want, click Move to, and choose Inbox. Gmail keeps deleted email in Trash for up to 30 days, then deletes it permanently. Email removed with Delete forever or Empty Trash now is permanently deleted.',
    description:
      'Recover deleted Gmail email from Trash within 30 days using Move to, and see which steps, like Empty Trash now, delete your email permanently.',
    intro:
      'Deleting in Gmail is usually not final. Email goes to Trash first, and for up to 30 days getting it back takes a few clicks. The steps that make it final are worth knowing before a bulk cleanup.',
    readingMinutes: 5,
    example: {
      label: 'Made-up example',
      caption: 'Invented senders showing when deleted email can come back.',
      rows: [
        {
          sender: 'Coupon Parade',
          detail: '520 messages deleted last week',
          action: 'Delete',
          result: 'In Trash; Move to brings them back.',
        },
        {
          sender: 'Statement Delivery',
          detail: '40 messages deleted, then Trash emptied',
          action: 'Delete',
          result: 'Permanently deleted; Trash cannot return them.',
        },
      ],
    },
    sections: [
      {
        id: 'check-first',
        title: 'First, check it was really deleted',
        paragraphs: [
          'Missing email is not always deleted. Archived email leaves the inbox but stays in All Mail. Search in:anywhere to look across all of Gmail, including Spam and Trash, before assuming the worst.',
          'If the search finds the message outside Trash, it was never deleted. Archived email goes back with Move to Inbox; the archive guide covers that.',
        ],
      },
      {
        id: 'restore-from-trash',
        title: 'Restore email from Trash',
        paragraphs: ['Google documents these steps for Gmail on a computer.'],
        steps: [
          {
            name: 'Open Trash',
            text: 'On the left, click More, then Trash.',
          },
          {
            name: 'Check the messages',
            text: 'Check the box next to each message you want to recover.',
          },
          {
            name: 'Click Move to',
            text: 'At the top, click Move to.',
          },
          {
            name: 'Choose a destination',
            text: 'Choose where the messages should go, such as Inbox.',
          },
        ],
      },
      {
        id: 'thirty-days',
        title: 'The 30-day limit',
        paragraphs: [
          'Gmail keeps deleted email in Trash for up to 30 days. After that, Google deletes it permanently and it can’t be recovered.',
          'Treat Trash as a short grace period, not storage. If you might need something you deleted, move it out of Trash now.',
        ],
      },
      {
        id: 'permanent',
        title: 'What cannot be recovered from Trash',
        paragraphs: ['Some steps skip the grace period or end it early.'],
        bullets: [
          'Delete forever: messages you check in Trash and delete this way are removed permanently.',
          'Empty Trash now: removes everything in Trash permanently.',
          'Deleted drafts: Google says a deleted draft can’t be recovered from Trash.',
          'Email left in Trash past 30 days: deleted permanently.',
        ],
        callout: {
          title: 'Check Trash before you empty it',
          body: 'Once Gmail permanently deletes a message, Trash cannot return it. Look through Trash before clicking Empty Trash now.',
          tone: 'warning',
        },
      },
      {
        id: 'declutrmail-boundary',
        title: 'Where DeclutrMail fits',
        paragraphs: [
          'DeclutrMail’s Delete works per sender and moves that sender’s current email to Gmail Trash. Everything above still applies: the email sits in Gmail Trash, and Move to brings it back.',
          `Each Delete is also recorded in Activity, where it can be undone ${UNIFORM_UNDO_WINDOW_DAYS === null ? 'while its undo window is open' : `for ${UNIFORM_UNDO_WINDOW_DAYS} days`}. Emptying Gmail Trash still deletes the email permanently. A sent unsubscribe request cannot be taken back.`,
        ],
        steps: [
          {
            name: 'Read the Delete preview',
            text: WS3_COPY['ws3.howTo.preview.checklist'],
          },
        ],
      },
      {
        id: 'next-time',
        title: 'Make the next cleanup easier to reverse',
        paragraphs: [
          'Archive first when you are unsure. Archived email does not go to Trash, so the 30-day Trash limit does not apply to it.',
          'Before a bulk delete, open a few results from the search and narrow it with from:, older_than:, or -is:starred. A smaller, checked set is easier to recover than a large one.',
        ],
      },
    ],
    sources: [
      {
        href: 'https://support.google.com/mail/answer/7401?hl=en',
        label: 'Google: Delete messages in Gmail',
        description:
          'Official Trash recovery steps, the 30-day limit, Delete forever, Empty Trash now, and drafts.',
      },
      {
        href: 'https://support.google.com/mail/answer/7190?hl=en',
        label: 'Google: Refine searches in Gmail',
        description: 'Official reference for in:anywhere and the other operators used here.',
      },
      {
        href: 'https://support.google.com/mail/answer/9259770?hl=en',
        label: 'Google: Organize and archive email',
        description: 'Official All Mail and Move to Inbox behavior for archived email.',
      },
    ],
  },
};

const HOW_TO_RELATED_HREFS: Record<HowToSlug, readonly string[]> = {
  'clean-gmail-by-sender': [
    '/how-to/gmail-storage-full',
    '/how-to/bulk-delete-emails-from-one-sender',
    '/how-to/auto-archive-future-emails-in-gmail',
    '/how-to/unsubscribe-from-emails-gmail',
    '/how-to/clean-up-gmail-inbox',
    '/how-to/where-do-archived-emails-go-gmail',
    '/vs/gmail',
    '/compare',
    '/answers/sender-level-vs-message-level-cleanup',
    '/answers/best-way-to-clean-gmail-2026',
  ],
  'bulk-delete-emails-from-one-sender': [
    '/how-to/clean-gmail-by-sender',
    '/how-to/gmail-storage-full',
    '/how-to/auto-archive-future-emails-in-gmail',
    '/how-to/unsubscribe-from-emails-gmail',
    '/how-to/mass-delete-emails-gmail',
    '/how-to/delete-more-than-50-emails-gmail',
    '/how-to/recover-deleted-emails-gmail',
    '/vs/gmail',
    '/answers/how-undo-works-for-gmail-cleanup',
  ],
  'gmail-storage-full': [
    '/how-to/bulk-delete-emails-from-one-sender',
    '/how-to/clean-gmail-by-sender',
    '/how-to/stop-promotional-emails-gmail',
    '/how-to/delete-old-emails-gmail-by-date',
    '/how-to/mass-delete-emails-gmail',
    '/vs/clean-email',
    '/answers/how-undo-works-for-gmail-cleanup',
    '/answers/best-way-to-clean-gmail-2026',
  ],
  'auto-archive-future-emails-in-gmail': [
    '/how-to/gmail-storage-full',
    '/how-to/bulk-delete-emails-from-one-sender',
    '/how-to/stop-promotional-emails-gmail',
    '/how-to/clean-gmail-by-sender',
    '/how-to/where-do-archived-emails-go-gmail',
    '/how-to/clean-up-gmail-inbox',
    '/vs/gmail-filters',
    '/vs/sanebox',
    '/answers/how-undo-works-for-gmail-cleanup',
  ],
  'stop-promotional-emails-gmail': [
    '/how-to/unsubscribe-from-emails-gmail',
    '/how-to/auto-archive-future-emails-in-gmail',
    '/how-to/clean-gmail-by-sender',
    '/how-to/delete-all-promotions-emails-gmail',
    '/how-to/clean-up-gmail-inbox',
    '/vs/unroll-me',
    '/vs/leave-me-alone',
    '/answers/is-it-safe-to-connect-gmail-app',
  ],
  'unsubscribe-from-emails-gmail': [
    '/how-to/gmail-storage-full',
    '/how-to/stop-promotional-emails-gmail',
    '/how-to/bulk-delete-emails-from-one-sender',
    '/how-to/auto-archive-future-emails-in-gmail',
    '/how-to/delete-all-promotions-emails-gmail',
    '/how-to/clean-up-gmail-inbox',
    '/vs/unroll-me',
    '/vs/trimbox',
    '/answers/how-undo-works-for-gmail-cleanup',
  ],
  'mass-delete-emails-gmail': [
    '/how-to/delete-more-than-50-emails-gmail',
    '/how-to/bulk-delete-emails-from-one-sender',
    '/how-to/delete-all-promotions-emails-gmail',
    '/how-to/delete-old-emails-gmail-by-date',
    '/how-to/recover-deleted-emails-gmail',
    '/vs/gmail',
    '/answers/how-undo-works-for-gmail-cleanup',
  ],
  'delete-all-promotions-emails-gmail': [
    '/how-to/stop-promotional-emails-gmail',
    '/how-to/unsubscribe-from-emails-gmail',
    '/how-to/mass-delete-emails-gmail',
    '/how-to/bulk-delete-emails-from-one-sender',
    '/how-to/recover-deleted-emails-gmail',
    '/vs/gmail',
    '/answers/how-undo-works-for-gmail-cleanup',
  ],
  'delete-more-than-50-emails-gmail': [
    '/how-to/mass-delete-emails-gmail',
    '/how-to/bulk-delete-emails-from-one-sender',
    '/how-to/delete-all-unread-emails-gmail',
    '/how-to/recover-deleted-emails-gmail',
    '/vs/gmail',
    '/answers/how-undo-works-for-gmail-cleanup',
  ],
  'delete-old-emails-gmail-by-date': [
    '/how-to/mass-delete-emails-gmail',
    '/how-to/gmail-storage-full',
    '/how-to/delete-all-unread-emails-gmail',
    '/how-to/bulk-delete-emails-from-one-sender',
    '/how-to/recover-deleted-emails-gmail',
    '/vs/gmail',
    '/answers/how-undo-works-for-gmail-cleanup',
  ],
  'delete-all-unread-emails-gmail': [
    '/how-to/mass-delete-emails-gmail',
    '/how-to/delete-old-emails-gmail-by-date',
    '/how-to/clean-gmail-by-sender',
    '/how-to/delete-more-than-50-emails-gmail',
    '/how-to/recover-deleted-emails-gmail',
    '/vs/gmail',
    '/answers/sender-level-vs-message-level-cleanup',
  ],
  'clean-up-gmail-inbox': [
    '/how-to/clean-gmail-by-sender',
    '/how-to/mass-delete-emails-gmail',
    '/how-to/unsubscribe-from-emails-gmail',
    '/how-to/auto-archive-future-emails-in-gmail',
    '/how-to/gmail-storage-full',
    '/how-to/where-do-archived-emails-go-gmail',
    '/how-to/recover-deleted-emails-gmail',
    '/vs/gmail',
    '/answers/best-way-to-clean-gmail-2026',
  ],
  'where-do-archived-emails-go-gmail': [
    '/how-to/auto-archive-future-emails-in-gmail',
    '/how-to/clean-gmail-by-sender',
    '/how-to/recover-deleted-emails-gmail',
    '/how-to/clean-up-gmail-inbox',
    '/vs/gmail',
    '/answers/how-undo-works-for-gmail-cleanup',
  ],
  'recover-deleted-emails-gmail': [
    '/how-to/bulk-delete-emails-from-one-sender',
    '/how-to/mass-delete-emails-gmail',
    '/how-to/where-do-archived-emails-go-gmail',
    '/how-to/gmail-storage-full',
    '/vs/gmail',
    '/answers/how-undo-works-for-gmail-cleanup',
  ],
};

const COMPARE_RELATED_LINK: RelatedLink = {
  href: '/compare',
  label: 'Gmail cleanup tools compared side by side — DeclutrMail',
  description:
    'DeclutrMail vs. Clean Email, Trimbox, SaneBox, Leave Me Alone, Unroll.Me and native Gmail — what each actually does. Official sources, unknowns left unknown.',
};

function relatedLinkFor(href: string): RelatedLink {
  const howTo = HOW_TO_SLUGS.map((slug) => HOW_TO_BODIES[slug]).find(
    (article) => article.path === href,
  );
  if (howTo) return { href, label: howTo.title, description: howTo.description };
  const answerSlug = (Object.keys(ANSWER_ARTICLES) as AnswerSlug[]).find(
    (slug) => ANSWER_ARTICLES[slug].path === href,
  );
  if (answerSlug) {
    const answer = ANSWER_ARTICLES[answerSlug];
    return { href, label: answer.title, description: answer.description };
  }
  if (href.startsWith('/vs/')) {
    const comparison = comparisonBySlug(href.slice('/vs/'.length));
    if (comparison) {
      return { href, label: comparison.title, description: comparison.description };
    }
  }
  if (href === COMPARE_RELATED_LINK.href) return COMPARE_RELATED_LINK;
  throw new Error(`No page for how-to related href ${href}`);
}

function withRelated(slug: HowToSlug): LearnArticle {
  return {
    ...HOW_TO_BODIES[slug],
    related: HOW_TO_RELATED_HREFS[slug].map(relatedLinkFor),
  };
}

export const HOW_TO_ARTICLES: Record<HowToSlug, LearnArticle> = {
  'clean-gmail-by-sender': withRelated('clean-gmail-by-sender'),
  'bulk-delete-emails-from-one-sender': withRelated('bulk-delete-emails-from-one-sender'),
  'gmail-storage-full': withRelated('gmail-storage-full'),
  'auto-archive-future-emails-in-gmail': withRelated('auto-archive-future-emails-in-gmail'),
  'stop-promotional-emails-gmail': withRelated('stop-promotional-emails-gmail'),
  'unsubscribe-from-emails-gmail': withRelated('unsubscribe-from-emails-gmail'),
  'mass-delete-emails-gmail': withRelated('mass-delete-emails-gmail'),
  'delete-all-promotions-emails-gmail': withRelated('delete-all-promotions-emails-gmail'),
  'delete-more-than-50-emails-gmail': withRelated('delete-more-than-50-emails-gmail'),
  'delete-old-emails-gmail-by-date': withRelated('delete-old-emails-gmail-by-date'),
  'delete-all-unread-emails-gmail': withRelated('delete-all-unread-emails-gmail'),
  'clean-up-gmail-inbox': withRelated('clean-up-gmail-inbox'),
  'where-do-archived-emails-go-gmail': withRelated('where-do-archived-emails-go-gmail'),
  'recover-deleted-emails-gmail': withRelated('recover-deleted-emails-gmail'),
};
