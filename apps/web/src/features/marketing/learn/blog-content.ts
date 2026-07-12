import type { LearnArticle } from './types';

export const BLOG_SLUGS = [
  'why-cleanup-starts-with-senders',
  'metadata-only-is-a-design-constraint',
  'reversible-does-not-mean-risk-free',
] as const;

export type BlogSlug = (typeof BLOG_SLUGS)[number];

export const BLOG_ARTICLES: Record<BlogSlug, LearnArticle> = {
  'why-cleanup-starts-with-senders': {
    slug: 'why-cleanup-starts-with-senders',
    path: '/blog/why-cleanup-starts-with-senders',
    kind: 'Launch essay',
    eyebrow: 'Product thesis · attention over volume',
    title: 'Why email cleanup should start with senders',
    description:
      'The product thesis behind sender-first Gmail cleanup: compress recurrence, preserve message context, and separate current cleanup from future delivery.',
    intro:
      'The inbox presents mail in arrival order. That is the right view for reading what arrived next, but a poor view for understanding what keeps creating the backlog.',
    readingMinutes: 9,
    example: {
      label: 'Illustrative example — synthetic data',
      caption:
        'The synthetic inbox below has 111 messages but only three source relationships to decide.',
      rows: [
        {
          sender: 'Release Notes Weekly',
          detail: '47 messages · 2 opened · no replies',
          action: 'Review source',
          result: 'One sender decision replaces 47 repeated triage moments.',
        },
        {
          sender: 'Design Partner',
          detail: '19 messages · 17 opened · 8 replies',
          action: 'Protect',
          result: 'High-value correspondence stays out of automation.',
        },
        {
          sender: 'Event Calendar',
          detail: '45 messages · mixed relevance',
          action: 'Inspect in Gmail',
          result: 'Message context wins when one sender has exceptions.',
        },
      ],
    },
    sections: [
      {
        id: 'arrival-order',
        title: 'Arrival order hides the production system',
        paragraphs: [
          'An unread count is an inventory measure. It describes how many messages are waiting, not why they exist or which decision would prevent another hundred. Working from the top of the inbox rewards recency: the newest message receives attention even when the thirtieth message from the same low-value list created the larger cost.',
          'Senders are closer to the production system behind that inventory. A newsletter schedule, store campaign, automated report, or shared platform generates a stream. Once that stream is visible as one object, the user can decide whether the relationship deserves Inbox, another route, or no future delivery.',
          'This does not make every sender homogeneous. It gives recurrence a name and a count, which is the evidence needed to decide whether to inspect further.',
        ],
      },
      {
        id: 'compression',
        title: 'Compression changes the shape of the work',
        paragraphs: [
          'Suppose 500 messages come from 24 recurring sources. Message-first cleanup presents 500 checkboxes. Sender-first cleanup presents 24 hypotheses: this source is useful, this one is noise, this one is ambiguous. The number of final mail operations may still be large, but the number of human judgments is smaller.',
          'That compression is valuable only when the product keeps the underlying facts available. Volume, recent subjects, opens, replies, and current labels should explain why a sender is in view. A recommendation without facts merely replaces one opaque list with another.',
          'The user should also be able to decline the compression. When the sender is a marketplace, school, healthcare system, or another shared platform, open the messages in Gmail and decide at message level. A sender card is a review unit, not a claim that every message is interchangeable.',
        ],
      },
      {
        id: 'two-decisions',
        title: 'Current mail and future mail are two decisions',
        paragraphs: [
          'Cleanup products often blur two questions because a single confirmation feels efficient. What should happen to the messages already here? What should happen when this source writes again? The answers may differ. You may unsubscribe but preserve receipts, archive a backlog but allow new mail, or route future updates while keeping a recent thread in Inbox.',
          'DeclutrMail therefore treats manual Archive, Later, and Delete as actions on current matching mail. They do not install an invisible standing rule. Unsubscribe requests future-delivery change and leaves existing mail untouched unless the user separately approves backlog cleanup.',
          'The distinction costs an extra line of preview copy. It saves the much larger trust cost of discovering that a one-time cleanup quietly became permanent automation.',
        ],
        callout: {
          title: 'A durable decision is not necessarily an automatic rule',
          body: 'Durability comes from recording why a source was reviewed and making future behavior explicit. It does not require every manual action to repeat forever.',
          tone: 'truth',
        },
      },
      {
        id: 'recommendations',
        title: 'Recommendations should narrow attention, not claim certainty',
        paragraphs: [
          'Sender volume and engagement are falsifiable facts. Category labels such as “promotional,” “financial,” or “security-sensitive” are model judgments that can sound more certain than their evidence. DeclutrMail deliberately avoids machine-learning category prediction and auto-protection based on guessed content classes.',
          'The recommendation system can say that a sender arrived often, was rarely opened, and received no replies. It cannot conclude that the sender is safe to delete. The product can propose Archive or Unsubscribe while keeping the user’s Protect and VIP decisions above the recommendation.',
          'This hierarchy matters most in automation. One mistaken suggestion is inconvenient; one mistaken recurring rule compounds. Observe mode exists so a user can see multiple would-be matches before an Autopilot preset becomes Active.',
        ],
      },
      {
        id: 'context',
        title: 'A companion should return context to Gmail',
        paragraphs: [
          'DeclutrMail is not trying to rebuild the inbox reader. It indexes a bounded metadata set, including subject and Gmail’s preview snippet, to support sender review. It never fetches full message bodies or attachments. When content determines the decision, the correct next step is an “Open in Gmail” link.',
          'That boundary is both a privacy choice and a product constraint. Sender-level tools should be excellent at recurrence, scope, and action history. Gmail should remain the place for full content, search, thread context, and final verification.',
          'A good companion reduces the number of times you must read the same kind of interruption without pretending that reading itself is obsolete.',
        ],
      },
      {
        id: 'measure',
        title: 'Measure decisions that prevent recurrence',
        paragraphs: [
          '“Messages deleted” is an attractive metric because it can become very large. It also rewards the most destructive action and says nothing about whether the inbox will refill. A more useful measure separates current messages moved from future noise prevented and keeps both tied to auditable sender decisions.',
          'The sender-first thesis is therefore not “bulk delete faster.” It is “make fewer, better-scoped judgments about recurring sources, preserve exceptions, and keep the consequences visible.” That is a quieter product promise, and a more durable one.',
        ],
      },
    ],
    related: [
      {
        href: '/how-to/clean-gmail-by-sender',
        label: 'Try the sender-first method',
        description: 'A practical native-Gmail and DeclutrMail workflow.',
      },
      {
        href: '/answers/sender-level-vs-message-level-cleanup',
        label: 'Compare the two levels',
        description: 'Where each model succeeds and fails.',
      },
      {
        href: '/blog/reversible-does-not-mean-risk-free',
        label: 'Recovery is not review',
        description: 'Why previews remain necessary.',
      },
    ],
  },

  'metadata-only-is-a-design-constraint': {
    slug: 'metadata-only-is-a-design-constraint',
    path: '/blog/metadata-only-is-a-design-constraint',
    kind: 'Launch essay',
    eyebrow: 'Privacy engineering · capability follows data',
    title: 'Metadata-only should be a design constraint',
    description:
      'Why a metadata-only email product must name stored snippets, constrain its features, disclose external processing, and make the missing body visible.',
    intro:
      'Data minimization is credible when users can see what the product cannot do. If a service claims not to fetch full email bodies but behaves like a full-content reader, the boundary deserves scrutiny.',
    readingMinutes: 10,
    sections: [
      {
        id: 'not-binary',
        title: 'Email data is not body or nothing',
        paragraphs: [
          'An email API can return sender and recipient headers, subject, dates, labels, read state, a provider-generated snippet, full MIME parts, or raw content. Calling every field outside the full MIME payload “metadata” is technically convenient but insufficient for a user deciding whether the exposure is acceptable.',
          'DeclutrMail stores sender, subject, Gmail’s short preview snippet, dates, labels, read state, size, and a small allowlist of list-unsubscribe headers. It does not fetch or store full message bodies, HTML, attachments, inline images, or raw MIME. The snippet deserves explicit mention because a short preview can still contain sensitive language.',
          'The honest statement is narrower and stronger: full bodies fetched, zero; Gmail snippets stored. Precision earns more trust than a broader claim that later requires footnotes.',
        ],
      },
      {
        id: 'capability',
        title: 'The data boundary should limit product capability',
        paragraphs: [
          'Without complete content, DeclutrMail should not offer full-message search, complete thread summaries, attachment extraction, or semantic guarantees about what a message means. Sender volume, opens, replies, labels, and recency can support source-level review, but they cannot replace reading a contract, medical result, or conversation.',
          'This is why the interface returns users to Gmail for message content. A deep link is not an unfinished reader; it is evidence that the companion boundary is being respected.',
          'Constraints also protect future product decisions. A tempting feature that requires raw bodies should trigger a visible privacy decision rather than arriving through an unnoticed expansion of the fetch path.',
        ],
      },
      {
        id: 'derived-facts',
        title: 'Derived facts need their own threat model',
        paragraphs: [
          'A system can avoid bodies and still accumulate a revealing behavioral graph. Sender frequency, read rate, replies, last-seen dates, VIP status, decisions, and activity history describe relationships and habits. Data minimization must therefore cover retention, access, logs, exports, and deletion for derived records as well as raw API fields.',
          'DeclutrMail’s product needs those aggregates to rank senders and explain recommendations. Observability payloads, worker logs, and error reports are separately barred from carrying email addresses, subjects, snippets, bodies, or OAuth tokens. The principle is containment: a field belongs only in the narrow path that needs it.',
          'Exports similarly separate datasets. A sender decision export should not quietly become a second message-content archive.',
        ],
      },
      {
        id: 'processors',
        title: 'External processors are part of the boundary',
        paragraphs: [
          'It is not enough to say what is stored in the primary database. Users also deserve to know what reaches an error service, analytics system, email provider, or language model. The answer may differ by feature.',
          'DeclutrMail’s sender-reasoning path sends Anthropic precomputed aggregate facts without subjects or snippets. Daily Brief has a different contract: its bounded narrative input can include sender identity, subject, Gmail preview snippet, and VIP marker. Full bodies and attachments are never included, and deterministic templates are the fallback when the adapter fails or is unavailable.',
          'Those two paths should never be compressed into “AI never sees email data” or “AI reads your inbox.” Both slogans are false. Field-level disclosure is the useful middle.',
        ],
        callout: {
          title: 'No full body is a meaningful boundary, not a universal exemption',
          body: 'Subjects and snippets remain user data. They require access controls, processing disclosure, and deletion even though they are not complete message bodies.',
          tone: 'truth',
        },
      },
      {
        id: 'proof',
        title: 'Turn privacy copy into executable proof',
        paragraphs: [
          'The strongest implementation does not rely on developer memory. Schema columns define the allowed stored fields. Gmail clients request metadata format. Prompt types omit body fields. Tests fail when a forbidden property appears. Logging helpers redact known sensitive keys. Data exports enumerate exact columns.',
          'Copy should be generated from or tested against the same allowlist wherever possible. Otherwise the homepage, privacy policy, onboarding, and settings will slowly describe different products.',
          'This approach cannot prove the absence of every bug. It makes privacy drift reviewable in code and gives future contributors a clear point where a boundary change must be debated.',
        ],
      },
      {
        id: 'product-quality',
        title: 'Less data can produce a more legible product',
        paragraphs: [
          'A bounded data model forces DeclutrMail to be specific about its job: reveal recurring sources, quantify their cost, present current-mail actions, record outcomes, and return full reading to Gmail. It discourages a feature catalogue built from whatever content can be extracted.',
          'Privacy and product focus reinforce each other here. The missing body is not only something the security page promises. It is visible in the architecture of the experience.',
        ],
      },
    ],
    related: [
      {
        href: '/answers/what-is-metadata-only-email-analysis',
        label: 'Metadata-only, field by field',
        description: 'The concise version of the storage boundary.',
      },
      {
        href: '/security',
        label: 'Security controls',
        description: 'OAuth, token encryption, and verification.',
      },
      {
        href: '/privacy',
        label: 'Privacy policy',
        description: 'Retention, processors, rights, and deletion.',
      },
    ],
  },

  'reversible-does-not-mean-risk-free': {
    slug: 'reversible-does-not-mean-risk-free',
    path: '/blog/reversible-does-not-mean-risk-free',
    kind: 'Launch essay',
    eyebrow: 'Trust design · previews before recovery',
    title: 'Reversible does not mean risk-free',
    description:
      'Why Gmail cleanup needs verb-specific recovery, visible previews, small batches, and honest one-way boundaries even when undo exists.',
    intro:
      'Undo is a safety net. When a product uses it as permission to make scope vague or confirmation effortless, recovery becomes a substitute for informed action.',
    readingMinutes: 9,
    sections: [
      {
        id: 'different-meanings',
        title: '“Reversible” means different things for different verbs',
        paragraphs: [
          'Archive is a label change: remove Inbox, then add it back. Later is two label changes: remove Inbox and add DeclutrMail/Later, then invert both. Delete moves mail to Gmail Trash, where Gmail supplies a temporary recovery period. Keep, VIP, and Protect are settings that can be changed again.',
          'Unsubscribe is categorically different. Once a standards request or a user-sent mailto message reaches another organization, DeclutrMail cannot pull it back. A user may subscribe again later, but that is a new request rather than an inverse operation.',
          'Putting all five under one “Everything is undoable” message makes the easiest promise win over the actual system. A trustworthy interface names the recovery mechanism beside the action.',
        ],
      },
      {
        id: 'preview',
        title: 'A preview answers questions that undo cannot',
        paragraphs: [
          'Undo can reverse a supported operation after it runs. It cannot tell the user beforehand whether the selected sender was correct, whether the count includes years of mail, whether future messages are affected, or whether an external request will be delivered.',
          'A useful preview states what changes, what does not change, the affected scope, and the recovery path. For Unsubscribe it should say that existing mail stays put and the delivered request is one-way. For manual Archive it should say that future messages may still arrive.',
          'The preview is therefore not decorative friction. It is the place where the product makes its model inspectable before consequences begin.',
        ],
      },
      {
        id: 'journal',
        title: 'A good undo journal records exact prior state',
        paragraphs: [
          'A generic “move back” command is not sufficient. A message may already have labels, may already be outside Inbox, or may be changed again after the cleanup action. The journal should record the exact forward and inverse label deltas, bind them to one mailbox, and execute idempotently so retries do not compound.',
          'DeclutrMail stores message identifiers and label operations rather than a duplicate message body. Activity exposes active tokens for journaled actions. Triage also shows a recent-action tray, but Activity remains the durable place to audit outcomes and initiate recovery.',
          'The expiry should be visible. Free and Plus use seven-day journal windows, while Pro uses thirty days. Gmail Trash can end recovery earlier if the user empties it or permanently deletes a message.',
        ],
      },
      {
        id: 'batch',
        title: 'Batch size changes the cost of a mistake',
        paragraphs: [
          'The same correct action can carry different risk at one sender and one thousand senders. Bulk tools should preview aggregate counts, isolate per-sender failures, preserve one auditable batch identity, and avoid optimistic success before workers finish.',
          'A small first batch is still the best operational control. It tests sender identity, Gmail behavior, recovery, and the user’s interpretation of the preview before the largest selection runs.',
          'Speed should come from eliminating repeated confirmation once the model is understood, not from hiding the scope on the first irreversible decision.',
        ],
        callout: {
          title: 'Recovery time is not a reason to maximize the batch',
          body: 'The cost of detecting and verifying a mistake grows with the selection. Start small even when the inverse operation is available.',
          tone: 'warning',
        },
      },
      {
        id: 'automation',
        title: 'Automation needs observation in addition to undo',
        paragraphs: [
          'A manual mistake affects one reviewed set. An active rule can repeat the mistake every time the condition matches. Undoing yesterday’s messages does not correct tomorrow’s rule unless the automation state is also paused or changed.',
          'DeclutrMail’s presets begin in Observe for seven days. Would-be matches accumulate without moving mail. Activation has its own dry run and explicit state. The safety model is not “the rule is fine because actions can be undone”; it is “the user saw representative matches before the rule began, and can still audit each result.”',
          'Unsubscribe automation deserves extra caution because delivered requests have no inverse. Protect and VIP controls sit above recommendations so known exceptions do not enter the automation path.',
        ],
      },
      {
        id: 'trust',
        title: 'Trust comes from bounded claims',
        paragraphs: [
          '“Recoverable for seven days from Activity,” “restorable from Gmail Trash for up to thirty days,” and “cannot be undone after delivery” are less elegant than one universal promise. They are also useful when something goes wrong.',
          'The standard for a cleanup product should be that every action has an explicit scope and an honest recovery statement, including when that statement is no. Reversibility then becomes a real system property instead of a marketing adjective.',
        ],
      },
    ],
    related: [
      {
        href: '/answers/how-undo-works-for-gmail-cleanup',
        label: 'Undo, verb by verb',
        description: 'The operational recovery guide.',
      },
      {
        href: '/how-to/bulk-delete-emails-from-one-sender',
        label: 'Scope Delete safely',
        description: 'A checked workflow for Gmail Trash.',
      },
      {
        href: '/changelog',
        label: 'Build log',
        description: 'Evidence-linked product changes from repository history.',
      },
    ],
  },
};
