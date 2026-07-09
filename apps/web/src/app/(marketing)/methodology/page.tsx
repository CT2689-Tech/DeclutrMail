// /methodology — pragmatic D139 launch slice (trust page).
//
// Full D139 layered whitepaper (3000+ words, 3 SVGs, CASA PDF embed) is
// deferred; this ships the eight-section structure with locked privacy
// copy and honest product claims. Public marketing route: static prose,
// no auth round-trip; the only client JS is the D159 page-view tracker.
//
// CONTENT CONTRACT: storage / never-store lists come verbatim from
// `@declutrmail/shared` (D7, D228). No category ML prediction (D222).
// Canonical verbs only (D227). Mailto unsubscribe is manual (D230).

import type { Metadata } from 'next';
import {
  PRIVACY_BADGE_HEADLINE,
  PRIVACY_STORAGE_ITEMS,
  PRIVACY_NEVER_ITEMS,
  PRIVACY_STORAGE_LABEL,
  PRIVACY_NEVER_LABEL,
} from '@declutrmail/shared';
import { LegalPageLayout, LegalSection } from '@/features/marketing/legal-layout';
import { PageViewTracker } from '@/features/marketing/page-view-tracker';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';

export const metadata: Metadata = marketingPageMetadata({
  title: 'Methodology — DeclutrMail',
  description:
    'How DeclutrMail cleans up Gmail at the sender level: what we store (full bodies fetched: 0), how we recommend without category ML, and how Keep / Archive / Unsubscribe / Later / Delete preview before they run.',
  path: '/methodology',
});

const LAST_UPDATED = '2026-07-09';

const TOC = [
  { id: 'promise', label: 'Promise' },
  { id: 'what-we-see', label: 'What we see' },
  { id: 'what-we-never-store', label: 'What we never store' },
  { id: 'how-we-recommend', label: 'How we recommend' },
  { id: 'how-we-act', label: 'How we act' },
  { id: 'privacy-security', label: 'Privacy & security' },
  { id: 'open-questions', label: 'Open questions' },
  { id: 'founders-note', label: "Founder's note" },
] as const;

export default function MethodologyPage() {
  return (
    <LegalPageLayout title="Methodology" label="Methodology" lastUpdated={LAST_UPDATED} toc={TOC}>
      <PageViewTracker page="methodology" />

      <LegalSection id="promise" title="Promise">
        <p>
          DeclutrMail cleans Gmail at the <strong>sender</strong> level. You decide once per sender
          — Keep, Archive, Unsubscribe, Later, or Delete — instead of thrashing through individual
          messages. Every action shows a preview of exactly what will change before anything runs,
          and every action stays reversible for your plan&rsquo;s undo window:{' '}
          <strong>7 days on Free and Plus, 30 days on Pro</strong>.
        </p>
        <p>
          The trust line is literal: <strong>{PRIVACY_BADGE_HEADLINE}</strong>. We never fetch or
          store full message bodies. See <a href="/help">Help</a> for common questions and{' '}
          <a href="/pricing">Pricing</a> for plan details.
        </p>
      </LegalSection>

      <LegalSection id="what-we-see" title="What we see">
        <p>
          When you connect Gmail, DeclutrMail indexes only the metadata needed to rank senders and
          preview actions. The allowlist is locked:
        </p>
        <p>
          <strong>{PRIVACY_STORAGE_LABEL}</strong>
        </p>
        <ul>
          {PRIVACY_STORAGE_ITEMS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p>
          That is the complete list. The same boundary appears on the{' '}
          <a href="/privacy">Privacy Policy</a> and <a href="/security">Security</a> pages.
        </p>
      </LegalSection>

      <LegalSection id="what-we-never-store" title="What we never store">
        <p>
          <strong>{PRIVACY_NEVER_LABEL}</strong>
        </p>
        <ul>
          {PRIVACY_NEVER_ITEMS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p>
          Because bodies and attachments never enter our systems, the most sensitive content in your
          mailbox cannot leak from us — it was never there.
        </p>
      </LegalSection>

      <LegalSection id="how-we-recommend" title="How we recommend">
        <p>
          Recommendations come from volume and engagement signals you can inspect — how often a
          sender emails you, whether you tend to open or reply, and rules you explicitly enabled.
          DeclutrMail does <strong>not</strong> use machine learning to predict email categories
          (newsletter, transactional, personal, and so on) or to auto-protect or auto-route senders.
          Category prediction is permanently banned in this product.
        </p>
        <p>
          Decisions are yours. A recommendation is a suggestion you accept, change, or ignore —
          never a silent category label that moves mail without you.
        </p>
      </LegalSection>

      <LegalSection id="how-we-act" title="How we act">
        <p>
          The five user-facing verbs are Keep, Archive, Unsubscribe, Later, and Delete (shortcuts K
          / A / U / L / D). The lifecycle is always the same:
        </p>
        <ol>
          <li>You choose a verb for a sender (or a selected set of senders).</li>
          <li>
            An action preview shows exactly what will change — message counts, labels, and
            destination — before anything runs.
          </li>
          <li>On confirm, the mutation runs against Gmail.</li>
          <li>
            The action stays undoable for your plan&rsquo;s window (7 days Free/Plus, 30 days Pro).
          </li>
        </ol>
        <p>
          Unsubscribe: where a sender supports one-click list-unsubscribe, DeclutrMail can send that
          request for you. Where a sender only offers a mailto: address, we prepare the email and{' '}
          <strong>you send it yourself</strong> from Gmail — nothing is auto-sent on your behalf.
          Details are in <a href="/help#unsubscribe-flow">Help</a>.
        </p>
      </LegalSection>

      <LegalSection id="privacy-security" title="Privacy & security">
        <p>
          DeclutrMail requests the Gmail scope <code>gmail.modify</code> (plus identity scopes to
          know which account you connected). Message data is fetched in metadata form only. OAuth
          tokens are envelope-encrypted at rest. As an app using a restricted Gmail scope,
          DeclutrMail has passed Google&rsquo;s independent CASA Tier 2 security verification.
        </p>
        <p>
          For scope details, encryption, CASA, and vulnerability reporting, see the{' '}
          <a href="/security">Security</a> page. The legal storage boundary is also in the{' '}
          <a href="/privacy">Privacy Policy</a>.
        </p>
      </LegalSection>

      <LegalSection id="open-questions" title="Open questions">
        <p>
          DeclutrMail is in open beta. We are still learning which ranking signals feel most
          trustworthy, how much bulk cleanup people want on day one, and where Autopilot should stay
          quiet. If something feels wrong or unclear, email{' '}
          <a href="mailto:support@declutrmail.com">support@declutrmail.com</a> — honest feedback
          shapes what we ship next. See <a href="/beta">open beta</a> for how to get started.
        </p>
      </LegalSection>

      <LegalSection id="founders-note" title="Founder's note">
        <p>
          I built DeclutrMail because inbox cleanup kept turning into guilt and busywork — and every
          tool that promised relief wanted more of my mail than I was willing to hand over. The
          product bet is simple: decide once per sender, preview before anything moves, keep an undo
          window, and never fetch the body. If that boundary ever slips, the product has failed. —
          Chintan
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
}
