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
    publishedAt: '2026-07-14',
    updatedAt: '2026-07-14',
    kind: 'Launch essay',
    eyebrow: 'Product thesis · attention over volume',
    title: 'Why email cleanup should start with senders',
    description:
      'The product thesis behind sender-first Gmail cleanup: compress recurrence, preserve message context, and separate current cleanup from future delivery.',
    intro:
      'The inbox presents email in arrival order. That is the right view for reading what arrived next, but a poor view for understanding what keeps creating the backlog.',
    readingMinutes: 9,
    example: {
      label: 'Made-up example',
      caption: 'The made-up inbox below has 111 messages but only three senders to decide.',
      rows: [
        {
          sender: 'Release Notes Weekly',
          detail: '47 messages · 2 marked read · you never wrote back',
          action: 'Review sender',
          result: 'One sender decision replaces 47 repeated triage moments.',
        },
        {
          sender: 'Design Partner',
          detail: '19 messages · 17 marked read · you wrote back 8×',
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
          'Suppose 500 emails come from 24 recurring senders. Message-first cleanup presents 500 checkboxes. Sender-first cleanup presents 24 questions: is this sender useful, noisy, or uncertain? The number of final Gmail changes may still be large, but the number of human decisions is smaller.',
          'That compression is valuable only when the product keeps the underlying facts available. Volume, recent subjects, read state, whether you write back, and current labels should explain why a sender is in view. A recommendation without facts merely replaces one opaque list with another.',
          'The user should also be able to decline the compression. When the sender is a marketplace, school, healthcare system, or another shared platform, open the messages in Gmail and decide at message level. A sender card is a review unit, not a claim that every message is interchangeable.',
        ],
      },
      {
        id: 'two-decisions',
        title: 'Current email and future email are two decisions',
        paragraphs: [
          'Cleanup products often blur two questions because a single confirmation feels efficient. What should happen to the email already here? What should happen when this sender emails again? The answers may differ. You may unsubscribe but preserve receipts, archive a backlog but allow new email, or route future updates while keeping a recent conversation in Inbox.',
          'DeclutrMail therefore treats manual Archive, Later, and Delete as actions on current matching email. They do not install an invisible standing rule. Unsubscribe requests future-delivery change and leaves existing email untouched unless the user separately approves backlog cleanup.',
          'The distinction costs an extra line of preview copy. It saves the much larger trust cost of discovering that a one-time cleanup quietly became permanent automation.',
        ],
        callout: {
          title: 'A durable decision is not necessarily an automatic rule',
          body: 'Durability comes from recording why a sender was reviewed and making future behavior explicit. It does not require every manual action to repeat forever.',
          tone: 'truth',
        },
      },
      {
        id: 'recommendations',
        title: 'Recommendations should narrow attention, not claim certainty',
        paragraphs: [
          'Sender volume and engagement are falsifiable facts. Category labels such as “promotional,” “financial,” or “security-sensitive” are model judgments that can sound more certain than their evidence. DeclutrMail deliberately avoids machine-learning category prediction and auto-protection based on guessed content classes.',
          'The recommendation system can say that a sender arrived often, was rarely marked read, and was never written back to. It cannot conclude that the sender is safe to delete. The product can propose Archive or Unsubscribe while keeping the user’s Protected decisions above the recommendation.',
          'This hierarchy matters most in automation. One mistaken suggestion is inconvenient; one mistaken recurring rule compounds. Observe mode exists so a user can see multiple would-be matches before an Autopilot preset becomes Active.',
        ],
      },
      {
        id: 'context',
        title: 'A companion should return context to Gmail',
        paragraphs: [
          'DeclutrMail is not trying to rebuild the inbox reader. It stores a limited set of Gmail details, including the subject line and Gmail preview snippet, to support sender review. It never fetches full email contents or attachments. When the content determines your decision, the correct next step is “Open in Gmail.”',
          'That limit is both a privacy decision and a product constraint. Sender tools should be excellent at showing recurring senders, affected email, and action history. Gmail should remain the place for full content, search, conversations, and final verification.',
          'A good companion reduces the number of times you must read the same kind of interruption without pretending that reading itself is obsolete.',
        ],
      },
      {
        id: 'measure',
        title: 'Measure decisions that prevent recurrence',
        paragraphs: [
          '“Messages deleted” is an attractive metric because it can become very large. It also rewards the most destructive action and says nothing about whether the inbox will refill. A more useful measure separates current messages moved from future noise prevented and keeps both tied to auditable sender decisions.',
          'The sender-first idea is therefore not “bulk delete faster.” It is “make fewer, better-informed decisions about recurring senders, preserve exceptions, and keep the consequences visible.” That is a quieter product promise, and a more durable one.',
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
    publishedAt: '2026-07-14',
    updatedAt: '2026-07-14',
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
          'An email API can return sender and recipient details, subject lines, dates, labels, read state, a provider-generated snippet, complete email parts, or raw content. Calling everything outside the complete email “metadata” is technically convenient but not useful enough for a person deciding whether the access is acceptable.',
          'DeclutrMail stores the sender, subject line, Gmail preview snippet, dates, labels, read state, size, and limited unsubscribe information. It does not fetch or store full email contents, HTML, attachments, embedded images, or raw email source. The snippet deserves explicit mention because a short preview can still contain sensitive language.',
          'The honest statement is narrower and stronger: DeclutrMail never fetches or stores full email contents, but it does store Gmail preview snippets. Precision earns more trust than a broader claim that later requires footnotes.',
        ],
      },
      {
        id: 'capability',
        title: 'The data boundary should limit product capability',
        paragraphs: [
          'Without complete content, DeclutrMail should not offer full-email search, complete conversation summaries, attachment extraction, or guarantees about what an email means. Sender volume, read state, whether you write back, labels, and recency can support review by sender, but they cannot replace reading a contract, medical result, or conversation.',
          'This is why the interface returns users to Gmail for message content. A deep link is not an unfinished reader; it is evidence that the companion boundary is being respected.',
          'Constraints also protect future product decisions. A tempting feature that requires raw bodies should trigger a visible privacy decision rather than arriving through an unnoticed expansion of the fetch path.',
        ],
      },
      {
        id: 'derived-facts',
        title: 'Derived facts need their own threat model',
        paragraphs: [
          'A system can avoid bodies and still accumulate a revealing behavioral graph. Sender frequency, read rate, who you write back to, last-seen dates, Protected status, decisions, and activity history describe relationships and habits. Data minimization must therefore cover retention, access, logs, exports, and deletion for derived records as well as raw API fields.',
          'DeclutrMail’s product needs those aggregates to rank senders and explain recommendations. Observability payloads, worker logs, and error reports are separately barred from carrying email addresses, subjects, snippets, bodies, or OAuth tokens. The principle is containment: a field belongs only in the narrow path that needs it.',
          'Exports similarly separate datasets. A sender decision export should not quietly become a second message-content archive.',
        ],
      },
      {
        id: 'processors',
        title: 'External processors are part of the boundary',
        paragraphs: [
          'It is not enough to say what is stored in the primary database. Users also deserve to know what reaches an error service, analytics system, email provider, or language model. The answer may differ by feature.',
          'DeclutrMail can send Anthropic sender totals and read rates without subject lines or snippets to explain a suggestion. Daily Brief works differently: it can send the sender, subject line, and Gmail preview snippet. Full email contents and attachments are never included, and DeclutrMail uses a standard summary when Anthropic is unavailable.',
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
          'The strongest implementation does not rely on developer memory. Database columns define the stored fields. Gmail clients request only the required format. AI inputs omit body fields. Tests fail when a forbidden field appears. Logging helpers remove known sensitive information. Data exports list exact columns.',
          'Copy should be generated from or tested against the same field list wherever possible. Otherwise the homepage, privacy policy, onboarding, and settings will slowly describe different products.',
          'This approach cannot prove the absence of every bug. It makes privacy drift reviewable in code and gives future contributors a clear point where a boundary change must be debated.',
        ],
      },
      {
        id: 'product-quality',
        title: 'Less data can produce a more legible product',
        paragraphs: [
          'A limited data model forces DeclutrMail to be specific about its job: reveal recurring senders, show their volume, present actions for existing email, record results, and return full reading to Gmail. It discourages features built merely because more content could be extracted.',
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
    publishedAt: '2026-07-14',
    updatedAt: '2026-07-14',
    kind: 'Launch essay',
    eyebrow: 'Trust design · previews before recovery',
    title: 'Reversible does not mean risk-free',
    description:
      'Why each Gmail cleanup action needs its own recovery explanation, visible previews, small batches, and honest one-way warnings even when Undo exists.',
    intro:
      'Undo is a safety net. When a product uses it as permission to leave the affected email unclear or make confirmation effortless, recovery becomes a substitute for informed action.',
    readingMinutes: 9,
    sections: [
      {
        id: 'different-meanings',
        title: '“Reversible” means something different for each action',
        paragraphs: [
          'Archive is a label change: remove Inbox, then add it back. Later is two label changes: remove Inbox and add DeclutrMail/Later, then invert both. Delete moves email to Gmail Trash, where Gmail supplies a temporary recovery period. Keep and Protected are sender settings that can be changed again.',
          'Unsubscribe is categorically different. Once a standards request or a user-sent mailto message reaches another organization, DeclutrMail cannot pull it back. A user may subscribe again later, but that is a new request rather than an inverse operation.',
          'Putting all five under one “Everything is undoable” message makes the easiest promise win over the actual system. A trustworthy interface names the recovery mechanism beside the action.',
        ],
      },
      {
        id: 'preview',
        title: 'A preview answers questions that undo cannot',
        paragraphs: [
          'Undo can reverse a supported operation after it runs. It cannot tell the user beforehand whether the selected sender was correct, whether the count includes years of email, whether future messages are affected, or whether an external request will be delivered.',
          'A useful preview states what changes, what does not change, which email is affected, and how recovery works. For Unsubscribe it should say that existing email stays put and the delivered request is one-way. For manual Archive it should say that future messages may still arrive.',
          'The preview is therefore not decorative friction. It is the place where the product makes its model inspectable before consequences begin.',
        ],
      },
      {
        id: 'journal',
        title: 'A good Activity history supports accurate Undo',
        paragraphs: [
          'A generic “move back” command is not enough. An email may already have labels, may already be outside Inbox, or may change again after the cleanup action. DeclutrMail must remember the exact Gmail label changes for that Gmail account so a retry does not repeat or compound them.',
          'DeclutrMail stores Gmail message IDs and label changes rather than a duplicate email body. Activity shows Undo while recovery is available. Triage also shows recent actions, but Activity remains the dependable place to review results and start recovery.',
          'The deadline should be visible. Every plan offers Undo for thirty days. Gmail Trash can end recovery earlier if the user empties it or permanently deletes an email.',
        ],
      },
      {
        id: 'batch',
        title: 'Batch size changes the cost of a mistake',
        paragraphs: [
          'The same correct action can carry different risk for one sender and one thousand senders. Bulk tools should preview the total count, show failures for each sender, keep the batch together in Activity, and avoid showing success before the work finishes.',
          'A small first batch is still the best operational control. It tests sender identity, Gmail behavior, recovery, and the user’s interpretation of the preview before the largest selection runs.',
          'Speed should come from eliminating repeated confirmation once the workflow is understood, not from hiding the affected email on the first irreversible decision.',
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
          'DeclutrMail’s presets show what they would do before you turn them on. Choose Watch first and matches collect without moving email, for your approval. Either way you review the matching email and deliberately turn the rule on. The safety model is not “the rule is fine because actions can be undone”; it is “the user saw representative matches before the rule began and can still review each result.”',
          'Unsubscribe automation deserves extra caution because delivered requests have no inverse. Protected senders are excluded before recommendations so known exceptions do not enter the automation path.',
        ],
      },
      {
        id: 'trust',
        title: 'Trust comes from specific claims',
        paragraphs: [
          '“Recoverable for thirty days from Activity,” “restorable from Gmail Trash for up to thirty days,” and “cannot be undone after delivery” are less elegant than one universal promise. They are also useful when something goes wrong.',
          'The standard for a cleanup product should be that every action names the affected email and gives an honest recovery statement, including when recovery is unavailable. Reversibility then becomes a real product property instead of a marketing adjective.',
        ],
      },
    ],
    related: [
      {
        href: '/answers/how-undo-works-for-gmail-cleanup',
        label: 'Undo for each action',
        description: 'The operational recovery guide.',
      },
      {
        href: '/how-to/bulk-delete-emails-from-one-sender',
        label: 'Delete with a clear preview',
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
