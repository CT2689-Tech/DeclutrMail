import type { Metadata } from 'next';

import '@/features/marketing/product-story/product-story.css';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';
import {
  ActionLifecycleFigure,
  ActionSemanticsGrid,
  AutomationBoundaryFigure,
  FinalStoryCta,
  GmailBridgeTable,
  ProductStoryShell,
  ProductWalkthroughFigure,
  StorySection,
} from '@/features/marketing/product-story';

export const metadata: Metadata = marketingPageMetadata({
  title: 'How DeclutrMail works with Gmail — DeclutrMail',
  description:
    'See how DeclutrMail groups Gmail metadata by sender, previews manual mailbox changes, and keeps one-time cleanup separate from activated Pro Autopilot rules.',
  path: '/how-it-works',
});

export default function HowItWorksPage() {
  return (
    <ProductStoryShell
      eyebrow="How it works"
      title="A sender-control layer for Gmail."
      lede="Gmail remains where you read, reply, compose, and search. DeclutrMail groups allowlisted Gmail metadata by sender and helps you make a smaller set of decisions. Manual cleanup changes only the preview you confirm; activated Pro rules are a separate future-mail path."
    >
      <StorySection
        id="gmail-stays-home"
        number="01"
        title="Your inbox does not move."
        intro={
          <p>
            DeclutrMail is a companion to Gmail, not a replacement email client. The split is
            deliberate: Gmail handles messages; DeclutrMail handles sender-level cleanup.
          </p>
        }
      >
        <div className="dm-story-prose-grid">
          <article className="dm-story-prose-card">
            <h3>Keep doing in Gmail</h3>
            <p>
              Read full messages, reply, compose, search, use Gmail labels, and manage
              conversations. Gmail remains the source of truth for the mailbox.
            </p>
          </article>
          <article className="dm-story-prose-card">
            <h3>Do faster in DeclutrMail</h3>
            <p>
              Review senders, inspect the metadata behind a recommendation, preview the affected
              messages, confirm a cleanup action, and audit reversible changes in Activity.
            </p>
          </article>
        </div>
        <p className="dm-story-callout">
          Recent subject links return to Gmail when you need message context. DeclutrMail never
          tries to become the place where you read the full conversation.
        </p>
      </StorySection>

      <StorySection
        id="walkthrough"
        number="02"
        title="One sender decision at a time."
        intro={
          <p>
            After Gmail is connected, a one-time metadata scan builds the sender index. DeclutrMail
            reports the current sync stage and progress; duration varies with mailbox size and
            Gmail&rsquo;s rate limits. Every plan can review the ranked Senders view; Plus and Pro
            also turn it into a focused Triage queue.
          </p>
        }
        tone="ink"
      >
        <ProductWalkthroughFigure />
      </StorySection>

      <StorySection
        id="gmail-actions"
        number="03"
        title="The verbs, in Gmail terms."
        intro={
          <p>
            On Plus and Pro, Daily Triage uses four choices: Keep, Archive, Unsubscribe, and Later.
            Every plan can use the same cleanup verbs from Senders; Delete remains available from
            Senders and Sender Detail. Keep is not Protect: Keep records a decision; Protect is a
            separate shield against destructive and bulk actions.
          </p>
        }
      >
        <ActionSemanticsGrid />
        <GmailBridgeTable />
      </StorySection>

      <StorySection
        id="preview-first"
        number="04"
        title="Preview before the mailbox changes."
        intro={
          <p>
            An optional action sheet can collect preferences, but the affected-message preview is
            mandatory. The interface waits for the relevant boundary: Gmail confirms mailbox
            mutations, while a sender&rsquo;s list endpoint returns the one-click unsubscribe
            outcome.
          </p>
        }
      >
        <ActionLifecycleFigure />
      </StorySection>

      <StorySection
        id="manual-versus-automation"
        number="05"
        title="Manual cleanup is not a hidden rule."
        intro={
          <p>
            A manual Archive, Later, or Delete applies to the current messages named in its preview.
            It does not quietly decide what happens to future mail. Future automation is a separate
            Pro feature with its own controls.
          </p>
        }
      >
        <AutomationBoundaryFigure />
      </StorySection>

      <StorySection
        id="connect-boundary"
        number="06"
        title="Know what Connect Gmail means."
        intro={
          <p>
            DeclutrMail requests <code>gmail.modify</code> because archiving, labeling, and moving
            messages to Trash require mailbox changes. It also requests basic identity scopes so the
            connected account can be identified.
          </p>
        }
        tone="ink"
      >
        <div className="dm-story-prose-grid">
          <article className="dm-story-prose-card">
            <h3>Metadata, not full messages</h3>
            <p>
              The Gmail message index is limited to sender, subject, Gmail Preview text, dates,
              labels, and read/unread state. Full bodies, attachments, inline images, and raw MIME
              are not fetched or stored.
            </p>
          </article>
          <article className="dm-story-prose-card">
            <h3>You can leave cleanly</h3>
            <p>
              Revoke Gmail access or disconnect an inbox from the account menu, export your
              DeclutrMail data, or schedule whole-account deletion from Settings. Disconnect keeps
              historical DeclutrMail records so reconnecting can restore context; Gmail remains
              intact.
            </p>
          </article>
        </div>
      </StorySection>

      <FinalStoryCta
        title="Bring the sender view to your Gmail."
        body="Connect Gmail, let the metadata index finish, and make the first decision with the affected messages visible before anything changes."
      />
    </ProductStoryShell>
  );
}
