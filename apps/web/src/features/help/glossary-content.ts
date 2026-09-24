/**
 * Compact product language for D245's in-product glossary.
 *
 * These definitions explain product concepts, not implementation details.
 * Decision-point help can select a single entry from this registry instead of
 * linking users to a long generic FAQ.
 */

import { UNIFORM_UNDO_WINDOW_DAYS } from '@declutrmail/shared/entitlements/undo-window';

export const GLOSSARY_TERMS = {
  sender: {
    term: 'Sender',
    definition:
      'A person or service identified by its From address. DeclutrMail groups matching email by sender so one decision can cover that sender’s email.',
  },
  gmailPreview: {
    term: 'Gmail preview snippet',
    definition:
      'The short text Gmail already shows in your inbox list. DeclutrMail stores it to give you context without fetching the full email.',
  },
  decision: {
    term: 'Decision',
    definition:
      'What you want for a sender. DeclutrMail records it; Gmail changes only when an action is confirmed or an Active rule applies.',
  },
  action: {
    term: 'Action',
    definition:
      'One specific result, such as Archive, Later, Unsubscribe, Delete, or recording Keep. DeclutrMail shows the result in Activity.',
  },
  suggestion: {
    term: 'Suggestion',
    definition:
      'A recommended decision based on the sender facts DeclutrMail lists. A suggestion never changes Gmail on its own.',
  },
  rule: {
    term: 'Rule',
    definition:
      'An instruction for future matching email. Watch first only suggests; Active can perform the rule’s action automatically.',
  },
  protected: {
    term: 'Protected',
    definition:
      'A standing safety policy that recommends Keep and excludes the sender from bulk and automatic cleanup. You can still choose a single-sender action after acknowledging the override.',
  },
  observe: {
    term: 'Watch first',
    definition:
      'An optional Autopilot mode that records what a rule would do without changing Gmail. You review and approve its suggestions yourself. It never switches to Active automatically.',
  },
  active: {
    term: 'Active',
    definition:
      'An Autopilot rule applies its action automatically to new matching email. Active execution depends on your plan and can be paused.',
  },
  activityUndo: {
    term: 'Activity Undo',
    definition:
      UNIFORM_UNDO_WINDOW_DAYS === null
        ? "DeclutrMail's plan-based window for reversing an eligible Archive, Later, or Delete action. Activity shows the deadline and any available Undo control."
        : `DeclutrMail's ${UNIFORM_UNDO_WINDOW_DAYS}-day window for reversing an eligible Archive, Later, or Delete action. Activity shows the deadline and any available Undo control.`,
  },
  gmailTrashRecovery: {
    term: 'Gmail Trash recovery',
    definition:
      'Gmail’s separate recovery path for email moved to Trash. It lasts up to 30 days and is not the same as DeclutrMail’s Activity Undo window.',
  },
  later: {
    term: 'Later',
    definition:
      'Moves matching email currently in Inbox to the DeclutrMail/Later label until the return time you choose. Future email from the sender is unchanged.',
  },
} as const;

export type GlossaryTermId = keyof typeof GLOSSARY_TERMS;

export const GLOSSARY_GROUPS: ReadonlyArray<{
  title: string;
  terms: readonly GlossaryTermId[];
}> = [
  {
    title: 'Mail and sender context',
    terms: ['sender', 'gmailPreview'],
  },
  {
    title: 'Decisions and actions',
    terms: ['decision', 'action', 'suggestion', 'rule'],
  },
  {
    title: 'Standing sender controls',
    terms: ['protected'],
  },
  {
    title: 'Autopilot modes',
    terms: ['observe', 'active'],
  },
  {
    title: 'Destinations and recovery',
    terms: ['later', 'activityUndo', 'gmailTrashRecovery'],
  },
];
