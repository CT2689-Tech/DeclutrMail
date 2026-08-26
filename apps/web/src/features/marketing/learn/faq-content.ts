import { PRIVACY_STORAGE_ITEMS } from '@declutrmail/shared';
import type { FaqEntry } from './types';

export const FAQ_ENTRIES: readonly FaqEntry[] = [
  {
    id: 'what-is-declutrmail',
    question: 'What is DeclutrMail?',
    answer:
      'DeclutrMail is a companion for Gmail that groups recurring email by sender, shows volume and read rate, and lets you choose Keep, Archive, Unsubscribe, Later, or Delete. Gmail remains the place where you read complete emails and check the final result.',
    link: {
      href: '/how-to/clean-gmail-by-sender',
      label: 'See the sender-first workflow',
      description: 'A practical walkthrough.',
    },
  },
  {
    id: 'replacement-inbox',
    question: 'Does DeclutrMail replace the Gmail inbox?',
    answer:
      'No. DeclutrMail is deliberately not a full email reader or composer. It organizes review by sender and Gmail actions, then links back to Gmail for full content, conversations, search, Trash, and account controls.',
  },
  {
    id: 'stored-data',
    question: 'What Gmail data does DeclutrMail store?',
    answer: `DeclutrMail stores these Gmail details: ${PRIVACY_STORAGE_ITEMS.join('; ')}. It also stores sender totals and read rates, your decisions, automation settings, Activity history, and account preferences needed to run the service.`,
    link: {
      href: '/privacy',
      label: 'Read the complete privacy policy',
      description: 'Retention, processors, rights, and deletion.',
    },
  },
  {
    id: 'full-bodies',
    question: 'Does DeclutrMail fetch full email bodies or attachments?',
    answer:
      'No. DeclutrMail requests only the listed Gmail details. Full email contents, HTML, attachments, embedded images, and raw email source are never fetched or stored. The subject line and Gmail preview snippet are stored, so the app does receive some text even though it never receives the complete email.',
  },
  {
    id: 'anthropic',
    question: 'Are any Gmail details sent to an AI provider?',
    answer:
      'To explain a suggestion, Anthropic receives sender totals and read rates without subject lines or snippets. Daily Brief works differently: it may send the sender, subject line, and Gmail preview snippet to Anthropic to compose a short summary. Neither use sends full email contents or attachments, and DeclutrMail uses a standard summary when Anthropic is unavailable.',
    link: {
      href: '/answers/what-is-metadata-only-email-analysis',
      label: 'See exactly what is processed',
      description: 'Gmail details, conclusions, and external processing.',
    },
  },
  {
    id: 'action-effects',
    question: 'What do Keep, Archive, Later, and Delete do?',
    answer:
      'Keep records your decision for a sender. Archive moves matching email out of Inbox but keeps it in Gmail All Mail. Later moves matching email out of Inbox and adds DeclutrMail/Later. Delete moves matching email to Gmail Trash. Each action starts with inbox email; Delete alone can also include a sender’s archived email when you choose that option before confirming. Manual Archive, Later, and Delete do not create rules for future email.',
  },
  {
    id: 'future-mail',
    question: 'Does archiving a sender automatically archive future messages?',
    answer:
      'No. Manual Archive acts on the current matching inbox messages. For exact future routing, create a Gmail filter. DeclutrMail also has preset Autopilot rules on Plus and Pro; you preview what a rule would do before you turn it on, and from then on it acts on future matches. You can instead run a rule in Observe, where it collects matches and waits for your approval.',
    link: {
      href: '/how-to/auto-archive-future-emails-in-gmail',
      label: 'Compare filters and Autopilot',
      description: 'Future routing without hidden rules.',
    },
  },
  {
    id: 'undo',
    question: 'Can every DeclutrMail action be undone?',
    answer:
      'No. Archive, Later, and Delete expose Activity Undo while their undo window is open (its length depends on your plan). Delete also has separate Gmail Trash recovery for up to about 30 days unless Trash is emptied sooner. Keep and Protected are sender settings you can change again. A delivered unsubscribe request cannot be recalled.',
    link: {
      href: '/answers/how-undo-works-for-gmail-cleanup',
      label: 'See every recovery path',
      description: 'Undo and recovery for each action.',
    },
  },
  {
    id: 'where-undo',
    question: 'Where do I find an active undo?',
    answer:
      'Activity is the dependable place to review completed actions and use Undo when it is available. Triage also shows recent actions. Undo does not appear on every screen, so use Activity when you need to check a result or recover email.',
  },
  {
    id: 'unsubscribe',
    question: 'How does DeclutrMail Unsubscribe work?',
    answer:
      'When a legitimate sender exposes the standards-based one-click method, DeclutrMail can submit the request and track its outcome. When the sender exposes only a mailto address, DeclutrMail opens a prepared Gmail draft and you press Send. Existing email stays where it is unless you separately approve Archive or Delete.',
  },
  {
    id: 'unsubscribe-undo',
    question: 'Can I undo an unsubscribe request?',
    answer:
      'Not after it has been delivered. The request has reached another organization, and email unsubscribe standards do not provide a universal retract operation. If you change your mind, subscribe again through the sender. Undoing a separately archived backlog does not resubscribe you.',
  },
  {
    id: 'suspicious-mail',
    question: 'Should I unsubscribe from suspicious or phishing email?',
    answer:
      'No. Interacting with an untrusted unsubscribe link can confirm that your address is active or lead to a malicious site. Use Gmail’s Report spam or Report phishing controls for suspicious email. Use unsubscribe for recognized, legitimate lists you no longer want.',
  },
  {
    id: 'autopilot',
    question: 'What does Autopilot do at launch?',
    answer:
      'Plus and Pro include five preset rules. Turning one on shows a sample of what it would do to matching email already in your inbox; confirm and it acts, then keeps acting on matching email that arrives. Choose Watch first instead and the rule collects possible matches without moving email, for you to approve or dismiss batch by batch. It can handle future matches automatically. Custom rule creation is not part of the launch product, and every rule can be paused.',
  },
  {
    id: 'later-vs-snooze',
    question: 'Is DeclutrMail Later the same as Gmail Snooze?',
    answer:
      'No. Gmail Snooze schedules one email. DeclutrMail Later moves the current matching email for a sender out of Inbox, adds the DeclutrMail/Later label, and requires one return time for that sender. It does not create a rule for future email.',
  },
  {
    id: 'plans',
    question: 'What changes between Free, Plus, and Pro?',
    answer:
      'Free supports one inbox with Senders, Triage, Later, bulk actions, and Activity, limited to 50 cleanup actions a month. Plus removes the monthly limit and adds the Screener, Autopilot rules that keep working on their own, and Quiet hours. Pro adds more connected inboxes and the two attention surfaces, Brief and Follow-ups. Use the pricing page for current plan details.',
    link: {
      href: '/pricing',
      label: 'Compare current plans',
      description: 'Prices, limits, and feature rows.',
    },
  },
  {
    id: 'disconnect-delete',
    question: 'How do I disconnect Gmail or delete DeclutrMail data?',
    answer:
      'Disconnect a mailbox from the top-bar mailbox menu; that revokes DeclutrMail’s Google access and stops future sync while preserving its historical DeclutrMail record for reconnection. Settings → Privacy & Data provides export and whole-account deletion. Deleting your DeclutrMail account does not itself delete the emails in Gmail, although email actions you previously approved remain part of Gmail’s state.',
    link: {
      href: '/security',
      label: 'Review the exit and security controls',
      description: 'OAuth revocation, encryption, and deletion.',
    },
  },
  {
    id: 'refunds-support',
    question: 'What is the refund policy, and how do I get help?',
    answer:
      'Every paid plan has a 30-day money-back guarantee subject to the published fair-use terms. Email support@declutrmail.com for product help and privacy@declutrmail.com for privacy, data-rights, or vulnerability reports.',
    link: {
      href: '/refunds',
      label: 'Read the refund policy',
      description: 'Eligibility, providers, and fair-use terms.',
    },
  },
];
