/**
 * Compact product language for D245's in-product glossary.
 *
 * These definitions explain product concepts, not implementation details.
 * Decision-point help can select a single entry from this registry instead of
 * linking users to a long generic FAQ.
 */

export const GLOSSARY_TERMS = {
  sender: {
    term: 'Sender',
    definition:
      'A person or service identified by its From address. DeclutrMail groups matching mail by sender so one decision can cover that sender’s mail.',
  },
  gmailPreview: {
    term: 'Gmail Preview',
    definition:
      'The short snippet Gmail already shows in your inbox list. DeclutrMail stores it to give review context without fetching the full message body.',
  },
  protected: {
    term: 'Protected',
    definition:
      'A silent standing policy that locks a sender to Keep and prevents new cleanup suggestions. Protected senders are not elevated in Brief.',
  },
  vip: {
    term: 'VIP',
    definition:
      'A visible standing policy for an important sender. VIP locks the sender to Keep and includes the sender in every Brief.',
  },
  observe: {
    term: 'Observe',
    definition:
      'An Autopilot rule records what it would do but does not change Gmail. You review and approve its suggestions yourself.',
  },
  active: {
    term: 'Active',
    definition:
      'An Autopilot rule applies its action automatically to new matching mail. Active execution depends on your plan and can be paused.',
  },
  activityUndo: {
    term: 'Activity Undo',
    definition:
      'DeclutrMail’s plan-based window for reversing an eligible Archive, Later, or Delete action. Activity shows the deadline and any available Undo control.',
  },
  gmailTrashRecovery: {
    term: 'Gmail Trash recovery',
    definition:
      'Gmail’s separate recovery path for mail moved to Trash. It normally lasts up to 30 days and is not the same as DeclutrMail’s Activity Undo window.',
  },
  later: {
    term: 'Later',
    definition:
      'Moves matching mail currently in Inbox to the DeclutrMail/Later label until the required wake time. Future mail from the sender is unchanged.',
  },
} as const;

export type GlossaryTermId = keyof typeof GLOSSARY_TERMS;

export const GLOSSARY_GROUPS: ReadonlyArray<{
  title: string;
  description: string;
  terms: readonly GlossaryTermId[];
}> = [
  {
    title: 'Mail and sender context',
    description: 'What DeclutrMail groups and shows while you review.',
    terms: ['sender', 'gmailPreview'],
  },
  {
    title: 'Standing sender controls',
    description: 'Two different ways to tell DeclutrMail to leave a sender alone.',
    terms: ['protected', 'vip'],
  },
  {
    title: 'Autopilot modes',
    description: 'Whether a rule only suggests or can apply changes itself.',
    terms: ['observe', 'active'],
  },
  {
    title: 'Destinations and recovery',
    description: 'Where mail goes and which recovery window applies.',
    terms: ['later', 'activityUndo', 'gmailTrashRecovery'],
  },
];
