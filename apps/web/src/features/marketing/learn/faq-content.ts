import { PRIVACY_STORAGE_ITEMS } from '@declutrmail/shared';
import type { FaqEntry } from './types';

export const FAQ_ENTRIES: readonly FaqEntry[] = [
  {
    id: 'what-is-declutrmail',
    question: 'What is DeclutrMail?',
    answer:
      'DeclutrMail is a companion for Gmail that groups recurring mail by sender, shows aggregate facts such as volume and engagement, and lets you apply explicit Keep, Archive, Unsubscribe, Later, or Delete decisions. Gmail remains the place where you read full messages and verify final mailbox state.',
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
      'No. DeclutrMail is deliberately not a full email reader or composer. It organizes sender-level review and mail actions, then links back to Gmail for full content, threads, search, Trash, and account-level controls.',
  },
  {
    id: 'stored-data',
    question: 'What Gmail data does DeclutrMail store?',
    answer: `The message allowlist is: ${PRIVACY_STORAGE_ITEMS.join('; ')}. DeclutrMail also stores derived sender aggregates, your sender decisions, automation settings, action history, and account preferences needed to operate the service.`,
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
      'No. Gmail messages are fetched in metadata format. Full and raw message bodies, HTML, attachments, inline images, and raw MIME are never fetched or stored. Gmail’s short generated preview snippet and the subject are stored, so “metadata-only” does not mean content-free.',
  },
  {
    id: 'anthropic',
    question: 'Is any Gmail metadata sent to an AI provider?',
    answer:
      'The sender-reasoning path sends Anthropic precomputed aggregate facts without subjects or snippets. Daily Brief has a narrower bounded path that may send sender identity, subject, Gmail preview snippet, and VIP marker to Anthropic to compose its narrative. Neither path sends a full message body or attachment, and Brief falls back to a deterministic template when the provider is unavailable.',
    link: {
      href: '/answers/what-is-metadata-only-email-analysis',
      label: 'Understand the processing boundary',
      description: 'Fields, inferences, and external processing.',
    },
  },
  {
    id: 'action-effects',
    question: 'What do Keep, Archive, Later, and Delete do?',
    answer:
      'Keep records a sender decision. Archive removes Inbox from current matching mail but keeps it in Gmail All Mail. Later removes Inbox and adds DeclutrMail/Later to current matching mail. Delete moves current matching mail to Gmail Trash. Manual Archive, Later, and Delete do not create standing future-mail rules.',
  },
  {
    id: 'future-mail',
    question: 'Does archiving a sender automatically archive future messages?',
    answer:
      'No. Manual Archive acts on the current matching inbox messages. For exact future routing, create a Gmail filter. DeclutrMail Pro also has preset Autopilot rules; those begin in Observe and must be separately activated after review.',
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
      'No. Archive and Later expose Activity undo while their journal token is active. Delete can also be recovered from Gmail Trash for up to about 30 days unless Trash is emptied sooner. Keep, VIP, and Protect are settings you can change again. A delivered unsubscribe request cannot be recalled.',
    link: {
      href: '/answers/how-undo-works-for-gmail-cleanup',
      label: 'See every recovery path',
      description: 'Undo and recovery, verb by verb.',
    },
  },
  {
    id: 'where-undo',
    question: 'Where do I find an active undo?',
    answer:
      'Activity is the dependable audit and recovery surface for journaled actions. Triage also shows a recent-action tray. An undo control is not currently mounted globally across every product screen, so use Activity when you need to inspect the authoritative result.',
  },
  {
    id: 'unsubscribe',
    question: 'How does DeclutrMail Unsubscribe work?',
    answer:
      'When a legitimate sender exposes the standards-based one-click method, DeclutrMail can submit the request and track its outcome. When the sender exposes only a mailto address, DeclutrMail opens a prepared Gmail draft and you press Send. Existing mail stays where it is unless you separately approve Archive or Delete.',
  },
  {
    id: 'unsubscribe-undo',
    question: 'Can I undo an unsubscribe request?',
    answer:
      'Not after it has been delivered. The request has reached another organization, and email unsubscribe standards do not provide a universal retract operation. If you change your mind, subscribe again through the sender. Undoing a separately archived backlog does not resubscribe you.',
  },
  {
    id: 'suspicious-mail',
    question: 'Should I unsubscribe from suspicious or phishing mail?',
    answer:
      'No. Interacting with an untrusted unsubscribe link can confirm that your address is active or lead to a malicious site. Use Gmail’s Report spam or Report phishing controls for suspicious mail. Use unsubscribe for recognized, legitimate lists you no longer want.',
  },
  {
    id: 'autopilot',
    question: 'What does Autopilot do at launch?',
    answer:
      'Pro includes five preset rules. Each rule starts in Observe, collecting would-be matches without moving mail. After a seven-day observation period, you review the sample and dry-run scope before choosing Active. Custom rule creation is not part of the launch UI, and every rule can be paused.',
  },
  {
    id: 'later-vs-snooze',
    question: 'Is DeclutrMail Later the same as Gmail Snooze?',
    answer:
      'No. Later moves matching current mail out of Inbox and adds the DeclutrMail/Later label. Gmail Snooze hides a message until a selected time and then returns it. DeclutrMail has a separate scheduling surface for sender-level wake times; the underlying concepts should not be treated as interchangeable.',
  },
  {
    id: 'plans',
    question: 'What changes between Free, Plus, and Pro?',
    answer:
      'Free supports one inbox, sender and activity surfaces, five lifetime cleanup actions, and a seven-day journal window. Plus adds unlimited cleanup and multi-sender workflows for one inbox. Pro adds a second inbox, a thirty-day journal window, and the automation set including Autopilot, Brief, Screener, Quiet, Later scheduling, and Follow-ups. Use the pricing page as the current source of truth.',
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
      'Disconnect a mailbox from the top-bar Gmail account menu; that revokes DeclutrMail’s Google access and stops future sync while preserving its historical DeclutrMail record for reconnection. Settings → Privacy & Data provides export and whole-account deletion. Deleting your DeclutrMail account does not itself delete the emails in Gmail, although mail actions you previously approved remain part of Gmail’s state.',
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
